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

## Adding a nightly job

1. Add a job to `.github/workflows/tower.yml` (keep it in that file so the triggers
   stay in one place), copying the `if:`, `runs-on` and `timeout-minutes` of `smoke`.
2. Check out, set up pnpm and Node, and install in the job itself; nothing carries over.
3. Use `permissions: contents: read` unless the job needs more, and grant extra scopes
   at job level only.
4. Workflow changes are in a protected path: the PR needs a human `human-approved` label.
   The workflow cannot be tested from a PR branch; trigger it with `workflow_dispatch`
   after merging.
