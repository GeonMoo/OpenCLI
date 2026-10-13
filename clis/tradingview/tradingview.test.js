import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';
import { createPageMock } from '../test-utils.js';
import { command as calendar, extractCalendar, findCalendarDay, parseDate, selectCalendarDay, waitForCalendarDay } from './calendar.js';
import { command as ideas } from './ideas.js';
import { command as scripts, extractMarketplace } from './scripts.js';
import { command as news, extractNews } from './news.js';
import { extractCards, parseLimit } from './utils.js';

let dom;
function calendarPage(rows, date = parseDate()) {
    return createPageMock([String(new Date(`${date}T00:00:00`).getTime()), true, rows]);
}
function fixture(name) {
    const html = readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), 'utf8');
    dom = new JSDOM(html, { url: 'https://cn.tradingview.com/' });
    vi.stubGlobal('document', dom.window.document);
}
afterEach(() => {
    dom?.window.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('TradingView extractors against real page HTML', () => {
    it.each(['economic', 'earnings', 'dividend', 'ipo'])('%s retains dates and column order', kind => {
        fixture(kind);
        const rows = extractCalendar(kind);
        expect(rows).toHaveLength(2);
        expect(rows.map(row => row.rank)).toEqual([1, 2]);
        expect(rows.every(row => row.class === kind && row.title && row.symbol && row.dayStart)).toBe(true);
        expect(Object.keys(rows[0])).toEqual(calendar.columns);
        expect(rows[0].url).toMatch(/^https:\/\/cn\.tradingview\.com\/symbols\//);
        expect(rows[0].eventTime === null).toBe(['dividend', 'ipo'].includes(kind));
    });

    it('keeps percentage units and missing forecasts without coercing them to zero', () => {
        fixture('economic');
        expect(extractCalendar('economic')[0]).toMatchObject({
            symbol: 'ECONOMICS:TRRSMM',
            details: { actual: '1.4 %', forecast: null, previous: '0.2 %' },
        });
    });

    it('maps EPS and revenue separately, retaining currency', () => {
        fixture('earnings');
        expect(extractCalendar('earnings')[0]).toMatchObject({
            symbol: 'LSX:920332',
            details: { epsEstimate: '12.86 USD', epsActual: '17.01 USD', epsSurprise: '+32.22%' },
            eventTime: '2026-10-13T11:30:00.000Z',
        });
        expect(extractCalendar('earnings')[0].details.revenueActual).toContain('18.68 B');
    });

    it('retains dividend dates and the calendar timezone boundary', () => {
        fixture('dividend');
        expect(extractCalendar('dividend')[0]).toMatchObject({
            symbol: 'SSE:605090', dayStart: '2026-10-11T16:00:00.000Z',
            details: { amount: '0.03 USD', exDate: '2026年10月12日', yield: '1.48%' },
        });
        expect(extractCalendar('dividend')[1].details.paymentDate).toBe('2026年11月6日');
    });

    it('keeps an IPO price range and a missing market cap', () => {
        fixture('ipo');
        expect(extractCalendar('ipo')[1].details).toMatchObject({
            offerPrice: '0.80 - 0.86 USD', shares: '4,267,200', marketCap: null,
        });
    });

    it('inherits each new date marker and fails on missing metric columns', () => {
        fixture('dividend');
        const second = document.querySelectorAll('[data-name="dividends-calendar-item"]')[1];
        const marker = document.createElement('div');
        marker.className = 'scrollToLocator-test';
        marker.setAttribute('data-timestamp', String(Date.parse('2026-10-12T16:00:00Z')));
        second.before(marker);
        expect(extractCalendar('dividend')[1].dayStart).toBe('2026-10-12T16:00:00.000Z');
        second.querySelector('[class*="withValue-"]').remove();
        expect(() => extractCalendar('dividend')).toThrow('Unexpected dividend metric columns');
    });

    it('rejects missing and invalid date markers instead of returning undated events', () => {
        fixture('economic');
        const marker = document.querySelector('[data-timestamp]');
        marker.setAttribute('data-timestamp', '');
        expect(() => extractCalendar('economic')).toThrow('Invalid calendar date marker');
        marker.remove();
        expect(() => extractCalendar('economic')).toThrow('Calendar date marker is missing');
    });

    it.each(['economic', 'earnings', 'dividend', 'ipo'])('%s filters the selected day and resets ranks', kind => {
        fixture(kind);
        const prefix = kind === 'dividend' ? 'dividends' : kind;
        const root = document.querySelector(`[data-name="${prefix}-calendar"]`);
        const previousDay = extractCalendar(kind)[0].dayStart;
        const timestamp = Date.parse(previousDay) + 86400000;
        const marker = document.createElement('div');
        marker.className = 'scrollToLocator-test';
        marker.setAttribute('data-timestamp', String(timestamp));
        root.append(marker, root.querySelector(`[data-name="${prefix}-calendar-item"]`).cloneNode(true));
        const rows = extractCalendar(kind, new Date(timestamp).toISOString());
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, dayStart: new Date(timestamp).toISOString() });
        expect(extractCalendar(kind, previousDay)).toHaveLength(2);
    });

    it('matches local calendar dates across the UTC date boundary', () => {
        fixture('economic');
        expect(findCalendarDay('economic', '2026-10-12')).toBe('1791734400000');
        expect(findCalendarDay('economic', '2026-10-11')).toBeNull();
        expect(extractCalendar('economic', '2026-10-12T16:00:00.000Z')).toEqual([]);
    });

    it('uses displayed date labels when the calendar timezone differs from the browser', () => {
        fixture('dividend');
        const marker = document.querySelector('[data-timestamp]');
        marker.setAttribute('data-timestamp', String(Date.parse('2026-10-11T10:00:00Z')));
        expect(findCalendarDay('dividends', '2026-10-12')).toBe(String(Date.parse('2026-10-11T10:00:00Z')));
        expect(findCalendarDay('dividends', '2025-10-12')).toBeNull();
    });

    it('waits for a delayed target date marker before scrolling', async () => {
        fixture('economic');
        vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
        const marker = document.querySelector('[data-timestamp]');
        const firstRow = document.querySelector('[data-name="economic-calendar-item"]');
        marker.remove();
        const pending = findCalendarDay('economic', '2026-10-12', true);
        firstRow.before(marker);
        await expect(pending).resolves.toBe('1791734400000');
    });

    it('times out when the requested marker never appears', async () => {
        fixture('economic');
        vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
        vi.useFakeTimers();
        const pending = findCalendarDay('economic', '2026-10-14', true);
        const rejected = expect(pending).rejects.toThrow('Calendar date marker did not load');
        await vi.advanceTimersByTimeAsync(20000);
        await rejected;
    });

    it('ignores intraday scroll markers when inheriting the event day', () => {
        fixture('economic');
        const intraday = document.createElement('div');
        intraday.setAttribute('data-timestamp', '1791788400000');
        document.querySelector('[data-name="economic-calendar-item"]').before(intraday);
        expect(extractCalendar('economic')[0].dayStart).toBe('2026-10-11T16:00:00.000Z');
    });

    it.each(['economic', 'earnings', 'dividend', 'ipo'])('%s selects only the day marker when a timeline divider shares its timestamp', async kind => {
        fixture(kind);
        const prefix = kind === 'dividend' ? 'dividends' : kind;
        const marker = document.querySelector('[class*="scrollToLocator-"][data-timestamp]');
        const timestamp = marker.getAttribute('data-timestamp');
        const divider = document.createElement('div');
        divider.className = 'scrollToDivider-test timeline-divider';
        divider.setAttribute('data-timestamp', timestamp);
        marker.before(divider);
        const page = createPageMock([timestamp, true], {
            scrollTo: vi.fn(async selector => {
                const matches = [...document.querySelectorAll(selector)];
                expect(matches).toEqual([marker]);
            }),
        });
        await expect(selectCalendarDay(page, prefix, '2026-10-14')).resolves.toBe(new Date(Number(timestamp)).toISOString());
        expect(waitForCalendarDay(prefix, timestamp)).toBe(true);
    });

    it('waits for the selected day to render instead of treating unloaded rows as empty', async () => {
        fixture('economic');
        vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
        const root = document.querySelector('[data-name="economic-calendar"]');
        const rows = [...root.querySelectorAll('[data-name="economic-calendar-item"]')];
        rows.forEach(row => row.remove());
        const pending = waitForCalendarDay('economic', '1791734400000');
        root.append(rows[0]);
        await expect(pending).resolves.toBe(true);
    });

    it('recognizes an explicitly empty selected day without waiting for other dates', async () => {
        fixture('economic');
        const root = document.querySelector('[data-name="economic-calendar"]');
        root.querySelectorAll('[data-name="economic-calendar-item"]').forEach(row => row.remove());
        const empty = document.createElement('div');
        empty.className = 'emptyDayRow-test';
        root.append(empty);
        expect(await waitForCalendarDay('economic', '1791734400000')).toBe(true);
    });

    it.each(['ideas', 'scripts', 'editorpicks'])('%s reads titles, authors and ISO publication times', name => {
        fixture(name);
        const rows = extractCards(name === 'ideas' ? 'ideas' : 'scripts');
        expect(rows).toHaveLength(2);
        expect(Object.keys(rows[0])).toEqual(name === 'ideas' ? ideas.columns : scripts.columns);
        expect(rows.every(row => row.title && row.author && Number.isFinite(Date.parse(row.pubTime)))).toBe(true);
        expect(rows[0].url).toContain(name === 'ideas' ? '/chart/' : '/script/');
    });

    it('reads paid marketplace collections with monthly prices', () => {
        fixture('marketplace');
        const rows = extractMarketplace();
        expect(rows).toHaveLength(2);
        expect(Object.keys(rows[0])).toEqual(scripts.columns);
        expect(rows[0]).toMatchObject({
            title: 'SABANCI', author: 'ata_sabanci', price: '$11.00 / 月',
            pubTime: null, url: 'https://cn.tradingview.com/scripts/marketplace/ata_sabanci/',
        });
        expect(rows[1].url).toBe('https://cn.tradingview.com/scripts/marketplace/LonesomeTheBlue/');
    });

    it('uses the author URL instead of Chinese byline text and keeps engagement counts', () => {
        fixture('editorpicks');
        expect(extractCards('scripts')[0]).toMatchObject({ author: 'RedKTrader', comments: 4 });
        expect(extractCards('scripts')[0].likes).toBeGreaterThan(0);
        document.querySelector('[data-qa-id="ui-lib-card-comment-button"]').textContent = '0';
        expect(extractCards('scripts')[0].comments).toBe(0);
    });

    it('ignores unrelated articles and script cards on the ideas page', () => {
        fixture('editorpicks');
        expect(extractCards('ideas')).toEqual([]);
    });

    it('reads news title attributes without badge text and converts event-time to ISO', () => {
        fixture('news');
        const rows = extractNews();
        expect(rows).toHaveLength(2);
        expect(Object.keys(rows[0])).toEqual(news.columns);
        expect(rows[0].title).toBe(document.querySelector('[data-qa-id="news-headline-title"]').getAttribute('data-overflow-tooltip-text'));
        expect(rows[0].source).toBeTruthy();
        expect(rows[0].pubTime).toMatch(/^2026-10-13T\d{2}:\d{2}:\d{2}\.000Z$/);
        expect(rows[0].url).toMatch(/^https:\/\/cn\.tradingview\.com\/news\//);
    });
});

describe('TradingView commands', () => {
    it('registers script as an alias of scripts', () => {
        expect(getRegistry().get('tradingview/script')).toBe(scripts);
    });

    it.each([
        [calendar, 'economic', '/economic-calendar/'],
        [calendar, 'earnings', '/earnings-calendar/'],
        [calendar, 'dividend', '/dividend-calendar/'],
        [calendar, 'ipo', '/ipo-calendar/'],
        [scripts, 'all', '/scripts/'],
        [scripts, 'marketplace', '/scripts/marketplace/'],
        [scripts, 'editorpicks', '/scripts/editors-picks/'],
        [ideas, undefined, '/ideas/'],
        [news, undefined, '/news-flow/'],
    ])('routes $name class %s to %s and honors limit', async (command, kind, path) => {
        const row = { title: 'Example', url: 'https://cn.tradingview.com/chart/EXAMPLE/1/' };
        const page = command === calendar ? calendarPage([row, row]) : createPageMock([[row, row]]);
        expect(await command.func(page, { class: kind, limit: 1 })).toEqual([row]);
        expect(page.goto).toHaveBeenCalledWith(command === calendar
            ? `https://cn.tradingview.com${path}?timestamp=${new Date(`${parseDate()}T12:00:00`).getTime()}`
            : `https://cn.tradingview.com${path}`);
    });

    it.each([calendar, scripts])('rejects unknown classes before opening a browser', async command => {
        const page = createPageMock();
        await expect(command.func(page, { class: '__proto__' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it.each([calendar, news, ideas, scripts])('recovers from a rejected initial navigation for $name', async command => {
        const row = { title: 'Example', url: 'https://cn.tradingview.com/news/example/' };
        const page = command === calendar ? calendarPage([row]) : createPageMock([[row]]);
        page.goto.mockRejectedValueOnce(new Error('Navigation rejected.'));
        await expect(command.func(page, {})).resolves.toEqual([row]);
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto.mock.calls[0]).toEqual(page.goto.mock.calls[1]);
    });

    it('stops after one rejected-navigation retry', async () => {
        const page = createPageMock();
        const failure = new Error('Navigation rejected.');
        page.goto.mockRejectedValue(failure);
        await expect(calendar.func(page, {})).rejects.toBe(failure);
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('does not retry unrelated navigation errors', async () => {
        const page = createPageMock();
        const failure = new Error('Extension disconnected');
        page.goto.mockRejectedValue(failure);
        await expect(calendar.func(page, {})).rejects.toBe(failure);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.wait).not.toHaveBeenCalled();
    });

    it.each([0, -1, 101, 1.5, 'invalid', ''])('rejects invalid limit %s', value => {
        expect(() => parseLimit(value)).toThrow(ArgumentError);
    });

    it('reports an empty calendar with the empty-result error', async () => {
        await expect(calendar.func(calendarPage([]), { class: 'ipo' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('defaults to today in local time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 14, 0, 30));
        expect(parseDate()).toBe('2026-10-14');
        expect(parseDate('2024-02-29')).toBe('2024-02-29');
    });

    it.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-10-00', '2026/10/14', '2026-1-4', '', null, true])('rejects invalid date %s before opening the page', async date => {
        const page = createPageMock();
        await expect(calendar.func(page, { date })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('loads another week, scrolls to the chosen day and passes that day to the extractor before limiting', async () => {
        const date = '2026-11-02';
        const row = { title: 'Example', url: 'https://cn.tradingview.com/news/example/' };
        const page = calendarPage([row, row], date);
        const timestamp = new Date(`${date}T00:00:00`).getTime();
        expect(await calendar.func(page, { class: 'dividend', date, limit: 1 })).toEqual([row]);
        expect(page.goto).toHaveBeenCalledWith(`https://cn.tradingview.com/dividend-calendar/?timestamp=${new Date(`${date}T12:00:00`).getTime()}`);
        expect(page.scrollTo).toHaveBeenCalledWith(`[data-name="dividends-calendar"] [class*="scrollToLocator-"][data-timestamp="${timestamp}"]`);
        expect(page.evaluate).toHaveBeenLastCalledWith(extractCalendar, 'dividend', new Date(timestamp).toISOString());
    });

    it('rejects a missing target date instead of returning another day', async () => {
        await expect(calendar.func(createPageMock([null]), { date: '2026-10-14' })).rejects.toThrow('did not load calendar date 2026-10-14');
    });

    it('reports loading timeout separately from malformed data', async () => {
        const page = createPageMock();
        page.wait.mockRejectedValue(new Error('Selector not found: news-headline-card'));
        await expect(news.func(page, {})).rejects.toBeInstanceOf(TimeoutError);
        await expect(news.func(createPageMock([null]), {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('preserves browser disconnection failures', async () => {
        const page = createPageMock();
        const failure = new Error('extension disconnected');
        page.wait.mockRejectedValue(failure);
        await expect(news.func(page, {})).rejects.toBe(failure);
    });

    it('rejects missing titles, untrusted links and invalid times', async () => {
        for (const row of [
            { url: 'https://cn.tradingview.com/news/x/' },
            { title: 'Example', url: 'https://example.com/' },
            { title: 'Example', url: 'https://cn.tradingview.com/news/x/', pubTime: 'invalid' },
        ]) {
            await expect(news.func(createPageMock([[row]]), {})).rejects.toBeInstanceOf(CommandExecutionError);
        }
    });
});
