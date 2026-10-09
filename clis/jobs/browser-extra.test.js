import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@geonmoo/opencli/errors';
import { extractMokaList, mapBiliResponse, searchExtra, splitJobText } from './browser-extra.js';
const mokaHtml = readFileSync(new URL('./__fixtures__/moka.html', import.meta.url), 'utf8');
afterEach(() => vi.unstubAllGlobals());
function loadMoka(content = mokaHtml) {
  const dom = new JSDOM(content, { url: 'https://app.mokahr.com/social-recruitment/tesla/46129#/jobs' });
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
  vi.stubGlobal('Event', dom.window.Event);
  return dom;
}

describe('browser recruitment responses', () => {
  it('maps Bilibili IDs, locations and full text into job fields', () => {
    const rows = mapBiliResponse({ code: 0, data: { list: [{ id: 123, positionName: '数据开发', workLocation: '上海', positionDescription: '工作职责:\n建设数仓\n工作要求:\n熟悉SQL' }] } });
    expect(rows[0]).toEqual({ jobId: '123', jobTitle: '数据开发', jobLocation: '上海', jobDescription: '工作职责:\n建设数仓', jobRequirements: '工作要求:\n熟悉SQL', jobUrl: 'https://jobs.bilibili.com/social/positions/123' });
  });
  it('keeps business empty responses separate from failed/malformed responses', () => {
    expect(mapBiliResponse({ code: 0, data: { list: [] } })).toEqual([]);
    for (const value of [{ code: -1, data: { list: [] } }, { code: 0, data: { list: null } }, { code: 0, data: { list: [{ positionName: 'x' }] } }]) {
      expect(() => mapBiliResponse(value)).toThrow(CommandExecutionError);
    }
  });
  it('splits Chinese requirement headings and leaves unavailable requirements null', () => {
    expect(splitJobText('职责\n任职资格\n要求')).toEqual(['职责', '任职资格\n要求']);
    expect(splitJobText('职责')).toEqual(['职责', null]);
  });
  it('reads Moka card titles without the urgent badge and does not mistake a department for a city', () => {
    loadMoka();
    const state = extractMokaList();
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({ jobId: '9057d521-fb1a-4ae3-83bf-c119b3fd938f', jobTitle: '维修技师-浙江杭州富阳', jobLocation: null, jobUrl: 'https://app.mokahr.com/social-recruitment/tesla/46129#/job/9057d521-fb1a-4ae3-83bf-c119b3fd938f' });
  });
  it('chooses the visible Moka input and dispatches input/change before clicking the search button', async () => {
    const dom = loadMoka(`<form><input id="hidden" placeholder="输入职位关键字"></form><form><input id="visible" placeholder="输入职位关键字"></form><button>搜索职位</button>${mokaHtml}`);
    const hidden = dom.window.document.querySelector('#hidden'), visible = dom.window.document.querySelector('#visible');
    hidden.checkVisibility = () => false;
    visible.checkVisibility = () => true;
    const button = dom.window.document.querySelector('button');
    button.checkVisibility = () => true;
    const actions = [];
    visible.addEventListener('input', () => actions.push(`input:${visible.value}`));
    visible.addEventListener('change', () => actions.push(`change:${visible.value}`));
    button.addEventListener('click', () => actions.push(`search:${visible.value}`));
    const page = { goto: vi.fn(), evaluate: async (fn, ...args) => fn(...args), wait: vi.fn(), installInterceptor: vi.fn(), getInterceptedRequests: vi.fn().mockResolvedValue([{}]) };
    const rows = await searchExtra(page, { id: 'tesla', type: 'mokahr', url: dom.window.location.href }, '数据开发', 1, 1);
    expect(hidden.value).toBe('');
    expect(actions).toEqual(['input:数据开发', 'change:数据开发', 'search:数据开发']);
    expect(rows).toHaveLength(1);
  });
});
