#!/usr/bin/env bash
set -euo pipefail

if [[ -r /etc/site-monitor.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/site-monitor.env
  set +a
fi

REQUEST_FILE="${REQUEST_FILE:-${ADMIN_AUTH_REQUEST_PATH:-/var/lib/site-monitor/admin-auth.request}}"
HTPASSWD_FILE="${HTPASSWD_FILE:-/www/server/nginx/conf/site-monitor.htpasswd}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
HTPASSWD_GROUP="${HTPASSWD_GROUP:-}"

test -s "$REQUEST_FILE" || exit 0
old_username="$(awk -F= '$1 == "oldUsername" { print substr($0, index($0, "=") + 1); exit }' "$REQUEST_FILE")"
new_username="$(awk -F= '$1 == "newUsername" { print substr($0, index($0, "=") + 1); exit }' "$REQUEST_FILE")"
for username in "$old_username" "$new_username"; do
  [[ "$username" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$ ]] || { echo "Invalid administrator username" >&2; exit 1; }
done
test "$old_username" != "$new_username" || { rm -f "$REQUEST_FILE"; exit 0; }

old_hash="$(awk -F: -v username="$old_username" '$1 == username { print $2; exit }' "$HTPASSWD_FILE")"
test -n "$old_hash" || { echo "Current administrator entry was not found" >&2; exit 1; }
if awk -F: -v username="$new_username" '$1 == username { found=1 } END { exit !found }' "$HTPASSWD_FILE"; then
  echo "Requested administrator username already exists" >&2
  exit 1
fi

tmp_file="$(mktemp "${HTPASSWD_FILE}.XXXXXX")"
awk -F: -v username="$old_username" '$1 != username { print }' "$HTPASSWD_FILE" > "$tmp_file"
printf '%s:%s\n' "$new_username" "$old_hash" >> "$tmp_file"
if [[ -n "$HTPASSWD_GROUP" ]]; then chown root:"$HTPASSWD_GROUP" "$tmp_file"; fi
chmod 640 "$tmp_file"
mv "$tmp_file" "$HTPASSWD_FILE"

if "$NGINX_BIN" -t; then
  "$NGINX_BIN" -s reload
else
  echo "Nginx validation failed after updating administrator username" >&2
  exit 1
fi
rm -f "$REQUEST_FILE"
