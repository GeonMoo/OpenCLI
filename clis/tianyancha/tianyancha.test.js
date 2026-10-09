import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { extractRelations, SEARCH_COLUMNS } from './search.js';
import { parseRelationPaths } from './relation.js';
import { calendarDate, companyId } from './utils.js';
import './auth.js';
import './detail.js';

const html = readFileSync(new URL('./__fixtures__/relations.html', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/state.json', import.meta.url), 'utf8'));
const command = name => getRegistry().get(`tianyancha/${name}`);

function pageMock(props = {}, content = html) {
  const dom = new JSDOM(content, { url: 'https://www.tianyancha.com/company/2343820668', runScripts: 'outside-only' });
  dom.window.__NEXT_DATA__ = { props: { pageProps: props } };
  return {
    dom, goto: vi.fn(), wait: vi.fn(),
    evaluate: vi.fn(async (fn, ...args) => dom.window.eval(`(${fn.toString()})(...${JSON.stringify(args)})`)),
  };
}

describe('Tianyancha adapter', () => {
  it('reads real shareholder colspans, staff positions and investment percentages', async () => {
    const page = pageMock();
    const data = await page.evaluate(extractRelations);
    expect(data.entries).toHaveLength(3);
    expect(data.entries[0]).toMatchObject({ entityId: '2339825679', entityName: '厦门瑞庭投资有限公司', relationKind: '股东', ratioNumber: 22.04 });
    expect(data.entries[1]).toMatchObject({ entityId: '1969350112', relationKind: '任职', positionText: '董事长,董事,总经理' });
    expect(data.entries[2]).toMatchObject({ relationKind: '对外投资', ratioNumber: 100 });
  });

  it('keeps a Shanghai midnight timestamp on its original calendar date', () => {
    expect(calendarDate(1323964800000)).toBe('2011-12-16');
    expect(calendarDate('2011-12-16 00:00:00.0')).toBe('2011-12-16');
    expect(calendarDate(null)).toBeNull();
  });

  it('accepts company IDs and Tianyancha URLs, rejecting lookalike hosts and non-company routes', () => {
    expect(companyId('2343820668')).toBe('2343820668');
    expect(companyId('https://www.tianyancha.com/company/2343820668?x=1')).toBe('2343820668');
    expect(companyId('宁德时代')).toBeNull();
    for (const url of ['https://evil.test/company/2343820668', 'https://www.tianyancha.com.evil.test/company/2343820668', 'https://www.tianyancha.com/human/123']) {
      expect(() => companyId(url)).toThrow(ArgumentError);
    }
  });

  it('preserves reverse graph direction and deduplicates shared edges', () => {
    const data = structuredClone(fixture.paths);
    data.paths.push(data.paths[0]);
    expect(parseRelationPaths(data)).toEqual([{
      fromId: '1969350112', fromName: '曾毓群', toId: '2343820668', toName: '宁德时代新能源科技股份有限公司',
      toType: 'company', label: '法定代表人，董事长,董事,总经理', ratio: null,
      href: 'https://www.tianyancha.com/company/2343820668',
    }]);
    expect(() => parseRelationPaths({})).toThrow(CommandExecutionError);
    expect(() => parseRelationPaths({ paths: [] })).toThrow(EmptyResultError);
  });

  it('supports forward multi-hop paths without reversing their endpoints', () => {
    const data = structuredClone(fixture.paths);
    data.paths[0].path[1].direction = '->';
    data.paths[0].path[1].descText = '22.04%';
    const edge = parseRelationPaths(data)[0];
    expect(edge).toMatchObject({ fromId: '2343820668', toId: '1969350112', ratio: 22.04 });
    expect(edge.href).toBe('https://www.tianyancha.com/human/1969350112-c2343820668');
    data.paths[0].path.push({ type: 'RELATION', direction: '->', descText: '法定代表人' },
      { type: 'NODE', entityType: 1, entityName: '厦门瑞庭投资有限公司', companyId: 2339825679 });
    expect(parseRelationPaths(data)[1]).toMatchObject({ fromId: '1969350112', toId: '2339825679', label: '法定代表人' });
    data.paths[0].path[1].direction = 'unknown';
    expect(() => parseRelationPaths(data)).toThrow(CommandExecutionError);
    data.paths[0].path[1] = null;
    expect(() => parseRelationPaths(data)).toThrow(CommandExecutionError);
    expect(() => parseRelationPaths({ paths: [null] })).toThrow(CommandExecutionError);
  });

  it('accepts a person-name search without a companyHumanResult group', async () => {
    const page = pageMock({ dehydratedState: { queries: [{ queryKey: ['/cloud-tempest/searchHuman'], state: {
      data: { state: 'ok', data: { humanResult: { resultList: fixture.boss.data.companyHumanResult.resultList } } },
    } }] } });
    const rows = await command('search').func(page, { query: '黄世霖', class: 'boss', limit: 1 });
    expect(rows[0]).toMatchObject({ name: '黄世霖', type: 'human' });
    page.dom.window.__NEXT_DATA__.props.pageProps.dehydratedState.queries[0].state.data.data.companyHumanResult = {
      resultCount: 0, resultList: null,
    };
    expect(await command('search').func(page, { query: '黄世霖', class: 'boss', limit: 1 })).toEqual(rows);
  });

  it('returns company and boss fields aligned with declared columns', async () => {
    const page = pageMock({ listRes: fixture.company, dehydratedState: { queries: [
      { queryKey: ['/cloud-tempest/searchHuman'], state: { data: fixture.boss } },
    ] } });
    const rows = await command('search').func(page, { query: '宁德时代', class: 'company', limit: 1 });
    expect(Object.keys(rows[0])).toEqual(SEARCH_COLUMNS);
    expect(rows[0]).toMatchObject({ id: '2343820668', name: '宁德时代新能源科技股份有限公司', legalPerson: '曾毓群' });
    const bosses = await command('search').func(page, { query: '宁德时代', class: 'boss', limit: 1 });
    expect(Object.keys(bosses[0])).toEqual(SEARCH_COLUMNS);
    expect(bosses[0]).toMatchObject({ id: '2294446066', type: 'human', extras: { position: '创始人', companyCount: 19 } });
    expect(bosses[0].url).toContain('/human/2294446066-c2343820668');
  });

  it('round-trips a company search ID and a company name through detail', async () => {
    const page = pageMock({ listRes: fixture.company, dehydratedState: { queries: [
      { queryKey: ['/biz-service/cloud-other-information/companyinfo/baseinfo/web'], state: { data: { state: 'ok', data: fixture.detail } } },
    ] } });
    for (const company of ['2343820668', '宁德时代']) {
      const rows = await command('detail').func(page, { company });
      expect(Object.keys(rows[0])).toEqual(command('detail').columns);
      expect(rows[0]).toMatchObject({ creditCode: '91350900587527783P', registeredCapital: '456360.8365万人民币', establishmentDate: '2011-12-16' });
    }
  });

  it('rejects invalid inputs before navigating and distinguishes empty from malformed data', async () => {
    const page = pageMock();
    for (const args of [{ query: '' }, { query: 'x', limit: 0 }, { query: 'x', class: 'invalid' }, { query: 'x', target: 'y' }]) {
      await expect(command('search').func(page, args)).rejects.toBeInstanceOf(ArgumentError);
    }
    expect(page.goto).not.toHaveBeenCalled();
    page.dom.window.__NEXT_DATA__.props.pageProps.listRes = { state: 'ok', data: { companyList: [] } };
    await expect(command('search').func(page, { query: 'x' })).rejects.toBeInstanceOf(EmptyResultError);
    page.dom.window.__NEXT_DATA__.props.pageProps.listRes.data = {};
    await expect(command('search').func(page, { query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('proves identity from fresh user state without trusting stale localStorage or emitting secrets', async () => {
    const page = pageMock({ dehydratedState: { queries: [{ queryKey: ['/next/web/getUserInfo'], state: {
      data: { state: 'ok', data: { userId: 42, nickname: 'Tester', isVip: true, token: 'private', mobile: 'private' } },
    } }] } });
    expect(await command('whoami').func(page, {})).toEqual({ logged_in: true, site: 'tianyancha', id: '42', name: 'Tester', isVip: true });
    page.dom.window.localStorage.setItem('tyc-user-info', JSON.stringify({ userId: 42, token: 'stale' }));
    page.dom.window.__NEXT_DATA__.props.pageProps.dehydratedState.queries[0].state.data = { state: 'fail', data: null };
    await expect(command('whoami').func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(command('login').func(page, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
  });
});
