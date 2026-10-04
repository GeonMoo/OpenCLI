import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const JUPYTER_ORIGIN = 'http://139.196.153.143:9091';
export const JUPYTER_LAB_URL = `${JUPYTER_ORIGIN}/lab`;

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

export function localBasename(localPath) {
  const value = String(localPath ?? '').trim();
  if (!value) throw new ArgumentError('file must be a non-empty local path');
  const basename = value.split(/[\\/]/).filter(Boolean).at(-1);
  if (!basename) throw new ArgumentError('file must include a file name');
  return basename;
}

export function normalizeRemotePath(value, fallbackName) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  const candidate = !raw ? fallbackName : raw.endsWith('/') ? `${raw}${fallbackName}` : raw;
  const normalized = candidate.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  const parts = normalized.split('/');
  if (!normalized || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new ArgumentError('path must be a non-empty Jupyter-relative file path without . or .. segments');
  }
  return normalized;
}

export function encodeJupyterPath(remotePath) {
  return remotePath.split('/').map(encodeURIComponent).join('/');
}

export async function assertJupyterLab(page, timeoutSeconds = 15) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let state = null;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      hasLabRoot: Boolean(document.querySelector('#jp-main-content-panel, #jupyter-main-app')),
      hasLoginForm: Boolean(document.querySelector('form[action*="login"], input[name="password"]')),
    }));
    if (state?.hasLoginForm || /\/login(?:[/?#]|$)/i.test(String(state?.url ?? ''))) {
      throw new AuthRequiredError('139.196.153.143:9091', 'JupyterLab requires an authenticated browser session');
    }
    if (state?.hasLabRoot && /JupyterLab/i.test(String(state?.title ?? ''))) return;
    await sleepPage(page, 0.25);
  }
  throw new CommandExecutionError(`Expected the authenticated JupyterLab UI, but the lab shell was not found at ${state?.url || 'unknown URL'}`);
}

export async function sleepPage(page, seconds) {
  if (typeof page.sleep === 'function') {
    await page.sleep(seconds);
    return;
  }
  await page.wait({ time: seconds });
}
