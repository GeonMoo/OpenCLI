import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { CDX, dateBefore, fetchJson, parseLimit, parseTimeOrder } from './_shared.js';

const PAGE_SIZE = 1000;

function requireTarget(value) {
  const target = String(value ?? '').trim();
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(target) ? target : `https://${target}`;
  const parsed = URL.canParse(absolute) ? new URL(absolute) : null;
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)
      || (!parsed.hostname.includes('.') && !parsed.hostname.startsWith('['))
      || /[\s*#]/.test(target) || parsed.username || parsed.password) {
    throw new ArgumentError('wayback url requires a website URL or hostname, optionally with a path and query string');
  }
  return target;
}

cli({
  site: 'wayback',
  name: 'url',
  access: 'read',
  description: 'List Wayback Machine captures for a URL.',
  example: 'opencli wayback url example.com --date-before 2026-11-01 --order time asc --limit 100',
  domain: 'web.archive.org',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'url', positional: true, required: true, help: 'Website URL or hostname. Searches captures of this URL.' },
    { name: 'date-before', type: 'string', valueRequired: true, help: 'Exclude this UTC date and later captures (YYYY-MM-DD).' },
    { name: 'order', type: 'string[]', help: 'Capture order: time asc (default) or time desc.' },
    { name: 'limit', type: 'string', valueRequired: true, default: '100', help: 'Positive capture limit or None for all matching captures.' },
  ],
  columns: ['timestamp', 'snapshot_url', 'status', 'mimetype', 'original_url'],
  func: async (args) => {
    const target = requireTarget(args.url);
    const order = parseTimeOrder(args.order);
    const limit = parseLimit(args.limit);

    const apiUrl = new URL(CDX);
    apiUrl.searchParams.set('url', target);
    apiUrl.searchParams.set('output', 'json');
    apiUrl.searchParams.set('showResumeKey', 'true');
    if (order === 'desc') apiUrl.searchParams.set('sort', 'reverse');
    if (args['date-before'] !== undefined) apiUrl.searchParams.set('to', dateBefore(args['date-before']));

    const rows = [];
    const seenKeys = new Set();
    while (rows.length < limit) {
      apiUrl.searchParams.set('limit', String(Math.min(PAGE_SIZE, limit - rows.length)));
      const page = await fetchJson(apiUrl, 'Wayback CDX');
      if (!Array.isArray(page)) throw new CommandExecutionError('Wayback CDX returned an invalid result');

      let nextKey;
      if (Array.isArray(page.at(-2)) && page.at(-2).length === 0) {
        const trailer = page.pop();
        if (!Array.isArray(trailer) || trailer.length !== 1 || typeof trailer[0] !== 'string' || !trailer[0]) {
          throw new CommandExecutionError('Wayback CDX returned an invalid resume key');
        }
        nextKey = new URLSearchParams(`resumeKey=${trailer[0]}`).get('resumeKey');
        page.pop();
      }

      if (page.length) {
        const [header, ...captures] = page;
        const fields = ['timestamp', 'original', 'statuscode', 'mimetype'];
        const columns = Array.isArray(header) ? fields.map(name => header.indexOf(name)) : [];
        if (columns.length !== fields.length || columns.includes(-1)) {
          throw new CommandExecutionError('Wayback CDX returned an invalid column header');
        }
        for (const capture of captures) {
          const [capturedAt, sourceUrl, responseCode, mediaType] = Array.isArray(capture)
            ? columns.map(index => capture[index]) : [];
          if (typeof capturedAt !== 'string' || !/^\d{14}$/.test(capturedAt)
              || typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)
              || typeof responseCode !== 'string' || !responseCode || typeof mediaType !== 'string' || !mediaType) {
            throw new CommandExecutionError('Wayback CDX returned an invalid capture row');
          }
          rows.push({
            timestamp: capturedAt,
            snapshot_url: `https://web.archive.org/web/${capturedAt}/${sourceUrl}`,
            status: responseCode,
            mimetype: mediaType,
            original_url: sourceUrl,
          });
        }
      }

      if (!nextKey || rows.length >= limit) break;
      if (seenKeys.has(nextKey)) throw new CommandExecutionError('Wayback CDX repeated a resume key');
      seenKeys.add(nextKey);
      apiUrl.searchParams.set('resumeKey', nextKey);
    }
    if (!rows.length) throw new EmptyResultError('wayback url', `No Wayback captures for "${target}".`);
    return rows.slice(0, limit);
  },
});
