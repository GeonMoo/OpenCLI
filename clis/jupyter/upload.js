import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
  JUPYTER_LAB_URL,
  assertJupyterLab,
  localBasename,
  normalizePositiveInteger,
  normalizeRemotePath,
  sleepPage,
} from './utils.js';

const UPLOAD_INPUT_SELECTOR = '#opencli-jupyter-upload-input';

cli({
  site: 'jupyter',
  name: 'upload',
  description: '把本地文件上传到已登录的 JupyterLab 工作目录',
  access: 'write',
  example: 'opencli jupyter upload ./report.csv --path data/report.csv -f json',
  domain: '139.196.153.143:9091',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: JUPYTER_LAB_URL,
  defaultWindowMode: 'foreground',
  args: [
    { name: 'file', type: 'string', required: true, positional: true, help: '本地文件路径' },
    { name: 'path', type: 'string', default: '', help: 'Jupyter 相对目标路径；省略时使用本地文件名' },
    { name: 'timeout', type: 'int', default: 120, help: '等待上传完成的秒数 (max 600)' },
  ],
  columns: ['remotePath', 'fileName', 'size', 'type', 'status'],
  func: async (page, args) => {
    const localPath = String(args.file ?? '').trim();
    const fileName = localBasename(localPath);
    const remotePath = normalizeRemotePath(args.path, fileName);
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 120, 'timeout', 600);

    await assertJupyterLab(page);
    if (typeof page.uploadFiles !== 'function') {
      throw new CommandExecutionError('Jupyter upload requires Browser Bridge uploadFiles support');
    }

    const prepared = await page.evaluate((selector, targetPath) => {
      document.querySelector(selector)?.remove();
      const input = document.createElement('input');
      input.id = selector.slice(1);
      input.type = 'file';
      input.style.display = 'none';
      document.body.appendChild(input);
      window.__opencliJupyterUpload = { state: 'waiting' };
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) {
          window.__opencliJupyterUpload = { state: 'error', message: 'No local file was attached' };
          return;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          const chunkSize = 0x8000;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
          }
          const xsrf = document.cookie.split('; ')
            .find((entry) => entry.startsWith('_xsrf='))
            ?.slice('_xsrf='.length);
          const headers = {
            'Content-Type': 'application/json',
            ...(xsrf ? { 'X-XSRFToken': decodeURIComponent(xsrf) } : {}),
          };
          const pathSegments = targetPath.split('/');
          for (let index = 1; index < pathSegments.length; index += 1) {
            const directoryPath = pathSegments.slice(0, index).map(encodeURIComponent).join('/');
            const probe = await fetch(`/api/contents/${directoryPath}?content=0`, { credentials: 'include' });
            if (probe.ok) {
              const existing = await probe.json();
              if (existing?.type !== 'directory') throw new Error(`${pathSegments.slice(0, index).join('/')} is not a directory`);
              continue;
            }
            if (probe.status !== 404) throw new Error(`Could not inspect parent directory (HTTP ${probe.status})`);
            const created = await fetch(`/api/contents/${directoryPath}`, {
              method: 'PUT',
              credentials: 'include',
              headers,
              body: JSON.stringify({ type: 'directory' }),
            });
            if (!created.ok) {
              const errorPayload = await created.json().catch(() => null);
              throw new Error(errorPayload?.message || `Could not create parent directory (HTTP ${created.status})`);
            }
          }
          const encodedPath = targetPath.split('/').map(encodeURIComponent).join('/');
          const response = await fetch(`/api/contents/${encodedPath}`, {
            method: 'PUT',
            credentials: 'include',
            headers,
            body: JSON.stringify({ type: 'file', format: 'base64', content: btoa(binary) }),
          });
          const payload = await response.json().catch(() => null);
          window.__opencliJupyterUpload = response.ok
            ? { state: 'complete', status: response.status, fileSize: file.size, payload }
            : { state: 'error', status: response.status, message: payload?.message || response.statusText };
        } catch (error) {
          window.__opencliJupyterUpload = { state: 'error', message: error?.message || String(error) };
        }
      }, { once: true });
      return { ready: true };
    }, UPLOAD_INPUT_SELECTOR, remotePath);
    if (!prepared?.ready) throw new CommandExecutionError('Could not prepare the Jupyter upload input');

    const upload = await page.uploadFiles(UPLOAD_INPUT_SELECTOR, [localPath]);
    if (!upload?.uploaded || upload.files !== 1 || upload.matches_n !== 1) {
      throw new CommandExecutionError('Browser Bridge did not confirm exactly one Jupyter upload file');
    }
    if (!Array.isArray(upload.file_names) || !upload.file_names.includes(fileName)) {
      throw new CommandExecutionError('Browser Bridge did not confirm the expected Jupyter upload file name');
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let result = null;
    while (!result && Date.now() < deadline) {
      await sleepPage(page, 0.25);
      const state = await page.evaluate(() => window.__opencliJupyterUpload ?? null);
      if (state?.state === 'complete' || state?.state === 'error') result = state;
    }
    await page.evaluate((selector) => {
      document.querySelector(selector)?.remove();
      delete window.__opencliJupyterUpload;
    }, UPLOAD_INPUT_SELECTOR).catch(() => undefined);

    if (!result) throw new TimeoutError('Jupyter file upload', timeoutSeconds);
    if (result.state === 'error') {
      if (result.status === 401 || result.status === 403) {
        throw new AuthRequiredError('139.196.153.143:9091', 'Jupyter upload was rejected by the current browser session');
      }
      throw new CommandExecutionError(`Jupyter upload failed${result.status ? ` (HTTP ${result.status})` : ''}: ${result.message || 'unknown error'}`);
    }
    const model = result.payload;
    if (!model || model.type !== 'file' || model.path !== remotePath) {
      throw new CommandExecutionError('Jupyter upload returned an unexpected Contents API model');
    }

    return [{
      remotePath: model.path,
      fileName: model.name,
      size: Number.isFinite(model.size) ? model.size : result.fileSize,
      type: model.type,
      status: 'uploaded',
    }];
  },
});
