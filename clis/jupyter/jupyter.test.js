import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import { getRegistry } from '@geonmoo/opencli/registry';
import { localBasename, normalizeRemotePath } from './utils.js';

const mockHttpDownload = vi.hoisted(() => vi.fn());
vi.mock('@geonmoo/opencli/download', () => ({ httpDownload: mockHttpDownload }));

import './console.js';
import './download.js';
import './pyconsole.js';
import './upload.js';

const labState = { url: 'http://139.196.153.143:9091/lab', title: 'JupyterLab', hasLabRoot: true, hasLoginForm: false };

beforeEach(() => {
  vi.restoreAllMocks();
  mockHttpDownload.mockReset();
});

describe('jupyter path validation', () => {
  it('normalizes local and remote paths without allowing traversal', () => {
    expect(localBasename('C:\\tmp\\report.csv')).toBe('report.csv');
    expect(normalizeRemotePath('data/', 'report.csv')).toBe('data/report.csv');
    expect(() => normalizeRemotePath('../secret', 'report.csv')).toThrow(ArgumentError);
  });
});

describe('jupyter console', () => {
  it('executes a shell command in a disposable Jupyter terminal', async () => {
    const command = getRegistry().get('jupyter/console');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: true, sessionName: '17' })
        .mockResolvedValueOnce({
          phase: 'complete',
          sessionName: '17',
          transcript: 'Python 3.12.1\r\n',
          processCode: 0,
        })
        .mockResolvedValueOnce(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    };

    await expect(command.func(page, { command: 'python --version', timeout: 10 })).resolves.toEqual([{
      command: 'python --version',
      exitCode: 0,
      output: 'Python 3.12.1',
      terminalName: '17',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('typed-fails an unsuccessful shell command after cleanup', async () => {
    const command = getRegistry().get('jupyter/console');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: true, sessionName: '18' })
        .mockResolvedValueOnce({ phase: 'complete', sessionName: '18', transcript: 'failed', processCode: 2 })
        .mockResolvedValueOnce(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    };
    await expect(command.func(page, { command: 'false', timeout: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });
});

describe('jupyter pyconsole', () => {
  it('fills, runs, and returns the completed console cell', async () => {
    const command = getRegistry().get('jupyter/pyconsole');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: true, launched: false })
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce({ execNo: 3, submittedCode: 'print(42)', resultText: '42', resultKind: 'text', isError: false }),
      fillText: vi.fn().mockResolvedValue({ filled: true, verified: true, matches_n: 1, actual: 'print(42)' }),
      click: vi.fn(),
      cdp: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    };

    await expect(command.func(page, { code: 'print(42)', timeout: 5 })).resolves.toEqual([{
      executionCount: 3,
      code: 'print(42)',
      output: '42',
      outputType: 'text',
    }]);
    expect(page.fillText).toHaveBeenCalledWith(expect.stringContaining('jp-CodeConsole-input'), 'print(42)');
    expect(page.cdp).toHaveBeenCalledTimes(2);
  });

  it('typed-fails kernel errors', async () => {
    const command = getRegistry().get('jupyter/pyconsole');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: true, launched: false })
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce({ execNo: 1, submittedCode: '1/0', resultText: 'ZeroDivisionError', resultKind: 'error', isError: true }),
      fillText: vi.fn().mockResolvedValue({ filled: true, verified: true, matches_n: 1, actual: '1/0' }),
      click: vi.fn().mockResolvedValue({ matches_n: 1 }),
      cdp: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    };
    await expect(command.func(page, { code: '1/0', timeout: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('opens a new launcher when the reset workspace has no launcher tab', async () => {
    const command = getRegistry().get('jupyter/pyconsole');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: false, launched: false })
        .mockResolvedValueOnce({ ready: false, launched: true })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce({ execNo: 1, submittedCode: '2+2', resultText: '4', resultKind: 'text', isError: false }),
      fillText: vi.fn().mockResolvedValue({ filled: true, verified: true, matches_n: 1, actual: '2+2' }),
      click: vi.fn()
        .mockResolvedValueOnce({ matches_n: 8 })
        .mockResolvedValueOnce({ matches_n: 1 }),
      cdp: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    };

    await expect(command.func(page, { code: '2+2', timeout: 5 })).resolves.toEqual([{
      executionCount: 1,
      code: '2+2',
      output: '4',
      outputType: 'text',
    }]);
    expect(page.click).toHaveBeenNthCalledWith(1, '#jp-MainMenu > ul > li', { nth: 0 });
    expect(page.click).toHaveBeenNthCalledWith(2, '[data-command="launcher:create"]', { nth: 0 });
  });
});

describe('jupyter upload', () => {
  it('uploads one local file and validates the Contents API model', async () => {
    const command = getRegistry().get('jupyter/upload');
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(labState)
        .mockResolvedValueOnce({ ready: true })
        .mockResolvedValueOnce({ state: 'complete', status: 201, fileSize: 7, payload: { path: 'data/report.csv', name: 'report.csv', size: 7, type: 'file' } })
        .mockResolvedValueOnce(undefined),
      uploadFiles: vi.fn().mockResolvedValue({ uploaded: true, files: 1, matches_n: 1, file_names: ['report.csv'] }),
      sleep: vi.fn().mockResolvedValue(undefined),
    };
    await expect(command.func(page, { file: 'C:\\tmp\\report.csv', path: 'data/report.csv', timeout: 5 })).resolves.toEqual([{
      remotePath: 'data/report.csv',
      fileName: 'report.csv',
      size: 7,
      type: 'file',
      status: 'uploaded',
    }]);
  });
});

describe('jupyter download', () => {
  it('validates metadata, triggers a browser download, and returns download evidence', async () => {
    const command = getRegistry().get('jupyter/download');
    mockHttpDownload.mockResolvedValue({ success: true, size: 7 });
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce(labState),
      fetchJson: vi.fn().mockResolvedValue({ path: 'data/report.csv', name: 'report.csv', size: 7, type: 'file', mimetype: 'text/csv' }),
      getCookies: vi.fn().mockResolvedValue([{ name: 'session', value: 'abc' }]),
    };
    const rows = await command.func(page, { path: 'data/report.csv', output: 'E:/tmp/jupyter-downloads', timeout: 5 });
    expect(rows).toEqual([{
      remotePath: 'data/report.csv',
      fileName: 'report.csv',
      size: 7,
      mimeType: 'text/csv',
      status: 'downloaded',
      localPath: expect.stringMatching(/jupyter-downloads[\\/]report\.csv$/),
      url: 'http://139.196.153.143:9091/files/data/report.csv?download=1',
    }]);
    expect(mockHttpDownload).toHaveBeenCalledWith(
      'http://139.196.153.143:9091/files/data/report.csv?download=1',
      expect.stringMatching(/jupyter-downloads[\\/]report\.csv$/),
      expect.objectContaining({ cookies: 'session=abc', timeout: 5000 }),
    );
  });

  it('typed-fails a missing remote file', async () => {
    const command = getRegistry().get('jupyter/download');
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce(labState),
      fetchJson: vi.fn().mockRejectedValue(new Error('HTTP 404')),
      getCookies: vi.fn(),
    };
    await expect(command.func(page, { path: 'missing.txt', timeout: 5 })).rejects.toBeInstanceOf(EmptyResultError);
  });
});
