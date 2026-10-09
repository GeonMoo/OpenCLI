import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { cityUrl, gotoKe } from './utils.js';

// Strategy: DOM_STATE / visible-ui. Search cards and labelled detail attributes
// are rendered HTML; anonymous HTTP redirects to login. Reuse the browser session.
export function extractSearchPage() {
    const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
    const numeric = value => {
        const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    const list = document.querySelector('.sellListContent:not(.VIEWDATA)');
    const links = [];
    for (const card of list?.querySelectorAll('li.clear') ?? []) {
        const anchor = card.querySelector('.title a');
        const match = anchor?.pathname.match(/^\/ershoufang\/(\d+)\.html$/);
        if (!match) continue;
        const text = selector => clean(card.querySelector(selector)?.textContent);
        const houseText = text('.houseInfo');
        const followText = text('.followInfo');
        const publishedText = followText.split(/[/／]/).at(-1)?.trim() ?? '';
        const parts = houseText.split('|').map(clean);
        links.push({
            houseCode: match[1],
            detailHref: anchor.href.split('?')[0],
            headingText: clean(anchor.textContent),
            communityText: text('.positionInfo a'),
            layoutText: houseText.match(/\d+室\d+厅(?:\d+卫)?/)?.[0] ?? null,
            areaNumber: numeric(houseText.match(/\d+(?:\.\d+)?\s*(?:平米|㎡)/)?.[0] ?? ''),
            floorText: houseText.match(/(?:低|中|高)楼层\s*(?:[（(]共\d+层[）)])?/)?.[0]
                ?? parts.find(part => /楼层|地下室|顶层|底层/.test(part)) ?? null,
            directionText: parts.find(part => /^[东南西北\s]+$/.test(part)) ?? null,
            priceNumber: numeric(text('.totalPrice span')),
            unitPriceNumber: numeric(text('.unitPrice span')),
            publishedText,
            attributeValues: { 房源信息: houseText, 关注信息: followText },
        });
    }
    const pager = document.querySelector('.house-lst-page-box[page-data]');
    let paging = null;
    try { paging = pager ? JSON.parse(pager.getAttribute('page-data')) : null; } catch { /* validated by caller */ }
    return {
        links,
        hasList: Boolean(list),
        cardCount: list?.querySelectorAll('li.clear').length ?? 0,
        emptyText: document.querySelector('.m-noresult, .noResult, .no-result')?.textContent ?? '',
        pageData: paging,
        pageTemplate: pager?.getAttribute('page-url') ?? null,
        currentHref: location.href,
    };
}

// Relative publication text is approximate: preserve its day/month/year precision.
// Use the site's timezone even when the CLI runs outside China.
export function parseListingDate(text, referenceDate = new Date()) {
    if (!(referenceDate instanceof Date) || !Number.isFinite(referenceDate.getTime())) return null;
    const dateParts = date => Object.fromEntries(new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const formatDay = date => {
        const parts = dateParts(date);
        return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const value = String(text ?? '').replace(/\s+/g, '').split(/[/／]/).at(-1);
    const relative = value.match(/^(\d+)(分钟|小时|天|周|个?月|年)前发布$/);
    const named = value.match(/^(今天|昨天|前天|刚刚)发布$/)?.[1];
    if (!relative && !named) return null;
    const amount = relative ? Number(relative[1]) : 0;
    if (!Number.isSafeInteger(amount)) return null;
    const parts = dateParts(referenceDate);
    if (relative?.[2].endsWith('月')) {
        const monthIndex = Number(parts.year) * 12 + Number(parts.month) - 1 - amount;
        const year = Math.floor(monthIndex / 12);
        if (year < 1 || year > 9999) return null;
        return `${String(year).padStart(4, '0')}-${String(monthIndex % 12 + 1).padStart(2, '0')}`;
    }
    if (relative?.[2] === '年') {
        const year = Number(parts.year) - amount;
        return year > 0 && year <= 9999 ? String(year).padStart(4, '0') : null;
    }
    if (relative?.[2] === '小时' || relative?.[2] === '分钟') {
        const date = new Date(referenceDate.getTime() - amount * (relative[2] === '小时' ? 3600000 : 60000));
        return Number.isFinite(date.getTime()) ? formatDay(date) : null;
    }
    const days = named === '昨天' ? 1 : named === '前天' ? 2 : amount * (relative?.[2] === '周' ? 7 : 1);
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - days));
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1) return null;
    return date.toISOString().slice(0, 10);
}

export function extractHouseDetail() {
    const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
    const text = selector => clean(document.querySelector(selector)?.textContent);
    const attributes = {};
    for (const item of document.querySelectorAll('.introContent .base li, .introContent .transaction li')) {
        const label = clean(item.querySelector('.label')?.textContent);
        if (!label) continue;
        const copy = item.cloneNode(true);
        copy.querySelectorAll('.label, .VIEWDATA, .tips, .icon-box, .Qrcode').forEach(el => el.remove());
        const value = clean(copy.textContent);
        attributes[label] = /^(暂无数据|暂无|未知)$/.test(value) ? null : value || null;
    }
    const numeric = value => {
        const match = value?.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    const date = attributes['挂牌时间']?.match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/);
    return {
        houseCode: location.pathname.match(/^\/ershoufang\/(\d+)\.html$/)?.[1] ?? null,
        headingText: text('h1'),
        communityText: text('.communityName .info'),
        layoutText: attributes['房屋户型'] ?? text('.houseInfo .room .mainInfo'),
        areaNumber: numeric(attributes['建筑面积'] ?? text('.houseInfo .area .mainInfo')),
        floorText: attributes['所在楼层'] ?? text('.houseInfo .room .subInfo'),
        directionText: attributes['房屋朝向'] ?? text('.houseInfo .type .mainInfo'),
        priceNumber: numeric(text('.price .total')),
        unitPriceNumber: numeric(text('.price .unitPriceValue')),
        listedDate: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : null,
        attributeValues: attributes,
    };
}

cli({
    site: 'ke',
    name: 'search',
    access: 'read',
    description: '贝壳二手房搜索，默认仅列表，--detail 补充详情及精确挂牌日期',
    example: 'opencli ke search "华润中央公园三期" --city sh --district jiading -f csv',
    domain: 'ke.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    args: [
        { name: 'query', positional: true, required: true, help: '小区名称或房源关键词' },
        { name: 'city', default: 'bj', help: '城市代码，如 bj、sh、gz、sz' },
        { name: 'district', help: '区域 URL 拼音；上海 jiading 自动映射为 jiadingqu' },
        { name: 'detail', type: 'boolean', default: false, help: '逐套访问详情页补充属性及精确挂牌日期，默认仅抓列表' },
        { name: 'limit', type: 'int', help: '最多采集数量，省略则采集全部搜索结果' },
        { name: 'timeout', type: 'int', default: 600, help: '整次采集超时秒数，默认 600；大量房源可调高' },
        { name: 'captcha-timeout', type: 'int', default: 300, help: '每次验证码等待秒数，默认 300；0 表示立即报错' },
    ],
    columns: ['id', 'title', 'community', 'layout', 'area', 'floor', 'direction', 'totalPrice', 'unitPrice', 'listingDate', 'propertyInfo', 'url'],
    func: async (page, args) => {
        const query = String(args.query ?? '').trim();
        const city = String(args.city ?? 'bj').trim().toLowerCase();
        let district = String(args.district ?? '').trim().toLowerCase();
        if (!query) throw new ArgumentError('query 不能为空');
        if (!/^[a-z]{2,20}$/.test(city)) throw new ArgumentError('city 必须是城市字母代码');
        if (district && !/^[a-z][a-z0-9]*$/.test(district)) throw new ArgumentError('district 必须是区域 URL 拼音');
        if (city === 'sh' && district === 'jiading') district = 'jiadingqu';
        const limit = args.limit === undefined ? Infinity : Number(args.limit);
        if (args.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
            throw new ArgumentError('limit 必须是正整数');
        }
        const captchaTimeout = Number(args['captcha-timeout'] ?? 300);
        if (!Number.isSafeInteger(captchaTimeout) || captchaTimeout < 0) {
            throw new ArgumentError('captcha-timeout 必须是非负整数秒数');
        }
        const base = cityUrl(city);
        const includeDetail = args.detail === true;
        const path = `/ershoufang/${district ? `${district}/` : ''}`;
        let nextUrl = `${base}${path}rs${encodeURIComponent(query)}/`;
        const listings = new Map();
        let expectedPages;
        for (let pageNumber = 1; ; pageNumber++) {
            const state = await gotoKe(page, nextUrl, { captchaTimeout });
            if (!state.href.startsWith(`${base}/ershoufang/`)) {
                throw new CommandExecutionError(`搜索页地址异常：${state.href}`);
            }
            const snapshot = await page.evaluate(`(${extractSearchPage.toString()})()`);
            const observedAt = new Date();
            if (!snapshot?.hasList) {
                if (pageNumber === 1 && /没有|未找到|无结果|抱歉/.test(snapshot?.emptyText ?? '')) {
                    throw new EmptyResultError('ke search', `没有找到“${query}”的房源`);
                }
                throw new CommandExecutionError('搜索结果容器缺失，无法确认房源完整性');
            }
            if (pageNumber === 1 && snapshot.cardCount === 0) {
                throw new EmptyResultError('ke search', `没有找到“${query}”的房源`);
            }
            if (snapshot.links.length !== snapshot.cardCount) {
                throw new CommandExecutionError('搜索卡片中有无法识别的房源链接');
            }
            const paging = snapshot.pageData;
            if (!paging || !Number.isInteger(paging.totalPage) || paging.totalPage < 1 || paging.curPage !== pageNumber) {
                throw new CommandExecutionError('分页数据缺失或页码不匹配，无法确认房源完整性');
            }
            expectedPages ??= paging.totalPage;
            if (paging.totalPage !== expectedPages) throw new CommandExecutionError('采集期间分页数量变化，请重试');
            if (!snapshot.pageTemplate?.startsWith(path)) {
                throw new ArgumentError('区域筛选未生效，请使用该城市页面中的 district URL 拼音');
            }
            let decodedTemplate;
            try { decodedTemplate = decodeURIComponent(snapshot.pageTemplate); } catch {
                throw new CommandExecutionError('分页 URL 编码异常');
            }
            if (!decodedTemplate.replace(/\/$/, '').endsWith(`rs${query}`)) {
                throw new ArgumentError('关键词筛选未生效，请检查搜索页面');
            }
            const previousSize = listings.size;
            for (const listing of snapshot.links) {
                if (!listing.detailHref.startsWith(`${base}/ershoufang/`)) {
                    throw new CommandExecutionError('房源链接不属于当前城市');
                }
                // Keep the first occurrence, including its publication text.
                if (!listings.has(listing.houseCode)) {
                    listings.set(listing.houseCode, {
                        ...listing,
                        listedDate: parseListingDate(listing.publishedText, observedAt),
                        collectedDate: parseListingDate('今天发布', observedAt),
                    });
                }
                if (listings.size >= limit) break;
            }
            if (listings.size === previousSize) throw new CommandExecutionError('分页重复或为空，采集未完成');
            if (listings.size >= limit || pageNumber === expectedPages) break;
            if (!snapshot.pageTemplate.includes('{page}')) throw new CommandExecutionError('分页 URL 模板缺失');
            nextUrl = new URL(decodedTemplate.replace('{page}', String(pageNumber + 1))
                .replace(`rs${query}`, `rs${encodeURIComponent(query)}`), base).href;
        }

        const rows = [];
        for (const [houseCode, listing] of listings) {
            const { detailHref } = listing;
            let detail = listing;
            if (includeDetail) {
                await gotoKe(page, detailHref, { captchaTimeout });
                detail = await page.evaluate(`(${extractHouseDetail.toString()})()`);
            }
            const listingDate = detail?.listedDate || listing.listedDate;
            if (!detail || detail.houseCode !== houseCode || !detail.headingText || !detail.communityText
                || !(detail.priceNumber > 0) || !(detail.unitPriceNumber > 0) || !(detail.areaNumber > 0)
                || !listingDate) {
                throw new CommandExecutionError(`房源 ${houseCode} 的${includeDetail ? '详情' : '列表信息'}、报价或挂牌时间缺失，采集未完成`);
            }
            rows.push({
                id: houseCode,
                title: detail.headingText,
                community: detail.communityText,
                layout: detail.layoutText || null,
                area: detail.areaNumber,
                floor: detail.floorText || null,
                direction: detail.directionText || null,
                totalPrice: detail.priceNumber,
                unitPrice: detail.unitPriceNumber,
                listingDate,
                propertyInfo: JSON.stringify({
                    ...detail.attributeValues,
                    发布时间: listing.publishedText || null,
                    挂牌日期来源: includeDetail && detail.listedDate ? '详情页' : '列表推算',
                    采集日期: listing.collectedDate,
                }),
                url: detailHref,
            });
        }
        return rows;
    },
});
