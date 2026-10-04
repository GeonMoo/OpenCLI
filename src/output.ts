/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 */

import fs from 'node:fs';
import Table from 'cli-table3';
import yaml from 'js-yaml';
import { CommandExecutionError } from './errors.js';

export interface RenderOptions {
  fmt?: string;
  /** True when the user explicitly passed -f on the command line */
  fmtExplicit?: boolean;
  columns?: string[];
  title?: string;
  elapsed?: number;
  source?: string;
  footerExtra?: string;
  /** Write the selected format directly to this UTF-8 file instead of stdout. */
  outputFile?: string;
}

type LineEmitter = (...values: unknown[]) => void;

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [{ value: data }];
}

function resolveColumns(rows: Record<string, unknown>[], opts: RenderOptions): string[] {
  return opts.columns ?? Object.keys(rows[0] ?? {});
}

export function render(data: unknown, opts: RenderOptions = {}): void {
  let fmt = opts.fmt ?? 'table';
  // Non-TTY auto-downgrade only when format was NOT explicitly passed by user.
  if (!opts.fmtExplicit) {
    if (fmt === 'table' && !process.stdout.isTTY) fmt = 'yaml';
  }

  const outputLines: string[] = [];
  const emit: LineEmitter = opts.outputFile
    ? (...values) => outputLines.push(values.map(String).join(' ') + '\n')
    : (...values) => console.log(...values);

  if (data === null || data === undefined) {
    emit(data);
    writeOutputFile(opts.outputFile, fmt, outputLines);
    return;
  }
  switch (fmt) {
    case 'json': renderJson(data, emit); break;
    case 'plain': renderPlain(data, emit); break;
    case 'md': case 'markdown': renderMarkdown(data, opts, emit); break;
    case 'csv': renderCsv(data, opts, emit); break;
    case 'yaml': case 'yml': renderYaml(data, emit); break;
    default: renderTable(data, opts, emit); break;
  }
  writeOutputFile(opts.outputFile, fmt, outputLines);
}

function writeOutputFile(outputFile: string | undefined, fmt: string, lines: string[]): void {
  if (!outputFile) return;

  const content = lines.join('');
  const fileContent = fmt === 'csv' ? `\uFEFF${content.replace(/^\uFEFF/, '')}` : content;
  try {
    fs.writeFileSync(outputFile, fileContent, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CommandExecutionError(`Failed to write output file ${outputFile}: ${detail}`);
  }
}

function renderTable(data: unknown, opts: RenderOptions, emit: LineEmitter): void {
  const rows = normalizeRows(data);
  if (!rows.length) { emit('(no data)'); return; }
  const columns = resolveColumns(rows, opts);

  const header = columns.map(c => capitalize(c));
  const table = new Table({
    head: [...header],
    style: { head: [], border: [] },
    wordWrap: true,
    wrapOnWordBoundary: true,
  });

  for (const row of rows) {
    table.push(columns.map(c => {
      const v = (row as Record<string, unknown>)[c];
      return v === null || v === undefined ? '' : String(v);
    }));
  }

  emit();
  if (opts.title) emit(`  ${opts.title}`);
  emit(table.toString());
  const footer: string[] = [];
  footer.push(`${rows.length} items`);
  if (opts.elapsed !== undefined) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  emit(footer.join(' · '));
}

function renderJson(data: unknown, emit: LineEmitter): void {
  emit(JSON.stringify(data, null, 2));
}
function renderPlain(data: unknown, emit: LineEmitter): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;

  // Single-row single-field shortcuts for chat-style commands.
  if (rows.length === 1) {
    const row = rows[0];
    const entries = Object.entries(row);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'response' || key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        emit(String(value ?? ''));
        return;
      }
    }
  }

  rows.forEach((row, index) => {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    entries.forEach(([key, value]) => {
      emit(`${key}: ${value}`);
    });
    if (index < rows.length - 1) emit('');
  });
}


function renderMarkdown(data: unknown, opts: RenderOptions, emit: LineEmitter): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  if (rows.length === 1) {
    const entries = Object.entries(rows[0]);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        emit(String(value ?? ''));
        return;
      }
    }
  }
  const columns = resolveColumns(rows, opts);
  emit('| ' + columns.join(' | ') + ' |');
  emit('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of rows) {
    emit('| ' + columns.map(c => String((row as Record<string, unknown>)[c] ?? '')
      .replace(/\|/g, '\\|')
      // Any embedded line break would split the physical table row.
      .replace(/\r\n?|\n/g, '<br>')).join(' | ') + ' |');
  }
}

function renderCsv(data: unknown, opts: RenderOptions, emit: LineEmitter): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  const columns = resolveColumns(rows, opts);
  emit(columns.join(','));
  for (const row of rows) {
    emit(columns.map(c => {
      const v = String((row as Record<string, unknown>)[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
}

function renderYaml(data: unknown, emit: LineEmitter): void {
  emit(yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
