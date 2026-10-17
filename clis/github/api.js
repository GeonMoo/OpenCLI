import { AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';

const API_TIMEOUT_SECONDS = 15;
const USER_AGENT = 'opencli-github-adapter (+https://github.com/GeonMoo/OpenCLI)';

function rateLimitHint(response) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) return `Wait ${retryAfter} seconds before retrying.`;

  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return `Wait until ${new Date(reset * 1000).toISOString()} before retrying.`;
  }

  return 'Wait at least one minute before retrying, or set GITHUB_TOKEN (or GH_TOKEN) for a higher rate limit.';
}

/** Fetch a GitHub REST URL and return the Response so callers can inspect pagination headers. */
export async function githubFetch(url, accept = 'application/vnd.github+json') {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new CommandExecutionError('GitHub API refused an invalid request URL');
  }
  if (target.protocol !== 'https:' || target.hostname !== 'api.github.com' || target.username || target.password) {
    throw new CommandExecutionError('GitHub API refused an unsafe request URL');
  }

  const headers = {
    accept,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(target.href, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_SECONDS * 1000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new TimeoutError(
        'GitHub API request',
        API_TIMEOUT_SECONDS,
        'Check api.github.com connectivity, then retry.',
      );
    }
    throw new CommandExecutionError(
      `GitHub API request failed: ${error?.message ?? error}`,
      'Check that api.github.com is reachable from this network.',
    );
  }

  if (response.status === 401) {
    throw new AuthRequiredError(
      'api.github.com',
      'GitHub rejected the configured token',
      'Set a valid GITHUB_TOKEN or GH_TOKEN, or unset it for public requests.',
    );
  }

  const rateLimited = response.status === 429
    || (response.status === 403 && (
      response.headers.get('x-ratelimit-remaining') === '0'
      || response.headers.has('retry-after')
    ));
  if (rateLimited) {
    throw new CommandExecutionError(
      `GitHub API rate limit exceeded (HTTP ${response.status})`,
      rateLimitHint(response),
    );
  }

  if (response.status === 403) {
    throw new AuthRequiredError(
      'api.github.com',
      'GitHub denied this request (HTTP 403)',
      'Check that GITHUB_TOKEN or GH_TOKEN has permission to read this resource.',
    );
  }

  if (response.status === 404) {
    throw new EmptyResultError(
      'GitHub API',
      'The requested GitHub resource was not found or is not publicly visible.',
    );
  }

  if (!response.ok) {
    throw new CommandExecutionError(`GitHub API returned HTTP ${response.status}`);
  }

  return response;
}
