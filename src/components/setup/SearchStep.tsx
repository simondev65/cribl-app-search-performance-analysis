import { useState } from 'react';
import { Button, Checkbox, Collapse, NumberField, Radio, RadioGroup, Switch, Text } from '@capra/core';
import { LOGICAL_FIELDS } from '../../lib/fields';
import { PAN_SUITE, TIME_RANGES, renderQuery, templateFields } from '../../lib/suite';
import type { DatasetInfo, FieldMap, LogicalField, RunOrder, SearchCategory, SearchTemplate } from '../../lib/types';

export interface SearchOptions {
  searchIds: string[];
  rangeIds: string[];
  order: RunOrder;
  repetitions: number;
  warmup: boolean;
  settleLagMinutes: number;
  timeoutMinutes: number;
}

interface Props {
  a: DatasetInfo;
  mapA: FieldMap;
  mapB: FieldMap;
  needle: string;
  options: SearchOptions;
  onChange: (next: SearchOptions) => void;
}

const CATEGORY_ORDER: SearchCategory[] = ['Retrieval', 'Filter', 'Aggregation', 'Time series', 'Cardinality'];
const CATEGORY_NOTE: Record<SearchCategory, string> = {
  Retrieval: 'Reading events back: raw rows and selected columns',
  Filter: 'Finding a needle: full-text and field matches',
  Aggregation: 'Scanning everything and grouping it',
  'Time series': 'Bucketing events over time with timestats',
  Cardinality: 'Counting distinct values and wide group-bys',
};

/** Why a search cannot run with the current mapping, or null if it can. */
export function unavailableReason(s: SearchTemplate, mapA: FieldMap, mapB: FieldMap, needle: string): string | null {
  const missing = (templateFields(s.template) as LogicalField[]).filter((f) => !mapA[f] || !mapB[f]);
  if (missing.length) {
    const names = missing.map((f) => LOGICAL_FIELDS.find((d) => d.key === f)?.label ?? f);
    return `Needs a mapping for ${names.join(', ').toLowerCase()}`;
  }
  if (s.template.includes('{{needle}}') && !needle.trim()) return 'Needs a value to look for (previous step)';
  return null;
}

export function SearchStep({ a, mapA, mapB, needle, options, onChange }: Props) {
  const [openQuery, setOpenQuery] = useState<string | null>(null);
  const set = <K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => onChange({ ...options, [key]: value });
  const selected = new Set(options.searchIds);
  const available = PAN_SUITE.filter((s) => !unavailableReason(s, mapA, mapB, needle));

  const toggleSearch = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    // Keep suite order so results always read in the same order.
    set(
      'searchIds',
      PAN_SUITE.map((s) => s.id).filter((x) => next.has(x)),
    );
  };
  const toggleRange = (id: string) => {
    const next = options.rangeIds.includes(id) ? options.rangeIds.filter((r) => r !== id) : [...options.rangeIds, id];
    set(
      'rangeIds',
      TIME_RANGES.map((r) => r.id).filter((r) => next.includes(r)),
    );
  };

  return (
    <section className="spa-step" aria-labelledby="step-searches">
      <div className="spa-step__intro">
        <Text as="h2" variant="heading-sm" id="step-searches">
          Pick searches and time ranges
        </Text>
        <Text as="p" variant="body-md-normal" color="subtle">
          Each search runs once per time range on each dataset. A mix of search types shows where a storage layout helps and where it
          doesn't.
        </Text>
      </div>

      <div className="spa-block">
        <div className="spa-block__head">
          <Text as="h3" variant="heading-xs">
            Time ranges
          </Text>
          <Text variant="body-sm-normal" color="subtle">
            Every window ends at the same moment for both datasets.
          </Text>
        </div>
        <div className="spa-chips" role="group" aria-label="Time ranges">
          {TIME_RANGES.map((r) => {
            const on = options.rangeIds.includes(r.id);
            return (
              <button key={r.id} type="button" className={`spa-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleRange(r.id)}>
                Last {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="spa-block">
        <div className="spa-block__head">
          <Text as="h3" variant="heading-xs">
            Searches
          </Text>
          <span className="spa-block__actions">
            <Button size="xs" variant="tertiary" onClick={() => set('searchIds', available.map((s) => s.id))}>
              Select all
            </Button>
            <Button size="xs" variant="tertiary" onClick={() => set('searchIds', [])}>
              Clear
            </Button>
          </span>
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const items = PAN_SUITE.filter((s) => s.category === cat);
          if (!items.length) return null;
          return (
            <div className="spa-cat" key={cat}>
              <div className="spa-cat__head">
                <Text variant="body-md-semibold">{cat}</Text>
                <Text variant="body-sm-normal" color="subtle">
                  {CATEGORY_NOTE[cat]}
                </Text>
              </div>
              <ul className="spa-searches">
                {items.map((s) => {
                  const reason = unavailableReason(s, mapA, mapB, needle);
                  const q = renderQuery(s.template, { dataset: a.id, fields: mapA, span: '15m', needle: needle || '…' });
                  return (
                    <li key={s.id} className={`spa-search${reason ? ' is-off' : ''}`}>
                      <Checkbox checked={selected.has(s.id) && !reason} disabled={!!reason} onChange={(e) => toggleSearch(s.id, e.target.checked)}>
                        {s.name}
                      </Checkbox>
                      <div className="spa-search__body">
                        <Text variant="body-sm-normal" color="subtle">
                          {reason ?? s.description}
                        </Text>
                        <button
                          type="button"
                          className="spa-linkbtn"
                          aria-expanded={openQuery === s.id}
                          onClick={() => setOpenQuery(openQuery === s.id ? null : s.id)}
                        >
                          {openQuery === s.id ? 'Hide query' : 'Show query'}
                        </button>
                        {openQuery === s.id && <pre className="spa-code">{q}</pre>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="spa-block">
        <Collapse title="Fairness options">
          <div className="spa-options">
            <div className="spa-option">
              <RadioGroup name="order" value={options.order} onChange={(e) => set('order', e.target.value as RunOrder)} layout="vertical">
                <Radio value="pairwise">Alternate A and B for each search (recommended)</Radio>
                <Radio value="dataset">Run everything on A, then everything on B</Radio>
              </RadioGroup>
              <Text variant="body-xs-normal" color="subtle">
                Alternating keeps both datasets exposed to the same platform conditions and swaps who goes first each time.
              </Text>
            </div>
            <div className="spa-option spa-option--row">
              <Switch aria-labelledby="warmup-label" checked={options.warmup} onChange={(e) => set('warmup', e.target.checked)} size="sm" />
              <div>
                <Text variant="body-md-semibold" id="warmup-label">
                  Warm up first
                </Text>
                <Text as="p" variant="body-xs-normal" color="subtle">
                  One small unscored search per dataset, so the first real search doesn't pay a cold start.
                </Text>
              </div>
            </div>
            <div className="spa-option spa-option--grid">
              <NumberField
                label="Repetitions"
                helperText="Median of these is scored"
                value={options.repetitions}
                onChange={(v) => set('repetitions', Math.min(5, Math.max(1, Math.round(v || 1))))}
                min={1}
                max={5}
              />
              <NumberField
                label="Settle lag (minutes)"
                helperText="Windows end this long ago, so late data can't skew one side"
                value={options.settleLagMinutes}
                onChange={(v) => set('settleLagMinutes', Math.min(120, Math.max(0, Math.round(v || 0))))}
                min={0}
                max={120}
              />
              <NumberField
                label="Timeout per search (minutes)"
                helperText="Counted from when the search starts running, not while queued"
                value={options.timeoutMinutes}
                onChange={(v) => set('timeoutMinutes', Math.min(60, Math.max(1, Math.round(v || 10))))}
                min={1}
                max={60}
              />
            </div>
          </div>
        </Collapse>
      </div>
    </section>
  );
}
