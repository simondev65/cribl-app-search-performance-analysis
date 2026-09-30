import type { DatasetInfo } from './types';

const PAN_PATTERN = /(^|[^a-z])(pan|palo|paloalto|pan_traffic|firewall|fw)([^a-z]|$)/i;

/** Normalises a raw /search/datasets item into what the picker needs. */
export function toDatasetInfo(raw: Record<string, unknown>): DatasetInfo {
  const id = String(raw.id ?? '');
  const description = String(raw.description ?? '');
  const searchVersion = String(raw.searchVersion ?? '');
  let format = String(raw.lakeStorageFormat ?? raw.format ?? '');
  if (!format && Array.isArray(raw.paths)) {
    for (const p of raw.paths as Array<{ filters?: Array<{ dataPathFormat?: string }> }>) {
      const f = p.filters?.find((x) => x.dataPathFormat)?.dataPathFormat;
      if (f) {
        format = f;
        break;
      }
    }
  }
  const breakers = Array.isArray(raw.breakerRulesets) ? (raw.breakerRulesets as string[]).join(' ') : '';
  const datatypes = Array.isArray(raw.datatypes) ? (raw.datatypes as string[]).join(' ') : '';
  return {
    id,
    type: String(raw.type ?? ''),
    provider: String(raw.provider ?? ''),
    description,
    searchVersion,
    format,
    looksLikePan: PAN_PATTERN.test(id) || /palo alto/i.test(`${description} ${breakers} ${datatypes}`),
  };
}

/** Datasets that cannot hold PAN traffic and would only clutter the picker. */
const HIDDEN_TYPES = new Set(['cribl_meta']);

export function sortDatasets(items: DatasetInfo[]): DatasetInfo[] {
  return items
    .filter((d) => d.id && !HIDDEN_TYPES.has(d.type))
    .sort((a, b) => Number(b.looksLikePan) - Number(a.looksLikePan) || a.id.localeCompare(b.id));
}

const TYPE_LABELS: Record<string, string> = {
  cribl_lake: 'Cribl Lake',
  cribl_search: 'Lakehouse',
  s3: 'Amazon S3',
  azure_blob: 'Azure Blob',
  gcs: 'Google Cloud Storage',
  cribl_edge: 'Cribl Edge',
  cribl_leader: 'Cribl Leader',
  api_http: 'HTTP API',
  clickhouse: 'ClickHouse',
  snowflake: 'Snowflake',
  amazon_security_lake: 'Amazon Security Lake',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

/** Short human label such as "v2 · Parquet". */
export function layoutLabel(d: Pick<DatasetInfo, 'searchVersion' | 'format'>): string {
  const parts: string[] = [];
  if (d.searchVersion) parts.push(d.searchVersion);
  if (d.format) parts.push(d.format === 'ndjson' ? 'NDJSON' : d.format === 'json' ? 'JSON' : d.format.charAt(0).toUpperCase() + d.format.slice(1));
  return parts.join(' ');
}
