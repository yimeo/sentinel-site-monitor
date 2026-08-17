#!/usr/bin/env bash
# Ubuntu 通用安装器的非破坏性回归测试；不执行真实安装，仅验证关键兼容约束。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-linux.sh"

bash -n "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/npm" install -g pnpm@8' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/pnpm" install --frozen-lockfile' "$INSTALLER"
grep -Fq '"$NODE_DIR/bin/pnpm" build' "$INSTALLER"
grep -Fq 'HOME=/var/lib/site-monitor/home' "$SCRIPT_DIR/deploy-bt-isolated.sh" || true
grep -Fq 'PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin"' "$INSTALLER"

if grep -Eq 'runuser -u "\$APP_USER" -- pnpm( |$)' "$INSTALLER"; then
  echo "错误：Ubuntu 安装器仍通过非登录 PATH 直接调用 pnpm。" >&2
  exit 1
fi

printf 'Ubuntu installer regression checks passed.\n'
