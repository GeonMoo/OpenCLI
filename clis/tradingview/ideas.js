import { cli, Strategy } from '@geonmoo/opencli/registry';
import { cardColumns, extractCards, limitArg, parseLimit, readRows } from './utils.js';

export const command = cli({
    site: 'tradingview',
    name: 'ideas',
    access: 'read',
    description: 'TradingView community trading ideas, first 10 loaded cards by default',
    domain: 'cn.tradingview.com',
    strategy: Strategy.UI,
    browser: true,
    args: [limitArg],
    columns: cardColumns,
    func: async (page, args) => readRows(page, '/ideas/', 'article [data-qa-id="ui-lib-card-link-title"]', extractCards, 'ideas', parseLimit(args.limit)),
});
