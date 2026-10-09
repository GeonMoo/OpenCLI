import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { __test__, extractJobDetail, resolveDetailTarget } from './detail.js';

const fixture = readFileSync(new URL('./__fixtures__/detail.html', import.meta.url), 'utf8');
const command = getRegistry().get('liepin/detail');
afterEach(() => vi.unstubAllGlobals());

function load(html = fixture, url = 'https://www.liepin.com/job/1983933935.shtml') {
    const dom = new JSDOM(html, { url });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);
    return dom;
}

function pageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async fn => new Function(`return (${fn.toString()})()`)()),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

describe('liepin detail', () => {
    it('registers a read-only rendered-page command with search-compatible camelCase fields', () => {
        expect(command).toMatchObject({ access: 'read', strategy: Strategy.UI, browser: true });
        expect(command.columns.slice(0, 9)).toEqual([
            'name', 'salary', 'company', 'area', 'experience', 'degree',
            'recruiter', 'recruiterActive', 'jobId',
        ]);
    });

    it('extracts a sanitized snapshot of the observed live Liepin detail DOM', async () => {
        load();
        const rows = await command.func(pageMock(), { jobId: '1983933935' });
        expect(rows[0]).toEqual({
            name: '示例数据工程师', salary: '20-30k·13薪', company: '示例科技有限公司',
            area: '上海', experience: '3-5年', degree: '本科', recruiter: '示例招聘官',
            recruiterActive: '刚刚在线', jobId: '1983933935',
            description: '负责数据平台建设。\n确保数据质量。',
            extras: {
                address: '上海示例路 8 号', skills: 'SQL, Python', welfare: '五险一金, 餐补',
                recruiterTitle: '招聘经理', recruiterCompany: '示例科技有限公司',
                companyIndustry: '计算机软件', companyScale: '100-499人',
            },
            url: 'https://www.liepin.com/job/1983933935.shtml',
        });
        expect(Object.keys(rows[0])).toEqual(command.columns);
        expect(Object.keys(rows[0]).length).toBeLessThanOrEqual(12);
    });

    it('uses the canonical path ID instead of Liepin internal identifiers', () => {
        load(fixture.replace('</body>', '<a data-jobid="83933935"></a></body>'));
        const snapshot = extractJobDetail();
        expect(snapshot.currentJobId).toBe('1983933935');
        expect(__test__.snapshotToRow(snapshot, resolveDetailTarget('1983933935')).jobId).toBe('1983933935');
    });

    it('accepts numeric IDs and exact canonical job/a URLs while preserving full URLs', () => {
        expect(resolveDetailTarget('80151359', 'a')).toEqual({
            targetId: '80151359', pathKind: 'a', targetUrl: 'https://www.liepin.com/a/80151359.shtml',
        });
        const full = 'https://www.liepin.com/a/80151359.shtml';
        expect(resolveDetailTarget(full, 'job')).toEqual({ targetId: '80151359', pathKind: 'a', targetUrl: full });
    });

    it('rejects offsite, arbitrary, noncanonical and malformed inputs before navigation', async () => {
        const page = pageMock();
        for (const jobId of [
            'https://example.com/job/123.shtml', 'https://www.liepin.com/zhaopin/123',
            'https://www.liepin.com/job/123.shtml?x=1', '/job/123.shtml', '../write-action',
        ]) {
            await expect(command.func(page, { jobId })).rejects.toThrow(ArgumentError);
        }
        await expect(command.func(page, { jobId: '123', type: 'other' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('preserves the full a URL through navigation and output', async () => {
        load(fixture, 'https://www.liepin.com/a/80151359.shtml');
        const page = pageMock();
        const url = 'https://www.liepin.com/a/80151359.shtml';
        expect((await command.func(page, { jobId: url }))[0].url).toBe(url);
        expect(page.goto).toHaveBeenCalledWith(url);
    });

    it('distinguishes expired redirects, login walls, security checks, layout drift and timeouts', async () => {
        const expired = pageMock();
        expired.evaluate.mockResolvedValue({ currentUrl: 'https://c.liepin.com/', hasDetailLayout: false });
        await expect(command.func(expired, { jobId: '1984994649' })).rejects.toThrow(EmptyResultError);

        for (const [snapshot, ErrorType] of [
            [{ needsAuth: true }, AuthRequiredError],
            [{ blocked: true }, CommandExecutionError],
        ]) {
            const page = pageMock();
            page.evaluate.mockResolvedValue(snapshot);
            await expect(command.func(page, { jobId: '123' })).rejects.toThrow(ErrorType);
        }
        const drift = pageMock();
        drift.evaluate.mockResolvedValue({ currentUrl: 'https://www.liepin.com/job/123.shtml', currentJobId: '123', currentType: 'job', hasDetailLayout: true });
        await expect(command.func(drift, { jobId: '123' })).rejects.toThrow(CommandExecutionError);

        const timeout = pageMock();
        timeout.evaluate.mockResolvedValue({ currentUrl: 'https://www.liepin.com/job/123.shtml', hasDetailLayout: false });
        await expect(command.func(timeout, { jobId: '123' })).rejects.toThrow(TimeoutError);
    });
});
