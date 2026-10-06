import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

// Bilibili Strategy: INTERCEPT / internal-unstable. Observed rendered
// a.bili-item-card has neither href nor job id; the scraper captures
// /api/srs/position/positionList after the visible search action. No signature
// is reproduced. Moka Strategy: UI_SELECTOR / visible-ui, with response capture
// only to confirm that keyword search finished before reading its semantic links.
export function extractMokaList() {
  const read = el => (el?.innerText ?? el?.textContent ?? '').trim();
  const cards = [...document.querySelectorAll('a[href*="#/job/"]')]
    .filter(a => /list-/.test(a.parentElement?.className ?? ''));
  const next = document.querySelector('button[class*="Pagination-forward"]');
  return {
    jobs: cards.map(a => ({
      jobId: a.href.match(/#\/job\/([^/?]+)/)?.[1],
      jobTitle: read(a.querySelector('[class*="title-"]')),
      jobLocation: null, jobDescription: null, jobRequirements: null, jobUrl: a.href,
    })),
    empty: /暂无匹配职位|暂无职位|0 结果/.test(read(document.body)),
    nextPage: Boolean(next && !next.disabled && next.getAttribute('aria-disabled') !== 'true'),
    loading: Boolean(document.querySelector('[class*="Loading-loading-"]')),
  };
}

export function splitJobText(value) {
  const raw = String(value ?? '').trim();
  const index = raw.search(/工作要求[:：]|任职要求|职位要求|任职资格/);
  return index > 0 ? [raw.slice(0, index).trim(), raw.slice(index).trim()] : [raw || null, null];
}

export function mapBiliResponse(payload) {
  if (payload?.code !== 0 || !Array.isArray(payload?.data?.list)) throw new CommandExecutionError('Bilibili returned a failed or malformed position response');
  return payload.data.list.map(item => {
    if (!item.id || !item.positionName) throw new CommandExecutionError('Bilibili job is missing id or title');
    const [duties, requirements] = splitJobText(item.positionDescription);
    return { jobId: String(item.id), jobTitle: item.positionName.trim(), jobLocation: item.workLocation || null,
      jobDescription: duties, jobRequirements: requirements,
      jobUrl: `https://jobs.bilibili.com/social/positions/${item.id}` };
  });
}

async function waitCapture(page, timeout, label) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const responses = await page.getInterceptedRequests();
    if (responses.length) return responses.at(-1);
    await page.wait(0.3);
  }
  throw new TimeoutError(label, timeout);
}

async function searchInput(page, selector, query, timeout, clickSearch = false) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if (await page.evaluate(sel => [...document.querySelectorAll(sel)].some(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })), selector)) {
      // On Moka desktop/mobile copies coexist. Resolve the visible search input.
      await page.evaluate(sel => {
        const input = [...document.querySelectorAll(sel)].find(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        input.setAttribute('data-opencli-job-search', 'true');
      }, selector);
      // Dispatch standard DOM input/change events as well as setting the value.
      // The older bridge's fill path changes the visible value without updating
      // Vue/React's search model. Use the native setter, which leaves React's
      // value tracker able to observe the change.
      const filled = await page.evaluate(value => {
        const input = document.querySelector('[data-opencli-job-search="true"]');
        input.value = '';
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
        return input.value === value;
      }, query);
      if (!filled) throw new CommandExecutionError('Job search input did not retain the keyword');
      if (clickSearch) {
        const buttonFound = await page.evaluate(() => {
          const button = [...document.querySelectorAll('button')].find(el => /^(搜索|搜索职位)$/.test(el.textContent.trim()) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
          if (!button) return false;
          button.setAttribute('data-opencli-job-submit', 'true');
          return true;
        });
        if (!buttonFound) throw new CommandExecutionError('Job search button is missing');
        await page.evaluate(() => document.querySelector('[data-opencli-job-submit="true"]').click());
      } else await page.pressKey('Enter');
      return;
    }
    await page.wait(0.3);
  }
  throw new TimeoutError('Job search input', timeout);
}

export async function searchExtra(page, company, query, pages, timeout, details = false) {
  await page.goto(company.url);
  const bili = company.type === 'bilibili';
  // Search inputs can appear before the initial listing request completes.
  // Wait for the visible list/empty state before installing captures or typing.
  const readyDeadline = Date.now() + timeout * 1000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    ready = await page.evaluate(isBili => {
      const text = document.body?.innerText ?? '';
      return isBili
        ? Boolean(document.querySelector('a.bili-item-card')) || /职位列表\s*[（(]0[）)]/.test(text)
        : Boolean(document.querySelector('a[href*="#/job/"]')) || /暂无匹配职位/.test(text);
    }, bili);
    if (ready) break;
    await page.wait(0.3);
  }
  if (!ready) throw new TimeoutError(`${company.id} initial listing`, timeout);
  await page.installInterceptor(bili ? '/api/srs/position/positionList' : '/website/jobs/v2');
  await page.getInterceptedRequests();
  await searchInput(page, bili ? 'input[placeholder*="搜索"]' : 'input[placeholder="输入职位关键字"], input[placeholder="搜索职位"]', query, timeout, true);
  let response = await waitCapture(page, timeout, `${company.id} keyword search`);
  const collected = [], seen = new Set();
  for (let current = 1; current <= pages; current++) {
    let jobs, next;
    if (bili) {
      jobs = mapBiliResponse(response);
      next = await page.evaluate(number => Boolean([...document.querySelectorAll('.el-pager li, .ant-pagination-item')].find(el => el.textContent.trim() === String(number))), current + 1);
    } else {
      const deadline = Date.now() + timeout * 1000;
      let state;
      do {
        state = await page.evaluate(extractMokaList);
        if (!state.loading && (state.jobs.length || state.empty)) break;
        await page.wait(0.3);
      } while (Date.now() < deadline);
      if (state.loading || (!state.jobs.length && !state.empty)) throw new TimeoutError('Moka listing', timeout);
      jobs = state.jobs;
      next = state.nextPage;
    }
    if (!jobs.length) break;
    let fresh = 0;
    for (const job of jobs) {
      if (!job.jobId || !job.jobTitle || !job.jobUrl) throw new CommandExecutionError(`${company.id}: malformed job card`);
      if (!seen.has(job.jobUrl)) { seen.add(job.jobUrl); collected.push(job); fresh++; }
    }
    if (!fresh && current > 1) throw new CommandExecutionError(`${company.id}: pagination repeated a page`);
    if (current === pages || !next) break;
    await page.getInterceptedRequests();
    const clicked = await page.evaluate((isBili, number) => {
      const button = isBili
        ? [...document.querySelectorAll('.el-pager li, .ant-pagination-item')].find(el => el.textContent.trim() === String(number))
        : document.querySelector('button[class*="Pagination-forward"]');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      button.click(); return true;
    }, bili, current + 1);
    if (!clicked) throw new CommandExecutionError(`${company.id}: next page control disappeared`);
    response = await waitCapture(page, timeout, `${company.id} next page`);
  }
  if (!bili && details) {
    for (const job of collected) {
      await page.goto(job.jobUrl);
      const deadline = Date.now() + timeout * 1000;
      let extracted;
      do {
        extracted = await page.evaluate(() => {
          const read = el => (el?.innerText ?? el?.textContent ?? '').trim();
          const info = read(document.querySelector('[class*="info-container"]'));
          return { body: read(document.querySelector('[class*="job-description"]')), city: info.match(/工作地所在城市[\s:：]+([^\n]+)/)?.[1] || null };
        });
        if (extracted.body) break;
        await page.wait(0.3);
      } while (Date.now() < deadline);
      if (!extracted.body) throw new TimeoutError('Moka job detail', timeout);
      [job.jobDescription, job.jobRequirements] = splitJobText(extracted.body);
      job.jobLocation = extracted.city;
    }
  }
  return collected;
}
