# App Definition — Search Performance Analysis

## App ID
search-performance-analysis

## Display Name
Search Performance Analysis

## Problem
Teams moving firewall data between storage layouts (for example Palo Alto traffic stored as
raw JSON with a v1 datatype versus the same traffic stored as Parquet with a v2 datatype) have
no repeatable way to prove which layout searches faster in Cribl Search. Running searches by
hand is slow, results are not comparable (different time windows, queue time mixed into
duration) and nothing is kept for later.

## Users
- Cribl Solution Engineers running a proof of value on a customer org.
- Customer Cribl admins / search power users evaluating dataset layout choices.

The app is installed on customer orgs: nothing may be hard coded to a specific org, dataset
or field name.

## Key Workflows
1. **Pick two datasets** — choose Dataset A and Dataset B from the org's own Cribl Search
   datasets (federated: Lake, S3, Lakehouse …). The picker shows each dataset's type,
   search version (v1/v2) and storage format (JSON / Parquet) so the user can tell them apart.
2. **Map fields** — the app samples one event from each dataset and auto-detects the Palo
   Alto traffic fields (source IP, destination IP, destination port, action, application,
   bytes, rule). The user can correct any mapping. Mappings are remembered per dataset.
3. **Choose the benchmark** — pick which searches to run (count, raw retrieval, keyword,
   field filter, projection, timestats, summarize, dcount, percentiles, top) and which time
   ranges (1h, 4h, 1d, 2d by default; 15m, 12h, 7d optional), the run order, repetitions and
   a warm-up option.
4. **Run** — searches run strictly one at a time against `default_search`. Each (search,
   time range) pair uses the exact same absolute time window on both datasets. Live progress,
   ETA, the current query and a live comparison table are shown. The run can be stopped and
   resumed later.
5. **Compare** — per-search statistics (execution time excluding queue time, queue time,
   time to first byte, bytes scanned, events scanned, results, objects searched, CPU seconds,
   executors) are shown side by side with speed-up ratios, a verdict, scores, a heatmap and a
   scaling chart.
6. **History** — every run, with its searches and scores, is saved and can be reopened,
   renamed or deleted (with confirmation).

## Data Requirements
- Cribl Search datasets list: `GET /m/default_search/search/datasets`
- Search jobs: create, status, job record, metrics, results (first page only), cancel.
- Persistence: app-scoped KV store only (runs, run index, field maps, last setup).

## Scope
In scope: Palo Alto traffic search suite, two-dataset comparison, sequential execution,
scoring, saved history.
Out of scope (for now): other data sources' suites, more than two datasets, scheduled runs,
exporting to other tools (JSON export of a run is provided).

## Success Criteria
- A user can go from opening the app to a running benchmark in under a minute.
- Queue time never influences the score.
- Results survive a reload and can be revisited.
