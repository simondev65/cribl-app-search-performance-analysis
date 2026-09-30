/**
 * Cribl Search REST client. All search endpoints are scoped to the default_search group.
 * The platform fetch proxy injects auth, so plain fetch() is used.
 */

const SEARCH = '/m/default_search/search';

export class CriblApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CriblApiError';
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchOptions {
  timeoutMs?: number;
  /** Retries on network errors, 429 and 5xx. Keep at 0 for non-idempotent calls. */
  retries?: number;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: string; error?: string };
    return body.message || body.error || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 25_000, retries = 2 } = opts;
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${window.CRIBL_API_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const reset = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(reset) && reset > 0 ? reset * 1000 : 500 * 2 ** attempt);
        attempt += 1;
        continue;
      }
      if (!res.ok) throw new CriblApiError(`${init.method ?? 'GET'} ${path} failed (${res.status}): ${await readError(res)}`, res.status);
      return res;
    } catch (err) {
      if (err instanceof CriblApiError) throw err;
      if (attempt >= retries) {
        const reason = err instanceof DOMException && err.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : String(err);
        throw new CriblApiError(`${init.method ?? 'GET'} ${path} ${reason}`, 0);
      }
      await sleep(500 * 2 ** attempt);
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  return (await res.json()) as T;
}

interface Counted<T> {
  items?: T[];
  count?: number;
}

function first<T>(body: Counted<T>, what: string): T {
  const item = body.items?.[0];
  if (!item) throw new CriblApiError(`Unexpected ${what} response: no items`, 200);
  return item;
}

// ---------------------------------------------------------------- datasets

export async function listDatasets(): Promise<Record<string, unknown>[]> {
  const body = await getJson<Counted<Record<string, unknown>>>(`${SEARCH}/datasets`);
  return body.items ?? [];
}

// ---------------------------------------------------------------- jobs

export type ApiJobStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface JobStatusResponse {
  status: ApiJobStatus;
  timeCreated?: number;
  timeStarted?: number;
  timeCompleted?: number;
  timeNow?: number;
  bytesIn?: number;
  bytesSkipped?: number;
  eventsIn?: number;
  eventsSkipped?: number;
  objectsSearched?: number;
  objectsFound?: number;
  cacheStatusesByStageId?: Record<string, Record<string, { cacheStatus?: string; computeType?: string; usedCache?: boolean; reason?: string }>>;
}

export interface JobRecord {
  id: string;
  status: ApiJobStatus;
  completionInfo?: string;
  errorStateConfig?: { message?: string; errorMessage?: string; [k: string]: unknown };
  totalBytesScanned?: number;
  totalEventCount?: number;
  timeToFirstByte?: number;
}

export interface JobMetrics {
  timeToFirstByte?: number | null;
  launch?: { totalMs?: number };
  cpuMetrics?: { totalCPUSeconds?: number; billableCPUSeconds?: number };
  executorCountMetrics?: { executorsAllocatedCount?: number; executorsDispatchedCount?: number };
  totalMetrics?: { bytesIn?: number; eventsIn?: number; eventsOut?: number; objectsSearched?: number };
  failureInfo?: { message?: string } | null;
}

export async function createJob(query: string, earliest: number, latest: number): Promise<string> {
  const res = await apiFetch(
    `${SEARCH}/jobs`,
    { method: 'POST', body: JSON.stringify({ query, earliest, latest }) },
    // Never retry: a retried POST could start a second, concurrent job.
    { retries: 0, timeoutMs: 30_000 },
  );
  const job = first((await res.json()) as Counted<JobRecord>, 'create job');
  return job.id;
}

export async function getJobStatus(id: string): Promise<JobStatusResponse> {
  return first(await getJson<Counted<JobStatusResponse>>(`${SEARCH}/jobs/${encodeURIComponent(id)}/status`), 'job status');
}

export async function getJob(id: string): Promise<JobRecord> {
  return first(await getJson<Counted<JobRecord>>(`${SEARCH}/jobs/${encodeURIComponent(id)}`), 'job');
}

export async function getJobMetrics(id: string): Promise<JobMetrics | null> {
  const body = await getJson<Counted<{ metrics?: JobMetrics }>>(`${SEARCH}/jobs/${encodeURIComponent(id)}/metrics`);
  return body.items?.[0]?.metrics ?? null;
}

/** Reads the first NDJSON page: header line (with totalEventCount) plus up to `limit` events. */
export async function getJobResults(id: string, limit = 1): Promise<{ total: number | null; events: Record<string, unknown>[] }> {
  const res = await apiFetch(`${SEARCH}/jobs/${encodeURIComponent(id)}/results?limit=${limit}&offset=0`);
  const lines = (await res.text()).split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { total: null, events: [] };
  const header = JSON.parse(lines[0]) as { totalEventCount?: number };
  return {
    total: typeof header.totalEventCount === 'number' ? header.totalEventCount : null,
    events: lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

export async function cancelJob(id: string): Promise<void> {
  try {
    await apiFetch(`${SEARCH}/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }, { retries: 1 });
  } catch (err) {
    // A job that already finished cannot be cancelled; that is fine.
    console.warn('[search-perf] cancel failed', id, err);
  }
}

export const TERMINAL: ApiJobStatus[] = ['completed', 'failed', 'canceled'];

/** Runs a tiny search and returns its first event, or null if the dataset has no recent data. */
export async function sampleEvent(dataset: string, lookbackSeconds = 24 * 3600): Promise<Record<string, unknown> | null> {
  const latest = Math.floor(Date.now() / 1000);
  const id = await createJob(`dataset="${dataset.replace(/"/g, '\\"')}" | limit 1`, latest - lookbackSeconds, latest);
  const deadline = Date.now() + 120_000;
  for (;;) {
    const st = await getJobStatus(id);
    if (TERMINAL.includes(st.status)) {
      if (st.status !== 'completed') throw new CriblApiError(`Sample search on ${dataset} ${st.status}`, 200);
      break;
    }
    if (Date.now() > deadline) {
      await cancelJob(id);
      throw new CriblApiError(`Sample search on ${dataset} took longer than 2 minutes`, 0);
    }
    await sleep(1000);
  }
  const { events } = await getJobResults(id, 1);
  return events[0] ?? null;
}
