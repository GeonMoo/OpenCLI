import { ArgumentError, CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';

export const CDX = 'https://web.archive.org/cdx/search/cdx';
const REQUEST_TIMEOUT_SECONDS = 20;

export function dateBefore(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== value) {
    throw new ArgumentError('--date-before must be a valid UTC date in YYYY-MM-DD format');
  }
  // CDX's upper date bound is inclusive.
  return new Date(date.getTime() - 1000).toISOString().slice(0, 19).replace(/\D/g, '');
}

export function parseTimeOrder(value) {
  if (value === undefined) return undefined;
  const order = (Array.isArray(value) ? value.join(' ') : value).trim().replace(/\s+/g, ' ');
  if (order === 'time asc') return 'asc';
  if (order === 'time desc') return 'desc';
  throw new ArgumentError('--order must be time asc or time desc');
}

export function parseLimit(value) {
  const raw = String(value ?? '100');
  if (/^none$/i.test(raw)) return Infinity;
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(limit) || limit < 1) {
    throw new ArgumentError('--limit must be a positive integer or None');
  }
  return limit;
}

export async function fetchJson(apiUrl, label) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_SECONDS * 1000);
  try {
    const response = await fetch(apiUrl, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw new TimeoutError(`${label} request`, REQUEST_TIMEOUT_SECONDS);
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(`${label} request failed: ${error.message}`);
  }
}
