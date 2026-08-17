#!/usr/bin/env bash
# Sentinel 自动安装器：Ubuntu 20.04+ / CentOS 7+。请在已下载的源码根目录以 root 执行。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sentinel-site-monitor}"
APP_USER="${APP_USER:-site-monitor}"
APP_PORT="${APP_PORT:-3201}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"
if [[ -z "${NODE_VERSION:-}" ]]; then
  if [[ -f /etc/centos-release ]] && grep -qE 'release[[:space:]]+7([.[:space:]]|$)' /etc/centos-release; then
    NODE_VERSION="16.20.2"
  else
    NODE_VERSION="20.19.2"
  fi
fi
PNPM_VERSION="${PNPM_VERSION:-$( [[ "${NODE_VERSION%%.*}" -lt 18 ]] && echo 8.15.9 || echo 10 )}"

fail() { echo "错误：$*" >&2; exit 1; }
[[ "${EUID}" -eq 0 ]] || fail "请使用 sudo bash scripts/install-linux.sh 执行。"
[[ -f package.json ]] || fail "请先 cd 到 Sentinel 源码目录再执行本脚本。"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || fail "APP_PORT 必须是 1024–65535 的端口。"
[[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] && (( PUBLIC_PORT == 80 || (PUBLIC_PORT >= 1024 && PUBLIC_PORT <= 65535) )) || fail "PUBLIC_PORT 仅支持 80 或 1024–65535。"
[[ "$APP_PORT" != "$PUBLIC_PORT" ]] || fail "应用端口和公网端口必须不同。"

echo "[1/8] 安装系统依赖…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates tar gzip xz-utils rsync nginx openssl cron
elif command -v yum >/dev/null 2>&1; then
  if ! yum install -y curl ca-certificates tar gzip xz rsync nginx openssl cronie; then
    if [[ -f /etc/centos-release ]] && grep -q 'release 7' /etc/centos-release && compgen -G '/etc/yum.repos.d/CentOS-*.repo' >/dev/null; then
      echo "检测到 CentOS 7 已归档的软件源，正在切换至官方 Vault 镜像后重试…"
      mkdir -p /etc/yum.repos.d/sentinel-repo-backup
      cp -a /etc/yum.repos.d/CentOS-*.repo /etc/yum.repos.d/sentinel-repo-backup/
      sed -ri 's|^mirrorlist=|#mirrorlist=|g; s|^#baseurl=http://mirror.centos.org/centos/\$releasever|baseurl=http://vault.centos.org/7.9.2009|g' /etc/yum.repos.d/CentOS-*.repo
      yum clean all && yum makecache
      yum install -y curl ca-certificates tar gzip xz rsync nginx openssl cronie || fail "CentOS 7 依赖安装失败，请检查网络、DNS 与 yum 源。"
    else
      fail "系统依赖安装失败，请检查软件源和网络。"
    fi
  fi
else
  fail "仅支持 apt 或 yum 系统。"
fi

echo "[2/8] 安装 Node.js ${NODE_VERSION}…"
ARCH="$(uname -m)"
case "$ARCH" in x86_64) NODE_ARCH="x64" ;; aarch64) NODE_ARCH="arm64" ;; *) fail "不支持的架构：$ARCH" ;; esac
NODE_DIR="/opt/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  curl -fsSLo "/tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  tar -xJf "/tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /opt
  rm -f "/tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
fi
ln -sfn "$NODE_DIR/bin/node" /usr/local/bin/node
ln -sfn "$NODE_DIR/bin/npm" /usr/local/bin/npm
ln -sfn "$NODE_DIR/bin/npx" /usr/local/bin/npx
"$NODE_DIR/bin/npm" install -g --prefix "$NODE_DIR" "pnpm@${PNPM_VERSION}"

echo "[3/8] 创建应用目录和服务账号…"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin "$APP_USER"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/data" /var/lib/site-monitor
rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude .git ./ "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/lib/site-monitor

echo "[4/8] 安装依赖并构建…"
cd "$APP_DIR"
if [[ "${NODE_VERSION%%.*}" -lt 18 ]]; then
  runuser -u "$APP_USER" -- env HOME=/var/lib/site-monitor PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" "$NODE_DIR/bin/npm" install --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
else
  runuser -u "$APP_USER" -- env HOME=/var/lib/site-monitor PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" "$NODE_DIR/bin/pnpm" install --no-frozen-lockfile
fi
if [[ -f "$APP_DIR/dist/index.js" && -d "$APP_DIR/dist/public" ]]; then
  echo "检测到预构建 dist，跳过构建。"
else
  runuser -u "$APP_USER" -- env HOME=/var/lib/site-monitor PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" "$NODE_DIR/bin/pnpm" build
fi

echo "[5/8] 创建运行环境与应用服务…"
JWT_SECRET="$(openssl rand -hex 32)"
LOCAL_SCHEDULER_TOKEN="$(openssl rand -hex 32)"
NGINX_BIN="$(command -v nginx)"
VHOST_FILE="/etc/nginx/conf.d/site-monitor.conf"
CURL_BIN="$(command -v curl)"
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
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/site-monitor.env
ExecStart=/usr/local/bin/node ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[6/8] 配置 Nginx 反向代理…"
if [[ "$PUBLIC_PORT" == "80" && -f /etc/nginx/sites-enabled/default ]]; then
  mv /etc/nginx/sites-enabled/default "/etc/nginx/sites-enabled/default.sentinel-backup.$(date +%s)"
fi
cat >"$VHOST_FILE" <<EOF
server {
  listen ${PUBLIC_PORT} default_server;
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
nginx -t

echo "[7/8] 启用服务、端口同步与 cron 调度…"
install -m 700 "$APP_DIR/scripts/apply-access-port.sh" /usr/local/sbin/site-monitor-apply-access-port
install -m 644 "$APP_DIR/scripts/site-monitor-access-port.service" "$APP_DIR/scripts/site-monitor-access-port.path" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now site-monitor site-monitor-access-port.path nginx
if systemctl list-unit-files | grep -q '^cron\.service'; then systemctl enable --now cron; else systemctl enable --now crond; fi
cat >/etc/cron.d/site-monitor <<EOF
# Sentinel：每分钟启动一次，在每 10 秒扫描到期任务；本机令牌仅保存在 root 可读文件中。
* * * * * root for delay in 0 10 20 30 40 50; do ( sleep \$delay; ${CURL_BIN} -fsS --max-time 8 -X POST -H 'Authorization: Bearer ${LOCAL_SCHEDULER_TOKEN}' http://127.0.0.1:${APP_PORT}/api/scheduled/monitor-run >> /var/log/site-monitor-cron.log 2>&1 ) & done; wait
EOF
chmod 600 /etc/cron.d/site-monitor
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  if [[ "$PUBLIC_PORT" == "80" ]]; then firewall-cmd --add-service=http && firewall-cmd --permanent --add-service=http; else firewall-cmd --add-port="${PUBLIC_PORT}/tcp" && firewall-cmd --permanent --add-port="${PUBLIC_PORT}/tcp"; fi
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${PUBLIC_PORT}/tcp"
fi
systemctl reload nginx

echo "[8/8] 验证部署和首次调度…"
systemctl is-active --quiet site-monitor || { journalctl -u site-monitor --no-pager -n 50 >&2; exit 1; }
curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/" >/dev/null || fail "应用本机健康检查失败。"
curl -fsS --max-time 60 -X POST -H "Authorization: Bearer ${LOCAL_SCHEDULER_TOKEN}" "http://127.0.0.1:${APP_PORT}/api/scheduled/monitor-run" >/dev/null || fail "首次调度检查触发失败。"
PROXY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PUBLIC_PORT}/" || true)"
[[ "$PROXY_STATUS" == "200" ]] || fail "Nginx 反向代理健康检查失败，预期 HTTP 200，实际为 ${PROXY_STATUS:-无响应}。"

IP="$(hostname -I | awk '{print $1}')"
echo
echo "安装完成。访问地址：http://${IP}:${PUBLIC_PORT}/"
echo "首次访问将显示管理员初始化页，请设置管理员用户名和至少 12 位密码。"
echo "已自动配置每分钟启动、每 10 秒扫描的 cron 调度，无需在界面额外生成或粘贴调度令牌。"
