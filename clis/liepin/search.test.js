import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';
import { extractJobs } from './search.js';

const fixture = readFileSync(new URL('./__fixtures__/search.html', import.meta.url), 'utf8');
const recommendationFixture = readFileSync(new URL('./__fixtures__/recommend.html', import.meta.url), 'utf8');
const command = getRegistry().get('liepin/search');
afterEach(() => vi.unstubAllGlobals());

function load(html = fixture, url = 'https://www.liepin.com/zhaopin/?key=Python&dqs=020') {
    const dom = new JSDOM(html, { url });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);
    return dom;
}

function pageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async fn => fn()),
        click: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

function row(id) {
    return {
        name: `Job ${id}`, salary: '20-30k', company: `Company ${id}`, area: '上海',
        experience: '3-5年', degree: '本科', recruiter: null, recruiterActive: null,
        jobId: String(id), url: `https://www.liepin.com/job/${id}.shtml`,
    };
}

function snapshot(rows, overrides = {}) {
    return {
        rows, empty: false, needsAuth: false, blocked: false,
        pageNumber: 1, resultPage: 1, hasNext: false, exhausted: false,
        ...overrides,
    };
}

function snapshotPage(...snapshots) {
    const page = pageMock();
    let index = 0;
    page.evaluate = vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)]);
    return page;
}

describe('liepin search', () => {
    it('extracts actual job-card markup without confusing the urgent badge with salary', async () => {
        load();
        expect(command).toMatchObject({ access: 'read', strategy: Strategy.UI, browser: true });
        const page = pageMock();
        const rows = await command.func(page, { query: 'Python', city: '上海', limit: 4 });
        expect(rows).toHaveLength(4);
        expect(Object.keys(rows[0])).toEqual(command.columns);
        expect(rows[0]).toEqual({
            name: '内地高级数据工程师', salary: '20-25k·13薪',
            company: '新鸿基企业管理(上海)有限公司', area: '上海',
            experience: '3-5年', degree: '本科', recruiter: '李女士',
            recruiterActive: '4小时前在线', jobId: '1983933935',
            url: 'https://www.liepin.com/job/1983933935.shtml',
        });
        expect(rows[2].recruiterActive).toBeNull();
        expect(rows[3]).toMatchObject({
            name: 'Python开发工程师', salary: '30-60k·15薪',
            experience: '经验不限', degree: '统招本科',
            jobId: '78143649', url: 'https://www.liepin.com/a/78143649.shtml',
        });
        const url = new URL(page.goto.mock.calls[0][0]);
        expect(url.searchParams.get('key')).toBe('Python');
        expect(url.searchParams.get('dqs')).toBe('020');
    });

    it('extracts the frozen personal-recommendation card markup', () => {
        load(recommendationFixture, 'https://c.liepin.com/');
        const result = extractJobs();
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toEqual({
            name: '储能数据特征开发', salary: '25-50k', company: '某上海大型新能源公司', area: '上海',
            experience: '3-5年', degree: '统招本科', recruiter: '郭女士·猎头顾问',
            recruiterActive: '5天前在线', jobId: '78397279', url: 'https://www.liepin.com/a/78397279.shtml',
        });
    });

    it('validates arguments before navigation and deduplicates canonical URLs', async () => {
        const dom = load();
        const page = pageMock();
        for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid']) {
            await expect(command.func(page, { query: 'Python', limit })).rejects.toThrow(ArgumentError);
        }
        for (const pageNumber of [0, -1, 1.5, 'invalid']) {
            await expect(command.func(page, { query: 'Python', page: pageNumber })).rejects.toThrow(ArgumentError);
        }
        await expect(command.func(page, { query: 'Python', city: '不存在的城市' })).rejects.toThrow(ArgumentError);
        await expect(command.func(page, { city: '上海' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        dom.window.document.body.append(dom.window.document.querySelector('.jobCardPcContainer').cloneNode(true));
        expect(await command.func(page, { query: 'Python', limit: 40, city: '020' })).toHaveLength(4);
        expect(await command.func(page, { query: 'Python', limit: 1 })).toHaveLength(1);
        expect(command.args.find(arg => arg.name === 'page')).toMatchObject({ default: 1 });
        expect(command.args.find(arg => arg.name === 'limit')).toMatchObject({ default: 40 });
    });

    it('distinguishes empty results, login walls, security checks and render timeouts', async () => {
        load('<div class="ant-empty-description">非常抱歉！暂时没有合适的职位</div>');
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(EmptyResultError);
        load('扫码登录', 'https://www.liepin.com/login');
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(AuthRequiredError);
        load('安全验证');
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(CommandExecutionError);
        load('');
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(TimeoutError);
    });

    it('fails on missing core fields and external job links instead of exporting incomplete rows', async () => {
        load();
        document.querySelector('.companyName').remove();
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(CommandExecutionError);
        load();
        document.querySelector('[data-nick="job-detail-job-info"]').href = 'https://example.com/a/123.shtml';
        await expect(command.func(pageMock(), { query: 'Python' })).rejects.toThrow(CommandExecutionError);
        expect(extractJobs().rows[0].url).toBeNull();
    });

    it('opens personal recommendations without a query and uses page 1 / limit 40 defaults', async () => {
        const rows = Array.from({ length: 40 }, (_, index) => row(index + 1));
        const page = snapshotPage(snapshot(rows, { exhausted: true }));
        expect(await command.func(page, {})).toEqual(rows);
        expect(page.goto).toHaveBeenCalledWith('https://c.liepin.com/');
    });

    it('clicks the next search-page control and ignores stale result-page snapshots', async () => {
        const first = Array.from({ length: 40 }, (_, index) => row(index + 1));
        const second = Array.from({ length: 40 }, (_, index) => row(index + 41));
        const page = snapshotPage(
            snapshot(first, { hasNext: true }),
            snapshot(first, { pageNumber: 2, resultPage: 1, hasNext: true }),
            snapshot(second, { pageNumber: 2, resultPage: 2, hasNext: true }),
        );
        expect(await command.func(page, { query: 'Python', page: 2, limit: 5 })).toEqual(second.slice(0, 5));
        expect(page.click).toHaveBeenCalledWith(expect.stringMatching(/next/i));
    });

    it('collects multiple keyword pages and deduplicates canonical URLs', async () => {
        const first = Array.from({ length: 40 }, (_, index) => row(index + 1));
        const second = [row(40), ...Array.from({ length: 39 }, (_, index) => row(index + 41))];
        const page = snapshotPage(
            snapshot(first, { hasNext: true }),
            snapshot(second, { pageNumber: 2, resultPage: 2, hasNext: true }),
        );
        const rows = await command.func(page, { query: 'Python', limit: 50 });
        expect(rows).toHaveLength(50);
        expect(new Set(rows.map(item => item.url)).size).toBe(50);
        expect(page.click).toHaveBeenCalledTimes(1);
    });

    it('scrolls the cumulative recommendation feed and applies page after deduplication', async () => {
        const first = Array.from({ length: 40 }, (_, index) => row(index + 1));
        const loaded = Array.from({ length: 80 }, (_, index) => row(index + 1));
        const page = snapshotPage(snapshot(first), snapshot(loaded));
        expect(await command.func(page, { limit: 50 })).toEqual(loaded.slice(0, 50));
        expect(page.scroll).toHaveBeenCalled();

        const page2 = snapshotPage(snapshot(first), snapshot(loaded));
        expect(await command.func(page2, { page: 2, limit: 5 })).toEqual(loaded.slice(40, 45));
    });

    it('returns an explicitly exhausted partial feed but times out when loading cannot advance', async () => {
        const partial = Array.from({ length: 25 }, (_, index) => row(index + 1));
        expect(await command.func(snapshotPage(snapshot(partial, { exhausted: true })), { limit: 50 })).toEqual(partial);

        const stalled = Array.from({ length: 40 }, (_, index) => row(index + 1));
        await expect(command.func(snapshotPage(snapshot(stalled)), { limit: 50 })).rejects.toThrow(TimeoutError);
    });
});
