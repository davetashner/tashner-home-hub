#!/usr/bin/env bash
# Provision a Raspberry Pi (64-bit Raspberry Pi OS, Wayland/labwc) as the Home Hub kiosk.
# Idempotent: safe to re-run after editing kiosk.conf. Usage: sudo ./install.sh [path/to/kiosk.conf]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="${1:-$HERE/kiosk.conf}"
KIOSK_USER="kiosk"
LIB_DIR="/usr/local/lib/hub-kiosk"
CONF_DST="/etc/hub-kiosk/kiosk.conf"

die() { echo "install.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || die "run as root: sudo $0"
[ -f "$CONF_SRC" ] || die "missing $CONF_SRC (cp $HERE/kiosk.conf.example $HERE/kiosk.conf and edit)"

# shellcheck source=/dev/null
. "$CONF_SRC"
: "${HUB_URL:?HUB_URL must be set in kiosk.conf}"
: "${ORIENTATION:=normal}"
: "${OUTPUT:=HDMI-A-1}"
: "${RESOLUTION:=2560x1440}"
: "${TOUCH_MATRIX:=}"
: "${INPUT:=touch}"
: "${CEC_MODE:=fallback}"
: "${BT_SPEAKER:=}"
: "${SPEAKER_API_TOKEN_FILE:=/etc/hub-kiosk/speaker-api.token}"
: "${SPOTIFY_CONNECT:=off}"
: "${SPOTIFY_INITIAL_VOLUME:=40}"
case "$ORIENTATION" in normal | 90 | 180 | 270) ;; *) die "ORIENTATION must be normal|90|180|270" ;; esac
[[ "$OUTPUT" =~ ^[A-Za-z0-9_-]+$ ]] || die "OUTPUT looks wrong: $OUTPUT"
[[ "$RESOLUTION" =~ ^[0-9]+x[0-9]+$ ]] || die "RESOLUTION must look like 2560x1440"
[[ "$HUB_URL" =~ ^https?:// ]] || die "HUB_URL must start with http:// or https://"
case "$INPUT" in touch | mouse) ;; *) die "INPUT must be touch|mouse" ;; esac
case "$CEC_MODE" in fallback | also) ;; *) die "CEC_MODE must be fallback|also" ;; esac
[ "$CEC_MODE" != also ] || [ -n "${CEC_BACKEND:-}" ] || die "CEC_MODE=also needs CEC_BACKEND=cec-ctl|cec-client"
case "$SPOTIFY_CONNECT" in on | off) ;; *) die "SPOTIFY_CONNECT must be on|off" ;; esac
[[ "$SPOTIFY_INITIAL_VOLUME" =~ ^([0-9]|[1-9][0-9]|100)$ ]] || die "SPOTIFY_INITIAL_VOLUME must be 0-100"

# Spotify Connect (hub-txj.2): Raspotify's pinned arm64 .deb (MIT; wraps librespot, MIT). Never
# fetched unverified: the download must match this SHA-256 or the install stops.
RASPOTIFY_VERSION="0.48.3"
RASPOTIFY_DEB="raspotify_0.48.3.librespot.v0.8.0-939dc5e_arm64.deb"
RASPOTIFY_SHA256="2097b3994824cf17163ecc47c6f6a5a695202987e2ab0b650f50d663291c63f2"
RASPOTIFY_URL="https://github.com/dtcooper/raspotify/releases/download/$RASPOTIFY_VERSION/$RASPOTIFY_DEB"
[ -z "$BT_SPEAKER" ] || [[ "$BT_SPEAKER" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]] ||
  die "BT_SPEAKER must look like AA:BB:CC:DD:EE:FF"

# libinput calibration matrices (labwc-config(5) / libinput docs, clockwise rotation).
# Which of 90/270 matches wlr-randr's --transform direction is confirmed on hardware (hub-8lc.9).
if [ -z "$TOUCH_MATRIX" ]; then
  case "$ORIENTATION" in
    normal) TOUCH_MATRIX="1 0 0 0 1 0" ;;
    90) TOUCH_MATRIX="0 -1 1 1 0 0" ;;
    180) TOUCH_MATRIX="-1 0 1 0 -1 1" ;;
    270) TOUCH_MATRIX="0 1 0 -1 0 1" ;;
  esac
fi
[[ "$TOUCH_MATRIX" =~ ^(-?[0-9.]+[[:space:]]+){5}-?[0-9.]+$ ]] || die "TOUCH_MATRIX needs six numbers"

# Automation flags set navigator.webdriver, which the app treats as "under test" (still wave
# background, evening theme and dimming pinned off). Comments may mention them; code may not.
if grep -v '^[[:space:]]*#' "$HERE/bin/hub-kiosk-launch" |
  grep -qE -- '--(enable-automation|headless|test-type)'; then
  die "bin/hub-kiosk-launch must not pass --enable-automation, --headless or --test-type"
fi

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# Package is `chromium` on current Raspberry Pi OS (older images: chromium-browser).
apt-get install -y curl python3 wlr-randr || die "base package install failed"
# xcursorgen is its own package on bookworm; trixie folds it into x11-apps.
apt-get install -y xcursorgen || apt-get install -y x11-apps || die "xcursorgen install failed"
apt-get install -y chromium || apt-get install -y chromium-browser
# Bluetooth speaker (hub-txj.1): bluez plus PipeWire's Bluetooth plugin and its CLI tools.
apt-get install -y bluez libspa-0.2-bluetooth pipewire-bin wireplumber ||
  echo "(Bluetooth audio packages unavailable; the speaker will not work)"

say "Creating user '$KIOSK_USER'"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups video,render,input "$KIOSK_USER"
  passwd --lock "$KIOSK_USER" >/dev/null
fi
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"

say "Installing scripts, config and units"
install -d -m 755 "$LIB_DIR" /etc/hub-kiosk
install -m 755 "$HERE"/bin/hub-kiosk-* "$LIB_DIR/"
install -m 755 "$HERE/display-agent/hub_display_agent.py" "$LIB_DIR/hub-kiosk-display-agent"
install -m 644 "$HERE/display-agent/hub_speaker.py" "$LIB_DIR/hub_speaker.py"
install -m 644 "$HERE/watchdog/hub_watchdog_logic.py" "$LIB_DIR/hub_watchdog_logic.py"
install -m 755 "$HERE/session-recovery/hub_session_recovery.py" "$LIB_DIR/hub-kiosk-session-recovery"
install -m 644 "$CONF_SRC" "$CONF_DST"
install -m 644 "$HERE/systemd/hub-kiosk-librespot.service" /etc/systemd/user/
install -m 644 "$HERE"/systemd/hub-kiosk.service "$HERE"/systemd/hub-kiosk-watchdog.service \
  "$HERE"/systemd/hub-kiosk-watchdog.timer "$HERE"/systemd/hub-kiosk-display-agent.service \
  /etc/systemd/user/
# System-level (not user) units: session recovery must outlive the kiosk user's session (hub-2ik).
install -m 644 "$HERE"/systemd/hub-kiosk-session-recovery.service "$HERE"/systemd/hub-kiosk-session-recovery.timer \
  /etc/systemd/system/
install -d -m 755 /etc/systemd/system.conf.d
install -m 644 "$HERE/systemd/10-hub-watchdog.conf" /etc/systemd/system.conf.d/10-hub-watchdog.conf

say "Setting up the Bluetooth speaker API"
# The hub server proxies Settings > Music > Speaker to the display agent with this token.
if [ ! -s "$SPEAKER_API_TOKEN_FILE" ]; then
  python3 -c 'import secrets; print(secrets.token_hex(24))' >"$SPEAKER_API_TOKEN_FILE"
fi
chown "root:$KIOSK_USER" "$SPEAKER_API_TOKEN_FILE"
chmod 640 "$SPEAKER_API_TOKEN_FILE"
systemctl enable --now bluetooth.service || echo "(bluetooth.service unavailable)"
rfkill unblock bluetooth 2>/dev/null || true

SPOTIFY_START=""
if [ "$SPOTIFY_CONNECT" = on ]; then
  say "Setting up Spotify Connect (librespot, device \"Hub\")"
  [ "$(dpkg --print-architecture)" = arm64 ] || die "SPOTIFY_CONNECT=on needs a 64-bit (arm64) OS"
  apt-get install -y pipewire-pulse avahi-daemon avahi-utils || die "Spotify audio packages failed"
  if [ "$(dpkg-query -W -f='${Version}' raspotify 2>/dev/null)" != "${RASPOTIFY_VERSION}~librespot.v0.8.0-939dc5e" ]; then
    DL="$(mktemp -d)"
    curl -fsSL --retry 3 -o "$DL/$RASPOTIFY_DEB" "$RASPOTIFY_URL" || die "could not download $RASPOTIFY_URL"
    echo "$RASPOTIFY_SHA256  $DL/$RASPOTIFY_DEB" | sha256sum -c - || die "Raspotify checksum mismatch; not installing"
    apt-get install -y "$DL/$RASPOTIFY_DEB" || die "Raspotify install failed"
    rm -rf "$DL"
  fi
  # We only want its librespot binary: run it as the kiosk user's service, not Raspotify's system unit.
  systemctl disable --now raspotify.service raspotify-crash-report-generator.service 2>/dev/null || true
  systemctl mask raspotify.service 2>/dev/null || true
  systemctl enable --now avahi-daemon.service || echo "(avahi-daemon unavailable; Spotify cannot discover Hub)"
  echo "LIBRESPOT_INITIAL_VOLUME=$SPOTIFY_INITIAL_VOLUME" >/etc/hub-kiosk/librespot.env
  chmod 644 /etc/hub-kiosk/librespot.env
  install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 755 "$KIOSK_HOME/.local" "$KIOSK_HOME/.local/state"
  install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 700 \
    "$KIOSK_HOME/.local/state/hub-kiosk" "$KIOSK_HOME/.local/state/hub-kiosk/librespot"
  SPOTIFY_START=" hub-kiosk-librespot.service"
fi

say "Configuring autologin to the desktop"
SESSION="labwc"
[ -f /usr/share/wayland-sessions/rpd-labwc.desktop ] && SESSION="rpd-labwc"
install -d -m 755 /etc/lightdm/lightdm.conf.d
cat >/etc/lightdm/lightdm.conf.d/50-hub-kiosk.conf <<EOC
[Seat:*]
autologin-user=$KIOSK_USER
autologin-user-timeout=0
autologin-session=$SESSION
EOC
# lightdm reads /etc/lightdm/lightdm.conf after conf.d, and Raspberry Pi OS sets the first user's
# autologin there, which would beat ours: comment those lines out (already-commented ones stay).
if [ -f /etc/lightdm/lightdm.conf ]; then
  sed -i -E 's/^([[:space:]]*autologin-(user|session)=)/#hub-kiosk: \1/' /etc/lightdm/lightdm.conf
fi

say "Writing labwc config for $KIOSK_USER"
CFG="$KIOSK_HOME/.config/labwc"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 755 "$KIOSK_HOME/.config" "$CFG"
# Only what is listed here runs: no panel, desktop icons, notification daemon, keyring or updater.
cat >"$CFG/autostart" <<EOC
# Managed by hub-kiosk install.sh. Edits are overwritten.
$LIB_DIR/hub-kiosk-apply-display &
systemctl --user import-environment WAYLAND_DISPLAY XDG_RUNTIME_DIR XCURSOR_THEME XCURSOR_SIZE
systemctl --user start hub-kiosk.service hub-kiosk-watchdog.timer hub-kiosk-display-agent.service$SPOTIFY_START
EOC
# Touch wall: the invisible cursor theme. Mouse and keyboard on a TV (INPUT=mouse): a pointer
# readable at 4K, and Esc minimizes the hub so the desktop is reachable (restore it from the taskbar).
KEYBOARD=""
if [ "$INPUT" = touch ]; then
  CURSOR_THEME=hub-blank CURSOR_SIZE=1
else
  CURSOR_THEME=Adwaita CURSOR_SIZE=48
  KEYBOARD='  <keyboard>
    <keybind key="Escape">
      <action name="If">
        <query identifier="chromium*" />
        <then><action name="Iconify" /></then>
      </action>
    </keybind>
  </keyboard>
'
fi
cat >"$CFG/rc.xml" <<EOC
<?xml version="1.0"?>
<!-- Managed by hub-kiosk install.sh. Touch is mapped to $OUTPUT, matrix for orientation $ORIENTATION. -->
<labwc_config>
  <touch deviceName="" mapToOutput="$OUTPUT"/>
  <libinput>
    <device category="touch">
      <calibrationMatrix>$TOUCH_MATRIX</calibrationMatrix>
    </device>
  </libinput>
${KEYBOARD}</labwc_config>
EOC
cat >"$CFG/environment" <<EOC
XCURSOR_THEME=$CURSOR_THEME
XCURSOR_SIZE=$CURSOR_SIZE
EOC
chown "$KIOSK_USER:$KIOSK_USER" "$CFG/autostart" "$CFG/rc.xml" "$CFG/environment"

say "Installing invisible cursor theme"
THEME=/usr/share/icons/hub-blank
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
base64 -d >"$WORK/blank.png" <<'EOC'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
EOC
echo "1 0 0 blank.png" >"$WORK/cursor.cfg"
install -d -m 755 "$THEME/cursors"
(cd "$WORK" && xcursorgen cursor.cfg "$THEME/cursors/left_ptr")
printf '[Icon Theme]\nName=hub-blank\n' >"$THEME/index.theme"
for n in default pointer text hand2 hand1 xterm arrow grab grabbing wait watch progress crosshair move not-allowed; do
  ln -sf left_ptr "$THEME/cursors/$n"
done

say "Disabling console/screen blanking"
# labwc runs no idle daemon here, so the compositor never blanks; also turn off the Pi OS setting.
raspi-config nonint do_blanking 1 || echo "(raspi-config blanking toggle unavailable; continuing)"

say "Reloading systemd"
systemctl daemon-reload
systemctl enable --now hub-kiosk-session-recovery.timer || echo "(session recovery timer unavailable)"

cat <<EOC

Done. Reboot to start the kiosk:  sudo reboot
Config: $CONF_DST  (edit kiosk/kiosk.conf, re-run this script, reboot)
Hardware watchdog takes effect after reboot (RuntimeWatchdogSec=15).
Speaker API: port ${SPEAKER_API_PORT:-8742}, token in $SPEAKER_API_TOKEN_FILE (give it to the hub server).
EOC
