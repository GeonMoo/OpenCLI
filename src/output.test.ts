import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CommandExecutionError } from './errors.js';
import { render } from './output.js';

describe('output TTY detection', () => {
  const originalIsTTY = process.stdout.isTTY;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it('outputs YAML in non-TTY when format is default table', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    // commanderAdapter always passes fmt:'table' as default — this must still trigger downgrade
    render([{ name: 'alice', score: 10 }], { fmt: 'table', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('name: alice');
    expect(out).toContain('score: 10');
  });

  it('outputs table in TTY when format is default table', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice', score: 10 }], { fmt: 'table', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('alice');
  });

  it('respects explicit -f json even in non-TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice', note: 'line 1\nline 2' }], { fmt: 'json' });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(JSON.parse(out)).toEqual([{ name: 'alice', note: 'line 1\nline 2' }]);
  });

  it('shows elapsed time when elapsed is 0', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice' }], { fmt: 'table', columns: ['name'], elapsed: 0 });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('0.0s');
  });

  it('explicit -f table overrides non-TTY auto-downgrade', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice' }], { fmt: 'table', fmtExplicit: true, columns: ['name'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    // Should be table output, not YAML
    expect(out).not.toContain('name: alice');
    expect(out).toContain('alice');
  });

  it('prints single markdown payloads without wrapping them in a table', () => {
    render([{ markdown: '# Title\n\nBody' }], { fmt: 'md' });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toBe('# Title\n\nBody');
    expect(out).not.toContain('| markdown |');
  });

  it('keeps markdown records on one physical row across embedded line breaks', () => {
    render([
      { id: 'mixed', cell: 'left|right\r\nmiddle\n\nlast\rtail' },
      { id: 'null', cell: null },
      { id: 'undefined', cell: undefined },
    ], { fmt: 'md', columns: ['id', 'cell'] });

    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines).toEqual([
      '| id | cell |',
      '| --- | --- |',
      '| mixed | left\\|right<br>middle<br><br>last<br>tail |',
      '| null |  |',
      '| undefined |  |',
    ]);
    expect(lines.every((line: string) => !/[\r\n]/.test(line))).toBe(true);
  });

  it('escapes pipe characters in markdown table cells', () => {
    render([{ name: 'a|b', score: 10 }], { fmt: 'md', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    expect(out).toContain('| a\\|b | 10 |');
  });
});

describe('output files', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-output-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes Excel-compatible CSV with one BOM and preserves UTF-8 values and CSV escaping', () => {
    const outputFile = path.join(tempDir, '房源.csv');
    render([
      {
        title: '上实海上公元🏠',
        quote: '总价 500万, "诚意出售"',
        note: '南北通透\n满五唯一',
      },
    ], {
      fmt: 'csv',
      fmtExplicit: true,
      columns: ['title', 'quote', 'note'],
      outputFile,
    });

    const bytes = fs.readFileSync(outputFile);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text.match(/\uFEFF/g)).toHaveLength(1);
    expect(text).toBe(
      '\uFEFFtitle,quote,note\n' +
      '上实海上公元🏠,"总价 500万, ""诚意出售""","南北通透\n满五唯一"\n',
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('leaves stdout behavior unchanged when outputFile is omitted', () => {
    render([{ name: '中文🏠', quote: '1,000' }], {
      fmt: 'csv',
      fmtExplicit: true,
      columns: ['name', 'quote'],
    });

    expect(logSpy.mock.calls).toEqual([
      ['name,quote'],
      ['中文🏠,"1,000"'],
    ]);
  });

  it('writes JSON as UTF-8 without a BOM and keeps stdout empty', () => {
    const outputFile = path.join(tempDir, 'result.json');
    render({ name: '嘉定🏠' }, { fmt: 'json', fmtExplicit: true, outputFile });

    const bytes = fs.readFileSync(outputFile);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toBe('{\n  "name": "嘉定🏠"\n}\n');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('supports writing plain output with the default plain shortcut', () => {
    const outputFile = path.join(tempDir, 'result.txt');
    render({ text: '上海中文🏠' }, { fmt: 'plain', outputFile });

    expect(fs.readFileSync(outputFile, 'utf8')).toBe('上海中文🏠\n');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('wraps file write failures in CommandExecutionError without creating directories', () => {
    const outputFile = path.join(tempDir, 'missing', 'result.csv');

    expect(() => render([{ name: '房源' }], {
      fmt: 'csv',
      fmtExplicit: true,
      outputFile,
    })).toThrow(CommandExecutionError);
    expect(fs.existsSync(path.dirname(outputFile))).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
