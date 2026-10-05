import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import './news.js';

const html = readFileSync(new URL('./__fixtures__/news.html', import.meta.url), 'utf8');
const command = getRegistry().get('jinshi/news');

afterEach(() => vi.unstubAllGlobals());

function loadPage(markup = html) {
    const dom = new JSDOM(markup);
    vi.stubGlobal('document', dom.window.document);
    return {
        goto: vi.fn(),
        wait: vi.fn(),
        evaluate: vi.fn(async (extract) => extract()),
    };
}

it('reads all loaded news, full titles/content, multiline text and midnight dates from real HTML', async () => {
    const page = loadPage();
    const feed = document.querySelector('#jin_flash_list');
    // More than the usual 20-row default: no implicit limit may drop news.
    for (let i = 0; i < 26; i++) feed.append(feed.lastElementChild.cloneNode(true));
    const rows = await command.func(page, {});
    expect(rows).toHaveLength(29);
    expect(Object.keys(rows[0])).toEqual(command.columns);
    expect(rows[0].title).toBe('英国海上贸易行动办公室：3艘船在霍尔木兹海峡遭袭');
    expect(rows[0].content).toMatch(/^金十数据10月6日讯，.*船长确认船只已按照要求掉头。\（新华社\）$/);
    expect(rows[1].timestamp).toBe('2026-10-06T00:00:00+08:00');
    expect(rows[1].content.split('\n')).toHaveLength(10);
    expect(rows[1].content).toContain('⑩ 次日04:30 美国至10月2日当周API原油库存');
    expect(rows[2]).toEqual({
        timestamp: '2026-10-05T23:58:20+08:00',
        title: '道达尔能源首席执行官：莫桑比克液化天然气项目容易增加两个额外的生产线。',
        content: '道达尔能源首席执行官：莫桑比克液化天然气项目容易增加两个额外的生产线。',
        url: 'https://flash.jin10.com/detail/20261005235820863800',
    });
    expect(page.goto).toHaveBeenCalledWith('https://www.jin10.com/', expect.any(Object));
    expect(page.wait).toHaveBeenCalledWith(expect.objectContaining({ selector: '#jin_flash_list .jin-flash-item-container' }));
});

it('reports missing fields, empty data, extraction failure and loading timeout as typed errors', async () => {
    const page = loadPage();
    document.querySelector('.flash-text').remove();
    await expect(command.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    loadPage(html.replace('flash20261006000700055800', 'flashbad'));
    await expect(command.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    loadPage('<div id="jin_flash_list"></div>');
    await expect(command.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    page.evaluate.mockRejectedValue(new Error('closed tab'));
    await expect(command.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    page.wait.mockRejectedValue(new Error('not loaded'));
    await expect(command.func(page, {})).rejects.toBeInstanceOf(TimeoutError);
});

it('keeps calendar/news table content when there is no flash-text wrapper', async () => {
    const page = loadPage('<div id="jin_flash_list"><div class="jin-flash-item-container" id="flash20261005233205459800"><div class="right-content">美国国债竞拍<br>得标利率 4.165%</div></div></div>');
    const rows = await command.func(page, {});
    expect(rows[0].content).toBe('美国国债竞拍\n得标利率 4.165%');
    expect(rows[0].title).toBe(rows[0].content);
});
