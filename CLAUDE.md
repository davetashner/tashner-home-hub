# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Repository Profile: Team-Maintainer (opted in)

This repository **opts in to the team-maintainer profile**. Agents working a bead may commit, push their branch, open PRs, and close beads when their PR merges. Explicit user or orchestrator instructions still win.

- **Only the lead session merges PRs** and republishes the beads export. Worker agents open PRs and stop.
- Never push to `main` directly. Every change goes through a PR from a worktree branch:
  `git worktree add .claude/worktrees/<branch> -b <branch> origin/main`
- Sign off every commit (`git commit -s`). Include the bead ID in the subject: `feat: star ledger [hub-sps.2]`.
- The PR body must contain one `Closes hub-xxx` line per bead completed.
- One bead per PR. Keep diffs small (CI fails above ~800 changed lines, excluding lockfiles, baselines and Drizzle snapshot JSON).

## Build & Test

Package manager: **pnpm**. Node: current LTS (see `.nvmrc`).

```bash
pnpm install          # install dependencies
pnpm dev              # dev server
pnpm check            # svelte-check + tsc (strict)
pnpm lint             # eslint + prettier --check
pnpm test             # vitest (unit) with coverage thresholds
pnpm test:e2e         # playwright
pnpm gates            # everything CI runs in Tier 1, locally
pnpm build            # production build
```

**Colliding Drizzle migration number:** on the feature branch run `node scripts/db/rebase-migration.mjs` (rebases onto origin/main, regenerates the branch's migration with the next free number and the same name, fixes the journal `when` and the db.spec table count, and prints any hand edits to the old SQL to re-apply; it never pushes). Its tests: `node --test scripts/db/`.

Run `pnpm gates` before opening a PR. A red CI is never merged.

**Parallel e2e:** each checkout can run `pnpm test:e2e` side by side: set `E2E_PORT` to a free port (e.g. `E2E_PORT=4231 pnpm test:e2e`). The default is 4173. Playwright never reuses a running server, so a stale one on your port fails fast instead of testing someone else's build.

**Worktree quirk:** worktrees live inside the main checkout, and Vite looks up parent folders for a `tsconfig.json`. If `pnpm test` fails with "Tsconfig not found", the main checkout's dependencies are stale: the lead runs `pnpm install && pnpm exec svelte-kit sync` in the main checkout after each merge. Workers: report it instead of editing the main checkout.


## Architecture Overview

- **Decisions:** `docs/decisions/` — ADR 0001 (tech stack) and ADR 0002 (CI quality gates) are binding. Read them before starting work.
- **Requirements:** `requirements.md`. Requirement IDs (e.g. CHO-4, SLP-2) appear in bead descriptions.
- **Stack:** SvelteKit 3 / Svelte 5 + TypeScript (strict), Tailwind CSS v4 with design tokens, Node LTS (`adapter-node`), SQLite + Drizzle, SSE for live updates, service worker + IndexedDB for offline.
- **Topology:** one server container (Unraid now, Mac Studio from December 2026) → a Raspberry Pi 5 kiosk (Chromium) drives a 24" 4K touch display. A small Python display agent on the Pi handles screen power and touch-to-wake.

## Conventions & Patterns

### Non-negotiable (CI enforces most of these — see ADR 0002)

- **Public repo:** never commit secrets or private family data — no real names, photos, calendars, addresses, emails, phone numbers, or EXIF location data. Fixtures are synthetic. Real data lives only in the runtime data volume.
- **Don't move the goalposts:** never loosen thresholds, delete or skip tests, update visual baselines, or edit protected files to get CI green. Protected: `.github/`, `scripts/ci/`, `budgets.json`, lint/format/test/build configs, `pnpm-workspace.yaml`, `.npmrc`, the `scripts` section of `package.json`, and `docs/decisions/` (full list: `scripts/ci/protected-paths.mjs`). Those changes need a human (`needs-human` / `visual-approved` labels). If a gate seems wrong, open a bead explaining why and stop.
- **Responsiveness:** every tap updates the UI first (optimistic), then syncs. Never block a tap on the network.
- **Animation:** animate only `transform`, `opacity`, and `filter`.
- **Design tokens only:** no raw hex colors, arbitrary Tailwind values, or ad-hoc font sizes. Add a token if one is missing.
- **Touch:** tap targets ≥ 60 px (≥ 96 px on kid screens). No hover-only interactions.
- **Both orientations:** every screen must work in landscape and portrait (UI-8).
- **Domain logic** (star ledger, chore scheduling, recurrence, sync merge) lives in plain TypeScript modules under `src/lib/server/domain/` or `src/lib/domain/` with ≥ 90% coverage. The star balance is always computed from the ledger.

### Code conventions

- Import app modules through the `#lib` alias **with a `.js` extension**: `import { formatClock } from '#lib/domain/clock.js';`
- Server-only code lives in `src/lib/server/`. The container serves `/healthz`; keep it cheap.
- Colors, type sizes, radii, and tap sizes come from the `@theme` tokens in `src/routes/layout.css`. Tailwind's default palette is disabled on purpose.
- E2E tests live in `tests/e2e/*.e2e.ts` and run in landscape and portrait wall viewports.
- **Mutations use JSON `fetch` to `src/routes/api/**`, never SvelteKit form actions.** adapter-node 6 has no runtime `ORIGIN` setting and assumes `https`, so form POSTs over the plain-http LAN fail SvelteKit's CSRF check. JSON requests are safe here: browsers block cross-origin JSON POSTs (no CORS headers are ever sent), access is LAN-only, and session cookies are `SameSite=Strict`. Never disable `csrf.checkOrigin`.
- Adult-only API routes call `requireAdult(event)` from `src/lib/server/auth.ts`; create chores through `createChore` (`src/lib/server/domain/chores.ts`) so approval follows the household setting (`chores.approval`, default off: kids self-serve).

### PR labels (humans only)

| Label | Meaning |
|---|---|
| `human-approved` | A human reviewed changes to protected files or test removals (`scripts/ci/protected-paths.mjs`). |
| `visual-approved` | A human approved visual baseline changes. |
| `large-pr` | A human allowed a PR over the size limit. |
| `needs-human` | Blocks auto-merge; a human must look. Agents should add this when unsure. |

Agents must **never** add `human-approved`, `visual-approved`, or `large-pr`.

### Kill switch

If the repository variable `AGENTS_PAUSED` is `true`, do not start new work. Report and stop.
