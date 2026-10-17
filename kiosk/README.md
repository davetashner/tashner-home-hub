# Pi kiosk (hub-8lc.4)

Provisions a Raspberry Pi 5 as the wall display: Chromium in kiosk mode on labwc (Wayland), auto-login, auto-restart, hang watchdog, rotation with matching touch. Requirements: DSP-1, DSP-2, NFR-5, UI-8.

> **Status: written without access to a Pi. Nothing here has run on hardware.** See "Not yet verified" below; the bench test is hub-8lc.9.

## What it sets up

| Piece | How |
|---|---|
| Dedicated `kiosk` user, locked password | `useradd`, auto-login via `/etc/lightdm/lightdm.conf.d/50-hub-kiosk.conf` (session `rpd-labwc` if present, else `labwc`) |
| Only the kiosk runs at login | `~kiosk/.config/labwc/autostart` replaces the system one, so no panel, desktop, notifications, keyring or update popups start. Chromium uses `--password-store=basic` |
| Chromium kiosk | `/usr/local/lib/hub-kiosk/hub-kiosk-launch`, persistent profile `~kiosk/.local/share/hub-kiosk/chromium-profile` (service-worker cache survives reboots) |
| Crash recovery | user unit `hub-kiosk.service`, `Restart=always`, `RestartSec=5`, no start limit |
| Hang recovery | `hub-kiosk-watchdog.timer` every 30 s checks Chromium's DevTools endpoint (127.0.0.1 only); 3 misses in a row restarts the service |
| Server down at boot | Chromium still opens `HUB_URL` (service worker serves cache if it has one). If it lands on an error page, the watchdog reopens the URL once `HUB_HEALTH_URL` answers. A server outage never restarts Chromium |
| Full freeze | `RuntimeWatchdogSec=15` in `/etc/systemd/system.conf.d/10-hub-watchdog.conf` (hardware watchdog) |
| Rotation | `wlr-randr --output <OUTPUT> --mode <RESOLUTION> --transform <ORIENTATION>` plus a libinput calibration matrix and `mapToOutput` in labwc `rc.xml` |
| Hidden cursor | invisible Xcursor theme `hub-blank` set in labwc `environment`; `INPUT="mouse"` shows a normal pointer and makes Esc minimize the hub |

## First boot

1. Flash **Raspberry Pi OS (64-bit) with desktop** using Raspberry Pi Imager. In its settings set hostname, an admin user, SSH, and Wi-Fi if not using Ethernet (enter Wi-Fi in Imager only; never commit it).
2. Boot, SSH in, `sudo apt update && sudo apt full-upgrade -y`, reboot.
3. Plug the ViewSonic via HDMI (video) and USB (touch). Find the output name: `wlr-randr` (run from a desktop terminal or `sudo -u <user> WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 wlr-randr`).
4. Clone the repo, then:
   ```
   cd kiosk
   cp kiosk.conf.example kiosk.conf   # untracked; edit values
   sudo ./install.sh
   sudo reboot
   ```

## Config (`kiosk.conf`)

| Key | Meaning |
|---|---|
| `HUB_URL` | page to open, e.g. `http://hub.local:3000`. Keep it plain: the launcher adds `?display=wall` itself |
| `HUB_HEALTH_URL` | reachability probe used for error-page recovery |
| `ORIENTATION` | `normal`, `90`, `180`, `270` |
| `OUTPUT` | `wlr-randr` output name (`HDMI-A-1`) |
| `RESOLUTION` | `2560x1440` default; `3840x2160` only if the bench test is smooth |
| `TOUCH_MATRIX` | optional override (six numbers) |
| `DEBUG_PORT` | DevTools port, localhost only (Chromium 136+ only honours it with a non-default profile dir, which we use) |

## Rotating

Edit `kiosk.conf` (`ORIENTATION`), re-run `sudo ./install.sh`, `sudo reboot`. Matrices used (libinput, per labwc-config(5)):

| ORIENTATION | transform | `calibrationMatrix` |
|---|---|---|
| normal | normal | `1 0 0 0 1 0` |
| 90 | 90 | `0 -1 1 1 0 0` |
| 180 | 180 | `-1 0 1 0 -1 1` |
| 270 | 270 | `0 1 0 -1 0 1` |

The 90/270 rows may be swapped relative to `wlr-randr`'s direction; if taps land mirrored, set `TOUCH_MATRIX` to the other one. If rotation works but the touch needs no matrix on your labwc version (mapToOutput alone may rotate), use `TOUCH_MATRIX="1 0 0 0 1 0"`.

### Wall display role

Every browser is a *wall display* or a *personal device* (DEV-1); only wall displays go home and show the photo frame when idle. The kiosk must be a wall display, so `hub-kiosk-launch` (and the watchdog's reopen) open `HUB_URL` with `?display=wall`. The hub turns that into a long-lived `hub_display=wall` cookie in the kiosk's Chromium profile and redirects to the URL without the query. No `kiosk.conf` change is needed, but re-run `sudo ./install.sh` so the updated scripts are installed. If the profile directory is wiped, the next launch sets the role again. A grown-up can also change a browser's role under Settings, Screen.

### Orientation endpoint (for the display agent)

A grown-up picks the direction under Settings, Orientation. The hub stores it and serves it, read-only and cheap, for the display agent to poll:

```
GET {HUB_URL}/api/display/orientation
-> { "rotation": "normal" | "90" | "180" | "270", "orientation": "landscape" | "portrait" }
```

`rotation` is a `wlr-randr --transform` value, so it maps straight onto the `ORIENTATION` table above (the same matrices apply). `orientation` is `portrait` for 90 and 270. Until someone changes it the answer is `normal`. The page layout follows the real screen shape by itself; the agent only has to rotate the output and touch input.

### Display power (sleep schedule)

The hub decides when the screen should be on. The agent only polls and obeys (SLP-1..3). All three endpoints are unauthenticated (LAN only) and answer `cache-control: no-store`:

```
GET  {HUB_URL}/api/display/power
-> { "power": "on" | "off", "reason": "schedule" | "sleep-now" | "wake" | "disabled", "until"?: ISO time }

POST {HUB_URL}/api/display/wake    (touch while the screen is off; same body as above)
POST {HUB_URL}/api/display/sleep   (the nav "Sleep" button; same body, status 202)
```

- Poll `GET /api/display/power` every few seconds and switch the monitor to `power`. `until` is when the hub expects the next change (informational; keep polling).
- When the screen is off and is touched, call `POST /api/display/wake`, then switch on at once and keep polling. At night the hub puts the screen back to sleep after the re-sleep timeout (default 2 min, `reason: "wake"` while it is on); a touch while on does not need a call, but calling again restarts the timeout. In the day a wake changes nothing.
- "Sleep now" keeps the screen off until the next scheduled wake-up (or a touch). With the schedule switched off it lasts until a touch.
- Schedule: Settings, Sleep schedule (default 21:30 off, 06:30 on). A night counts as a weekend night when the morning it ends on is a Saturday or Sunday (so Friday and Saturday bedtimes use the weekend times). Times are in the household time zone.

### Display agent (monitor power and touch to wake)

`kiosk/display-agent/hub_display_agent.py` (Python 3, standard library only) is installed as `/usr/local/lib/hub-kiosk/hub-kiosk-display-agent` and run by the user unit `hub-kiosk-display-agent.service` (started from the labwc autostart, restarts always). It uses the endpoints above and nothing else, so the server needs no access to the Pi.

- Polls `GET /api/display/power` every `POWER_POLL_SECONDS` (default 1 s, to meet "off within 2 s") and runs `wlr-randr --output <OUTPUT> --off` or `--on`. `OUTPUT` from `kiosk.conf` is used if `wlr-randr` lists it; otherwise the first listed output is used.
- If `wlr-randr` fails and `CEC_BACKEND` is `cec-ctl` or `cec-client`, it tries HDMI-CEC standby / on instead.
- Reads the touchscreen straight from `/dev/input/event*` (struct reads, no libraries; the `kiosk` user is in the `input` group), so touch works while the output is off. `TOUCH_DEVICE` overrides detection.
- Touch while off: grabs the touch device exclusively (`EVIOCGRAB`) while the screen is off and until the waking finger lifts, so Chromium never sees the wake tap (SLP-3); the page also swallows taps for 700 ms after the display comes back (wake guard). Switches on first, then `POST /api/display/wake`. The hub applies the night re-sleep timeout; the next poll turns the screen off again. A touch while on at night re-posts wake (at most every 20 s) to restart the timeout. If the hub is down, the screen stays on for `OFFLINE_WAKE_SECONDS`.
- Hub unreachable: the screen is left as it is; polling backs off from 2 s to 30 s.
- Logs go to journald: `sudo journalctl _UID=$(id -u kiosk) -e | grep display-agent`.

Tests (no Pi needed): `cd kiosk/display-agent && python3 -m unittest`. CI does not run them yet (the workflow is protected); hub-ugl.12 may add shellcheck.

## Updating

- Kiosk files: `git pull`, `sudo ./install.sh`, reboot. The script is idempotent.
- App: nothing on the Pi; the server is updated and the page reloads (service worker handles refresh).
- OS: `sudo apt full-upgrade` over SSH, reboot.

## Troubleshooting

```
sudo -u kiosk XDG_RUNTIME_DIR=/run/user/$(id -u kiosk) systemctl --user status hub-kiosk.service hub-kiosk-watchdog.timer
sudo journalctl _UID=$(id -u kiosk) -e          # user-unit logs
curl -s http://127.0.0.1:9222/json/list         # on the Pi: is Chromium alive?
```

- Black screen / wrong mode: check `wlr-randr` output name and that `RESOLUTION` is listed for it.
- Desktop shows instead of kiosk: confirm `/etc/lightdm/lightdm.conf.d/50-hub-kiosk.conf` and the session name in `/usr/share/wayland-sessions/`. Alternative: `sudo raspi-config` > System Options > Boot / Auto Login > Desktop Autologin, then set the user to `kiosk`.
- Cursor visible on the touch wall: check `INPUT="touch"` in `kiosk.conf`, re-run `install.sh`, reboot.
- Using a mouse and keyboard: set `INPUT="mouse"`, re-run `install.sh`, reboot. Esc minimizes the hub (restore it from the taskbar); the hub's own Esc-to-close sheets then close by tapping only.
- Need to leave kiosk: SSH in; `systemctl --user stop hub-kiosk.service` as above.
- Not covered: read-only root / overlay filesystem and SSD boot (NFR-5 SD wear). Prefer NVMe/SSD; or `raspi-config` overlay filesystem after setup (the Chromium profile dir would then need to live on a writable partition).

### kioskctl: debug the Pi from your machine

`scripts/kiosk/kioskctl.mjs` (hub-suy) runs every check above from a dev machine, so nobody (human or agent) has to log in to the Pi. It uses SSH plus a port-forward to Chromium's DevTools (localhost on the Pi). Each command prints JSON and has a timeout, so a hung page never hangs the tool. Exit codes: 0 means ok, 1 means a check or the page failed, and 2 means a usage or connection error.

```
export KIOSK_HOST=admin@kiosk.example.com KIOSK_SSH_KEY=~/.ssh/kiosk   # SSH user needs passwordless sudo
node scripts/kiosk/kioskctl.mjs doctor          # start here
node scripts/kiosk/kioskctl.mjs screenshot --out wall.png --scale 0.5
node scripts/kiosk/kioskctl.mjs eval 'document.title'
node scripts/kiosk/kioskctl.mjs trace https://hub.example/ --secs 10   # lists requests that never finished
node scripts/kiosk/kioskctl.mjs reload | restart | sw status | sw reset | logs --lines 50 | tunnel
```

`doctor` checks: SSH; the Chromium process and its flags; the emoji font; the display mode; the kiosk units; the server, reached from the Pi with curl and from inside Chromium (the two can disagree); DevTools; whether the page loaded and hydrated; whether the wave background is drawn *and* visible; and the wall display role. Lessons it encodes:

- **Curl works but every Chromium request hangs:** the default password store is a gnome-keyring that auto-login never unlocks, and Chromium waits on it for every request. Use `--password-store=basic` (the kiosk launcher does; for desktop Chromium, put it in `/etc/chromium.d/`).
- **`readyState` stuck at `loading` with no `__sveltekit_*` global:** the inline bootstrap is waiting on a stylesheet or script that never arrived. Run `trace`.
- `restart` restarts `hub-kiosk.service` if it exists. Otherwise it relaunches the same Chromium command line through `/usr/bin/chromium` in a transient user unit, so `/etc/chromium.d` flags still apply.

## Not yet verified on hardware (bench test: hub-8lc.9)

- [ ] `install.sh` runs clean on a fresh Pi OS image (package names `chromium`, `wlr-randr`, `xcursorgen`; `raspi-config nonint do_blanking`)
- [ ] Auto-login reaches the `kiosk` labwc session (lightdm key names, session name `rpd-labwc` vs `labwc`)
- [ ] User systemd services start from labwc autostart with imported `WAYLAND_DISPLAY`
- [ ] Chromium comes up full-screen with no bubbles, popups or keyring prompt; GPU rasterization active (`chrome://gpu`)
- [ ] Invisible cursor theme works under labwc/Chromium
- [ ] `wlr-randr` mode and transform apply at boot, at 2560x1440 and 3840x2160
- [ ] Touch accuracy in all four orientations; 90 vs 270 matrix direction; labwc `rc.xml` element names (`<touch mapToOutput>`, `<device category="touch"><calibrationMatrix>`)
- [ ] 10-point multitouch works; pinch zoom and overscroll navigation are off
- [ ] Kill Chromium (`pkill chromium`): restarts within ~10 s
- [ ] Hang (`pkill -STOP chromium`): restarted by watchdog in ~2 min
- [ ] Hardware watchdog reboots on forced freeze (`echo c > /proc/sysrq-trigger` with caution, or stop `systemd`'s petting)
- [ ] Boot with server unreachable: page opens (cached if SW installed), recovers automatically when server returns
- [ ] Power-cut recovery (no crash-restore bubble); monitor behaviour on HDMI standby and USB touch power (relevant to the display agent)
- [ ] Display agent: `wlr-randr --output X --off` really powers the panel down and `--on` restores the mode and rotation (else re-apply `hub-kiosk-apply-display` after `--on`)
- [ ] Display agent: USB touch stays powered while HDMI is off, and `/dev/input/event*` still reports touches (SLP-3); the wake tap does not reach Chromium (the `EVIOCGRAB` grab works on the Pi, and is released after the finger lifts; hub-8lc.9)
- [ ] Display agent: touch detection picks the ViewSonic (else set `TOUCH_DEVICE`); `wlr-randr` works from the user unit (WAYLAND_DISPLAY imported)
- [ ] Display agent: "Sleep now" turns the monitor off within 2 s; night wake re-sleeps after the timeout; CEC fallback if `wlr-randr` is not enough
- [ ] Soak: runs unattended for days

## Offline caching and automation flags

The hub's service worker (offline tolerance, NFR-6) stays on in headed Chromium, including with `--remote-debugging-port`. It switches itself off only for headless automation (`HeadlessChrome` user agent). Do not launch the kiosk with `--enable-automation`, which sets `navigator.webdriver` and is meant for test drivers, not the wall. Set `localStorage['hub.sw']` to `on` or `off` to force the worker either way.
