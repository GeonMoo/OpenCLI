import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { normalizePositiveInteger, tailTranscript, throwJumpServerError, withJumpServer } from './utils.js';

cli({
  site: 'jumpserver',
  name: 'view',
  description: 'Show the tail of the active JumpServer terminal transcript without sending input',
  access: 'read',
  example: 'opencli jumpserver view --tail 10',
  domain: 'jumpserver.local',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'tail', type: 'int', default: 50, help: 'Transcript lines to return (max 1000)' },
  ],
  columns: ['assetId', 'assetName', 'accountAlias', 'terminalId', 'lines', 'output'],
  func: async (page, args) => {
    const tail = normalizePositiveInteger(args.tail, 50, 'tail', 1000);
    await withJumpServer(page);
    const result = await page.evaluate((stateKey) => {
      try {
        const snapshot = window[stateKey]?.snapshot();
        if (!snapshot || snapshot.status !== 'connected') {
          return { ok: false, code: 'COMMAND_EXEC', message: 'No active JumpServer terminal. Run `opencli jumpserver connect <asset>` first.' };
        }
        return { ok: true, snapshot };
      } catch (error) {
        return { ok: false, code: error?.opencliCode || 'COMMAND_EXEC', message: error?.message || String(error) };
      }
    }, '__opencliJumpServer');
    throwJumpServerError(result, 'jumpserver view');
    if (!result.snapshot?.terminalId) throw new CommandExecutionError('JumpServer terminal snapshot was incomplete');
    const output = tailTranscript(result.snapshot.transcript, tail);
    return [{
      assetId: result.snapshot.assetId,
      assetName: result.snapshot.assetName,
      accountAlias: result.snapshot.accountAlias,
      terminalId: result.snapshot.terminalId,
      lines: output ? output.split('\n') : [],
      output,
    }];
  },
});
