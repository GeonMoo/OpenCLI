import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { withJumpServer, normalizeNonEmpty, throwJumpServerError } from './utils.js';

cli({
  site: 'jumpserver',
  name: 'connect',
  aliases: ['login'],
  description: 'Connect to a permitted JumpServer SSH asset and keep the terminal in the persistent browser session',
  access: 'write',
  example: 'opencli jumpserver connect my-linux-host --url https://jumpserver.example.com',
  domain: 'jumpserver.local',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'asset', type: 'string', required: true, positional: true, help: 'Exact JumpServer asset name, id, address, or hostname' },
    { name: 'account', type: 'string', default: '', help: 'Account alias/username/id when the asset has multiple permitted accounts' },
    { name: 'url', type: 'string', default: '', help: 'JumpServer http(s) URL; opens the site automatically and overrides OPENCLI_JUMPSERVER_URL' },
  ],
  columns: ['assetId', 'assetName', 'assetAddress', 'accountAlias', 'protocol', 'terminalId', 'status'],
  func: async (page, args) => {
    const assetQuery = normalizeNonEmpty(args.asset, 'asset');
    const accountQuery = String(args.account ?? '').trim();
    const origin = await withJumpServer(page, args.url);

    const result = await page.evaluate(async (stateKey, query, account) => {
      try {
        const api = window[stateKey];
        const resolved = await api.resolveAsset(query, account || null);
        const token = await api.createConnectToken(resolved.asset, resolved.account, 'web_cli');
        const snapshot = await api.openTerminal(resolved.asset, resolved.account, token);
        return { ok: true, snapshot };
      } catch (error) {
        return {
          ok: false,
          code: error?.opencliCode || 'COMMAND_EXEC',
          domain: new URL(window[stateKey]?.origin || window.location.origin).host,
          message: error?.message || String(error),
        };
      }
    }, '__opencliJumpServer', assetQuery, accountQuery);
    throwJumpServerError(result, 'jumpserver connect', 15);
    const row = result.snapshot;
    if (!row?.terminalId || row.status !== 'connected') {
      throw new CommandExecutionError(`JumpServer terminal did not reach connected state at ${origin}`);
    }
    return [{
      assetId: row.assetId,
      assetName: row.assetName,
      assetAddress: row.assetAddress,
      accountAlias: row.accountAlias,
      protocol: row.protocol,
      terminalId: row.terminalId,
      status: row.status,
    }];
  },
});
