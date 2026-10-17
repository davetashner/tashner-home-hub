# Morning report

`.github/workflows/morning-report.yml` posts one GitHub issue a day, "Morning report
YYYY-MM-DD" (label `morning-report`, created if missing), at 12:00 UTC, after the 07:00
nightly and the 09:00 smoke. It also runs on `workflow_dispatch`. Yesterday's report is closed.

Sections: **Needs you** (open PRs labelled `needs-human`, with merge state and failing
checks), **Merged** (last 24 h, with bead IDs), **Open and blocked**, **Overnight runs**
(latest `tower.yml` and `tower-nightly.yml`; soak/mutation numbers when the nightly uploads a
JSON artifact named `*soak*` / `*mutation*` with `mutationScore` or `heapGrowthPct`), and
**Flakes** (CI jobs that failed, then passed on rerun of the same SHA). Pi fps and AI design
notes are placeholders until hub-ugl.7 / hub-ugl.10.

Runs on `ubuntu-latest`: it only calls the GitHub API. `GITHUB_TOKEN` only, with
`contents: read`, `issues: write`, `actions: read`, `pull-requests: read`.

Code: `scripts/morning-report.mjs` (I/O) and `src/lib/ci/morning-report.ts` (pure, unit-tested).
Preview without writing anything:

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/morning-report.mjs --dry-run
```
