import { cli, Strategy } from '@geonmoo/opencli/registry';
import { CommandExecutionError } from '@geonmoo/opencli/errors';
import {
  cleanCommandOutput,
  createNonce,
  normalizeNonEmpty,
  normalizePositiveInteger,
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
    const result = await page.evaluate(async (stateKey, shellCommand, start, done, timeoutSeconds) => {
      try {
        const api = window[stateKey];
        const commandResult = await api.sendCommand(shellCommand, start, done, timeoutSeconds);
        return { ok: true, commandResult };
      } catch (error) {
        return {
          ok: false,
          code: error?.opencliCode || 'COMMAND_EXEC',
          domain: new URL(window[stateKey]?.origin || window.location.origin).host,
          message: error?.message || String(error),
        };
      }
    }, '__opencliJumpServer', command, startMarker, doneMarker, waitSeconds);
    throwJumpServerError(result, 'jumpserver exec', waitSeconds);

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
