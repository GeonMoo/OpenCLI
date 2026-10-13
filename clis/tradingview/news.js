import { cli, Strategy } from '@geonmoo/opencli/registry';
import { limitArg, parseLimit, readRows } from './utils.js';

export function extractNews() {
    return [...document.querySelectorAll('[data-qa-id="news-headline-card"]')].map((card, index) => {
        const link = card.closest('a[href]');
        const timestamp = card.querySelector('relative-time[event-time]')?.getAttribute('event-time');
        const title = card.querySelector('[data-qa-id="news-headline-title"]');
        return {
            rank: index + 1,
            title: title?.getAttribute('data-overflow-tooltip-text') || title?.textContent.trim() || null,
            source: card.querySelector('[class*="provider-"]')?.textContent.trim() || null,
            pubTime: timestamp ? new Date(timestamp).toISOString() : null,
            url: link?.href || null,
        };
    });
}

export const command = cli({
    site: 'tradingview',
    name: 'news',
    access: 'read',
    description: 'TradingView Chinese news flow, first 10 rendered headlines by default',
    domain: 'cn.tradingview.com',
    strategy: Strategy.UI,
    browser: true,
    args: [limitArg],
    columns: ['rank', 'title', 'source', 'pubTime', 'url'],
    func: async (page, args) => readRows(page, '/news-flow/', '[data-qa-id="news-headline-card"]', extractNews, 'news', parseLimit(args.limit)),
});
