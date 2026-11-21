import { ArgumentError } from '@geonmoo/opencli/errors';

export const searchOptions = [
    { name: 'limit', valueRequired: true, default: 10, help: 'Positive integer (e.g. 1000), or None for all available results today unless dates are specified' },
    { name: 'date-before', valueRequired: true, help: 'Before YYYY-MM-DD (exclusive)' },
    { name: 'date-between', type: 'string[]', help: 'From YYYY-MM-DD to YYYY-MM-DD (inclusive)' },
    { name: 'date-after', valueRequired: true, help: 'After YYYY-MM-DD (exclusive)' },
    { name: 'order', type: 'string[]', help: 'relevance asc|desc or time asc|desc (default: relevance desc)' },
];

export function shiftDate(date, days) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
}

function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || shiftDate(value, 0) !== value) {
        throw new ArgumentError(`Invalid date "${value}". Use YYYY-MM-DD.`);
    }
    return value;
}

function optionWords(value) {
    return (Array.isArray(value) ? value.join(' ') : String(value)).trim().split(/\s+/);
}

export function readSearchOptions(args, now = new Date()) {
    const rawLimit = String(args.limit ?? 10);
    const unlimited = rawLimit.toLowerCase() === 'none';
    const limit = unlimited ? Infinity : Number(rawLimit);
    if (!unlimited && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1)) {
        throw new ArgumentError('--limit must be a positive integer or None.');
    }
    const [order, direction, extra] = optionWords(args.order ?? 'relevance desc');
    if (!['relevance', 'time'].includes(order) || !['asc', 'desc'].includes(direction) || extra !== undefined) {
        throw new ArgumentError('--order expects relevance asc, relevance desc, time asc, or time desc.');
    }

    const before = args['date-before'];
    const after = args['date-after'];
    const between = args['date-between'];
    let firstDay;
    let lastDay;
    if (between !== undefined) {
        if (before !== undefined || after !== undefined) {
            throw new ArgumentError('--date-between cannot be combined with --date-before or --date-after.');
        }
        const values = optionWords(between);
        if (values.length !== 2) throw new ArgumentError('--date-between expects two dates (YYYY-MM-DD).');
        [firstDay, lastDay] = values.map(parseDay);
    } else {
        if (after !== undefined) firstDay = shiftDate(parseDay(after), 1);
        if (before !== undefined) lastDay = shiftDate(parseDay(before), -1);
        if (!firstDay && !lastDay && unlimited) {
            firstDay = lastDay = new Intl.DateTimeFormat('sv-SE').format(now);
        }
    }
    if (firstDay && lastDay && firstDay > lastDay) {
        throw new ArgumentError('The requested date range is empty or reversed.');
    }
    const start = firstDay ? Date.parse(`${firstDay}T00:00:00`) : -Infinity;
    const end = lastDay ? Date.parse(`${shiftDate(lastDay, 1)}T00:00:00`) : Infinity;
    return { limit, order, direction, firstDay, lastDay, start, end };
}

export function sortSearchRows(rows, { limit, order, direction }) {
    if (order === 'time') {
        const sign = direction === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            if (!Number.isFinite(a.time)) return Number.isFinite(b.time) ? 1 : 0;
            if (!Number.isFinite(b.time)) return -1;
            return sign * (a.time - b.time);
        });
    } else if (direction === 'asc') {
        rows.reverse();
    }
    return rows.slice(0, limit).map(({ time, row }) => row);
}
