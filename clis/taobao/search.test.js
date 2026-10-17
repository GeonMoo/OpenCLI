import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './search.js';

const fixture = readFileSync(new URL('./__fixtures__/search.html', import.meta.url), 'utf8');
const command = getRegistry().get('taobao/search');

describe('taobao search product links', () => {
    it('preserves signed click links and direct links without dropping their query parameters', async () => {
        const dom = new JSDOM(fixture, { url: 'https://s.taobao.com/search?q=test' });
        Object.defineProperty(dom.window.document.body, 'innerText', { value: '已登录搜索结果' });
        const page = createPageMock([], {
            evaluate: vi.fn(async script => {
                if (script.startsWith('location.href')) return;
                return new Function('document', 'location', `return (${script})`)(dom.window.document, dom.window.location);
            }),
        });
        try {
            const rows = await command.func(page, { query: '爬行垫', limit: 10 });
            expect(rows.map(row => ({ id: row.item_id, url: row.url }))).toEqual([
                { id: '611927494365', url: 'https://click.simba.taobao.com/cc_im?e=opaque%2Bsignature%2Fvalue%3D&a=skuId%3D6310366495021%26xxc%3Dad_qcpx&id=611927494365&spm=a21n57.1.item.1' },
                { id: '637499332827', url: 'https://detail.tmall.com/item.htm?id=637499332827&skuId=123&spm=a21n57.1.item.2' },
                { id: '570246449808', url: 'https://mclick.simba.taobao.com/cc_im?e=opaque%2Bmobile%3D&id=570246449808&spm=a21n57.1.item.3' },
            ]);
            expect(rows.map(row => row.rank)).toEqual([1, 2, 3]);
            expect(rows[0]).toMatchObject({ title: '丸丫山茶花爬行垫', price: '¥220', sales: '7万+人付款', shop: '丸丫旗舰店', location: '广东佛山' });
            expect(rows[1].price).toBe('¥135.47');
            for (const row of rows) expect(Object.keys(row)).toEqual(command.columns);
        } finally {
            dom.window.close();
        }
    });
});
