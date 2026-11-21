import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { CDX, dateBefore, fetchJson, parseLimit, parseTimeOrder } from './_shared.js';

const SITE_SEARCH = 'https://web.archive.org/__wb/search/anchor';
// shortcut: Site Search exposes up to 500 hits and no cursor. Use upstream pagination if it is introduced.
const MAX_SITE_HITS = 500;

async function homepageCapturedBefore(url, to) {
  const apiUrl = new URL(CDX);
  apiUrl.search = new URLSearchParams({ url, to, output: 'json', fl: 'timestamp', limit: '1' });
  const data = await fetchJson(apiUrl, 'Wayback CDX');
  if (Array.isArray(data) && data.length === 0) return false;
  if (data?.[0]?.[0] === 'timestamp' && Array.isArray(data)) {
    if (data.length === 1) return false;
    const timestamp = data[1]?.[0];
    if (typeof timestamp === 'string' && /^\d{14}$/.test(timestamp) && timestamp <= to) return true;
  }
  throw new CommandExecutionError('Wayback CDX returned an invalid timestamp result');
}

cli({
  site: 'wayback',
  name: 'search',
  access: 'read',
  description: 'Find archived site homepages by keyword using Wayback Site Search.',
  example: 'opencli wayback search "machine learning" --limit 10',
  domain: 'web.archive.org',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keywords', positional: true, required: true, help: 'Keywords associated with site homepages.' },
    { name: 'date-before', type: 'string', valueRequired: true, help: 'Only include sites archived before this UTC date (YYYY-MM-DD).' },
    { name: 'order', type: 'string[]', help: 'Sort by first indexed capture year with time asc or time desc. Default: relevance.' },
    { name: 'limit', type: 'string', valueRequired: true, default: '100', help: 'Positive result limit or None for all available Site Search hits (up to 500).' },
  ],
  columns: ['domain', 'snippet', 'firstCaptureYear', 'url', 'waybackUrl'],
  func: async (args) => {
    const query = String(args.keywords ?? '').trim();
    if (!query) throw new ArgumentError('wayback search requires non-empty keywords');
    const limit = parseLimit(args.limit);
    const order = parseTimeOrder(args.order);
    const cutoff = args['date-before'];
    const to = cutoff === undefined ? undefined : dateBefore(cutoff);
    const cutoffYear = cutoff === undefined ? Infinity : Number(cutoff.slice(0, 4));
    const apiUrl = new URL(SITE_SEARCH);
    const size = to || order ? MAX_SITE_HITS : Math.min(limit, MAX_SITE_HITS);
    apiUrl.search = new URLSearchParams({ q: query, size: String(size) });
    const data = await fetchJson(apiUrl, 'Wayback Site Search');
    if (!Array.isArray(data)) throw new CommandExecutionError('Wayback Site Search returned an invalid result');

    const rows = [];
    for (const hit of data) {
      const { name, snippet, first_captured: year, link } = hit ?? {};
      if (typeof name !== 'string' || !name || typeof link !== 'string' || !/^https?:\/\//i.test(link)
          || !Number.isInteger(year) || (snippet != null && typeof snippet !== 'string')) {
        throw new CommandExecutionError('Wayback Site Search returned an invalid site record');
      }
      if (year > cutoffYear) continue;
      if (year === cutoffYear && (!to.startsWith(String(year)) || !await homepageCapturedBefore(link, to))) continue;
      rows.push({
        domain: name,
        snippet: snippet ?? '',
        firstCaptureYear: year,
        url: link,
        waybackUrl: `https://web.archive.org/web/*/${link}`,
      });
      if (!order && rows.length >= limit) break;
    }
    if (!rows.length) throw new EmptyResultError('wayback search', `No Wayback sites for "${query}".`);
    if (order) {
      const direction = order === 'desc' ? -1 : 1;
      rows.sort((a, b) => direction * (a.firstCaptureYear - b.firstCaptureYear));
    }
    return rows.slice(0, limit);
  },
});
