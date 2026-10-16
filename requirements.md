# Requirements — Tashner Home Hub

A self-hosted, wall-mounted touchscreen family hub: shared calendar, photo frame, gamified chores, and household lists. It replaces commercial smart displays (Skylight, Supersonic, Cozyla, Dragon Touch, Hearth) **without any subscription**.

## 1. Goals and Non-Goals

### Goals
- **G1. No subscription.** Every feature must work with no recurring fees. Third-party services used must be free tiers we already have (Google account, iCloud account).
- **G2. One glanceable place for the family's schedule**, merged from Google Calendar and Apple (iCloud) Calendar.
- **G3. A photo frame** showing family photos from Apple Photos when the calendar is idle.
- **G4. Chores a child wants to do**: tapping "Done" is rewarding, earns gold stars, and stars build toward a bigger reward.
- **G5. Respect the household at night**: scheduled sleep mode plus an on-screen button that turns the display off.
- **G6. Self-hosted and private**: family data stays on our hardware (home server plus a Raspberry Pi on the wall).

### Non-Goals (v1)
- Public internet exposure or multi-household accounts.
- Native iOS/Android apps (a mobile-friendly web UI is enough).
- Voice assistant integration.
- Video calling.
- AI features that need paid APIs (e.g. "photo of a school flyer → events"). May revisit later as optional.

## 2. Feature Comparison (what we're taking from commercial products)

| Feature | Skylight | Cozyla | Dragon Touch | Hearth | Home Hub |
|---|---|---|---|---|---|
| Google / Apple calendar sync | ✓ | ✓ | ✓ (Google) | ✓ | **Must** |
| Color-coded family member profiles | ✓ | ✓ | ✓ | ✓ | **Must** |
| Day / week / month / agenda views | ✓ | ✓ | ✓ | ✓ | **Must** |
| Photo frame / slideshow | ✓ (Plus) | ✓ | ✓ | – | **Must** |
| Chore charts | ✓ | ✓ | ✓ | ✓ | **Must** |
| Stars / rewards | ✓ (Plus) | ✓ | partial | ✓ | **Must** |
| Routines (morning / bedtime checklists) | ✓ | ✓ | – | ✓ | Should |
| Meal planning | ✓ (Plus) | ✓ | ✓ | ✓ | Should |
| Grocery / to-do lists | ✓ | ✓ | ✓ | ✓ | Should |
| Weather | ✓ | ✓ | ✓ | ✓ | Should |
| Countdowns ("12 days to Disney") | ✓ | ✓ | – | ✓ | Should |
| Manage from phone | ✓ app | ✓ app | ✓ app | ✓ app | **Must** (web UI) |
| Night / sleep mode | ✓ | ✓ | ✓ | ✓ | **Must** |
| Subscription required for full features | Yes | Yes | No | Yes | **Never** |

Supersonic's digital calendar is in the same category but isn't broken out in the table. Competitor columns are based on publicly marketed features as of 2026 and should be checked before relying on them.

Priority key used below: **P0** = must have for v1, **P1** = should have, **P2** = nice to have / later.

## 3. Functional Requirements

### 3.1 Family Profiles
| ID | Pri | Requirement |
|---|---|---|
| FAM-1 | P0 | Support multiple family members, each with a name, color, and avatar (photo or emoji). |
| FAM-2 | P0 | Calendar events, chores, and stars are attributed to one or more family members. |
| FAM-3 | P0 | Profiles are either *adult* or *child*. Only adults can change settings, approve chores, or redeem rewards. |
| FAM-4 | P1 | Filter the calendar to show one or more members only. |

### 3.2 Calendar
| ID | Pri | Requirement |
|---|---|---|
| CAL-1 | P0 | Connect one or more **Google Calendar** accounts via OAuth 2.0 and choose which calendars to show. |
| CAL-2 | P0 | Connect one or more **Apple iCloud Calendar** accounts via CalDAV (Apple ID + app-specific password) and choose which calendars to show. |
| CAL-3 | P0 | Subscribe to read-only ICS/webcal URLs (school calendars, sports schedules, holidays). |
| CAL-4 | P0 | Map each source calendar to a family member/color. |
| CAL-5 | P0 | Views: **Today/Agenda**, **Week**, **Month**. Default view is configurable. |
| CAL-6 | P0 | Show all-day, multi-day, and recurring events correctly, including time zones and DST changes. |
| CAL-7 | P0 | Sync automatically (at most every 5 minutes) and on demand (pull-to-refresh or a refresh button). |
| CAL-8 | P0 | Keep showing the last synced data when offline, with a visible "last synced" indicator if a sync is stale (> 30 min). |
| CAL-9 | P1 | Create, edit, and delete events from the touchscreen and phone, written back to the chosen Google or iCloud calendar. |
| CAL-10 | P1 | Tap an event to see details (time, location, notes, attendees). |
| CAL-11 | P1 | Highlight "now" with a current-time line in day/week views. |
| CAL-12 | P2 | Microsoft Outlook / Office 365 calendar support. |
| CAL-13 | P2 | Show the next upcoming event on the photo-frame screen and the night clock. |

### 3.3 Photo Frame
| ID | Pri | Requirement |
|---|---|---|
| PHO-1 | P0 | Show photos from **Apple Photos** (see §6 for the integration approach). |
| PHO-2 | P0 | Choose which albums are shown. |
| PHO-3 | P0 | Slideshow with a configurable interval (default 30 s) and transition (fade / Ken Burns). |
| PHO-4 | P0 | Start the photo frame automatically after N minutes of no touch (default 5 min). Any touch returns to the previous screen. |
| PHO-5 | P0 | Handle portrait and landscape photos well (blurred-background fill, no awkward cropping of faces). |
| PHO-6 | P0 | Cache photos locally so the slideshow works offline and doesn't re-download. Resize to display resolution. |
| PHO-7 | P1 | Overlay a clock, date, weather, and next event on the photo frame (each can be turned off). |
| PHO-8 | P1 | Hide a specific photo from the slideshow with a long-press (adult only). |
| PHO-9 | P1 | Also support a local folder or SMB share on the home server as a photo source. |
| PHO-10 | P2 | Play short videos / Live Photos muted. |
| PHO-11 | P2 | "On this day" mode: favor photos from this date in past years. |
| PHO-12 | P2 | Google Photos as a source (subject to Google's restricted Library API). |

### 3.4 Chores and Gold Stars (Gamification)
The main audience is a young child. Completing a chore should feel like an event.

| ID | Pri | Requirement |
|---|---|---|
| CHO-1 | P0 | Adults create chores with a title, icon/emoji, assigned member(s), star value (default 1), and schedule (one-time, daily, specific weekdays, weekly, monthly). |
| CHO-2 | P0 | Chores can be grouped by time of day (Morning / After School / Evening / Anytime). |
| CHO-3 | P0 | A **Chores** screen shows each child's chores for today as large, colorful cards with a big **"I did it!"** button. |
| CHO-4 | P0 | Tapping "I did it!" plays a **celebration**: animation (confetti / star flying into the star jar), sound effect, and the star counter going up. |
| CHO-5 | P0 | Each child has a **star balance** shown as gold stars (not just a number), e.g. a filling star jar. |
| CHO-6 | P0 | **Undo** a completion for 10 seconds after tapping (accidental taps happen), and adults can undo any time later. |
| CHO-7 | P0 | When all of today's chores are done, show a bigger "All done!" celebration. |
| CHO-8 | P0 | Track history: who completed what, when, and stars earned. |
| CHO-9 | P0 | **Parent approval (on by default)**: tapping "I did it!" still plays the celebration, but the star appears as a *pending* (outlined/silver) star marked "Waiting for grown-up". An adult approves on the wall (PIN) or from the phone admin UI. Then the star turns gold and flies into the jar with a second, smaller celebration. Adults can reject with an optional note. Approval can be turned off per chore. |
| CHO-10 | P1 | **Streaks**: count consecutive days with all chores done, with bonus stars at milestones (e.g. 3, 7, 30 days). Configurable. |
| CHO-11 | P1 | Adults can give **bonus stars** ad hoc ("Great job sharing!") with an optional note, and remove stars (with a note). |
| CHO-12 | P1 | Choose celebration sounds and themes; volume control and a mute schedule (no sounds during quiet hours). |
| CHO-13 | P1 | **Routines**: ordered checklists (Morning: brush teeth → get dressed → shoes on) shown one step at a time with picture icons for pre-readers. |
| CHO-14 | P2 | Collectible badges/stickers for milestones (first 100 stars, 7-day streak). |
| CHO-15 | P2 | Weekly summary on the parent's phone view (stars earned, chores missed). |

### 3.5 Rewards
| ID | Pri | Requirement |
|---|---|---|
| REW-1 | P0 | Adults define rewards with a name, picture, and star cost (e.g. "Ice cream trip — 20 ⭐", "New LEGO set — 100 ⭐"). |
| REW-2 | P0 | Each child has one **current goal reward** shown with a progress bar / filling jar ("42 of 100 stars"). |
| REW-3 | P0 | When the balance reaches the goal, show a big "You earned it!" celebration and notify adults. |
| REW-4 | P0 | Redeeming a reward requires an adult PIN and subtracts the stars. Redemptions are logged. |
| REW-5 | P1 | A reward "shop" showing all available rewards so the child can pick their next goal. |
| REW-6 | P1 | Small and big rewards at the same time: stars can be spent on small rewards or saved for the big goal. Spending on a small reward shows its effect on the big goal before confirming. |
| REW-7 | P2 | Stars convert to allowance money at an adult-set rate, tracked as a ledger. |

### 3.6 Lists, Meals, and Extras
| ID | Pri | Requirement |
|---|---|---|
| LST-1 | P1 | Shared lists (Grocery, To-Do, Packing) with check-off, editable from the touchscreen and phone. |
| LST-2 | P1 | On-screen keyboard optimized for touch; voice dictation not required. |
| MEAL-1 | P1 | Weekly meal plan (breakfast/lunch/dinner/snack) shown in the week view and on its own screen. |
| MEAL-2 | P2 | Saved recipes/meals that can be reused, with ingredients added to the grocery list in one tap. |
| WX-1 | P1 | Current weather and a 5-day forecast from a free, keyless API (e.g. Open-Meteo or the US National Weather Service). |
| CD-1 | P1 | Countdowns to upcoming events, shown on the home screen. |
| MSG-1 | P2 | Family message board / sticky notes. |
| TMR-1 | P2 | Kitchen timers usable from the touchscreen. |

### 3.7 Display, Sleep Mode, and Power
| ID | Pri | Requirement |
|---|---|---|
| SLP-1 | P0 | **Scheduled sleep mode**: at a configurable time (default 9:30 PM) the display turns fully off; it turns back on at a configurable wake time (default 6:30 AM). Separate weekday and weekend schedules. |
| SLP-2 | P0 | **"Sleep now" button** always reachable from the main navigation. It turns the monitor off right away (true display power-off/DPMS, not just a black screen). |
| SLP-3 | P0 | **Touch to wake**: touching the screen while asleep turns it on. During scheduled night hours, it goes back to sleep after a short timeout (default 2 min). |
| SLP-4 | P1 | Optional **night clock** mode instead of fully off: dim, low-blue-light clock with the next morning's first event. |
| SLP-5 | P1 | Brightness schedule (dimmer in the evening), if the display supports software brightness control. |
| SLP-6 | P2 | Wake on presence with a PIR/mmWave motion sensor on the Pi's GPIO; sleep after no motion for N minutes. |
| SLP-7 | P2 | Turn sleep on/off from Home Assistant (MQTT or REST), if we adopt it. |
| DSP-1 | P0 | Run full-screen in kiosk mode with no browser UI, cursor, or OS popups visible. |
| DSP-2 | P0 | Start automatically on power-up and recover on its own from crashes, network loss, and power cuts without a keyboard. |

### 3.8 Touch UI and Navigation
| ID | Pri | Requirement |
|---|---|---|
| UI-1 | P0 | Designed for touch first: tap targets ≥ 60 px (bigger on kid screens), no hover-only interactions, swipe between days/weeks. |
| UI-2 | P0 | Persistent navigation: **Calendar · Chores · Photos · Lists · Meals · Sleep**, plus a settings gear (PIN protected). |
| UI-3 | P0 | Readable from across the room: large clock/date header, high contrast, legible fonts. |
| UI-4 | P0 | Kid-friendly chore screens: icons and pictures, minimal reading needed. |
| UI-5 | P1 | Light and dark themes; dark theme turns on automatically in the evening. |
| UI-6 | P1 | Return to the home screen after N minutes idle (before the photo frame starts). |
| UI-7 | P2 | Seasonal/holiday themes. |

### 3.9 Administration and Remote Access
| ID | Pri | Requirement |
|---|---|---|
| ADM-1 | P0 | Web admin UI usable from a phone on the home network for all setup: accounts, calendars, albums, family members, chores, rewards, schedules. |
| ADM-2 | P0 | Adult **PIN** (4–6 digits) protects settings, approvals, and reward redemption on the touchscreen. |
| ADM-3 | P0 | Setup steps for connecting Google and iCloud are guided in the UI. Connections that need re-authentication show a clear warning on the admin screen. |
| ADM-4 | P1 | Remote access when away from home over a private VPN (e.g. Tailscale/WireGuard), without exposing ports to the internet. |
| ADM-5 | P1 | Export/import all app data (JSON) for backup and migration. |
| ADM-6 | P2 | Push notifications to parents (e.g. reward earned, approval waiting) via a free self-hosted service such as ntfy. |

## 4. Non-Functional Requirements

| ID | Pri | Requirement |
|---|---|---|
| NFR-1 | P0 | **Cost**: no recurring fees. Only free tiers of Google/Apple and free open-source software. |
| NFR-2 | P0 | **Privacy**: all family data (events cache, photos cache, chores, stars) is stored on our hardware. No telemetry or third-party analytics. |
| NFR-3 | P0 | **Security**: LAN-only by default. Credentials (OAuth tokens, app-specific passwords) are encrypted at rest and never committed to git. Admin endpoints require authentication. |
| NFR-4 | P0 | **Performance on Raspberry Pi 5**: screen changes < 300 ms, animations smooth (≥ 30 fps), photo transitions without stutter. |
| NFR-5 | P0 | **Reliability**: runs unattended for months. Watchdog restarts the kiosk browser and server if they stop responding. Tolerates SD-card wear (prefer SSD/NVMe or a read-mostly OS image). |
| NFR-6 | P0 | **Offline tolerance**: if the internet or home server is down, the display keeps showing cached calendar, photos, and chores. Chore completions are queued and synced later. |
| NFR-7 | P0 | **Backups**: the database is backed up nightly (Unraid appdata backup now; Time Machine or a scheduled copy on the Mac mini), and at least 30 days of backups are kept. |
| NFR-8 | P1 | **Maintainability**: deployed as Docker container(s) with a single compose file. Updates are a one-command pull/restart. |
| NFR-9 | P1 | **Accessibility**: WCAG AA contrast; sound is never the only signal. |
| NFR-10 | P1 | **Time zone / locale**: configurable time zone, 12/24-hour clock, week start day. |
| NFR-11 | P0 | **Portable hosting**: the server runs from the same compose file on Unraid (linux/amd64) and on the Mac mini (Docker on macOS, arm64). Multi-arch images. All state lives in one data volume, so moving hosts means copying that volume and changing the Pi's server URL. |

## 5. Hardware and Hosting

### Decision
- **Server: Mac mini** (arriving early December 2026). Runs the app server, database, sync workers, and photo cache, in Docker plus a small native helper for Apple Photos (see §6).
- **Interim server: Unraid**, in Docker, until the Mac mini arrives. Then move the data volume over (NFR-11).
- **Wall display: Raspberry Pi 5** as a thin kiosk client (Chromium in kiosk mode). It also handles display power and touch, and caches data so the display keeps working if the server is down (NFR-6).

Rejected: all-in-one Pi (too much photo processing and sync work on the Pi, backups harder) and a server driving the display directly (the server isn't near the wall).

### Reference Hardware
- Raspberry Pi 5 (4 GB or 8 GB), official 27 W power supply, active cooler, NVMe or high-endurance SD card.
- **Display: ViewSonic ID2456-4K** (24", 3840×2160 IPS, 10-point PCAP touch, MPP 2.0 stylus, kickstand). Video over HDMI from the Pi. Touch over a USB cable from the monitor's USB-B/USB-C upstream port to a Pi USB-A port. **VESA 75×75** wall mount (smaller than the common 100×100, so check the mount). No built-in speakers are listed; it has an audio-out jack.
- **Display checks before building on it** (see beads): (1) when the Pi turns the HDMI output off, does the panel go to standby while the USB touch controller stays powered (touch to wake, SLP-3)? (2) Is Chromium on the Pi 5 smooth at native 4K (NFR-4), or should the Pi output 2560×1440 / 1920×1080? The UI must lay out correctly at any of these. (3) Does audio over HDMI → monitor audio-out → small powered speaker work for celebration sounds?
- Low-profile wall mount with power and HDMI routed behind the screen (in-wall power kit).
- Small powered speaker on the monitor's audio-out jack (CHO-4). Optional: PIR/mmWave sensor (SLP-6).

## 6. Integration Notes and Risks

| Area | Approach | Risk / Mitigation |
|---|---|---|
| **Google Calendar** | Google Calendar API with OAuth 2.0 from our own Google Cloud project (free). | If the OAuth app stays in "Testing" status, refresh tokens expire after 7 days. **Set the app to "In production"** (unverified is fine for personal use) so tokens last. |
| **Apple Calendar** | iCloud CalDAV (`caldav.icloud.com`) with an Apple ID **app-specific password**. Read and write. | App-specific passwords are revoked if the Apple ID password changes. Show a re-auth warning (ADM-3). |
| **Apple Photos** | Apple has **no official iCloud Photos API**. Options in order of preference: **(0) Mac mini (preferred once it arrives):** sign the Mac mini into iCloud Photos and have a native helper (e.g. `osxphotos` on a launchd schedule) export chosen albums to a folder the app reads. This uses Apple's own sync, so no 2FA re-auth and it works with Advanced Data Protection. **(1)** Shared Album with a public website link: read the shared-stream feed (used by many open-source photo frames). **(2)** `icloudpd` (iCloud Photos Downloader) container on Unraid syncs chosen albums to a local folder. **(3)** Export albums from a Mac to an Unraid share (PHO-9). | (1) is unofficial and could break. Albums are capped at 5,000 items. (0) needs enough disk on the Mac mini for the iCloud library ("Optimize Mac Storage" keeps originals in the cloud; the export pulls only what's needed), and Docker on macOS can't read the Photos library directly, so the helper must run natively. (2) needs 2FA re-authentication about every 2 months and doesn't work with Advanced Data Protection on. Support the local-folder source as a fallback whatever we choose. |
| **Display power** | On Raspberry Pi OS (Wayland/labwc): `wlr-randr --output HDMI-A-1 --off/--on`. Fallback is HDMI-CEC (`cec-ctl`) for TV-style panels. A small agent on the Pi accepts sleep/wake commands from the app. | Some monitors go into deep standby and stop powering USB touch, which breaks touch to wake. Check the chosen monitor before buying. |
| **Weather** | Open-Meteo (free, no API key). | None significant. |

## 7. Data Model (high level)
- **Member**: id, name, role (adult/child), color, avatar, PIN hash (adults).
- **CalendarSource**: id, provider (google/icloud/ics), credentials ref, calendars[], member mapping, last sync.
- **Event (cache)**: source id, external id, title, start/end, all-day, recurrence, location, notes, members.
- **PhotoSource / Photo (cache)**: source, album, file path, dimensions, taken date, hidden flag.
- **Chore**: id, title, icon, members[], stars, schedule (RRULE), time-of-day group, requires approval.
- **ChoreCompletion**: chore id, member id, date, completed at, status (pending/approved/undone), stars awarded.
- **StarTransaction** (ledger): member, delta, reason (chore/bonus/streak/redemption/adjustment), ref id, note, timestamp. **The balance is always computed from the ledger.**
- **Reward**: id, title, image, cost, active. **Goal**: member, reward id. **Redemption**: reward, member, approved by, timestamp.
- **List / ListItem**, **MealPlanEntry**, **Countdown**, **Settings** (schedules, theme, timeouts).

## 8. Release Phases

| Phase | Scope |
|---|---|
| **MVP (v0.1)** | Kiosk setup on the Pi, family profiles, Google + iCloud + ICS calendars (read-only), Today/Week/Month views, photo frame from a local folder (Apple Photos via the Mac mini helper after the migration), parent approval for chores, one child profile, chores with gold stars + celebrations + undo, one reward goal with redemption, scheduled sleep + Sleep-now button + touch to wake, admin web UI with PIN. |
| **v0.2** | Event create/edit, streaks, bonus stars, routines, weather, countdowns, night clock. |
| **v0.3** | Lists, meal planning, reward shop, remote access over VPN, data export, notifications. |
| **Later** | Motion-sensor wake, Home Assistant integration, Outlook, badges, allowance ledger, themes. |

## 9. Acceptance Criteria (MVP)
1. With the network unplugged, the display still shows today's events and photos, and chores can still be completed. When the network returns, completions sync.
2. An event added on an iPhone (iCloud) and one added in Google Calendar on the web both appear on the display within 5 minutes.
3. The child can complete a chore without help and sees and hears the celebration. A pending star appears; after a parent approves (on the wall or from a phone), it turns gold and the star jar visibly fills.
4. Reaching the goal triggers the reward celebration. Redeeming requires the adult PIN and correctly reduces the balance.
5. At the scheduled bedtime the monitor powers off (backlight off). Touching it wakes it, and it goes back to sleep after the timeout. "Sleep now" turns the monitor off within 2 seconds.
6. After pulling the power and plugging it back in, the hub returns to the home screen within 2 minutes with no keyboard or mouse.
7. No subscription, payment method, or paid API key is needed anywhere in the setup.

## 10. Open Questions
1. ~~**Hosting**~~ — **Decided 2026-10-15:** Mac mini server (from early December), Unraid in the meantime, Pi kiosk on the wall. See §5.
2. ~~**Apple Photos**~~ — **Decided 2026-10-15:** plain local folder on Unraid to start. On the Mac mini, a native `osxphotos` export of the iCloud-synced library into that folder.
3. ~~**Screen**~~ — **Decided 2026-10-15:** ViewSonic ID2456-4K, 24" 4K touch (§5). Orientation is still open: assumed **landscape** unless told otherwise.
4. ~~**Children**~~ — **Decided 2026-10-15:** one child profile for now (the data model still supports more). Chores use pictures plus short text.
5. ~~**Approval**~~ — **Decided 2026-10-15:** stars need parent approval by default (CHO-9, now in the MVP).
6. **Write-back**: do we need event creation from the wall screen in the MVP, or is the phone enough?
7. **Remote access**: is Tailscale already in use on the home network (Unraid / Mac mini)?
8. ~~**Sound**~~ — The ID2456-4K lists no speakers, so add a small powered speaker on its audio-out jack.
