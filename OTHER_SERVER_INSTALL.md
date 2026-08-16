# Sentinel 在其他 Linux 服务器上的安装教程

> **优先使用 `QUICK_INSTALL.md` 中的一键安装器。** 本文档保留给宝塔面板、已有 Nginx 站点、非默认安装目录、手动升级与故障排查等场景。

本指南适用于 **Ubuntu 20.04+** 或 **CentOS 7+**。源码包不包含数据库、SMTP 密码、管理员密码、调度令牌或任何现有服务器配置。

## 1. 前置条件

| 项目 | 建议 |
|---|---|
| Node.js | Ubuntu 使用 Node.js 20 LTS；CentOS 7 使用 Node.js 16.20.x（兼容 GLIBC 2.17） |
| Web 服务 | Nginx；宝塔环境请使用其 Nginx 路径 |
| 数据库 | 无需 MySQL；应用自动创建 SQLite 文件 |
| 权限 | root 或具备 sudo 权限的系统管理员 |

> 请先在防火墙或安全组放行 Web 端口（通常为 80/443）。应用端口仅绑定 `127.0.0.1`，不应直接暴露到公网。

## 2. 上传、安装依赖并构建

将源码包上传到服务器并执行：

```bash
corepack enable
corepack prepare pnpm@10 --activate
pnpm --version
sudo mkdir -p /www/wwwroot/site-monitor
sudo tar -xzf sentinel-site-monitor-source.tar.gz -C /www/wwwroot/site-monitor --strip-components=1
cd /www/wwwroot/site-monitor
pnpm install --frozen-lockfile
pnpm build
sudo useradd --system --no-create-home --shell /sbin/nologin site-monitor 2>/dev/null || true
sudo mkdir -p /var/lib/site-monitor /www/wwwroot/site-monitor/data
sudo chown -R site-monitor:site-monitor /www/wwwroot/site-monitor /var/lib/site-monitor
```

如果系统不带 Corepack，请安装与 Node.js 版本兼容的 Corepack，或使用 `npm install -g pnpm` 安装 pnpm。CentOS 7 应选择与 Node.js 16 兼容的 pnpm 版本。

## 3. 创建应用环境文件与 systemd 服务

创建 `/etc/site-monitor.env`，将示例中的随机密钥替换为自己的高强度值：

```ini
NODE_ENV=production
PORT=3201
BIND_HOST=127.0.0.1
LOCAL_DEPLOYMENT=true
SQLITE_DB_PATH=/www/wwwroot/site-monitor/data/site-monitor.sqlite
JWT_SECRET=请替换为至少32字符的随机字符串
LOCAL_SCHEDULER_TOKEN=请替换为64位随机十六进制字符串
ACCESS_SETTINGS_REQUEST_PATH=/var/lib/site-monitor/access-port.request
VHOST_FILE=/etc/nginx/conf.d/site-monitor.conf
NGINX_BIN=/usr/sbin/nginx
BASE_ACCESS_PORT=80
```

创建 `/etc/systemd/system/site-monitor.service`：

```ini
[Unit]
Description=Sentinel Site Monitor
After=network.target

[Service]
Type=simple
User=site-monitor
Group=site-monitor
WorkingDirectory=/www/wwwroot/site-monitor
EnvironmentFile=/etc/site-monitor.env
ExecStart=/usr/bin/node /www/wwwroot/site-monitor/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now site-monitor
sudo systemctl status site-monitor
curl http://127.0.0.1:3201/
```

如果 `node` 位于其他路径，请将 `ExecStart` 中的 `/usr/bin/node` 改为 `command -v node` 的结果。

## 4. Nginx 反向代理与独立登录

创建 Nginx 站点配置，示例 `/etc/nginx/conf.d/site-monitor.conf`：

```nginx
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3201;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

执行 `sudo nginx -t && sudo systemctl reload nginx`。首次打开页面时，系统会显示独立的管理员初始化页面；设置用户名和至少 12 位密码后自动登录。以后可在 **通知与调度 → 本地管理员认证** 中修改登录名和密码。

## 5. 启用后台端口同步服务

```bash
sudo install -m 700 scripts/apply-access-port.sh /usr/local/sbin/site-monitor-apply-access-port
sudo install -m 644 scripts/site-monitor-access-port.service scripts/site-monitor-access-port.path /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now site-monitor-access-port.path
```

## 6. 配置每分钟调度

将 `/etc/site-monitor.env` 中的 `LOCAL_SCHEDULER_TOKEN` 复制到 root 可读的 cron 文件。先确保 cron 服务已启用：

```cron
* * * * * root /usr/bin/curl -fsS -X POST 'http://127.0.0.1:3201/api/scheduled/monitor-run' -H 'Authorization: Bearer <LOCAL_SCHEDULER_TOKEN>' >> /var/log/site-monitor-cron.log 2>&1
```

建议将该行写入 `/etc/cron.d/site-monitor` 后执行 `sudo chmod 600 /etc/cron.d/site-monitor`。令牌只能使用环境文件中的实际值；不要将其写入源码仓库或发送给他人。

## 7. 首次使用与升级

首次打开管理界面后，先完成管理员初始化，再依次配置 SMTP、收件人、监控任务和检查间隔。任务可导出为 JSON，也可在新服务器导入；导入不会带入 SMTP、密码、认证信息、检查历史或告警记录。

升级时先备份 `/www/wwwroot/site-monitor/data/site-monitor.sqlite` 与 `/etc/site-monitor.env`，再替换源码、执行 `pnpm install --frozen-lockfile && pnpm build`，最后 `sudo systemctl restart site-monitor`。
