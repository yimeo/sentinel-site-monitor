#!/usr/bin/env bash
# 端口同步脚本的非破坏性回归测试；覆盖 Ubuntu 默认 Nginx 的 default_server 写法。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/apply-access-port.sh"

bash -n "$SCRIPT"
grep -Fq 'listen[[:space:]]\\+${BASE_ACCESS_PORT}' "$SCRIPT"
grep -Fq 'TLS_REQUEST_FILE="${TLS_SETTINGS_REQUEST_PATH:-/var/lib/site-monitor/tls-settings.request}"' "$SCRIPT"
grep -Fq 'TLS_CERT_DIR="${TLS_CERT_DIR:-/etc/site-monitor/tls}"' "$SCRIPT"
grep -Fq 'listen 443 ssl http2;' "$SCRIPT"
grep -Fq 'ssl_certificate ${TLS_CERT_DIR}/${hostname}.fullchain.pem;' "$SCRIPT"
grep -Fq 'openssl x509 -in "$staging/certificate.pem" -noout -checkend 1' "$SCRIPT"
grep -Fq 'TLS certificate and private key do not match' "$SCRIPT"

fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT
cat >"$fixture" <<'EOF'
server {
  listen 80 default_server;
  server_name _;
}
EOF

begin='# Sentinel managed access port begin'
end='# Sentinel managed access port end'
sed -i "/^[[:space:]]*listen[[:space:]]\\+80\\([[:space:]][^;]*\\)\\?;[[:space:]]*$/a\\    $begin\\n    $end" "$fixture"
grep -Fq "    $begin" "$fixture"
grep -Fq "    $end" "$fixture"

printf 'Access-port sync regression checks passed.\n'
