import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import './stars.js';

const command = getRegistry().get('github/stars');
const originalGithubToken = process.env.GITHUB_TOKEN;
const originalGhToken = process.env.GH_TOKEN;

function starred(fullName, starredAt, stars = 1) {
  return {
    starred_at: starredAt,
    repo: {
      full_name: fullName,
      description: `${fullName} description`,
      language: 'JavaScript',
      stargazers_count: stars,
      forks_count: 2,
      html_url: `https://github.com/${fullName}`,
    },
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('github stars', () => {
  it('fetches another page for limits above the API page size instead of truncating the total', async () => {
    vi.useFakeTimers();
    const next = 'https://api.github.com/users/alice/starred?sort=created&direction=desc&per_page=100&page=2';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 100 }, (_, i) => starred(`alice/repo${i}`, '2026-01-02T00:00:00Z')), { headers: { link: `<${next}>; rel="next"` } }))
      .mockResolvedValueOnce(jsonResponse([starred('alice/last', '2026-01-01T00:00:00Z')]));
    vi.stubGlobal('fetch', fetchMock);
    const result = command.func({ username: 'alice', limit: 101 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toHaveLength(101);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('per_page')).toBe('100');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
  });

  it('paginates sequentially with one-second pacing and returns newest stars first', async () => {
    const page2 = 'https://api.github.com/users/alice/starred?sort=created&direction=desc&per_page=2&page=2';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        starred('alice/older', '2026-01-02T00:00:00Z', 20),
        starred('alice/newest', '2026-01-03T00:00:00Z', 30),
      ], { headers: { link: `<${page2}>; rel="next"` } }))
      .mockResolvedValueOnce(jsonResponse([
        starred('alice/oldest', '2026-01-01T00:00:00Z', 10),
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const promise = command.func({ username: 'alice', limit: 3 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const rows = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/users/alice/starred?sort=created&direction=desc&per_page=3',
      page2,
    ]);
    expect(rows.map(row => row.fullName)).toEqual(['alice/newest', 'alice/older', 'alice/oldest']);
    expect(rows.map(row => row.starredAt)).toEqual([
      '2026-01-03T00:00:00Z',
      '2026-01-02T00:00:00Z',
      '2026-01-01T00:00:00Z',
    ]);
    expect(rows[0]).toEqual({
      rank: 1,
      fullName: 'alice/newest',
      description: 'alice/newest description',
      language: 'JavaScript',
      stars: 30,
      forks: 2,
      starredAt: '2026-01-03T00:00:00Z',
      url: 'https://github.com/alice/newest',
    });
    expect(fetchMock.mock.calls[0][1].headers.accept).toBe('application/vnd.github.star+json');
  });

  it('defaults to 10, stops at the limit, and sends an optional token without exposing it', async () => {
    process.env.GITHUB_TOKEN = 'secret-token';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      Array.from({ length: 12 }, (_, index) => starred(`alice/repo-${index}`, `2026-01-${String(12 - index).padStart(2, '0')}T00:00:00Z`)),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await command.func({ username: 'alice' });

    expect(rows).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('per_page=10');
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer secret-token');
    expect(JSON.stringify(rows)).not.toContain('secret-token');
  });

  it('rejects missing usernames and invalid limits before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(command.func({ username: '', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: '-alice', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: 'ali--ce', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: 'a'.repeat(40), limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: 'alice', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: 'alice', limit: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ username: 'alice', limit: Number.MAX_SAFE_INTEGER + 1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a malicious next-page host before sending a token', async () => {
    process.env.GITHUB_TOKEN = 'secret-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(
      [starred('alice/repo', '2026-01-01T00:00:00Z')],
      { headers: { link: '<https://evil.example/steal>; rel="next"' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const promise = command.func({ username: 'alice', limit: 2 });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('api.github.com');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('stops on an empty page that incorrectly advertises another page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      [],
      { headers: { link: '<https://api.github.com/users/alice/starred?page=2>; rel="next"' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(command.func({ username: 'alice', limit: 2 })).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
      message: expect.stringContaining('empty page'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps each API page at 100 items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(command.func({ username: 'alice', limit: 101 })).rejects.toBeInstanceOf(EmptyResultError);
    expect(fetchMock.mock.calls[0][0]).toContain('per_page=100');
  });

  it('maps bad authentication to AuthRequiredError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 })));

    await expect(command.func({ username: 'alice' })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps missing or private users to EmptyResultError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Not Found' }, { status: 404 })));

    await expect(command.func({ username: 'missing-user' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('stops on rate limiting and includes the reset time in its hint', async () => {
    const reset = 1_800_000_000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { message: 'API rate limit exceeded' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } },
    )));

    await expect(command.func({ username: 'alice' })).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
      hint: expect.stringContaining(new Date(reset * 1000).toISOString()),
    });
  });

  it('typed-fails malformed payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })));

    await expect(command.func({ username: 'alice' })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
