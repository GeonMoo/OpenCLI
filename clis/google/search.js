/**
 * Google Web Search via browser DOM extraction.
 * Uses browser mode to navigate google.com and extract results from the DOM.
 *
 * Extraction strategy (2026-03): Google no longer uses `.g` class containers.
 * Instead, we find all `a` tags containing `h3` within `#rso`, then walk up
 * to the result container (`div.tF2Cxc` or closest `div[data-hveid]`) to find
 * snippets. This approach is resilient to class name changes.
 */
import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { runBrowserStep } from '../_shared/search-adapter.js';
import { readSearchOptions, searchOptions, sortSearchRows } from './search-options.js';
import { navigateGoogleSearch } from './utils.js';

function searchTime(value, now) {
    if (!value) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00`);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
    if (/^(?:\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})$/i.test(value)) {
        return Date.parse(value);
    }
    const chineseDay = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    if (chineseDay) {
        const [, year, month, day] = chineseDay;
        return Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`);
    }
    const relative = value.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s? ago$/i)
        ?? value.match(/^(\d+)\s*(秒|分钟|小時|小时|天|週|周|個月|个月|月|年)前$/);
    if (!relative) return NaN;
    const unit = relative[2].toLowerCase();
    const amount = Number(relative[1]);
    if (['month', '个月', '個月', '月', 'year', '年'].includes(unit)) {
        const date = new Date(now);
        const day = date.getDate();
        const months = ['year', '年'].includes(unit) ? 12 * amount : amount;
        date.setMonth(date.getMonth() - months, 1);
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(day, endOfMonth));
        return date.getTime();
    }
    const seconds = { second: 1, 秒: 1, minute: 60, 分钟: 60, hour: 3600, 小時: 3600, 小时: 3600, day: 86400, 天: 86400, week: 604800, 週: 604800, 周: 604800 };
    return now - amount * seconds[unit] * 1000;
}

function googleDate(day) {
    const [year, month, date] = day.split('-');
    return `${Number(month)}/${Number(date)}/${year}`;
}
cli({
    site: 'google',
    name: 'search',
    access: 'read',
    description: 'Search Google',
    domain: 'google.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search query' },
        ...searchOptions,
        { name: 'lang', default: 'en', help: 'Language short code (e.g. en, zh)' },
        { name: 'timeout', type: 'int', default: 180, help: 'Timeout in seconds for multi-page searches' },
    ],
    columns: ['type', 'title', 'url', 'snippet', 'date'],
    func: async (page, args) => {
        const now = Date.now();
        const options = readSearchOptions(args, new Date(now));
        const { limit, order, direction, firstDay, lastDay, start, end } = options;
        const filtered = Boolean(firstDay || lastDay);
        const initialUrl = new URL('https://www.google.com/search');
        const query = [args.keyword];
        if (firstDay && lastDay) {
            initialUrl.searchParams.set('tbs', `cdr:1,cd_min:${googleDate(firstDay)},cd_max:${googleDate(lastDay)}`);
        } else {
            if (firstDay) query.push(`after:${firstDay}`);
            if (lastDay) query.push(`before:${lastDay}`);
        }
        initialUrl.searchParams.set('q', query.join(' '));
        initialUrl.searchParams.set('hl', args.lang);
        const rows = [];
        const seen = new Set();
        const offsets = new Set();
        let url = initialUrl;
        while (url) {
            const offset = url.searchParams.get('start') ?? '0';
            if (offsets.has(offset)) break;
            offsets.add(offset);
            const wrapper = await readPage(page, url.href, !filtered && order === 'relevance' && offsets.size === 1);
            if (!wrapper || !Array.isArray(wrapper.items)) throw new CommandExecutionError('Could not read Google Search results.');
            if (wrapper.blocked) throw new CommandExecutionError('Google Search blocked the request with a CAPTCHA or consent screen.');
            for (const { kind: type, heading: title, href, excerpt: snippet, displayDate } of wrapper.items) {
                const time = searchTime(displayDate, now);
                if (Number.isFinite(time) && (time < start || time >= end)) continue;
                const key = href || title;
                if (seen.has(key)) continue;
                seen.add(key);
                const date = Number.isFinite(time) ? new Date(time).toISOString() : null;
                rows.push({ time, row: { type, title, url: href, snippet, date } });
            }
            if (order === 'relevance' && direction === 'desc' && rows.length >= limit) break;
            url = wrapper.next ? new URL(wrapper.next, url) : null;
            if (url && (url.origin !== initialUrl.origin || url.pathname !== initialUrl.pathname)) break;
        }
        if (!rows.length) throw new EmptyResultError('google search', 'Try a different keyword or date range.');
        return sortSearchRows(rows, options);
    },
});

async function readPage(page, url, includeExtras) {
    await runBrowserStep('google search navigation', () => navigateGoogleSearch(page, url));
    // Some Chrome builds settle before Google populates its result links.
    try {
        await page.wait({ selector: '#rso a h3', timeout: 5 });
    } catch {
        await page.wait(2);
    }
    return page.evaluate(`
      (function() {
        var results = [];
        var seenUrls = {};
        var rso = document.querySelector('#rso');
        var includeExtras = ${includeExtras};
        var blocked = location.pathname.startsWith('/sorry') || location.hostname.startsWith('consent.')
          || !!document.querySelector('#captcha-form, #recaptcha, form[action*="consent.google"]');
        var next = document.querySelector('a#pnnext, a[rel="next"]');
        if (!rso) return {items: results, next: next?.href, blocked: blocked};

        // -- Featured snippet (scoped to #rso to avoid matching unrelated elements) --
        var featuredEl = rso.querySelector('.xpdopen .hgKElc')
                      || rso.querySelector('.IZ6rdc');
        if (includeExtras && featuredEl) {
          var parentBlock = featuredEl.closest('[data-hveid]') || featuredEl.parentElement;
          var fLink = parentBlock ? parentBlock.querySelector('a[href]') : null;
          var fUrl = fLink ? fLink.href : '';
          if (fUrl) seenUrls[fUrl] = true;
          results.push({
            kind: 'snippet',
            heading: featuredEl.textContent.trim().slice(0, 200),
            href: fUrl,
            excerpt: '',
          });
        }

        // -- Standard search results --
        // Strategy: find all links containing h3 within #rso
        var allLinks = rso.querySelectorAll('a');
        for (var i = 0; i < allLinks.length; i++) {
          var link = allLinks[i];
          var h3 = link.querySelector('h3');
          if (!h3) continue;

          var href = link.href || '';
          // Skip non-http, Google internal links, and duplicates
          if (!(href.startsWith('http://') || href.startsWith('https://'))) continue;
          if (href.indexOf('google.com/search') !== -1) continue;
          if (seenUrls[href]) continue;
          seenUrls[href] = true;

          // Walk up to find result container for snippet extraction
          var knownContainer = link.closest('.tF2Cxc');
          var container = knownContainer || link;
          for (var j = 0; !knownContainer && j < 6; j++) {
            if (container.parentElement && container.parentElement !== rso) {
              container = container.parentElement;
            }
            // Stop at a known result boundary
            if (container.getAttribute && container.getAttribute('data-hveid')) break;
          }

          // Find snippet: look for descriptive text, skip breadcrumbs and metadata
          var snippetText = '';
          var titleText = h3.textContent.trim();
          var candidates = container.querySelectorAll('span, div');
          for (var k = 0; k < candidates.length; k++) {
            var el = candidates[k];
            if (el.querySelector('h3') || el.querySelector('a[href]')) continue;
            var text = el.textContent.trim();
            if (text.length < 40 || text.length > 500) continue;
            if (text === titleText) continue;
            // Skip URL breadcrumbs (e.g. "https://example.com › path..." or "Site Namehttps://...")
            if (text.indexOf('\u203A') !== -1) continue;
            if (new RegExp('https?://').test(text.slice(0, 60))) continue;
            snippetText = text;
            break;
          }

          var datetime = container.querySelector('time[datetime]')?.getAttribute('datetime');
          var dateEl = container.querySelector('.YrbPuc:not(.ZtihLe):not(.Q6qD5e) > span:only-child, .LEwnzc > span:only-child');
          results.push({
            kind: 'result',
            heading: h3.textContent.trim(),
            href: href,
            excerpt: snippetText.slice(0, 300),
            displayDate: datetime || dateEl?.textContent.trim(),
          });
        }

        // -- People Also Ask --
        var paaContainers = includeExtras ? document.querySelectorAll('[data-sgrd="true"]') : [];
        for (var i = 0; i < paaContainers.length; i++) {
          var questionEl = paaContainers[i].querySelector('span.CSkcDe');
          if (questionEl) {
            results.push({
              kind: 'paa',
              heading: questionEl.textContent.trim(),
              href: '',
              excerpt: '',
            });
          }
        }

        return {items: results, next: next?.href, blocked: blocked};
      })()
    `);
}
