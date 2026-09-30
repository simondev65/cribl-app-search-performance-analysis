# App Brief — Search Performance Analysis

## Overview
A Cribl App (React 19 + Capra design system) that benchmarks Cribl Search performance on two
user-selected datasets — the reference case is Palo Alto traffic stored as raw/v1 versus
Parquet/v2 — by running a suite of searches over several time ranges, one at a time, and
comparing the execution statistics.

## Architecture
- `src/api/cribl.ts` — fetch helpers with timeouts + bounded retry/backoff; Search API calls
  (datasets, create job, status, job, metrics, first results page, cancel). All search calls
  use `/m/default_search/search/...`.
- `src/api/kvstore.ts` — KV get/set/delete/list. Values are always JSON strings.
- `src/lib/` — pure logic, unit tested with `node --test`:
  - `types.ts` — shared types.
  - `suite.ts` — built-in Palo Alto search templates, time ranges, template rendering.
  - `fields.ts` — logical field catalogue, auto-detection from a sample event, KQL quoting.
  - `scoring.ts` — pairing, medians, speed-up ratios, geometric means, scores, verdict.
  - `format.ts` — duration / bytes / number / date formatting.
  - `datasets.ts` — dataset descriptor normalisation (type, search version, format).
- `src/engine/runner.ts` — sequential runner: builds the plan, runs each job to a terminal
  state, collects stats, checkpoints after every search, supports stop + resume.
- `src/state/BenchmarkContext.tsx` — app-level context that owns the active runner so
  in-app navigation never interrupts a run.
- Pages: `NewBenchmark` (3-step setup), `RunPage` (live progress + results), `History`.
- Charts are hand-written SVG (no chart dependency).

## Statistics captured per search
| Stat | Source |
|---|---|
| Execution time (scored) | `timeCompleted − timeStarted` from job status |
| Queue time (shown, never scored) | `timeStarted − timeCreated` |
| Time to first byte | metrics `timeToFirstByte` |
| Launch latency | metrics `launch.totalMs` |
| Bytes / events scanned | metrics `totalMetrics.bytesIn / eventsIn` (fallback: status) |
| Bytes / events skipped | status `bytesSkipped / eventsSkipped` |
| Objects searched | metrics `totalMetrics.objectsSearched` (fallback: status) |
| Results | results page `totalEventCount` |
| CPU seconds | metrics `cpuMetrics.totalCPUSeconds` |
| Executors | metrics `executorCountMetrics.executorsAllocatedCount` |
| Compute type / cache | status `cacheStatusesByStageId.root[dataset]` |

## Fairness rules
- Only one search job at a time; the next starts after the previous reaches a terminal state.
- A run anchors `latest` to run start, floored to the minute, minus a settle lag (default
  5 min) so late-arriving data does not favour whichever dataset runs second. Both datasets
  get identical absolute `earliest`/`latest` epochs for a given time range.
- Order: *pairwise* (A then B for each search, alternating who goes first) — default — or
  *dataset by dataset* (all of A, then all of B).
- Optional warm-up search per dataset (not scored). Repetitions 1–5; the median is used.
- Per-search timeout (default 10 min) cancels the job and records a timeout.

## Scoring
- Per pair: ratio = execA / execB; a side wins when it is ≥ 10 % faster, otherwise tie.
- Per metric score (0–100) per dataset = mean over pairs of `best / own`.
- Composite = 60 % execution time + 25 % CPU seconds + 15 % bytes scanned (missing metrics
  are dropped and the weights re-normalised).
- Headline = geometric mean speed-up across all pairs, plus wins/ties/losses.
- Failed or timed-out searches are listed and excluded from ratios.
- Result-parity check flags pairs whose result counts differ by more than 1 %.

## Persistence (KV)
- `runs/index` — array of run summaries.
- `runs/data/<runId>` — full run (config, plan, results, scores).
- `fieldmaps/<datasetId>` — last field mapping for a dataset.
- `settings/last-setup` — last datasets, searches, ranges and options.

## UX
- Top navigation: *New benchmark*, *Runs* (with count), plus a live "running" indicator.
- Setup is a 3-step flow (datasets → fields → searches) with a summary panel showing the number
  of searches and an estimated duration before starting.
- Run page: progress, ETA, the query currently running, a Stop button, live comparison rows.
- Results: verdict, two-lane timing bars, score tiles, search × time range heatmap, scaling
  chart per search, full statistics table with job ids, JSON export.
- Dataset A is always blue and Dataset B always orange, in every chart and tag.
- Destructive actions (delete run) require a confirmation naming the run.

## Permissions (`config/policies.yml`)
GET `/m/default_search/search/datasets`; GET/POST `/m/default_search/search/jobs`;
GET/POST/PATCH `/m/default_search/search/jobs/*` (status, metrics, results, cancel).
