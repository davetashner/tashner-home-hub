# ADR 0001 — Tech Stack

- **Status:** Proposed (awaiting approval)
- **Date:** 2026-10-16
- **Bead:** hub-8n8
- **Context docs:** [requirements.md](../../requirements.md) §4 (NFRs), §5 (hosting)

## Context

- **Server:** Unraid (Docker, linux/amd64) now. From early December 2026, a Mac Studio (M5 Ultra, 256 GB, Docker on macOS, arm64).
- **Wall display:** a Raspberry Pi 5 running Chromium in kiosk mode, driving a 24" 4K touch panel (ViewSonic ID2456-4K).
- **Goal:** the app should be **beautiful, quick, and responsive**, and the chore celebrations should feel delightful to a child.

**The main point: the server isn't the bottleneck, the Pi is.** The Mac Studio is far more powerful than a family hub needs. Every frame the family sees is drawn by the Pi 5's small GPU, at up to 3840×2160. So the stack is chosen to:

1. Send the Pi as little JavaScript as possible, and make its work cheap.
2. Do all heavy lifting on the server: photo resizing, blur backgrounds, calendar merging, recurrence expansion.
3. Make every tap feel instant: optimistic UI, local cache, push updates. Don't wait on the network.

## Decision (proposed)

### One language end to end: TypeScript

| Layer | Choice | Why |
|---|---|---|
| UI framework | **Svelte 5 + SvelteKit 2** | Compiles to small, direct DOM updates with no virtual DOM. The smallest bundles and least runtime overhead of the mainstream frameworks, which matters most on the Pi. Built-in transitions, springs, and tweens make the polished animations (star flying into the jar, slide transitions) easy to write. |
| Styling | **Tailwind CSS v4** + CSS custom-property design tokens | Fast to iterate, no runtime cost, easy theming (day/night, seasonal later). |
| Animation | CSS transforms/opacity + Svelte motion; **canvas-confetti** for confetti; optional **dotLottie** (WASM) for 1–2 hand-made celebration animations | Animate only `transform`/`opacity` so the Pi's GPU composites without relayout. |
| Fonts/icons | Self-hosted variable font (e.g. Nunito or Inter), **Lucide** icons + emoji for chores | No network fetches; friendly look that reads well across a room. |
| Server runtime | **Node.js (current LTS)** running SvelteKit with `adapter-node` | One process serves the UI, the JSON API, and background jobs. Same language as the UI; huge library ecosystem for calendars and images. |
| Database | **SQLite** (WAL mode) via **Drizzle ORM** + migrations | One file in one data volume, so moving Unraid → Mac Studio is just copying a folder (NFR-11). Very fast for a single household. No database server to run. |
| Live updates | **Server-Sent Events (SSE)** | When a parent approves a star on their phone, the wall shows the gold star right away. Simpler than WebSockets for server → client pushes. |
| Offline / speed on the Pi | **Service worker + IndexedDB** (app shell, last calendar window, chores, photo cache) with a write queue | Instant startup from cache. Chore taps work offline and sync later (NFR-6). |
| Background jobs | In-process scheduler (**croner**) | Calendar sync every ≤5 min, photo-folder scan, nightly backup. No extra services. |
| Google Calendar | Official **googleapis** client (OAuth 2.0) | CAL-1. |
| iCloud Calendar | **tsdav** (CalDAV) | CAL-2. |
| ICS + recurrence | **ical.js** + **rrule**; time zones with **Temporal** (polyfill if needed) | CAL-3, CAL-6. Recurring events, DST, and all-day events handled correctly. |
| Photos | **sharp** (libvips) | Pre-renders each photo at the exact display resolution as AVIF/WebP, plus a matching blurred background for portrait photos. The Pi only crossfades two finished images. |
| Auth | Adult PIN → signed session cookie; LAN-only | ADM-2, NFR-3. Secrets encrypted at rest with a key from the environment. |
| Testing | **Vitest** (unit), **Playwright** (end-to-end, plus screenshots at 1080p / 1440p / 4K) | Catches layout breakage at every resolution the Pi might run. |
| Quality | ESLint, Prettier, `svelte-check`, TypeScript strict mode | |
| CI/CD | GitHub Actions → **multi-arch image (amd64 + arm64) on GHCR** | Free for public repos. The same `docker compose pull` works on Unraid and the Mac Studio. |

### Off-server pieces (small and native)

| Component | Runs on | Choice | Why |
|---|---|---|---|
| Kiosk | Pi 5 | Current Raspberry Pi OS (64-bit) + labwc (Wayland) + Chromium kiosk, GPU rasterization on, systemd watchdog | DSP-1/2. The supported, hardware-accelerated path on the Pi 5. |
| Display agent | Pi 5 | Small **Python** service using `python-evdev` + `wlr-randr` | Turns HDMI off/on (SLP-1/2). Watches the touch device directly so a touch wakes the screen even when Chromium has no visible output (SLP-3). Python is preinstalled on the Pi and evdev support is mature. |
| Photos helper | Mac Studio | **osxphotos** on a **launchd** schedule (native, not Docker) | Containers can't read the macOS Photos library. Exports chosen albums into the folder the app reads (hub-6h8.5). |
| Container runtime | Mac Studio | **OrbStack** (or Docker Desktop) | OrbStack is lighter and faster on Apple Silicon, and free for personal use. |

### Performance budget (becomes test criteria)

- Initial JS ≤ **150 KB gzipped**; route changes ≤ **100 ms**; tap feedback within **one frame** (≤ 16 ms); app start from cache ≤ **1 s**.
- Celebration and photo transitions at **60 fps at 1440p**. Use 4K output only if the bench test (hub-8lc.9) shows it stays smooth.
- Server work never blocks a tap: every touch updates the UI first, then syncs.

## Alternatives considered

- **React / Next.js:** the biggest ecosystem, but larger bundles and more runtime work on the Pi. No benefit here that justifies the cost.
- **Flutter on the Pi (flutter-pi):** excellent native smoothness, but it needs a separate web admin UI, has no browser caching model, and is a second codebase. Fallback only if Chromium can't hit the frame budget.
- **Python (FastAPI) or Go backend:** both fine, but they add a second language to the main app for no user-visible gain.
- **PostgreSQL:** unnecessary for one household. A second container to run and back up.

## Hardware note (not part of the decision, but related)

If the bench test (hub-8lc.9) shows the Pi 5 can't run animations smoothly even at 1440p, the cheapest fix is a **small x86 mini PC (Intel N150-class, about $150–200) as the kiosk** in place of the Pi. It has a much stronger GPU for Chromium and runs the same kiosk setup. Nothing else in the stack changes.

## Future opportunity (out of scope for now)

The Mac Studio can run **local AI models** at no cost. That makes earlier non-goals possible later without paid APIs, for example: photo of a school flyer → calendar events, and picking the best family photos for the slideshow. The stack doesn't need to change for this; it would be a separate local service the app calls.

## Consequences

- One repo, one language, one container for the main app, plus two tiny native helpers (the Pi agent and the Mac photo helper).
- Responsiveness depends on getting the client right: service-worker caching, optimistic updates, and animating only transforms/opacity. These become review criteria.
- Moving from Unraid to the Mac Studio is copying the data volume plus `docker compose up`.
