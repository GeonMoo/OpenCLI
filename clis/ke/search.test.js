import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { extractHouseDetail, extractSearchPage, parseListingDate } from './search.js';
import { gotoKe } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_FIXTURE = readFileSync(join(__dirname, '__fixtures__/search.html'), 'utf8');
const DETAIL_FIXTURE = readFileSync(join(__dirname, '__fixtures__/detail.html'), 'utf8');
const SEARCH_URL = 'https://sh.ke.com/ershoufang/jiadingqu/rs%E5%8D%8E%E6%B6%A6%E4%B8%AD%E5%A4%AE%E5%85%AC%E5%9B%AD%E4%B8%89%E6%9C%9F/';

function runExtractor(extractor, html, url) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(`(${extractor.toString()})()`);
}

function searchSnapshot({
    links,
    page = 1,
    totalPages = 1,
    template = '/ershoufang/jiadingqu/pg{page}rs华润中央公园三期',
}) {
    return {
        links,
        hasList: true,
        cardCount: links.length,
        emptyText: '',
        pageData: { totalPage: totalPages, curPage: page },
        pageTemplate: template,
        currentHref: SEARCH_URL,
    };
}

function detail(houseCode, overrides = {}) {
    return {
        houseCode,
        headingText: `房源 ${houseCode}`,
        communityText: '华润中央公园三期(浩翔路505弄)',
        layoutText: '2室2厅1卫',
        areaNumber: 91.29,
        floorText: '低楼层 (共21层)',
        directionText: '南',
        priceNumber: 429,
        unitPriceNumber: 46994,
        listedDate: '2026-04-10',
        attributeValues: { 挂牌时间: '2026年04月10日' },
        ...overrides,
    };
}

function listing(houseCode, overrides = {}) {
    return {
        houseCode,
        detailHref: `https://sh.ke.com/ershoufang/${houseCode}.html`,
        headingText: `房源 ${houseCode}`,
        communityText: '华润中央公园三期(浩翔路505弄)',
        layoutText: '2室2厅',
        areaNumber: 91.29,
        floorText: '低楼层 (共21层)',
        directionText: '南 北',
        priceNumber: 429,
        unitPriceNumber: 46994,
        publishedText: '5月前发布',
        attributeValues: {
            所在楼层: '低楼层 (共21层)',
            建成年代: '2014年',
            房屋户型: '2室2厅',
            建筑面积: '91.29平米',
            房屋朝向: '南 北',
        },
        ...overrides,
    };
}

function makePage({ searches = {}, details = {}, stateForUrl } = {}) {
    let currentUrl = '';
    const page = {
        goto: vi.fn(async (url) => { currentUrl = url; }),
        wait: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (source) => {
            if (source.includes('window.location.href')) {
                return stateForUrl?.(currentUrl) ?? { href: currentUrl, title: '贝壳找房', body_text: '' };
            }
            if (source.includes("document.querySelector('.sellListContent:not(.VIEWDATA)')")) {
                return searches[currentUrl];
            }
            if (source.includes("document.querySelectorAll('.introContent .base li")) {
                return details[currentUrl];
            }
            throw new Error(`Unexpected evaluate source: ${source.slice(0, 80)}`);
        }),
    };
    return page;
}

function command() {
    return getRegistry().get('ke/search');
}

describe('ke search DOM extractors against sanitized live fixtures', () => {
    it('extracts only the two real result cards and excludes the recommendation list', () => {
        const result = runExtractor(extractSearchPage, SEARCH_FIXTURE, SEARCH_URL);

        expect(result.hasList).toBe(true);
        expect(result.cardCount).toBe(2);
        expect(result.links).toHaveLength(2);
        expect(result.links[0]).toMatchObject({
            houseCode: '107115438394',
            headingText: '华润三期稀有户型，南北通两房，餐客厅分离，诚意出售',
            communityText: '华润中央公园三期(浩翔路505弄)',
            layoutText: '2室2厅',
            areaNumber: 91.29,
            floorText: '低楼层 (共21层)',
            directionText: '南',
            priceNumber: 429,
            unitPriceNumber: 46994,
            publishedText: '5月前发布',
        });
        expect(result.links[1]).toMatchObject({
            houseCode: '107116615522',
            layoutText: '3室2厅',
            areaNumber: 105.87,
            floorText: '高楼层 (共21层)',
            directionText: '南 北',
            priceNumber: 556,
            unitPriceNumber: 52518,
            publishedText: '11天前发布',
        });
        expect(result.links.map(item => item.houseCode)).not.toContain('107114957398');
        expect(result.links[0].attributeValues).toMatchObject({
            房源信息: expect.stringContaining('2室2厅 | 91.29平米'),
            关注信息: expect.stringContaining('5月前发布'),
        });
        expect(result.pageData).toEqual({ totalPage: 1, curPage: 1 });
        expect(result.pageTemplate).toContain('/ershoufang/jiadingqu/');
    });

    it('extracts exact price, area, listing date, and clean labelled property values', () => {
        const result = runExtractor(
            extractHouseDetail,
            DETAIL_FIXTURE,
            'https://sh.ke.com/ershoufang/107115438394.html?fb_expo_id=sample',
        );

        expect(result).toMatchObject({
            houseCode: '107115438394',
            communityText: '华润中央公园三期(浩翔路505弄)',
            areaNumber: 91.29,
            priceNumber: 429,
            unitPriceNumber: 46994,
            listedDate: '2026-04-10',
        });
        expect(result.attributeValues).toMatchObject({
            房屋户型: '2室2厅1卫',
            建筑面积: '91.29㎡',
            所在楼层: '低楼层 (共21层)',
            套内面积: null,
            挂牌时间: '2026年04月10日',
        });
        expect(result.attributeValues['所在楼层']).not.toContain('咨询');
        expect(JSON.stringify(result.attributeValues)).not.toContain('咨询套内面积');
    });

    it('reverse-validates that the recommendation-list selector cannot satisfy expected links', () => {
        function faultyExtractor() {
            return [...document.querySelectorAll('.sellListContent.VIEWDATA li.clear .title a')]
                .map(anchor => anchor.pathname.match(/^\/ershoufang\/(\d+)\.html$/)?.[1])
                .filter(Boolean);
        }

        const faultyLinks = runExtractor(faultyExtractor, SEARCH_FIXTURE, SEARCH_URL);
        expect(faultyLinks).toEqual(['107114957398']);
        expect(faultyLinks).not.toEqual(['107115438394', '107116615522']);
    });
});

describe('ke search relative publication dates', () => {
    const shanghaiReference = new Date('2026-10-03T16:30:00.000Z');

    it.each([
        ['5月前发布', '2026-05'],
        ['10个月前发布', '2025-12'],
        ['1年前发布', '2025'],
        ['11天前发布', '2026-09-23'],
        ['2周前发布', '2026-09-20'],
        ['今天发布', '2026-10-04'],
        ['昨天发布', '2026-10-03'],
        ['前天发布', '2026-10-02'],
        ['3小时前发布', '2026-10-03'],
        ['20分钟前发布', '2026-10-04'],
        ['刚刚发布', '2026-10-04'],
    ])('parses %s using an Asia/Shanghai calendar (%s)', (text, expected) => {
        expect(parseListingDate(text, shanghaiReference)).toBe(expected);
    });

    it('subtracts calendar months without overflowing from a 31st day', () => {
        expect(parseListingDate('1个月前发布', new Date('2026-03-31T04:00:00.000Z'))).toBe('2026-02');
    });

    it.each(['', '54人关注', '发布较早', null, undefined])('returns null for unknown text %#', (text) => {
        expect(parseListingDate(text, shanghaiReference)).toBeNull();
    });
});

describe('ke search command orchestration', () => {
    it('uses a foreground browser and defaults CAPTCHA waiting to 300 seconds', () => {
        expect(command().defaultWindowMode).toBe('foreground');
        expect(command().args.find(arg => arg.name === 'captcha-timeout')).toMatchObject({
            type: 'int',
            default: 300,
        });
        expect(command().args.find(arg => arg.name === 'detail')).toMatchObject({
            type: 'boolean',
            default: false,
        });
    });

    it('defaults to list-only collection across every page without visiting or evaluating details', async () => {
        const page2 = 'https://sh.ke.com/ershoufang/jiadingqu/pg2rs%E5%8D%8E%E6%B6%A6%E4%B8%AD%E5%A4%AE%E5%85%AC%E5%9B%AD%E4%B8%89%E6%9C%9F';
        const first = listing('107115438394');
        const second = listing('107116615522', {
            headingText: '三房房源', layoutText: '3室2厅', areaNumber: 105.87,
            priceNumber: 556, unitPriceNumber: 52518, publishedText: '11天前发布',
        });
        const third = listing('107117000001', { publishedText: '1年前发布' });
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({ links: [first, second], page: 1, totalPages: 2 }),
                [page2]: searchSnapshot({ links: [second, third], page: 2, totalPages: 2 }),
            },
            details: {
                [first.detailHref]: detail(first.houseCode),
                [second.detailHref]: detail(second.houseCode),
                [third.detailHref]: detail(third.houseCode),
            },
        });

        const rows = await command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        });

        expect(rows.map(row => row.id)).toEqual([first.houseCode, second.houseCode, third.houseCode]);
        expect(rows[1]).toMatchObject({
            title: '三房房源', layout: '3室2厅', area: 105.87,
            totalPrice: 556, unitPrice: 52518,
        });
        expect(JSON.parse(rows[0].propertyInfo)).toMatchObject({
            发布时间: '5月前发布',
            挂牌日期来源: '列表推算',
        });
        expect(JSON.parse(rows[0].propertyInfo).采集日期).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(page.goto.mock.calls.map(([url]) => url)).toEqual([SEARCH_URL, page2]);
        expect(page.evaluate.mock.calls.some(([source]) => source.includes("document.querySelectorAll('.introContent .base li")))
            .toBe(false);
    });

    it('keeps explicit detail false in list-only mode', async () => {
        const item = listing('107115438394');
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) },
            details: { [item.detailHref]: detail(item.houseCode) },
        });

        const rows = await command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: false,
        });

        expect(rows).toHaveLength(1);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith(SEARCH_URL, { settleMs: 2500 });
    });

    it('prefers the exact detail listing date over the relative list date', async () => {
        const item = listing('107115438394', { publishedText: '5月前发布' });
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) },
            details: { [item.detailHref]: detail(item.houseCode, { listedDate: '2026-04-10' }) },
        });

        const [row] = await command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
        });

        expect(row.listingDate).toBe('2026-04-10');
        expect(JSON.parse(row.propertyInfo)).toMatchObject({
            发布时间: '5月前发布',
            挂牌日期来源: '详情页',
        });
    });

    it('falls back to each list publication date when paginated details omit exact dates', async () => {
        const page2 = 'https://sh.ke.com/ershoufang/jiadingqu/pg2rs%E5%8D%8E%E6%B6%A6%E4%B8%AD%E5%A4%AE%E5%85%AC%E5%9B%AD%E4%B8%89%E6%9C%9F';
        const first = listing('107115438394', { publishedText: '5月前发布' });
        const second = listing('107116615522', { publishedText: '11天前发布' });
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({ links: [first], page: 1, totalPages: 2 }),
                [page2]: searchSnapshot({ links: [second], page: 2, totalPages: 2 }),
            },
            details: {
                [first.detailHref]: detail(first.houseCode, { listedDate: null }),
                [second.detailHref]: detail(second.houseCode, { listedDate: null }),
            },
        });

        const rows = await command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
        });

        expect(rows[0].listingDate).toMatch(/^\d{4}-\d{2}$/);
        expect(rows[1].listingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(rows.map(row => JSON.parse(row.propertyInfo).挂牌日期来源))
            .toEqual(['列表推算', '列表推算']);
    });

    it('fails list-only collection when a publication date cannot be inferred', async () => {
        const item = listing('107115438394', { publishedText: '发布较早' });
        const page = makePage({ searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) } });

        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('visits every page and each deduplicated detail exactly once when detail mode is enabled', async () => {
        const page2 = 'https://sh.ke.com/ershoufang/jiadingqu/pg2rs%E5%8D%8E%E6%B6%A6%E4%B8%AD%E5%A4%AE%E5%85%AC%E5%9B%AD%E4%B8%89%E6%9C%9F';
        const first = listing('107115438394');
        const second = listing('107116615522');
        const third = listing('107117000001');
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({ links: [first, second], page: 1, totalPages: 2 }),
                [page2]: searchSnapshot({ links: [second, third], page: 2, totalPages: 2 }),
            },
            details: {
                [first.detailHref]: detail(first.houseCode),
                [second.detailHref]: detail(second.houseCode),
                [third.detailHref]: detail(third.houseCode),
            },
        });

        const rows = await command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
        });

        expect(rows.map(row => row.id)).toEqual([first.houseCode, second.houseCode, third.houseCode]);
        expect(rows[0]).toMatchObject({
            area: 91.29,
            totalPrice: 429,
            unitPrice: 46994,
            listingDate: '2026-04-10',
        });
        expect(Object.keys(rows[0])).toEqual(command().columns);
        expect(page.goto.mock.calls.map(([url]) => url)).toEqual([
            SEARCH_URL,
            page2,
            first.detailHref,
            second.detailHref,
            third.detailHref,
        ]);
    });

    it('stops search and detail collection after limit 1', async () => {
        const first = listing('107115438394');
        const second = listing('107116615522');
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [first, second], totalPages: 3 }) },
            details: { [first.detailHref]: detail(first.houseCode) },
        });

        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', limit: 1, detail: true,
        })).resolves.toHaveLength(1);
        expect(page.goto.mock.calls.map(([url]) => url)).toEqual([SEARCH_URL, first.detailHref]);
    });

    it('waits for CAPTCHA completion on the search page without navigating again', async () => {
        const item = listing('107115438394');
        let searchStateReads = 0;
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) },
            details: { [item.detailHref]: detail(item.houseCode) },
            stateForUrl: (url) => {
                if (url === SEARCH_URL && searchStateReads++ === 0) {
                    return {
                        href: 'https://hip.ke.com/captcha?redirect=search',
                        title: '访问验证',
                        body_text: '请拖动下方滑块完成验证',
                    };
                }
                return { href: url, title: '贝壳找房', body_text: '二手房搜索结果' };
            },
        });

        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(command().func(page, {
                query: '华润中央公园三期', city: 'sh', district: 'jiading',
            })).resolves.toHaveLength(1);
        } finally {
            stderr.mockRestore();
        }
        expect(page.goto.mock.calls.filter(([url]) => url === SEARCH_URL)).toHaveLength(1);
    });

    it('resumes an interrupted second detail and preserves the first collected row', async () => {
        const first = listing('107115438394');
        const second = listing('107116615522');
        let secondDetailReads = 0;
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [first, second] }) },
            details: {
                [first.detailHref]: detail(first.houseCode),
                [second.detailHref]: detail(second.houseCode),
            },
            stateForUrl: (url) => {
                if (url === second.detailHref && secondDetailReads++ === 0) {
                    return {
                        href: 'https://hip.ke.com/captcha?redirect=detail',
                        title: '安全验证',
                        body_text: '请按住滑块',
                    };
                }
                return { href: url, title: '贝壳找房', body_text: '房源详情' };
            },
        });

        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        let rows;
        try {
            rows = await command().func(page, {
                query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
            });
        } finally {
            stderr.mockRestore();
        }
        expect(rows.map(row => row.id)).toEqual([first.houseCode, second.houseCode]);
        expect(page.goto.mock.calls.filter(([url]) => url === second.detailHref)).toHaveLength(1);
    });

    it.each([
        [{ query: '   ', city: 'sh' }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh!' }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh', district: '../jiading' }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh', limit: 0 }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh', limit: 1.5 }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh', 'captcha-timeout': -1 }, 'ARGUMENT'],
        [{ query: '房源', city: 'sh', 'captcha-timeout': 1.5 }, 'ARGUMENT'],
    ])('rejects invalid arguments %#', async (args, code) => {
        await expect(command().func(makePage(), args)).rejects.toMatchObject({ code });
    });

    it('rejects mismatched pagination metadata', async () => {
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({ links: [listing('107115438394')], page: 2, totalPages: 2 }),
            },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('rejects a page that ignored the requested district', async () => {
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({
                    links: [listing('107115438394')],
                    template: '/ershoufang/pg{page}rs华润中央公园三期',
                }),
            },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('rejects a page whose pagination template ignored the requested keyword', async () => {
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({
                    links: [listing('107115438394')],
                    template: '/ershoufang/jiadingqu/pg{page}',
                }),
            },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('accepts an encoded keyword in the pagination template', async () => {
        const item = listing('107115438394');
        const page = makePage({
            searches: {
                [SEARCH_URL]: searchSnapshot({
                    links: [item],
                    template: '/ershoufang/jiadingqu/pg{page}rs%E5%8D%8E%E6%B6%A6%E4%B8%AD%E5%A4%AE%E5%85%AC%E5%9B%AD%E4%B8%89%E6%9C%9F',
                }),
            },
            details: { [item.detailHref]: detail(item.houseCode) },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).resolves.toHaveLength(1);
    });

    it('fails detail collection when both the exact and relative listing dates are unavailable', async () => {
        const item = listing('107115438394', { publishedText: '发布较早' });
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) },
            details: { [item.detailHref]: detail(item.houseCode, { listedDate: null }) },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('rejects a detail whose house code does not match the requested listing', async () => {
        const item = listing('107115438394');
        const page = makePage({
            searches: { [SEARCH_URL]: searchSnapshot({ links: [item] }) },
            details: { [item.detailHref]: detail('107116615522') },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', detail: true,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('propagates captcha detection from gotoKe', async () => {
        const page = makePage({
            stateForUrl: () => ({
                href: 'https://hip.ke.com/captcha?redirect=search',
                title: '访问验证',
                body_text: '请拖动下方滑块完成验证',
            }),
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading', 'captcha-timeout': 0,
        })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it.each([
        'https://clogin.ke.com/login?service=search',
        'https://sh.ke.com/login?redirect=%2Fershoufang%2F',
    ])('propagates login redirect detection from gotoKe (%s)', async (href) => {
        const page = makePage({
            stateForUrl: () => ({ href, title: '贝壳找房', body_text: '' }),
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it('reports an explicit empty result page as empty', async () => {
        const page = makePage({
            searches: {
                [SEARCH_URL]: {
                    links: [], hasList: false, cardCount: 0, emptyText: '抱歉，没有找到相关房源',
                    pageData: null, pageTemplate: null, currentHref: SEARCH_URL,
                },
            },
        });
        await expect(command().func(page, {
            query: '华润中央公园三期', city: 'sh', district: 'jiading',
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
});

describe('ke gotoKe CAPTCHA recovery', () => {
    const targetUrl = 'https://sh.ke.com/ershoufang/107115438394.html';
    const captchaState = {
        href: 'https://hip.ke.com/captcha?redirect=detail',
        title: '安全验证',
        body_text: '请拖动下方滑块完成验证',
    };
    const targetState = {
        href: targetUrl,
        title: '华润中央公园三期二手房',
        body_text: '华润三期稀有户型',
    };

    function pageWithStates(states, onSleep = () => {}) {
        let index = 0;
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            sleep: vi.fn(async seconds => onSleep(seconds)),
            evaluate: vi.fn(async () => states[Math.min(index++, states.length - 1)]),
        };
    }

    it('polls repeated CAPTCHA states without refreshing the unresolved challenge', async () => {
        const page = pageWithStates([captchaState, captchaState, targetState]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(gotoKe(page, targetUrl, { captchaTimeout: 10 })).resolves.toEqual(targetState);
        } finally {
            stderr.mockRestore();
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith(targetUrl, { settleMs: 2500 });
        expect(page.sleep).toHaveBeenCalledTimes(2);
    });

    it('reopens the target once after the challenge reports verified success', async () => {
        const verifiedChallenge = {
            ...captchaState,
            body_text: '验证成功，正在跳转',
        };
        const page = pageWithStates([captchaState, verifiedChallenge, targetState]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(gotoKe(page, targetUrl, { captchaTimeout: 10 })).resolves.toEqual(targetState);
        } finally {
            stderr.mockRestore();
        }
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto).toHaveBeenNthCalledWith(2, targetUrl, { settleMs: 2500 });
    });

    it('does not confuse instructions mentioning verification success with completion', async () => {
        const page = pageWithStates([
            { ...captchaState, body_text: '验证成功后可继续浏览，请拖动下方滑块完成验证' },
            captchaState,
            targetState,
        ]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(gotoKe(page, targetUrl, { captchaTimeout: 10 })).resolves.toEqual(targetState);
        } finally {
            stderr.mockRestore();
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting through a blank transient target before returning loaded content', async () => {
        const blankTarget = { href: targetUrl, title: '', body_text: '' };
        const page = pageWithStates([captchaState, blankTarget, targetState]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(gotoKe(page, targetUrl, { captchaTimeout: 10 })).resolves.toEqual(targetState);
        } finally {
            stderr.mockRestore();
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.sleep).toHaveBeenCalledTimes(2);
    });

    it('times out with a typed error while page.sleep advances the mocked clock', async () => {
        let now = 0;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
        const page = pageWithStates([captchaState], seconds => { now += seconds * 1000; });
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(gotoKe(page, targetUrl, { captchaTimeout: 3 }))
                .rejects.toMatchObject({ code: 'TIMEOUT' });
        } finally {
            stderr.mockRestore();
            nowSpy.mockRestore();
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.sleep).toHaveBeenNthCalledWith(1, 2);
        expect(page.sleep).toHaveBeenNthCalledWith(2, 1);
    });

    it('fails a login redirect immediately even when its body mentions CAPTCHA', async () => {
        const page = pageWithStates([{
            href: 'https://clogin.ke.com/login?service=detail',
            title: '登录贝壳找房',
            body_text: '登录后继续，验证码登录',
        }]);
        await expect(gotoKe(page, targetUrl, { captchaTimeout: 300 }))
            .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(page.sleep).not.toHaveBeenCalled();
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid CAPTCHA wait time %s', async (captchaTimeout) => {
        const page = pageWithStates([targetState]);
        await expect(gotoKe(page, targetUrl, { captchaTimeout }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });
});
