import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@geonmoo/opencli/registry';
import { readSearchOptions, shiftDate } from './search-options.js';
import './search.js';
import './news.js';

const search = getRegistry().get('google/search');
const news = getRegistry().get('google/news');

afterEach(() => vi.unstubAllGlobals());

it('validates dates, order and limits, and treats None as today by default', () => {
    const now = new Date(2026, 10, 21, 17);
    const today = readSearchOptions({ limit: 'None' }, now);
    expect(today).toMatchObject({ limit: Infinity, firstDay: '2026-11-21', lastDay: '2026-11-21' });
    expect(readSearchOptions({ 'date-after': '2024-02-28', 'date-before': '2024-03-02', limit: '1000' }))
        .toMatchObject({ limit: 1000, firstDay: '2024-02-29', lastDay: '2024-03-01' });
    for (const args of [
        { 'date-before': '2025-02-29' },
        { 'date-between': ['2026-01-03', '2026-01-01'] },
        { 'date-between': ['2026-01-03'] },
        { 'date-between': ['2026-01-03', '2026-01-03'], 'date-before': '2026-01-04' },
        { limit: '0' },
        { order: ['time', 'forward'] },
    ]) expect(() => readSearchOptions(args)).toThrow();
});

it('reads 1000 unique web rows using Google next links and stops at the requested limit', async () => {
    let offset;
    const page = {
        goto: vi.fn(async url => { offset = Number(new URL(url).searchParams.get('start')); }),
        wait: vi.fn(),
        evaluate: vi.fn(async () => ({
            items: Array.from({ length: 101 }, (_, index) => {
                const id = offset + index;
                return { kind: 'result', heading: String(id), href: `https://example.com/${id}`, excerpt: '' };
            }),
            next: `/search?start=${offset + 100}`,
        })),
    };
    const rows = await search.func(page, { keyword: 'test', lang: 'en', limit: '1000' });
    expect(rows).toHaveLength(1000);
    expect(rows.at(-1).url).toBe('https://example.com/999');
    expect(page.goto).toHaveBeenCalledTimes(10);
});

it('keeps the date filter and retries Google web navigation after the browser rejects it', async () => {
    const page = {
        goto: vi.fn().mockRejectedValueOnce(new Error('Navigation rejected.')).mockResolvedValue(undefined),
        closeWindow: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn(),
        evaluate: vi.fn().mockResolvedValue({
            items: [{ kind: 'result', heading: 'Anthropic IPO', href: 'https://example.com/ipo', excerpt: '', displayDate: '9 Nov 2026' }],
        }),
    };
    const rows = await search.func(page, { keyword: 'anthropic ipo', lang: 'en', 'date-before': '2026-11-10', order: ['relevance', 'desc'] });
    expect(rows).toHaveLength(1);
    expect(page.closeWindow).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(2);
    const [[first], [retry]] = page.goto.mock.calls;
    expect(retry).toBe(first);
    expect(new URL(retry).searchParams.get('q')).toBe('anthropic ipo before:2026-11-09');
});

it.each([
    [['time', 'asc'], ['Older', 'Newer', 'Undated']],
    [['time', 'desc'], ['Newer', 'Older', 'Undated']],
    [['relevance', 'asc'], ['Older', 'Undated', 'Newer']],
])('extracts, filters and sorts visible result dates with %j', async (order, expected) => {
    const pages = [
        `<div class="tF2Cxc"><a href="https://example.com/new"><h3>Newer</h3></a><span class="YrbPuc"><span>2 Jan 2025</span> — </span></div>
         <a href="https://example.com/undated"><h3>Undated</h3></a>
         <div class="tF2Cxc"><a href="https://example.com/outside"><h3>Outside</h3></a><time datetime="2025-01-04T12:00:00Z"></time></div>`,
        '<div class="tF2Cxc"><a href="https://example.com/old"><h3>Older</h3></a><time datetime="2025-01-01T12:00:00Z"></time></div>',
    ];
    let dom;
    const page = {
        goto: vi.fn(async url => {
            const second = new URL(url).searchParams.has('start');
            const next = second ? '' : '<a id="pnnext" href="/search?start=10">Next</a>';
            dom = new JSDOM(`<div id="rso">${pages[Number(second)]}</div>${next}`, { url, runScripts: 'outside-only' });
        }),
        wait: vi.fn(),
        evaluate: async script => {
            const result = dom.window.eval(script);
            dom.window.close();
            return result;
        },
    };
    const rows = await search.func(page, { keyword: 'test', lang: 'en', limit: 'None', 'date-between': ['2025-01-01', '2025-01-02'], order });
    expect(rows.map(row => row.title)).toEqual(expected);
    expect(rows.find(row => row.title === 'Undated').date).toBeNull();
    expect(new URL(page.goto.mock.calls[0][0]).searchParams.get('tbs')).toBe('cdr:1,cd_min:1/1/2025,cd_max:1/2/2025');
});

it('splits saturated RSS ranges and deduplicates across them before sorting and limiting', async () => {
    const articles = Array.from({ length: 12 }, (_, day) => shiftDate('2025-05-01', day))
        .flatMap(day => Array.from({ length: 90 }, (_, index) => {
            const time = new Date(Date.parse(`${day}T17:00:00Z`) + index * 1000).toUTCString();
            const link = `https://example.com/${day}/${index}`;
            return { day, xml: `<item><title>Title</title><link>${link}</link><pubDate>${time}</pubDate><source>Source</source></item>` };
        }));
    const fetch = vi.fn(async url => {
        const query = url.searchParams.get('q');
        const first = query.match(/after:([\d-]+)/)?.[1];
        const until = query.match(/before:([\d-]+)/)?.[1];
        const items = articles.filter(({ day }) => (!first || day >= first) && (!until || day < until));
        return new Response(`<rss><channel>${items.slice(0, 100).map(item => item.xml).join('')}</channel></rss>`);
    });
    vi.stubGlobal('fetch', fetch);
    const args = { keyword: 'test', lang: 'en', region: 'US', 'date-between': ['2025-05-01', '2025-05-13'] };
    const rows = await news.func({ ...args, limit: 1000, order: ['time', 'desc'] });
    expect(rows).toHaveLength(1000);
    expect(new Set(rows.map(row => row.url)).size).toBe(1000);
    expect(rows.every((row, i) => i === 0 || Date.parse(rows[i - 1].date) >= Date.parse(row.date))).toBe(true);
    expect(fetch.mock.calls.length).toBeGreaterThan(2);
    await expect(news.func({ ...args, limit: 'None' })).resolves.toHaveLength(1080);
});

it('sorts an undated 20-result request without making a second, rate-limited RSS request', async () => {
    const items = Array.from({ length: 100 }, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index)).toUTCString();
        return `<item><title>Article ${index}</title><link>https://example.com/${index}</link><pubDate>${date}</pubDate></item>`;
    });
    const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(`<rss><channel>${items.join('')}</channel></rss>`))
        .mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const rows = await news.func({ keyword: 'anthropic', lang: 'en', region: 'US', limit: 20, order: ['time', 'desc'] });
    expect(rows.map(row => row.title)).toEqual(Array.from({ length: 20 }, (_, index) => `Article ${99 - index}`));
    expect(fetch).toHaveBeenCalledTimes(1);
});

it('excludes RSS items at and after the local date-before cutoff', async () => {
    const cutoff = new Date('2026-11-18T00:00:00').getTime();
    const items = [-1000, 0, 1000].map(offset => {
        const date = new Date(cutoff + offset).toUTCString();
        return `<item><title>Article</title><link>https://example.com/${offset}</link><pubDate>${date}</pubDate></item>`;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<rss><channel>${items.join('')}</channel></rss>`)));
    const rows = await news.func({ keyword: 'anthropic', lang: 'en', region: 'US', 'date-before': '2026-11-18' });
    expect(rows.map(row => row.url)).toEqual(['https://example.com/-1000']);
});
