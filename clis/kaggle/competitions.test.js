import { stripVTControlCharacters } from 'node:util';
import { getRegistry } from '@geonmoo/opencli/registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './list.js';
import { renderTimeline } from './progress.js';

afterEach(() => vi.unstubAllGlobals());

describe('Kaggle competitions', () => {
  const list = args => getRegistry().get('kaggle/list').func(args);
  const competition = {
    competitionName: 'elf-calculator',
    title: 'The Elf Calculator',
    briefDescription: 'Build arithmetic programs',
    competitionHostSegmentId: 1,
    totalTeams: 238,
    reward: { id: 'USD', quantity: 50_000 },
    deadline: '2100-01-28T23:59:00Z',
  };

  it('combines filters, follows the page token, and presents competition card fields', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ competitions: [competition], nextPageToken: 'next' }))
      .mockResolvedValueOnce(Response.json({
        competitions: [{ ...competition, competitionName: 'second', onlyAllowKernelSubmissions: true }],
      }));
    vi.stubGlobal('fetch', fetch);
    const rows = await list({ tags: 'active/featured', limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: 'The Elf Calculator',
      description: 'Build arithmetic programs',
      category: 'Featured',
      teams: 238,
      timeLeft: expect.stringMatching(/to go$/),
      prize: '$50,000',
      deadline: '2100-01-28T23:59:00.000Z',
      url: 'https://www.kaggle.com/competitions/elf-calculator',
    });
    expect(rows[1].category).toBe('Featured · Code Competition');
    const bodies = fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies[0]).toMatchObject({
      selector: { listOption: 'LIST_OPTION_ACTIVE', hostSegmentIdFilter: 1 }, pageSize: 2,
    });
    expect(bodies[1]).toMatchObject({ pageToken: 'next', pageSize: 1 });
  });

  it('rejects unknown tags and identifies an empty public response', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    await expect(list({ tags: 'unknown' })).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(list({ tags: 'active/research' })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
  });

  it('aligns the same calendar dates and marks elapsed time and entry milestones', () => {
    const date = n => `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`;
    const chart = renderTimeline([
      { competitionTitle: 'A', opensAt: date(1), closesAt: date(21), entryAt: date(16), mergerAt: date(16) },
      { competitionTitle: 'B', opensAt: date(6), closesAt: date(21) },
    ], Date.parse(date(11)));
    const [a, b] = chart.split('\n').filter(line => line.includes('→'));
    expect(a).toMatch(/^  ●━+│·+○·+●/);
    expect(b.indexOf('●')).toBeGreaterThan(a.indexOf('●'));
    expect(a.indexOf('│')).toBe(b.indexOf('│'));
    expect(a.lastIndexOf('●')).toBe(b.lastIndexOf('●'));
    expect(chart).toContain('Merger & Entry 2026-11-16');
  });

  it('uses one subdued accent and keeps narrow competition blocks separated', () => {
    const dates = { opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-21T00:00:00Z' };
    const competitions = [{ ...dates, competitionTitle: 'Alpha' }, { ...dates, competitionTitle: 'Beta' }];
    const now = Date.parse('2026-11-11T00:00:00Z');
    const chart = renderTimeline(competitions, now, { columns: 46, colorDepth: 8 });
    const basic = renderTimeline(competitions, now, { columns: 46, colorDepth: 4 });
    const plain = renderTimeline(competitions, now, { columns: 46 });
    expect(chart).toContain('\x1b[1mAlpha\x1b[22m');
    expect(chart).toContain('\x1b[1mBeta\x1b[22m');
    expect(new Set([...chart.matchAll(/\x1b\[38;5;(\d+)m/g)].map(match => match[1]))).toEqual(new Set(['109']));
    expect(basic).not.toContain('\x1b[38;5;');
    expect(stripVTControlCharacters(chart)).toBe(plain);
    expect(plain).toMatch(/●\n    2026-11-01 → 2026-11-21\n\n\n  Beta/);
    expect(plain.split('\n').every(line => line.length <= 46)).toBe(true);
  });
});
