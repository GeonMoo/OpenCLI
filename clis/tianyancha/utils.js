import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

export const BASE = 'https://www.tianyancha.com';
export const BASE_INFO_KEY = '/biz-service/cloud-other-information/companyinfo/baseinfo/web';

export function cleanText(value) {
  return value == null ? null : String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

export function companyId(value) {
  const input = String(value ?? '').trim();
  if (/^\d+$/.test(input)) return input;
  if (!/^https?:\/\//i.test(input)) return null;
  let url;
  try { url = new URL(input); } catch { throw new ArgumentError('Invalid company URL'); }
  const id = url.pathname.match(/^\/company\/(\d+)\/?$/)?.[1];
  if (!['www.tianyancha.com', 'tianyancha.com'].includes(url.hostname) || url.port || !id) {
    throw new ArgumentError('Use a Tianyancha /company/<id> URL, a company ID, or a company name');
  }
  return id;
}

export function calendarDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CommandExecutionError('Invalid Tianyancha date');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export async function checkPage(page) {
  const gate = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const title = document.title;
    if (/captcha|\/verify|\/sorry/.test(location.pathname) || /访问验证|安全验证|访问异常/.test(title)) return 'verification';
    if (/\/login/.test(location.pathname) || /登录后查看|登录后即可查看/.test(text)) return 'login';
    if (/页面不存在|企业不存在|404/.test(title)) return 'missing';
    return null;
  });
  if (gate === 'verification') throw new CommandExecutionError('Tianyancha requires browser verification; complete it in the retained tab, then retry');
  if (gate === 'login') throw new AuthRequiredError('tianyancha.com', 'Run opencli tianyancha login, then retry');
  if (gate === 'missing') throw new EmptyResultError('tianyancha detail', 'Company page does not exist');
}

export async function readState(page, url, key) {
  await page.goto(url);
  for (let attempt = 0; attempt < 15; attempt++) {
    await checkPage(page);
    const payload = await page.evaluate((wanted) => {
      const props = window.__NEXT_DATA__?.props?.pageProps;
      if (wanted === 'companySearch') return props?.listRes ?? null;
      return props?.dehydratedState?.queries?.find(q => q.queryKey?.[0] === wanted)?.state?.data ?? null;
    }, key);
    if (payload) {
      if (payload.state !== 'ok') {
        if (/登录/.test(payload.message ?? '')) throw new AuthRequiredError('tianyancha.com', payload.message);
        throw new CommandExecutionError(`Tianyancha: ${payload.message || 'unexpected page data response'}`);
      }
      return payload.data;
    }
    await page.wait(1);
  }
  throw new TimeoutError('Tianyancha page data', 15, 'The page state may have changed; inspect the retained tab');
}

export async function searchCompanies(page, query) {
  const data = await readState(page, `${BASE}/search?key=${encodeURIComponent(query)}`, 'companySearch');
  if (!Array.isArray(data?.companyList)) throw new CommandExecutionError('Tianyancha companyList is missing');
  if (!data.companyList.length) throw new EmptyResultError('tianyancha search', `No company matched ${query}`);
  return data.companyList;
}

export async function resolveCompany(page, input) {
  const direct = companyId(input);
  if (direct) return direct;
  if (!String(input ?? '').trim()) throw new ArgumentError('Company cannot be empty');
  const matches = await searchCompanies(page, String(input).trim());
  const match = matches.find(item => cleanText(item.name) === String(input).trim()) ?? matches[0];
  if (!/^\d+$/.test(String(match.id))) throw new CommandExecutionError('Search result has no valid company ID');
  return String(match.id);
}
