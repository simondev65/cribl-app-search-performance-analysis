import { kvDelete, kvGet, kvSet } from './kvstore';
import { computeScorecard } from '../lib/scoring';
import { layoutLabel } from '../lib/datasets';
import type { FieldMap, Run, RunConfig, RunSummary } from '../lib/types';

const INDEX_KEY = 'runs/index';
const runKey = (id: string) => `runs/data/${id}`;
const fieldMapKey = (datasetId: string) => `fieldmaps/${datasetId}`;
const LAST_SETUP_KEY = 'settings/last-setup';

export function datasetLabel(id: string, info?: { searchVersion: string; format: string }): string {
  const layout = info ? layoutLabel(info) : '';
  return layout ? `${id} (${layout})` : id;
}

export function summarize(run: Run): RunSummary {
  const { config } = run;
  const scored = run.plan.filter((p) => !p.warmup);
  const done = scored.filter((p) => p.stats && !['pending', 'running'].includes(p.stats.status)).length;
  const card = computeScorecard(run.plan, config.searchIds, config.rangeIds);
  return {
    id: run.id,
    name: config.name,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    createdBy: run.createdBy,
    status: run.status,
    datasetA: config.datasetA.id,
    datasetB: config.datasetB.id,
    labelA: layoutLabel(config.datasetA),
    labelB: layoutLabel(config.datasetB),
    done,
    total: scored.length,
    speedup: card.speedup,
    compositeA: card.scores.composite.A,
    compositeB: card.scores.composite.B,
  };
}

export async function listRuns(): Promise<RunSummary[]> {
  const index = (await kvGet<RunSummary[]>(INDEX_KEY)) ?? [];
  return Array.isArray(index) ? index.sort((a, b) => b.createdAt - a.createdAt) : [];
}

export async function loadRun(id: string): Promise<Run | null> {
  return kvGet<Run>(runKey(id));
}

/** Saves the run and upserts its summary in the index. */
export async function saveRun(run: Run): Promise<void> {
  await kvSet(runKey(run.id), run);
  const index = await listRuns().catch(() => [] as RunSummary[]);
  const summary = summarize(run);
  const next = [summary, ...index.filter((r) => r.id !== run.id)];
  await kvSet(INDEX_KEY, next);
}

/** Saves only the run body; used for frequent checkpoints between index updates. */
export async function saveRunBody(run: Run): Promise<void> {
  await kvSet(runKey(run.id), run);
}

export async function renameRun(id: string, name: string): Promise<void> {
  const run = await loadRun(id);
  if (!run) throw new Error(`Run ${id} no longer exists`);
  run.config.name = name;
  run.updatedAt = Date.now();
  await saveRun(run);
}

export async function deleteRun(id: string): Promise<void> {
  await kvDelete(runKey(id));
  const index = await listRuns();
  await kvSet(
    INDEX_KEY,
    index.filter((r) => r.id !== id),
  );
}

export async function loadFieldMap(datasetId: string): Promise<FieldMap | null> {
  return kvGet<FieldMap>(fieldMapKey(datasetId)).catch(() => null);
}

export async function saveFieldMap(datasetId: string, map: FieldMap): Promise<void> {
  await kvSet(fieldMapKey(datasetId), map);
}

export type LastSetup = Pick<
  RunConfig,
  'searchIds' | 'rangeIds' | 'order' | 'repetitions' | 'warmup' | 'settleLagMinutes' | 'timeoutMinutes'
> & { datasetA?: string; datasetB?: string };

export async function loadLastSetup(): Promise<LastSetup | null> {
  return kvGet<LastSetup>(LAST_SETUP_KEY).catch(() => null);
}

export async function saveLastSetup(setup: LastSetup): Promise<void> {
  await kvSet(LAST_SETUP_KEY, setup);
}
