# Sentinel 网站监控系统

Sentinel 是可自行部署在 Linux 服务器上的网站可用性与内容监控系统。它支持定期检查 URL、按不区分大小写的期望/禁止内容规则判断异常、记录 DNS 解析地址变化，并通过 SMTP 发送首次故障、连续提醒与恢复通知。

## 一条命令安装

在新安装的 Ubuntu 20.04+ Debian 11+ 或 CentOS 7+ 服务器上，以具备 `sudo` 权限的账号执行以下命令。安装器会下载公开源码、安装运行依赖、构建应用、配置 systemd、Nginx 反向代理和每分钟 cron 调度；首次打开网页时再设置管理员用户名和密码。

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install.sh | sudo bash
```

默认管理入口使用 `80` 端口，应用仅监听本机 `127.0.0.1:3201`。如需使用其他公网端口，可在命令中传入 `PUBLIC_PORT`：

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install.sh | sudo env PUBLIC_PORT=18080 bash
```

已有宝塔面板及既有网站时，请使用隔离安装器。它默认仅新增 `18080` 管理入口与本机 `3202` 应用端口，不改写宝塔 `80`、`443`、面板端口或现有站点：

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install-bt-isolated.sh | sudo bash
```

> 安装脚本会创建新的 Sentinel 部署。若服务器上已有同名 `site-monitor.service`，请先备份数据并按升级说明操作，避免覆盖现网实例。

## 首次使用

安装完成后访问终端显示的地址。首次访问会强制进入 **管理员初始化** 页面，设置用户名与至少 12 位密码后自动登录。之后管理员可在 **通知与调度** 页面配置 SMTP，随后在 **监控任务** 页面创建 URL、检查频率、内容规则与告警策略。

| 项目 | 默认配置 | 说明 |
| --- | --- | --- |
| 应用端口 | `3201`（通用）/ `3202`（宝塔隔离） | 仅监听 `127.0.0.1`，不要向公网开放。 |
| 管理入口 | `80`（通用）/ `18080`（宝塔隔离） | 由 Nginx 转发到应用。 |
| 调度 | 每分钟 | cron 自动请求受本机令牌保护的调度端点。 |
| 数据库 | SQLite | 默认保存在应用目录的 `data/site-monitor.sqlite`。 |

详细的部署、备份、端口与排障说明请阅读 [QUICK_INSTALL.md](QUICK_INSTALL.md)、[OTHER_SERVER_INSTALL.md](OTHER_SERVER_INSTALL.md) 和 [BT_ISOLATED_DEPLOY.md](BT_ISOLATED_DEPLOY.md)。
