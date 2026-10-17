import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@geonmoo/opencli/errors';
import { assertTaobaoPageUsable } from './page-state.js';
import { normalizeNumericId } from '../_shared/common.js';
cli({
    site: 'taobao',
    name: 'detail',
    access: 'read',
    description: '淘宝商品详情',
    domain: 'item.taobao.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: '商品 ID、完整详情链接或 search 返回的商品链接' },
    ],
    columns: ['field', 'value'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const input = String(kwargs.id ?? '').trim();
        let targetUrl;
        let rawId = input;
        if (input.startsWith('https://')) {
            let parsed;
            try { parsed = new URL(input); } catch { throw new ArgumentError('Invalid product URL'); }
            const isDetail = ['item.taobao.com', 'detail.tmall.com'].includes(parsed.host) && parsed.pathname === '/item.htm';
            const isClick = ['click.simba.taobao.com', 'mclick.simba.taobao.com'].includes(parsed.host) && parsed.pathname === '/cc_im';
            if ((!isDetail && !isClick) || parsed.username || parsed.password) {
                throw new ArgumentError('Use a Taobao/Tmall detail URL or a product link returned by taobao search');
            }
            rawId = parsed.searchParams.get('id');
            targetUrl = input;
        }
        const itemId = normalizeNumericId(rawId, 'id', '827563850178');
        const alreadyOpen = await page.evaluate(`(() => {
            const current = new URL(location.href);
            return ['item.taobao.com', 'detail.tmall.com'].includes(current.host)
                && current.pathname === '/item.htm' && current.searchParams.get('id') === ${JSON.stringify(itemId)};
        })()`);
        if (!alreadyOpen) {
            await page.goto('https://www.taobao.com');
            await page.wait(2);
            await page.evaluate(`location.href = ${JSON.stringify(targetUrl || `https://item.taobao.com/item.htm?id=${itemId}`)}`);
        }
        await page.wait(6);
        await assertTaobaoPageUsable(page);
        const data = await page.evaluate(`
      (() => {
        const current = new URL(location.href);
        if (!['item.taobao.com', 'detail.tmall.com'].includes(current.host)
            || current.pathname !== '/item.htm' || current.searchParams.get('id') !== ${JSON.stringify(itemId)}) {
          return { wrongTarget: true };
        }
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const text = document.body?.innerText || '';
        if (!document.querySelector('.paramsInfoArea') && text.includes('系统检测到当前访问存在异常')) {
          return { blocked: true };
        }
        const results = [];

        const titleEl = document.querySelector('[class*="mainTitle--"]');
        const title = titleEl ? normalize(titleEl.textContent) : document.title.split('-')[0].replace(/^【[^】]+】/, '').trim();
        results.push({ field: '商品名称', value: title.slice(0, 100) });

        const pricePattern = /[￥¥]\\s*(\\d+(?:\\.\\d{1,2})?)/g;
        const prices = [];
        let m;
        while ((m = pricePattern.exec(text)) && prices.length < 3) {
          const p = parseFloat(m[1]);
          if (p > 0.1 && p < 100000) prices.push(p);
        }
        if (prices.length > 0) {
          results.push({ field: '价格', value: '¥' + Math.min(...prices) });
        }

        const salesMatch = text.match(/(\\d+万?\\+?)\\s*人付款/) || text.match(/月销\\s*(\\d+万?\\+?)/);
        if (salesMatch) results.push({ field: '销量', value: salesMatch[0] });

        const reviewMatch = text.match(/累计评价\\s*(\\d+万?\\+?)/) || text.match(/评价[（(]\\s*(\\d+万?\\+?)/);
        if (reviewMatch) results.push({ field: '评价数', value: reviewMatch[1] });

        const ratingMatch = text.match(/(\\d+\\.\\d)\\s*(?:分|描述|物流|服务)/);
        if (ratingMatch) results.push({ field: '店铺评分', value: ratingMatch[0] });

        const shopMatch = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,15}(?:旗舰店|专卖店|企业店|专营店))/);
        if (shopMatch) results.push({ field: '店铺', value: shopMatch[1] });

        const locMatch = text.match(/发货地[：:]*\\s*([\u4e00-\u9fa5]{2,10})/) || text.match(/([\u4e00-\u9fa5]{2,4}(?:省|市))\\s*发货/);
        if (locMatch) results.push({ field: '发货地', value: locMatch[1] });

        if (text.includes('颜色分类')) {
          const start = text.indexOf('颜色分类');
          const specSection = start >= 0 ? text.substring(start, start + 200) : '';
          const specs = specSection.split('\\n').filter(l => l.trim().length > 2 && l.trim().length < 50).slice(0, 5);
          if (specs.length) results.push({ field: '可选规格', value: specs.join(' | ') });
        }

        const paramsArea = document.querySelector('.paramsInfoArea');
        for (const [prefix, reversed] of [['emphasis', true], ['general', false]]) {
          for (const item of paramsArea?.querySelectorAll('[class*="' + prefix + 'ParamsInfoItem--"]') || []) {
            const heading = item.querySelector('[class*="' + prefix + 'ParamsInfoItemTitle--"]');
            const subtitle = item.querySelector('[class*="' + prefix + 'ParamsInfoItemSubTitle--"]');
            const label = reversed ? subtitle : heading;
            const content = reversed ? heading : subtitle;
            const paramName = normalize(label?.getAttribute('title') || label?.textContent);
            const paramValue = normalize(content?.getAttribute('title') || content?.textContent);
            if (paramName && paramValue) results.push({ field: paramName, value: paramValue });
          }
        }

        results.push({ field: 'ID', value: ${JSON.stringify(itemId)} });
        results.push({ field: '链接', value: location.href });
        return results;
      })()
    `);
        if (data?.wrongTarget) throw new CommandExecutionError('Product link did not resolve to the requested Taobao/Tmall item. Refresh taobao search to get a current link.');
        if (data?.blocked) throw new CommandExecutionError('Taobao reports abnormal access; parameter information is unavailable. Retry after normal browser access is restored.');
        if (!Array.isArray(data)) throw new CommandExecutionError('Taobao detail returned an unexpected response');
        return data;
    },
});
