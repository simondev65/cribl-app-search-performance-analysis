import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BenchmarkRunner, prepareResume } from '../engine/runner';
import { anchorFor, buildPlan } from '../engine/plan';
import { loadRun, saveRun } from '../api/runs';
import type { Run, RunConfig } from '../lib/types';

interface BenchmarkContextValue {
  /** The run currently executing in this browser tab, if any. */
  active: Run | null;
  /** Display name of the signed-in user (stamped on new runs). */
  user: string;
  start: (config: RunConfig) => Promise<string>;
  resume: (runId: string) => Promise<void>;
  stop: () => void;
}

const BenchmarkContext = createContext<BenchmarkContextValue | null>(null);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A deep copy so React sees a new object each time the runner mutates the run in place. */
const snapshot = (run: Run): Run => structuredClone(run);

export function BenchmarkProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Run | null>(null);
  const [user, setUser] = useState('');
  const runnerRef = useRef<BenchmarkRunner | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Who ran a benchmark is a nicety: never let a missing or odd user API break the app.
    Promise.resolve()
      .then(() => window.getCriblUser?.())
      .then((u) => {
        if (cancelled || !u) return;
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
        setUser(full || u.username || u.email || '');
      })
      .catch((err) => console.warn('[search-perf] could not load user', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Leaving the page mid-run would orphan a search job: warn first, and cancel it if they leave anyway.
  useEffect(() => {
    if (!active || active.status !== 'running') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const leave = () => runnerRef.current?.cancelActive();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', leave);
    };
  }, [active]);

  const execute = useCallback(async (run: Run) => {
    const runner = new BenchmarkRunner(run, {
      onUpdate: (r) => setActive(snapshot(r)),
      onCheckpoint: (r) => saveRun(r),
    });
    runnerRef.current = runner;
    try {
      await runner.start();
    } finally {
      runnerRef.current = null;
      setActive(snapshot(runner.current));
    }
  }, []);

  const start = useCallback(
    async (config: RunConfig) => {
      if (runnerRef.current) throw new Error('A benchmark is already running. Stop it before starting another.');
      const now = Date.now();
      const anchorLatest = anchorFor(now, config.settleLagMinutes);
      const run: Run = {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        createdBy: user,
        status: 'running',
        config,
        anchorLatest,
        plan: buildPlan(config, anchorLatest),
      };
      await saveRun(run);
      setActive(snapshot(run));
      void execute(run);
      return run.id;
    },
    [execute, user],
  );

  const resume = useCallback(
    async (runId: string) => {
      if (runnerRef.current) throw new Error('A benchmark is already running. Stop it before resuming another.');
      const run = await loadRun(runId);
      if (!run) throw new Error('This run no longer exists.');
      await prepareResume(run);
      setActive(snapshot(run));
      void execute(run);
    },
    [execute],
  );

  const stop = useCallback(() => runnerRef.current?.stop(), []);

  const value = useMemo(() => ({ active, user, start, resume, stop }), [active, user, start, resume, stop]);
  return <BenchmarkContext.Provider value={value}>{children}</BenchmarkContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBenchmark(): BenchmarkContextValue {
  const ctx = useContext(BenchmarkContext);
  if (!ctx) throw new Error('useBenchmark must be used inside BenchmarkProvider');
  return ctx;
}

/** True when this run is the one executing in this tab right now. */
export function isLive(active: Run | null, runId: string | undefined): boolean {
  return !!active && active.id === runId && active.status === 'running';
}
