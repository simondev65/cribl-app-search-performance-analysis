import type { FieldMap, LogicalField } from './types';

export interface LogicalFieldDef {
  key: LogicalField;
  label: string;
  hint: string;
  /** Candidate names in priority order (PAN v1 datatype names first, then common variants) */
  candidates: string[];
}

export const LOGICAL_FIELDS: LogicalFieldDef[] = [
  {
    key: 'src',
    label: 'Source IP',
    hint: 'Used by top talkers, field filter and distinct peers',
    candidates: ['source_ip', 'src_ip', 'src', 'sourceIp', 'source.ip', 'src_addr', 'client_ip'],
  },
  {
    key: 'dst',
    label: 'Destination IP',
    hint: 'Used by field filter and distinct peers',
    candidates: ['destination_ip', 'dest_ip', 'dst_ip', 'dst', 'dest', 'destinationIp', 'destination.ip', 'dst_addr'],
  },
  {
    key: 'dport',
    label: 'Destination port',
    hint: 'Used by field filter and rule hit count',
    candidates: ['destination_port', 'dest_port', 'dst_port', 'dport', 'destinationPort', 'destination.port'],
  },
  {
    key: 'action',
    label: 'Action',
    hint: 'allow / deny / drop — used by timelines and top applications',
    candidates: ['action', 'event.action', 'act', 'disposition'],
  },
  {
    key: 'app',
    label: 'Application',
    hint: 'Used by top applications and percentiles',
    candidates: ['application', 'app', 'appName', 'network.application'],
  },
  {
    key: 'bytes',
    label: 'Bytes',
    hint: 'Total session bytes — cast to a number before summing',
    candidates: ['bytes', 'bytes_total', 'total_bytes', 'network.bytes', 'bytes_in_out'],
  },
  {
    key: 'rule',
    label: 'Rule name',
    hint: 'Used by rule hit count',
    candidates: ['rule_name', 'rule', 'ruleName', 'rule.name', 'policy'],
  },
];

export const PAN_V1_DEFAULTS: FieldMap = {
  src: 'source_ip',
  dst: 'destination_ip',
  dport: 'destination_port',
  action: 'action',
  app: 'application',
  bytes: 'bytes',
  rule: 'rule_name',
};

/** Flattens nested objects into dotted keys so `source.ip` style fields are found. */
export function flattenKeys(event: Record<string, unknown>, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(event)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.push(key);
    if (v && typeof v === 'object' && !Array.isArray(v) && prefix.split('.').length < 3) {
      flattenKeys(v as Record<string, unknown>, key, out);
    }
  }
  return out;
}

export interface DetectResult {
  map: FieldMap;
  /** Logical fields that could not be found in the sample */
  missing: LogicalField[];
  available: string[];
}

/** Picks the first candidate present in the sample (case-insensitive), falling back to PAN v1 names. */
export function detectFieldMap(sample: Record<string, unknown> | null): DetectResult {
  const available = sample ? flattenKeys(sample).filter((k) => !k.startsWith('__')) : [];
  const lower = new Map(available.map((k) => [k.toLowerCase(), k]));
  const map = { ...PAN_V1_DEFAULTS };
  const missing: LogicalField[] = [];
  for (const def of LOGICAL_FIELDS) {
    const hit = def.candidates.map((c) => lower.get(c.toLowerCase())).find(Boolean);
    if (hit) map[def.key] = hit;
    else if (sample) missing.push(def.key);
  }
  return { map, missing, available: available.sort((a, b) => a.localeCompare(b)) };
}

/** Reads a field by name, trying the literal key first and then a dotted path into nested objects. */
export function readField(sample: Record<string, unknown> | null, path: string): unknown {
  if (!sample || !path) return undefined;
  if (path in sample) return sample[path];
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), sample);
}

/** Pulls a value that works as a needle (prefers the mapped source IP). */
export function pickNeedle(sample: Record<string, unknown> | null, map: FieldMap): string {
  for (const key of [map.src, map.dst]) {
    const v = readField(sample, key);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}
