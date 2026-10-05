import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

const BASE = 'https://www.jisilu.cn';
const COMMON = [['bondCode', 'bond_id', 'code'], ['bondName', 'bond_nm', 'text'], ['bondPrice', 'price', 'number'], ['stockCode', 'stock_id', 'code'], ['stockName', 'stock_nm', 'text']];
// Amounts keep the page's units: 100 million CNY (亿元); percentage values are percentage points.
export const VIEWS = {
  list: { description: '可转债行情列表', fields: [...COMMON, ['bondChangePct', 'increase_rt', 'number'], ['convPrice', 'convert_price', 'number'], ['convValue', 'convert_value', 'number'], ['convPremiumPct', 'premium_rt', 'number'], ['ytm', 'ytm_rt', 'number'], ['remainingYears', 'year_left', 'number']] },
  redeem: { description: '可转债强赎条款及状态', fields: [...COMMON, ['convPrice', 'convert_price', 'number'], ['redeemTriggerPct', 'redeem_price_ratio', 'number'], ['redeemTriggerPrice', 'force_redeem_price', 'number'], ['redeemPrice', 'real_force_redeem_price', 'number'], ['redeemStatus', 'redeem_status', 'text'], ['redeemClause', 'redeem_tc', 'text']] },
  adjust: { description: '可转债下修条款及计数', fields: [...COMMON, ['convPrice', 'convert_price', 'number'], ['adjustTriggerPct', 'adjust_price_ratio', 'number'], ['adjustTriggerPrice', 'threshold_value', 'number'], ['adjustCount', 'adjust_count', 'text'], ['recalculateDate', 'readjust_dt', 'text'], ['adjustClause', 'adjust_tc', 'text']] },
  put: { description: '可转债回售条款及状态', fields: [...COMMON, ['convPrice', 'convert_price', 'number'], ['putTriggerPct', 'put_convert_price_ratio', 'number'], ['putTriggerPrice', 'put_convert_price', 'number'], ['putPrice', 'put_price', 'number'], ['putStatus', 'time', 'text'], ['putClause', 'put_tc', 'text']] },
  // On pre, price is the STOCK price. Unissued bonds may have no bond code/name yet.
  pre: { description: '待发可转债及发行进度', fields: [['stockCode', 'stock_id', 'code'], ['stockName', 'stock_nm', 'text'], ['bondCode', 'bond_id', 'code'], ['bondName', 'bond_nm', 'text'], ['stockPrice', 'price', 'number'], ['issueAmountCny100M', 'amount', 'number'], ['convPrice', 'convert_price', 'number'], ['applyCode', 'apply_cd', 'code'], ['applyDate', 'apply_date', 'text'], ['progress', 'progress_nm', 'text'], ['progressHistory', 'progress_full', 'text']] },
  delisted: { description: '已退市可转债及退市原因', fields: [...COMMON, ['remainingAmountCny100M', 'curr_iss_amt', 'number'], ['maxPrice', 'max_price', 'number'], ['minPrice', 'min_price', 'number'], ['issueDate', 'issue_dt', 'text'], ['delistDate', 'delist_dt', 'text'], ['delistReason', 'delist_notes', 'text']] },
};

export function parseLimit(value = 0) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new ArgumentError('--limit must be a non-negative integer (0 = all rows)');
  return n;
}

export function mapRows(view, data, limit = 0) {
  if (!Array.isArray(data)) throw new CommandExecutionError(`jisilu ${view}: invalid table state`);
  if (!data.length) throw new EmptyResultError(`jisilu ${view}`, '页面没有可用数据');
  const fields = VIEWS[view].fields;
  return (limit ? data.slice(0, limit) : data).map((item, i) => {
    if (!item || typeof item !== 'object') throw new CommandExecutionError(`jisilu ${view}: invalid row ${i + 1}`);
    const row = { rank: i + 1 };
    for (const [column, field, type] of fields) {
      const value = item[field];
      if (value == null || value === '' || value === '-') row[column] = null;
      else if (type === 'number') {
        if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value))) throw new CommandExecutionError(`jisilu ${view}: invalid ${field} in row ${i + 1}`);
        row[column] = Number(value);
      } else {
        if (!['string', 'number'].includes(typeof value)) throw new CommandExecutionError(`jisilu ${view}: invalid ${field} in row ${i + 1}`);
        row[column] = type === 'code' ? String(value) : String(value).replace(/<br\s*\/?\s*>/gi, '\n');
      }
    }
    const code = view === 'pre' ? row.stockCode : row.bondCode;
    const name = view === 'pre' ? row.stockName : row.bondName;
    if (!/^\d{6}$/.test(code || '') || !name) throw new CommandExecutionError(`jisilu ${view}: missing row identity`);
    return row;
  });
}

// DOM_STATE: read the same Vue component state that renders the visible tables.
export function readTableState(view, fields) {
  const vm = [...document.querySelectorAll('*')].map(e => e.__vue__).find(v => v?.$options.name === `nav-data-cb-${view}`);
  if (!vm) return { ready: false, login: !!document.querySelector('.header_navbar_bg a[href*="/account/login"]') };
  const raw = vm.dataRaw;
  const displayed = vm.displayData;
  const rows = Array.isArray(displayed) ? displayed : displayed?.list || vm.sourceData?.list || raw?.list;
  if (raw?.loading === true || !Array.isArray(rows)) return { ready: false };
  return { ready: true, records: rows.map(r => Object.fromEntries(fields.map(k => [k, r[k]]))) };
}

for (const [view, config] of Object.entries(VIEWS)) {
  cli({
    site: 'jisilu', name: view, access: 'read', description: config.description,
    domain: 'www.jisilu.cn', strategy: Strategy.UI, browser: true, navigateBefore: false,
    args: [{ name: 'limit', type: 'int', default: 0, help: '返回数量，0 表示全部；按页面默认顺序' }],
    columns: ['rank', ...config.fields.map(([name]) => name)],
    func: async (page, args) => {
      const limit = parseLimit(args.limit);
      await page.goto(`${BASE}/web/data/cb/${view}`);
      await page.wait(1);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const state = await page.evaluate(readTableState, view, config.fields.map(([, key]) => key));
        if (state.login) throw new AuthRequiredError('www.jisilu.cn');
        if (state.ready) return mapRows(view, state.records, limit);
        await page.wait(0.5);
      }
      throw new TimeoutError(`jisilu ${view} table`, 20);
    },
  });
}