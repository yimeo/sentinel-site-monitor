#!/usr/bin/env bash
set -euo pipefail

if [[ -r /etc/site-monitor.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/site-monitor.env
  set +a
fi

REQUEST_FILE="${ADMIN_PASSWORD_REQUEST_PATH:-/var/lib/site-monitor/admin-password.request}"
HTPASSWD_FILE="${HTPASSWD_FILE:-/www/server/nginx/conf/site-monitor.htpasswd}"
DEFAULT_USERNAME="sentinel-admin"
HTPASSWD_BIN="${HTPASSWD_BIN:-$(command -v htpasswd || true)}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
HTPASSWD_GROUP="${HTPASSWD_GROUP:-}"

test -s "$REQUEST_FILE" || exit 0
if grep -q '^username=' "$REQUEST_FILE"; then
  username="$(awk -F= '$1 == "username" { print substr($0, index($0, "=") + 1); exit }' "$REQUEST_FILE")"
  password="$(awk -F= '$1 == "password" { print substr($0, index($0, "=") + 1); exit }' "$REQUEST_FILE")"
else
  username="$DEFAULT_USERNAME"
  password="$(cat "$REQUEST_FILE")"
fi
test -n "$password" || exit 1
[[ "$username" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$ ]] || { echo "Invalid administrator username" >&2; exit 1; }
test -n "$HTPASSWD_BIN" || { echo "htpasswd command is required but not installed" >&2; exit 1; }

printf '%s\n' "$password" | "$HTPASSWD_BIN" -i "$HTPASSWD_FILE" "$username"
if [[ -n "$HTPASSWD_GROUP" ]]; then chown root:"$HTPASSWD_GROUP" "$HTPASSWD_FILE"; fi
chmod 640 "$HTPASSWD_FILE"
rm -f "$REQUEST_FILE"

if "$NGINX_BIN" -t; then
  "$NGINX_BIN" -s reload
fi
