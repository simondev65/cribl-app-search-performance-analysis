import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Text, TextField, Toast } from '@capra/core';
import { ArrowLeft, Play } from '@capra/icons';
import { listDatasets, sampleEvent } from '../api/cribl';
import { loadFieldMap, loadLastSetup, saveFieldMap, saveLastSetup } from '../api/runs';
import { sortDatasets, toDatasetInfo } from '../lib/datasets';
import { detectFieldMap, PAN_V1_DEFAULTS, pickNeedle } from '../lib/fields';
import { DEFAULT_RANGE_IDS, PAN_SUITE } from '../lib/suite';
import { useBenchmark } from '../state/BenchmarkContext';
import { DatasetStep, DatasetTags } from '../components/setup/DatasetStep';
import { FieldStep, type SideSetup } from '../components/setup/FieldStep';
import { SearchStep, unavailableReason, type SearchOptions } from '../components/setup/SearchStep';
import { SeriesKey } from '../components/charts';
import type { DatasetInfo, LogicalField, Side } from '../lib/types';

type Step = 1 | 2 | 3;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Datasets' },
  { n: 2, label: 'Fields' },
  { n: 3, label: 'Searches' },
];

const emptySide = (): SideSetup => ({ sample: null, state: 'idle', available: [], map: { ...PAN_V1_DEFAULTS }, source: 'default' });

const DEFAULT_OPTIONS: SearchOptions = {
  searchIds: PAN_SUITE.map((s) => s.id),
  rangeIds: DEFAULT_RANGE_IDS,
  order: 'pairwise',
  repetitions: 1,
  warmup: true,
  settleLagMinutes: 5,
  timeoutMinutes: 10,
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function NewBenchmark() {
  const navigate = useNavigate();
  const { active, start } = useBenchmark();
  const [step, setStep] = useState<Step>(1);
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [a, setA] = useState<DatasetInfo | null>(null);
  const [b, setB] = useState<DatasetInfo | null>(null);
  const [sideA, setSideA] = useState<SideSetup>(emptySide);
  const [sideB, setSideB] = useState<SideSetup>(emptySide);
  const [needle, setNeedle] = useState('');
  const [needleTouched, setNeedleTouched] = useState(false);
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_OPTIONS);
  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);
  const lastSetup = useRef<{ datasetA?: string; datasetB?: string } | null>(null);
  const sampledKey = useRef('');

  const load = useCallback(async () => {
    setLoadError(null);
    setDatasets(null);
    try {
      const [raw, last] = await Promise.all([listDatasets(), loadLastSetup().catch(() => null)]);
      const list = sortDatasets(raw.map(toDatasetInfo));
      setDatasets(list);
      if (last) {
        lastSetup.current = last;
        setOptions((o) => ({
          ...o,
          searchIds: last.searchIds?.length ? last.searchIds : o.searchIds,
          rangeIds: last.rangeIds?.length ? last.rangeIds : o.rangeIds,
          order: last.order ?? o.order,
          repetitions: last.repetitions ?? o.repetitions,
          warmup: last.warmup ?? o.warmup,
          settleLagMinutes: last.settleLagMinutes ?? o.settleLagMinutes,
          timeoutMinutes: last.timeoutMinutes ?? o.timeoutMinutes,
        }));
        setA((cur) => cur ?? list.find((d) => d.id === last.datasetA) ?? null);
        setB((cur) => cur ?? list.find((d) => d.id === last.datasetB) ?? null);
      }
    } catch (err) {
      console.error('[search-perf] listing datasets failed', err);
      setLoadError(`${errText(err)}. Check that you have permission to use Cribl Search.`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (side: Side, d: DatasetInfo) => {
    if (side === 'A') {
      setA(d);
      if (a?.id !== d.id) setSideA(emptySide());
    } else {
      setB(d);
      if (b?.id !== d.id) setSideB(emptySide());
    }
  };

  const setSide = (side: Side, fn: (s: SideSetup) => SideSetup) => (side === 'A' ? setSideA(fn) : setSideB(fn));

  /** Samples one event; runs one search at a time like everything else in the app. */
  const sampleSide = useCallback(async (side: Side, d: DatasetInfo) => {
    const update = side === 'A' ? setSideA : setSideB;
    update((s) => ({ ...s, state: 'loading', error: undefined }));
    const saved = await loadFieldMap(d.id);
    try {
      const sample = await sampleEvent(d.id);
      const detected = detectFieldMap(sample);
      const map = saved ? { ...PAN_V1_DEFAULTS, ...saved } : detected.map;
      update(() => ({
        sample,
        state: sample ? 'ready' : 'empty',
        available: detected.available,
        map,
        source: saved ? 'saved' : sample ? 'detected' : 'default',
        sampledFor: d.id,
      }));
      return { sample, map };
    } catch (err) {
      console.error('[search-perf] sampling failed', d.id, err);
      update(() => ({
        ...emptySide(),
        state: 'error',
        error: `Couldn't sample ${d.id}: ${errText(err)}. You can still type field names.`,
        map: saved ? { ...PAN_V1_DEFAULTS, ...saved } : { ...PAN_V1_DEFAULTS },
        source: saved ? 'saved' : 'default',
        sampledFor: d.id,
      }));
      return { sample: null, map: null };
    }
  }, []);

  useEffect(() => {
    if (step !== 2 || !a || !b) return;
    const key = `${a.id}|${b.id}`;
    if (sampledKey.current === key) return;
    sampledKey.current = key;
    void (async () => {
      const ra = sideA.sampledFor === a.id ? { sample: sideA.sample, map: sideA.map } : await sampleSide('A', a);
      const rb = sideB.sampledFor === b.id ? { sample: sideB.sample, map: sideB.map } : await sampleSide('B', b);
      if (!needleTouched) {
        const suggestion = (ra.map && pickNeedle(ra.sample, ra.map)) || (rb.map && pickNeedle(rb.sample, rb.map)) || '';
        if (suggestion) setNeedle(suggestion);
      }
    })();
    // Only re-run when the step or chosen datasets change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, a, b]);

  const mapField = (side: Side, field: LogicalField, value: string) =>
    setSide(side, (s) => ({ ...s, map: { ...s.map, [field]: value.trim() } }));

  const runnable = useMemo(
    () => options.searchIds.filter((id) => {
      const s = PAN_SUITE.find((x) => x.id === id);
      return s && !unavailableReason(s, sideA.map, sideB.map, needle);
    }),
    [options.searchIds, sideA.map, sideB.map, needle],
  );
  const total = runnable.length * options.rangeIds.length * options.repetitions * 2;
  const sampling = sideA.state === 'loading' || sideB.state === 'loading';
  const busy = active?.status === 'running';
  const defaultName = a && b ? `${a.id} vs ${b.id}` : '';

  const canNext =
    step === 1 ? !!a && !!b && a.id !== b.id : step === 2 ? !sampling && sideA.state !== 'idle' : total > 0 && !busy && !starting;

  const begin = async () => {
    if (!a || !b) return;
    setStarting(true);
    try {
      await Promise.all([saveFieldMap(a.id, sideA.map), saveFieldMap(b.id, sideB.map)]).catch((err) =>
        console.warn('[search-perf] could not save field mapping', err),
      );
      await saveLastSetup({ ...options, searchIds: runnable, datasetA: a.id, datasetB: b.id }).catch((err) =>
        console.warn('[search-perf] could not save setup', err),
      );
      const id = await start({
        name: name.trim() || defaultName,
        datasetA: a,
        datasetB: b,
        fieldMapA: sideA.map,
        fieldMapB: sideB.map,
        searchIds: runnable,
        rangeIds: options.rangeIds,
        order: options.order,
        repetitions: options.repetitions,
        warmup: options.warmup,
        settleLagMinutes: options.settleLagMinutes,
        timeoutMinutes: options.timeoutMinutes,
        needle: needle.trim(),
      });
      Toast.success('Benchmark started');
      navigate(`/runs/${id}`);
    } catch (err) {
      console.error('[search-perf] could not start', err);
      Toast.error(`Couldn't start the benchmark: ${errText(err)}`, { duration: 0 });
      setStarting(false);
    }
  };

  const next = () => {
    if (step === 3) void begin();
    else setStep((s) => (s + 1) as Step);
  };

  return (
    <div className="spa-setup">
      <div className="spa-setup__main">
        <ol className="spa-stepper" aria-label="Setup steps">
          {STEPS.map((s) => {
            const reachable = s.n < step || (s.n === 2 && !!a && !!b) || (s.n === 3 && !!a && !!b && sideA.state !== 'idle');
            return (
              <li key={s.n} className={`spa-stepper__item${s.n === step ? ' is-current' : ''}${s.n < step ? ' is-done' : ''}`}>
                <button type="button" disabled={!reachable || s.n === step} onClick={() => setStep(s.n)} aria-current={s.n === step ? 'step' : undefined}>
                  <span className="spa-stepper__n">{s.n}</span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        {busy && (
          <Alert
            appearance="info"
            title="A benchmark is running"
            action={{ label: 'View progress', onClick: () => navigate(`/runs/${active!.id}`) }}
          >
            You can prepare the next one now and start it when the current run finishes.
          </Alert>
        )}

        {step === 1 && <DatasetStep datasets={datasets} loadError={loadError} onRetry={() => void load()} a={a} b={b} onPick={pick} />}
        {step === 2 && a && b && (
          <FieldStep
            a={a}
            b={b}
            sideA={sideA}
            sideB={sideB}
            needle={needle}
            onNeedle={(v) => {
              setNeedle(v);
              setNeedleTouched(true);
            }}
            onMap={mapField}
            onResample={(side) => void sampleSide(side, side === 'A' ? a : b)}
          />
        )}
        {step === 3 && a && b && <SearchStep a={a} mapA={sideA.map} mapB={sideB.map} needle={needle} options={options} onChange={setOptions} />}
      </div>

      <aside className="spa-summary" aria-label="Benchmark summary">
        <div className="spa-summary__lanes">
          {(['A', 'B'] as Side[]).map((side) => {
            const d = side === 'A' ? a : b;
            return (
              <div key={side} className={`spa-summary__lane ${side === 'A' ? 'spa-a' : 'spa-b'}`}>
                <SeriesKey side={side}>
                  <span className="spa-summary__ds">{d ? d.id : `Pick dataset ${side}`}</span>
                </SeriesKey>
                {d && <DatasetTags d={d} />}
              </div>
            );
          })}
        </div>

        {step === 3 && (
          <TextField label="Run name" value={name} onChange={setName} placeholder={defaultName} helperText="Shown in the list of runs" />
        )}

        {step === 3 && (
          <div className="spa-summary__count">
            <span className="spa-summary__big">{total}</span>
            <Text variant="body-sm-normal" color="subtle">
              {`searches: ${runnable.length} × ${options.rangeIds.length} ranges × 2 datasets${options.repetitions > 1 ? ` × ${options.repetitions} reps` : ''}${options.warmup ? ', plus 2 warm-ups' : ''}`}
            </Text>
          </div>
        )}

        <ul className="spa-summary__notes">
          <li>One search at a time, so the benchmark never queues behind itself.</li>
          <li>Time spent queued is recorded but not scored.</li>
          <li>Keep this tab open while it runs. You can stop and resume.</li>
        </ul>

        <div className="spa-summary__actions">
          {step > 1 && (
            <Button variant="tertiary" leadingIcon={ArrowLeft} onClick={() => setStep((s) => (s - 1) as Step)}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={next} disabled={!canNext} pending={starting} leadingIcon={step === 3 ? Play : undefined}>
            {step === 1 ? 'Continue to fields' : step === 2 ? 'Continue to searches' : 'Start benchmark'}
          </Button>
        </div>
        {step === 1 && a && b && a.id === b.id && (
          <Text variant="body-sm-normal" color="attention">
            Pick two different datasets.
          </Text>
        )}
      </aside>
    </div>
  );
}
