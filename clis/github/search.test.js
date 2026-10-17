import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import './search.js';
import './trend.js';

const search = getRegistry().get('github/search');
const json = body => new Response(JSON.stringify(body), { status: 200 });
const web = (type, results, extra = {}) => new Response(`<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { blackbirdSearchRoute: { type, results, result_count: results.length, page_count: 1, ...extra } } })}</script>`);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('github search', () => {
    it.each([
        ['repositories', { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', stargazers_count: 42, language: 'JS', owner: { login: 'owner' } }, 'owner/repo'],
        ['issues', { title: 'Fix bug', html_url: 'https://github.com/owner/repo/issues/1', repository_url: 'https://api.github.com/repos/owner/repo', state: 'open' }, 'Fix bug'],
        ['pullrequests', { title: 'Fix PR', html_url: 'https://github.com/owner/repo/pull/1' }, 'Fix PR'],
        ['users', { login: 'octocat', html_url: 'https://github.com/octocat' }, 'octocat'],
        ['commits', { commit: { message: 'Fix bug', author: { date: '2026-01-01' } }, html_url: 'https://github.com/owner/repo/commit/abc' }, 'Fix bug'],
        ['topics', { name: 'cli', description: 'Tools' }, 'cli'],
        ['code', { name: 'main.js', path: 'src/main.js', html_url: 'https://github.com/owner/repo/blob/main/src/main.js', repository: { full_name: 'owner/repo' } }, 'main.js'],
    ])('maps REST %s into structured columns', async (type, item, title) => {
        vi.stubEnv('GITHUB_TOKEN', 'test-token');
        const fetch = vi.fn().mockResolvedValue(json({ items: [item], incomplete_results: false }));
        vi.stubGlobal('fetch', fetch);
        const rows = await search.func({ query: 'test & stars:>1', type });
        expect(rows[0]).toMatchObject({ rank: 1, type, title });
        expect(Object.keys(rows[0])).toEqual(search.columns);
        const request = new URL(String(fetch.mock.calls[0][0]));
        expect(request.searchParams.get('per_page')).toBe('10');
        expect(request.searchParams.get('q')).toBe(type === 'issues' ? 'test & stars:>1 is:issue' : type === 'pullrequests' ? 'test & stars:>1 is:pr' : 'test & stars:>1');
        expect(request.pathname).toBe(`/search/${type === 'pullrequests' ? 'issues' : type}`);
    });

    it.each([
        ['discussions', 'discussions', { hl_title: 'Help &amp; <em>CLI</em>', url: '/o/r/discussions/1', hl_text: 'A &#x2F; B', repo: { repository: { owner_login: 'o', name: 'r' } } }, 'https://github.com/o/r/discussions/1'],
        ['packages', 'registrypackages', { name: 'cli', package_url: '/o/r/packages/1', summary: 'CLI', repo: { owner_login: 'o', name: 'r' } }, 'https://github.com/o/r/packages/1'],
        ['wikis', 'wikis', { hl_title: '<em>CLI</em> Guide', repo: { repository: { owner_login: 'o', name: 'r' } } }, 'https://github.com/o/r/wiki/CLI-Guide'],
        ['marketplace', 'marketplace', { name: 'CLI action', resource_path: '/marketplace/actions/cli', description: 'Action' }, 'https://github.com/marketplace/actions/cli'],
    ])('maps public HTML %s and uses the correct web category', async (type, webType, item, url) => {
        const fetch = vi.fn().mockResolvedValue(web(webType, [item]));
        vi.stubGlobal('fetch', fetch);
        const rows = await search.func({ query: 'cli', type });
        expect(rows[0].url).toBe(url);
        expect(Object.keys(rows[0])).toEqual(search.columns);
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('type')).toBe(webType);
        if (type === 'discussions') expect(rows[0]).toMatchObject({ title: 'Help & CLI', description: 'A / B' });
    });

    it('paces web pagination and stops at the requested limit', async () => {
        vi.useFakeTimers();
        const item = n => ({ name: `pkg${n}`, package_url: `/o/r/packages/${n}` });
        const fetch = vi.fn()
            .mockResolvedValueOnce(web('registrypackages', [item(1)], { result_count: 3, page_count: 3 }))
            .mockResolvedValueOnce(web('registrypackages', [item(2), item(3)], { result_count: 3, page_count: 3 }));
        vi.stubGlobal('fetch', fetch);
        const result = search.func({ query: 'cli', type: 'packages', limit: 2 });
        await vi.advanceTimersByTimeAsync(5999);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toHaveLength(2);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([{ query: '' }, { query: 'x', type: 'invalid' }, { query: 'x', limit: 0 }, { query: 'x', limit: 101 }, { query: 'x', limit: 1.5 }])('validates before making requests: %j', async args => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(search.func(args)).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('requires a token for code search', async () => {
        vi.stubEnv('GITHUB_TOKEN', '');
        vi.stubEnv('GH_TOKEN', '');
        await expect(search.func({ query: 'cli', type: 'code' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it.each([
        [() => json({ items: [] }), {} , 'EMPTY_RESULT'],
        [() => json({ items: [], incomplete_results: true }), {}, 'COMMAND_EXEC'],
        [() => json({ wrong: [] }), {}, 'COMMAND_EXEC'],
        [() => new Response('bad json'), {}, 'COMMAND_EXEC'],
        [() => web('wikis', []), { type: 'wikis' }, 'EMPTY_RESULT'],
        [() => web('repositories', []), { type: 'packages' }, 'COMMAND_EXEC'],
        [() => new Response('<html>Sign in</html>'), { type: 'wikis' }, 'COMMAND_EXEC'],
        [() => web('discussions', [{ title: 'X', url: 'https://evil.example/x' }]), { type: 'discussions' }, 'COMMAND_EXEC'],
        [() => new Response('rate limit', { status: 429 }), { type: 'wikis' }, 'COMMAND_EXEC'],
    ])('distinguishes empty, incomplete, malformed and failed responses', async (response, args, code) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
        await expect(search.func({ query: 'cli', ...args })).rejects.toMatchObject({ code });
    });
});

describe('github trend', () => {
    const trend = getRegistry().get('github/trend');
    const legacy = getRegistry().get('github-trending/repos');
    it('reuses the existing parser and keeps legacy defaults', () => {
        expect(trend.func).toBe(legacy.func);
        expect(trend.args.find(arg => arg.name === 'limit').default).toBe(10);
        expect(legacy.args.find(arg => arg.name === 'limit').default).toBe(25);
    });
    it('parses public trending counts and filters', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(`<article class="Box-row">
          <h2><a href="/o/r">o / r</a></h2><p class="col-9 color-fg-muted">A &amp; B</p>
          <span itemprop="programmingLanguage">Rust</span>
          <a href="/o/r/stargazers">1,234</a><a href="/o/r/forks">12</a>34 stars this week</article>`));
        vi.stubGlobal('fetch', fetch);
        expect(await trend.func({ since: 'weekly', language: 'c++', limit: 10 })).toEqual([
            { rank: 1, repo: 'o/r', description: 'A & B', language: 'Rust', stars: 1234, forks: 12, starsSince: 34, url: 'https://github.com/o/r' },
        ]);
        expect(String(fetch.mock.calls[0][0])).toBe('https://github.com/trending/c%2B%2B?since=weekly');
    });
});
