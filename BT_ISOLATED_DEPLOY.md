# 宝塔服务器独立部署说明

`scripts/deploy-bt-isolated.sh` 用于在已有宝塔环境中新增 Sentinel，而不修改宝塔面板或既有网站端口。脚本默认让应用仅监听 `127.0.0.1:3202`，并在宝塔 Nginx 的站点目录新增一个仅供 Sentinel 使用的 `18080` 监听入口；它不会修改 `8888`、`80`、`443` 或已有站点配置。

## 执行方式

以 root 或具备 `sudo` 权限的账号执行以下命令。安装器会远程下载公开源码，不需要上传压缩包，也不会要求预先提供管理员密码。

```bash
curl -fsSL https://raw.githubusercontent.com/yimeo/sentinel-site-monitor/main/scripts/remote-install-bt-isolated.sh | \
  sudo env PUBLIC_PORT=18080 APP_PORT=3202 bash
```

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| Sentinel 应用端口 | `3202` | 仅绑定本机，不对公网开放。 |
| Sentinel 管理入口 | `18080` | 宝塔 Nginx 新增的独立监听端口。 |
| 宝塔面板端口 | 保持原值 | 脚本不读取、不修改、不重启宝塔面板服务。 |
| 现有网站端口 | `80` / `443` | 脚本不改写既有站点配置或监听端口。 |

安装完成后，使用 `http://服务器IP:18080/` 访问管理入口。若 UFW 已启用，脚本仅增加 Sentinel 的 `18080/tcp` 放行规则。首次访问会强制进入独立的管理员初始化页；请设置用户名和至少 12 位密码，完成后将自动登录。

## 验证命令

```bash
systemctl is-active site-monitor
curl -I http://127.0.0.1:3202/
curl -I http://127.0.0.1:18080/
ss -ltn | grep -E ':(18080|8888|80|443)'
```

预期结果为 `site-monitor` 处于 `active`，本机应用入口和 `18080` 管理入口均返回 HTTP 200，同时宝塔面板和既有 Nginx 端口仍保持监听。安装器会自动写入每分钟 cron 调度及其仅限本机使用的随机令牌。
