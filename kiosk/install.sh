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
case "$ORIENTATION" in normal | 90 | 180 | 270) ;; *) die "ORIENTATION must be normal|90|180|270" ;; esac
[[ "$OUTPUT" =~ ^[A-Za-z0-9_-]+$ ]] || die "OUTPUT looks wrong: $OUTPUT"
[[ "$RESOLUTION" =~ ^[0-9]+x[0-9]+$ ]] || die "RESOLUTION must look like 2560x1440"
[[ "$HUB_URL" =~ ^https?:// ]] || die "HUB_URL must start with http:// or https://"

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

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# Package is `chromium` on current Raspberry Pi OS (older images: chromium-browser).
apt-get install -y curl python3 wlr-randr xcursorgen || die "base package install failed"
apt-get install -y chromium || apt-get install -y chromium-browser

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
install -m 644 "$CONF_SRC" "$CONF_DST"
install -m 644 "$HERE"/systemd/hub-kiosk.service "$HERE"/systemd/hub-kiosk-watchdog.service \
  "$HERE"/systemd/hub-kiosk-watchdog.timer "$HERE"/systemd/hub-kiosk-display-agent.service \
  /etc/systemd/user/
install -d -m 755 /etc/systemd/system.conf.d
install -m 644 "$HERE/systemd/10-hub-watchdog.conf" /etc/systemd/system.conf.d/10-hub-watchdog.conf

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

say "Writing labwc config for $KIOSK_USER"
CFG="$KIOSK_HOME/.config/labwc"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 755 "$KIOSK_HOME/.config" "$CFG"
# Only what is listed here runs: no panel, desktop icons, notification daemon, keyring or updater.
cat >"$CFG/autostart" <<EOC
# Managed by hub-kiosk install.sh. Edits are overwritten.
$LIB_DIR/hub-kiosk-apply-display &
systemctl --user import-environment WAYLAND_DISPLAY XDG_RUNTIME_DIR XCURSOR_THEME XCURSOR_SIZE
systemctl --user start hub-kiosk.service hub-kiosk-watchdog.timer hub-kiosk-display-agent.service
EOC
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
</labwc_config>
EOC
cat >"$CFG/environment" <<EOC
XCURSOR_THEME=hub-blank
XCURSOR_SIZE=1
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

cat <<EOC

Done. Reboot to start the kiosk:  sudo reboot
Config: $CONF_DST  (edit kiosk/kiosk.conf, re-run this script, reboot)
Hardware watchdog takes effect after reboot (RuntimeWatchdogSec=15).
EOC
