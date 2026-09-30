import type { MetricScore, PairResult, PlanItem, Scorecard, SearchStats, Side } from './types';

/** A side must be at least this much faster to win a pair. */
export const TIE_THRESHOLD = 0.1;
export const PARITY_TOLERANCE = 0.01;
export const WEIGHTS = { time: 0.6, cpu: 0.25, bytes: 0.15 } as const;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function geomean(values: number[]): number | null {
  const v = values.filter((x) => x > 0 && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.exp(v.reduce((acc, x) => acc + Math.log(x), 0) / v.length);
}

function medianOf(items: SearchStats[], pick: (s: SearchStats) => number | null): number | null {
  return median(items.map(pick).filter((x): x is number => x !== null && Number.isFinite(x)));
}

/** Collapses repetitions of one (search, range, side) into a single representative stats record. */
export function combineReps(items: SearchStats[]): SearchStats | null {
  if (items.length === 0) return null;
  const ok = items.filter((s) => s.status === 'completed');
  if (ok.length === 0) return items[items.length - 1];
  const base = ok[ok.length - 1];
  return {
    ...base,
    execMs: medianOf(ok, (s) => s.execMs),
    queueMs: medianOf(ok, (s) => s.queueMs),
    ttfbMs: medianOf(ok, (s) => s.ttfbMs),
    launchMs: medianOf(ok, (s) => s.launchMs),
    bytesScanned: medianOf(ok, (s) => s.bytesScanned),
    eventsScanned: medianOf(ok, (s) => s.eventsScanned),
    bytesSkipped: medianOf(ok, (s) => s.bytesSkipped),
    eventsSkipped: medianOf(ok, (s) => s.eventsSkipped),
    objectsSearched: medianOf(ok, (s) => s.objectsSearched),
    results: medianOf(ok, (s) => s.results),
    cpuSeconds: medianOf(ok, (s) => s.cpuSeconds),
    executors: medianOf(ok, (s) => s.executors),
  };
}

const isDone = (s: SearchStats | null): s is SearchStats => !!s && s.status === 'completed' && s.execMs !== null;

export function buildPairs(plan: PlanItem[], searchOrder: string[], rangeOrder: string[]): PairResult[] {
  const pairs: PairResult[] = [];
  for (const searchId of searchOrder) {
    for (const rangeId of rangeOrder) {
      const cell = plan.filter((p) => !p.warmup && p.searchId === searchId && p.rangeId === rangeId && p.stats);
      if (cell.length === 0) continue;
      const pick = (side: Side) =>
        combineReps(cell.filter((p) => p.side === side && p.stats!.status !== 'pending').map((p) => p.stats!));
      const a = pick('A');
      const b = pick('B');
      let ratio: number | null = null;
      let winner: PairResult['winner'] = null;
      if (isDone(a) && isDone(b)) {
        ratio = Math.max(a.execMs!, 1) / Math.max(b.execMs!, 1);
        winner = ratio >= 1 + TIE_THRESHOLD ? 'B' : ratio <= 1 / (1 + TIE_THRESHOLD) ? 'A' : 'tie';
      } else if (isDone(a) && b && b.status !== 'running') {
        winner = 'A';
      } else if (isDone(b) && a && a.status !== 'running') {
        winner = 'B';
      }
      const parityWarning =
        isDone(a) && isDone(b) && a.results !== null && b.results !== null
          ? Math.abs(a.results - b.results) / Math.max(a.results, b.results, 1) > PARITY_TOLERANCE
          : false;
      pairs.push({ searchId, rangeId, a, b, ratio, winner, parityWarning });
    }
  }
  return pairs;
}

/** Mean of best/own × 100 across pairs where both sides have the metric. */
function metricScore(pairs: PairResult[], pick: (s: SearchStats) => number | null): MetricScore {
  const sa: number[] = [];
  const sb: number[] = [];
  for (const p of pairs) {
    if (!isDone(p.a) || !isDone(p.b)) continue;
    const va = pick(p.a);
    const vb = pick(p.b);
    if (va === null || vb === null) continue;
    const best = Math.min(va, vb);
    if (best <= 0 && Math.max(va, vb) <= 0) {
      sa.push(100);
      sb.push(100);
      continue;
    }
    // Guard against zero (e.g. bytes fully skipped) by flooring at a tiny epsilon.
    const eps = Math.max(Math.max(va, vb) * 1e-3, 1e-9);
    sa.push((100 * Math.max(best, eps)) / Math.max(va, eps));
    sb.push((100 * Math.max(best, eps)) / Math.max(vb, eps));
  }
  const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  return { A: avg(sa), B: avg(sb) };
}

function composite(scores: { time: MetricScore; cpu: MetricScore; bytes: MetricScore }, side: Side): number | null {
  let sum = 0;
  let weight = 0;
  for (const key of ['time', 'cpu', 'bytes'] as const) {
    const v = scores[key][side];
    if (v === null) continue;
    sum += v * WEIGHTS[key];
    weight += WEIGHTS[key];
  }
  return weight > 0 ? sum / weight : null;
}

export function computeScorecard(plan: PlanItem[], searchOrder: string[], rangeOrder: string[]): Scorecard {
  const pairs = buildPairs(plan, searchOrder, rangeOrder);
  const comparable = pairs.filter((p) => p.ratio !== null);

  const wins = { A: 0, B: 0, tie: 0 };
  for (const p of pairs) if (p.winner) wins[p.winner] += 1;

  const scored = plan.filter((p) => !p.warmup && p.stats);
  const failed = (side: Side) =>
    scored.filter((p) => p.side === side && ['failed', 'timeout', 'canceled'].includes(p.stats!.status)).length;

  // Only pairs that finished on both sides, so the totals compare like with like
  // (a half-finished pair mid-run would otherwise inflate one side).
  const total = (side: Side) => {
    const acc = { execMs: 0, queueMs: 0, bytesScanned: 0, cpuSeconds: 0 };
    for (const p of comparable) {
      const s = side === 'A' ? p.a : p.b;
      if (!isDone(s)) continue;
      acc.execMs += s.execMs ?? 0;
      acc.queueMs += s.queueMs ?? 0;
      acc.bytesScanned += s.bytesScanned ?? 0;
      acc.cpuSeconds += s.cpuSeconds ?? 0;
    }
    return acc;
  };

  const base = {
    time: metricScore(pairs, (s) => s.execMs),
    cpu: metricScore(pairs, (s) => s.cpuSeconds),
    bytes: metricScore(pairs, (s) => s.bytesScanned),
  };

  const group = (key: 'rangeId' | 'searchId', order: string[]) => {
    const out: Record<string, number | null> = {};
    for (const id of order) out[id] = geomean(comparable.filter((p) => p[key] === id).map((p) => p.ratio!));
    return out;
  };

  return {
    pairs,
    speedup: geomean(comparable.map((p) => p.ratio!)),
    wins,
    failures: { A: failed('A'), B: failed('B') },
    totals: { A: total('A'), B: total('B') },
    scores: { ...base, composite: { A: composite(base, 'A'), B: composite(base, 'B') } },
    byRange: group('rangeId', rangeOrder),
    bySearch: group('searchId', searchOrder),
    parityWarnings: pairs.filter((p) => p.parityWarning).length,
    comparablePairs: comparable.length,
  };
}

/** Plain-language headline for a speed-up ratio (execA / execB). */
export function verdict(speedup: number | null, labelA: string, labelB: string): { side: Side | 'tie' | null; text: string } {
  if (speedup === null) return { side: null, text: 'Not enough completed searches to compare yet' };
  if (speedup >= 1 + TIE_THRESHOLD) return { side: 'B', text: `${labelB} is ${speedup.toFixed(1)}× faster` };
  if (speedup <= 1 / (1 + TIE_THRESHOLD)) return { side: 'A', text: `${labelA} is ${(1 / speedup).toFixed(1)}× faster` };
  return { side: 'tie', text: 'Both datasets perform about the same' };
}
