import { useEffect, useState, type ReactNode } from 'react';
import { Button, IconButton, Pill, Text, Tooltip } from '@capra/core';
import { CircleStopSolid, CopyOutlined } from '@capra/icons';
import { findRange, findSearch } from '../lib/suite';
import { WEIGHTS } from '../lib/scoring';
import { formatBytes, formatCount, formatDuration, formatScore, formatSeconds, formatWindow } from '../lib/format';
import type { Progress } from '../lib/progress';
import { SeriesKey } from './charts';
import type { JobState, MetricScore, PlanItem, Run, RunStatus, Scorecard, Side } from '../lib/types';

export function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

const RUN_STATUS: Record<RunStatus, { label: string; appearance: 'info' | 'success' | 'warning' | 'default' }> = {
  running: { label: 'Running', appearance: 'info' },
  completed: { label: 'Completed', appearance: 'success' },
  stopped: { label: 'Stopped', appearance: 'warning' },
  interrupted: { label: 'Interrupted', appearance: 'warning' },
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status];
  return (
    <Pill appearance={s.appearance} variant="muted">
      {s.label}
    </Pill>
  );
}

const JOB_STATUS: Record<JobState, { label: string; appearance: 'info' | 'success' | 'warning' | 'danger' | 'default' }> = {
  pending: { label: 'Waiting', appearance: 'default' },
  running: { label: 'Running', appearance: 'info' },
  completed: { label: 'Done', appearance: 'success' },
  failed: { label: 'Failed', appearance: 'danger' },
  canceled: { label: 'Canceled', appearance: 'warning' },
  timeout: { label: 'Timed out', appearance: 'warning' },
  skipped: { label: 'Skipped', appearance: 'default' },
};

export const datasetOf = (run: Run, side: Side) => (side === 'A' ? run.config.datasetA.id : run.config.datasetB.id);

/* ----------------------------------------------------------------------------
 * Live progress
 * ------------------------------------------------------------------------- */

export function ProgressPanel({ run, progress, live, onStop, stopping }: { run: Run; progress: Progress; live: boolean; onStop: () => void; stopping: boolean }) {
  const now = useNow(1000, live);
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
  const cur = progress.current;
  const search = cur ? (cur.warmup ? 'Warm-up' : findSearch(cur.searchId)?.name ?? cur.searchId) : null;
  const elapsed = cur?.stats?.startedAt ? now - cur.stats.startedAt : null;

  return (
    <section className="spa-progress" aria-label="Progress">
      <div className="spa-progress__top">
        <div className="spa-progress__heading">
          <Text as="p" variant="heading-sm">
            {progress.done} of {progress.total} searches finished
          </Text>
          <Text as="p" variant="body-sm-normal" color="subtle">
            {live
              ? progress.etaMs !== null
                ? `About ${formatDuration(progress.etaMs)} left at the current pace`
                : 'Estimating time left after the first search'
              : 'Not running'}
          </Text>
        </div>
        {live && (
          <Button appearance="danger" leadingIcon={CircleStopSolid} onClick={onStop} pending={stopping}>
            Stop
          </Button>
        )}
      </div>
      <div
        className="spa-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-label="Searches finished"
      >
        <div className="spa-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {live && cur && (
        <div className="spa-current">
          <div className="spa-current__meta">
            <SeriesKey side={cur.side}>{datasetOf(run, cur.side)}</SeriesKey>
            <Text variant="body-md-semibold">{search}</Text>
            <Text variant="body-sm-normal" color="subtle">
              last {findRange(cur.rangeId)?.label ?? cur.rangeId}
              {cur.rep > 1 ? `, repetition ${cur.rep}` : ''}
            </Text>
            <span className="spa-current__timer">
              {elapsed !== null ? formatDuration(Math.max(0, elapsed)) : 'starting'}
            </span>
          </div>
          <pre className="spa-code">{cur.query}</pre>
        </div>
      )}
      {stopping && live && (
        <Text as="p" variant="body-sm-normal" color="subtle">
          Stopping: canceling the current search. Finished searches are kept, and you can resume later.
        </Text>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------
 * Score tiles
 * ------------------------------------------------------------------------- */

function Tile({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="spa-tile">
      <Text as="h3" variant="body-sm-semibold" color="subtle">
        {title}
      </Text>
      {children}
      {note && (
        <Text as="p" variant="body-xs-normal" color="subtle">
          {note}
        </Text>
      )}
    </div>
  );
}

function TileRow({ side, value, score, win }: { side: Side; value: string; score?: number | null; win?: boolean }) {
  return (
    <div className={`spa-tile__row${win ? ' is-win' : ''}`}>
      <SeriesKey side={side}>
        <span className="spa-tile__value">{value}</span>
      </SeriesKey>
      {score !== undefined && <span className="spa-tile__score">{formatScore(score)}</span>}
    </div>
  );
}

const better = (s: MetricScore, side: Side) => s.A !== null && s.B !== null && s[side]! > s[side === 'A' ? 'B' : 'A']!;

export function ScoreTiles({ card }: { card: Scorecard }) {
  const { scores, totals } = card;
  return (
    <div className="spa-tiles">
      <Tile title="Overall score" note={`Out of 100. Time ${WEIGHTS.time * 100}%, CPU ${WEIGHTS.cpu * 100}%, data scanned ${WEIGHTS.bytes * 100}%.`}>
        <div className="spa-tile__duo">
          {(['A', 'B'] as Side[]).map((side) => (
            <div key={side} className={`spa-tile__big${better(scores.composite, side) ? ' is-win' : ''}`}>
              <SeriesKey side={side}>
                <span className="spa-tile__bignum">{formatScore(scores.composite[side])}</span>
              </SeriesKey>
            </div>
          ))}
        </div>
      </Tile>
      <Tile title="Execution time" note="Sum over comparable searches; score on the right">
        <TileRow side="A" value={formatDuration(totals.A.execMs)} score={scores.time.A} win={better(scores.time, 'A')} />
        <TileRow side="B" value={formatDuration(totals.B.execMs)} score={scores.time.B} win={better(scores.time, 'B')} />
      </Tile>
      <Tile title="CPU" note="Total CPU seconds across executors">
        <TileRow side="A" value={formatSeconds(totals.A.cpuSeconds)} score={scores.cpu.A} win={better(scores.cpu, 'A')} />
        <TileRow side="B" value={formatSeconds(totals.B.cpuSeconds)} score={scores.cpu.B} win={better(scores.cpu, 'B')} />
      </Tile>
      <Tile title="Data scanned" note="Bytes read from storage">
        <TileRow side="A" value={formatBytes(totals.A.bytesScanned)} score={scores.bytes.A} win={better(scores.bytes, 'A')} />
        <TileRow side="B" value={formatBytes(totals.B.bytesScanned)} score={scores.bytes.B} win={better(scores.bytes, 'B')} />
      </Tile>
      <Tile title="Queue time" note="Shown for context. Never scored.">
        <TileRow side="A" value={formatDuration(totals.A.queueMs)} />
        <TileRow side="B" value={formatDuration(totals.B.queueMs)} />
      </Tile>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Full statistics table
 * ------------------------------------------------------------------------- */

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch((err) => console.warn('[search-perf] clipboard unavailable', err));
}

export function StatsTable({ run, filter }: { run: Run; filter: { searchId: string; rangeId: string } | null }) {
  const rows = run.plan.filter((p) => !filter || (p.searchId === filter.searchId && p.rangeId === filter.rangeId));
  const reps = run.config.repetitions > 1;
  return (
    <div className="spa-tablewrap">
      <table className="spa-table">
        <thead>
          <tr>
            <th scope="col">Search</th>
            <th scope="col">Range</th>
            <th scope="col">Dataset</th>
            {reps && <th scope="col" className="num">Rep</th>}
            <th scope="col">Status</th>
            <th scope="col" className="num">Execution</th>
            <th scope="col" className="num">
              <Tooltip title="Time waiting before execution started. Not scored.">
                <span className="spa-th-hint" tabIndex={0}>
                  Queued
                </span>
              </Tooltip>
            </th>
            <th scope="col" className="num">First result</th>
            <th scope="col" className="num">CPU</th>
            <th scope="col" className="num">Executors</th>
            <th scope="col" className="num">Scanned</th>
            <th scope="col" className="num">Events read</th>
            <th scope="col" className="num">Objects</th>
            <th scope="col" className="num">Results</th>
            <th scope="col">Engine</th>
            <th scope="col">Job</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <StatsRow key={p.key} run={run} item={p} reps={reps} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsRow({ run, item, reps }: { run: Run; item: PlanItem; reps: boolean }) {
  const s = item.stats;
  const state = JOB_STATUS[s?.status ?? 'pending'];
  const engine = [s?.computeType, s?.cacheStatus].filter(Boolean).join(', ');
  return (
    <tr className={item.warmup ? 'is-warmup' : undefined}>
      <th scope="row">
        {item.warmup ? 'Warm-up' : findSearch(item.searchId)?.name ?? item.searchId}
        {item.warmup && <span className="spa-muted"> (not scored)</span>}
      </th>
      <td title={formatWindow(item.earliest, item.latest)}>{findRange(item.rangeId)?.label ?? item.rangeId}</td>
      <td>
        <SeriesKey side={item.side}>
          <span className="spa-table__ds">{datasetOf(run, item.side)}</span>
        </SeriesKey>
      </td>
      {reps && <td className="num">{item.warmup ? '--' : item.rep}</td>}
      <td>
        <span title={s?.error}>
          <Pill appearance={state.appearance} variant="muted" inline>
            {state.label}
          </Pill>
        </span>
        {s?.error && <div className="spa-table__err">{s.error}</div>}
      </td>
      <td className="num strong">{s?.execMs != null ? formatDuration(s.execMs) : '--'}</td>
      <td className="num spa-muted">{s?.queueMs != null ? formatDuration(s.queueMs) : '--'}</td>
      <td className="num">{s?.ttfbMs != null ? formatDuration(s.ttfbMs) : '--'}</td>
      <td className="num">{s?.cpuSeconds != null ? formatSeconds(s.cpuSeconds) : '--'}</td>
      <td className="num">{s?.executors ?? '--'}</td>
      <td className="num">{s?.bytesScanned != null ? formatBytes(s.bytesScanned) : '--'}</td>
      <td className="num">{s?.eventsScanned != null ? formatCount(s.eventsScanned) : '--'}</td>
      <td className="num">{s?.objectsSearched != null ? formatCount(s.objectsSearched) : '--'}</td>
      <td className="num">{s?.results != null ? formatCount(s.results) : '--'}</td>
      <td>{engine || '--'}</td>
      <td>
        {s?.jobId ? (
          <span className="spa-job">
            <span className="spa-job__id" title={s.jobId}>
              {s.jobId.length > 14 ? `${s.jobId.slice(0, 13)}…` : s.jobId}
            </span>
            <IconButton icon={CopyOutlined} aria-label={`Copy job ID ${s.jobId}`} size="xs" variant="tertiary" onClick={() => copy(s.jobId)} />
          </span>
        ) : (
          '--'
        )}
      </td>
    </tr>
  );
}
