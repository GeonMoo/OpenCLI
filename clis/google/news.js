/**
 * Google News via public RSS feed.
 * Supports top stories (no keyword) and search (with keyword).
 */
import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { parseRssItems } from './utils.js';
import { readSearchOptions, searchOptions, shiftDate, sortSearchRows } from './search-options.js';

const rssDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' });
const feedSize = 100;

async function fetchNews(params, keyword, first, until) {
    const query = [keyword, first && `after:${first}`, until && `before:${until}`].filter(Boolean).join(' ');
    const url = new URL(query ? 'https://news.google.com/rss/search' : 'https://news.google.com/rss');
    url.search = params;
    if (query) url.searchParams.set('q', query);
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await response.text();
        if (!/<rss[\s>]/i.test(xml)) throw new Error('expected an RSS feed');
        return parseRssItems(xml, ['title', 'link', 'pubDate', 'source']);
    } catch (error) {
        throw new CommandExecutionError(`Google News RSS request failed: ${error.message}`);
    }
}

function newsRow(item) {
    let title = item.title;
    let source = item.source;
    const separator = title.lastIndexOf(' - ');
    if (!source && separator !== -1) {
        source = title.slice(separator + 3);
        title = title.slice(0, separator);
    }
    return { title, source, date: item.pubDate, url: item.link };
}
cli({
    site: 'google',
    name: 'news',
    access: 'read',
    description: 'Get Google News headlines',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', positional: true, help: 'Search query (omit for top stories)' },
        ...searchOptions,
        { name: 'lang', default: 'en', help: 'Language short code (e.g. en, zh)' },
        { name: 'region', default: 'US', help: 'Region code (e.g. US, CN)' },
    ],
    columns: ['title', 'source', 'date', 'url'],
    func: async (args) => {
        const now = new Date();
        const options = readSearchOptions(args, now);
        const { start, end, limit, order, direction } = options;
        const keyword = args.keyword?.trim();
        const params = new URLSearchParams({ hl: args.lang, gl: args.region, ceid: `${args.region}:${args.lang}` });
        const first = Number.isFinite(start) ? rssDay.format(start) : undefined;
        const until = Number.isFinite(end) ? shiftDate(rssDay.format(end - 1), 1) : undefined;
        const rows = new Map();
        let saturated = false;
        const sortAcrossRange = Boolean(first || until) && (order === 'time' || direction === 'asc');
        const needsMore = () => sortAcrossRange || rows.size < limit;

        async function collect(from, to) {
            const items = await fetchNews(params, keyword, keyword && from, keyword && to);
            let oldest = Infinity;
            for (const item of items) {
                const time = Date.parse(item.pubDate);
                if (Number.isFinite(time)) oldest = Math.min(oldest, time);
                if ((first || until) && !(time >= start && time < end)) continue;
                if (item.link && !rows.has(item.link)) rows.set(item.link, { time, row: newsRow(item) });
            }
            if (items.length < feedSize || !needsMore()) return;

            // A full RSS feed has no next page. Re-query halves until each fits or spans one source day.
            const low = from ?? (Number.isFinite(oldest) ? rssDay.format(oldest) : undefined);
            const high = to ?? shiftDate(rssDay.format(now), 1);
            if (!keyword || !low) {
                saturated = true;
                return;
            }
            const days = (Date.parse(high) - Date.parse(low)) / 86_400_000;
            if (days > 1) {
                const middle = shiftDate(low, Math.floor(days / 2));
                await collect(middle, high);
                if (needsMore()) await collect(low, middle);
            } else {
                saturated = true;
            }
            // For a large finite request with no lower date, step back from the oldest exposed day.
            if (!from && Number.isFinite(limit) && rows.size < limit && (!to || low < to)) {
                await collect(undefined, low);
            }
        }

        await collect(first, until);
        if (!rows.size) throw new EmptyResultError('google news', 'Try a different keyword, date range, or region.');
        if (saturated) process.stderr.write('Google News reached its feed limit for at least one day or the top-stories feed. More matches may exist.\n');
        return sortSearchRows([...rows.values()], options);
    },
});
