import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError, EmptyResultError, TimeoutError, getErrorMessage } from '@geonmoo/opencli/errors';

// Strategy: DOM_STATE / visible-ui. The homepage renders its socket-fed news
// in #jin_flash_list; the HTTP fallback returned 502 during reconnaissance.
export function extractJinshiNews() {
    return Array.from(document.querySelectorAll('#jin_flash_list .jin-flash-item-container')).map((item) => {
        const body = item.querySelector('.flash-text') || item.querySelector('.right-content');
        const copy = body?.cloneNode(true);
        copy?.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        return {
            itemKey: item.id.replace(/^flash/, ''),
            headingText: item.querySelector('.right-common-title')?.textContent.trim() || '',
            bodyText: copy?.textContent.trim() || '',
        };
    });
}

cli({
    site: 'jinshi',
    name: 'news',
    access: 'read',
    description: '金十最新快讯，默认获取首页已加载的全部新闻',
    example: 'opencli jinshi news -f csv -o "test.csv"',
    domain: 'www.jin10.com',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['timestamp', 'title', 'content', 'url'],
    func: async (page) => {
        await page.goto('https://www.jin10.com/', { waitUntil: 'load', settleMs: 3000 });
        try {
            await page.wait({ selector: '#jin_flash_list .jin-flash-item-container', timeout: 20 });
        } catch {
            throw new TimeoutError('Jin10 news loading', 20);
        }
        const items = await page.evaluate(extractJinshiNews).catch((error) => {
            throw new CommandExecutionError(`Failed to extract Jin10 news: ${getErrorMessage(error)}`);
        });
        if (!Array.isArray(items)) throw new CommandExecutionError('Jin10 returned malformed news data');
        if (!items.length) throw new EmptyResultError('jinshi news');
        return items.map(({ itemKey, headingText, bodyText }, index) => {
            const parts = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d+$/.exec(itemKey);
            if (!parts || !bodyText) {
                throw new CommandExecutionError(`Jin10 news row ${index + 1} is missing its timestamp or content`);
            }
            const [, year, month, day, hour, minute, second] = parts;
            const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
            if (!Number.isFinite(Date.parse(timestamp))) {
                throw new CommandExecutionError(`Jin10 news row ${index + 1} has an invalid timestamp`);
            }
            return {
                timestamp,
                title: headingText || bodyText,
                content: bodyText,
                url: `https://flash.jin10.com/detail/${itemKey}`,
            };
        });
    },
});
