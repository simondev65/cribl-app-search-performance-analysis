import {
  cancelJob,
  createJob,
  getJob,
  getJobMetrics,
  getJobResults,
  getJobStatus,
  TERMINAL,
  type JobMetrics,
  type JobStatusResponse,
} from '../api/cribl';
import { isFinished } from './plan';
import type { PlanItem, Run, SearchStats } from '../lib/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunnerCallbacks {
  /** Called whenever the run changes (in place); the caller clones for React. */
  onUpdate: (run: Run) => void;
  /** Called after each finished search; should persist the run. */
  onCheckpoint: (run: Run) => Promise<void>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function emptyStats(jobId: string, status: SearchStats['status']): SearchStats {
  return {
    jobId,
    status,
    execMs: null,
    queueMs: null,
    ttfbMs: null,
    launchMs: null,
    bytesScanned: null,
    eventsScanned: null,
    bytesSkipped: null,
    eventsSkipped: null,
    objectsSearched: null,
    results: null,
    cpuSeconds: null,
    executors: null,
    computeType: '',
    cacheStatus: '',
    startedAt: null,
  };
}

/** Metrics finalise a moment after the job completes; retry briefly until CPU metrics appear. */
async function fetchMetrics(jobId: string): Promise<JobMetrics | null> {
  let metrics: JobMetrics | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      metrics = await getJobMetrics(jobId);
      if (metrics?.cpuMetrics?.totalCPUSeconds !== undefined && metrics.totalMetrics) return metrics;
    } catch (err) {
      console.warn('[search-perf] metrics not ready', jobId, err);
    }
    await sleep(1500);
  }
  return metrics;
}

export function toStats(jobId: string, st: JobStatusResponse, metrics: JobMetrics | null, results: number | null, dataset: string): SearchStats {
  const created = num(st.timeCreated);
  const started = num(st.timeStarted);
  const completed = num(st.timeCompleted);
  const cache = st.cacheStatusesByStageId?.root?.[dataset] ?? Object.values(st.cacheStatusesByStageId?.root ?? {})[0];
  const ttfb = num(metrics?.timeToFirstByte);
  return {
    ...emptyStats(jobId, 'completed'),
    execMs: started !== null && completed !== null ? Math.max(0, completed - started) : null,
    queueMs: created !== null && started !== null ? Math.max(0, started - created) : null,
    ttfbMs: ttfb !== null ? ttfb * 1000 : null,
    launchMs: num(metrics?.launch?.totalMs),
    bytesScanned: num(metrics?.totalMetrics?.bytesIn) ?? num(st.bytesIn),
    eventsScanned: num(metrics?.totalMetrics?.eventsIn) ?? num(st.eventsIn),
    bytesSkipped: num(st.bytesSkipped),
    eventsSkipped: num(st.eventsSkipped),
    objectsSearched: num(metrics?.totalMetrics?.objectsSearched) ?? num(st.objectsSearched),
    results,
    cpuSeconds: num(metrics?.cpuMetrics?.totalCPUSeconds),
    executors: num(metrics?.executorCountMetrics?.executorsAllocatedCount),
    computeType: cache?.computeType ?? '',
    cacheStatus: cache?.cacheStatus ?? '',
    startedAt: started,
  };
}

/**
 * Runs the plan strictly one job at a time. Each job must reach a terminal state
 * before the next one is created, so the benchmark never queues behind itself.
 */
export class BenchmarkRunner {
  private stopRequested = false;
  private activeJobId: string | null = null;
  private readonly run: Run;
  private readonly cb: RunnerCallbacks;

  constructor(run: Run, cb: RunnerCallbacks) {
    this.run = run;
    this.cb = cb;
  }

  get current(): Run {
    return this.run;
  }

  stop(): void {
    this.stopRequested = true;
  }

  async start(): Promise<Run> {
    const run = this.run;
    run.status = 'running';
    this.touch();
    await this.safeCheckpoint();

    for (const item of run.plan) {
      if (this.stopRequested) break;
      if (isFinished(item)) continue;
      await this.execute(item);
      if (this.stopRequested && item.stats?.status === 'canceled') {
        // Stopped mid-search: leave it pending so a resume re-runs it.
        delete item.stats;
      }
      this.touch();
      await this.safeCheckpoint();
    }

    run.status = this.stopRequested ? 'stopped' : 'completed';
    this.touch();
    await this.safeCheckpoint();
    return run;
  }

  private touch() {
    this.run.updatedAt = Date.now();
    this.cb.onUpdate(this.run);
  }

  private async safeCheckpoint() {
    try {
      await this.cb.onCheckpoint(this.run);
    } catch (err) {
      console.error('[search-perf] could not save run checkpoint', err);
    }
  }

  private async execute(item: PlanItem): Promise<void> {
    const dataset = item.side === 'A' ? this.run.config.datasetA.id : this.run.config.datasetB.id;
    const timeoutMs = this.run.config.timeoutMinutes * 60_000;
    item.stats = emptyStats('', 'running');
    this.touch();

    let jobId: string;
    try {
      jobId = await createJob(item.query, item.earliest, item.latest);
    } catch (err) {
      item.stats = { ...emptyStats('', 'failed'), error: err instanceof Error ? err.message : String(err) };
      return;
    }
    this.activeJobId = jobId;
    item.stats = { ...item.stats, jobId, startedAt: Date.now() };
    this.touch();

    const createdAt = Date.now();
    let delay = 500;
    let st: JobStatusResponse | null = null;
    let pollErrors = 0;
    try {
      for (;;) {
        if (this.stopRequested) {
          await cancelJob(jobId);
          item.stats = { ...emptyStats(jobId, 'canceled'), error: 'Stopped by user' };
          return;
        }
        try {
          st = await getJobStatus(jobId);
          pollErrors = 0;
        } catch (err) {
          pollErrors += 1;
          if (pollErrors >= 5) throw err;
          console.warn('[search-perf] status poll failed, retrying', jobId, err);
        }
        if (st && TERMINAL.includes(st.status)) break;
        // Timeout counts from execution start so queue time never causes a timeout.
        const runningFor = st?.timeStarted ? Date.now() - st.timeStarted : 0;
        if (runningFor > timeoutMs || Date.now() - createdAt > timeoutMs * 3) {
          await cancelJob(jobId);
          item.stats = {
            ...emptyStats(jobId, 'timeout'),
            error: `Stopped after ${this.run.config.timeoutMinutes} min (per-search timeout)`,
            queueMs: st?.timeStarted && st.timeCreated ? st.timeStarted - st.timeCreated : null,
          };
          return;
        }
        await sleep(delay);
        delay = Math.min(delay + 250, 2000);
      }

      if (st!.status !== 'completed') {
        const job = await getJob(jobId).catch(() => null);
        const detail = job?.errorStateConfig?.message ?? job?.errorStateConfig?.errorMessage ?? job?.completionInfo ?? '';
        item.stats = { ...toStats(jobId, st!, null, null, dataset), status: st!.status === 'failed' ? 'failed' : 'canceled', error: detail || `Search ${st!.status}` };
        return;
      }

      const metrics = await fetchMetrics(jobId);
      const results = await getJobResults(jobId, 0)
        .then((r) => r.total)
        .catch(() => null);
      item.stats = toStats(jobId, st!, metrics, results, dataset);
    } catch (err) {
      item.stats = { ...emptyStats(jobId, 'failed'), error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.activeJobId = null;
    }
  }

  /** Best-effort cancel of the in-flight job (used when the page is closing). */
  cancelActive(): void {
    if (this.activeJobId) void cancelJob(this.activeJobId);
  }
}

/** Prepares a stored run for resuming: cancels orphaned jobs and resets unfinished items. */
export async function prepareResume(run: Run): Promise<Run> {
  for (const item of run.plan) {
    if (item.stats && item.stats.status === 'running') {
      if (item.stats.jobId) await cancelJob(item.stats.jobId);
      delete item.stats;
    }
  }
  return run;
}
