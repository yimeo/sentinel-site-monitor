# Sentinel 一键安装说明

本文档适用于 **Ubuntu 20.04+** 与 **CentOS 7+** 的新服务器。公开仓库不包含 SQLite 数据库、监控历史、SMTP 授权码、管理员凭据、调度令牌、构建产物或依赖目录。

## 最快安装方式

以具备 `sudo` 权限的系统账号执行一条命令。安装器会从 GitHub 下载源码，自动安装系统依赖、Node.js、pnpm、Nginx 和 cron，随后构建应用并创建 systemd、反向代理与每分钟调度配置。

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install.sh | sudo bash
```

安装过程**不会询问或预置管理员用户名与密码**。完成后访问终端显示的地址，首次访问会强制打开管理员初始化页面；设置用户名和至少 12 位密码后会自动登录。

| 可选环境变量 | 默认值 | 传入方式 | 用途 |
| --- | --- | --- | --- |
| `APP_DIR` | `/opt/sentinel-site-monitor` | `sudo env APP_DIR=/opt/sentinel bash` | 应用安装目录。 |
| `APP_PORT` | `3201` | `sudo env APP_PORT=3202 bash` | 仅本机监听的应用端口。 |
| `PUBLIC_PORT` | `80` | `sudo env PUBLIC_PORT=18080 bash` | Nginx 对公网提供管理入口的端口。 |
| `SENTINEL_BRANCH` | `main` | `sudo env SENTINEL_BRANCH=release-x bash` | 要下载的 GitHub 分支。 |

例如，使用 `18080` 作为管理入口：

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install.sh | sudo env PUBLIC_PORT=18080 bash
```

> **重要：** 通用安装器会为 Sentinel 配置指定的公网端口。若服务器已使用 Nginx 托管其他站点或已有宝塔面板，请改用 [BT_ISOLATED_DEPLOY.md](BT_ISOLATED_DEPLOY.md) 的隔离安装器，避免改写既有站点入口。

## 自动完成的安全与调度配置

应用进程只监听 `127.0.0.1`，公网请求由 Nginx 反向代理转发。安装器为本机 cron 生成独立随机令牌并写入 root 可读的 `/etc/site-monitor.env` 与 `/etc/cron.d/site-monitor`，因此无需在管理界面另行生成或粘贴调度命令。安装结束前会验证 systemd 服务、本机应用入口、Nginx 入口和一次受令牌保护的调度请求。

| 验证项 | 预期结果 |
| --- | --- |
| `site-monitor` 服务 | `active (running)` |
| `http://127.0.0.1:APP_PORT/` | HTTP `200` |
| `http://127.0.0.1:PUBLIC_PORT/` | HTTP `200`，显示首次初始化或独立登录页面 |
| 调度入口 | 使用本机令牌返回成功 JSON |

## 首次使用后的配置

管理员初始化完成后，在 **通知与调度 → SMTP** 配置邮件服务并发送测试邮件；再到 **监控任务** 新建 URL、检查间隔、必须出现/禁止出现的内容规则和告警策略。cron 已经自动运行，只会检查已到期且已启用的任务。

## 运维、备份与恢复

```bash
# 查看服务状态与日志
sudo systemctl status site-monitor
sudo journalctl -u site-monitor -f

# 重启应用及校验 Nginx
sudo systemctl restart site-monitor
sudo nginx -t && sudo systemctl reload nginx

# 备份 SQLite 数据与本机运行配置
sudo tar -czf sentinel-backup-$(date +%F).tar.gz \
  /opt/sentinel-site-monitor/data/site-monitor.sqlite /etc/site-monitor.env
```

如更改了 `APP_DIR`，请同步调整备份路径。恢复时先停止服务，恢复 SQLite 和环境文件，再启动 `site-monitor` 服务。

将域名 A 记录指向服务器公网 IP 后，可将 `/etc/nginx/conf.d/site-monitor.conf` 的 `server_name _;` 改为实际域名，并在申请 HTTPS 证书后保留 `X-Forwarded-Proto` 转发头。无论使用 HTTP 还是 HTTPS，都不要将 `APP_PORT` 直接开放到公网。
