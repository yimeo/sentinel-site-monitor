#!/usr/bin/env bash
set -euo pipefail

if [[ -r /etc/site-monitor.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/site-monitor.env
  set +a
fi

REQUEST_FILE="${ACCESS_SETTINGS_REQUEST_PATH:-/var/lib/site-monitor/access-port.request}"
TLS_REQUEST_FILE="${TLS_SETTINGS_REQUEST_PATH:-/var/lib/site-monitor/tls-settings.request}"
TLS_CERT_DIR="${TLS_CERT_DIR:-/etc/site-monitor/tls}"
TLS_STATUS_PATH="${TLS_STATUS_PATH:-/var/lib/site-monitor/tls-status.json}"
VHOST_FILE="${VHOST_FILE:-/www/server/panel/vhost/nginx/site-monitor.conf}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
BASE_ACCESS_PORT="${BASE_ACCESS_PORT:-80}"
FIREWALL_CMD="$(command -v firewall-cmd || true)"
BEGIN_MARKER="# Sentinel managed access port begin"
END_MARKER="# Sentinel managed access port end"
TLS_BEGIN_MARKER="# Sentinel managed tls begin"
TLS_END_MARKER="# Sentinel managed tls end"

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" == 80 || ("$1" >= 1024 && "$1" <= 65535) ))
}

apply_access_port() {
  test -s "$REQUEST_FILE" || return 0
  local requested_port previous_port backup_file tmp_file
  requested_port="$(awk -F= '$1 == "requestedPort" { print $2; exit }' "$REQUEST_FILE")"
  previous_port="$(awk -F= '$1 == "previousPort" { print $2; exit }' "$REQUEST_FILE")"
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
    sed -i "/^[[:space:]]*listen[[:space:]]\\+${BASE_ACCESS_PORT}\\([[:space:]][^;]*\\)\\?;[[:space:]]*$/a\\    $BEGIN_MARKER\\n    $END_MARKER" "$VHOST_FILE"
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
}

decode_request_value() {
  local key="$1"
  awk -F= -v requested="$key" '$1 == requested { print substr($0, index($0, "=") + 1); exit }' "$TLS_REQUEST_FILE" | base64 --decode
}

apply_tls_settings() {
  test -s "$TLS_REQUEST_FILE" || return 0
  local hostname certificate private_key certificate_chain staging vhost_backup cert_backup key_backup fullchain_backup
  hostname="$(awk -F= '$1 == "hostname" { print $2; exit }' "$TLS_REQUEST_FILE")"
  [[ "$hostname" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || { echo "Invalid TLS hostname" >&2; exit 1; }
  certificate="$(decode_request_value certificateBase64)"
  private_key="$(decode_request_value privateKeyBase64)"
  certificate_chain="$(decode_request_value certificateChainBase64 || true)"
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' RETURN
  printf '%s\n' "$certificate" >"$staging/certificate.pem"
  printf '%s\n' "$private_key" >"$staging/private-key.pem"
  printf '%s\n' "$certificate$certificate_chain" >"$staging/fullchain.pem"
  openssl x509 -in "$staging/certificate.pem" -noout -checkend 1 >/dev/null
  openssl pkey -in "$staging/private-key.pem" -noout >/dev/null
  [[ "$(openssl x509 -in "$staging/certificate.pem" -pubkey -noout | openssl pkey -pubin -outform pem | sha256sum)" == "$(openssl pkey -in "$staging/private-key.pem" -pubout -outform pem | sha256sum)" ]] || { echo "TLS certificate and private key do not match" >&2; exit 1; }

  install -d -m 700 "$TLS_CERT_DIR"
  cert_backup="$(mktemp)"; key_backup="$(mktemp)"; fullchain_backup="$(mktemp)"
  [[ -f "$TLS_CERT_DIR/$hostname.crt" ]] && cp -a "$TLS_CERT_DIR/$hostname.crt" "$cert_backup" || rm -f "$cert_backup"
  [[ -f "$TLS_CERT_DIR/$hostname.key" ]] && cp -a "$TLS_CERT_DIR/$hostname.key" "$key_backup" || rm -f "$key_backup"
  [[ -f "$TLS_CERT_DIR/$hostname.fullchain.pem" ]] && cp -a "$TLS_CERT_DIR/$hostname.fullchain.pem" "$fullchain_backup" || rm -f "$fullchain_backup"
  install -m 644 "$staging/certificate.pem" "$TLS_CERT_DIR/$hostname.crt"
  install -m 600 "$staging/private-key.pem" "$TLS_CERT_DIR/$hostname.key"
  install -m 644 "$staging/fullchain.pem" "$TLS_CERT_DIR/$hostname.fullchain.pem"

  vhost_backup="${VHOST_FILE}.bak.tls.$(date +%Y%m%d%H%M%S)"
  cp -a "$VHOST_FILE" "$vhost_backup"
  sed -i "/^${TLS_BEGIN_MARKER}$/,/^${TLS_END_MARKER}$/d" "$VHOST_FILE"
  cat >>"$VHOST_FILE" <<EOF

${TLS_BEGIN_MARKER}
server {
  listen 443 ssl http2;
  server_name ${hostname};
  ssl_certificate ${TLS_CERT_DIR}/${hostname}.fullchain.pem;
  ssl_certificate_key ${TLS_CERT_DIR}/${hostname}.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  location / {
    proxy_pass http://127.0.0.1:${APP_PORT:-3201};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
${TLS_END_MARKER}
EOF
  if ! "$NGINX_BIN" -t; then
    cp -a "$vhost_backup" "$VHOST_FILE"
    [[ -f "$cert_backup" ]] && cp -a "$cert_backup" "$TLS_CERT_DIR/$hostname.crt" || rm -f "$TLS_CERT_DIR/$hostname.crt"
    [[ -f "$key_backup" ]] && cp -a "$key_backup" "$TLS_CERT_DIR/$hostname.key" || rm -f "$TLS_CERT_DIR/$hostname.key"
    [[ -f "$fullchain_backup" ]] && cp -a "$fullchain_backup" "$TLS_CERT_DIR/$hostname.fullchain.pem" || rm -f "$TLS_CERT_DIR/$hostname.fullchain.pem"
    echo "Nginx TLS configuration validation failed; restored previous configuration" >&2
    exit 1
  fi
  "$NGINX_BIN" -s reload
  if [[ -n "$FIREWALL_CMD" ]]; then
    "$FIREWALL_CMD" --add-service=https
    "$FIREWALL_CMD" --permanent --add-service=https
  fi
  printf '{"hostname":"%s","configuredAt":"%s"}\n' "$hostname" "$(date -u +%FT%TZ)" >"$TLS_STATUS_PATH"
  chmod 640 "$TLS_STATUS_PATH"
  rm -f "$TLS_REQUEST_FILE"
}

apply_access_port
apply_tls_settings
