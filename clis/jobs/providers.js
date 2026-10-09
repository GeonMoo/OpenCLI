import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';

// Official recruitment-site JSON endpoints from the supplied scrapers. Their
// schema is undocumented (internal-unstable); validate status and shape instead
// of masking drift as an empty list. No signatures or access-control workarounds.
const HEADERS = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0' };
const clean = value => value == null ? null : String(value).trim() || null;
const first = (...values) => values.map(clean).find(Boolean) ?? null;
const joined = value => Array.isArray(value) ? value.map(v => typeof v === 'object' ? first(v.name, v.label) : clean(v)).filter(Boolean).join(' / ') : clean(value);

async function request(url, init, timeout, raw = false) {
  try {
    const response = await fetch(url, { headers: HEADERS, ...init, signal: AbortSignal.timeout(timeout * 1000) });
    if (response.status === 401) throw new AuthRequiredError(new URL(url).hostname);
    if (!response.ok) throw new CommandExecutionError(`Recruitment API HTTP ${response.status}: ${url}`);
    if (raw) return response;
    try { return await response.json(); }
    catch { throw new CommandExecutionError(`Recruitment API returned invalid JSON: ${url}`); }
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new TimeoutError('Recruitment API', timeout);
    if (error instanceof CommandExecutionError || error instanceof AuthRequiredError) throw error;
    throw new CommandExecutionError(`Recruitment request failed: ${error.message}`);
  }
}

const post = (body, headers = {}) => ({ method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function assertRows(value, label) {
  if (!Array.isArray(value)) throw new CommandExecutionError(`${label}: unexpected job list shape`);
  return value;
}
function mapJob(id, title, city, duties, requirements, url) {
  if (!id || !clean(title) || !url) throw new CommandExecutionError('Recruitment job missing id, title or URL');
  return { jobId: String(id), jobTitle: clean(title), jobLocation: joined(city), jobDescription: clean(duties), jobRequirements: clean(requirements), jobUrl: String(url) };
}
function queryUrl(base, values) {
  const url = new URL(base);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.href;
}
async function bootstrapAlibaba(company, timeout) {
  const response = await request(company.url, {}, timeout, true);
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  await response.text();
  const cookie = cookies.map(value => value.split(';')[0]).filter(Boolean).join('; ');
  const csrf = cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1];
  if (!csrf) throw new CommandExecutionError(`${company.id}: recruitment site did not issue its CSRF cookie`);
  return { cookie, csrf: decodeURIComponent(csrf) };
}

export async function searchApi(company, query, pages = 1, timeoutSeconds = 20, details = false) {
  const type = company.type ?? company.id;
  if (!['alibaba_talent', 'baidu', 'tencent', 'huawei', 'liauto', 'xiaohongshu', 'pdd'].includes(type)) throw new ArgumentError(`Unsupported recruitment provider: ${type}`);
  if (!String(query ?? '').trim()) throw new ArgumentError('query must not be blank');
  if (!Number.isInteger(pages) || pages < 1) throw new ArgumentError('pages must be a positive integer');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) throw new ArgumentError('timeout must be a positive integer');
  const session = type === 'alibaba_talent' ? await bootstrapAlibaba(company, timeoutSeconds) : null;
  const collected = [], seen = new Set();
  for (let current = 1; current <= pages; current++) {
    let jobs, totalPages;
    if (type === 'tencent') {
      const url = queryUrl('https://careers.tencent.com/tencentcareer/api/post/Query', {
        timestamp: Date.now(), countryId: '', cityId: '', bgIds: '', productId: '', categoryId: '', parentCategoryId: '', attrId: '', keyword: query, pageIndex: current, pageSize: 10, language: 'zh-cn', area: 'cn',
      });
      const data = await request(url, { headers: { ...HEADERS, Referer: company.url } }, timeoutSeconds);
      if (data.Code !== undefined && data.Code !== 200 && data.Code !== 0) throw new CommandExecutionError(`Tencent API: ${data.Message ?? data.Code}`);
      jobs = assertRows(data.Data?.Posts, 'Tencent').map(item => mapJob(item.PostId, item.RecruitPostName, item.LocationName, item.Responsibility, item.Requirement, item.PostURL || `https://careers.tencent.com/jobdesc.html?postId=${item.PostId}`));
      totalPages = Math.ceil(Number(data.Data.Count) / 10);
    } else if (type === 'baidu') {
      // requests(data=...) in the scraper omits empty array form values.
      const body = new URLSearchParams({ recruitType: 'SOCIAL', pageSize: '10', keyWord: query, curPage: String(current), projectType: '' });
      const data = await request('https://talent.baidu.com/httservice/getPostListNew', {
        method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://talent.baidu.com', Referer: company.url }, body,
      }, timeoutSeconds);
      if (data.status !== 'ok') throw new CommandExecutionError(`Baidu API: ${data.message ?? data.status}`);
      jobs = assertRows(data.data?.list, 'Baidu').map(item => mapJob(item.postId, item.name, item.workPlace, item.workContent, item.serviceCondition, `https://talent.baidu.com/jobs/detail/SOCIAL/${item.postId}`));
      totalPages = Math.ceil(Number(data.data.total) / 10);
    } else if (type === 'huawei') {
      const data = await request('https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/getJobPage?X-HW-ID=app_000000035886', post({ curPage: current, pageSize: 10, jobType: 'SR', keyWord: query }, {
        'X-HW-ID': 'app_000000035886', 'X-Jalor-TenantAlias': 'hcm', 'X-Language': 'zh_CN', 'X-Referer': 'https://career.huawei.com/cn', Origin: 'https://career.huawei.com', Referer: 'https://career.huawei.com/',
      }), timeoutSeconds);
      if (data.status !== 'SUCCESS') throw new CommandExecutionError(`Huawei API: ${data.message ?? data.status}`);
      jobs = assertRows(data.data?.result, 'Huawei').map(item => mapJob(item.advertisementId, first(item.jobNameNew, item.jobName), first(item.workPlace, item.cityName, item.areaName), first(item.mainBusiness, item.jobDesc), item.jobRequire, `https://career.huawei.com/cn/job-details?advertisementId=${encodeURIComponent(item.advertisementId)}`));
      totalPages = Number(data.data.pageVO?.totalPages);
    } else if (type === 'liauto') {
      const data = await request(queryUrl('https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/social/job-page', { page: current, page_size: 10, search: query }), { headers: HEADERS }, timeoutSeconds);
      if (data.code !== 0) throw new CommandExecutionError(`Li Auto API: ${data.message ?? data.code}`);
      jobs = assertRows(data.data?.items, 'Li Auto').map(item => mapJob(item.id, item.title, item.location_title, item.description, item.requirements, `https://www.lixiang.com/job/detail/${item.id}.html`));
      totalPages = Number(data.data.total_pages);
    } else if (type === 'xiaohongshu') {
      const data = await request('https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition', post({ recruitType: 'social', positionName: query, pageNum: current, pageSize: 10 }, { Origin: 'https://job.xiaohongshu.com', Referer: company.url }), timeoutSeconds);
      if (data.success !== true) throw new CommandExecutionError(`Xiaohongshu API: ${data.message ?? data.code}`);
      jobs = assertRows(data.data?.list, 'Xiaohongshu').map(item => mapJob(item.positionId, item.positionName, item.workplace, item.duty, item.qualification, `${company.url}/${item.positionId}`));
      totalPages = Number(data.data.totalPage);
    } else if (type === 'alibaba_talent') {
      const base = new URL(company.url).origin;
      const data = await request(`${base}/position/search?_csrf=${encodeURIComponent(session.csrf)}`, post({
        channel: 'group_official_site', language: 'zh', batchId: '', categories: '', deptCodes: [], key: query, pageIndex: current, pageSize: 10, regions: '', subCategories: '', shareCode: '', shareType: '', shareId: '', myReferralShareCode: '',
      }, { Cookie: session.cookie, Referer: company.url, Origin: base }), timeoutSeconds);
      if (data.success === false) throw new CommandExecutionError(`${company.id} API: ${data.message ?? 'search failed'}`);
      const content = data.content ?? data.data ?? data;
      jobs = assertRows(content.datas ?? content.list, company.id).map(item => {
        const id = item.id ?? item.positionId ?? item.positionIdStr;
        return mapJob(id, first(item.name, item.title), item.workLocations ?? item.workLocation ?? item.locations, first(item.description, item.workContent), first(item.requirement, item.serviceCondition), new URL(item.positionUrl || `/off-campus/position-detail?id=${id}`, base).href);
      });
      totalPages = Math.ceil(Number(content.totalCount ?? content.total) / Number(content.pageSize ?? 10));
    } else {
      const data = await request('https://careers.pddglobalhr.com/api/recruit/position/latest_list', post({}), timeoutSeconds);
      if (data.success === false) throw new CommandExecutionError(`PDD API: ${data.error_msg ?? 'request failed'}`);
      const recent = assertRows(data.result?.latestPositionList, 'PDD latest');
      const hot = assertRows(data.result?.hottestPositionList, 'PDD hot');
      jobs = [...recent, ...hot].filter(item => String(item.name ?? '').toLowerCase().includes(query.toLowerCase()))
        .map(item => mapJob(item.code, item.name, null, null, null, `https://careers.pddglobalhr.com/jobs/detail?code=${encodeURIComponent(item.code)}`));
      totalPages = 1;
    }
    if (!jobs.length) break;
    let fresh = 0;
    for (const job of jobs) {
      if (!seen.has(job.jobUrl)) { seen.add(job.jobUrl); collected.push(job); fresh++; }
    }
    if (!fresh && current > 1) throw new CommandExecutionError(`${company.id}: pagination repeated an earlier page`);
    if (Number.isFinite(totalPages) && current >= totalPages) break;
  }
  if (details) {
    for (const job of collected) {
      let detail;
      if (type === 'baidu') {
        const payload = await request(queryUrl('https://talent.baidu.com/httservice/getPostDetail', { postId: job.jobId, recruitType: 'SOCIAL' }), {}, timeoutSeconds);
        if (payload.status !== 'ok' || !payload.data) throw new CommandExecutionError('Baidu detail API failed');
        detail = payload.data;
        job.jobDescription = clean(detail.workContent); job.jobRequirements = clean(detail.serviceCondition);
      } else if (type === 'tencent') {
        const payload = await request(queryUrl('https://careers.tencent.com/tencentcareer/api/post/ByPostId', { postId: job.jobId, language: 'zh-cn', timestamp: Date.now() }), {}, timeoutSeconds);
        if (!payload.Data) throw new CommandExecutionError('Tencent detail API failed');
        job.jobDescription = clean(payload.Data.Responsibility); job.jobRequirements = clean(payload.Data.Requirement);
      } else if (type === 'liauto') {
        const payload = await request(queryUrl('https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/job/detail', { job_id: job.jobId }), {}, timeoutSeconds);
        if (payload.code !== 0 || !payload.data) throw new CommandExecutionError('Li Auto detail API failed');
        job.jobDescription = clean(payload.data.description); job.jobRequirements = clean(payload.data.requirements);
      } else if (type === 'alibaba_talent') {
        const base = new URL(company.url).origin;
        const payload = await request(`${base}/position/detail?_csrf=${encodeURIComponent(session.csrf)}`, post({ channel: company.id === 'eleme' ? 'ele_group_official_site' : 'cdc_group_official_site', language: 'zh', id: job.jobId }, { Cookie: session.cookie, Referer: company.url }), timeoutSeconds);
        detail = payload.content ?? payload.data;
        if (payload.success === false || !detail) throw new CommandExecutionError(`${company.id} detail API failed`);
        job.jobDescription = first(detail.description, detail.workContent); job.jobRequirements = first(detail.requirement, detail.serviceCondition);
      }
    }
  }
  return collected;
}
