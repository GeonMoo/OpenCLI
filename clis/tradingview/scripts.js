import { cli, Strategy } from '@geonmoo/opencli/registry';
import { cardColumns, classPath, extractCards, limitArg, parseLimit, readRows } from './utils.js';

const paths = {
    all: '/scripts/',
    marketplace: '/scripts/marketplace/',
    editorpicks: '/scripts/editors-picks/',
};

export function extractMarketplace() {
    return [...document.querySelectorAll('article:has(header h2):has(a[href^="/u/"])')].map((card, index) => {
        const authorLink = card.querySelector('a[href^="/u/"]');
        const author = decodeURIComponent(new URL(authorLink.href).pathname.split('/')[2]);
        return {
            rank: index + 1,
            title: card.querySelector('header h2').textContent.trim(),
            description: card.querySelector('p[class*="description-"]')?.textContent.trim() || null,
            author,
            price: card.querySelector('header p[class*="price-"]')?.textContent.trim() || null,
            likes: null,
            comments: null,
            pubTime: null,
            url: card.querySelector('a[href^="/scripts/marketplace/"]')?.href || `https://cn.tradingview.com/scripts/marketplace/${encodeURIComponent(author)}/`,
        };
    });
}

export const command = cli({
    site: 'tradingview',
    name: 'scripts',
    aliases: ['script'],
    access: 'read',
    description: 'TradingView indicators and strategies; supports marketplace and editorpicks',
    domain: 'cn.tradingview.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'class', type: 'string', default: 'all', choices: Object.keys(paths), help: 'Script list: all, marketplace, editorpicks' },
        limitArg,
    ],
    columns: [...cardColumns.slice(0, 4), 'price', ...cardColumns.slice(4)],
    func: async (page, args) => {
        const path = classPath(args.class ?? 'all', paths);
        const marketplace = args.class === 'marketplace';
        return readRows(page, path,
            marketplace ? 'article header h2' : 'article [data-qa-id="ui-lib-card-link-title"]',
            marketplace ? extractMarketplace : extractCards,
            'scripts', parseLimit(args.limit));
    },
});
