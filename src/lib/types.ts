/** Shared types. Kept free of runtime code so pure modules can import them with `import type`. */

export type Side = 'A' | 'B';

export type LogicalField = 'src' | 'dst' | 'dport' | 'action' | 'app' | 'bytes' | 'rule';

/** Maps logical Palo Alto fields to the real field names of one dataset. */
export type FieldMap = Record<LogicalField, string>;

export interface DatasetInfo {
  id: string;
  type: string;
  provider: string;
  description: string;
  /** 'v1' | 'v2' | '' when unknown */
  searchVersion: string;
  /** 'json' | 'parquet' | 'ndjson' | … or '' when unknown */
  format: string;
  /** Heuristic: looks like Palo Alto / firewall traffic */
  looksLikePan: boolean;
}

export type SearchCategory = 'Retrieval' | 'Filter' | 'Aggregation' | 'Time series' | 'Cardinality';

export interface SearchTemplate {
  id: string;
  name: string;
  category: SearchCategory;
  /** What the search stresses, in plain words */
  description: string;
  /** KQL with {{ds}}, {{span}}, {{needle}} and field placeholders ({{src}}, {{bytes}}, …) */
  template: string;
}

export interface TimeRange {
  id: string;
  label: string;
  seconds: number;
  /** timestats span used for this range */
  span: string;
}

export type RunOrder = 'pairwise' | 'dataset';

export interface RunConfig {
  name: string;
  datasetA: DatasetInfo;
  datasetB: DatasetInfo;
  fieldMapA: FieldMap;
  fieldMapB: FieldMap;
  searchIds: string[];
  rangeIds: string[];
  order: RunOrder;
  repetitions: number;
  warmup: boolean;
  settleLagMinutes: number;
  timeoutMinutes: number;
  /** Value used by the keyword / field-filter searches (usually a source IP) */
  needle: string;
}

export type JobState = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'timeout' | 'skipped';

export interface SearchStats {
  jobId: string;
  status: JobState;
  error?: string;
  /** Scored: timeCompleted − timeStarted */
  execMs: number | null;
  /** Shown but never scored: timeStarted − timeCreated */
  queueMs: number | null;
  ttfbMs: number | null;
  launchMs: number | null;
  bytesScanned: number | null;
  eventsScanned: number | null;
  bytesSkipped: number | null;
  eventsSkipped: number | null;
  objectsSearched: number | null;
  results: number | null;
  cpuSeconds: number | null;
  executors: number | null;
  computeType: string;
  cacheStatus: string;
  startedAt: number | null;
}

/** One search execution in the plan. */
export interface PlanItem {
  key: string;
  searchId: string;
  rangeId: string;
  side: Side;
  rep: number;
  warmup: boolean;
  query: string;
  earliest: number;
  latest: number;
  stats?: SearchStats;
}

export type RunStatus = 'running' | 'completed' | 'stopped' | 'interrupted';

export interface Run {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  status: RunStatus;
  config: RunConfig;
  /** Anchor for all time windows (epoch seconds) */
  anchorLatest: number;
  plan: PlanItem[];
}

export interface PairResult {
  searchId: string;
  rangeId: string;
  a: SearchStats | null;
  b: SearchStats | null;
  /** execA / execB; > 1 means B is faster */
  ratio: number | null;
  winner: Side | 'tie' | null;
  parityWarning: boolean;
}

export interface MetricScore {
  A: number | null;
  B: number | null;
}

export interface Scorecard {
  pairs: PairResult[];
  /** Geometric mean of execA / execB over comparable pairs */
  speedup: number | null;
  wins: { A: number; B: number; tie: number };
  failures: { A: number; B: number };
  totals: {
    A: { execMs: number; queueMs: number; bytesScanned: number; cpuSeconds: number };
    B: { execMs: number; queueMs: number; bytesScanned: number; cpuSeconds: number };
  };
  scores: { time: MetricScore; cpu: MetricScore; bytes: MetricScore; composite: MetricScore };
  byRange: Record<string, number | null>;
  bySearch: Record<string, number | null>;
  parityWarnings: number;
  comparablePairs: number;
}

export interface RunSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  status: RunStatus;
  datasetA: string;
  datasetB: string;
  labelA: string;
  labelB: string;
  done: number;
  total: number;
  speedup: number | null;
  compositeA: number | null;
  compositeB: number | null;
}
