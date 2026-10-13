import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';

export const BASE = 'https://cn.tradingview.com';
export const limitArg = { name: 'limit', type: 'int', default: 10, help: 'Maximum loaded items to return (1-100)' };

export function parseLimit(value = 10) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ArgumentError('--limit must be an integer between 1 and 100');
    }
    return limit;
}

export function classPath(value, paths) {
    if (!Object.hasOwn(paths, value)) {
        throw new ArgumentError(`--class must be one of: ${Object.keys(paths).join(', ')}`);
    }
    return paths[value];
}

export async function readRows(page, path, selector, extractor, kind, limit, prepare) {
    try {
        await page.goto(`${BASE}${path}`);
    } catch (error) {
        if (error.message !== 'Navigation rejected.') throw error;
        // Establish a ready tab before retrying Chrome's rejected initial navigation.
        await page.wait({ selector: 'body', timeout: 20 });
        await page.goto(`${BASE}${path}`);
    }
    try {
        await page.wait({ selector, timeout: 20 });
    } catch (error) {
        if (!error.message?.includes('Selector not found:')) throw error;
        throw new TimeoutError(`TradingView ${kind} loading`, 20);
    }
    const extractorArg = prepare ? await prepare(page) : undefined;
    const rows = await page.evaluate(extractor, kind, extractorArg).catch(error => {
        throw new CommandExecutionError(`Failed to read TradingView ${kind}: ${error.message}`);
    });
    if (!Array.isArray(rows)) throw new CommandExecutionError(`TradingView ${kind} returned malformed rows`);
    if (!rows.length) throw new EmptyResultError(`tradingview ${kind}`, 'No loaded items in the selected list');
    const selected = rows.slice(0, limit);
    for (const row of selected) {
        if (!row.title || !row.url || !/^https:\/\/cn\.tradingview\.com\//.test(row.url)) {
            throw new CommandExecutionError(`TradingView ${kind} row is missing its title or link`);
        }
        for (const field of ['pubTime', 'eventTime']) {
            if (row[field] != null && !Number.isFinite(Date.parse(row[field]))) {
                throw new CommandExecutionError(`TradingView ${kind} row has an invalid ${field}`);
            }
        }
    }
    return selected;
}

export function extractCards(kind) {
    const path = kind === 'ideas' ? '/chart/' : '/script/';
    return [...document.querySelectorAll('article')].flatMap(card => {
        const link = card.querySelector('[data-qa-id="ui-lib-card-link-title"]');
        if (!link || !new URL(link.href).pathname.startsWith(path)) return [];
        const authorLink = card.querySelector('[data-qa-id="ui-lib-card-link-author"] a[href]');
        const count = selector => {
            const text = card.querySelector(selector)?.textContent.trim().replace(/\s/g, '');
            return text && /^\d+$/.test(text) ? Number(text) : null;
        };
        return [{
            rank: 0,
            title: link.textContent.trim(),
            description: card.querySelector('[data-qa-id="ui-lib-card-link-paragraph"]')?.textContent.trim() || null,
            author: authorLink ? decodeURIComponent(new URL(authorLink.href).pathname.split('/')[2]) : null,
            ...(kind === 'ideas' ? {} : { price: null }),
            likes: count('[data-qa-id="ui-lib-card-like-button"]'),
            comments: count('[data-qa-id="ui-lib-card-comment-button"]'),
            pubTime: card.querySelector('time[datetime]')?.getAttribute('datetime') || null,
            url: link.href,
        }];
    }).map((row, index) => ({ ...row, rank: index + 1 }));
}

export const cardColumns = ['rank', 'title', 'description', 'author', 'likes', 'comments', 'pubTime', 'url'];
