import { isFinished } from '../engine/plan';
import type { PlanItem, Run } from './types';

export interface Progress {
  done: number;
  total: number;
  /** The item executing right now, if any */
  current: PlanItem | null;
  /** Average wall time per finished scored search (queue + execution), ms */
  avgWallMs: number | null;
  /** Rough time left, ms */
  etaMs: number | null;
}

/** Wall time of one finished search: queue + execution. Used only for the ETA, never for scoring. */
function wallMs(item: PlanItem): number | null {
  const s = item.stats;
  if (!s || s.execMs === null) return null;
  return s.execMs + (s.queueMs ?? 0);
}

export function progressOf(run: Run): Progress {
  const scored = run.plan.filter((p) => !p.warmup);
  const done = scored.filter(isFinished).length;
  const current = run.plan.find((p) => p.stats?.status === 'running') ?? null;
  const walls = scored.map(wallMs).filter((v): v is number => v !== null);
  // Each search also pays polling and metrics overhead; ~2s is typical.
  const avgWallMs = walls.length ? walls.reduce((a, b) => a + b, 0) / walls.length + 2000 : null;
  const remaining = scored.length - done;
  return { done, total: scored.length, current, avgWallMs, etaMs: avgWallMs !== null ? avgWallMs * remaining : null };
}

/** A stored run marked running but not executing in this tab was cut off (tab closed or reloaded). */
export function effectiveStatus(run: { id: string; status: Run['status'] }, activeId: string | undefined): Run['status'] {
  return run.status === 'running' && run.id !== activeId ? 'interrupted' : run.status;
}
