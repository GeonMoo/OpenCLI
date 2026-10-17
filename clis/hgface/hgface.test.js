import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import './search.js';
import './papers.js';

const search = getRegistry().get('hgface/search');
const papers = getRegistry().get('hgface/papers');
const json = body => new Response(JSON.stringify(body));
const mockFetch = body => {
    const fetch = vi.fn().mockResolvedValue(json(body));
    vi.stubGlobal('fetch', fetch);
    return fetch;
};
afterEach(() => vi.unstubAllGlobals());

describe('hgface search', () => {
    it.each([
        ['model', 'models', '', 123],
        ['dataset', 'datasets', 'datasets/', 123],
        ['space', 'spaces', 'spaces/', null],
    ])('searches %s and maps category-specific fields', async (category, endpoint, prefix, downloads) => {
        const fetch = mockFetch([{ id: 'owner/name', likes: 0, downloads: 123, pipeline_tag: 'text-generation', sdk: 'gradio' }]);
        const rows = await search.func({ query: 'test & name', class: category, limit: 2 });
        expect(rows).toEqual([{
            rank: 1, class: category, id: 'owner/name', author: 'owner', downloads, likes: 0,
            pipelineTag: category === 'model' ? 'text-generation' : null,
            sdk: category === 'space' ? 'gradio' : null, lastModified: null,
            url: `https://huggingface.co/${prefix}owner/name`,
        }]);
        expect(Object.keys(rows[0])).toEqual(search.columns);
        const url = new URL(fetch.mock.calls[0][0]);
        expect(url.pathname).toBe(`/api/${endpoint}`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ search: 'test & name', limit: '2', full: 'true' });
    });

    it('defaults to model search and applies the result limit', async () => {
        mockFetch([{ id: 'owner/first' }, { id: 'owner/second' }]);
        const rows = await search.func({ query: 'owner', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0].class).toBe('model');
    });

    it.each([{ query: '' }, { query: ' ' }, { query: 'x', class: 'invalid' }, { query: 'x', limit: 0 }, { query: 'x', limit: 101 }, { query: 'x', limit: 1.5 }])('rejects invalid arguments before fetching: %j', async args => {
        const fetch = mockFetch([]);
        await expect(search.func(args)).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('hgface papers', () => {
    const entry = { paper: { id: '2610.12345', title: 'Full paper title', upvotes: 0, authors: [{ name: 'A' }, { name: 'B' }], publishedAt: '2026-10-14T00:00:00Z', summary: 'Full summary' } };
    it.each([
        ['2026-10-16', { date: '2026-10-16', limit: '10' }],
        ['2026-10', { month: '2026-10', limit: '10' }],
        [undefined, { limit: '10' }],
        ['2024-02-29', { date: '2024-02-29', limit: '10' }],
    ])('uses the exact date or month API selector: %s', async (date, params) => {
        const fetch = mockFetch([entry]);
        const rows = await papers.func({ date });
        const url = new URL(fetch.mock.calls[0][0]);
        expect(url.pathname).toBe('/api/daily_papers');
        expect(Object.fromEntries(url.searchParams)).toEqual(params);
        expect(rows[0]).toEqual({ rank: 1, id: '2610.12345', title: 'Full paper title', upvotes: 0, authors: 'A, B', publishedAt: '2026-10-14T00:00:00Z', summary: 'Full summary', url: 'https://huggingface.co/papers/2610.12345' });
        expect(Object.keys(rows[0])).toEqual(papers.columns);
    });

    it('passes the limit to the API and preserves the server ordering', async () => {
        const fetch = mockFetch([entry, { paper: { ...entry.paper, id: '2610.99999', upvotes: 99 } }]);
        expect(await papers.func({ date: '2026-10', limit: 1 })).toHaveLength(1);
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('limit')).toBe('1');
    });

    it.each(['', '2026-02-29', '2026-02-30', '2026-13', '2026-00', '2026-04-31', '2026-1', '2026', '../2026-10', '2026-10-16&month=2025-03'])('rejects invalid dates: %s', async date => {
        const fetch = mockFetch([]);
        await expect(papers.func({ date })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([0, 101, 1.5])('rejects invalid limits: %s', async limit => {
        const fetch = mockFetch([]);
        await expect(papers.func({ limit })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe.each([[search, { query: 'x' }], [papers, { date: '2026-10' }]])('%s errors', (command, args) => {
    it.each([
        [() => json([]), 'EMPTY_RESULT'],
        [() => json({ error: 'bad response' }), 'COMMAND_EXEC'],
        [() => json([{}]), 'COMMAND_EXEC'],
        [() => json([null]), 'COMMAND_EXEC'],
        [() => new Response('not json'), 'COMMAND_EXEC'],
        [() => new Response('rate limited', { status: 429 }), 'COMMAND_EXEC'],
        [() => new Response('server error', { status: 500 }), 'COMMAND_EXEC'],
    ])('distinguishes empty results from invalid/failed responses', async (response, code) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
        await expect(command.func(args)).rejects.toMatchObject({ code });
    });
    it('wraps network failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
        await expect(command.func(args)).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
    it('reports timeouts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
        await expect(command.func(args)).rejects.toMatchObject({ code: 'TIMEOUT' });
    });
});
