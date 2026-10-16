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
| Hidden cursor | invisible Xcursor theme `hub-blank` set in labwc `environment` |

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
| `HUB_URL` | page to open, e.g. `http://hub.local:3000` |
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

### Orientation endpoint (for the display agent)

A grown-up picks the direction under Settings, Orientation. The hub stores it and serves it, read-only and cheap, for the display agent to poll:

```
GET {HUB_URL}/api/display/orientation
-> { "rotation": "normal" | "90" | "180" | "270", "orientation": "landscape" | "portrait" }
```

`rotation` is a `wlr-randr --transform` value, so it maps straight onto the `ORIENTATION` table above (the same matrices apply). `orientation` is `portrait` for 90 and 270. Until someone changes it the answer is `normal`. The page layout follows the real screen shape by itself; the agent only has to rotate the output and touch input.

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
- Cursor visible: also set `cursor: none` in the app CSS.
- Need to leave kiosk: SSH in; `systemctl --user stop hub-kiosk.service` as above.
- Not covered: read-only root / overlay filesystem and SSD boot (NFR-5 SD wear). Prefer NVMe/SSD; or `raspi-config` overlay filesystem after setup (the Chromium profile dir would then need to live on a writable partition).

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
- [ ] Soak: runs unattended for days

## Offline caching and automation flags

The hub's service worker (offline tolerance, NFR-6) stays on in headed Chromium, including with `--remote-debugging-port`. It switches itself off only for headless automation (`HeadlessChrome` user agent). Do not launch the kiosk with `--enable-automation`, which sets `navigator.webdriver` and is meant for test drivers, not the wall. Set `localStorage['hub.sw']` to `on` or `off` to force the worker either way.
