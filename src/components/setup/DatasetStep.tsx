import { useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Tag, Text, TextField } from '@capra/core';
import { SearchOutlined } from '@capra/icons';
import { layoutLabel, typeLabel } from '../../lib/datasets';
import type { DatasetInfo, Side } from '../../lib/types';

interface Props {
  datasets: DatasetInfo[] | null;
  loadError: string | null;
  onRetry: () => void;
  a: DatasetInfo | null;
  b: DatasetInfo | null;
  onPick: (side: Side, dataset: DatasetInfo) => void;
}

export function DatasetTags({ d }: { d: DatasetInfo }) {
  const layout = layoutLabel(d);
  return (
    <span className="spa-tags">
      <Tag size="sm">{typeLabel(d.type)}</Tag>
      {layout && (
        <Tag size="sm" color={d.format === 'parquet' ? 'indigo' : 'default'}>
          {layout}
        </Tag>
      )}
      {d.looksLikePan && (
        <Tag size="sm" color="criblTeal">
          Firewall traffic
        </Tag>
      )}
    </span>
  );
}

export function DatasetStep({ datasets, loadError, onRetry, a, b, onPick }: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!datasets) return [];
    if (!needle) return datasets;
    return datasets.filter((d) =>
      [d.id, d.description, d.type, typeLabel(d.type), layoutLabel(d)].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [datasets, q]);

  return (
    <section className="spa-step" aria-labelledby="step-datasets">
      <div className="spa-step__intro">
        <Text as="h2" variant="heading-sm" id="step-datasets">
          Choose the two datasets to compare
        </Text>
        <Text as="p" variant="body-md-normal" color="subtle">
          Both should hold the same kind of events, such as the same firewall traffic stored in two layouts. Every search runs on A and then
          on B, over the same time window.
        </Text>
      </div>

      {loadError && (
        <Alert appearance="danger" title="Couldn't load datasets" action={{ label: 'Try again', onClick: onRetry }}>
          {loadError}
        </Alert>
      )}

      <div className="spa-filter">
        <TextField
          aria-label="Filter datasets"
          type="search"
          leadingSlot={<SearchOutlined size="sm" />}
          value={q}
          onChange={setQ}
          placeholder="Filter by name, type or format"
        />
        {datasets && (
          <Text variant="body-sm-normal" color="subtle">
            {filtered.length === datasets.length ? `${datasets.length} datasets` : `${filtered.length} of ${datasets.length} datasets`}
          </Text>
        )}
      </div>

      {!datasets && !loadError && (
        <div className="spa-dslist">
          <Skeleton loading active paragraph={{ rows: 6 }} title={false}>
            <span />
          </Skeleton>
        </div>
      )}

      {datasets && filtered.length === 0 && (
        <Text as="p" variant="body-md-normal" color="subtle">
          No dataset matches “{q}”.
        </Text>
      )}

      {datasets && filtered.length > 0 && (
        <ul className="spa-dslist">
          {filtered.map((d) => {
            const isA = a?.id === d.id;
            const isB = b?.id === d.id;
            return (
              <li key={d.id} className={`spa-ds${isA ? ' is-a' : ''}${isB ? ' is-b' : ''}`}>
                <div className="spa-ds__main">
                  <span className="spa-ds__name">
                    {(isA || isB) && <span className={`spa-ds__slot ${isA ? 'spa-a' : 'spa-b'}`}>{isA ? 'A' : 'B'}</span>}
                    {d.id}
                  </span>
                  {d.description && <span className="spa-ds__desc">{d.description}</span>}
                  <DatasetTags d={d} />
                </div>
                <div className="spa-ds__actions">
                  <Button size="sm" variant={isA ? 'primary' : 'secondary'} disabled={isB} onClick={() => onPick('A', d)}>
                    {isA ? 'Dataset A' : 'Use as A'}
                  </Button>
                  <Button size="sm" variant={isB ? 'primary' : 'secondary'} disabled={isA} onClick={() => onPick('B', d)}>
                    {isB ? 'Dataset B' : 'Use as B'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
