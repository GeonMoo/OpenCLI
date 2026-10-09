import { it } from 'vitest';
import assert from 'node:assert/strict';
import { mapRows, parseLimit, readTableState, VIEWS } from './list.js';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';

it('maps page state without corrupting fields, units or text', () => {
  const sample = { bond_id: '113046', bond_nm: '金田转债', stock_id: '002049', stock_nm: '紫光国微', price: '111.330', increase_rt: 0, convert_price: '97.010', premium_rt: -0.34, put_convert_price_ratio: '70.000', put_convert_price: '67.907', put_price: '100.000', time: '回售中', put_tc: '条款, "原文"\n第二行', progress_nm: '申购<br>申购代码371149', progress_full: '董事会预案\n同意注册\n' };
  assert.equal(parseLimit(0), 0);
  for (const limit of [-1, 1.5, 'bad', Infinity]) assert.throws(() => parseLimit(limit), ArgumentError);
  assert.throws(() => mapRows('list', []), EmptyResultError);
  assert.throws(() => mapRows('list', {}), CommandExecutionError);
  assert.throws(() => mapRows('put', [{ ...sample, price: 'NaN' }]), CommandExecutionError);
  const put = mapRows('put', [sample])[0];
  assert.equal(put.stockCode, '002049');
  assert.equal(put.putTriggerPct, 70);
  assert.equal(put.putTriggerPrice, 67.907);
  assert.equal(put.putPrice, 100);
  assert.equal(put.putClause, sample.put_tc);
  assert.equal(mapRows('list', [sample])[0].bondChangePct, 0);
  const pre = mapRows('pre', [{ ...sample, bond_id: null, bond_nm: null }])[0];
  assert.equal(pre.bondCode, null);
  assert.equal(pre.stockPrice, 111.33);
  assert.equal(pre.progress, '申购\n申购代码371149');
  assert.equal(pre.progressHistory, sample.progress_full);
  for (const [view, config] of Object.entries(VIEWS)) {
    const row = mapRows(view, [sample, sample], 1)[0];
    assert.deepEqual(Object.keys(row), ['rank', ...config.fields.map(([name]) => name)]);
    assert.ok(Object.keys(row).length <= 12);
  }
  const vm = { $options: { name: 'nav-data-cb-list' }, dataLoading: true, dataRaw: { loading: false, list: [sample] }, displayData: [sample] };
  globalThis.document = { querySelectorAll: () => [{ __vue__: vm }], querySelector: () => null };
  assert.equal(readTableState('list', ['bond_id']).ready, true); // dataLoading stays true after the table is rendered.
  vm.dataRaw.loading = true;
  assert.equal(readTableState('list', ['bond_id']).ready, false);
  vm.dataRaw.loading = false;
  assert.deepEqual(readTableState('list', ['bond_id']).records, [{ bond_id: '113046' }]);
  delete globalThis.document;
});
