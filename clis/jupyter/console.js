import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { JUPYTER_LAB_URL, assertJupyterLab, normalizePositiveInteger, sleepPage } from './utils.js';

function cleanTerminalOutput(rawOutput, startMarker, doneMarker) {
  const text = String(rawOutput ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
  const doneIndex = text.lastIndexOf(doneMarker);
  const beforeDone = doneIndex >= 0 ? text.slice(0, doneIndex) : text;
  const startIndex = beforeDone.lastIndexOf(startMarker);
  return (startIndex >= 0 ? beforeDone.slice(startIndex + startMarker.length) : beforeDone).trim();
}

cli({
  site: 'jupyter',
  name: 'console',
  description: '在已登录的 JupyterLab Terminal 中执行 shell 命令并返回结果',
  access: 'write',
  example: 'opencli jupyter console "python --version" --timeout 10 -f json',
  domain: '139.196.153.143:9091',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: JUPYTER_LAB_URL,
  defaultWindowMode: 'foreground',
  args: [
    { name: 'command', type: 'string', required: true, positional: true, help: '要在 Terminal 中执行的 shell 命令' },
    { name: 'timeout', type: 'int', default: 30, help: '等待执行完成的秒数 (max 300)' },
  ],
  columns: ['command', 'exitCode', 'output', 'terminalName'],
  func: async (page, args) => {
    const command = String(args.command ?? '');
    if (!command.trim()) throw new ArgumentError('command must not be empty');
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 30, 'timeout', 300);
    await assertJupyterLab(page);
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const startMarker = `__OPENCLI_START_${nonce}__`;
    const doneMarker = `__OPENCLI_DONE_${nonce}__`;
    const shellLine = `printf '\\n${startMarker}\\n'; ${command}; __opencli_status=$?; printf '\\n${doneMarker}:%s\\n' "$__opencli_status"\r`;

    let terminalName = null;
    let result = null;
    try {
      const started = await page.evaluate(async (line, start, done) => {
        const xsrf = document.cookie.split('; ')
          .find((entry) => entry.startsWith('_xsrf='))
          ?.slice('_xsrf='.length);
        const response = await fetch('/api/terminals', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(xsrf ? { 'X-XSRFToken': decodeURIComponent(xsrf) } : {}),
          },
          body: '{}',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) return { ready: false, status: response.status, message: payload?.message || response.statusText };

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socketUrl = `${protocol}//${window.location.host}/terminals/websocket/${encodeURIComponent(payload.name)}`;
        const state = { phase: 'connecting', sessionName: payload.name, transcript: '', startMarker: start, doneMarker: done };
        window.__opencliJupyterTerminal = state;
        const socket = new WebSocket(socketUrl);
        state.socket = socket;
        socket.addEventListener('open', () => {
          state.phase = 'running';
          socket.send(JSON.stringify(['stdin', line]));
        });
        socket.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data);
            if (Array.isArray(message) && message[0] === 'stdout') state.transcript += String(message[1] ?? '');
          } catch {
            state.transcript += String(event.data ?? '');
          }
          const match = state.transcript.match(new RegExp(`${done}:(\\d+)`));
          if (match) {
            state.processCode = Number(match[1]);
            state.phase = 'complete';
          }
        });
        socket.addEventListener('error', () => {
          if (state.phase !== 'complete') {
            state.phase = 'error';
            state.failure = 'Terminal WebSocket failed';
          }
        });
        socket.addEventListener('close', () => {
          if (state.phase !== 'complete' && state.phase !== 'error') {
            state.phase = 'error';
            state.failure = 'Terminal WebSocket closed before command completion';
          }
        });
        return { ready: true, sessionName: payload.name };
      }, shellLine, startMarker, doneMarker);
      if (!started?.ready) {
        if (started?.status === 401 || started?.status === 403) {
          throw new AuthRequiredError('139.196.153.143:9091', 'Jupyter Terminal API rejected the current browser session');
        }
        throw new CommandExecutionError(`Could not create Jupyter Terminal${started?.status ? ` (HTTP ${started.status})` : ''}: ${started?.message || 'unknown error'}`);
      }
      terminalName = started.sessionName;

      const deadline = Date.now() + timeoutSeconds * 1000;
      while (!result && Date.now() < deadline) {
        await sleepPage(page, 0.1);
        const state = await page.evaluate(() => {
          const current = window.__opencliJupyterTerminal;
          if (!current || !['complete', 'error'].includes(current.phase)) return null;
          return {
            phase: current.phase,
            sessionName: current.sessionName,
            transcript: current.transcript,
            processCode: current.processCode,
            failure: current.failure,
          };
        });
        if (state) result = state;
      }
    } finally {
      await page.evaluate(async (name) => {
        const state = window.__opencliJupyterTerminal;
        if (state?.socket) state.socket.close();
        delete window.__opencliJupyterTerminal;
        if (!name) return;
        const xsrf = document.cookie.split('; ')
          .find((entry) => entry.startsWith('_xsrf='))
          ?.slice('_xsrf='.length);
        await fetch(`/api/terminals/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: xsrf ? { 'X-XSRFToken': decodeURIComponent(xsrf) } : {},
        }).catch(() => undefined);
      }, terminalName).catch(() => undefined);
    }

    if (!result) throw new TimeoutError('Jupyter Terminal command', timeoutSeconds);
    if (result.phase === 'error') throw new CommandExecutionError(`Jupyter Terminal failed: ${result.failure || 'unknown error'}`);
    const output = cleanTerminalOutput(result.transcript, startMarker, doneMarker);
    if (result.processCode !== 0) {
      throw new CommandExecutionError(`Jupyter Terminal command exited with code ${result.processCode}${output ? `: ${output}` : ''}`);
    }
    return [{ command, exitCode: result.processCode, output: output || null, terminalName: result.sessionName || terminalName }];
  },
});
