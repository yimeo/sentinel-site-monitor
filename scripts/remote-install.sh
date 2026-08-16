#!/usr/bin/env bash
# 可通过 curl -fsSL <raw-url> | sudo bash 执行的 Sentinel 远程安装入口。
set -euo pipefail

REPOSITORY="https://github.com/yimeo/sentinel-site-monitor"
BRANCH="${SENTINEL_BRANCH:-main}"

[[ "${EUID}" -eq 0 ]] || { echo "请使用：curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install.sh | sudo bash" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "系统需要 curl 才能下载 Sentinel 源码。" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "系统需要 tar 才能解压 Sentinel 源码。" >&2; exit 1; }

WORKDIR="$(mktemp -d /tmp/sentinel-install.XXXXXX)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "正在从 ${REPOSITORY} 下载 ${BRANCH} 分支源码…"
curl -fsSL "${REPOSITORY}/archive/refs/heads/${BRANCH}.tar.gz" -o "$WORKDIR/source.tar.gz"
tar -xzf "$WORKDIR/source.tar.gz" -C "$WORKDIR"
SOURCE_DIR="$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -type d -name 'sentinel-site-monitor-*' | head -n 1)"
[[ -n "$SOURCE_DIR" && -f "$SOURCE_DIR/scripts/install-linux.sh" ]] || { echo "下载的源码不完整，安装已停止。" >&2; exit 1; }

cd "$SOURCE_DIR"
exec bash scripts/install-linux.sh
