import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { extractFeishuList, extractFeishuDetail, searchFeishu } from './feishu.js';
const html = readFileSync(new URL('./__fixtures__/feishu.html', import.meta.url), 'utf8');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function load(content) {
  const dom = new JSDOM(content, { url: 'https://xiaomi.jobs.f.mioffice.cn/index/?keywords=数据开发' });
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  return dom;
}

describe('Feishu live DOM extraction', () => {
  it('extracts real Xiaomi titles, location and 64-bit IDs from frozen adjacent spans', () => {
    load(html);
    const state = extractFeishuList();
    expect(state.jobs).toHaveLength(3);
    expect(state.jobs[0]).toMatchObject({ jobId: '7662198196123748634', jobTitle: '大数据开发工程师', jobLocation: '北京', jobRequirements: null, jobUrl: 'https://xiaomi.jobs.f.mioffice.cn/index/position/7662198196123748634/detail' });
    expect(state.jobs[0].jobDescription).toContain('企业级数据仓库');
    expect(state.jobs[2].jobTitle).toBe('高级大数据开发工程师');
  });
  it('separates job requirements from duties and ignores empty content', () => {
    load('<div class="block-title">职位描述</div><div class="block-content">建设数据平台</div><div class="block-title">职位要求</div><div class="block-content">熟悉 SQL</div>');
    expect(extractFeishuDetail()).toEqual({ jobDescription: '建设数据平台', jobRequirements: '熟悉 SQL' });
  });
  it('recognizes an explicit empty state and a disabled next page', () => {
    load('<div>暂无匹配职位</div><li class="atsx-pagination-next atsx-pagination-disabled" aria-disabled="true"></li>');
    expect(extractFeishuList()).toMatchObject({ empty: true, nextPage: false, jobs: [] });
  });
  it('does not mistake a generic loading page for no jobs', () => {
    load('<main>小米招聘 加载中</main>');
    expect(extractFeishuList()).toMatchObject({ empty: false, jobs: [] });
  });
  it('requests each page with full keyword and catches repeated pagination', async () => {
    load(html);
    const state = { ...extractFeishuList(), nextPage: true };
    const page = { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(state), wait: vi.fn() };
    await expect(searchFeishu(page, { id: 'xiaomi', url: 'https://xiaomi.jobs.f.mioffice.cn/index/' }, '数据开发', 2, 1)).rejects.toThrow(CommandExecutionError);
    expect(new URL(page.goto.mock.calls[1][0]).searchParams.get('current')).toBe('2');
    expect(new URL(page.goto.mock.calls[0][0]).searchParams.get('keywords')).toBe('数据开发');
  });
  it('times out on missing cards rather than reporting a valid empty response', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(2000);
    const page = { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue({ jobs: [], empty: false }), wait: vi.fn() };
    await expect(searchFeishu(page, { id: 'xiaomi', url: 'https://example.com' }, 'x', 1, 1)).rejects.toThrow(TimeoutError);
  });
});
