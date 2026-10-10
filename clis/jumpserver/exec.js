import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';
import {
  cleanCommandOutput,
  createNonce,
  normalizeNonEmpty,
  normalizePositiveInteger,
  sleepPage,
  throwJumpServerError,
  withJumpServer,
} from './utils.js';

cli({
  site: 'jumpserver',
  name: 'exec',
  description: 'Run a command in the active JumpServer terminal session',
  access: 'write',
  example: 'opencli jumpserver exec "python --version" --wait 10 --json',
  domain: 'jumpserver.local',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  defaultFormat: 'json',
  args: [
    { name: 'command', type: 'string', required: true, positional: true, help: 'Shell command to run in the connected asset' },
    { name: 'wait', type: 'int', default: 30, help: 'Seconds to wait for the completion marker (max 600)' },
    { name: 'json', type: 'bool', default: false, help: 'Compatibility alias; JSON is the default output for this command' },
  ],
  columns: ['command', 'exitCode', 'output', 'assetId', 'assetName', 'assetAddress', 'accountAlias', 'terminalId'],
  func: async (page, args) => {
    const command = normalizeNonEmpty(args.command, 'command');
    const waitSeconds = normalizePositiveInteger(args.wait, 30, 'wait', 600);
    await withJumpServer(page);

    const nonce = createNonce();
    const startMarker = `__OPENCLI_JUMPSERVER_START_${nonce}__`;
    const doneMarker = `__OPENCLI_JUMPSERVER_DONE_${nonce}__`;
    let result = null;
    try {
      const started = await page.evaluate((stateKey, shellCommand, start, done) => {
        try {
          const api = window[stateKey];
          api.startCommand(shellCommand, start, done);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            code: error?.opencliCode || 'COMMAND_EXEC',
            domain: new URL(window[stateKey]?.origin || window.location.origin).host,
            message: error?.message || String(error),
          };
        }
      }, '__opencliJumpServer', command, startMarker, doneMarker);
      throwJumpServerError(started, 'jumpserver exec', waitSeconds);

      // Chrome throttles hidden-page timers; enforce --wait in the CLI process.
      const deadline = Date.now() + waitSeconds * 1000;
      while (true) {
        const polled = await page.evaluate((stateKey, done) => {
          try {
            return { ok: true, commandResult: window[stateKey].pollCommand(done) };
          } catch (error) {
            return { ok: false, code: error?.opencliCode || 'COMMAND_EXEC', message: error?.message || String(error) };
          }
        }, '__opencliJumpServer', doneMarker);
        throwJumpServerError(polled, 'jumpserver exec', waitSeconds);
        if (polled.commandResult) {
          result = polled;
          break;
        }
        if (Date.now() >= deadline) break;
        await sleepPage(page, Math.min(0.25, Math.max(0, deadline - Date.now()) / 1000));
      }
      if (!result) throw new TimeoutError('jumpserver exec', waitSeconds, 'The asset terminal was closed. Reconnect with `opencli jumpserver login <asset>`. For PowerShell, use pwsh -NoProfile -NonInteractive -Command "..."; bare pwsh stays interactive.');
    } catch (error) {
      await page.evaluate((stateKey, done) => window[stateKey]?.cleanup?.('exec-timeout', done), '__opencliJumpServer', doneMarker).catch(() => undefined);
      throw error;
    }

    const row = result.commandResult;
    const output = cleanCommandOutput(row.transcript, startMarker, doneMarker);
    if (row.exitCode !== 0) {
      const bounded = output ? output.slice(-4000) : '';
      throw new CommandExecutionError(`JumpServer command exited with code ${row.exitCode}${bounded ? `: ${bounded}` : ''}`);
    }
    return [{
      command,
      exitCode: row.exitCode,
      output: output || null,
      assetId: row.assetId,
      assetName: row.assetName,
      assetAddress: row.assetAddress,
      accountAlias: row.accountAlias,
      terminalId: row.terminalId,
    }];
  },
});
