import * as path from 'node:path';
import { cli, Strategy } from '@geonmoo/opencli/registry';
import { httpDownload } from '@geonmoo/opencli/download';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@geonmoo/opencli/errors';
import {
  JUPYTER_LAB_URL,
  JUPYTER_ORIGIN,
  assertJupyterLab,
  encodeJupyterPath,
  normalizePositiveInteger,
  normalizeRemotePath,
} from './utils.js';

cli({
  site: 'jupyter',
  name: 'download',
  description: '使用已登录的 JupyterLab 会话把远程文件下载到本地目录',
  access: 'read',
  example: 'opencli jupyter download data/report.csv --output ./jupyter-downloads --timeout 60 -f json',
  domain: '139.196.153.143:9091',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: JUPYTER_LAB_URL,
  defaultWindowMode: 'foreground',
  args: [
    { name: 'path', type: 'string', required: true, positional: true, help: 'Jupyter 工作目录中的相对文件路径' },
    { name: 'output', type: 'string', default: './jupyter-downloads', help: '本地输出目录' },
    { name: 'timeout', type: 'int', default: 60, help: '等待下载完成的秒数 (max 600)' },
  ],
  columns: ['remotePath', 'fileName', 'size', 'mimeType', 'status', 'localPath', 'url'],
  func: async (page, args) => {
    const remotePath = normalizeRemotePath(args.path, '');
    const outputDirectory = String(args.output ?? './jupyter-downloads').trim();
    if (!outputDirectory) throw new ArgumentError('output must not be empty');
    const timeoutSeconds = normalizePositiveInteger(args.timeout, 60, 'timeout', 600);
    await assertJupyterLab(page);

    const encodedPath = encodeJupyterPath(remotePath);
    let model;
    try {
      model = await page.fetchJson(`${JUPYTER_ORIGIN}/api/contents/${encodedPath}?content=0`);
    } catch (error) {
      const message = error?.message || String(error);
      if (/\b(?:401|403)\b/.test(message)) {
        throw new AuthRequiredError('139.196.153.143:9091', 'Jupyter download was rejected by the current browser session');
      }
      if (/\b404\b/.test(message)) {
        throw new EmptyResultError('jupyter download', `Remote file "${remotePath}" does not exist`);
      }
      throw new CommandExecutionError(`Jupyter file metadata request failed: ${message}`);
    }
    if (!model || model.type !== 'file' || !model.name) {
      throw new EmptyResultError('jupyter download', `Remote path "${remotePath}" is not a downloadable file`);
    }

    const fileUrl = `${JUPYTER_ORIGIN}/files/${encodedPath}?download=1`;
    const cookies = await page.getCookies({ url: JUPYTER_ORIGIN });
    const cookieHeader = (cookies || []).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    if (!cookieHeader) throw new AuthRequiredError('139.196.153.143:9091', 'No Jupyter browser cookies were available for download');
    const safeFileName = path.basename(String(model.name));
    if (!safeFileName || safeFileName !== model.name) {
      throw new CommandExecutionError('Jupyter returned an unsafe download file name');
    }
    const localPath = path.resolve(outputDirectory, safeFileName);
    const downloaded = await httpDownload(fileUrl, localPath, {
      cookies: cookieHeader,
      headers: { Referer: JUPYTER_LAB_URL },
      timeout: timeoutSeconds * 1000,
    });
    if (!downloaded.success) {
      if (/\b(?:401|403)\b/.test(downloaded.error || '')) {
        throw new AuthRequiredError('139.196.153.143:9091', 'Jupyter file download was rejected by the current browser session');
      }
      throw new CommandExecutionError(`Jupyter file download failed: ${downloaded.error || 'unknown error'}`);
    }

    return [{
      remotePath: model.path,
      fileName: model.name,
      size: downloaded.size,
      mimeType: model.mimetype || null,
      status: 'downloaded',
      localPath,
      url: fileUrl,
    }];
  },
});
