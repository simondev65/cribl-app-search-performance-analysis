import { Alert, AutocompleteField, Button, Spinner, Text, TextField } from '@capra/core';
import { CircleCheck, WarningOutlined } from '@capra/icons';
import { LOGICAL_FIELDS, readField } from '../../lib/fields';
import { SeriesKey } from '../charts';
import type { DatasetInfo, FieldMap, LogicalField, Side } from '../../lib/types';

export type SampleState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface SideSetup {
  sample: Record<string, unknown> | null;
  state: SampleState;
  error?: string;
  available: string[];
  map: FieldMap;
  /** Where the current mapping came from, shown to the user */
  source: 'saved' | 'detected' | 'default';
  sampledFor?: string;
}

interface Props {
  a: DatasetInfo;
  b: DatasetInfo;
  sideA: SideSetup;
  sideB: SideSetup;
  needle: string;
  onNeedle: (v: string) => void;
  onMap: (side: Side, field: LogicalField, value: string) => void;
  onResample: (side: Side) => void;
}

function preview(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

function SideStatus({ side, dataset, setup, onResample }: { side: Side; dataset: DatasetInfo; setup: SideSetup; onResample: () => void }) {
  const text: Record<SampleState, string> = {
    idle: 'Waiting to sample',
    loading: 'Sampling one event…',
    ready:
      setup.source === 'saved'
        ? 'Using your saved mapping; checked against a fresh sample'
        : `Detected from a sample event (${setup.available.length} fields)`,
    empty: 'No events in the last 24 hours. Enter field names by hand.',
    error: setup.error ?? 'Sampling failed',
  };
  return (
    <div className="spa-fieldhead">
      <SeriesKey side={side}>
        <span className="spa-fieldhead__name">{dataset.id}</span>
      </SeriesKey>
      <span className="spa-fieldhead__status">
        {setup.state === 'loading' && <Spinner size="sm" title="Sampling" />}
        <Text variant="body-sm-normal" color={setup.state === 'error' ? 'attention' : 'subtle'}>
          {text[setup.state]}
        </Text>
        {(setup.state === 'error' || setup.state === 'empty') && (
          <Button size="xs" variant="tertiary" onClick={onResample}>
            Sample again
          </Button>
        )}
      </span>
    </div>
  );
}

function FieldInput({ setup, field, label, onChange }: { setup: SideSetup; field: LogicalField; label: string; onChange: (v: string) => void }) {
  const value = setup.map[field];
  const found = setup.sample ? readField(setup.sample, value) !== undefined : null;
  return (
    <div className="spa-fieldcell">
      <AutocompleteField
        aria-label={label}
        value={value}
        onChange={onChange}
        items={setup.available.map((k) => ({ value: k }))}
        size="sm"
        appearance={!value ? 'danger' : found === false ? 'warning' : 'default'}
        placeholder="field name"
      />
      <span className="spa-fieldcell__sample">
        {found === true && (
          <>
            <span className="spa-ok" aria-hidden>
              <CircleCheck size="xs" />
            </span>
            <span title={String(readField(setup.sample, value))}>{preview(readField(setup.sample, value)) || 'empty value'}</span>
          </>
        )}
        {found === false && (
          <>
            <span className="spa-warn" aria-hidden>
              <WarningOutlined size="xs" />
            </span>
            <span>Not in the sample event</span>
          </>
        )}
      </span>
    </div>
  );
}

export function FieldStep({ a, b, sideA, sideB, needle, onNeedle, onMap, onResample }: Props) {
  const sampling = sideA.state === 'loading' || sideB.state === 'loading';
  return (
    <section className="spa-step" aria-labelledby="step-fields">
      <div className="spa-step__intro">
        <Text as="h2" variant="heading-sm" id="step-fields">
          Check the field names
        </Text>
        <Text as="p" variant="body-md-normal" color="subtle">
          The searches refer to firewall fields such as source IP or bytes. The app took one event from each dataset and matched those fields
          for you. Correct any that are wrong. Your corrections are remembered for next time.
        </Text>
      </div>

      <div className="spa-fieldgrid" role="table" aria-label="Field mapping">
        <div className="spa-fieldgrid__row spa-fieldgrid__row--head" role="row">
          <div role="columnheader">
            <Text variant="body-sm-semibold" color="subtle">
              Used for
            </Text>
          </div>
          <div role="columnheader">
            <SideStatus side="A" dataset={a} setup={sideA} onResample={() => onResample('A')} />
          </div>
          <div role="columnheader">
            <SideStatus side="B" dataset={b} setup={sideB} onResample={() => onResample('B')} />
          </div>
        </div>
        {LOGICAL_FIELDS.map((f) => (
          <div className="spa-fieldgrid__row" role="row" key={f.key}>
            <div role="rowheader" className="spa-fieldgrid__label">
              <Text variant="body-md-semibold">{f.label}</Text>
              <Text variant="body-xs-normal" color="subtle">
                {f.hint}
              </Text>
            </div>
            <div role="cell">
              <FieldInput setup={sideA} field={f.key} label={`${f.label} field in ${a.id}`} onChange={(v) => onMap('A', f.key, v)} />
            </div>
            <div role="cell">
              <FieldInput setup={sideB} field={f.key} label={`${f.label} field in ${b.id}`} onChange={(v) => onMap('B', f.key, v)} />
            </div>
          </div>
        ))}
      </div>

      <div className="spa-needle">
        <TextField
          label="Value to look for"
          helperText="Used by the keyword and field filter searches. Pick a value that exists in both datasets, such as a busy source IP. The app suggests one from the sample."
          value={needle}
          onChange={onNeedle}
          placeholder="10.0.0.12"
          appearance={!needle && !sampling ? 'warning' : 'default'}
        />
      </div>
      {!needle && !sampling && (
        <Alert appearance="warning" layout="inline">
          Without a value, the keyword and field filter searches are skipped.
        </Alert>
      )}
    </section>
  );
}
