import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, EmptyState, Modal, Skeleton, Text, TextField, Toast } from '@capra/core';
import { ArrowLeft, Download, EditOutlined } from '@capra/icons';
import { loadRun, renameRun } from '../api/runs';
import { computeScorecard, verdict } from '../lib/scoring';
import { layoutLabel } from '../lib/datasets';
import { findRange, findSearch } from '../lib/suite';
import { formatDate, formatDuration, formatWindow } from '../lib/format';
import { effectiveStatus, progressOf } from '../lib/progress';
import { isLive, useBenchmark } from '../state/BenchmarkContext';
import { DragStrip, ScalingChart, SeriesKey, SpeedupHeatmap, scalingPoints } from '../components/charts';
import { ProgressPanel, RunStatusPill, ScoreTiles, StatsTable } from '../components/results';
import type { PairResult, Run, Side } from '../lib/types';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function download(run: Run) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `search-benchmark-${run.config.name.replace(/[^\w.-]+/g, '_') || run.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RunPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { active, resume, stop } = useBenchmark();
  const [stored, setStored] = useState<Run | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [focus, setFocus] = useState<{ searchId: string; rangeId: string } | null>(null);

  const live = isLive(active, id);
  const run = active?.id === id ? active : stored;

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    try {
      const r = await loadRun(id);
      setStored(r);
      setState(r ? 'ready' : 'missing');
    } catch (err) {
      console.error('[search-perf] loading run failed', id, err);
      setError(errText(err));
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    if (active?.id === id) setState('ready');
    else void load();
    // The live run is read from context; only reload when navigating to another run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When the live run ends, keep showing its final state.
  useEffect(() => {
    if (active && active.id === id && active.status !== 'running') {
      setStored(active);
      setStopping(false);
    }
  }, [active, id]);

  const card = useMemo(() => (run ? computeScorecard(run.plan, run.config.searchIds, run.config.rangeIds) : null), [run]);

  if (state === 'loading' && !run) {
    return (
      <div className="spa-page">
        <Skeleton loading active paragraph={{ rows: 8 }}>
          <span />
        </Skeleton>
      </div>
    );
  }
  if (state === 'missing' || (state === 'error' && !run)) {
    return (
      <div className="spa-page">
        <EmptyState
          title={state === 'missing' ? 'This run no longer exists' : "Couldn't load this run"}
          description={state === 'missing' ? 'It may have been deleted.' : `${error}. Try again in a moment.`}
          illustration={state === 'missing' ? 'EmptyFolder' : 'Attention'}
        >
          <span className="spa-row">
            <Button variant="secondary" onClick={() => navigate('/runs')}>
              Back to runs
            </Button>
            {state === 'error' && (
              <Button variant="primary" onClick={() => void load()}>
                Try again
              </Button>
            )}
          </span>
        </EmptyState>
      </div>
    );
  }
  if (!run || !card) return null;

  const { config } = run;
  const status = effectiveStatus(run, live ? run.id : undefined);
  const progress = progressOf(run);
  const nameA = config.datasetA.id;
  const nameB = config.datasetB.id;
  const v = verdict(card.speedup, nameA, nameB);
  const otherRunning = active?.status === 'running' && active.id !== run.id;
  const resumable = (status === 'stopped' || status === 'interrupted') && progress.done < progress.total;
  const lanes = (['A', 'B'] as Side[]).map((side) => {
    const d = side === 'A' ? config.datasetA : config.datasetB;
    return {
      side,
      name: d.id,
      value: card.totals[side].execMs,
      detail: layoutLabel(d),
    };
  });

  const onStop = () => {
    setStopping(true);
    stop();
  };
  const onResume = async () => {
    setResuming(true);
    try {
      await resume(run.id);
      Toast.success('Benchmark resumed');
    } catch (err) {
      Toast.error(`Couldn't resume: ${errText(err)}`, { duration: 0 });
    } finally {
      setResuming(false);
    }
  };
  const onRename = async () => {
    const next = draftName.trim();
    if (!next) return;
    try {
      await renameRun(run.id, next);
      setStored((r) => (r ? { ...r, config: { ...r.config, name: next } } : r));
      setRenaming(false);
      Toast.success('Run renamed');
    } catch (err) {
      Toast.error(`Couldn't rename: ${errText(err)}`);
    }
  };
  const selectPair = (p: PairResult) => {
    setFocus({ searchId: p.searchId, rangeId: p.rangeId });
    document.getElementById('run-stats')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="spa-page spa-run">
      <Link to="/runs" className="spa-back">
        <ArrowLeft size="sm" aria-hidden />
        All runs
      </Link>

      <header className="spa-run__head">
        <div className="spa-run__title">
          <Text as="h2" variant="heading-md">
            {config.name}
          </Text>
          <RunStatusPill status={status} />
          <Button
            size="sm"
            variant="tertiary"
            leadingIcon={EditOutlined}
            disabled={live}
            onClick={() => {
              setDraftName(config.name);
              setRenaming(true);
            }}
          >
            Rename
          </Button>
        </div>
        <Text as="p" variant="body-sm-normal" color="subtle">
          Started {formatDate(run.createdAt)}
          {run.createdBy ? ` by ${run.createdBy}` : ''}. All windows end at {formatDate(run.anchorLatest * 1000)}.
        </Text>
        <div className="spa-run__actions">
          <Button size="sm" variant="secondary" leadingIcon={Download} onClick={() => download(run)}>
            Export JSON
          </Button>
        </div>
      </header>

      {(live || progress.done < progress.total) && (
        <ProgressPanel run={run} progress={progress} live={live} onStop={onStop} stopping={stopping} />
      )}

      {resumable && (
        <Alert
          appearance="warning"
          title={status === 'interrupted' ? 'This run was cut off' : 'This run was stopped'}
          action={
            otherRunning ? undefined : { label: resuming ? 'Resuming…' : 'Resume', onClick: () => void onResume() }
          }
        >
          {status === 'interrupted'
            ? 'The tab running it was closed or reloaded. '
            : ''}
          {progress.done} of {progress.total} searches finished. Resuming runs only the rest, over the same time windows.
          {otherRunning ? ' Another benchmark is running now; resume this one when it finishes.' : ''}
        </Alert>
      )}

      {card.comparablePairs === 0 ? (
        <section className="spa-panel spa-run__empty">
          <Text as="p" variant="heading-sm">
            {live ? 'Results appear here as soon as a search has finished on both datasets' : 'No search finished on both datasets'}
          </Text>
          <Text as="p" variant="body-md-normal" color="subtle">
            {live
              ? 'The comparison fills in pair by pair.'
              : 'Check the table below for errors. A common cause is a field name that doesn\'t exist in one of the datasets.'}
          </Text>
        </section>
      ) : (
        <>
          <section className={`spa-verdict${v.side === 'A' ? ' is-a' : v.side === 'B' ? ' is-b' : ''}`} aria-labelledby="verdict">
            <div className="spa-verdict__text">
              <Text as="h3" variant="heading-lg" id="verdict" FORCE__className="spa-verdict__headline">
                {v.text}
              </Text>
              <Text as="p" variant="body-md-normal" color="subtle">
                Geometric mean of execution time across {card.comparablePairs} search{card.comparablePairs === 1 ? '' : 'es'} that finished on
                both. {nameA} won {card.wins.A}, {nameB} won {card.wins.B}
                {card.wins.tie ? `, ${card.wins.tie} within 10%` : ''}. Queue time is excluded.
                {live ? ' Updating as searches finish.' : ''}
              </Text>
            </div>
            <DragStrip lanes={lanes} caption="Total execution time over the same searches" />
          </section>

          {(card.failures.A > 0 || card.failures.B > 0 || card.parityWarnings > 0) && (
            <div className="spa-flags">
              {(card.failures.A > 0 || card.failures.B > 0) && (
                <Alert appearance="danger" layout="inline">
                  {`Failed or timed out: ${card.failures.A} on ${nameA}, ${card.failures.B} on ${nameB}. Those pairs are left out of the scores.`}
                </Alert>
              )}
              {card.parityWarnings > 0 && (
                <Alert appearance="warning" layout="inline">
                  {`${card.parityWarnings} pair${card.parityWarnings === 1 ? '' : 's'} returned different result counts (marked ≠). The datasets may not hold exactly the same events for that window, so compare those with care.`}
                </Alert>
              )}
            </div>
          )}

          <ScoreTiles card={card} />

          <section className="spa-panel" aria-labelledby="heat-title">
            <div className="spa-panel__head">
              <Text as="h3" variant="heading-sm" id="heat-title">
                Search by search
              </Text>
              <Text variant="body-sm-normal" color="subtle">
                Each cell says which dataset was faster and by how much. Select a cell to see its details.
              </Text>
            </div>
            <SpeedupHeatmap
              pairs={card.pairs}
              searchIds={config.searchIds}
              rangeIds={config.rangeIds}
              nameA={nameA}
              nameB={nameB}
              onSelect={selectPair}
            />
          </section>

          {config.rangeIds.length > 1 && (
            <section className="spa-panel" aria-labelledby="scale-title">
              <div className="spa-panel__head">
                <Text as="h3" variant="heading-sm" id="scale-title">
                  How time grows with the window
                </Text>
                <Text variant="body-sm-normal" color="subtle">
                  Total execution time per time range, for searches that finished on both datasets.
                </Text>
              </div>
              <ScalingChart points={scalingPoints(card.pairs, config.rangeIds)} nameA={nameA} nameB={nameB} />
            </section>
          )}
        </>
      )}

      <section className="spa-panel" id="run-stats" aria-labelledby="stats-title">
        <div className="spa-panel__head">
          <Text as="h3" variant="heading-sm" id="stats-title">
            Every search
          </Text>
          {focus ? (
            <span className="spa-panel__filter">
              <Text variant="body-sm-normal" color="subtle">
                Showing {findSearch(focus.searchId)?.name ?? focus.searchId}, last {findRange(focus.rangeId)?.label ?? focus.rangeId}
              </Text>
              <Button size="xs" variant="tertiary" onClick={() => setFocus(null)}>
                Show all
              </Button>
            </span>
          ) : (
            <Text variant="body-sm-normal" color="subtle">
              Raw statistics from each search job. Hover a time range to see its exact window.
            </Text>
          )}
        </div>
        <StatsTable run={run} filter={focus} />
      </section>

      <section className="spa-panel spa-setupinfo" aria-labelledby="setup-title">
        <Text as="h3" variant="heading-xs" id="setup-title">
          How this run was set up
        </Text>
        <dl className="spa-dl">
          {(['A', 'B'] as Side[]).map((side) => {
            const d = side === 'A' ? config.datasetA : config.datasetB;
            const map = side === 'A' ? config.fieldMapA : config.fieldMapB;
            return (
              <div key={side}>
                <dt>
                  <SeriesKey side={side}>{d.id}</SeriesKey>
                </dt>
                <dd>
                  {[layoutLabel(d), d.type].filter(Boolean).join(', ')}. Fields:{' '}
                  {Object.entries(map)
                    .map(([k, f]) => `${k}=${f}`)
                    .join(', ')}
                </dd>
              </div>
            );
          })}
          <div>
            <dt>Order</dt>
            <dd>{config.order === 'pairwise' ? 'Alternating A and B, swapping who goes first' : 'All of A, then all of B'}</dd>
          </div>
          <div>
            <dt>Repetitions</dt>
            <dd>
              {config.repetitions}
              {config.repetitions > 1 ? ', median scored' : ''}
              {config.warmup ? ', with a warm-up on each dataset' : ''}
            </dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>{formatDuration(config.timeoutMinutes * 60_000)} per search, counted from start of execution</dd>
          </div>
          {config.needle && (
            <div>
              <dt>Value looked for</dt>
              <dd>
                <code>{config.needle}</code>
              </dd>
            </div>
          )}
          {run.plan[0] && (
            <div>
              <dt>Longest window</dt>
              <dd>{formatWindow(Math.min(...run.plan.map((p) => p.earliest)), run.anchorLatest)}</dd>
            </div>
          )}
        </dl>
      </section>

      <Modal
        isOpen={renaming}
        title="Rename run"
        onClose={() => setRenaming(false)}
        footer={
          <Modal.FooterActions>
            <Button variant="tertiary" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void onRename()} disabled={!draftName.trim()}>
              Save name
            </Button>
          </Modal.FooterActions>
        }
      >
        <TextField label="Name" value={draftName} onChange={setDraftName} autoFocus />
      </Modal>
    </div>
  );
}
