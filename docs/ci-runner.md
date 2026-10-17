# Self-hosted CI runner ("tower")

Tier 3 and nightly work (soak, mutation, multi-arch build, morning report, Pi
hardware-in-the-loop) runs on a self-hosted GitHub Actions runner on the Unraid
server. PR gates stay on GitHub-hosted runners (see ADR 0002, "Where it runs").

- **Runner:** `tower-tashner-home-hub-01`, labels `self-hosted, Linux, X64, tower, tashner-home-hub`.
- **Workflow:** `.github/workflows/tower.yml` (a smoke test: install, `pnpm check`, `pnpm test`, runner info).
- **Ephemeral:** the runner takes one job, exits, and its container restarts and
  re-registers. Never rely on state from an earlier job. Only these mounts persist:
  `/opt/hostedtoolcache` (shared with another repo's runner) and `/home/runner/.cache`
  (this repo's own).
- **Environment:** a Docker container on the `towerci` network. Assume no Docker
  socket and no access to the app containers; do not plan on driving Docker from it.

## Never on pull requests

The repo is public. A self-hosted runner that runs on `pull_request` or
`pull_request_target` lets anyone run code on the server. The runner may only run on
`schedule`, `workflow_dispatch` and `push` to `main`. Each tower job also carries an
`if:` that refuses any other event and any other repository, and
`scripts/ci/self-hosted-guard.mjs` (run in the `repo-gates` job) fails CI if a workflow
that targets a self-hosted runner references `pull_request`, `pull_request_target` or
`workflow_run`, even in an `if:` expression.

## What runs nightly

`.github/workflows/tower-nightly.yml` runs at 07:00 UTC (before the 09:00 smoke) and on
`workflow_dispatch`, never on a PR event. It has its own concurrency group (`tower-nightly`), so it
never cancels or queues behind the push-to-main smoke runs. Two jobs, one after the other (there is
one runner); a failure in one does not skip the other.

- **tower-soak** builds the app and runs `scripts/soak/soak.mjs`: it starts `node build` with a
  throwaway data dir under `/tmp`, then loops the home, calendar, chores and photo-slideshow
  endpoints at the 2560x1440 wall viewport and taps a new chore each loop, for 25 minutes. A
  preload (`scripts/soak/probe.mjs`) samples RSS, heap and event-loop delay every 30 s.
  It fails when RSS grows more than 25% (heap 50%) between the first and last 3 samples after a
  5-minute warm-up, event-loop p99 exceeds 200 ms, the server exits, or any page or request
  errors (HTTP 5xx, uncaught page exceptions, navigation timeouts). Limits live in
  `scripts/soak/analyze.mjs` and are unit tested. Set `SOAK_SSE_PATH` to hold a Server-Sent
  Events stream open; the app has none yet, so the report says it was skipped.
  Quick check: run the workflow by hand with `soak_minutes` = 2, or locally after `pnpm build`:
  `SOAK_SAMPLE_MS=5000 node scripts/soak/soak.mjs --minutes 2`.
- **tower-mutation** runs Stryker (`stryker.config.mjs`) over `src/lib/domain/**` and
  `src/lib/server/domain/**`, incrementally: the cache is `/home/runner/.cache/stryker/incremental.json`,
  so only mutants touched by changes are retested. **Advisory:** it never fails on the score.

Reading the results: open the run's job summary (soak numbers; mutation score and the ten weakest
files). Artifacts, kept 14 days: `soak-report` (`soak-report.json` with the full sample series,
`soak-summary.md`; flat keys `rssGrowthPct`, `heapGrowthPct`, `sseReconnects` feed the morning report) and `mutation-report` (`index.html` per-mutant detail, `mutation.json`,
`score.json`, key `mutationScore`). A survived mutant means no test noticed that line changing; the HTML report shows which.

Multi-arch image builds are not here: the runner has no Docker socket. See hub-ugl.13 (GHCR publish).

## Adding a nightly job

1. Add a job to `.github/workflows/tower-nightly.yml` (long jobs; schedule and dispatch only)
   or `tower.yml` (quick smoke, also on push to main), copying the `if:`, `runs-on` and `timeout-minutes` of `smoke`.
2. Check out, set up pnpm and Node, and install in the job itself; nothing carries over.
3. Use `permissions: contents: read` unless the job needs more, and grant extra scopes
   at job level only.
4. Workflow changes are in a protected path: the PR needs a human `human-approved` label.
   The workflow cannot be tested from a PR branch; trigger it with `workflow_dispatch`
   after merging.
