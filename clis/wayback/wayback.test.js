import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@geonmoo/opencli/errors';
import { getRegistry } from '@geonmoo/opencli/registry';
import './search.js';
import './url.js';

const search = getRegistry().get('wayback/search').func;
const url = getRegistry().get('wayback/url').func;
const header = ['timestamp', 'original', 'mimetype', 'statuscode'];
const capture = timestamp => [timestamp, 'http://example.com/', 'text/html', '200'];
const site = (name, year) => ({ name, link: `http://${name}/`, first_captured: year });

afterEach(() => vi.unstubAllGlobals());

describe('wayback url', () => {
  it('keeps reverse order and the UTC cutoff across resume keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([header, capture('20261031235959'), [], ['next-page']]))
      .mockResolvedValueOnce(Response.json([header, capture('20261031235958')]));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await url({ url: 'example.com', 'date-before': '2026-11-01', order: ['time', 'desc'], limit: 'None' });

    expect(rows.map(row => row.timestamp)).toEqual(['20261031235959', '20261031235958']);
    expect(rows[0].snapshot_url).toBe('https://web.archive.org/web/20261031235959/http://example.com/');
    const [first, second] = fetchMock.mock.calls.map(([request]) => request.searchParams);
    expect(first.get('sort')).toBe('reverse');
    expect(first.get('to')).toBe('20261031235959');
    expect(second.get('sort')).toBe('reverse');
    expect(second.get('to')).toBe(first.get('to'));
    expect(second.get('resumeKey')).toBe('next-page');
  });

  it('stops once the requested newest capture is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([header, capture('20261031235959'), [], ['next-page']]));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await url({ url: 'example.com', order: 'time desc', limit: '1' });
    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].searchParams.get('limit')).toBe('1');
  });
});

describe('wayback search', () => {
  it.each([
    ['asc', ['oldest.example', 'middle.example']],
    ['desc', ['newest.example', 'middle.example']],
  ])('sorts by first capture year %s before limiting site results', async (direction, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([
      site('middle.example', 2005), site('newest.example', 2010), site('oldest.example', 2001),
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await search({ keywords: 'machine learning', order: ['time', direction], limit: '2' });
    expect(rows.map(row => row.domain)).toEqual(expected);
    expect(fetchMock.mock.calls[0][0].searchParams.get('q')).toBe('machine learning');
  });

  it('checks same-year homepage captures against the exact date', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([site('too-late.example', 2010), site('in-range.example', 2010)]))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([['timestamp'], ['20100630235959']]));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await search({ keywords: 'test', 'date-before': '2010-07-01' });
    expect(rows.map(row => row.domain)).toEqual(['in-range.example']);
    expect(fetchMock.mock.calls[2][0].searchParams.get('to')).toBe('20100630235959');
  });

  it('reports invalid options and empty site results as typed errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(search({ keywords: 'test', order: 'time other' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(url({ url: 'example.com', 'date-before': '2026-02-29' })).rejects.toBeInstanceOf(ArgumentError);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(search({ keywords: 'test' })).rejects.toBeInstanceOf(EmptyResultError);
  });
});
