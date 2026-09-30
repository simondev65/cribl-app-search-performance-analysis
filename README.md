# Search Performance Analysis

Benchmark Cribl Search on two datasets side by side: run the same searches over the same time windows, one at a time, and compare execution time, CPU and data scanned.

## Summary

Search Performance Analysis is a Cribl app for comparing how fast Cribl Search answers the same questions on two datasets. It helps users:

- measure the difference between two storage layouts, such as Palo Alto traffic stored as raw JSON (datatype v1) or as Parquet (v2);
- score that difference fairly, excluding queue time;
- keep a history of runs to share or revisit.

## What This App Does

* Primary purpose: a repeatable, fair performance comparison between two Cribl Search datasets.
* Key capabilities:
  * Pick any two datasets in your organization. Nothing is tied to a specific org, dataset or field name.
  * Sample one event per dataset and map its fields automatically. Mappings can be edited and are remembered per dataset.
  * Run a suite of 12 searches over the time ranges you choose, strictly one at a time:
    * counts and raw retrieval
    * keyword and field filters
    * projection
    * `timestats`
    * top-N aggregations
    * distinct counts
    * percentiles
  * See live progress, then read a verdict, per-metric scores, a speedup heatmap, a scaling chart and a full statistics table with job IDs.
  * Every run is saved. Reopen, resume, rename, export to JSON or delete it.
* Intended users:
  * Solution engineers, Search admins and platform owners who are choosing a dataset layout
* Works with:
  * Cribl Search (federated datasets: Cribl Lake, Amazon S3, Lakehouse and others)

## When To Use This App

* Deciding between a raw (v1) and a Parquet (v2) layout for the same data.
* Checking the effect of partitioning, a datatype change or a Lakehouse dataset before and after.
* Producing evidence for a performance claim during a proof of value.

## Before You Install

* Required Cribl product or deployment type: Cribl.Cloud, or a deployment with Cribl Search and a `default_search` group.
* Required permissions or roles: permission to list Search datasets and to run searches.
* Required external systems or APIs: none.
* Required configuration values: none at install time. You choose the datasets inside the app.
* Known limits or prerequisites:
  * Every benchmark search counts toward normal Search usage. The default run is 96 searches: 12 searches × 4 time ranges × 2 datasets.
  * Keep the browser tab open while a run is in progress.

## Installation

### Install From the Cribl Marketplace (recommended)
1. In Cribl, go to **Apps > View All** and open the **Marketplace**.
2. Search for **Search Performance Analysis** and select it.
3. Review the requested permissions (see [Permissions](#permissions)) and select **Install**.
4. Share the app with the users who will run benchmarks.

### Install From Git
1. Log in to Cribl and go to **Apps > View All**.
2. Select **Add App > Import from Git**.
3. Paste the repository URL `https://github.com/simondev65/cribl-app-search-performance-analysis.git` and enter `latest` as the tag (or a version tag such as `v1.0.1`).
4. Select **Import**, review the app details and complete installation.

### Install From a Release Package
1. Download the `.tgz` app package for the version you want from the [GitHub releases](https://github.com/simondev65/cribl-app-search-performance-analysis/releases).
2. In Cribl, go to Apps and choose import from file.
3. Upload the `.tgz` file.
4. Review the app details and complete installation.

## Configuration

There is nothing to configure at install time. Each benchmark is set up in the app:

| Setting | Required | Description | Example | Scope |
|---|---|---|---|---|
| Dataset A / Dataset B | Yes | The two Search datasets to compare | `pan_traffic_raw`, `pan_traffic_parquet` | per-run |
| Field mapping | Yes (auto-detected) | Which field holds source IP, destination IP, port, action, application, bytes and rule | `source_ip`, `src_ip`, `source.ip` | per-dataset, shared |
| Searches and time ranges | Yes | Which searches to run, over which windows | 12 searches × 1h, 4h, 1d, 2d | per-run |
| Order | No | Alternate A/B per search (default), or run all of A and then all of B | Alternate | per-run |
| Repetitions | No | Run each search 1–5 times and keep the median | 1 | per-run |
| Warm-up | No | Run one small search per dataset first, unscored | On | per-run |
| Settle lag | No | How far in the past the windows end, so late-arriving data does not skew results | 5 minutes | per-run |
| Per-search timeout | No | Execution time after which a search is stopped and marked as timed out | 10 minutes | per-run |

## How To Use

### Typical Workflow
1. Open the app and choose **New benchmark**.
2. **Datasets.** Pick dataset A and dataset B. Datasets that look like Palo Alto traffic are listed first, with their type, version and format.
3. **Fields.** Check the detected field mapping for each dataset and correct anything the app got wrong.
4. **Searches.** Choose searches and time ranges, review the estimate, and select **Start benchmark**.
5. Watch the run, then read the results. Past runs are listed under **Runs**.

### First-Run Checklist
* Make sure both datasets contain data for the longest time range you select.
* If both datasets hold the same traffic, the result-count check should show no mismatches. If it shows many, the comparison is not like-for-like.
* Start with one repetition. Add repetitions once you know how long a run takes.

## Scoring

- **Execution time.** Measured from job start to job completion. Queue time is shown for reference only and is never scored.
- **Fair windows.**
  - Both datasets are searched over the identical absolute time window.
  - Each pair of searches alternates which dataset runs first.
  - Only one search runs at a time.
- **Pair winners.** A dataset wins a pair when it is at least 10% faster; anything closer is a tie.
- **Headline speedup.** The geometric mean of the per-pair time ratios.
- **Score out of 100.** For each metric, the faster dataset scores 100 and the other scores in proportion. Execution time counts for 60%, CPU seconds for 25% and bytes scanned for 15%.
- **Result check.** Pairs whose result counts differ by more than 1% are flagged.

## Permissions

The app declares only the Search endpoints below in `config/policies.yml`, with the minimum methods each call needs. It needs to list datasets, run searches and read their statistics. If dataset listing is denied, the app shows the error on the dataset step. If a single search fails, it is marked as failed and the run continues.

### Cribl API Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/m/default_search/search/datasets` | List datasets to choose from |
| POST | `/api/v1/m/default_search/search/jobs` | Start each benchmark search, and the one-event field sample |
| GET | `/api/v1/m/default_search/search/jobs/{id}` | Read the error detail of a failed search |
| GET | `/api/v1/m/default_search/search/jobs/{id}/status` | Poll status and read start/finish times, bytes and events |
| GET | `/api/v1/m/default_search/search/jobs/{id}/metrics` | Read CPU seconds, executors, time to first byte |
| GET | `/api/v1/m/default_search/search/jobs/{id}/results` | Read the result count (and the sample event) |
| POST | `/api/v1/m/default_search/search/jobs/{id}/cancel` | Stop a search when you press Stop or it times out |

## External API Access

### Default Configuration
* `config/policies.yml` — declares the Search endpoints listed above.
* `config/proxies.yml` — unused. The app makes no external calls.

### External Endpoints
* None. The app makes no calls outside your Cribl environment.

## Data And Storage

Runs and settings are stored in the app's key-value store and are visible to every user of the app in this organization:

* `runs/index` — a summary list of runs
* `runs/data/<runId>` — one complete run: its configuration, every search and its statistics
* `fieldmaps/<datasetId>` — the last field mapping confirmed for a dataset
* `settings/last-setup` — the last searches, ranges and options used, as defaults for the next run

Nothing is written to your datasets. Deleting a run removes it permanently.

## Security

* **Authentication and authorization.** The app never sees credentials. Cribl's app proxy adds the signed-in user's session to every API call, and each call is limited to the permissions declared in `config/policies.yml` and the user's own Cribl role.
* **Minimum permissions.** Read access to the Search dataset list, starting search jobs, reading a job's status, metrics and results, and cancelling a job. The app cannot change datasets, Search configuration or any other product configuration.
* **Secrets.** The app stores no secrets, tokens or credentials.
* **External hosts.** None. `config/proxies.yml` declares no domains, so the platform blocks any outbound call.
* **Customer data.** Search results are only counted, never exported or sent anywhere. The one sampled event per dataset is used in the browser to suggest field names, and only the chosen field names are saved.
* **Known vulnerabilities.** None known. Dependencies are checked with `npm audit` before each release.
* **Reporting a vulnerability.** Use [GitHub private vulnerability reporting](https://github.com/simondev65/cribl-app-search-performance-analysis/security/advisories/new). Please do not open a public issue for security problems.

## Support

* **Maintainer:** Simon Duchene.
* **Bugs and feature requests:** [GitHub Issues](https://github.com/simondev65/cribl-app-search-performance-analysis/issues).
* **Security issues:** see [Security](#security).
* Critical security fixes are delivered within 10 days and high-severity fixes within 4 weeks, per the Cribl Marketplace remediation SLAs.

## Known Limitations

* Searches run in the browser tab. Closing the tab stops the run; resume it from **Runs**.
* The built-in searches are written for firewall traffic (Palo Alto and similar). Other data can be benchmarked, but only after its fields are mapped.
* Timings include normal platform variance. Use repetitions for decisions that matter.
* The app targets the `default_search` group.

## Troubleshooting

### The App Opens But Some Features Do Not Work
Possible causes:
* Missing permission to list datasets or run searches.
* A dataset with no data in the selected time ranges: its searches complete with zero results.
* Field mapping pointing at a field that does not exist: those searches return empty results or fail.

### A Run Shows As Interrupted
The browser tab was closed or reloaded while the run was in progress. Open the run from **Runs** and select **Resume**. Completed searches are kept.

### Many Result-Count Mismatches
The two datasets do not hold the same events for the window, or a field is mapped differently. Check the field mapping and the data coverage of both datasets.

## Development

```bash
npm install
npm run dev      # then open the app in Cribl preview
npm test         # unit tests for scoring, planning, query rendering and field detection
npm run lint
npm run package  # builds build/*.tgz
```

## Project Layout

```text
src/
  api/          Cribl Search and KV store clients, run persistence
  engine/       plan builder and the sequential benchmark runner
  lib/          search suite, field detection, scoring, formatting
  state/        run state shared across pages
  pages/        New benchmark, Run, Runs
  components/   charts and shared UI
config/
  policies.yml
tests/
```

## Versioning And Releases

* Semantic versioning. Release notes and packages are on [GitHub releases](https://github.com/simondev65/cribl-app-search-performance-analysis/releases).
* Upgrades keep all saved runs, field mappings and settings.
* Run data is versioned with the app; older runs remain readable.

## License

This app is licensed under the [Apache License 2.0](./LICENSE).

## App Metadata

| Field | Value |
|---|---|
| App Name | Search Performance Analysis |
| App ID | search-performance-analysis |
| Version | 1.0.2 |
| Author | simon duchene |
| Support Model | community |
| Support Label | Community Supported |
| Support Contact | [GitHub Issues](https://github.com/simondev65/cribl-app-search-performance-analysis/issues) |
| License | Apache-2.0 |
| License File | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| Product Tags | search |
| Category | Performance |
| Audience | admin, platform-owner |
| Availability | general |
| Requires External Access | no |
| Repository | https://github.com/simondev65/cribl-app-search-performance-analysis |
| Documentation | https://github.com/simondev65/cribl-app-search-performance-analysis#readme |
| README Schema Version | 1.0 |
