# Family journeys

The journeys are what the family does with the hub in a day. `journeys/registry.json` is the
source of truth: each journey has a persona, a critical flag, and numbered steps (J1.2) that are
either `built` or `planned`. Playwright tests in `tests/e2e/` are tagged with the steps they prove,
so a broken step can be traced to a test and a missing test to a step.

## Personas

- **Kid at the wall**: taps on the 24" touch display, no PIN.
- **Parent at the wall**: unlocks with the PIN on the wall display.
- **Parent on a phone or iPad**: signs in on a personal device.
- **The wall unattended**: the photo frame, the sleep schedule and the night clock.

## Devices

| Registry name | Playwright projects |
| --- | --- |
| `wall` | `wall-landscape-1440p`, `wall-portrait-1440p` |
| `iphone` | `iphone-webkit` |
| `ipad` | `ipad-portrait-webkit`, `ipad-landscape-webkit` |

Every spec runs on both wall projects. The iPhone and iPad projects run only the `IOS_SPECS` list in
`playwright.config.ts`, so a step that must work on a phone or iPad shows a device gap in the trace
until one of its tests is on that list.

## Tagging tests

Tag a test with the step it proves. Both forms work, and a test can name several steps:

```ts
test('tap shows pending instantly @J1.2', async ({ page }) => { ... });
test('tap shows pending instantly', { tag: ['@J1.2'] }, async ({ page }) => { ... });
```

A `test.step('J1.2 ...')` name also counts. Tests that cannot be Playwright tests (unit tests of an
API) go in the step's `tests` list in the registry. A built step with no test needs an `untested`
reason; a step whose test fakes something outside the repo (Spotify, the Pi) says so in `simulated`.

## Checking and regenerating

```bash
node scripts/journeys/trace.mjs          # print every step with its tests; exit 1 on a problem
node scripts/journeys/trace.mjs --write  # regenerate the tables below
node --test scripts/journeys/            # the script's own tests
```

The trace fails when a built step has no tagged test, when a tag or `test.step` names a step the
registry does not have, or when the tables below are out of date. It is not part of `pnpm gates`
yet; wiring it into CI is bead hub-ed6.3 (the scripts section of `package.json` and `.github/` are
protected).

## Journey videos

Local tool, not part of CI. It records each journey on a device as a video from the tagged tests:

```bash
node scripts/journey-videos/record.mjs [--only J1,J4] [--device wall-landscape|wall-portrait|ipad|iphone|all]
```

`--device` defaults to `wall-landscape`; `ipad` records both orientations (`ipad-landscape` and
`ipad-portrait` pick one); `--skip-build` reuses `build/`; `--port` picks the server port (default
4400, or `E2E_PORT`). The iPhone and iPad runs use the WebKit projects from `playwright.config.ts`
and so only cover the `IOS_SPECS` tests.

For each device it builds the app, starts it on a fresh data dir, runs the step-tagged tests one at
a time in one browser with Playwright video on, and (with ffmpeg) assembles one video per journey:
a title card, a clip per test, and an end card with the pass and fail counts. Without ffmpeg the
per-test `.webm` clips and the report are kept. Each page gets a caption banner (step id, the
registry's text, test file and name, Running then Passed, or Failed in red with the assertion), a
drawn cursor and a tap ripple. The overlay comes from a fixture that stands in for
`@playwright/test` through `scripts/journey-videos/tsconfig.json`, so the specs run unchanged and
the app is never touched. The banner is drawn over the top of the page and does not move the layout.

Output goes to `reports/journeys/<timestamp>/`: `index.html` lists every step with its result and
links the videos. `/reports` is gitignored. Never commit or attach the videos: the data is
synthetic, but the repo is public. `node --test scripts/journey-videos/` runs the tool's tests.

## Journey videos

Local tool, not part of CI. It records each journey on a device as a video from the tagged tests:

```bash
node scripts/journey-videos/record.mjs [--only J1,J4] [--device wall-landscape|wall-portrait|ipad|iphone|all]
```

`--device` defaults to `wall-landscape`; `ipad` records both orientations (`ipad-landscape` and
`ipad-portrait` pick one); `--skip-build` reuses `build/`; `--port` picks the server port (default
4400, or `E2E_PORT`). The iPhone and iPad runs use the WebKit projects from `playwright.config.ts`
and so only cover the `IOS_SPECS` tests.

For each device it builds the app, starts it on a fresh data dir, runs the step-tagged tests one at
a time in one browser with Playwright video on, and (with ffmpeg) assembles one video per journey:
a title card, a clip per test, and an end card with the pass and fail counts. Without ffmpeg the
per-test `.webm` clips and the report are kept. Each page gets a caption banner (step id, the
registry's text, test file and name, Running then Passed, or Failed in red with the assertion), a
drawn cursor and a tap ripple. The overlay comes from a fixture that stands in for
`@playwright/test` through `scripts/journey-videos/tsconfig.json`, so the specs run unchanged and
the app is never touched. The banner is drawn over the top of the page and does not move the layout.

Output goes to `reports/journeys/<timestamp>/`: `index.html` lists every step with its result and
links the videos. `/reports` is gitignored. Never commit or attach the videos: the data is
synthetic, but the repo is public. `node --test scripts/journey-videos/` runs the tool's tests.

## When the journeys run

Ordinary PRs run the normal e2e suite (`pnpm test:e2e`), which already contains these tagged tests.
The full journey run on every device, with videos, happens only on release PRs (bead hub-ed6.3).

<!-- journeys:begin (generated by scripts/journeys/trace.mjs --write) -->

| Step | What happens | Status | Devices | Tests |
| --- | --- | --- | --- | --- |
| **J0** | **Wake the screen and see Home** (Everyone, critical) | | | |
| J0.1 | Touch the sleeping screen: it wakes, and the touch does not press the button under it. | built | wall | `critical-flows` |
| J0.2 | Home shows the clock, date, weather, next event and the wave background. | built | wall, iphone, ipad | `home`, `shell`, `wave-background`, `weather` |
| J0.3 | Move between destinations by tap or swipe; collapse the nav rail for a full-screen view. | built | wall | `nav-collapse`, `nav-feedback`, `shell` |
| J0.4 | Count down to a family date on Home. | built | wall | `countdowns` |
| J0.5 | Every screen still renders from saved copies when the network drops. | built | wall | `offline` |
| **J1** | **Kid does a Star Job and a habit, earns stars, undoes a mistake** (Kid at the wall, critical) | | | |
| J1.1 | Pick my name with the avatar switcher. | built | wall | `child-switcher` |
| J1.2 | Tap a Star Job: it shows pending at once and a star flies to the jar, with sound. | built | wall | `celebrate`, `critical-flows`, `kid-chores` |
| J1.3 | Tap a habit; finishing every habit earns a star. | built | wall | `habits` |
| J1.4 | Undo a mistaken tap within 10 seconds and the star comes back off. | built | wall | `kid-chores` |
| J1.5 | A tap the server refuses reverts with a gentle message. | built | wall | `kid-chores` |
| J1.6 | Finish everything: the all-done banner shows once per day. | built | wall | `celebrate` |
| J1.7 | Watch the goal jar fill toward the reward I picked. | built | wall | `goal-jar` |
| J1.8 | Games and Music wait until today's jobs are done, or a grown-up unlocks them. | built | wall | `fun-lock` |
| J1.9 | An any-day job sits under This week until done. | built | wall | `kid-chores` |
| J1.10 | Six Star Jobs and six habits fit the wall without scrolling the page. | built | wall | `kid-chores` |
| **J2** | **Kid runs a routine** (Kid at the wall, critical) | | | |
| J2.1 | Open a routine from the kid's board, including a kid who has only routines. | built | wall | `routine-only-kid`, `routines` |
| J2.2 | Step through it, reload to resume, and see the celebration at the end. | built | wall | `routines` |
| J2.3 | A step tapped offline survives a reload and is saved once back online. | built | wall | `offline` |
| **J3** | **Parent approves and adjusts stars** (Parent at the wall, critical) | | | |
| J3.1 | The header badge shows pending Star Jobs and leads to the PIN, then Approvals. | built | wall | `approvals` |
| J3.2 | Approve one or all; the star turns gold on the wall. | built | wall, iphone, ipad | `approvals`, `celebrate`, `critical-flows` |
| J3.3 | Send a job back with a note, and no stars are paid. | built | wall | `approvals` |
| J3.4 | Give or remove bonus stars with a note; the kid sees the bonus celebration. | built | wall | `bonus-stars` |
| J3.5 | Undo an approved job any time later. | built | wall | `approvals` |
| J3.6 | Read the weekly summary for each child. | built | wall, iphone, ipad | `weekly-summary` |
| J3.7 | A failed approve puts the row back with a message. | built | wall | `approvals` |
| **J4** | **Kid spends stars in the reward shop** (Kid at the wall) | | | |
| J4.1 | Browse the shop and make a reward my goal. | built | wall | `reward-shop` |
| J4.2 | Reach the goal: the header badge counts it for grown-ups. | built | wall | `attention-badge`, `goal-jar` |
| J4.3 | Get it now: preview, then the PIN. | built | wall, iphone, ipad | `critical-flows`, `reward-shop` |
| J4.4 | A grown-up redeems; the stars come off and it is logged. | built | wall, iphone, ipad | `critical-flows`, `redemption` |
| J4.5 | A failed redeem puts the stars back. | built | wall | `redemption` |
| J4.6 | Earn a badge: it celebrates once and fills the kid's sticker book. | built | wall | `badges` |
| J4.7 | A grown-up sets an allowance rate; the kid cashes out and the parent marks it paid. | built | wall | `allowance` |
| **J5** | **Family calendar: today, week, add an event** (Parent at the wall, critical) | | | |
| J5.1 | Agenda shows today with members and location; a tap opens details. | built | wall, iphone, ipad | `calendar-view`, `critical-flows` |
| J5.2 | Week and month views show timed, spanning and all-day events; swipe changes the period. | built | wall | `calendar-view`, `critical-flows` |
| J5.3 | Filter the calendar by member. | built | wall, iphone, ipad | `calendar-member-filter` |
| J5.4 | Add an event from the wall or a phone; it shows pending, then confirmed. | built | wall, iphone | `calendar-create` |
| J5.5 | Edit or delete an event; a conflict rolls back. | built | wall | `calendar-edit` |
| J5.6 | Connect a calendar link or Google and see its health. | built | wall, iphone | `calendar-settings` |
| J5.7 | The now line follows the time; the view is remembered. | built | wall | `calendar-now-line`, `calendar-view` |
| J5.8 | The calendar fits phone and tablet screens. | built | iphone, ipad | `calendar-phone`, `calendar-sizes` |
| **J6** | **Lists: add, check off, offline replay** (Everyone) | | | |
| J6.1 | Add an item with the wall keyboard, check it off, clear checked. | built | wall | `lists` |
| J6.2 | Add an item from a phone. | built | iphone | `lists` |
| J6.3 | An item added in one browser shows in another within a second. | built | wall, iphone | `lists-live` |
| J6.4 | A check made before its add returns still lands once the network is back. | built | wall, iphone | `lists-temp-tap` |
| J6.5 | Long-press an item to delete it; create and delete a list. | built | wall, iphone | `lists` |
| J6.6 | Assign a list to a grown-up or the House; group and filter lists by owner. | built | wall, iphone | `lists` |
| **J7** | **Meals plan and saved meals to grocery** (Parent at the wall) | | | |
| J7.1 | Plan a dinner; it shows in Meals and on the calendar week. | built | wall, iphone | `meals` |
| J7.2 | Edit or delete a planned meal. | built | wall, iphone | `meals` |
| J7.3 | Save a meal, add its ingredients to Grocery, plan a day from it. | built | wall | `saved-meals` |
| J7.4 | A meal edited offline is saved once back online. | built | wall | `offline` |
| J7.5 | Meals fit a phone with no sideways scroll. | built | iphone | `meals` |
| J7.6 | Saved meal writes need a grown-up; reading and adding to Grocery do not. | built | wall | `saved-meals` |
| **J8** | **Photo frame slideshow and sleep schedule** (The wall unattended, critical) | | | |
| J8.1 | When idle the wall returns Home, then starts the photo frame; a touch leaves it. | built | wall | `critical-flows`, `display-role`, `idle`, `slideshow` |
| J8.2 | The slideshow plays on its interval, preloads, and fills both photo shapes. | built | wall | `slideshow` |
| J8.3 | The frame overlay shows the clock, date, weather and next event. | built | wall | `frame-overlay` |
| J8.4 | On this day favors past-year photos. | built | wall | `slideshow` |
| J8.5 | The sleep schedule and Sleep now power the display down and back. | built | wall | `display-power-poll`, `display-power`, `shell`, `sleep-schedule-settings`, `wall-power-settings`. Simulated: the screen-power calls are proven against the API; the real panel is only checked on the Pi (hub-xcr) |
| J8.6 | At night the dim, warm clock names the morning's first event; a touch wakes the app. | built | wall | `night-clock` |
| J8.7 | A grown-up adds photo folders, hides a photo, and sets the interval. | built | wall | `photo-library`, `slideshow` |
| J8.8 | A grown-up connects Google and imports photos with the Google Photos picker. | built | wall | `photo-google-import` |
| J8.9 | The photo frame plays Live Photo clips. | built | wall | `slideshow` |
| **J9** | **Parent sets up the household** (Parent on a phone or iPad, critical) | | | |
| J9.1 | A fresh hub shows setup, creates the first grown-up and PIN, then guards the routes. | built | wall | `setup` |
| J9.2 | Add and edit family members. | built | wall | `family` |
| J9.3 | Unlock with the PIN; five wrong attempts lock it; Lock ends the session. | built | wall, iphone, ipad | `lock`, `pin-phone`, `pin` |
| J9.4 | Create, edit and archive chores, habits, routines and rewards. | built | wall | `chores-admin`, `habits-admin`, `rewards`, `routines-admin` |
| J9.5 | Choose wall or personal device, screen direction, idle timers and the sleep schedule. | built | wall, iphone, ipad | `display-role`, `idle`, `orientation` |
| J9.6 | Choose appearance, sounds, quiet hours and the wave palette. | built | wall | `appearance`, `sound-settings`, `sound-themes`, `wave-background` |
| J9.7 | Pick the household time zone and weather location. | built | wall | `time-zone`, `weather` |
| J9.8 | Set up notifications and send a test. | built | wall | `notifications-settings` |
| J9.9 | Export all data as JSON; a bad import is refused. | built | wall | `data-export` |
| J9.10 | Every admin page and form fits a phone without sideways scroll. | built | iphone, ipad | `phone-admin` |
| **J10** | **Music** (Kid at the wall) | | | |
| J10.1 | Pick a playlist; it plays with big controls and pause. | built | wall | `music-tab`. Simulated: Spotify and the Pi speaker are fakes in the tests |
| J10.2 | Volume stops at the parent cap. | built | wall | `music-tab` |
| J10.3 | An asleep speaker shows a sheet and Try again starts the music. | built | wall | `music-tab` |
| J10.4 | A grown-up connects Spotify, curates playlists and sets limits. | built | wall | `music` |
| J10.5 | A grown-up changes the speaker: scan, pair, test sound. | built | wall | `music-speaker` |
| **J11** | **Timers** (Everyone) | | | |
| J11.1 | Open Timers from Home and start one. | built | wall, iphone, ipad | `home-screen`, `timers` |
| J11.2 | Pause, add a minute, cancel; the pill follows along. | built | wall | `timers` |
| J11.3 | A finished timer shows a banner and sounds the alarm until dismissed. | built | wall | `timers` |
| **J12** | **Family notes and message board** (Everyone) | | | |
| J12.1 | A kid posts a sticky note without a PIN; an adult pins it; anyone dismisses it. | built | wall | `notes` |
| J12.2 | A note that has expired is gone. | built | wall | `notes` |
| J12.3 | The same flow works on a phone. | built | iphone | `notes` |
| **J13** | **Vacation mode and streaks** (Parent at the wall) | | | |
| J13.1 | Set vacation: the kid board pauses, and ending it restores the jobs. | built | wall | `vacation` |
| J13.2 | A grown-up sets and ends vacation from Settings. | built | wall | `vacation` |
| J13.3 | The kid sees a streak badge and a milestone banner paid exactly once. | built | wall | `streaks` |
| **J14** | **Games** (Kid at the wall) | | | |
| J14.1 | A grown-up adds a game; it shows on the Games tab, opens in a frame, and Back returns. | built | wall | `games` |
| J14.2 | A game that cannot load shows a friendly message. | built | wall | `games` |
| J14.3 | The game form warns about home-network addresses but still saves. | built | wall | `games` |
| **J15** | **Siri shortcuts API** (Parent on a phone or iPad) | | | |
| J15.1 | A grown-up makes a Siri token, sees it once, then revokes it. | built | wall | `siri-settings` |
| J15.2 | Siri adds a list item and does a Star Job with the token. | built | iphone | `src/routes/api/siri.spec.ts`. Simulated: the Shortcuts app on a real iPhone is not driven; the API is covered by unit tests |
| **J16** | **Every screen fits every device** (Everyone, critical) | | | |
| J16.1 | Every tap target meets 60 px (96 px on kid screens) and nothing sits behind hover. | built | wall | `calendar-view`, `design`, `shell`, `tap-targets` |
| J16.2 | All wall text is legible and the layout has no overflow in portrait. | built | wall | `legibility`, `portrait-layout` |
| J16.3 | Phones and iPads in both orientations fit the shell, clear the safe areas, and avoid input zoom. | built | iphone, ipad | `ios-input-zoom`, `ipad-pages`, `ipad-shell`, `phone-landscape-pages`, `phone-landscape`, `safe-areas` |
| J16.4 | Pages have no serious accessibility violations. | built | wall | `a11y`, `kid-chores` |
| J16.5 | Taps and celebrations stay fast. | built | wall | `celebrate-perf`, `interaction-perf` |
| J16.6 | The hub installs to the Home Screen and the container serves health and shuts down cleanly. | built | wall, iphone, ipad | `body-size-limit`, `home-screen`, `home`, `shutdown` |
| **J17** | **Home controls (Home Assistant)** (Everyone) | | | |
| J17.1 | Tap a big Home controls tile: it flips at once and settles with the server. | built | wall | `home-assistant` |
| J17.2 | A failed tap rolls back and says so. | built | wall | `home-assistant` |
| J17.3 | Unreachable Home Assistant is handled gracefully, and the card is hidden when nothing is configured. | built | wall | `home-assistant` |
| J17.4 | A grown-up connects Home Assistant, tests it, picks, renames and reorders entities. | built | wall | `home-assistant`. Simulated: Home Assistant is a fake server in the tests |
| **J18** | **Drawing board** (Kid at the wall) | | | |
| J18.1 | Draw with a pen or finger on the Home notes card and post it to the board. | built | wall | `drawing` |
| J18.2 | Tap a drawing to enlarge it; anyone dismisses it. | built | wall | `drawing` |
| **J19** | **Sitter mode** (Parent at the wall) | | | |
| J19.1 | A grown-up fills in the info card: emergency contacts, address, allergies, bedtimes, house rules, Wi-Fi and notes for tonight. | built | wall | untested: undefined |
| J19.2 | Start a sitter session now or on a schedule, with an optional sitter name, 4-digit PIN and permissions. | built | wall | untested: undefined |
| J19.3 | Extend a session or end it early; it ends itself at its end time. | built | wall | untested: undefined |
| J19.4 | The wall gets the info card only during an active session, and with a PIN only after the sitter enters it. | built | wall | untested: undefined |
| J19.5 | The sitter always has the Emergency info button (behind the sitter PIN when one is set), and the parent-only parts of the wall are locked while a session runs. | built | wall | `sitter-wall` |
| J19.6 | A parent starts, extends and ends a session from their phone, and the sitter can check in (kids in bed, all good, call me). | built | wall | untested: undefined |
| J19.7 | After a session, the parents read a short log of the check-ins and when they happened. | built | wall | untested: undefined |
| J19.8 | When the parents allow it, the sitter checks Star Jobs with the sitter PIN; otherwise approving stays with the parents. | built | wall | `sitter-wall` |

<!-- journeys:end -->
