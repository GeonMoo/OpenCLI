import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';
import { searchApi } from './providers.js';
import { COMPANIES } from './companies.js';
afterEach(() => vi.restoreAllMocks());
const response = body => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
const company = id => COMPANIES.find(c => c.id === id);
const baidu = (id, total = 20) => ({ status: 'ok', data: { list: [{ postId: id, name: '数据开发', workPlace: '北京', workContent: '职责', serviceCondition: '要求' }], total } });

describe('jobs API providers', () => {
  it('preserves keyword and requests distinct Baidu page numbers', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(baidu('1'))).mockResolvedValueOnce(response(baidu('2')));
    const jobs = await searchApi(company('baidu'), '数据开发', 2, 2);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ jobId: '1', jobTitle: '数据开发', jobLocation: '北京', jobRequirements: '要求' });
    expect(fetcher.mock.calls.map(call => call[1].body.get('curPage'))).toEqual(['1', '2']);
    expect(fetcher.mock.calls[0][1].body.get('keyWord')).toBe('数据开发');
    expect(fetcher.mock.calls[0][1].headers.Origin).toBe('https://talent.baidu.com');
  });
  it('stops at the declared last page and rejects repeated pagination', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(baidu('1', 1)));
    expect(await searchApi(company('baidu'), '数据开发', 3)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(response(baidu('1', 30)));
    await expect(searchApi(company('baidu'), '数据开发', 2)).rejects.toThrow(/repeated/);
  });
  it('rejects business errors, schema drift and incomplete records', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const payload of [{ status: 'error', data: { list: [] } }, { status: 'ok', data: { list: null } }, { status: 'ok', data: { list: [{ name: '数据开发' }] } }]) {
      fetcher.mockResolvedValue(response(payload));
      await expect(searchApi(company('baidu'), 'x')).rejects.toThrow(CommandExecutionError);
    }
  });
  it('distinguishes valid zero jobs from failed requests', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'ok', data: { list: [], total: 0 } }));
    expect(await searchApi(company('baidu'), 'x')).toEqual([]);
    fetcher.mockResolvedValue({ ok: false, status: 503 });
    await expect(searchApi(company('baidu'), 'x')).rejects.toThrow(CommandExecutionError);
    fetcher.mockResolvedValue({ ok: false, status: 401 });
    await expect(searchApi(company('baidu'), 'x')).rejects.toThrow(AuthRequiredError);
    fetcher.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(searchApi(company('baidu'), 'x')).rejects.toThrow(TimeoutError);
  });
  it('bootstraps the correct Alibaba tenant and forwards only cookie pairs', async () => {
    const boot = { ok: true, status: 200, headers: new Headers({ 'set-cookie': 'XSRF-TOKEN=abc%20xyz; Path=/; HttpOnly' }), text: async () => '' };
    const payload = { success: true, content: { datas: [{ id: 'a1', name: '数据开发', workLocations: ['杭州'], description: 'd', requirement: 'r', positionUrl: '/off-campus/position-detail?positionId=a1' }], totalCount: 1 } };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(boot).mockResolvedValueOnce(response(payload));
    const jobs = await searchApi(company('taotian'), '数据开发');
    expect(jobs[0]).toMatchObject({ jobId: 'a1', jobLocation: '杭州', jobUrl: 'https://talent.taotian.com/off-campus/position-detail?positionId=a1' });
    expect(fetcher.mock.calls[0][0]).toBe(company('taotian').url);
    expect(fetcher.mock.calls[1][0]).toBe('https://talent.taotian.com/position/search?_csrf=abc%20xyz');
    expect(fetcher.mock.calls[1][1].headers.Cookie).toBe('XSRF-TOKEN=abc%20xyz');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).key).toBe('数据开发');
  });
  it('keeps Tencent 64-bit IDs as strings and forwards search parameters', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ Code: 200, Data: { Count: 1, Posts: [{ PostId: '2086751238980022272', RecruitPostName: '数据开发', LocationName: '深圳', Responsibility: 'd' }] } }));
    const jobs = await searchApi(company('tencent'), '数据开发');
    expect(jobs[0].jobId).toBe('2086751238980022272');
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('keyword')).toBe('数据开发');
    expect(url.searchParams.get('pageIndex')).toBe('1');
    expect(fetcher.mock.calls[0][1].headers.Referer).toBe(company('tencent').url);
  });
  it('sends Huawei Origin/Referer required by the live endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'SUCCESS', data: { result: [{ advertisementId: 123, jobNameNew: '数据开发', workPlace: '北京', jobRequire: 'r' }], pageVO: { totalPages: 1 } } }));
    const jobs = await searchApi(company('huawei'), '数据开发');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Origin: 'https://career.huawei.com', Referer: 'https://career.huawei.com/', 'X-HW-ID': 'app_000000035886' });
    expect(jobs[0].jobUrl).toBe('https://career.huawei.com/cn/job-details?advertisementId=123');
  });
  it('validates Xiaohongshu success status before accepting an empty list', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ success: true, data: { list: [], totalPage: 0 } }));
    expect(await searchApi(company('xiaohongshu'), 'x')).toEqual([]);
    fetcher.mockResolvedValue(response({ success: false, data: { list: [] } }));
    await expect(searchApi(company('xiaohongshu'), 'x')).rejects.toThrow(CommandExecutionError);
  });
  it('locally filters PDD hot/latest cards and stops after its single page even with a larger page budget', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ result: { latestPositionList: [{ code: 'a', name: '数据开发' }, { code: 'b', name: '产品经理' }], hottestPositionList: [{ code: 'a', name: '数据开发' }] } }));
    const jobs = await searchApi(company('pdd'), '数据开发');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobDescription).toBeNull();
    fetcher.mockClear();
    expect(await searchApi(company('pdd'), '数据开发', 3)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fetches Tencent requirements only when details are requested', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ Code: 200, Data: { Count: 1, Posts: [{ PostId: '1', RecruitPostName: '数据开发' }] } }))
      .mockResolvedValueOnce(response({ Data: { Responsibility: 'd', Requirement: 'r' } }));
    const jobs = await searchApi(company('tencent'), '数据开发', 1, 20, true);
    expect(jobs[0].jobRequirements).toBe('r');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('validates query, pages, timeout and provider before fetching', async () => {
    for (const args of [[company('baidu'), ' ', 1], [company('baidu'), 'x', 0], [company('baidu'), 'x', 1, 0], [{ id: 'unknown' }, 'x', 1]]) {
      await expect(searchApi(...args)).rejects.toThrow(ArgumentError);
    }
  });
});
