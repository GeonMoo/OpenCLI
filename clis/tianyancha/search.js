import { cli, Strategy } from '@geonmoo/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { requireBoundedInteger, requireSearchQuery } from '../_shared/search-adapter.js';
import { BASE, BASE_INFO_KEY, calendarDate, cleanText, readState, resolveCompany, searchCompanies } from './utils.js';
import { searchRelationPaths } from './relation.js';

export const SEARCH_COLUMNS = ['rank', 'id', 'name', 'type', 'sourceId', 'sourceName', 'legalPerson', 'status', 'relation', 'holdingPct', 'extras', 'url'];

export function extractRelations() {
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const result = [];
  const tableKinds = [];
  for (const table of document.querySelectorAll('#JS_Layout_Dims table')) {
    const headings = Array.from(table.querySelectorAll('thead tr:last-child th'));
    const headers = headings.flatMap(cell => Array(cell.colSpan).fill(clean(cell.textContent)));
    let kind;
    let nameIndex;
    if (headers.includes('股东名称')) { kind = '股东'; nameIndex = headers.indexOf('股东名称'); }
    else if (headers.includes('姓名') && headers.some(h => h.includes('职务'))) { kind = '任职'; nameIndex = headers.indexOf('姓名'); }
    else if (headers.includes('被投资企业名称')) { kind = '对外投资'; nameIndex = headers.indexOf('被投资企业名称'); }
    else if (headers.includes('分支机构名称')) { kind = '分支机构'; nameIndex = headers.indexOf('分支机构名称'); }
    else continue;
    tableKinds.push(kind);
    for (const row of table.querySelectorAll('tbody > tr')) {
      const cells = Array.from(row.children);
      // Colspans occupy logical columns: shareholder name spans four physical cells.
      const logicalCells = [];
      for (const cell of cells) for (let i = 0; i < cell.colSpan; i++) logicalCells.push(cell);
      const anchor = logicalCells[nameIndex]?.querySelector('a[href*="/company/"], a[href*="/human/"]');
      const match = anchor?.pathname.match(/^\/(company|human)\/(\d+)(?:-c\d+)?$/);
      if (!match) continue;
      const ratioCell = logicalCells[headers.indexOf('持股比例')];
      const ratioMatch = clean(ratioCell?.textContent).match(/^(\d+(?:\.\d+)?)%$/);
      const positionIndex = headers.findIndex(h => h.includes('职务'));
      const positionCell = logicalCells[positionIndex];
      result.push({ entityId: match[2], entityName: clean(anchor.textContent), entityType: match[1], detailHref: anchor.href,
        relationKind: kind, ratioNumber: ratioMatch ? Number(ratioMatch[1]) : null,
        positionText: kind === '任职' ? clean(positionCell?.firstElementChild?.textContent ?? positionCell?.textContent) : null });
    }
  }
  return { entries: result, tableKinds };
}

export function searchRow(item, rank, extra = {}) {
  if (!/^\d+$/.test(String(item.id)) || !cleanText(item.name)) throw new CommandExecutionError('Search result identity is missing');
  return {
    rank, id: String(item.id), name: cleanText(item.name), type: 'company', sourceId: null, sourceName: null,
    legalPerson: cleanText(item.legalPersonName), status: cleanText(item.regStatus), relation: null, holdingPct: null,
    extras: { registeredCapital: cleanText(item.regCapital), establishmentDate: calendarDate(item.estiblishTime) },
    url: `${BASE}/company/${item.id}`, ...extra,
  };
}

cli({
  site: 'tianyancha', name: 'search', access: 'read',
  description: '查公司、查老板或查直接关联主体；--target 查询两主体关联路径',
  example: 'opencli tianyancha search "宁德时代" --class company',
  domain: 'tianyancha.com', strategy: Strategy.UI, browser: true, navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: '公司或老板名称' },
    { name: 'class', choices: ['company', 'boss', 'relation'], default: 'company', help: 'company 查公司；boss 查老板；relation 查关系' },
    { name: 'target', help: 'relation 的第二主体名称；省略则返回公司的直接关联主体' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数，1–100；列表不自动翻页' },
  ],
  columns: SEARCH_COLUMNS,
  func: async (page, args) => {
    const query = requireSearchQuery(args.query, 'query');
    const kind = args.class ?? 'company';
    const limit = requireBoundedInteger(args.limit, 20, 1, 100, 'limit');
    if (!['company', 'boss', 'relation'].includes(kind)) throw new ArgumentError('class must be company, boss, or relation');
    if (args.target != null && kind !== 'relation') throw new ArgumentError('--target requires --class relation');
    if (kind === 'company') return (await searchCompanies(page, query)).slice(0, limit).map((item, i) => searchRow(item, i + 1));
    if (kind === 'boss') {
      const data = await readState(page, `${BASE}/humansearch?key=${encodeURIComponent(query)}`, '/cloud-tempest/searchHuman');
      if (!data || !('humanResult' in data || 'companyHumanResult' in data)
        || [data.humanResult, data.companyHumanResult].some(group => group != null && !Array.isArray(group.resultList)
          && !(group.resultList === null && group.resultCount === 0))) {
        throw new CommandExecutionError('Tianyancha human search data is missing');
      }
      const found = [...(data.humanResult?.resultList ?? []), ...(data.companyHumanResult?.resultList ?? [])];
      if (!found.length) throw new EmptyResultError('tianyancha search', `No boss matched ${query}`);
      return found.slice(0, limit).map((item, i) => searchRow({ id: item.hid, name: item.name }, i + 1, {
        type: 'human', sourceId: item.cid == null ? null : String(item.cid),
        sourceName: cleanText(item.cid === data.companyHumanResult?.graphId ? data.companyHumanResult.companyName
          : item.companyName ?? item.office?.find(office => office.cid === item.cid)?.companyName),
        extras: { position: cleanText(item.position), companyCount: item.companyNum ?? null }, url: item.linkWeb,
      }));
    }
    if (args.target != null) {
      const paths = await searchRelationPaths(page, query, requireSearchQuery(args.target, 'target'));
      return paths.slice(0, limit).map((edge, i) => searchRow({ id: edge.toId, name: edge.toName }, i + 1, {
        type: edge.toType, sourceId: edge.fromId, sourceName: edge.fromName, relation: edge.label, holdingPct: edge.ratio,
        url: edge.href,
      }));
    }
    const id = await resolveCompany(page, query);
    const data = await readState(page, `${BASE}/company/${id}`, BASE_INFO_KEY);
    if (String(data?.id) !== id || !data.name) throw new CommandExecutionError('Relation company identity does not match');
    await page.wait(2);
    const snapshot = await page.evaluate(extractRelations);
    if (!snapshot?.tableKinds?.length) throw new CommandExecutionError('Tianyancha relation tables are missing; inspect login/VIP access or page layout');
    if (!snapshot.entries.length) throw new EmptyResultError('tianyancha search', 'No visible direct relations');
    return snapshot.entries.slice(0, limit).map((entry, i) => searchRow({ id: entry.entityId, name: entry.entityName }, i + 1, {
      type: entry.entityType, sourceId: id, sourceName: cleanText(data.name), extras: { position: entry.positionText },
      relation: entry.relationKind, holdingPct: entry.ratioNumber, url: entry.detailHref,
    }));
  },
});
