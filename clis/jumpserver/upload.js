import { readFile } from 'node:fs/promises';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  localBasename,
  normalizePositiveInteger,
  normalizeRemoteDirectory,
  remoteJoin,
  sleepPage,
  throwJumpServerError,
  withJumpServer,
} from './utils.js';

const UPLOAD_INPUT_SELECTOR = '#opencli-jumpserver-upload-input';
const UPLOAD_CHUNK_SIZE = 128 * 1024;

cli({
  site: 'jumpserver',
  name: 'upload',
  description: 'Upload one local file through JumpServer Web SFTP to the connected asset',
  access: 'write',
  example: 'opencli jumpserver upload 1.txt /tmp',
  domain: 'jumpserver.local',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'file', type: 'string', required: true, positional: true, help: 'Local file path' },
    { name: 'remote-dir', type: 'string', required: true, positional: true, help: 'Absolute remote directory on the SSH asset' },
    { name: 'timeout', type: 'int', default: 120, help: 'Seconds to wait for upload completion (max 600)' },
  ],
  columns: ['remotePath', 'fileName', 'size', 'status'],
  func: async (page, args) => {
    const localPath = String(args.file ?? '').trim();
    const fileName = localBasename(localPath);
    const remoteDir = normalizeRemoteDirectory(args['remote-dir']);
    const remotePath = remoteJoin(remoteDir, fileName);
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 120, 'timeout', 600);
    await withJumpServer(page);
    if (typeof page.uploadFiles !== 'function') {
      throw new CommandExecutionError('JumpServer upload requires Browser Bridge uploadFiles support');
    }

    const prepared = await page.evaluate((stateKey, selector, targetDir) => {
      try {
        document.querySelector(selector)?.remove();
        const input = document.createElement('input');
        input.id = selector.slice(1);
        input.type = 'file';
        input.style.display = 'none';
        document.body.appendChild(input);
        window.__opencliJumpServerUpload = { state: 'waiting' };
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) {
            window.__opencliJumpServerUpload = { state: 'error', code: 'COMMAND_EXEC', message: 'No local file was attached' };
            return;
          }
          try {
            const uploaded = await window[stateKey].uploadFile(targetDir, file);
            window.__opencliJumpServerUpload = { state: 'complete', uploaded };
          } catch (error) {
            window.__opencliJumpServerUpload = {
              state: 'error',
              code: error?.opencliCode || 'COMMAND_EXEC',
              message: error?.message || String(error),
            };
          }
        }, { once: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error?.opencliCode || 'COMMAND_EXEC', message: error?.message || String(error) };
      }
    }, '__opencliJumpServer', UPLOAD_INPUT_SELECTOR, remoteDir);
    throwJumpServerError(prepared, 'jumpserver upload');

    try {
      const upload = await page.uploadFiles(UPLOAD_INPUT_SELECTOR, [localPath]);
      if (!upload?.uploaded || upload.files !== 1 || upload.matches_n !== 1) {
        throw new CommandExecutionError('Browser Bridge did not confirm exactly one JumpServer upload file');
      }
      if (!Array.isArray(upload.file_names) || !upload.file_names.includes(fileName)) {
        throw new CommandExecutionError('Browser Bridge did not confirm the expected JumpServer upload file name');
      }
    } catch (error) {
      if (!String(error?.message || error).includes('Page.fileChooserOpened not received')) throw error;
      const encoded = (await readFile(localPath)).toString('base64');
      await page.evaluate(() => { window.__opencliJumpServerUploadChunks = []; });
      for (let offset = 0; offset < encoded.length; offset += UPLOAD_CHUNK_SIZE) {
        await page.evaluate((chunk) => { window.__opencliJumpServerUploadChunks.push(chunk); }, encoded.slice(offset, offset + UPLOAD_CHUNK_SIZE));
      }
      await page.evaluate((stateKey, targetDir, name) => {
        const base64 = window.__opencliJumpServerUploadChunks.join('');
        delete window.__opencliJumpServerUploadChunks;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const file = new File([bytes], name, { type: 'application/octet-stream' });
        void window[stateKey].uploadFile(targetDir, file).then(
          (uploaded) => { window.__opencliJumpServerUpload = { state: 'complete', uploaded }; },
          (uploadError) => {
            window.__opencliJumpServerUpload = {
              state: 'error',
              code: uploadError?.opencliCode || 'COMMAND_EXEC',
              message: uploadError?.message || String(uploadError),
            };
          },
        );
      }, '__opencliJumpServer', remoteDir, fileName);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let result = null;
    while (!result && Date.now() < deadline) {
      await sleepPage(page, 0.25);
      const state = await page.evaluate(() => window.__opencliJumpServerUpload ?? null);
      if (state?.state === 'complete' || state?.state === 'error') result = state;
    }
    await page.evaluate((selector) => {
      document.querySelector(selector)?.remove();
      delete window.__opencliJumpServerUpload;
      delete window.__opencliJumpServerUploadChunks;
    }, UPLOAD_INPUT_SELECTOR).catch(() => undefined);

    if (!result || result.state === 'error') {
      await page.evaluate((stateKey) => window[stateKey]?.cleanup?.('file-session'), '__opencliJumpServer').catch(() => undefined);
    }
    if (!result) throwJumpServerError({ ok: false, code: 'TIMEOUT', message: 'JumpServer upload timed out' }, 'jumpserver upload', timeoutSeconds);
    if (result.state === 'error') throwJumpServerError({ ok: false, code: result.code, message: result.message }, 'jumpserver upload');
    const uploaded = result.uploaded;
    if (!uploaded?.fileName) throw new CommandExecutionError('JumpServer upload returned an unexpected elFinder response');
    return [{
      remotePath,
      fileName: uploaded.fileName,
      size: uploaded.size,
      status: 'uploaded',
    }];
  },
});
