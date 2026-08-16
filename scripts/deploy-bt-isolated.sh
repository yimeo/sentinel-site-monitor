#!/usr/bin/env bash
# 适用于已有宝塔 Nginx 的 Ubuntu 20.04+、CentOS 7+ 或 RHEL 系列服务器。
# 仅新增独立端口站点；不修改宝塔面板端口、既有站点或 80/443 监听配置。
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/site-monitor}"
APP_USER="${APP_USER:-www}"
APP_GROUP="${APP_GROUP:-www}"
APP_PORT="${APP_PORT:-3202}"
PUBLIC_PORT="${PUBLIC_PORT:-18080}"
if [[ -z "${NODE_VERSION:-}" ]]; then
  if [[ -f /etc/centos-release ]] && grep -qE 'release[[:space:]]+7([.[:space:]]|$)' /etc/centos-release; then
    NODE_VERSION="16.20.2"
  else
    NODE_VERSION="20.19.2"
  fi
fi
PNPM_VERSION="${PNPM_VERSION:-$( [[ "${NODE_VERSION%%.*}" -lt 18 ]] && echo 8.15.9 || echo 10 )}"
SOURCE_ARCHIVE="${SOURCE_ARCHIVE:-/tmp/Sentinel-site-monitor-source-latest.tar.gz}"
NODE_DIR="/opt/node-v${NODE_VERSION}-linux-x64"
NGINX_BIN="/www/server/nginx/sbin/nginx"
VHOST_FILE="/www/server/panel/vhost/nginx/site-monitor-${PUBLIC_PORT}.conf"

fail() { echo "错误：$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || fail "请以 root 身份执行。"
[[ -r "$SOURCE_ARCHIVE" ]] || fail "未找到源码包：$SOURCE_ARCHIVE"
[[ -x "$NGINX_BIN" ]] || fail "未找到宝塔 Nginx：$NGINX_BIN"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || fail "APP_PORT 无效。"
[[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] && (( PUBLIC_PORT >= 1024 && PUBLIC_PORT <= 65535 )) || fail "PUBLIC_PORT 无效。"
[[ "$APP_PORT" != "$PUBLIC_PORT" ]] || fail "应用端口和公网端口必须不同。"
id "$APP_USER" >/dev/null 2>&1 || fail "未找到宝塔 Web 用户：$APP_USER"
getent group "$APP_GROUP" >/dev/null 2>&1 || fail "未找到宝塔 Web 用户组：$APP_GROUP"
! systemctl cat site-monitor.service >/dev/null 2>&1 || fail "site-monitor.service 已存在，已停止以避免覆盖既有部署。"
! ss -ltnH "( sport = :$APP_PORT )" | grep -q . || fail "应用端口 $APP_PORT 已被占用。"
! ss -ltnH "( sport = :$PUBLIC_PORT )" | grep -q . || fail "公网端口 $PUBLIC_PORT 已被占用。"

echo "[1/8] 安装部署依赖…"
install_system_dependencies() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl ca-certificates tar gzip xz-utils rsync openssl cron
    return
  fi

  local package_manager=""
  local packages=(curl ca-certificates tar gzip xz rsync openssl cronie)
  if command -v dnf >/dev/null 2>&1; then
    package_manager="dnf"
  elif command -v yum >/dev/null 2>&1; then
    package_manager="yum"
  else
    fail "未找到支持的系统包管理器；仅支持 apt-get、dnf 或 yum。"
  fi

  if ! "$package_manager" install -y "${packages[@]}"; then
    if [[ "$package_manager" == "yum" && -f /etc/centos-release ]] && grep -q 'release 7' /etc/centos-release; then
      echo "检测到 CentOS 7 软件源失败，正在切换至官方 Vault 镜像后重试…"
      mkdir -p /etc/yum.repos.d/sentinel-repo-backup
      cp -a /etc/yum.repos.d/CentOS-*.repo /etc/yum.repos.d/sentinel-repo-backup/ 2>/dev/null || true
      sed -ri 's|^mirrorlist=|#mirrorlist=|g; s|^#baseurl=http://mirror.centos.org/centos/\$releasever|baseurl=http://vault.centos.org/7.9.2009|g' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null || true
      yum clean all
      yum makecache
      yum install -y "${packages[@]}" || fail "CentOS 7 依赖安装失败，请检查网络、DNS 与 yum 源。"
    else
      fail "系统依赖安装失败，请检查软件源和网络。"
    fi
  fi
}
install_system_dependencies
unset -f install_system_dependencies

echo "[2/8] 安装隔离 Node.js ${NODE_VERSION}…"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /opt
  rm -f "node-v${NODE_VERSION}-linux-x64.tar.xz"
fi
export PATH="$NODE_DIR/bin:$PATH"
"$NODE_DIR/bin/npm" install -g --prefix "$NODE_DIR" "pnpm@${PNPM_VERSION}"

echo "[3/8] 解压源码并安装依赖…"
install -d -m 750 -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR" "$APP_DIR/data" /var/lib/site-monitor /var/lib/site-monitor/home
tar -xzf "$SOURCE_ARCHIVE" -C "$APP_DIR" --strip-components=1
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR" /var/lib/site-monitor
cd "$APP_DIR"
runuser -u "$APP_USER" -- env HOME=/var/lib/site-monitor/home PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/pnpm" install --no-frozen-lockfile
if [[ -f "$APP_DIR/dist/index.js" && -d "$APP_DIR/dist/public" ]]; then
  echo "检测到预构建 dist，跳过旧系统上的前端构建。"
else
  runuser -u "$APP_USER" -- env HOME=/var/lib/site-monitor/home PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/pnpm" build
fi

echo "[4/8] 创建 Sentinel 运行服务…"
JWT_SECRET="$(openssl rand -hex 32)"
LOCAL_SCHEDULER_TOKEN="$(openssl rand -hex 32)"
cat >/etc/site-monitor.env <<EOF
NODE_ENV=production
PORT=${APP_PORT}
BIND_HOST=127.0.0.1
LOCAL_DEPLOYMENT=true
SQLITE_DB_PATH=${APP_DIR}/data/site-monitor.sqlite
JWT_SECRET=${JWT_SECRET}
LOCAL_SCHEDULER_TOKEN=${LOCAL_SCHEDULER_TOKEN}
ACCESS_SETTINGS_REQUEST_PATH=/var/lib/site-monitor/access-port.request
VHOST_FILE=${VHOST_FILE}
NGINX_BIN=${NGINX_BIN}
BASE_ACCESS_PORT=${PUBLIC_PORT}
EOF
chmod 600 /etc/site-monitor.env
cat >/etc/systemd/system/site-monitor.service <<EOF
[Unit]
Description=Sentinel Site Monitor
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/site-monitor.env
ExecStart=${NODE_DIR}/bin/node ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[5/8] 新增独立 Nginx 站点…"
cat >"$VHOST_FILE" <<EOF
server {
    listen ${PUBLIC_PORT};
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
"$NGINX_BIN" -t

echo "[6/8] 启用 Sentinel 和配置同步服务…"
install -m 700 "$APP_DIR/scripts/apply-access-port.sh" /usr/local/sbin/site-monitor-apply-access-port
install -m 644 "$APP_DIR/scripts/site-monitor-access-port.service" "$APP_DIR/scripts/site-monitor-access-port.path" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cron site-monitor site-monitor-access-port.path
"$NGINX_BIN" -s reload

cat >/etc/cron.d/site-monitor <<EOF
# Sentinel：每分钟启动一次，在每 10 秒扫描到期任务；令牌只保存在 root 可读的运行配置中。
* * * * * root /bin/sh -c '. /etc/site-monitor.env; for delay in 0 10 20 30 40 50; do ( sleep \$delay; /usr/bin/curl -fsS --max-time 8 -X POST -H "Authorization: Bearer \$LOCAL_SCHEDULER_TOKEN" http://127.0.0.1:${APP_PORT}/api/scheduled/monitor-run >> /var/log/site-monitor-cron.log 2>&1 ) & done; wait'
EOF
chmod 600 /etc/cron.d/site-monitor

echo "[7/8] 仅开放 Sentinel 独立入口端口…"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${PUBLIC_PORT}/tcp"
fi

echo "[8/8] 验证部署…"
systemctl is-active --quiet site-monitor || { journalctl -u site-monitor --no-pager -n 50 >&2; exit 1; }
curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/" >/dev/null || fail "应用本机健康检查失败。"
curl -fsS --max-time 60 -X POST -H "Authorization: Bearer ${LOCAL_SCHEDULER_TOKEN}" "http://127.0.0.1:${APP_PORT}/api/scheduled/monitor-run" >/dev/null || fail "首次调度检查触发失败。"
PROXY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PUBLIC_PORT}/" || true)"
[[ "$PROXY_STATUS" == "200" ]] || fail "独立 Nginx 入口预期 200，实际为 ${PROXY_STATUS:-无响应}。"

echo "部署完成。"
echo "管理入口：http://$(hostname -I | awk '{print $1}'):${PUBLIC_PORT}/"
echo "首次访问将显示管理员初始化页，请设置管理员用户名和至少 12 位密码。"
echo "宝塔面板端口、80/443 及既有站点配置均未修改。"
