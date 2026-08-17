#!/usr/bin/env bash
# Ubuntu 通用安装器的非破坏性回归测试；不执行真实安装，仅验证关键兼容约束。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-linux.sh"

bash -n "$INSTALLER"
grep -Fq 'NODE_VERSION="20.19.2"' "$INSTALLER"
grep -Fq 'NODE_VERSION="16.20.2"' "$INSTALLER"
grep -Fq 'PNPM_VERSION="${PNPM_VERSION:-$( [[ "${NODE_VERSION%%.*}" -lt 18 ]] && echo 8.15.9 || echo 10 )}"' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/npm" install -g --prefix "$NODE_DIR" "pnpm@${PNPM_VERSION}"' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/pnpm" install --no-frozen-lockfile' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/npm" install --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/pnpm" build' "$INSTALLER"
grep -Fq 'NGINX_BACKUP_DIR="/etc/nginx/sentinel-backups"' "$INSTALLER"
grep -Fq 'mv /etc/nginx/sites-enabled/default "$NGINX_BACKUP_DIR/default.$(date +%s).conf"' "$INSTALLER"
grep -Fq 'if systemctl enable --now cron.service >/dev/null 2>&1; then' "$INSTALLER"
grep -Fq 'elif systemctl enable --now crond.service >/dev/null 2>&1; then' "$INSTALLER"
grep -Fq 'HOME=/var/lib/site-monitor/home' "$SCRIPT_DIR/deploy-bt-isolated.sh" || true
grep -Fq 'PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin"' "$INSTALLER"

if grep -Eq 'runuser -u "\$APP_USER" -- pnpm( |$)' "$INSTALLER"; then
  echo "错误：Ubuntu 安装器仍通过非登录 PATH 直接调用 pnpm。" >&2
  exit 1
fi

printf 'Ubuntu installer regression checks passed.\n'
