import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { githubFetch } from './api.js';

const STAR_ACCEPT = 'application/vnd.github.star+json';
const GITHUB_USERNAME = /^(?!-)(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function positiveInteger(value, defaultValue, label) {
  const number = Number(value ?? defaultValue);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ArgumentError(`github stars ${label} must be a positive integer`);
  }
  return number;
}

function nextPage(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2].split(/\s+/).includes('next')) return match[1];
  }
  return null;
}

function normalizeStar(item) {
  const repository = item?.repo;
  if (!repository || typeof repository.full_name !== 'string' || !repository.full_name.trim()) {
    throw new CommandExecutionError('github stars returned a row without repo.full_name');
  }
  if (typeof item.starred_at !== 'string' || !Number.isFinite(Date.parse(item.starred_at))) {
    throw new CommandExecutionError('github stars returned a row without a valid starred_at timestamp');
  }

  return {
    fullName: repository.full_name,
    description: typeof repository.description === 'string' ? repository.description : null,
    language: typeof repository.language === 'string' ? repository.language : null,
    stars: typeof repository.stargazers_count === 'number' ? repository.stargazers_count : null,
    forks: typeof repository.forks_count === 'number' ? repository.forks_count : null,
    starredAt: item.starred_at,
    url: typeof repository.html_url === 'string' && repository.html_url
      ? repository.html_url
      : `https://github.com/${repository.full_name}`,
  };
}

cli({
  site: 'github',
  name: 'stars',
  access: 'read',
  description: 'List repositories starred by a GitHub user, newest stars first',
  domain: 'api.github.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'username', positional: true, required: true, help: 'GitHub username (e.g. octocat)' },
    { name: 'limit', type: 'int', default: 10, help: 'Maximum repositories to return (default: 10)' },
  ],
  columns: ['rank', 'fullName', 'description', 'language', 'stars', 'forks', 'starredAt', 'url'],
  func: async (args) => {
    const username = String(args.username ?? '').trim();
    if (!username) throw new ArgumentError('github stars username is required');
    if (!GITHUB_USERNAME.test(username)) {
      throw new ArgumentError('github stars username must be 1-39 letters, numbers, or single hyphens');
    }
    const limit = positiveInteger(args.limit, 10, 'limit');

    // GitHub caps each page at 100; larger requested totals continue through Link pagination.
    const pageSize = limit > 100 ? 100 : limit;
    let url = `https://api.github.com/users/${encodeURIComponent(username)}/starred?sort=created&direction=desc&per_page=${pageSize}`;
    const stars = [];

    while (url && stars.length < limit) {
      const response = await githubFetch(url, STAR_ACCEPT);
      let page;
      try {
        page = await response.json();
      } catch (error) {
        throw new CommandExecutionError(`github stars returned malformed JSON: ${error?.message ?? error}`);
      }
      if (!Array.isArray(page)) {
        throw new CommandExecutionError('github stars returned an unexpected payload shape');
      }

      const followingUrl = nextPage(response.headers.get('link'));
      if (!page.length && followingUrl) {
        throw new CommandExecutionError('github stars returned an empty page with a next-page link');
      }
      stars.push(...page.map(normalizeStar));
      url = followingUrl;
      if (url && stars.length < limit) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!stars.length) {
      throw new EmptyResultError('github stars', `GitHub user "${username}" has no visible starred repositories.`);
    }

    return stars
      .sort((a, b) => Date.parse(b.starredAt) - Date.parse(a.starredAt))
      .slice(0, limit)
      .map((star, index) => ({ rank: index + 1, ...star }));
  },
});
