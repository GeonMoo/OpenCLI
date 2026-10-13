import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';
import { classPath, limitArg, parseLimit, readRows } from './utils.js';

const paths = {
    economic: '/economic-calendar/',
    earnings: '/earnings-calendar/',
    dividend: '/dividend-calendar/',
    ipo: '/ipo-calendar/',
};

export function parseDate(value) {
    if (value === undefined) {
        const today = new Date();
        value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new ArgumentError('--date must be a real calendar date in YYYY-MM-DD format');
    }
    return value;
}

export function findCalendarDay(prefix, date, wait = false) {
    const [, month, day] = date.split('-').map(Number);
    const utcDay = Date.parse(`${date}T00:00:00Z`);
    const find = () => {
        const root = document.querySelector(`[data-name="${prefix}-calendar"]`);
        const timezone = root?.querySelector('time-format[time-zone]')?.getAttribute('time-zone')
            || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const format = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
        const marker = [...(root?.querySelectorAll('[class*="scrollToLocator-"][data-timestamp]') || [])]
            .find(element => {
                const timestamp = Number(element.getAttribute('data-timestamp'));
                const label = element.nextElementSibling?.textContent.match(/(\d+)月(\d+)日/);
                if (label) return Number(label[1]) === month && Number(label[2]) === day && Math.abs(timestamp - utcDay) < 86400000;
                return format.format(new Date(timestamp)) === date;
            });
        return marker?.getAttribute('data-timestamp') || null;
    };
    const timestamp = find();
    if (timestamp || !wait) return timestamp;
    return new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => {
            const timestamp = find();
            if (timestamp) {
                clearTimeout(timer);
                observer.disconnect();
                resolve(timestamp);
            }
        });
        const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Calendar date marker did not load'));
        }, 20000);
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

export function waitForCalendarDay(prefix, timestamp) {
    const root = document.querySelector(`[data-name="${prefix}-calendar"]`);
    const ready = () => {
        let sibling = root?.querySelector(`[class*="scrollToLocator-"][data-timestamp="${timestamp}"]`)?.nextElementSibling;
        const content = `[data-name="${prefix}-calendar-item"], [class*="emptyDayRow-"]`;
        while (sibling && !sibling.matches('[class*="scrollToLocator-"][data-timestamp]')) {
            if (sibling.matches(content) || sibling.querySelector(content)) return true;
            sibling = sibling.nextElementSibling;
        }
        return false;
    };
    if (ready()) return true;
    return new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => {
            if (ready()) {
                clearTimeout(timer);
                observer.disconnect();
                resolve(true);
            }
        });
        const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Selected calendar day did not load'));
        }, 20000);
        observer.observe(root, { childList: true, subtree: true });
    });
}

export async function selectCalendarDay(page, prefix, date) {
    try {
        const timestamp = await page.evaluate(findCalendarDay, prefix, date, true);
        if (!timestamp) throw new CommandExecutionError(`TradingView did not load calendar date ${date}`);
        await page.scrollTo(`[data-name="${prefix}-calendar"] [class*="scrollToLocator-"][data-timestamp="${timestamp}"]`);
        await page.evaluate(waitForCalendarDay, prefix, timestamp);
        return new Date(Number(timestamp)).toISOString();
    } catch (error) {
        if (!/Calendar date marker did not load|Selected calendar day did not load/.test(error.message)) throw error;
        throw new TimeoutError(`TradingView calendar date ${date} loading`, 20);
    }
}

export function extractCalendar(kind, selectedDayStart) {
    const prefix = kind === 'dividend' ? 'dividends' : kind;
    const root = document.querySelector(`[data-name="${prefix}-calendar"]`);
    if (!root) throw new Error('Calendar container is missing');
    const fields = {
        economic: ['actual', 'forecast', 'previous'],
        earnings: ['epsEstimate', 'epsActual', 'epsSurprise', 'revenueEstimate', 'revenueActual', 'revenueSurprise', 'marketCap'],
        dividend: ['amount', 'exDate', 'paymentDate', 'yield'],
        ipo: ['exchange', 'status', 'offerPrice', 'shares', 'dealAmount', 'marketCap'],
    }[kind];
    const text = element => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('[class*="currency-"], [class*="valueUnit-"]').forEach(unit => unit.prepend(' '));
        const value = copy.textContent.replace(/\s+/g, ' ').trim();
        return !value || value === '—' ? null : value;
    };
    let dayStart = null;
    const rows = [];
    for (const element of root.querySelectorAll(`[class*="scrollToLocator-"][data-timestamp], [data-name="${prefix}-calendar-item"]`)) {
        if (element.hasAttribute('data-timestamp')) {
            const timestamp = element.getAttribute('data-timestamp');
            if (!/^\d+$/.test(timestamp)) throw new Error('Invalid calendar date marker');
            dayStart = new Date(Number(timestamp)).toISOString();
            continue;
        }
        if (!dayStart) throw new Error('Calendar date marker is missing');
        if (selectedDayStart && dayStart !== selectedDayStart) continue;
        const link = element.querySelector('a[href*="/symbols/"]');
        const symbol = element.getAttribute('data-symbol') || (link ? new URL(link.href).pathname.split('/')[2].replace('-', ':') : null);
        const title = kind === 'economic'
            ? element.querySelector('[class*="titleText-"]')?.textContent.trim()
            : element.querySelector('[class*="description-"]')?.textContent.trim() || link?.textContent.trim();
        const values = kind === 'economic'
            ? [...element.querySelectorAll('[class^="value-"]')]
            : [...element.querySelectorAll('[class*="withValue-"]')];
        if (values.length !== fields.length) throw new Error(`Unexpected ${kind} metric columns: ${values.length}`);
        rows.push({
            rank: rows.length + 1,
            class: kind,
            title: title || null,
            symbol,
            market: element.getAttribute('data-country') || element.getAttribute('data-market') || null,
            dayStart,
            eventTime: element.querySelector('time[datetime]')?.getAttribute('datetime') || null,
            details: Object.fromEntries(fields.map((field, index) => [field, text(values[index])])),
            url: link?.href || (symbol ? `https://cn.tradingview.com/symbols/${symbol.replace(':', '-')}/` : `https://cn.tradingview.com/${kind}-calendar/`),
        });
    }
    return rows;
}

export const command = cli({
    site: 'tradingview',
    name: 'calendar',
    access: 'read',
    description: 'TradingView daily calendars: economic (default), earnings, dividend, ipo; today by default',
    domain: 'cn.tradingview.com',
    defaultWindowMode: 'foreground',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'class', type: 'string', default: 'economic', choices: Object.keys(paths), help: 'Calendar: economic, earnings, dividend, ipo' },
        { name: 'date', type: 'string', help: 'Calendar date in YYYY-MM-DD (default: today in local time)' },
        limitArg,
    ],
    columns: ['rank', 'class', 'title', 'symbol', 'market', 'dayStart', 'eventTime', 'details', 'url'],
    func: async (page, args) => {
        const kind = args.class ?? 'economic';
        const path = classPath(kind, paths);
        const date = parseDate(args.date);
        const timestamp = new Date(`${date}T12:00:00`).getTime();
        const prefix = kind === 'dividend' ? 'dividends' : kind;
        const selector = `[data-name="${prefix}-calendar-item"], [data-name="${prefix}-calendar"] [class*="emptyDayRow-"]`;
        return readRows(page, `${path}?timestamp=${timestamp}`, selector, extractCalendar, kind, parseLimit(args.limit),
            page => selectCalendarDay(page, prefix, date));
    },
});
