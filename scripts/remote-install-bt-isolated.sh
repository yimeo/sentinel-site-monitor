#!/usr/bin/env bash
# 适用于已有宝塔 Nginx 的 Ubuntu 20.04+ 主机；不改变 80/443 或宝塔面板端口。
set -euo pipefail

REPOSITORY="https://github.com/yimeo/sentinel-site-monitor"
BRANCH="${SENTINEL_BRANCH:-main}"

[[ "${EUID}" -eq 0 ]] || { echo "请使用：curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install-bt-isolated.sh | sudo bash" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "系统需要 curl 才能下载 Sentinel 源码。" >&2; exit 1; }

WORKDIR="$(mktemp -d /tmp/sentinel-bt-install.XXXXXX)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "正在从 ${REPOSITORY} 下载 ${BRANCH} 分支源码…"
curl -fsSL "${REPOSITORY}/archive/refs/heads/${BRANCH}.tar.gz" -o "$WORKDIR/source.tar.gz"
tar -xzf "$WORKDIR/source.tar.gz" -C "$WORKDIR"
SOURCE_DIR="$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -type d -name 'sentinel-site-monitor-*' | head -n 1)"
[[ -n "$SOURCE_DIR" && -f "$SOURCE_DIR/scripts/deploy-bt-isolated.sh" ]] || { echo "下载的源码不完整，安装已停止。" >&2; exit 1; }

SOURCE_ARCHIVE="$WORKDIR/source.tar.gz" exec bash "$SOURCE_DIR/scripts/deploy-bt-isolated.sh"
