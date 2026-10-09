import { CommandExecutionError, EmptyResultError, TimeoutError, AuthRequiredError } from '@jackwener/opencli/errors';
import { BASE, checkPage, cleanText, readState, resolveCompany } from './utils.js';

// Strategy: INTERCEPT / internal-unstable. The UI requests signed graph data;
// SVG lacks node IDs/topology. Public HTML has no graph; no reusable official cookie API was found.
// Capture the UI's own response instead of reproducing its private request contract.
export function parseRelationPaths(data) {
  if (!Array.isArray(data?.paths)) throw new CommandExecutionError('Tianyancha relation paths are missing');
  const output = [];
  const seen = new Set();
  const identity = node => {
    if (!node || node.type !== 'NODE' || ![1, 2].includes(node.entityType) || !node.entityName) {
      throw new CommandExecutionError('Invalid Tianyancha relation node');
    }
    const human = node.entityType === 2;
    const value = human ? node.humanNameId : node.companyId;
    if (!/^\d+$/.test(String(value))) throw new CommandExecutionError('Relation node ID is missing');
    return { nodeId: String(value), nodeName: cleanText(node.entityName), nodeType: human ? 'human' : 'company',
      nodeHref: human ? `${BASE}/human/${value}-c${node.companyId}` : `${BASE}/company/${value}` };
  };
  for (const route of data.paths) {
    if (!Array.isArray(route?.path) || route.path.length < 3 || route.path.length % 2 !== 1) {
      throw new CommandExecutionError('Invalid Tianyancha relation path');
    }
    for (let i = 1; i < route.path.length; i += 2) {
      const relation = route.path[i];
      if (relation?.type !== 'RELATION' || !['->', '<-'].includes(relation.direction) || !relation.descText) {
        throw new CommandExecutionError('Invalid Tianyancha relation edge');
      }
      const left = identity(route.path[i - 1]);
      const right = identity(route.path[i + 1]);
      const [from, to] = relation.direction === '<-' ? [right, left] : [left, right];
      const label = cleanText(relation.descText);
      const key = `${from.nodeType}:${from.nodeId}:${to.nodeType}:${to.nodeId}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ratio = label.match(/^(\d+(?:\.\d+)?)%$/);
      output.push({ fromId: from.nodeId, fromName: from.nodeName, toId: to.nodeId, toName: to.nodeName,
        toType: to.nodeType, label, ratio: ratio ? Number(ratio[1]) : null, href: to.nodeHref });
    }
  }
  if (!output.length) throw new EmptyResultError('tianyancha search', 'No relation paths found between these subjects');
  return output;
}

async function selectTarget(page, target) {
  await page.fillText('.tycei-entity-item-container input', target, { nth: 1 });
  let expanded = false;
  for (let i = 0; i < 15; i++) {
    await page.wait(1);
    await checkPage(page);
    const selected = await page.evaluate((wanted, expand) => {
      const visible = element => element.getClientRects().length > 0;
      const names = Array.from(document.querySelectorAll('.tycei-entity-item-popover-main-item-text')).filter(visible);
      const match = names.find(e => e.textContent.trim() === wanted);
      if (match) { match.click(); return 'selected'; }
      const nested = Array.from(document.querySelectorAll('.tycei-content-list-item-text')).filter(visible)
        .find(e => e.textContent.trim() === wanted);
      if (nested) {
        const button = nested.closest('.tycei-content-list-item')?.querySelector('.tycei-content-list-item-button');
        if (!button) return 'missing-control';
        button.click(); return 'selected';
      }
      if (!expand && names.length) {
        if (names[0].textContent.includes(wanted)) { names[0].click(); return 'selected'; }
        const more = names[0].closest('.tycei-entity-item-popover-main-item')?.querySelector('.tycei-entity-item-popover-main-item-more');
        if (!more) return 'missing-control';
        more.click(); return 'expanded';
      }
      return 'waiting';
    }, target, expanded);
    if (selected === 'selected') {
      const valid = await page.evaluate(() => document.querySelectorAll('.tycei-entity-item-container')[1]?.querySelector('.tycei-ok') != null);
      if (!valid) throw new CommandExecutionError('Tianyancha did not accept the selected target');
      return;
    }
    if (selected === 'missing-control') throw new CommandExecutionError('Tianyancha relation subject controls changed');
    if (selected === 'expanded') expanded = true;
  }
  throw new EmptyResultError('tianyancha search', `No selectable relation subject matched ${target}; use its full name`);
}

export async function searchRelationPaths(page, query, target) {
  const id = await resolveCompany(page, query);
  const base = await readState(page, `${BASE}/company/${id}`, '/biz-service/cloud-other-information/companyinfo/baseinfo/web');
  if (String(base?.id) !== id || !base.name) throw new CommandExecutionError('Relation source identity does not match');
  await page.goto(`${BASE}/relation?keyword1=${encodeURIComponent(base.name)}&cid1=${id}`);
  await page.wait(1);
  await checkPage(page);
  await selectTarget(page, target);
  await page.installInterceptor('/tyc-enterprise-graph/relation/');
  const clicked = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === '开始分析');
    if (!button) return false;
    button.click(); return true;
  });
  if (!clicked) throw new CommandExecutionError('Tianyancha relation analysis button is missing');
  for (let i = 0; i < 20; i++) {
    await page.wait(1);
    await checkPage(page);
    const responses = await page.getInterceptedRequests();
    const response = responses.findLast(r => Array.isArray(r?.data?.paths) || (r?.state && r.state !== 'ok'));
    if (!response) continue;
    if (response.state !== 'ok') {
      if (/登录|会员|权限/.test(response.message ?? '')) throw new AuthRequiredError('tianyancha.com', response.message);
      throw new CommandExecutionError(`Tianyancha relation: ${response.message || 'analysis failed'}`);
    }
    if (response.data.sample === true) throw new CommandExecutionError('Tianyancha returned example data instead of the requested relation');
    return parseRelationPaths(response.data);
  }
  throw new TimeoutError('Tianyancha relation analysis', 20, 'Inspect the retained tab for login, VIP access or verification');
}
