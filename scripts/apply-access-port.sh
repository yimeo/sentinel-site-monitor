#!/usr/bin/env bash
set -euo pipefail

if [[ -r /etc/site-monitor.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/site-monitor.env
  set +a
fi

REQUEST_FILE="${ACCESS_SETTINGS_REQUEST_PATH:-/var/lib/site-monitor/access-port.request}"
VHOST_FILE="${VHOST_FILE:-/www/server/panel/vhost/nginx/site-monitor.conf}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
BASE_ACCESS_PORT="${BASE_ACCESS_PORT:-80}"
FIREWALL_CMD="$(command -v firewall-cmd || true)"
BEGIN_MARKER="# Sentinel managed access port begin"
END_MARKER="# Sentinel managed access port end"

test -s "$REQUEST_FILE" || exit 0
requested_port="$(awk -F= '$1 == "requestedPort" { print $2; exit }' "$REQUEST_FILE")"
previous_port="$(awk -F= '$1 == "previousPort" { print $2; exit }' "$REQUEST_FILE")"

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" == 80 || ("$1" >= 1024 && "$1" <= 65535) ))
}

if [[ -n "$requested_port" ]]; then
  validate_port "$requested_port" || { echo "Invalid requested port" >&2; exit 1; }
  if [[ "$requested_port" != "80" ]] && ss -ltnH "( sport = :$requested_port )" | grep -q .; then
    echo "Requested port $requested_port is already in use" >&2
    exit 1
  fi
fi
if [[ -n "$previous_port" ]]; then validate_port "$previous_port" || previous_port=""; fi

backup_file="${VHOST_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$VHOST_FILE" "$backup_file"
if ! grep -qF "$BEGIN_MARKER" "$VHOST_FILE"; then
  sed -i "/^[[:space:]]*listen ${BASE_ACCESS_PORT};[[:space:]]*$/a\\    $BEGIN_MARKER\\n    $END_MARKER" "$VHOST_FILE"
fi

tmp_file="$(mktemp)"
awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" -v port="$requested_port" '
  $0 == "    " begin { print; if (port != "" && port != "80") print "    listen " port ";"; skip=1; next }
  $0 == "    " end { skip=0; print; next }
  !skip { print }
' "$VHOST_FILE" > "$tmp_file"
cat "$tmp_file" > "$VHOST_FILE"
rm -f "$tmp_file"

if ! "$NGINX_BIN" -t; then
  cp -a "$backup_file" "$VHOST_FILE"
  echo "Nginx configuration validation failed; restored previous configuration" >&2
  exit 1
fi
"$NGINX_BIN" -s reload

if [[ -n "$FIREWALL_CMD" && -n "$requested_port" && "$requested_port" != "80" ]]; then
  "$FIREWALL_CMD" --add-port="${requested_port}/tcp"
  "$FIREWALL_CMD" --permanent --add-port="${requested_port}/tcp"
fi
if [[ -n "$FIREWALL_CMD" && -n "$previous_port" && "$previous_port" != "80" && "$previous_port" != "$requested_port" ]]; then
  "$FIREWALL_CMD" --remove-port="${previous_port}/tcp" || true
  "$FIREWALL_CMD" --permanent --remove-port="${previous_port}/tcp" || true
fi

rm -f "$REQUEST_FILE"
