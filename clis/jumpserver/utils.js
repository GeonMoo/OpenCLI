import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@geonmoo/opencli/errors';

const JUMPSERVER_STATE_KEY = '__opencliJumpServer';
const JUMPSERVER_FACADE_VERSION = 7;
export const DEFAULT_BASE_PATH = '/ui/#/workbench/assets';

export function normalizeOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('OPENCLI_JUMPSERVER_URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ArgumentError('OPENCLI_JUMPSERVER_URL must use http or https');
  }
  return parsed.origin;
}

export async function resolveJumpServerOrigin(page) {
  const envOrigin = normalizeOrigin(process.env.OPENCLI_JUMPSERVER_URL);
  if (envOrigin) {
    const state = await page.evaluate(() => ({
      origin: window.location.origin,
      protocol: window.location.protocol,
    })).catch(() => null);
    if (!state || state.origin !== envOrigin || !/^https?:$/.test(String(state.protocol ?? ''))) {
      await page.goto(`${envOrigin}${DEFAULT_BASE_PATH}`, { waitUntil: 'load', settleMs: 1000 });
    }
    return envOrigin;
  }

  const state = await page.evaluate(() => ({
    origin: window.location.origin,
    protocol: window.location.protocol,
  })).catch(() => null);
  if (state && /^https?:$/.test(String(state.protocol ?? '')) && state.origin) return state.origin;
  throw new ArgumentError('OPENCLI_JUMPSERVER_URL is required when the persistent browser tab is not already on JumpServer');
}

export function normalizePositiveInteger(value, defaultValue, label, maxValue) {
  const numberValue = Number(value ?? defaultValue);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  if (numberValue > maxValue) {
    throw new ArgumentError(`${label} must be <= ${maxValue}`);
  }
  return numberValue;
}

export function normalizeNonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new ArgumentError(`${label} must not be empty`);
  return text;
}

export function normalizeRemoteDirectory(value) {
  const raw = normalizeNonEmpty(value, 'remote-dir').replace(/\\/g, '/');
  if (!raw.startsWith('/')) throw new ArgumentError('remote-dir must be an absolute Linux path');
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ArgumentError('remote-dir must not contain . or .. path segments');
  }
  return `/${parts.join('/')}`;
}

export function normalizeRemoteFile(value) {
  const raw = normalizeNonEmpty(value, 'remote-file').replace(/\\/g, '/');
  if (!raw.startsWith('/')) throw new ArgumentError('remote-file must be an absolute Linux path');
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ArgumentError('remote-file must not contain . or .. path segments');
  }
  if (parts.length === 0) throw new ArgumentError('remote-file must include a file name');
  return `/${parts.join('/')}`;
}

export function localBasename(localPath) {
  const raw = normalizeNonEmpty(localPath, 'local-file');
  const parts = raw.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ArgumentError('local-file must not contain . or .. path segments');
  }
  const basename = parts.at(-1);
  if (!basename || basename === '.' || basename === '..') {
    throw new ArgumentError('local-file must include a safe file name');
  }
  return basename;
}

export function safeDownloadPath(remoteFile, localDir) {
  const directory = normalizeNonEmpty(localDir, 'local-dir');
  const basename = path.basename(remoteFile);
  if (!basename || basename === '.' || basename === '..' || basename !== remoteFile.split('/').at(-1)) {
    throw new ArgumentError('remote-file must end with a safe file name');
  }
  return path.resolve(directory, basename);
}

export async function sleepPage(page, seconds) {
  if (typeof page.sleep === 'function') {
    await page.sleep(seconds);
    return;
  }
  await page.wait({ time: seconds });
}

export function stripAnsi(raw) {
  return String(raw ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

export function cleanCommandOutput(rawOutput, startMarker, doneMarker) {
  const text = stripAnsi(rawOutput);
  const doneIndex = text.lastIndexOf(doneMarker);
  const beforeDone = doneIndex >= 0 ? text.slice(0, doneIndex) : text;
  const startIndex = beforeDone.lastIndexOf(startMarker);
  return (startIndex >= 0 ? beforeDone.slice(startIndex + startMarker.length) : beforeDone).trim();
}

export function tailTranscript(rawTranscript, tail) {
  const lines = stripAnsi(rawTranscript).split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  return lines.slice(-tail).join('\n') || null;
}

export function throwJumpServerError(result, label, timeoutSeconds) {
  if (result?.ok) return;
  const code = result?.code;
  const message = result?.message || `${label} failed`;
  if (code === 'AUTH_REQUIRED') throw new AuthRequiredError(result.domain || 'jumpserver', message);
  if (code === 'EMPTY_RESULT') throw new EmptyResultError(label, message);
  if (code === 'ARGUMENT') throw new ArgumentError(message);
  if (code === 'TIMEOUT') throw new TimeoutError(label, timeoutSeconds ?? result.seconds ?? 30);
  throw new CommandExecutionError(message);
}

export async function assertJumpServerSession(page, origin) {
  const result = await page.evaluate(async (baseOrigin) => {
    try {
      const response = await fetch(`${baseOrigin}/api/v1/users/profile/?fields_size=mini`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const text = await response.text();
      if (response.status === 401 || response.status === 403 || /\/login(?:[/?#]|$)/i.test(response.url)) {
        return { ok: false, code: 'AUTH_REQUIRED', domain: new URL(baseOrigin).host, message: 'JumpServer requires an authenticated browser session' };
      }
      if (!response.ok) return { ok: false, code: 'COMMAND_EXEC', message: `JumpServer profile check failed: HTTP ${response.status}` };
      const data = text ? JSON.parse(text) : null;
      if (!data || typeof data !== 'object') return { ok: false, code: 'COMMAND_EXEC', message: 'JumpServer profile check returned an unexpected response' };
      return { ok: true, profile: { id: data.id ?? null, name: data.name ?? data.username ?? null } };
    } catch (error) {
      return { ok: false, code: 'COMMAND_EXEC', message: `JumpServer profile check failed: ${error?.message || error}` };
    }
  }, origin);
  throwJumpServerError(result, 'jumpserver auth');
  return result.profile;
}

export function createNonce() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function remoteJoin(directory, basename) {
  return `${directory.replace(/\/+$/, '')}/${basename}`;
}

export async function installJumpServerFacade(page, origin) {
  await page.evaluate('window.__name = window.__name || ((fn) => fn)');
  const result = await page.evaluate((baseOrigin, stateKey, facadeVersion) => {
    if (window[stateKey]?.version === facadeVersion && window[stateKey]?.origin === baseOrigin) {
      return { ok: true, reused: true };
    }

    const decodeBytes = (value) => {
      if (value instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(new Uint8Array(value));
      if (value instanceof Blob) {
        return '[blob]';
      }
      return String(value ?? '');
    };

    const parseCookie = (name) => {
      const prefix = `${name}=`;
      const item = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : '';
    };

    const orgHeader = () => {
      const keys = ['X-JMS-LUNA-ORG', 'X-JMS-ORG', 'jms_current_org', 'jms_current_org_id', 'jumpserver_current_org'];
      for (const key of keys) {
        const value = parseCookie(key) || window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
        if (value) return value;
      }
      return '';
    };

    const requestJson = async (path, init = {}) => {
      const headers = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.headers || {}),
      };
      const csrf = parseCookie('csrftoken') || parseCookie('jms_csrftoken');
      if (csrf) headers['X-CSRFToken'] = csrf;
      const org = orgHeader();
      if (org) headers['X-JMS-ORG'] = org;
      const response = await fetch(`${baseOrigin}${path}`, {
        method: init.method || 'GET',
        credentials: 'include',
        headers,
        body: init.body,
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { text }; }
      }
      if (response.status === 401 || response.status === 403 || /\/login(?:[/?#]|$)/i.test(response.url)) {
        throw Object.assign(new Error('JumpServer requires an authenticated browser session'), { opencliCode: 'AUTH_REQUIRED' });
      }
      if (!response.ok) {
        throw new Error(data?.detail || data?.msg || data?.message || `HTTP ${response.status}`);
      }
      return data;
    };

    const flattenAssets = (value, rows = []) => {
      if (Array.isArray(value)) {
        for (const item of value) flattenAssets(item, rows);
        return rows;
      }
      if (!value || typeof value !== 'object') return rows;
      const hasIdentity = value.id || value.key || value.value;
      const hasName = value.name || value.title || value.label || value.hostname || value.address || value.ip;
      if (hasIdentity && hasName) rows.push(value);
      for (const key of ['children', 'assets', 'nodes']) {
        if (Array.isArray(value[key])) flattenAssets(value[key], rows);
      }
      return rows;
    };

    const nonEmptyArray = (value) => (Array.isArray(value) && value.length > 0 ? value : null);

    const normalizeAsset = (raw) => {
      const asset = { ...raw };
      asset.id = asset.id || asset.key || asset.value;
      asset.name = asset.name || asset.title || asset.label || asset.hostname || asset.address || asset.ip || asset.id;
      asset.address = asset.address || asset.ip || asset.hostname || null;
      asset.platform = asset.platform?.name || asset.platform || asset.platform_name || null;
      asset.protocols = nonEmptyArray(asset.protocols) || nonEmptyArray(asset.permed_protocols) || [];
      asset.accounts = nonEmptyArray(asset.accounts) || nonEmptyArray(asset.permed_accounts) || [];
      return asset;
    };

    const matchesAsset = (asset, query) => {
      const wanted = String(query).toLowerCase();
      return [asset.id, asset.name, asset.address, asset.hostname, asset.ip]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === wanted);
    };

    const usableSshProtocol = (asset) => {
      const protocols = Array.isArray(asset.protocols) ? asset.protocols : [];
      const found = protocols.find((protocol) => {
        const name = String(protocol?.name || protocol || '').toLowerCase();
        return name === 'ssh';
      });
      return found?.name || found || null;
    };

    const chooseAccount = (asset, accountQuery) => {
      const accounts = Array.isArray(asset.accounts) ? asset.accounts : [];
      const usable = accounts.map((account) => ({
        ...account,
        id: account.id || account.value || account.key || null,
        alias: account.alias || account.name || account.username || account.label || null,
        username: account.username || account.name || account.alias || '',
      })).filter((account) => account.alias || account.username || account.id);
      if (accountQuery) {
        const wanted = String(accountQuery).toLowerCase();
        const matches = usable.filter((account) => [account.id, account.alias, account.username].filter(Boolean).some((value) => String(value).toLowerCase() === wanted));
        if (matches.length === 1) return matches[0];
        if (matches.length === 0) throw Object.assign(new Error(`No permitted account matched "${accountQuery}"`), { opencliCode: 'EMPTY_RESULT' });
        throw Object.assign(new Error(`Account "${accountQuery}" is ambiguous`), { opencliCode: 'ARGUMENT' });
      }
      if (usable.length === 1) return usable[0];
      if (usable.length === 0) throw Object.assign(new Error(`Asset "${asset.name}" has no permitted accounts`), { opencliCode: 'EMPTY_RESULT' });
      throw Object.assign(new Error(`Asset "${asset.name}" has multiple accounts; pass --account`), { opencliCode: 'ARGUMENT' });
    };

    const tokenValue = (token) => {
      const value = typeof token?.id === 'string' && token.id.trim() ? token.id : token?.value;
      if (!value || typeof value !== 'string') {
        throw new Error('JumpServer connection-token response did not include a token id or value');
      }
      return value;
    };

    let terminal = null;
    let fileSession = null;
    let preparedDownload = null;

    const closeSocket = (socket) => {
      try {
        if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close();
      } catch {}
    };

    const cleanupFile = () => {
      closeSocket(fileSession?.socket);
      fileSession = null;
      preparedDownload = null;
    };

    const cleanupTerminal = () => {
      closeSocket(terminal?.socket);
      terminal = null;
    };

    const cleanup = (reason) => {
      cleanupFile();
      if (reason === 'terminal' || reason === 'exec-timeout' || reason === 'reconnect' || reason === 'close') {
        cleanupTerminal();
      }
      return { cleaned: true, reason: reason || null };
    };

    const createConnectToken = async (asset, account, method) => {
      const body = {
        asset: asset.id,
        account: account.alias || account.username || account.id,
        protocol: 'ssh',
        input_username: account.username || '',
        input_secret: '',
        input_secret_type: 'password',
        connect_method: method,
        connect_options: {},
      };
      return requestJson('/api/v1/authentication/connection-token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    };

    const resolveAsset = async (query, accountQuery) => {
      const search = encodeURIComponent(query);
      const rawTree = await requestJson(`/api/v1/perms/users/self/assets/tree/?search=${search}`);
      let candidates = flattenAssets(rawTree).map(normalizeAsset).filter((asset) => matchesAsset(asset, query));
      const unique = new Map();
      for (const asset of candidates) unique.set(String(asset.id), asset);
      candidates = [...unique.values()];
      if (candidates.length === 0) throw Object.assign(new Error(`No permitted JumpServer asset matched "${query}"`), { opencliCode: 'EMPTY_RESULT' });
      if (candidates.length > 1) throw Object.assign(new Error(`JumpServer asset "${query}" is ambiguous`), { opencliCode: 'ARGUMENT' });
      let asset = candidates[0];
      const detail = await requestJson(`/api/v1/perms/users/self/assets/${encodeURIComponent(asset.id)}/`);
      asset = normalizeAsset({ ...asset, ...detail });
      const protocol = usableSshProtocol(asset);
      if (String(protocol).toLowerCase() !== 'ssh') {
        throw Object.assign(new Error(`Asset "${asset.name}" does not expose ssh protocol`), { opencliCode: 'EMPTY_RESULT' });
      }
      const account = chooseAccount(asset, accountQuery);
      return { asset, account };
    };

    const wsBase = () => `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    const openTerminal = async (asset, account, token) => {
      cleanup('reconnect');
      const sessionToken = encodeURIComponent(tokenValue(token));
      const url = `${wsBase()}/koko/ws/terminal/?token=${sessionToken}`;
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, ['JMS-KOKO']);
        const state = {
          socket,
          asset,
          account,
          terminalId: null,
          status: 'connecting',
          transcript: '',
          busy: false,
          createdAt: new Date().toISOString(),
          lastError: null,
        };
        socket.binaryType = 'arraybuffer';
        const timer = setTimeout(() => {
          cleanup('reconnect');
          reject(Object.assign(new Error('JumpServer terminal handshake timed out'), { opencliCode: 'TIMEOUT' }));
        }, 15000);
        socket.addEventListener('message', (event) => {
          if (event.data instanceof ArrayBuffer) {
            state.transcript += decodeBytes(event.data);
            if (state.transcript.length > 200000) state.transcript = state.transcript.slice(-100000);
            return;
          }
          let message = null;
          try { message = JSON.parse(String(event.data)); } catch {}
          if (!message) {
            state.transcript += String(event.data ?? '');
            return;
          }
          if (message.type === 'CONNECT') {
            clearTimeout(timer);
            state.terminalId = message.id;
            socket.send(JSON.stringify({ id: message.id, type: 'TERMINAL_INIT', data: JSON.stringify({ cols: 120, rows: 40 }) }));
            state.status = 'connected';
            terminal = state;
            resolve(snapshot());
          } else if (message.type === 'PING') {
            socket.send(JSON.stringify({ id: state.terminalId || message.id || '', type: 'PONG', data: '' }));
          } else if (message.type === 'CLOSE') {
            state.status = 'closed';
            state.lastError = 'Terminal closed';
          } else if (message.type === 'ERROR' || message.type === 'TERMINAL_ERROR') {
            state.status = 'error';
            state.lastError = message.err || message.data || 'Terminal error';
            if (!state.terminalId) {
              clearTimeout(timer);
              reject(new Error(state.lastError));
            }
          }
        });
        socket.addEventListener('error', () => {
          clearTimeout(timer);
          state.status = 'error';
          state.lastError = 'Terminal WebSocket failed';
          reject(new Error(state.lastError));
        }, { once: true });
        socket.addEventListener('close', () => {
          if (state.status === 'connecting') {
            clearTimeout(timer);
            reject(new Error('Terminal WebSocket closed before handshake'));
          } else if (state.status === 'connected') {
            state.status = 'closed';
          }
        });
      });
    };

    const requireTerminal = () => {
      if (!terminal || terminal.status !== 'connected' || !terminal.terminalId || terminal.socket?.readyState !== WebSocket.OPEN) {
        throw new Error('No active JumpServer terminal. Run `opencli jumpserver connect <asset>` first.');
      }
      return terminal;
    };

    const snapshot = () => {
      if (!terminal) return null;
      return {
        assetId: terminal.asset.id,
        assetName: terminal.asset.name,
        assetAddress: terminal.asset.address,
        accountAlias: terminal.account.alias || terminal.account.username || terminal.account.id,
        protocol: 'ssh',
        terminalId: terminal.terminalId,
        status: terminal.status,
        transcript: terminal.transcript,
        lastError: terminal.lastError,
        createdAt: terminal.createdAt,
      };
    };

    const sendCommand = async (command, startMarker, doneMarker, timeoutSeconds) => {
      const current = requireTerminal();
      if (current.busy) throw Object.assign(new Error('JumpServer terminal is already running a command'), { opencliCode: 'TIMEOUT' });
      current.busy = true;
      const shellLine = `printf '\\n${startMarker}\\n'\n${command}\n__opencli_status=$?\nprintf '\\n${doneMarker}:%s\\n' "$__opencli_status"\r`;
      current.socket.send(JSON.stringify({ id: current.terminalId, type: 'TERMINAL_DATA', data: shellLine }));
      const deadline = Date.now() + timeoutSeconds * 1000;
      return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (!terminal || terminal !== current) {
            clearInterval(timer);
            reject(new Error('JumpServer terminal was replaced while command was running'));
            return;
          }
          if (current.status === 'error' || current.status === 'closed') {
            clearInterval(timer);
            current.busy = false;
            reject(new Error(current.lastError || 'JumpServer terminal closed'));
            return;
          }
          const match = current.transcript.match(new RegExp(`${doneMarker}:(\\d+)`));
          if (match) {
            clearInterval(timer);
            current.busy = false;
            resolve({ ...snapshot(), exitCode: Number(match[1]), transcript: current.transcript });
            return;
          }
          if (Date.now() > deadline) {
            clearInterval(timer);
            current.busy = false;
            cleanup('exec-timeout');
            reject(Object.assign(new Error('JumpServer command timed out'), { opencliCode: 'TIMEOUT' }));
          }
        }, 100);
      });
    };

    const openFileSession = async (method) => {
      const current = requireTerminal();
      cleanupFile();
      const token = await createConnectToken(current.asset, current.account, 'web_sftp');
      const encodedToken = encodeURIComponent(tokenValue(token));
      const url = `${wsBase()}/koko/ws/sftp/?token=${encodedToken}`;
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, ['JMS-KOKO']);
        const state = { socket, targetId: current.asset.id, sid: null, method, pending: new Map() };
        const timer = setTimeout(() => {
          closeSocket(socket);
          reject(Object.assign(new Error('JumpServer SFTP handshake timed out'), { opencliCode: 'TIMEOUT' }));
        }, 15000);
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ id: crypto.randomUUID(), type: 'PING', data: 'ping' }));
        }, { once: true });
        socket.addEventListener('message', (event) => {
          let message = null;
          try { message = JSON.parse(String(event.data)); } catch {}
          if (message?.type === 'CONNECT') {
            clearTimeout(timer);
            state.sid = message.id;
            fileSession = state;
            resolve(state);
          } else if (message?.type === 'SFTP_BINARY') {
            const pending = state.pending.get(message.id);
            if (pending?.kind === 'download' && typeof message.raw === 'string') pending.chunks.push(message.raw);
          } else if (message?.type === 'SFTP_DATA') {
            const pending = state.pending.get(message.id);
            if (!pending) return;
            state.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.err || message.data === 'No permission') {
              pending.reject(new Error(message.err || 'Permission denied'));
            } else if (pending.kind === 'download') {
              pending.resolve({ message, chunks: pending.chunks });
            } else {
              pending.resolve(message);
            }
          } else if (message?.type === 'PING') {
            socket.send(JSON.stringify({ id: state.sid || message.id || '', type: 'PONG', data: '' }));
          } else if (message?.type === 'ERROR' || message?.type === 'TERMINAL_ERROR' || message?.type === 'CLOSE') {
            const pending = state.pending.get(message.id);
            if (pending) {
              state.pending.delete(message.id);
              clearTimeout(pending.timer);
              pending.reject(new Error(message.err || 'JumpServer SFTP WebSocket error'));
            } else if (!state.sid) {
              clearTimeout(timer);
              reject(new Error(message.err || 'JumpServer SFTP WebSocket error'));
            }
          }
        });
        socket.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('JumpServer SFTP WebSocket failed'));
        }, { once: true });
        socket.addEventListener('close', () => {
          clearTimeout(timer);
          for (const pending of state.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('JumpServer SFTP WebSocket closed'));
          }
          state.pending.clear();
          if (!state.sid) {
            reject(new Error('JumpServer SFTP WebSocket closed before handshake'));
          }
        });
      });
    };

    const sendSftpRequest = (session, cmd, data, options = {}) => {
      const id = options.id || Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          session.pending.delete(id);
          reject(Object.assign(new Error(`JumpServer SFTP ${cmd} timed out`), { opencliCode: 'TIMEOUT' }));
        }, 30000);
        session.pending.set(id, { resolve, reject, timer, kind: options.kind || cmd, chunks: [] });
        session.socket.send(JSON.stringify({
          id,
          type: 'SFTP_DATA',
          cmd,
          data: JSON.stringify(data),
          ...(options.raw ? { raw: options.raw } : {}),
        }));
      });
    };

    const bytesToBase64 = (bytes) => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    };

    const uploadFile = async (remoteDir, file) => {
      const session = await openFileSession('upload');
      try {
        await sendSftpRequest(session, 'list', { path: remoteDir });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chunkSize = 5 * 1024 * 1024;
        const requestId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
        const remotePath = `${remoteDir.replace(/\/$/, '')}/${file.name}`;
        const chunks = Math.max(1, Math.ceil(bytes.length / chunkSize));
        for (let index = 0; index < chunks; index += 1) {
          const chunk = bytes.subarray(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
          await sendSftpRequest(session, 'upload', {
            offset: index * chunkSize,
            size: bytes.length,
            path: remotePath,
            chunk: chunks > 1,
          }, { id: requestId, raw: bytesToBase64(chunk) });
        }
        if (chunks > 1) {
          await sendSftpRequest(session, 'upload', { offset: 0, merge: true, size: 0, path: remotePath }, { id: requestId });
        }
        return {
          fileName: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
        };
      } finally {
        cleanupFile();
      }
    };

    const prepareDownload = async (remoteFile) => {
      const session = await openFileSession('download');
      const result = await sendSftpRequest(session, 'download', { path: remoteFile, is_dir: false }, { kind: 'download' });
      const chunks = result.chunks || [];
      preparedDownload = { chunks, index: 0 };
      return {
        fileName: result.message?.data || remoteFile.split('/').at(-1),
        size: chunks.reduce((total, chunk) => total + atob(chunk).length, 0),
        mimeType: 'application/octet-stream',
        chunks: chunks.length,
      };
    };

    const takeDownloadChunk = () => {
      if (!preparedDownload || preparedDownload.index >= preparedDownload.chunks.length) return null;
      return preparedDownload.chunks[preparedDownload.index++];
    };

    window[stateKey] = {
      version: facadeVersion,
      origin: baseOrigin,
      requestJson,
      resolveAsset,
      createConnectToken,
      openTerminal,
      sendCommand,
      snapshot,
      cleanupTerminal,
      cleanupFile,
      cleanup,
      uploadFile,
      prepareDownload,
      takeDownloadChunk,
    };
    return { ok: true, reused: false };
  }, origin, JUMPSERVER_STATE_KEY, JUMPSERVER_FACADE_VERSION);
  throwJumpServerError(result, 'jumpserver facade');
  return result;
}

export async function withJumpServer(page) {
  const origin = await resolveJumpServerOrigin(page);
  await assertJumpServerSession(page, origin);
  await installJumpServerFacade(page, origin);
  return origin;
}
