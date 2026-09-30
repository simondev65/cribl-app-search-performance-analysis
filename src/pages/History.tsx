import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, EmptyState, IconButton, Modal, Skeleton, Text, Toast } from '@capra/core';
import { Play, Trash } from '@capra/icons';
import { deleteRun, listRuns } from '../api/runs';
import { verdict } from '../lib/scoring';
import { formatDate, formatScore, relativeTime } from '../lib/format';
import { effectiveStatus } from '../lib/progress';
import { useBenchmark } from '../state/BenchmarkContext';
import { SeriesKey } from '../components/charts';
import { RunStatusPill } from '../components/results';
import type { RunSummary } from '../lib/types';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function History() {
  const navigate = useNavigate();
  const { active, resume } = useBenchmark();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RunSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRuns(await listRuns());
    } catch (err) {
      console.error('[search-perf] listing runs failed', err);
      setError(errText(err));
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reflect the live run's progress and its final state without a reload.
  const liveId = active?.status === 'running' ? active.id : undefined;
  useEffect(() => {
    if (active) void load();
  }, [active?.status, active?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteRun(toDelete.id);
      setRuns((rs) => rs?.filter((r) => r.id !== toDelete.id) ?? rs);
      Toast.success(`Deleted “${toDelete.name}”`);
      setToDelete(null);
    } catch (err) {
      Toast.error(`Couldn't delete: ${errText(err)}`, { duration: 0 });
    } finally {
      setDeleting(false);
    }
  };

  const onResume = async (r: RunSummary) => {
    try {
      await resume(r.id);
      navigate(`/runs/${r.id}`);
    } catch (err) {
      Toast.error(`Couldn't resume: ${errText(err)}`, { duration: 0 });
    }
  };

  if (!runs) {
    return (
      <div className="spa-page">
        <Skeleton loading active paragraph={{ rows: 6 }}>
          <span />
        </Skeleton>
      </div>
    );
  }

  return (
    <div className="spa-page">
      {error && (
        <Alert appearance="danger" title="Couldn't load saved runs" action={{ label: 'Try again', onClick: () => void load() }}>
          {error}
        </Alert>
      )}

      {!error && runs.length === 0 ? (
        <EmptyState
          size="lg"
          illustration="EmptyFolder"
          title="No benchmarks yet"
          description="Pick two datasets and the app runs the same searches on both, one at a time, then scores them side by side."
        >
          <Button variant="primary" leadingIcon={Play} onClick={() => navigate('/')}>
            New benchmark
          </Button>
        </EmptyState>
      ) : (
        runs.length > 0 && (
          <>
            <div className="spa-panel__head spa-history__head">
              <Text as="h2" variant="heading-sm">
                Saved runs
              </Text>
              <Text variant="body-sm-normal" color="subtle">
                {runs.length} run{runs.length === 1 ? '' : 's'}, newest first. Saved for everyone who uses this app in this workspace.
              </Text>
            </div>
            <div className="spa-tablewrap">
              <table className="spa-table spa-history">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Datasets</th>
                    <th scope="col">Status</th>
                    <th scope="col">Result</th>
                    <th scope="col" className="num">
                      Score A
                    </th>
                    <th scope="col" className="num">
                      Score B
                    </th>
                    <th scope="col">Started</th>
                    <th scope="col">
                      <span className="spa-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const status = effectiveStatus(r, liveId);
                    const v = verdict(r.speedup, r.datasetA, r.datasetB);
                    const canResume = (status === 'stopped' || status === 'interrupted') && r.done < r.total && !liveId;
                    return (
                      <tr key={r.id}>
                        <th scope="row">
                          <Link to={`/runs/${r.id}`} className="spa-history__name">
                            {r.name}
                          </Link>
                          {r.createdBy && <div className="spa-muted">{r.createdBy}</div>}
                        </th>
                        <td>
                          <div className="spa-history__ds">
                            <SeriesKey side="A">
                              {r.datasetA}
                              {r.labelA && <span className="spa-muted"> {r.labelA}</span>}
                            </SeriesKey>
                            <SeriesKey side="B">
                              {r.datasetB}
                              {r.labelB && <span className="spa-muted"> {r.labelB}</span>}
                            </SeriesKey>
                          </div>
                        </td>
                        <td>
                          <RunStatusPill status={status} />
                          {r.done < r.total && (
                            <div className="spa-muted">
                              {r.done} of {r.total} searches
                            </div>
                          )}
                        </td>
                        <td className={v.side === 'A' ? 'spa-win-a' : v.side === 'B' ? 'spa-win-b' : undefined}>
                          {r.speedup === null ? <span className="spa-muted">No comparable searches yet</span> : v.text}
                        </td>
                        <td className="num">{formatScore(r.compositeA)}</td>
                        <td className="num">{formatScore(r.compositeB)}</td>
                        <td>
                          <span title={formatDate(r.createdAt)}>{relativeTime(r.createdAt)}</span>
                        </td>
                        <td className="spa-history__actions">
                          {canResume && (
                            <Button size="xs" variant="secondary" leadingIcon={Play} onClick={() => void onResume(r)}>
                              Resume
                            </Button>
                          )}
                          <IconButton
                            icon={Trash}
                            aria-label={`Delete ${r.name}`}
                            size="sm"
                            variant="tertiary"
                            disabled={r.id === liveId}
                            onClick={() => setToDelete(r)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      <Modal
        isOpen={!!toDelete}
        title={toDelete ? `Delete “${toDelete.name}”?` : 'Delete run?'}
        onClose={() => setToDelete(null)}
        footer={
          <Modal.FooterActions>
            <Button variant="tertiary" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button appearance="danger" onClick={() => void onDelete()} pending={deleting}>
              Delete run
            </Button>
          </Modal.FooterActions>
        }
      >
        <Text as="p" variant="body-md-normal">
          {toDelete
            ? `The scores and statistics for ${toDelete.datasetA} vs ${toDelete.datasetB} are removed for everyone. This can't be undone.`
            : ''}
        </Text>
      </Modal>
    </div>
  );
}
