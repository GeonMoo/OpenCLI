import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { COMPANIES, selectCompanies } from './companies.js';
import { parseSearchArgs, searchJobs } from './search.js';
import './companies-list.js';

afterEach(() => vi.restoreAllMocks());
const job = (id = '123', title = '大数据开发工程师') => ({ jobId: id, jobTitle: title, jobLocation: '北京', jobDescription: '数据开发职责', jobRequirements: null, jobUrl: `https://example.com/jobs/${id}` });
const handlers = callback => ({ feishu: callback, api: callback, extra: callback });

describe('jobs commands', () => {
  it('selects all 18 distinct companies and accepts scraper names and Chinese labels', () => {
    expect(COMPANIES).toHaveLength(18);
    expect(new Set(COMPANIES.map(c => c.id)).size).toBe(18);
    expect(selectCompanies()).toHaveLength(18);
    expect(selectCompanies('Xiaomi,小米,Li Auto,Ele.me,Pony.ai').map(c => c.id)).toEqual(['xiaomi', 'liauto', 'eleme', 'ponyai']);
    expect(() => selectCompanies('unknown')).toThrow(ArgumentError);
    expect(() => selectCompanies('')).toThrow(ArgumentError);
  });
  it('validates keyword, page count, timeout and match without silent clamping', () => {
    for (const args of [{ query: ' ' }, { query: 'x', pages: 0 }, { query: 'x', pages: 1.5 }, { query: 'x', timeout: 0 }, { query: 'x', match: 'fuzzy' }]) {
      expect(() => parseSearchArgs(args)).toThrow(ArgumentError);
    }
  });
  it('preserves all CLI arguments and outputs aligned columns with string IDs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue([job(), job()]);
    const rows = await searchJobs({}, { query: '数据开发', company: 'xiaomi', pages: 2, 'request-timeout': 5 }, handlers(fetcher));
    expect(fetcher).toHaveBeenCalledWith({}, COMPANIES[0], '数据开发', 2, 5, false);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(getRegistry().get('jobs/search').columns);
    expect(rows[0]).toMatchObject({ company: 'xiaomi', id: '123', title: '大数据开发工程师', location: '北京', requirements: null });
  });
  it('matches titles by default and includes duties only with --match text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue([job('1'), job('2', '数据产品经理')]);
    expect(await searchJobs({}, { query: '数据开发', company: 'xiaomi' }, handlers(fetcher))).toHaveLength(1);
    expect(await searchJobs({}, { query: '数据开发', company: 'xiaomi', match: 'text' }, handlers(fetcher))).toHaveLength(2);
  });
  it('attempts every company and makes partial failure visible; strict mode rejects it', async () => {
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    let visits = [];
    const fetcher = (...args) => {
      const company = args.find(arg => arg?.id);
      visits.push(company.id);
      if (company.id === 'tencent') throw new CommandExecutionError('offline');
      return [job()];
    };
    expect(await searchJobs({}, { query: '数据开发' }, handlers(fetcher))).toHaveLength(17);
    expect(visits).toEqual(COMPANIES.map(c => c.id));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('tencent: FAILED'));
    visits = [];
    await expect(searchJobs({}, { query: '数据开发', strict: true }, handlers(fetcher))).rejects.toThrow(CommandExecutionError);
    expect(visits).toHaveLength(18);
  });
  it('distinguishes empty results from single-provider failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(searchJobs({}, { query: 'x', company: 'xiaomi' }, handlers(() => []))).rejects.toThrow(EmptyResultError);
    await expect(searchJobs({}, { query: 'x', company: 'xiaomi' }, handlers(() => { throw new CommandExecutionError('offline'); }))).rejects.toThrow(CommandExecutionError);
  });
  it('invokes through the runtime signature without treating the debug flag as a provider override', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue({ jobs: [job()], empty: false, nextPage: false, searchValue: '数据开发' }), wait: vi.fn() };
    const rows = await getRegistry().get('jobs/search').func(page, { query: '数据开发', company: 'xiaomi' }, true);
    expect(rows).toHaveLength(1);
  });
});
