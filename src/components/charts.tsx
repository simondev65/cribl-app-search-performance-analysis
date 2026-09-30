import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { findRange, findSearch } from '../lib/suite';
import { TIE_THRESHOLD } from '../lib/scoring';
import { formatBytes, formatCount, formatDuration, formatRatio, formatSeconds } from '../lib/format';
import type { PairResult, Side } from '../lib/types';

/* ----------------------------------------------------------------------------
 * Shared hover tooltip. Positioned inside a relatively positioned chart frame.
 * ------------------------------------------------------------------------- */

interface Tip {
  x: number;
  y: number;
  /** Anchor the tooltip to the left of the pointer when it would overflow the frame. */
  flip: boolean;
  content: ReactNode;
}

const TIP_WIDTH = 180;

function useTip() {
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const place = (x: number, y: number, content: ReactNode) => {
    const width = frame.current?.clientWidth ?? 0;
    setTip({ x, y, flip: x > width - TIP_WIDTH, content });
  };
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => {
    const box = frame.current?.getBoundingClientRect();
    if (box) place(e.clientX - box.left, e.clientY - box.top, content);
  };
  const showAt = (el: Element, content: ReactNode) => {
    const box = frame.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (box) place(r.left + r.width / 2 - box.left, r.top - box.top, content);
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="spa-tip"
      role="tooltip"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flip ? '-100%' : '-50%'}, calc(-100% - 10px))` }}
    >
      {tip.content}
    </div>
  ) : null;
  return { frame, show, showAt, hide, node };
}

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const sideClass = (side: Side) => (side === 'A' ? 'spa-a' : 'spa-b');

/** Small colored key that pairs a series color with its name, so identity is never color-alone. */
export function SeriesKey({ side, children }: { side: Side; children: ReactNode }) {
  return (
    <span className="spa-key">
      <span className={`spa-key__swatch ${sideClass(side)}`} aria-hidden />
      <span className="spa-key__letter">{side}</span>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------------------
 * Drag strip: one lane per dataset, bar length = total time. Shorter wins.
 * ------------------------------------------------------------------------- */

export interface LaneDatum {
  side: Side;
  name: string;
  value: number | null;
  detail?: ReactNode;
}

export function DragStrip({ lanes, format = formatDuration, caption }: { lanes: LaneDatum[]; format?: (v: number) => string; caption?: string }) {
  const { frame: tipFrame, show: showTip, hide: hideTip, node: tipNode } = useTip();
  const max = Math.max(1, ...lanes.map((l) => l.value ?? 0));
  const best = Math.min(...lanes.map((l) => l.value ?? Infinity));
  return (
    <div className="spa-strip" ref={tipFrame}>
      {lanes.map((l) => {
        const pct = l.value ? Math.max(1.5, (l.value / max) * 100) : 0;
        const winner = l.value !== null && l.value === best && lanes.filter((x) => x.value === best).length === 1;
        return (
          <div className="spa-strip__lane" key={l.side}>
            <div className="spa-strip__label">
              <SeriesKey side={l.side}>
                <span className="spa-strip__name" title={l.name}>
                  {l.name}
                </span>
              </SeriesKey>
            </div>
            <div
              className="spa-strip__track"
              onMouseMove={(e) =>
                showTip(
                  e,
                  <>
                    <strong>{l.name}</strong>
                    <div>{l.value === null ? 'No completed searches' : format(l.value)}</div>
                    {l.detail}
                  </>,
                )
              }
              onMouseLeave={hideTip}
            >
              <div className={`spa-strip__bar ${sideClass(l.side)}`} style={{ width: `${pct}%` }} />
              <span className="spa-strip__value" style={{ left: `calc(${pct}% + 8px)` }}>
                {l.value === null ? '—' : format(l.value)}
                {winner && <span className="spa-strip__flag">fastest</span>}
              </span>
            </div>
          </div>
        );
      })}
      {caption && <p className="spa-caption">{caption}</p>}
      {tipNode}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Speedup heatmap: search × time range, diverging teal (A faster) ↔ purple (B faster).
 * ------------------------------------------------------------------------- */

const SATURATE_AT = Math.log2(8);

type SideStats = PairResult['a'];
const finished = (s: SideStats) => !!s && s.status === 'completed' && s.execMs !== null;
const inFlight = (s: SideStats) => !s || s.status === 'pending' || s.status === 'running';

/** What a heatmap cell says: a ratio (winner named), a failure, or that it is still waiting on one side. */
function cellState(
  p: PairResult,
  nameA: string,
  nameB: string,
): { kind: 'ratio' | 'failed' | 'pending'; label: string; winnerName?: string; ratio?: string } {
  if (p.ratio !== null) {
    if (p.winner === 'tie') return { kind: 'ratio', label: 'Even' };
    const winnerName = p.winner === 'A' ? nameA : nameB;
    const ratio = formatRatio(p.ratio);
    return { kind: 'ratio', label: `${winnerName} is ${ratio} faster`, winnerName, ratio };
  }
  const failA = !finished(p.a) && !inFlight(p.a);
  const failB = !finished(p.b) && !inFlight(p.b);
  if (failA && failB) return { kind: 'failed', label: 'Both failed' };
  if (failA) return { kind: 'failed', label: `${nameA} failed` };
  if (failB) return { kind: 'failed', label: `${nameB} failed` };
  return { kind: 'pending', label: finished(p.a) ? `Waiting for ${nameB}` : finished(p.b) ? `Waiting for ${nameA}` : 'Waiting' };
}

function cellStyle(ratio: number | null): { background: string; strong: boolean } {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return { background: 'transparent', strong: false };
  const lr = Math.log2(ratio);
  if (Math.abs(ratio - 1) < TIE_THRESHOLD || Math.abs(1 / ratio - 1) < TIE_THRESHOLD) return { background: 'var(--spa-mid)', strong: false };
  const t = Math.min(1, Math.abs(lr) / SATURATE_AT);
  const pct = Math.round(18 + t * 72);
  const pole = lr > 0 ? 'var(--spa-b)' : 'var(--spa-a)';
  return { background: `color-mix(in oklab, ${pole} ${pct}%, var(--spa-mid))`, strong: pct >= 55 };
}

export function SpeedupHeatmap({
  pairs,
  searchIds,
  rangeIds,
  nameA,
  nameB,
  onSelect,
}: {
  pairs: PairResult[];
  searchIds: string[];
  rangeIds: string[];
  nameA: string;
  nameB: string;
  onSelect?: (pair: PairResult) => void;
}) {
  const { frame: tipFrame, showAt: showTipAt, hide: hideTip, node: tipNode } = useTip();
  const byKey = new Map(pairs.map((p) => [`${p.searchId}:${p.rangeId}`, p]));
  const rows = searchIds.filter((s) => rangeIds.some((r) => byKey.has(`${s}:${r}`)));
  return (
    <div className="spa-heat" ref={tipFrame}>
      <div className="spa-heat__legend" aria-label="Color scale">
        <span>{nameA} faster</span>
        <span className="spa-heat__ramp" aria-hidden />
        <span>{nameB} faster</span>
      </div>
      <div className="spa-heat__scroll">
        <table className="spa-heat__grid">
          <thead>
            <tr>
              <th scope="col" className="spa-heat__corner">
                Search
              </th>
              {rangeIds.map((r) => (
                <th scope="col" key={r}>
                  {findRange(r)?.label ?? r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s}>
                <th scope="row">{findSearch(s)?.name ?? s}</th>
                {rangeIds.map((r) => {
                  const p = byKey.get(`${s}:${r}`);
                  if (!p) return <td key={r} className="spa-heat__cell spa-heat__cell--empty" />;
                  const style = cellStyle(p.ratio);
                  const state = cellState(p, nameA, nameB);
                  const failed = state.kind === 'failed';
                  const pending = state.kind === 'pending';
                  const label = state.label;
                  return (
                    <td key={r} className="spa-heat__cell-wrap">
                      <button
                        type="button"
                        className={`spa-heat__cell${style.strong ? ' is-strong' : ''}${failed ? ' is-failed' : ''}${pending ? ' is-pending' : ''}`}
                        style={{ background: failed || pending ? undefined : style.background }}
                        onClick={() => onSelect?.(p)}
                        onMouseEnter={(e) => showTipAt(e.currentTarget, <PairTip pair={p} nameA={nameA} nameB={nameB} />)}
                        onMouseLeave={hideTip}
                        onFocus={(e) => showTipAt(e.currentTarget, <PairTip pair={p} nameA={nameA} nameB={nameB} />)}
                        onBlur={hideTip}
                        aria-label={`${findSearch(s)?.name ?? s}, ${findRange(r)?.label ?? r}: ${label}`}
                      >
                        {state.winnerName ? (
                          <span className="spa-heat__label" title={label}>
                            <span className="spa-heat__name">{state.winnerName}</span>
                            <span className="spa-heat__ratio">{state.ratio}</span>
                          </span>
                        ) : (
                          <span className="spa-heat__label" title={label}>
                            <span className="spa-heat__name">{label}</span>
                          </span>
                        )}
                        {p.parityWarning && <span className="spa-heat__warn" title="Result counts differ" aria-hidden>≠</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tipNode}
    </div>
  );
}

function PairTip({ pair, nameA, nameB }: { pair: PairResult; nameA: string; nameB: string }) {
  const line = (side: Side, name: string) => {
    const s = side === 'A' ? pair.a : pair.b;
    return (
      <div className="spa-tip__row">
        <SeriesKey side={side}>{name}</SeriesKey>
        <span>{s ? formatDuration(s.execMs) : 'failed'}</span>
      </div>
    );
  };
  return (
    <>
      <strong>
        {findSearch(pair.searchId)?.name ?? pair.searchId}, last {findRange(pair.rangeId)?.label ?? pair.rangeId}
      </strong>
      {line('A', nameA)}
      {line('B', nameB)}
      {pair.a && pair.b && (
        <>
          <div className="spa-tip__muted">
            CPU {formatSeconds(pair.a.cpuSeconds)} vs {formatSeconds(pair.b.cpuSeconds)}
          </div>
          <div className="spa-tip__muted">
            Scanned {formatBytes(pair.a.bytesScanned)} vs {formatBytes(pair.b.bytesScanned)}
          </div>
        </>
      )}
      {pair.parityWarning && (
        <div className="spa-tip__muted">
          Result counts differ: {formatCount(pair.a?.results)} vs {formatCount(pair.b?.results)}
        </div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------------
 * Scaling: total execution time per time range, one line per dataset.
 * ------------------------------------------------------------------------- */

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface ScalingPoint {
  rangeId: string;
  A: number | null;
  B: number | null;
  searches: number;
}

export function ScalingChart({ points, nameA, nameB }: { points: ScalingPoint[]; nameA: string; nameB: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { frame: tipFrame, show: showTip, hide: hideTip, node: tipNode } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const m = { top: 16, right: 96, bottom: 32, left: 64 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const max = Math.max(1, ...points.flatMap((p) => [p.A ?? 0, p.B ?? 0]));
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => h - (v / yMax) * h;

  const path = (side: Side) =>
    points
      .map((p, i) => ({ v: p[side], i }))
      .filter((d): d is { v: number; i: number } => d.v !== null)
      .map((d, k) => `${k === 0 ? 'M' : 'L'}${x(d.i).toFixed(1)},${y(d.v).toFixed(1)}`)
      .join(' ');

  const last = (side: Side) => {
    for (let i = points.length - 1; i >= 0; i -= 1) if (points[i][side] !== null) return { i, v: points[i][side] as number };
    return null;
  };
  const endA = last('A');
  const endB = last('B');
  // Keep the two end labels from colliding.
  let labelYA = endA ? y(endA.v) : 0;
  let labelYB = endB ? y(endB.v) : 0;
  if (endA && endB && Math.abs(labelYA - labelYB) < 16) {
    const mid = (labelYA + labelYB) / 2;
    const up = labelYA <= labelYB ? 'A' : 'B';
    labelYA = up === 'A' ? mid - 8 : mid + 8;
    labelYB = up === 'B' ? mid - 8 : mid + 8;
  }

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    let idx = 0;
    let best = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    setHover(idx);
    const p = points[idx];
    showTip(
      e,
      <>
        <strong>Last {findRange(p.rangeId)?.label ?? p.rangeId}</strong>
        <div className="spa-tip__row">
          <SeriesKey side="A">{nameA}</SeriesKey>
          <span>{formatDuration(p.A)}</span>
        </div>
        <div className="spa-tip__row">
          <SeriesKey side="B">{nameB}</SeriesKey>
          <span>{formatDuration(p.B)}</span>
        </div>
        <div className="spa-tip__muted">Sum of {p.searches} searches that completed on both</div>
      </>,
    );
  };

  return (
    <div className="spa-scale" ref={ref}>
      <div className="spa-legend">
        <SeriesKey side="A">{nameA}</SeriesKey>
        <SeriesKey side="B">{nameB}</SeriesKey>
      </div>
      <div ref={tipFrame} className="spa-scale__frame">
        <svg width={width} height={height} role="img" aria-label="Total execution time by time range for both datasets">
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={w} className="spa-grid" />
                <text x={-10} dy="0.32em" textAnchor="end" className="spa-axis">
                  {formatDuration(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <text key={p.rangeId} x={x(i)} y={h + 22} textAnchor="middle" className="spa-axis">
                {findRange(p.rangeId)?.label ?? p.rangeId}
              </text>
            ))}
            {hover !== null && <line className="spa-crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={h} />}
            {(['A', 'B'] as Side[]).map((side) => (
              <g key={side} className={sideClass(side)}>
                <path d={path(side)} className="spa-line" />
                {points.map((p, i) =>
                  p[side] === null ? null : (
                    <circle key={p.rangeId} cx={x(i)} cy={y(p[side] as number)} r={hover === i ? 6 : 4.5} className="spa-dot" />
                  ),
                )}
              </g>
            ))}
            {endA && (
              <text x={x(endA.i) + 12} y={labelYA} dy="0.32em" className="spa-endlabel">
                A {formatDuration(endA.v)}
              </text>
            )}
            {endB && (
              <text x={x(endB.i) + 12} y={labelYB} dy="0.32em" className="spa-endlabel">
                B {formatDuration(endB.v)}
              </text>
            )}
            <rect width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => (setHover(null), hideTip())} />
          </g>
        </svg>
        {tipNode}
      </div>
    </div>
  );
}

/** Aggregates comparable pairs into one point per time range. */
export function scalingPoints(pairs: PairResult[], rangeIds: string[]): ScalingPoint[] {
  return rangeIds.map((rangeId) => {
    const both = pairs.filter((p) => p.rangeId === rangeId && p.a?.execMs != null && p.b?.execMs != null);
    return {
      rangeId,
      A: both.length ? both.reduce((s, p) => s + (p.a!.execMs as number), 0) : null,
      B: both.length ? both.reduce((s, p) => s + (p.b!.execMs as number), 0) : null,
      searches: both.length,
    };
  });
}
