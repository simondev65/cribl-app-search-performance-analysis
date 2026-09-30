import { describe, expect, it } from 'vitest';
import { computeScorecard, geomean, median, verdict } from '../src/lib/scoring';
import { kqlField, renderQuery, templateFields, PAN_SUITE } from '../src/lib/suite';
import { detectFieldMap, PAN_V1_DEFAULTS, pickNeedle } from '../src/lib/fields';
import { toDatasetInfo, layoutLabel, sortDatasets } from '../src/lib/datasets';
import { formatBytes, formatDuration, formatRatio } from '../src/lib/format';
import { anchorFor, buildPlan } from '../src/engine/plan';
import { toStats } from '../src/engine/runner';
import type { PlanItem, RunConfig, SearchStats, Side } from '../src/lib/types';

const stats = (execMs: number | null, extra: Partial<SearchStats> = {}): SearchStats => ({
  jobId: 'j',
  status: 'completed',
  execMs,
  queueMs: 5000,
  ttfbMs: null,
  launchMs: null,
  bytesScanned: 1000,
  eventsScanned: 10,
  bytesSkipped: null,
  eventsSkipped: null,
  objectsSearched: 1,
  results: 10,
  cpuSeconds: 1,
  executors: 1,
  computeType: 'v1',
  cacheStatus: 'miss',
  startedAt: 0,
  ...extra,
});

const item = (searchId: string, rangeId: string, side: Side, s: SearchStats | undefined, rep = 1): PlanItem => ({
  key: `${searchId}:${rangeId}:${side}:${rep}`,
  searchId,
  rangeId,
  side,
  rep,
  warmup: false,
  query: '',
  earliest: 0,
  latest: 0,
  stats: s,
});

describe('math helpers', () => {
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('geomean ignores non-positive values', () => {
    expect(geomean([2, 8])).toBeCloseTo(4);
    expect(geomean([0, -1])).toBeNull();
  });
});

describe('scoring', () => {
  it('declares B the winner when it is faster and ignores queue time', () => {
    const plan = [
      item('count', '1h', 'A', stats(4000, { queueMs: 0 })),
      item('count', '1h', 'B', stats(1000, { queueMs: 60_000 })),
      item('raw', '1h', 'A', stats(2000)),
      item('raw', '1h', 'B', stats(2000)),
    ];
    const card = computeScorecard(plan, ['count', 'raw'], ['1h']);
    expect(card.pairs[0].winner).toBe('B');
    expect(card.pairs[1].winner).toBe('tie');
    expect(card.speedup).toBeCloseTo(2);
    expect(card.wins).toEqual({ A: 0, B: 1, tie: 1 });
    expect(card.scores.time.B).toBe(100);
    expect(card.scores.time.A).toBeCloseTo((25 + 100) / 2);
    expect(card.totals.B.queueMs).toBe(65_000);
  });

  it('uses the median of repetitions', () => {
    const plan = [
      item('count', '1h', 'A', stats(1000), 1),
      item('count', '1h', 'A', stats(9000), 2),
      item('count', '1h', 'A', stats(2000), 3),
      item('count', '1h', 'B', stats(2000), 1),
    ];
    const card = computeScorecard(plan, ['count'], ['1h']);
    expect(card.pairs[0].a?.execMs).toBe(2000);
    expect(card.pairs[0].winner).toBe('tie');
  });

  it('counts failures and excludes them from ratios', () => {
    const plan = [item('count', '1h', 'A', stats(null, { status: 'failed' })), item('count', '1h', 'B', stats(1000))];
    const card = computeScorecard(plan, ['count'], ['1h']);
    expect(card.failures.A).toBe(1);
    expect(card.speedup).toBeNull();
    expect(card.pairs[0].winner).toBe('B');
  });

  it('flags result parity mismatches', () => {
    const plan = [item('count', '1h', 'A', stats(1000, { results: 100 })), item('count', '1h', 'B', stats(1000, { results: 50 }))];
    expect(computeScorecard(plan, ['count'], ['1h']).parityWarnings).toBe(1);
  });

  it('skips warm-up searches and pending items', () => {
    const warm = { ...item('warmup', '15m', 'A', stats(99_000)), warmup: true };
    const card = computeScorecard([warm, item('count', '1h', 'A', undefined)], ['count'], ['1h']);
    expect(card.pairs).toHaveLength(0);
  });

  it('totals only pairs finished on both sides, so a run in progress stays consistent', () => {
    const plan = [
      item('count', '1h', 'A', stats(846)),
      item('count', '1h', 'B', stats(540)),
      // B finished the 4h window; A is still running it.
      item('count', '4h', 'B', stats(729)),
      item('count', '4h', 'A', stats(null, { status: 'running' })),
    ];
    const card = computeScorecard(plan, ['count'], ['1h', '4h']);
    expect(card.totals.A.execMs).toBe(846);
    expect(card.totals.B.execMs).toBe(540);
    expect(card.comparablePairs).toBe(1);
  });

  it('writes a plain-language verdict', () => {
    expect(verdict(3.2, 'raw', 'parquet').text).toBe('parquet is 3.2× faster');
    expect(verdict(0.5, 'raw', 'parquet')).toEqual({ side: 'A', text: 'raw is 2.0× faster' });
    expect(verdict(1.05, 'a', 'b').side).toBe('tie');
    expect(verdict(null, 'a', 'b').side).toBeNull();
  });
});

describe('query rendering', () => {
  it('fills dataset, fields, span and needle', () => {
    const q = renderQuery('dataset="{{ds}}" | where {{src}} == "{{needle}}" | timestats span={{span}} count()', {
      dataset: 'PAN_traffic',
      fields: { ...PAN_V1_DEFAULTS, src: 'source.ip' },
      span: '5m',
      needle: '10.0.0.1',
    });
    expect(q).toBe(`dataset="PAN_traffic" | where ['source.ip'] == "10.0.0.1" | timestats span=5m count()`);
  });
  it('escapes quotes in values', () => {
    expect(renderQuery('"{{needle}}"', { dataset: 'x', fields: PAN_V1_DEFAULTS, span: '1m', needle: 'a"b' })).toBe('"a\\"b"');
  });
  it('quotes non-identifier fields only', () => {
    expect(kqlField('source_ip')).toBe('source_ip');
    expect(kqlField('source.ip')).toBe("['source.ip']");
  });
  it('every built-in search only uses known placeholders', () => {
    const known = Object.keys(PAN_V1_DEFAULTS);
    for (const s of PAN_SUITE) for (const f of templateFields(s.template)) expect(known).toContain(f);
  });
});

describe('field detection', () => {
  it('detects PAN v1 names from a sample event', () => {
    const r = detectFieldMap({ source_ip: '1.1.1.1', destination_ip: '2.2.2.2', destination_port: '443', action: 'allow', application: 'ssl', bytes: '10', rule_name: 'r' });
    expect(r.map).toEqual(PAN_V1_DEFAULTS);
    expect(r.missing).toEqual([]);
  });
  it('detects alternative and nested names', () => {
    const r = detectFieldMap({ src_ip: '1.1.1.1', destination: { ip: '2.2.2.2' }, dport: 80, act: 'deny' });
    expect(r.map.src).toBe('src_ip');
    expect(r.map.dst).toBe('destination.ip');
    expect(r.map.dport).toBe('dport');
    expect(r.map.action).toBe('act');
    expect(r.missing).toContain('app');
  });
  it('falls back to defaults when there is no sample', () => {
    const r = detectFieldMap(null);
    expect(r.map).toEqual(PAN_V1_DEFAULTS);
    expect(r.missing).toEqual([]);
  });
  it('picks the source IP as needle', () => {
    expect(pickNeedle({ source_ip: '9.9.9.9' }, PAN_V1_DEFAULTS)).toBe('9.9.9.9');
    expect(pickNeedle(null, PAN_V1_DEFAULTS)).toBe('');
  });
});

describe('datasets', () => {
  it('reads version and format from lake and s3 descriptors', () => {
    const lake = toDatasetInfo({ id: 'PAN_traffic', type: 'cribl_lake', provider: 'cribl_lake', lakeStorageFormat: 'json', searchVersion: 'v1' });
    expect(lake.looksLikePan).toBe(true);
    expect(layoutLabel(lake)).toBe('v1 JSON');
    const s3 = toDatasetInfo({ id: 'fw_v2', type: 's3', searchVersion: 'v2', paths: [{ filters: [{ dataPathFormat: 'parquet' }] }] });
    expect(s3.format).toBe('parquet');
    expect(layoutLabel(s3)).toBe('v2 Parquet');
  });
  it('sorts PAN-looking datasets first and hides meta datasets', () => {
    const list = sortDatasets([
      toDatasetInfo({ id: 'apache', type: 's3' }),
      toDatasetInfo({ id: 'default', type: 'cribl_meta' }),
      toDatasetInfo({ id: 'pan_v2', type: 's3' }),
    ]);
    expect(list.map((d) => d.id)).toEqual(['pan_v2', 'apache']);
  });
});

describe('plan', () => {
  const config: RunConfig = {
    name: 't',
    datasetA: toDatasetInfo({ id: 'A_ds' }),
    datasetB: toDatasetInfo({ id: 'B_ds' }),
    fieldMapA: PAN_V1_DEFAULTS,
    fieldMapB: PAN_V1_DEFAULTS,
    searchIds: ['count', 'timestats-action'],
    rangeIds: ['1h', '1d'],
    order: 'pairwise',
    repetitions: 1,
    warmup: true,
    settleLagMinutes: 5,
    timeoutMinutes: 10,
    needle: '1.2.3.4',
  };

  it('anchors to the minute minus the settle lag', () => {
    expect(anchorFor(Date.UTC(2026, 0, 1, 12, 0, 42), 5)).toBe(Date.UTC(2026, 0, 1, 11, 55, 0) / 1000);
  });

  it('gives both datasets identical windows and alternates who goes first', () => {
    const plan = buildPlan(config, 1_000_000);
    expect(plan.filter((p) => p.warmup)).toHaveLength(2);
    const scored = plan.filter((p) => !p.warmup);
    expect(scored).toHaveLength(8);
    expect(scored.slice(0, 4).map((p) => p.side)).toEqual(['A', 'B', 'B', 'A']);
    const [a, b] = scored;
    expect([a.earliest, a.latest]).toEqual([b.earliest, b.latest]);
    expect(a.query).toContain('dataset="A_ds"');
    expect(b.query).toContain('dataset="B_ds"');
    expect(scored.find((p) => p.rangeId === '1d')!.earliest).toBe(1_000_000 - 86_400);
    expect(scored.find((p) => p.searchId === 'timestats-action' && p.rangeId === '1d')!.query).toContain('span=15m');
  });

  it('runs dataset by dataset when asked', () => {
    const scored = buildPlan({ ...config, order: 'dataset', warmup: false }, 1_000_000);
    expect(scored.map((p) => p.side)).toEqual(['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']);
  });
});

describe('stats extraction', () => {
  it('computes execution time without queue time and reads metrics', () => {
    const s = toStats(
      'job1',
      {
        status: 'completed',
        timeCreated: 1000,
        timeStarted: 31_000,
        timeCompleted: 34_500,
        bytesIn: 5,
        cacheStatusesByStageId: { root: { PAN_traffic: { cacheStatus: 'miss', computeType: 'v1' } } },
      },
      {
        timeToFirstByte: 2.1,
        totalMetrics: { bytesIn: 377835584, eventsIn: 383970, objectsSearched: 102 },
        cpuMetrics: { totalCPUSeconds: 69.4 },
        executorCountMetrics: { executorsAllocatedCount: 50 },
        launch: { totalMs: 175 },
      },
      12,
      'PAN_traffic',
    );
    expect(s.execMs).toBe(3500);
    expect(s.queueMs).toBe(30_000);
    expect(s.ttfbMs).toBeCloseTo(2100);
    expect(s.bytesScanned).toBe(377835584);
    expect(s.cpuSeconds).toBe(69.4);
    expect(s.executors).toBe(50);
    expect(s.computeType).toBe('v1');
    expect(s.results).toBe(12);
  });
});

describe('formatting', () => {
  it('formats durations, bytes and ratios', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(3500)).toBe('3.50 s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatBytes(377835584)).toBe('360.3 MB');
    expect(formatRatio(0.25)).toBe('4.00×');
    expect(formatRatio(null)).toBe('—');
  });
});
