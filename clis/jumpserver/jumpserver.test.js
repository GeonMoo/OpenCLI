import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@geonmoo/opencli/errors';
import { getRegistry, Strategy } from '@geonmoo/opencli/registry';

const mockHttpDownload = vi.hoisted(() => vi.fn());
vi.mock('@geonmoo/opencli/download', () => ({ httpDownload: mockHttpDownload }));

import './connect.js';
import './exec.js';
import './view.js';
import './upload.js';
import './download.js';
import {
  cleanCommandOutput,
  localBasename,
  normalizeRemoteDirectory,
  normalizeRemoteFile,
  safeDownloadPath,
  installJumpServerFacade,
  tailTranscript,
} from './utils.js';

const connectedAsset = {
  assetId: 'asset-1',
  assetName: 'opencli-linux',
  assetAddress: 'openssh.jumpserver-opencli-e2e.svc.cluster.local',
  accountAlias: 'opencli',
  protocol: 'ssh',
  terminalId: 'term-1',
  status: 'connected',
};

const originState = { origin: 'https://jumpserver.example.com', protocol: 'https:' };
const profileOk = { ok: true, profile: { id: 'user-1', name: 'Admin' } };
const facadeOk = { ok: true, reused: true };

beforeEach(() => {
  vi.restoreAllMocks();
  mockHttpDownload.mockReset();
});

function pageWithEvaluate(...results) {
  return {
    evaluate: vi.fn()
      .mockImplementation((input) => {
        if (typeof input === 'string') return Promise.resolve(undefined);
        if (results.length === 0) throw new Error('unexpected page.evaluate call');
        const next = results.shift();
        if (next instanceof Error) throw next;
        return Promise.resolve(next);
      }),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

function jumpServerPage(...results) {
  return pageWithEvaluate(originState, profileOk, facadeOk, ...results);
}

describe('jumpserver registry metadata', () => {
  it('declares persistent cookie-backed browser commands for the requested surface', () => {
    for (const name of ['connect', 'exec', 'view', 'upload', 'download']) {
      const command = getRegistry().get(`jumpserver/${name}`);
      expect(command).toMatchObject({
        site: 'jumpserver',
        name,
        strategy: Strategy.COOKIE,
        browser: true,
        siteSession: 'persistent',
        navigateBefore: false,
      });
    }
  });

  it('makes exec JSON by default while accepting the exact --json compatibility flag', () => {
    const command = getRegistry().get('jumpserver/exec');
    expect(command?.defaultFormat).toBe('json');
    expect(command?.columns).toEqual(['command', 'exitCode', 'output', 'assetId', 'assetName', 'assetAddress', 'accountAlias', 'terminalId']);
    expect(command?.args).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'command', positional: true, required: true }),
      expect.objectContaining({ name: 'wait', type: 'int', default: 30 }),
      expect.objectContaining({ name: 'json', type: 'bool', default: false }),
    ]));
  });

  it('declares the exact positional names for file transfer commands', () => {
    expect(getRegistry().get('jumpserver/upload')?.args).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'file', positional: true, required: true }),
      expect.objectContaining({ name: 'remote-dir', positional: true, required: true }),
    ]));
    expect(getRegistry().get('jumpserver/download')?.args).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'remote-file', positional: true, required: true }),
      expect.objectContaining({ name: 'local-dir', positional: true, required: true }),
    ]));
  });

  it('declares stable row schemas for connect and view', () => {
    expect(getRegistry().get('jumpserver/connect')?.columns).toEqual([
      'assetId', 'assetName', 'assetAddress', 'accountAlias', 'protocol', 'terminalId', 'status',
    ]);
    expect(getRegistry().get('jumpserver/view')?.columns).toEqual([
      'assetId', 'assetName', 'accountAlias', 'terminalId', 'lines', 'output',
    ]);
    expect(getRegistry().get('jumpserver/upload')?.columns).toEqual([
      'remotePath', 'fileName', 'size', 'status',
    ]);
    expect(getRegistry().get('jumpserver/download')?.columns).toEqual([
      'remotePath', 'fileName', 'size', 'mimeType', 'status', 'localPath',
    ]);
  });
});

describe('jumpserver connect', () => {
  it('connects the exact asset, replaces stale sockets, and returns sanitized identity', async () => {
    const command = getRegistry().get('jumpserver/connect');
    const page = jumpServerPage(
      {
        ok: true,
        snapshot: connectedAsset,
        replaced: true,
      },
    );

    await expect(command.func(page, { asset: connectedAsset.assetName })).resolves.toEqual([connectedAsset]);
    expect(page.evaluate).toHaveBeenCalledTimes(5);
  });

  it('typed-fails when the browser session is not authenticated', async () => {
    const command = getRegistry().get('jumpserver/connect');
    const page = pageWithEvaluate(originState, { ok: false, code: 'AUTH_REQUIRED', domain: 'jumpserver.example.com', message: 'login required' });

    await expect(command.func(page, { asset: connectedAsset.assetName })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('typed-fails zero and ambiguous asset matches', async () => {
    const command = getRegistry().get('jumpserver/connect');
    await expect(command.func(jumpServerPage({ ok: false, code: 'EMPTY_RESULT', message: 'not found' }), { asset: 'missing' }))
      .rejects.toBeInstanceOf(EmptyResultError);
    await expect(command.func(jumpServerPage({ ok: false, code: 'ARGUMENT', message: 'ambiguous asset: a, b' }), { asset: 'linux' }))
      .rejects.toBeInstanceOf(ArgumentError);
  });

  it('typed-fails multi-account ambiguity unless --account resolves one account', async () => {
    const command = getRegistry().get('jumpserver/connect');
    const page = jumpServerPage({ ok: false, code: 'ARGUMENT', message: 'ambiguous account: root, opencli' });

    await expect(command.func(page, { asset: connectedAsset.assetName })).rejects.toBeInstanceOf(ArgumentError);
  });
});

describe('jumpserver exec', () => {
  it('runs a shell command through the retained terminal and returns the exact JSON schema', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage(
      {
        ok: true,
        commandResult: {
          exitCode: 0,
          transcript: '\u001b[32mPython 3.12.1\u001b[0m\r\n',
          assetAddress: connectedAsset.assetAddress,
          assetName: connectedAsset.assetName,
          assetId: connectedAsset.assetId,
          accountAlias: connectedAsset.accountAlias,
          terminalId: connectedAsset.terminalId,
        },
      },
    );

    await expect(command.func(page, { command: 'python --version', wait: 10, json: true })).resolves.toEqual([{
      command: 'python --version',
      exitCode: 0,
      output: 'Python 3.12.1',
      assetId: connectedAsset.assetId,
      assetName: connectedAsset.assetName,
      assetAddress: connectedAsset.assetAddress,
      accountAlias: connectedAsset.accountAlias,
      terminalId: connectedAsset.terminalId,
    }]);
  });

  it('typed-fails non-zero exits with bounded command output', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage({
      ok: true,
      commandResult: {
        exitCode: 7,
        transcript: 'failed\n'.repeat(200),
        terminalId: connectedAsset.terminalId,
      },
    });

    await expect(command.func(page, { command: 'false', wait: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('cleans up the page lease and typed-fails on timeout', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage(
      { ok: false, code: 'TIMEOUT', message: 'command timed out' },
      { ok: true, cleaned: true },
    );

    await expect(command.func(page, { command: 'sleep 60', wait: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(installJumpServerFacade.toString()).toContain("cleanup('exec-timeout')");
  });

  it('rejects empty commands and invalid wait values before touching the browser', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = pageWithEvaluate();

    await expect(command.func(page, { command: '  ', wait: 10 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { command: 'whoami', wait: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('jumpserver view', () => {
  it('returns the last requested logical transcript lines without sending terminal input', async () => {
    const command = getRegistry().get('jumpserver/view');
    const page = jumpServerPage({
      ok: true,
      snapshot: {
        ...connectedAsset,
        transcript: 'one\r\ntwo\nthree\n',
      },
    });

    await expect(command.func(page, { tail: 2 })).resolves.toEqual([{
      assetId: connectedAsset.assetId,
      assetName: connectedAsset.assetName,
      accountAlias: connectedAsset.accountAlias,
      terminalId: connectedAsset.terminalId,
      lines: ['two', 'three'],
      output: 'two\nthree',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(5);
  });

  it('rejects invalid tail values before touching the browser', async () => {
    const command = getRegistry().get('jumpserver/view');
    const page = pageWithEvaluate();

    await expect(command.func(page, { tail: -1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('jumpserver upload', () => {
  it('uploads one local file through a live Web SFTP session and returns the receipt', async () => {
    const command = getRegistry().get('jumpserver/upload');
    const page = {
      ...jumpServerPage(
        { ok: true },
        { state: 'complete', uploaded: { remotePath: '/tmp/1.txt', fileName: '1.txt', size: 7, sha256: 'abc123' } },
        { ok: true, cleaned: true },
      ),
      uploadFiles: vi.fn().mockResolvedValue({ uploaded: true, files: 1, matches_n: 1, file_names: ['1.txt'] }),
    };

    await expect(command.func(page, { file: 'C:\\tmp\\1.txt', 'remote-dir': '/tmp', timeout: 30 })).resolves.toEqual([{
      remotePath: '/tmp/1.txt',
      fileName: '1.txt',
      size: 7,
      status: 'uploaded',
    }]);
    expect(page.uploadFiles).toHaveBeenCalledWith(expect.stringMatching(/jumpserver-upload/i), ['C:\\tmp\\1.txt']);
    expect(installJumpServerFacade.toString()).toContain('finally {\n        cleanupFile();');
  });

  it('cleans up file session state when upload times out after browser file selection', async () => {
    const command = getRegistry().get('jumpserver/upload');
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(2000);
    const page = {
      ...jumpServerPage(
        { ok: true },
        { state: 'waiting' },
        undefined,
        { ok: true, cleaned: true },
      ),
      uploadFiles: vi.fn().mockResolvedValue({ uploaded: true, files: 1, matches_n: 1, file_names: ['1.txt'] }),
    };

    await expect(command.func(page, { file: 'C:\\tmp\\1.txt', 'remote-dir': '/tmp', timeout: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), '__opencliJumpServer');
  });

  it('rejects empty local files and remote traversal before preparing browser upload state', async () => {
    const command = getRegistry().get('jumpserver/upload');
    const page = { ...pageWithEvaluate(), uploadFiles: vi.fn() };

    await expect(command.func(page, { file: '  ', 'remote-dir': '/tmp' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { file: 'C:\\tmp\\1.txt', 'remote-dir': '/tmp/../root' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.uploadFiles).not.toHaveBeenCalled();
  });
});

describe('jumpserver download', () => {
  it('downloads one remote file through the Web SFTP connector with browser cookies', async () => {
    const command = getRegistry().get('jumpserver/download');
    mockHttpDownload.mockResolvedValue({ success: true, size: 7, sha256: 'abc123' });
    const page = {
      ...jumpServerPage(
        {
          ok: true,
          download: {
            requestId: 'req-1',
            remotePath: '/tmp/1.txt',
            fileName: '1.txt',
            size: 7,
            mimeType: 'text/plain',
            url: 'https://jumpserver.example.com/koko/elfinder/connector/sftp-1/?cmd=file&target=t1',
          },
        },
        { ok: true, cleaned: true },
      ),
      getCookies: vi.fn().mockResolvedValue([{ name: 'jms_sessionid', value: 'session' }]),
    };

    await expect(command.func(page, { 'remote-file': '/tmp/1.txt', 'local-dir': '.', timeout: 30 })).resolves.toEqual([{
      remotePath: '/tmp/1.txt',
      fileName: '1.txt',
      size: 7,
      mimeType: 'text/plain',
      status: 'downloaded',
      localPath: expect.stringMatching(/[\\/]1\.txt$/),
    }]);
    expect(mockHttpDownload).toHaveBeenCalledWith(
      'https://jumpserver.example.com/koko/elfinder/connector/sftp-1/?cmd=file&target=t1',
      expect.stringMatching(/[\\/]1\.txt$/),
      expect.objectContaining({
        cookies: 'jms_sessionid=session',
        headers: expect.objectContaining({ 'JMS-KoKo-Request-ID': 'req-1' }),
        timeout: 30000,
      }),
    );
    expect(page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), '__opencliJumpServer');
  });

  it('typed-fails missing remote files and rejects unsafe local output paths', async () => {
    const command = getRegistry().get('jumpserver/download');
    await expect(command.func(
      jumpServerPage({ ok: false, code: 'EMPTY_RESULT', message: 'missing remote file' }),
      { 'remote-file': '/tmp/missing.txt', 'local-dir': '.', timeout: 10 },
    )).rejects.toBeInstanceOf(EmptyResultError);

    await expect(command.func(pageWithEvaluate(), { 'remote-file': '/../etc/passwd', 'local-dir': '.', timeout: 10 }))
      .rejects.toBeInstanceOf(ArgumentError);
  });
});

describe('jumpserver helper behavior', () => {
  it('fails closed on missing protocol/token/detail instead of using masking fallbacks', () => {
    const source = installJumpServerFacade.toString();
    expect(source).not.toContain("|| 'ssh'");
    expect(source).toContain('token?.id');
    expect(source).toContain('token?.value');
    expect(source).toContain('connection-token response did not include a token id or value');
    expect(source).toContain('const detail = await requestJson');
    expect(source).toContain("window.__name = window.__name || ((fn) => fn)");
    expect(source).toContain("parseCookie('csrftoken') || parseCookie('jms_csrftoken')");
    expect(source).toContain('/koko/ws/terminal/?token=${sessionToken}');
    expect(source).toContain('if (!state.terminalId)');
    expect(source).toContain('reject(new Error(state.lastError))');
  });

  it('preserves detail permed protocols and accounts when the tree row has empty arrays', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const fakeWindow = {
      location: {
        origin: 'https://jumpserver.example.com',
        protocol: 'https:',
        host: 'jumpserver.example.com',
      },
      localStorage: { getItem: vi.fn(() => '') },
      sessionStorage: { getItem: vi.fn(() => '') },
    };
    const fakeDocument = { cookie: '' };
    const treeRow = {
      id: 'asset-1',
      name: 'opencli-linux',
      address: '10.0.0.8',
      protocols: [],
      accounts: [],
    };
    const detailRow = {
      id: 'asset-1',
      name: 'opencli-linux',
      permed_protocols: [{ name: 'ssh', port: 22 }],
      permed_accounts: [{ id: 'account-1', name: 'opencli', username: 'opencli' }],
    };
    const fetchMock = vi.fn(async (url) => {
      const pathname = String(url).replace(fakeWindow.location.origin, '');
      const data = pathname.startsWith('/api/v1/perms/users/self/assets/tree/')
        ? [treeRow]
        : detailRow;
      return {
        ok: true,
        status: 200,
        url: String(url),
        text: async () => JSON.stringify(data),
      };
    });
    const page = {
      evaluate: vi.fn(async (input, ...args) => (typeof input === 'string' ? undefined : input(...args))),
    };

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.fetch = fetchMock;
    try {
      await installJumpServerFacade(page, fakeWindow.location.origin);
      const resolved = await fakeWindow.__opencliJumpServer.resolveAsset('opencli-linux', null);

      expect(resolved.asset.protocols).toEqual([{ name: 'ssh', port: 22 }]);
      expect(resolved.account).toMatchObject({ id: 'account-1', alias: 'opencli', username: 'opencli' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://jumpserver.example.com/api/v1/perms/users/self/assets/asset-1/',
        expect.any(Object),
      );
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.fetch = previousFetch;
    }
  });
  it('normalizes absolute remote paths and rejects traversal segments', () => {
    expect(normalizeRemoteDirectory('/tmp//opencli/')).toBe('/tmp/opencli');
    expect(normalizeRemoteFile('/tmp/1.txt')).toBe('/tmp/1.txt');
    expect(() => normalizeRemoteDirectory('/tmp/../root')).toThrow(ArgumentError);
    expect(() => normalizeRemoteFile('tmp/1.txt')).toThrow(ArgumentError);
  });

  it('extracts safe local filenames and prevents unsafe download targets', () => {
    expect(localBasename('C:\\tmp\\1.txt')).toBe('1.txt');
    expect(safeDownloadPath('/tmp/1.txt', '.')).toMatch(/[\\/]1\.txt$/);
    expect(() => normalizeRemoteFile('/tmp/../secret.txt')).toThrow(ArgumentError);
    expect(() => safeDownloadPath('/tmp/.', '.')).toThrow(ArgumentError);
  });

  it('strips ANSI/control sequences and extracts nonce-delimited command output', () => {
    expect(cleanCommandOutput(
      'prompt\n__START__\n\u001b[32mPython 3.12.1\u001b[0m\r\n__DONE__:0\nprompt',
      '__START__',
      '__DONE__',
    )).toBe('Python 3.12.1');
  });

  it('tails non-empty logical transcript lines', () => {
    expect(tailTranscript('one\r\ntwo\n\nthree\n', 2)).toBe('two\nthree');
  });
});
