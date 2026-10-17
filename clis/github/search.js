import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { githubFetch } from './api.js';

const REST_TYPES = { code: 'code', repositories: 'repositories', issues: 'issues', pullrequests: 'issues', users: 'users', commits: 'commits', topics: 'topics' };
const WEB_TYPES = { discussions: 'discussions', packages: 'registrypackages', wikis: 'wikis', marketplace: 'marketplace' };
const TYPES = [...Object.keys(REST_TYPES), ...Object.keys(WEB_TYPES)];

function plainText(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
        if (!code.startsWith('#')) return entities[code.toLowerCase()];
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }).trim();
}

export function parseWebSearch(html, expectedType) {
    const match = html.match(/<script\b[^>]*data-target="react-app.embeddedData"[^>]*>([\s\S]*?)<\/script>/);
    let data;
    try {
        const payload = JSON.parse(match?.[1] ?? '').payload;
        data = payload?.blackbirdSearchRoute ?? payload;
    } catch {
        throw new CommandExecutionError('GitHub search page changed: missing search data');
    }
    if (data?.type !== expectedType || !Array.isArray(data?.results) || !Number.isInteger(data?.result_count)) {
        throw new CommandExecutionError('GitHub search page changed: unexpected search result shape');
    }
    if (data.errors?.length) throw new CommandExecutionError(`GitHub search: ${JSON.stringify(data.errors)}`);
    return data;
}

function webRow(item, type) {
    const repository = item.repo?.repository ?? item.repo;
    const repo = repository?.owner_login && repository?.name ? `${repository.owner_login}/${repository.name}` : null;
    const title = plainText(item.hl_title ?? item.title ?? item.name);
    const path = item.url ?? item.package_url ?? item.resource_path
        ?? (type === 'wikis' && repo && title ? `/${repo}/wiki/${encodeURIComponent(title.replace(/ /g, '-'))}` : null);
    const url = path ? new URL(path, 'https://github.com').href : null;
    if (!title || !url || new URL(url).origin !== 'https://github.com') {
        throw new CommandExecutionError(`GitHub ${type} parser drift: missing title or GitHub URL`);
    }
    return {
        title,
        description: plainText(item.hl_text ?? item.hl_body ?? item.summary ?? item.description ?? item.body),
        repo,
        owner: item.user_login ?? item.owner_login ?? repository?.owner_login ?? null,
        stars: item.stars ?? null,
        language: null,
        state: null,
        updatedAt: item.updated ?? item.updated_at ?? null,
        url,
    };
}

function restRow(item, type) {
    const repo = type === 'repositories' ? item.full_name : item.repository?.full_name
        ?? (item.repository_url ? item.repository_url.replace('https://api.github.com/repos/', '') : null);
    const title = type === 'commits' ? item.commit?.message : item.full_name ?? item.title ?? item.login ?? item.name;
    const url = item.html_url ?? (type === 'topics' ? `https://github.com/topics/${encodeURIComponent(item.name)}` : null);
    if (!title || !url) throw new CommandExecutionError(`GitHub ${type}: missing title or URL`);
    return {
        title,
        description: item.description ?? item.body ?? item.commit?.message ?? '',
        repo: repo ?? null,
        owner: item.owner?.login ?? item.user?.login ?? item.author?.login ?? (type === 'users' ? item.login : null),
        stars: item.stargazers_count ?? null,
        language: item.language ?? null,
        state: item.state ?? null,
        updatedAt: item.updated_at ?? item.commit?.author?.date ?? null,
        url,
    };
}

cli({
    site: 'github',
    name: 'search',
    access: 'read',
    description: 'Search GitHub repositories, code, issues, PRs, discussions, users, commits, packages, wikis, topics or marketplace',
    domain: 'github.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'GitHub query, including qualifiers such as language:python' },
        { name: 'type', type: 'string', default: 'repositories', choices: TYPES, help: 'Search category (default: repositories); code requires GITHUB_TOKEN or GH_TOKEN' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
    ],
    columns: ['rank', 'type', 'title', 'description', 'repo', 'owner', 'stars', 'language', 'state', 'updatedAt', 'url'],
    func: async (args) => {
        const query = String(args.query ?? '').trim();
        const type = String(args.type ?? 'repositories').toLowerCase();
        const limit = Number(args.limit ?? 10);
        if (!query) throw new ArgumentError('query must not be empty');
        if (!TYPES.includes(type)) throw new ArgumentError(`Unknown --type "${type}". Valid: ${TYPES.join(', ')}`);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ArgumentError('--limit must be an integer from 1 to 100');
        let rows;
        if (REST_TYPES[type]) {
            if (type === 'code' && !(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) {
                throw new AuthRequiredError('api.github.com', 'GitHub code search requires a token', 'Set GITHUB_TOKEN or GH_TOKEN');
            }
            const q = type === 'issues' ? `${query} is:issue` : type === 'pullrequests' ? `${query} is:pr` : query;
            const params = new URLSearchParams({ q, per_page: String(limit) });
            const response = await githubFetch(`https://api.github.com/search/${REST_TYPES[type]}?${params}`);
            let data;
            try { data = await response.json(); }
            catch { throw new CommandExecutionError('GitHub search returned invalid JSON'); }
            if (!Array.isArray(data?.items)) throw new CommandExecutionError('GitHub search returned an unexpected response');
            if (data.incomplete_results) throw new CommandExecutionError('GitHub search returned incomplete results', 'Narrow the query and try again');
            rows = data.items.slice(0, limit).map(item => restRow(item, type));
        } else {
            rows = [];
            for (let page = 1; rows.length < limit; page++) {
                if (page > 1) await new Promise(resolve => setTimeout(resolve, 6000));
                const params = new URLSearchParams({ q: query, type: WEB_TYPES[type], p: String(page) });
                let response;
                try {
                    response = await fetch(`https://github.com/search?${params}`, {
                        headers: { Accept: 'text/html', 'User-Agent': 'opencli' },
                        signal: AbortSignal.timeout(30000),
                    });
                } catch (error) { throw new CommandExecutionError(`GitHub search request failed: ${error.message}`); }
                if (!response.ok) throw new CommandExecutionError(`GitHub web search HTTP ${response.status}`, 'Wait before retrying if GitHub has rate limited the request');
                const data = parseWebSearch(await response.text(), WEB_TYPES[type]);
                rows.push(...data.results.slice(0, limit - rows.length).map(item => webRow(item, type)));
                if (!data.results.length || rows.length >= data.result_count || page >= data.page_count) break;
            }
        }
        if (!rows.length) throw new EmptyResultError('github search', `No ${type} matched "${query}"`);
        return rows.map((row, index) => ({ rank: index + 1, type, ...row }));
    },
});
