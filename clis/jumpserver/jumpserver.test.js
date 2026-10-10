import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@jackwener/opencli/errors';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

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
  remoteJoin,
  safeDownloadPath,
  installJumpServerFacade,
  resolveJumpServerOrigin,
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
  vi.unstubAllEnvs();
  vi.stubEnv('OPENCLI_JUMPSERVER_URL', '');
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

  it('exposes login as an alias for connect', () => {
    expect(getRegistry().get('jumpserver/connect')?.aliases).toContain('login');
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
  it('opens the supplied URL from a blank tab before authenticating and connecting', async () => {
    const command = getRegistry().get('jumpserver/connect');
    expect(command.args).toContainEqual(expect.objectContaining({ name: 'url', type: 'string' }));
    const page = pageWithEvaluate(
      { origin: 'null', protocol: 'about:' }, profileOk, facadeOk,
      { ok: true, snapshot: connectedAsset },
    );
    page.goto = vi.fn().mockResolvedValue(undefined);

    await expect(command.func(page, { asset: connectedAsset.assetName, url: 'https://jumpserver.example.com/luna/' }))
      .resolves.toEqual([connectedAsset]);
    expect(page.goto).toHaveBeenCalledWith('https://jumpserver.example.com/ui/#/workbench/assets', expect.any(Object));
    expect(page.goto.mock.invocationCallOrder[0]).toBeLessThan(page.evaluate.mock.invocationCallOrder[1]);
  });

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

describe('jumpserver origin selection', () => {
  it('prefers --url over the environment and navigates away from another origin', async () => {
    vi.stubEnv('OPENCLI_JUMPSERVER_URL', 'invalid-env-url');
    const page = pageWithEvaluate(originState);
    page.goto = vi.fn().mockResolvedValue(undefined);
    await expect(resolveJumpServerOrigin(page, 'http://192.168.0.68:8080/luna/'))
      .resolves.toBe('http://192.168.0.68:8080');
    expect(page.goto).toHaveBeenCalledWith('http://192.168.0.68:8080/ui/#/workbench/assets', expect.any(Object));
  });

  it('opens the environment URL when no --url is supplied', async () => {
    vi.stubEnv('OPENCLI_JUMPSERVER_URL', originState.origin);
    const page = pageWithEvaluate({ origin: 'null', protocol: 'about:' });
    page.goto = vi.fn().mockResolvedValue(undefined);
    await expect(resolveJumpServerOrigin(page)).resolves.toBe(originState.origin);
    expect(page.goto).toHaveBeenCalledOnce();
  });

  it.each([undefined, originState.origin])('keeps the existing tab and terminal without navigation (url: %s)', async (url) => {
    const page = pageWithEvaluate(originState);
    page.goto = vi.fn();
    await expect(resolveJumpServerOrigin(page, url)).resolves.toBe(originState.origin);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it.each(['192.168.0.68:8080', 'file:///C:/test', 'javascript:alert(1)'])('rejects invalid --url before browser navigation: %s', async (url) => {
    const page = pageWithEvaluate();
    await expect(resolveJumpServerOrigin(page, url)).rejects.toThrow(/--url must/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('explains how to supply the URL when no configuration or usable tab exists', async () => {
    const page = pageWithEvaluate({ origin: 'null', protocol: 'about:' });
    await expect(resolveJumpServerOrigin(page)).rejects.toThrow(/Provide --url .*OPENCLI_JUMPSERVER_URL/);
  });
});

describe('jumpserver exec', () => {
  it('runs a shell command through the retained terminal and returns the exact JSON schema', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage(
      { ok: true },
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
    const page = jumpServerPage({ ok: true }, {
      ok: true,
      commandResult: {
        exitCode: 7,
        transcript: 'failed\n'.repeat(200),
        terminalId: connectedAsset.terminalId,
      },
    });

    await expect(command.func(page, { command: 'false', wait: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('enforces the CLI deadline for an unfinished interactive command and closes its terminal', async () => {
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage(
      { ok: true },
      { ok: true, commandResult: null },
      { ok: true, commandResult: null },
      { ok: true, cleaned: true },
    );

    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    page.sleep.mockImplementation(async () => { now = 1000; });
    await expect(command.func(page, { command: 'pwsh', wait: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(page.sleep).toHaveBeenCalledOnce();
    expect(page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), '__opencliJumpServer', expect.stringContaining('__OPENCLI_JUMPSERVER_DONE_'));
  });

  it('accepts a completion marker on the final deadline poll without closing the terminal', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const command = getRegistry().get('jumpserver/exec');
    const page = jumpServerPage(
      { ok: true }, { ok: true, commandResult: null },
      { ok: true, commandResult: { ...connectedAsset, exitCode: 0, transcript: 'done' } },
    );
    page.sleep.mockImplementation(async () => { now = 1000; });
    await expect(command.func(page, { command: 'true', wait: 1 })).resolves.toMatchObject([{ exitCode: 0, output: 'done' }]);
    expect(page.evaluate.mock.calls.at(-1)[0].toString()).toContain('pollCommand');
  });

  it('closes its unfinished terminal after a polling transport failure without resending the command', async () => {
    const failure = new Error('connection dropped');
    const page = jumpServerPage({ ok: true }, failure, { ok: true, cleaned: true });
    await expect(getRegistry().get('jumpserver/exec').func(page, { command: 'pwsh', wait: 1 })).rejects.toBe(failure);
    expect(page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), '__opencliJumpServer', expect.stringContaining('__OPENCLI_JUMPSERVER_DONE_'));
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
  it.each(['C:\\tmp\\1.txt', '1.txt', path.join('upload files', '1.txt')])('resolves the local path %s before browser upload and returns the receipt', async (localFile) => {
    const command = getRegistry().get('jumpserver/upload');
    const page = {
      ...jumpServerPage(
        { ok: true },
        { state: 'complete', uploaded: { remotePath: '/tmp/1.txt', fileName: '1.txt', size: 7, sha256: 'abc123' } },
        { ok: true, cleaned: true },
      ),
      uploadFiles: vi.fn().mockResolvedValue({ uploaded: true, files: 1, matches_n: 1, file_names: ['1.txt'] }),
    };

    await expect(command.func(page, { file: localFile, 'remote-dir': '/tmp', timeout: 30 })).resolves.toEqual([{
      remotePath: '/tmp/1.txt',
      fileName: '1.txt',
      size: 7,
      status: 'uploaded',
    }]);
    expect(page.uploadFiles).toHaveBeenCalledWith(expect.stringMatching(/jumpserver-upload/i), [path.resolve(localFile)]);
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
  it('downloads Web SFTP chunks without changing their bytes', async () => {
    const command = getRegistry().get('jumpserver/download');
    const chunks = [Buffer.from([0, 1, 2, 255]), Buffer.from('opencli')];
    const expected = Buffer.concat(chunks);
    const localDir = await mkdtemp(path.join(tmpdir(), 'opencli-jumpserver-'));
    const page = jumpServerPage(
      { ok: true, download: { size: expected.length, mimeType: 'application/octet-stream', chunks: chunks.length } },
      ...chunks.map((chunk) => chunk.toString('base64')),
      { ok: true, cleaned: true },
    );

    try {
      const result = await command.func(page, { 'remote-file': '/tmp/1.bin', 'local-dir': localDir, timeout: 30 });
      expect(result).toEqual([{
        remotePath: '/tmp/1.bin',
        fileName: '1.bin',
        size: expected.length,
        mimeType: 'application/octet-stream',
        status: 'downloaded',
        localPath: path.join(localDir, '1.bin'),
      }]);
      await expect(readFile(path.join(localDir, '1.bin'))).resolves.toEqual(expected);
      expect(page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), '__opencliJumpServer');
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
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
    expect(source).toContain("parseCookie('jms_csrftoken') || parseCookie('csrftoken')");
    expect(source).toContain('/koko/ws/terminal/?token=${sessionToken}');
    expect(source).toContain('if (!state.terminalId)');
    expect(source).toContain('reject(new Error(state.lastError))');
  });

  it('uses the asset platform type to execute commands in Linux and Windows cmd terminals', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousWebSocket = globalThis.WebSocket;
    const encoder = new TextEncoder();
    const scenarios = [
      { platformType: 'linux', command: 'true', exitCode: 0, output: 'linux-ok' },
      { platformType: 'windows', command: 'ver', exitCode: 0, output: 'windows-ok' },
      { platformType: 'windows', command: 'cmd /c exit /b 7', exitCode: 7, output: 'windows-failed' },
      { platformType: 'windows', command: 'echo "a!b"', exitCode: 0, output: '"a!b"' },
      { platformType: 'windows', command: 'if not exist C:\\Windows echo missing', exitCode: 0, output: '' },
    ];

    try {
      for (const scenario of scenarios) {
        const sent = [];
        class FakeWebSocket {
          static OPEN = 1;
          static CLOSING = 2;
          static CLOSED = 3;
          readyState = FakeWebSocket.OPEN;
          listeners = new Map();

          constructor() {
            queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'CONNECT', id: 'term-1' }) }));
          }

          addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
          }

          send(raw) {
            const message = JSON.parse(raw);
            sent.push(message);
            if (message.type !== 'TERMINAL_DATA') return;
            const transcript = scenario.platformType === 'windows'
              ? `C:\\Users\\opencli>${message.data}\r\n__START__\r\n${scenario.output}\r\n__DONE__:${scenario.exitCode}\r\nC:\\Users\\opencli>`
              : `${message.data}\n__START__\n${scenario.output}\n__DONE__:${scenario.exitCode}\n`;
            queueMicrotask(() => this.emit('message', { data: encoder.encode(transcript).buffer }));
          }

          emit(type, event) {
            for (const listener of this.listeners.get(type) || []) listener(event);
          }

          close() {
            this.readyState = FakeWebSocket.CLOSED;
          }
        }

        globalThis.window = {
          location: { origin: 'https://jumpserver.example.com', protocol: 'https:', host: 'jumpserver.example.com' },
          localStorage: { getItem: () => '' },
          sessionStorage: { getItem: () => '' },
        };
        globalThis.document = { cookie: '' };
        globalThis.WebSocket = FakeWebSocket;
        const page = { evaluate: vi.fn(async (input, ...args) => (typeof input === 'string' ? undefined : input(...args))) };

        await installJumpServerFacade(page, globalThis.window.location.origin);
        const api = globalThis.window.__opencliJumpServer;
        await api.openTerminal(
          { id: 'asset-1', name: 'host', address: '10.0.0.8', platformType: scenario.platformType },
          { id: 'account-1', alias: 'opencli' },
          { id: 'token-1' },
        );
        const failedSend = vi.spyOn(FakeWebSocket.prototype, 'send').mockImplementationOnce(() => { throw new Error('send failed'); });
        expect(() => api.startCommand(scenario.command, '__START__', '__FAILED__')).toThrow('send failed');
        failedSend.mockRestore();
        const browserTimer = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => { throw new Error('background timer must not be used'); });
        try {
          expect(api.startCommand(scenario.command, '__START__', '__DONE__')).toBeUndefined();
          expect(api.pollCommand('__DONE__')).toBeNull();
          expect(() => api.pollCommand('__OLD__')).toThrow('replaced');
          expect(api.cleanup('exec-timeout', '__OLD__')).toMatchObject({ cleaned: false });
          expect(api.snapshot().status).toBe('connected');
          await Promise.resolve();
        } finally {
          browserTimer.mockRestore();
        }
        const result = api.pollCommand('__DONE__');
        const terminalData = sent.find((message) => message.type === 'TERMINAL_DATA')?.data;

        expect(result.exitCode).toBe(scenario.exitCode);
        expect(cleanCommandOutput(result.transcript, '__START__', '__DONE__')).toBe(scenario.output);
        if (scenario.platformType === 'windows') {
          expect(terminalData).toMatch(/^cmd \/d \/q \/v:off \/c "/);
          expect(terminalData).toContain(`&(${scenario.command})`);
          expect(terminalData).toContain(')&call echo __DONE__:^%errorlevel^%"');
          expect(terminalData).not.toContain("printf '");
        } else {
          expect(terminalData).toContain('__opencli_status=$?');
          expect(terminalData).toContain("printf '\\n__DONE__:%s\\n'");
        }
      }
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.WebSocket = previousWebSocket;
    }
  });

  it('sends empty and binary uploads as explicit Web SFTP raw payloads', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousWebSocket = globalThis.WebSocket;
    const sockets = [];

    class FakeWebSocket {
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.OPEN;
      listeners = new Map();
      sent = [];

      constructor(url) {
        this.kind = String(url).includes('/ws/sftp/') ? 'sftp' : 'terminal';
        sockets.push(this);
        queueMicrotask(() => {
          if (this.kind === 'sftp') this.emit('open', {});
          this.emit('message', { data: JSON.stringify({ type: 'CONNECT', id: `${this.kind}-1` }) });
        });
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      send(raw) {
        const message = JSON.parse(raw);
        this.sent.push(message);
        if (this.kind === 'sftp' && message.type === 'SFTP_DATA') {
          queueMicrotask(() => this.emit('message', {
            data: JSON.stringify({ id: message.id, type: 'SFTP_DATA', data: 'ok' }),
          }));
        }
      }

      emit(type, event) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }
    }

    const fakeWindow = {
      location: { origin: 'https://jumpserver.example.com', protocol: 'https:', host: 'jumpserver.example.com' },
      localStorage: { getItem: () => '' },
      sessionStorage: { getItem: () => '' },
    };
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      status: 201,
      url: String(url),
      text: async () => JSON.stringify({ id: 'sftp-token' }),
    }));

    globalThis.window = fakeWindow;
    globalThis.document = { cookie: '' };
    globalThis.fetch = fetchMock;
    globalThis.WebSocket = FakeWebSocket;
    try {
      const page = { evaluate: vi.fn(async (input, ...args) => (typeof input === 'string' ? undefined : input(...args))) };
      await installJumpServerFacade(page, fakeWindow.location.origin);
      const api = fakeWindow.__opencliJumpServer;
      await api.openTerminal(
        { id: 'asset-1', name: 'host', address: '192.168.0.68', platformType: 'windows' },
        { id: 'account-1', alias: 'mozhe' },
        { id: 'terminal-token' },
      );

      for (const [name, bytes] of [['empty.bin', Buffer.alloc(0)], ['binary.bin', Buffer.from([0, 255, 65])]]) {
        await expect(api.uploadFile('/C:/Users/mozhe/Downloads', {
          name,
          size: bytes.length,
          type: 'application/octet-stream',
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        })).resolves.toMatchObject({ fileName: name, size: bytes.length });
      }

      const uploads = sockets
        .flatMap((socket) => socket.sent)
        .filter((message) => message.type === 'SFTP_DATA' && message.cmd === 'upload');
      expect(uploads).toHaveLength(2);
      expect(uploads.map((message) => ({ raw: message.raw, data: JSON.parse(message.data) }))).toEqual([
        {
          raw: '',
          data: { offset: 0, size: 0, path: '/C:/Users/mozhe/Downloads/empty.bin', chunk: false },
        },
        {
          raw: 'AP9B',
          data: { offset: 0, size: 3, path: '/C:/Users/mozhe/Downloads/binary.bin', chunk: false },
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.fetch = previousFetch;
      globalThis.WebSocket = previousWebSocket;
    }
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
    const fakeDocument = { cookie: 'csrftoken=generic; jms_csrftoken=jumpserver' };
    const treeRow = {
      id: 'asset-1',
      name: 'opencli-linux',
      title: 'opencli-linux\n192.168.0.68',
      meta: { data: { address: '192.168.0.68', platform_type: 'windows' } },
      protocols: [],
      accounts: [],
    };
    const detailRow = {
      id: 'asset-1',
      name: 'opencli-linux',
      type: { label: 'Windows', value: 'windows' },
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
      const resolved = await fakeWindow.__opencliJumpServer.resolveAsset('192.168.0.68', null);

      expect(resolved.asset.protocols).toEqual([{ name: 'ssh', port: 22 }]);
      expect(resolved.asset.address).toBe('192.168.0.68');
      expect(resolved.asset.platformType).toBe('windows');
      expect(resolved.account).toMatchObject({ id: 'account-1', alias: 'opencli', username: 'opencli' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://jumpserver.example.com/api/v1/perms/users/self/assets/asset-1/',
        expect.objectContaining({ headers: expect.objectContaining({ 'X-CSRFToken': 'jumpserver' }) }),
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
    expect(normalizeRemoteDirectory('/C:\\Users\\mozhe\\Downloads')).toBe('/C:/Users/mozhe/Downloads');
    expect(normalizeRemoteFile('/C:\\Users\\mozhe\\Downloads\\1.txt')).toBe('/C:/Users/mozhe/Downloads/1.txt');
    expect(remoteJoin('/C:/Users/mozhe/Downloads', '1.txt')).toBe('/C:/Users/mozhe/Downloads/1.txt');
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
