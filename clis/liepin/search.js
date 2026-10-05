import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

// Codes observed on the site's data-key="dq" filter controls.
const CITIES = {
    全国: '410', 北京: '010', 上海: '020', 天津: '030', 重庆: '040',
    广州: '050020', 深圳: '050090', 苏州: '060080', 南京: '060020', 杭州: '070020',
    大连: '210040', 成都: '280020', 武汉: '170020', 西安: '270020',
};

export function extractJobs() {
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const bodyText = text(document.body);
    const rows = [...document.querySelectorAll('.jobCardPcContainer, .job-card-pc-container')].map(card => {
        const anchor = card.querySelector('a[data-nick="job-detail-job-info"]');
        const heading = anchor?.querySelector('.jobTitleBox, [class*="job-title-box--"]');
        const requirements = [...(anchor?.children[1]?.children || [])].map(text);
        const recruiter = card.querySelector('.recruiterName, [class*="recruiter-name--"]');
        const active = text(recruiter?.nextElementSibling);
        const target = anchor?.getAttribute('href');
        const jobUrl = target ? new URL(target, location.href) : null;
        const identifier = jobUrl?.pathname.match(/^\/(?:job|a)\/(\d+)\.shtml$/)?.[1];
        return {
            name: text(heading?.querySelector('[title]')),
            salary: text(anchor?.firstElementChild?.lastElementChild),
            company: text(card.querySelector('.companyName, [class*="company-name--"]')),
            area: text(heading?.querySelector('span.ellipsis-1')),
            experience: requirements[0] || null,
            degree: requirements[1] || null,
            recruiter: text(recruiter) || null,
            recruiterActive: /在线|活跃/.test(active) ? active : null,
            jobId: identifier || null,
            url: identifier && jobUrl?.hostname === 'www.liepin.com'
                ? `https://www.liepin.com${jobUrl.pathname}` : null,
        };
    });
    const activePage = text(document.querySelector('.ant-pagination-item-active'));
    const firstSearchLink = document.querySelector('.jobCardPcContainer a[data-nick="job-detail-job-info"]');
    const loadedPage = firstSearchLink ? new URL(firstSearchLink.href, location.href).searchParams.get('curPage') : null;
    return {
        rows,
        pageNumber: activePage ? Number(activePage) : null,
        resultPage: loadedPage === null ? null : Number(loadedPage) + 1,
        hasNext: !!document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button:not([disabled])'),
        exhausted: /没有更多|暂无更多|已经到底|已加载全部|暂无.*职位/.test(text(document.querySelector('.job-list-bottom-text'))),
        empty: /暂时没有合适的职位/.test(text(document.querySelector('.ant-empty-description'))),
        needsAuth: /\/login|\/passport/.test(location.pathname)
            || (!document.querySelector('#lp-search-job-box') && /扫码登录|手机号登录/.test(bodyText)),
        blocked: /安全验证|访问过于频繁|滑动验证/.test(bodyText),
    };
}

async function waitForJobs(page, expectedPage = null, previousCount = 0) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const snapshot = await page.evaluate(extractJobs);
        if (snapshot.blocked) throw new CommandExecutionError('Liepin is showing a security verification or rate limit; resolve it in Chrome before retrying');
        if (snapshot.needsAuth) throw new AuthRequiredError('liepin.com', '请先在 Chrome 登录猎聘');
        if (snapshot.empty) throw new EmptyResultError('liepin search');
        const pageReady = expectedPage === null
            || ((snapshot.pageNumber ?? 1) === expectedPage && (snapshot.resultPage ?? 1) === expectedPage);
        if (pageReady && (snapshot.rows.length > previousCount || snapshot.exhausted)) {
            if (snapshot.rows.some(row => !row.name || !row.salary || !row.company || !row.area || !row.url)) {
                throw new CommandExecutionError('Liepin job cards are missing required fields; the page layout may have changed');
            }
            return snapshot;
        }
        // Sub-second wait is a fixed sleep; wait(1+) may return before the XHR finishes.
        await page.wait(0.5);
    }
    throw new TimeoutError('Liepin search results', 10);
}

cli({
    site: 'liepin',
    name: 'search',
    access: 'read',
    description: '猎聘搜索职位（不带关键词时返回为你推荐职位）',
    domain: 'www.liepin.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'query', positional: true, help: 'Search keyword (optional, empty = recommended jobs)' },
        { name: 'city', default: '全国', help: 'City name or code for keyword search (e.g. 上海, 020)' },
        { name: 'page', type: 'int', default: 1, help: 'Starting page number (default: 1)' },
        { name: 'limit', type: 'int', default: 40, help: 'Number of results; automatically loads more pages beyond 40' },
    ],
    columns: ['name', 'salary', 'company', 'area', 'experience', 'degree', 'recruiter', 'recruiterActive', 'jobId', 'url'],
    func: async (page, args) => {
        const limit = Number(args.limit ?? 40);
        const startPage = Number(args.page ?? 1);
        for (const [name, value] of [['limit', limit], ['page', startPage]]) {
            if (!Number.isSafeInteger(value) || value < 1) {
                throw new ArgumentError(`liepin ${name} must be a positive safe integer`);
            }
        }
        const city = String(args.city ?? '全国').trim();
        const cityCode = CITIES[city] ?? (/^\d{3}(?:\d{3})?$/.test(city) ? city : null);
        if (!cityCode) throw new ArgumentError(`Unknown Liepin city: ${city}`, 'Use a supported city name or a numeric Liepin city code');
        if (!page) throw new CommandExecutionError('Browser page required');
        const query = String(args.query ?? '').trim();
        if (!query && cityCode !== '410') {
            throw new ArgumentError('City filtering requires a search keyword; recommended jobs use your existing job preferences');
        }
        const params = new URLSearchParams({ key: query, dqs: cityCode });
        await page.goto(query ? `https://www.liepin.com/zhaopin/?${params}` : 'https://c.liepin.com/');
        let currentPage = 1;
        let snapshot = await waitForJobs(page, query ? currentPage : null);
        const jobs = new Map();
        const offset = query ? 0 : (startPage - 1) * 40;
        if (query) {
            while (currentPage < startPage) {
                if (!snapshot.hasNext) throw new EmptyResultError('liepin search', `Page ${startPage} does not exist`);
                await page.click('.ant-pagination-next button');
                snapshot = await waitForJobs(page, ++currentPage);
            }
        }
        let previousCount = 0;
        while (true) {
            // Recommendations append to the DOM; only collect the newly loaded cards.
            for (const row of snapshot.rows.slice(query ? 0 : previousCount)) {
                if (!jobs.has(row.url)) jobs.set(row.url, row);
            }
            if (jobs.size >= offset + limit) break;
            if (query) {
                if (!snapshot.hasNext) break;
                await page.click('.ant-pagination-next button');
                snapshot = await waitForJobs(page, ++currentPage);
            } else {
                if (snapshot.exhausted) break;
                previousCount = snapshot.rows.length;
                await page.scroll('down', 20000);
                snapshot = await waitForJobs(page, null, previousCount);
            }
        }
        const rows = [...jobs.values()].slice(offset, offset + limit);
        if (!rows.length) throw new EmptyResultError('liepin search', `No jobs on page ${startPage}`);
        return rows;
    },
});
