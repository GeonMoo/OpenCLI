import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './detail.js';

const fixture = readFileSync(new URL('./__fixtures__/detail.html', import.meta.url), 'utf8');
const command = getRegistry().get('taobao/detail');

async function extract(html = fixture, bodyText = '', url = 'https://detail.tmall.com/item.htm?id=611927494365') {
    const dom = new JSDOM(html, { url });
    Object.defineProperty(dom.window.document.body, 'innerText', { value: bodyText });
    const page = createPageMock([], {
        evaluate: vi.fn(async script => {
            if (script.startsWith('location.href')) return;
            return new Function('document', 'location', `return (${script})`)(dom.window.document, dom.window.location);
        }),
    });
    try {
        return await command.func(page, { id: '611927494365' });
    } finally {
        dom.window.close();
    }
}

describe('taobao detail parameters', () => {
    it('extracts both parameter layouts in the correct direction and preserves long values', async () => {
        const rows = await extract();
        expect(rows.slice(1, -2)).toEqual([
            { field: '产地', value: '中国大陆' },
            { field: '品牌', value: '丸丫' },
            { field: '厚度', value: '2.5cm' },
            { field: '适用年龄', value: '18个月,2岁,4岁,12个月,6个月' },
            { field: '尺寸', value: '【进阶加厚2.5cm】180cm*300cm 【进阶加厚2.5cm】180cm*250cm 【进阶加厚2.5cm】180cm*200cm 【进阶加厚2.5cm】150cm*200cm 【进阶加厚2.5cm】150cm*180cm 【轻便舒享2cm】180cm*300cm 【轻便舒享2cm】180*250cm 【轻便舒享2cm】180*200cm 【轻便舒享2cm】150*200cm 【轻便舒享2cm】150*180cm 定制尺寸（详询客服）' },
            { field: '适用性别', value: '男女通用' },
            { field: '颜色分类', value: '【顶配·首创山茶花PU+IXPE】动物派对丨平滑亲肤 一擦即净丨老爸抽检N.D.甲酰胺 【轻奢·首创山茶花PE+IXPE】动物派对丨防滑纹路 好打理丨老爸抽检N.D.甲酰胺 整体定制：尺寸定制，XPE材质，不参与任何活动' },
        ]);
        expect(rows[0]).toEqual({ field: '商品名称', value: '丸丫爬行垫' });
        expect(rows.at(-2)).toEqual({ field: 'ID', value: '611927494365' });
        for (const row of rows) expect(Object.keys(row)).toEqual(command.columns);
    });

    it('keeps basic product details when no parameter area exists', async () => {
        expect(await extract('<title>商品-tmall.com</title>')).toEqual([
            { field: '商品名称', value: '商品' },
            { field: 'ID', value: '611927494365' },
            { field: '链接', value: 'https://detail.tmall.com/item.htm?id=611927494365' },
        ]);
    });

    it('reports an unexpected extraction response as a typed error', async () => {
        const page = createPageMock([undefined, undefined, null]);
        await expect(command.func(page, { id: '611927494365' })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('reports blocked parameter loading instead of returning partial success', async () => {
        await expect(extract('<title>商品-tmall.com</title>', '系统检测到当前访问存在异常')).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('reuses the clicked product page without navigating or losing URL parameters', async () => {
        const url = 'https://detail.tmall.com/item.htm?ali_refid=clicked&id=611927494365&skuId=6310366495021';
        const page = createPageMock([true, [{ field: '链接', value: url }]]);
        expect(await command.func(page, { id: '611927494365' })).toEqual([{ field: '链接', value: url }]);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('preserves the supplied full product URL when navigation is needed', async () => {
        const url = 'https://detail.tmall.com/item.htm?ali_refid=clicked&id=611927494365&skuId=6310366495021';
        const page = createPageMock([false, undefined, []]);
        await command.func(page, { id: url });
        expect(page.evaluate.mock.calls[1][0]).toBe(`location.href = ${JSON.stringify(url)}`);
    });

    it('rejects offsite and invalid product URLs before browser access', async () => {
        for (const id of ['https://example.com/item.htm?id=123', 'https://detail.tmall.com/other?id=123', 'https://detail.tmall.com/item.htm?id=bad', 'https://user@detail.tmall.com/item.htm?id=123', 'https://click.simba.taobao.com/other?id=123', 'https://click.simba.taobao.com.example.com/cc_im?id=123', 'https://mclick.simba.taobao.com/cc_im']) {
            const page = createPageMock();
            await expect(command.func(page, { id })).rejects.toMatchObject({ code: 'ARGUMENT' });
            expect(page.evaluate).not.toHaveBeenCalled();
            expect(page.goto).not.toHaveBeenCalled();
        }
    });

    it('accepts original signed search links and follows them without rewriting signatures', async () => {
        for (const host of ['click.simba.taobao.com', 'mclick.simba.taobao.com']) {
            const url = `https://${host}/cc_im?e=opaque%2Bsignature%2Fvalue%3D&a=skuId%3D6310366495021&id=611927494365&spm=a21n57.1.item.1`;
            const page = createPageMock([false, undefined, [{ field: '品牌', value: '丸丫' }]]);
            await command.func(page, { id: url });
            expect(page.evaluate.mock.calls[1][0]).toBe(`location.href = ${JSON.stringify(url)}`);
        }
    });

    it('returns the complete resolved URL and rejects redirects to a different item', async () => {
        const url = 'https://detail.tmall.com/item.htm?ali_refid=clicked&id=611927494365&skuId=6310366495021';
        expect((await extract(fixture, '', url)).at(-1)).toEqual({ field: '链接', value: url });
        await expect(extract(fixture, '', 'https://detail.tmall.com/item.htm?id=123')).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
});
