import { apiFetch, CriblApiError } from './cribl';

/** App-scoped KV store. Values are stored as serialized JSON text. */

const keyPath = (key: string) => `/kvstore/${key.split('/').map(encodeURIComponent).join('/')}`;

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const res = await apiFetch(keyPath(key), { method: 'GET' });
    const text = await res.text();
    if (!text) return null;
    let value: unknown = JSON.parse(text);
    // Tolerate double-encoded values (a JSON string that itself holds JSON).
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        /* plain string value */
      }
    }
    return value as T;
  } catch (err) {
    if (err instanceof CriblApiError && err.status === 404) return null;
    console.error(`[search-perf] kvGet ${key} failed`, err);
    throw err;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  // PUT stores the raw body as the value. Send serialized JSON as text/plain: a JSON content type
  // makes the leader's body parser reject non-object bodies (and cap them) with a bare 400.
  await apiFetch(keyPath(key), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(value),
  });
}

export async function kvDelete(key: string): Promise<void> {
  try {
    await apiFetch(keyPath(key), { method: 'DELETE' });
  } catch (err) {
    if (err instanceof CriblApiError && err.status === 404) return;
    throw err;
  }
}
