import * as path from 'node:path';
import { appendFile, writeFile } from 'node:fs/promises';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  normalizePositiveInteger,
  normalizeRemoteFile,
  safeDownloadPath,
  throwJumpServerError,
  withJumpServer,
} from './utils.js';

cli({
  site: 'jumpserver',
  name: 'download',
  description: 'Download one remote file through JumpServer Web SFTP from the connected asset',
  access: 'read',
  example: 'opencli jumpserver download /tmp/1.txt .',
  domain: 'jumpserver.local',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'remote-file', type: 'string', required: true, positional: true, help: 'Absolute remote file path on the SSH asset' },
    { name: 'local-dir', type: 'string', required: true, positional: true, help: 'Local output directory' },
    { name: 'timeout', type: 'int', default: 120, help: 'Seconds to wait for download completion (max 600)' },
  ],
  columns: ['remotePath', 'fileName', 'size', 'mimeType', 'status', 'localPath'],
  func: async (page, args) => {
    const remoteFile = normalizeRemoteFile(args['remote-file']);
    const localPath = safeDownloadPath(remoteFile, args['local-dir']);
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 120, 'timeout', 600);
    await withJumpServer(page);

    const prepared = await page.evaluate(async (stateKey, targetFile) => {
      try {
        const download = await window[stateKey].prepareDownload(targetFile);
        return { ok: true, download };
      } catch (error) {
        return {
          ok: false,
          code: error?.opencliCode || 'COMMAND_EXEC',
          domain: new URL(window[stateKey]?.origin || window.location.origin).host,
          message: error?.message || String(error),
        };
      }
    }, '__opencliJumpServer', remoteFile);
    throwJumpServerError(prepared, 'jumpserver download');

    let downloadedSize = 0;
    try {
      await writeFile(localPath, Buffer.alloc(0));
      for (let index = 0; index < prepared.download.chunks; index += 1) {
        const encoded = await page.evaluate((stateKey) => window[stateKey]?.takeDownloadChunk?.() ?? null, '__opencliJumpServer');
        if (typeof encoded !== 'string') throw new CommandExecutionError('JumpServer download chunk was unavailable');
        const chunk = Buffer.from(encoded, 'base64');
        await appendFile(localPath, chunk);
        downloadedSize += chunk.length;
      }
    } finally {
      await page.evaluate((stateKey) => window[stateKey]?.cleanup?.('file-session'), '__opencliJumpServer').catch(() => undefined);
    }
    const fileName = path.basename(remoteFile);
    return [{
      remotePath: remoteFile,
      fileName,
      size: downloadedSize,
      mimeType: prepared.download.mimeType,
      status: 'downloaded',
      localPath,
    }];
  },
});
