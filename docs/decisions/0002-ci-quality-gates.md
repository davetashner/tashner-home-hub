# ADR 0002 — CI Quality Gates for Unattended Builds

- **Status:** Accepted (2026-10-16). Repo stays **public**; the self-hosted runner is restricted to trusted events.
- **Date:** 2026-10-16
- **Related:** [ADR 0001](0001-tech-stack.md), [requirements.md](../../requirements.md) §4, §9

## Context

AI coding agents will build most of this app **overnight, unattended**. Nobody reviews each PR as it's written, so CI is the reviewer. The standards are subjective ("fast, responsive, elegant, beautiful"), so they have to be turned into **checks a machine can enforce**. Otherwise, by morning, an agent will have merged something that "passes" but feels sluggish or looks off.

Three principles:

1. **Measure what the family experiences**, not proxies: tap latency, frame rate on the real Pi, pixels on screen, legibility at 2 m.
2. **Agents can't move the goalposts.** Thresholds, visual baselines, and the CI config itself are protected. Loosening them needs a human.
3. **Fast feedback for agents, deep checks overnight.** Per-PR gates finish in about 15 minutes so agents can iterate. Hardware and soak tests run nightly.

## Decision (proposed)

### Tier 1 — Correctness and hygiene (every PR, required, ~5 min)

| Gate | Tool | Fails when |
|---|---|---|
| Types | `tsc --strict`, `svelte-check` | Any error. `any`, `@ts-ignore` and `@ts-expect-error` need an inline justification (lint rule). |
| Lint / format | ESLint (incl. `eslint-plugin-svelte` a11y rules), Prettier | Any error or unformatted file. |
| Unit tests | Vitest | Any failure. Coverage under **90% on domain modules** (star ledger, chore scheduling, recurrence, sync merge), or under 75% overall. |
| Test integrity | Custom script | `.only` is present, or the count of `.skip`/`todo` tests goes up, or any test file is deleted, unless the PR has the `human-approved` label. |
| DB migrations | drizzle-kit | Schema and migrations are out of sync, or migrating from an empty DB fails, or the previous release's DB fails to migrate. |
| Security | `osv-scanner`, `gitleaks` | Any **critical or high** CVE in dependencies (user rule); any secret detected. |
| Private data | `gitleaks` custom rules + `exiftool` + fixture check | Any committed image has EXIF GPS or camera-owner metadata; a fixture uses a non-synthetic name, email, or phone pattern; any file appears under a `data/`, `photos/`, or `.env*` path. The repo is public. |
| Licenses | `license-checker` | A dependency's license isn't on the allow-list (MIT, Apache-2.0, BSD, ISC, …). |
| Commit hygiene | DCO check, PR-body check | Missing `Signed-off-by`, or no `Closes hub-…` line in the PR body. |
| Container | `docker buildx` (amd64) + smoke test | The image doesn't build, or the healthcheck fails within 30 s. |

### Tier 2 — Experience gates (every PR, required, ~10 min)

All run in Playwright against a production build with **seeded fixture data and a frozen clock**, so results are reproducible.

| Gate | How | Fails when |
|---|---|---|
| **Bundle budget** | `size-limit` | Initial JS > **150 KB gz**, CSS > **30 KB gz**, or any route chunk > 50 KB gz. |
| **Tap latency** | Playwright + Chrome DevTools Protocol (CDP) with **4× CPU throttle** (rough Pi 5 stand-in); measures Event Timing / INP for key taps ("I did it!", nav, approve) | Any key interaction's INP > **100 ms** (target 50 ms), or the first visual response comes after the next frame. |
| **Animation smoothness** | CDP performance trace during the celebration, the star-to-jar flight, and photo crossfade | More than **5% dropped frames** at 1440p under throttle. Any layout/paint of non-composited properties during these animations. |
| **Animation hygiene** | Stylelint + `stylelint-high-performance-animation` | Transitions or animations on layout properties (`width`, `top`, `margin`, …). Only `transform`/`opacity`/`filter` are allowed. |
| **Load performance** | Lighthouse CI (desktop, 4× CPU throttle) | Performance < **95**, LCP > 1.5 s, CLS > 0.02, TBT > 100 ms. |
| **Offline** | Playwright with network blocked after warm-up | Any screen fails to render from cache, or a queued chore completion is lost after reconnect. |
| **Critical flows (E2E)** | Playwright | Any failure in: complete chore → pending star → parent approves (phone context) → gold star on wall; reward redemption with PIN; sleep-now → wake; calendar view switching; photo frame start after idle. |
| **Visual regression** | Playwright screenshots of every screen × **landscape 1080p / 1440p / 4K and portrait 1080×1920 / 1440×2560** × **day / night theme**, fonts bundled, animations frozen | Pixel diff over threshold vs. committed baselines, or any portrait layout with horizontal overflow or clipped controls. **Baseline updates need the `visual-approved` label from a human.** |
| **Accessibility** | `@axe-core/playwright` on every screen | Any *serious* or *critical* violation; contrast below WCAG AA. |
| **Kid-friendly touch** | Custom Playwright check: measures every interactive element | Any tap target < **60 px**, or < **96 px** on kid screens (chores, rewards). Hover-only interactions. |
| **Readable from across the room** | Custom check on computed styles | Body text < 24 px at 1440p on wall screens; clock/date header below the size set in design tokens. |
| **Design-system discipline** | ESLint/Stylelint rules | Raw hex colors, arbitrary Tailwind values (`w-[37px]`), or fonts/spacing not taken from design tokens. Ad-hoc styling is how "elegant" quietly erodes. |
| **Perf regression vs `main`** | Stored metrics per commit (JSON artifact) | Any tracked metric more than **10% worse** than `main`'s rolling median, even if still under budget. |

### Tier 3 — Nightly deep checks (on `main`, results reported each morning)

| Check | Where | What |
|---|---|---|
| **Hardware-in-the-loop** | The real Pi 5 + ViewSonic (or a spare Pi 5) | Deploy the nightly build to a staging kiosk. Drive Chromium over CDP. Measure **real fps** for the celebration and photo transitions at 1440p and 4K, tap-to-paint latency, and cold-start time. The proposed budgets are calibrated from these real-hardware numbers. |
| **Soak test** | Unraid now, Mac Studio later | 8-hour run with an accelerated clock: memory growth (leak detection), SSE reconnects, calendar sync cycles, sleep/wake cycles, photo rotation. Fails if the browser heap grows > 20%. |
| **Mutation testing** | Stryker on domain modules | Fails if the mutation score is < 70%. This catches tests that agents wrote to pass rather than to verify. |
| **Multi-arch build** | arm64 + amd64 | Full image build and smoke test on both architectures. |
| **Dependency drift** | Renovate (grouped, weekly) | Update PRs go through the same gates; no auto-merge of major versions. |
| **AI design review** *(advisory)* | Local vision model on the Mac Studio | Screenshots of every screen are scored against a written design rubric: hierarchy, spacing rhythm, alignment, color harmony, legibility at distance, "would a 6-year-old want to tap this?". Results are posted as a PR or issue comment. **Not blocking**, because model judgments are noisy, but agents read it and fix issues the next night. |

### Guardrails specific to overnight agents

- **Branch protection on `main`**: all Tier 1 and 2 checks required, linear history, no direct pushes. Agents may auto-merge only when everything is green **and** the PR has no `needs-human` label.
- **Protected paths** (CODEOWNERS + a `gate-integrity` check): `.github/`, `budgets.json`, `tests/visual/baselines/`, lint and CI configs, and this ADR. Any PR touching them gets `needs-human` and can't auto-merge.
- **One bead per PR, small diffs**: fail if a PR changes more than about 800 lines (excluding lockfiles and baselines) unless it's labeled. Small PRs keep failures easy to trace.
- **Morning report**: a nightly job posts a summary issue (and ntfy push later): PRs merged, PRs blocked and why, perf trend charts, Pi fps, soak results, AI design notes.
- **Kill switch**: a repo variable `AGENTS_PAUSED=true` makes the agent workflow exit right away.

### Where it runs

| Runner | Used for | Notes |
|---|---|---|
| **GitHub-hosted** (free for public repos) | Tiers 1 and 2 on every PR | Fast and isolated. |
| **Self-hosted on Unraid → Mac Studio** | Tier 3, local AI review, driving the Pi over the LAN | **Security:** a self-hosted runner on a *public* repo must never run on `pull_request` from forks, because anyone could then run code on your machine. Restrict it to `schedule`, `workflow_dispatch`, and pushes to `main`, using runner groups and labels. *Or make the repo private*, but private repos get limited free Actions minutes. |

## Rollout

Gates land with the scaffold, so the very first feature PR is held to them:

1. **With scaffold (hub-8lc.1):** all of Tier 1, plus bundle budget, a11y, design-system lint, animation hygiene, branch protection, protected paths.
2. **With the UI shell:** visual regression baselines, tap-latency, smoothness, kid-friendly touch, and readability checks.
3. **After the Pi kiosk is up (hub-8lc.4 / hub-8lc.9):** hardware-in-the-loop nightly; recalibrate budgets from real numbers.
4. **When the Mac Studio arrives:** move the self-hosted runner there and turn on AI design review.

## Consequences

- PRs take about 15 minutes to clear CI. That's fine overnight and protects quality.
- Agents spend some effort satisfying gates (e.g. updating baselines needs a human). This is intended: a person signs off on visual changes.
- Budgets are proposed numbers. They will be tuned once real Pi measurements exist, and only by a human (protected file).
