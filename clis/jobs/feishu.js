import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

// Strategy: UI_SELECTOR / visible-ui.
// 2026-10-04: Xiaomi Node fetch returned HTTP 200 HTML shell with no job cards.
// Browser URL keywords=数据开发 rendered real position links, titles and locations.
// Semantic anchors avoid undocumented/signed recruitment API coupling; no login.
export function extractFeishuList() {
  const read = el => (el?.innerText ?? el?.textContent ?? '').trim();
  const anchors = [...document.querySelectorAll('a[href*="/position/"][href*="/detail"]')];
  const jobs = anchors.map(a => {
    const subtitle = a.querySelector('[class*="subTitle"], [class*="subtitle"]');
    return {
      jobId: a.getAttribute('data-id') || a.href.match(/\/position\/([^/]+)\/detail/)?.[1],
      jobTitle: read(a.querySelector('[class*="positionItem-title"], [data-test="positionItem"], [class*="title"]')) || read(a).split('\n')[0],
      jobLocation: read(subtitle?.querySelector('span')) || null,
      jobDescription: read(a.querySelector('[class*="jobDesc"]')) || null,
      jobRequirements: null,
      jobUrl: a.href,
    };
  });
  const bodyText = read(document.body);
  const empty = /暂无(?:匹配)?职位|暂无符合|没有找到|无匹配职位|No (?:matching )?(?:jobs|results)/i.test(bodyText);
  const next = document.querySelector('.atsx-pagination-next, [class*="pagination-next"]');
  return {
    jobs, empty,
    login: /\/login(?:[/?#]|$)/.test(location.href),
    nextPage: next ? next.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(next.className) : false,
    searchValue: document.querySelector('input[placeholder*="搜索"]')?.value ?? null,
    activePage: read(document.querySelector('.atsx-pagination-item-active')) || null,
  };
}

export function extractFeishuDetail() {
  const read = el => (el?.innerText ?? el?.textContent ?? '').trim();
  const headings = [...document.querySelectorAll('.block-title, [class*="blockTitle"]')];
  const contents = [...document.querySelectorAll('.block-content, [class*="blockContent"]')];
  const duties = [], requirements = [];
  contents.forEach((el, i) => {
    const text = read(el);
    if (text) (/要求|资格/.test(read(headings[i])) ? requirements : duties).push(text);
  });
  return { jobDescription: duties.join('\n\n') || null, jobRequirements: requirements.join('\n\n') || null };
}

export async function waitFeishuList(page, query, timeout, expectedPage) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(extractFeishuList);
    if (!state || !Array.isArray(state.jobs)) throw new CommandExecutionError('Malformed Feishu listing extraction');
    if (state.login) throw new AuthRequiredError('jobs.feishu.cn');
    const correctQuery = state.searchValue === null || state.searchValue === query;
    const correctPage = !state.activePage || Number(state.activePage) === expectedPage;
    if (correctQuery && correctPage && (state.jobs.length || state.empty)) return state;
    await page.wait(0.3);
  }
  throw new TimeoutError('Recruitment listing', timeout);
}

export async function searchFeishu(page, company, query, pages, timeout, details = false) {
  const collected = [], seen = new Set();
  for (let current = 1; current <= pages; current++) {
    const url = new URL(company.url);
    // Preserve the user's full query and remove inherited country/function filters.
    url.searchParams.set('keywords', query);
    url.searchParams.set('current', String(current));
    url.searchParams.set('limit', '10');
    await page.goto(url.href);
    const state = await waitFeishuList(page, query, timeout, current);
    if (state.empty && !state.jobs.length) break;
    let fresh = 0;
    for (const job of state.jobs) {
      if (!job.jobId || !job.jobTitle || !job.jobUrl) throw new CommandExecutionError(`${company.id}: job card is missing id, title or URL`);
      if (!seen.has(job.jobUrl)) {
        seen.add(job.jobUrl);
        collected.push(job);
        fresh++;
      }
    }
    if (!fresh && current > 1) throw new CommandExecutionError(`${company.id}: pagination repeated an earlier page`);
    if (!state.nextPage) break;
  }
  if (details) {
    for (const job of collected) {
      await page.goto(job.jobUrl);
      const deadline = Date.now() + timeout * 1000;
      let detail;
      do {
        detail = await page.evaluate(extractFeishuDetail);
        if (detail?.jobDescription || detail?.jobRequirements) break;
        await page.wait(0.3);
      } while (Date.now() < deadline);
      if (!detail?.jobDescription && !detail?.jobRequirements) throw new TimeoutError(`${company.id} job detail`, timeout);
      job.jobDescription = detail.jobDescription ?? job.jobDescription;
      job.jobRequirements = detail.jobRequirements;
    }
  }
  return collected;
}
