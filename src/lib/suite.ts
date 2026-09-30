import type { FieldMap, SearchTemplate, TimeRange } from './types';

/**
 * Built-in Palo Alto traffic suite. Every query shape was checked against a live
 * Cribl Search org. Placeholders are filled per dataset by renderQuery().
 */
export const PAN_SUITE: SearchTemplate[] = [
  {
    id: 'count',
    name: 'Count all events',
    category: 'Aggregation',
    description: 'Full scan with the cheapest aggregation. Baseline for raw read speed.',
    template: 'dataset="{{ds}}" | summarize events=count()',
  },
  {
    id: 'raw',
    name: 'Fetch raw events',
    category: 'Retrieval',
    description: 'Returns the first 1,000 events untouched, like opening the data in Search.',
    template: 'dataset="{{ds}}" | limit 1000',
  },
  {
    id: 'keyword',
    name: 'Keyword search',
    category: 'Filter',
    description: 'Free-text search for one value across all fields (needle in a haystack).',
    template: 'dataset="{{ds}}" "{{needle}}" | limit 1000',
  },
  {
    id: 'field-filter',
    name: 'Field filter',
    category: 'Filter',
    description: 'Exact match on the source IP, then groups by destination and port.',
    template:
      'dataset="{{ds}}" | where {{src}} == "{{needle}}" | summarize sessions=count() by {{dst}}, {{dport}} | sort by sessions desc | limit 50',
  },
  {
    id: 'project',
    name: 'Column projection',
    category: 'Retrieval',
    description: 'Reads 7 columns for 10,000 events. Columnar formats should shine here.',
    template:
      'dataset="{{ds}}" | project _time, {{src}}, {{dst}}, {{dport}}, {{action}}, {{app}}, {{bytes}} | limit 10000',
  },
  {
    id: 'timestats-action',
    name: 'Timeline by action',
    category: 'Time series',
    description: 'Event count over time split by firewall action (allow, deny, drop …).',
    template: 'dataset="{{ds}}" | timestats span={{span}} count() by {{action}}',
  },
  {
    id: 'timestats-bytes',
    name: 'Bytes over time',
    category: 'Time series',
    description: 'Casts bytes to a number and sums it per time bucket.',
    template: 'dataset="{{ds}}" | extend b=tolong({{bytes}}) | timestats span={{span}} total_bytes=sum(b)',
  },
  {
    id: 'top-talkers',
    name: 'Top talkers',
    category: 'Aggregation',
    description: 'Sessions and total bytes per source IP, top 20 by bytes.',
    template:
      'dataset="{{ds}}" | extend b=tolong({{bytes}}) | summarize sessions=count(), total_bytes=sum(b) by {{src}} | sort by total_bytes desc | limit 20',
  },
  {
    id: 'top-apps',
    name: 'Top applications',
    category: 'Aggregation',
    description: 'Sessions per application and action, top 20.',
    template:
      'dataset="{{ds}}" | summarize sessions=count() by {{app}}, {{action}} | sort by sessions desc | limit 20',
  },
  {
    id: 'dcount',
    name: 'Distinct peers',
    category: 'Cardinality',
    description: 'Distinct destination IPs per source IP and action. High-cardinality grouping.',
    template:
      'dataset="{{ds}}" | summarize peers=dcount({{dst}}) by {{src}}, {{action}} | sort by peers desc | limit 20',
  },
  {
    id: 'percentiles',
    name: 'Bytes percentiles',
    category: 'Aggregation',
    description: 'p50, p95 and average bytes per application.',
    template:
      'dataset="{{ds}}" | extend b=tolong({{bytes}}) | summarize p50=percentile(b, 50), p95=percentile(b, 95), avg_b=avg(b) by {{app}} | sort by avg_b desc | limit 20',
  },
  {
    id: 'rules',
    name: 'Rule hit count',
    category: 'Cardinality',
    description: 'Sessions per firewall rule and destination port.',
    template:
      'dataset="{{ds}}" | summarize sessions=count() by {{rule}}, {{dport}} | sort by sessions desc | limit 50',
  },
];

export const TIME_RANGES: TimeRange[] = [
  { id: '15m', label: '15 min', seconds: 15 * 60, span: '1m' },
  { id: '1h', label: '1 hour', seconds: 3600, span: '1m' },
  { id: '4h', label: '4 hours', seconds: 4 * 3600, span: '5m' },
  { id: '12h', label: '12 hours', seconds: 12 * 3600, span: '10m' },
  { id: '1d', label: '1 day', seconds: 24 * 3600, span: '15m' },
  { id: '2d', label: '2 days', seconds: 48 * 3600, span: '30m' },
  { id: '7d', label: '7 days', seconds: 7 * 24 * 3600, span: '2h' },
];

export const DEFAULT_RANGE_IDS = ['1h', '4h', '1d', '2d'];

export function findSearch(id: string): SearchTemplate | undefined {
  return PAN_SUITE.find((s) => s.id === id);
}

export function findRange(id: string): TimeRange | undefined {
  return TIME_RANGES.find((r) => r.id === id);
}

/** Escapes a value for use inside a double-quoted KQL string literal. */
export function kqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Field names that are not plain identifiers must be bracket-quoted in KQL. */
export function kqlField(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `['${name.replace(/'/g, "\\'")}']`;
}

export function renderQuery(
  template: string,
  opts: { dataset: string; fields: FieldMap; span: string; needle: string },
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key === 'ds') return kqlString(opts.dataset);
    if (key === 'span') return opts.span;
    if (key === 'needle') return kqlString(opts.needle);
    if (key in opts.fields) return kqlField(opts.fields[key as keyof FieldMap]);
    return match;
  });
}

/** Placeholders a template uses, so the UI can warn when a mapped field is missing. */
export function templateFields(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!['ds', 'span', 'needle'].includes(m[1])) out.add(m[1]);
  }
  return [...out];
}
