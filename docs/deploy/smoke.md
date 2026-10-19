# Post-deploy smoke (read-only)

`scripts/deploy-smoke/run.mjs` (hub-ed6.4) walks the read-only pages of the family journeys against a
running hub after a deploy. It replaces the hand-run `curl` of `/healthz`, `/lists`, `/meals` and
`/chores`.

```bash
node scripts/deploy-smoke/run.mjs --base https://hub.davetashner.com        # all devices, all pages
node scripts/deploy-smoke/run.mjs --base https://hub.davetashner.com --pi   # also print the Pi screenshot command
node scripts/deploy-smoke/run.mjs --base http://127.0.0.1:4377 --device iphone-webkit --only home,lists
```

Needs Playwright browsers (`pnpm exec playwright install chromium webkit`). Exit code 0 means every
check passed, 1 means a check failed (a concise list is printed), 2 means a usage error.

## What it checks

For each device profile (`wall-landscape-1440p`, `wall-portrait-1440p`, `iphone-webkit`,
`ipad-portrait-webkit`, `ipad-landscape-webkit`) and each page (Home with its notes card, `/calendar`,
`/chores`, `/lists`, `/meals`, `/photos`, `/music`, `/games`, and `/settings` as a non-adult, which must
bounce to `/unlock`): HTTP 200, hydrated (`html[data-hydrated]`), no console errors or page errors,
no sideways scroll, and `main` visible.

## Read-only guarantee

- Every request goes through a Playwright route that lets only `GET` and `HEAD` out. Anything else is
  aborted, and the run fails and names it.
- No clicks, no typing, no adult PIN, service workers blocked.
- Screenshots go to `reports/deploy-smoke/<timestamp>/` (gitignored). The live site shows real family
  data: never commit them or put them in a PR or bead.

## The Pi

`--pi` only prints the command; the smoke never opens ssh. It is the kioskctl screenshot
(see `kiosk/README.md`): `KIOSK_HOST=<user@pi> KIOSK_SSH_KEY=<key> node scripts/kiosk/kioskctl.mjs screenshot --out reports/deploy-smoke/pi.png --scale 0.5`.

## Testing the tool

`node --test scripts/deploy-smoke/` covers argument parsing and the request guard. To try it end to end,
run `pnpm build`, start `HOST=127.0.0.1 PORT=<free> DATA_DIR=<fresh dir> node build`, complete first-run
setup once (`POST /api/setup`), then point `--base` at it. A brand-new empty database redirects every
page to `/setup`, which would fail the checks.
