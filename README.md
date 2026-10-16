# Tashner Home Hub

A self-hosted, wall-mounted touchscreen hub for the family: a shared calendar, a photo frame, chores that kids want to do, and household lists. It replaces commercial smart displays (Skylight, Cozyla, Hearth and similar) **without a subscription**, and the family's data stays on our own hardware.

> **Status:** in active development toward the MVP (v0.1). See [requirements.md §8](requirements.md#8-release-phases) for the release phases.

## Goals

- **No subscription.** Every feature works with no recurring fees, using only free tiers of services we already have (Google, iCloud).
- **One glanceable schedule** merged from Google Calendar, iCloud Calendar and read-only ICS feeds.
- **A photo frame** that takes over when the calendar is idle.
- **Chores a child wants to do:** tapping "Done" is rewarding, earns gold stars, and stars build toward a reward a parent approves.
- **Respect the household at night:** scheduled sleep, a Sleep-now button, and touch to wake.
- **Self-hosted and private:** LAN-only by default, no telemetry, credentials encrypted at rest.

Out of scope for v1: public internet exposure, native mobile apps (the web UI works on phones), voice assistants, video calling, and paid AI features. The full list of requirements, with IDs such as `CAL-1` and `CHO-4`, is in [requirements.md](requirements.md).

## How it fits together

```
 Google / iCloud / ICS ──▶  Hub server (one Docker container)  ──LAN──▶  Raspberry Pi 5 kiosk
                            SvelteKit + SQLite, nightly backups           Chromium, full screen
                            Unraid now, Mac Studio from Dec 2026          24" 4K touch display
                                     ▲
                                     └──── phones and laptops (admin web UI, PIN-protected)
```

- **Server:** SvelteKit 3 / Svelte 5 and TypeScript (strict) on Node 24 with `adapter-node`, SQLite through Drizzle, and Server-Sent Events for live updates. All state lives in one data folder, so moving hosts means copying that folder.
- **Wall display:** a Raspberry Pi 5 runs Chromium in kiosk mode. A service worker and IndexedDB keep the screen working, and queue chore taps, while the server is unreachable.
- **Styling:** Tailwind CSS v4 restricted to the design tokens in `src/routes/layout.css`. Tailwind's default palette is turned off on purpose.

The binding decisions are in [ADR 0001 (tech stack)](docs/decisions/0001-tech-stack.md) and [ADR 0002 (CI quality gates)](docs/decisions/0002-ci-quality-gates.md).

## Local development

### Prerequisites

- **Node 24** (see `.nvmrc`), for example `nvm use`.
- **pnpm 12** through Corepack: `corepack enable`.
- **Playwright Chromium** for the end-to-end and component tests: `pnpm exec playwright install chromium`.

### Run it

```sh
pnpm install
pnpm dev            # http://localhost:5173
```

On first run the app sends you to `/setup` to create the first adult profile and PIN. Data goes to `./data` (git-ignored). Delete that folder to start over.

To connect real calendars, copy `.env.example` to `.env` (also git-ignored) and follow the setup guides for [Google Calendar](docs/setup/google-calendar.md) and [iCloud](docs/setup/icloud-calendar.md). Everything else works without a `.env`.

### Common commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Production build into `build/` (run it with `node build`) |
| `pnpm check` | `svelte-check` and TypeScript, failing on warnings |
| `pnpm lint` | Prettier check and ESLint |
| `pnpm lint:css` | Stylelint (animation rules) and the design-token check |
| `pnpm format` | Format all files with Prettier |
| `pnpm test` | Server unit tests (Vitest) with coverage thresholds |
| `pnpm test:component` | Component tests in a real browser |
| `pnpm test:e2e` | Builds, then runs Playwright in landscape and portrait wall viewports, including axe accessibility checks |
| `pnpm budget` | Checks bundle sizes against `budgets.json` (run after `pnpm build`) |
| `pnpm db:generate` | Generates a Drizzle migration after a schema change |
| `pnpm gates` | Everything CI requires, locally. Run it before opening a PR |

End-to-end runs reuse `./data`. If tests fail because of leftovers from earlier runs (duplicate members, for example), delete `./data` and run again.

## Deployment

The server ships as a single multi-arch image (`linux/amd64` and `linux/arm64`) run from [`compose.yaml`](compose.yaml):

```sh
cp .env.example .env   # set PUID/PGID, TZ, data and photo folders
docker compose up -d
```

- [Deploy on Unraid](docs/deploy/unraid.md)
- [Deploy on the Mac Studio](docs/deploy/mac-studio.md)
- [Back up and restore](docs/deploy/backup-restore.md)
- [Move to another host](docs/deploy/migrate.md)
- [Set up the Raspberry Pi kiosk](kiosk/README.md)

`/healthz` answers for container health checks. Keep the credential encryption key (`HUB_SECRET_KEY`, or `data/secret.key` if you leave it empty) backed up: without it, stored calendar credentials can't be recovered.

## Repository layout

```
src/routes/            pages; (app)/ holds the signed-in screens
src/routes/api/        JSON endpoints (all mutations go through these)
src/lib/components/    Svelte components
src/lib/domain/        pure TypeScript logic shared with the client
src/lib/server/        server-only code: DB, auth, calendar sync, photo cache
drizzle/               SQL migrations
tests/e2e/             Playwright tests (*.e2e.ts)
kiosk/                 Raspberry Pi provisioning scripts
scripts/ci/            CI gate scripts
docs/                  ADRs, deployment and setup guides
```

## Contributing

Most work here is done by AI coding agents under human review. The rules for agents are in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md); the short version for everyone:

- **Track work in beads** (`bd ready`, `bd show <id>`). There is one bead per PR, with the bead ID in the commit subject (`feat: star ledger [hub-sps.2]`) and a `Closes hub-xxx` line in the PR body.
- **Work in a worktree** branched from `origin/main`: `git worktree add .claude/worktrees/<branch> -b <branch> origin/main`.
- **Sign off commits** (`git commit -s`) and keep PRs under about 800 changed lines.
- **CI must be green.** Never loosen a gate to get there. Changes to protected files (`.github/`, `scripts/ci/`, `budgets.json`, tool configs, `docs/decisions/`) need a human-applied `human-approved` label.
- **This repo is public.** Never commit secrets or real family data: no names, photos, calendars, addresses or location metadata. Test fixtures are synthetic. CI scans for this.
- **UI rules:** design tokens only, animate only `transform`, `opacity` and `filter`, tap targets of at least 60 px (96 px on kid screens), every screen works in both orientations, and every tap updates the UI before the network call finishes.

## License

No open-source license has been chosen yet. All rights reserved.
