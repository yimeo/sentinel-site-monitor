import { z } from "zod";
import { isSupportedExternalPort } from "./access";
import { localAdminUsernamePattern } from "./adminAuth";

export const mailTemplatesInput = z.object({
  alertSubject: z.string().trim().min(1, "请输入故障邮件主题。").max(300),
  alertBody: z.string().trim().min(1, "请输入故障邮件正文。").max(20_000),
  recoverySubject: z.string().trim().min(1, "请输入恢复邮件主题。").max(300),
  recoveryBody: z.string().trim().min(1, "请输入恢复邮件正文。").max(20_000),
});

export const accessSettingsInput = z.object({
  publicUrl: z.string().trim().url("请输入完整访问地址，例如 https://monitor.example.com。").max(500).nullable(),
  requestedPort: z.number().int().min(1).max(65_535).nullable().refine(isSupportedExternalPort, "外部访问端口仅支持 80 或 1024–65535；HTTPS 的 443 端口将在域名证书配置时启用。"),
});

export const localAdminPasswordInput = z.object({
  password: z.string().min(12, "管理员密码至少需要 12 个字符。").max(256),
  confirmation: z.string(),
}).refine(input => input.password === input.confirmation, { message: "两次输入的管理员密码不一致。", path: ["confirmation"] });

export const localAdminUsernameInput = z.object({
  username: z.string().trim().regex(localAdminUsernamePattern, "管理员用户名需为 3–64 位字母、数字、点、下划线或连字符，且必须以字母或数字开头。"),
});
