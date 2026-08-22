import { z } from "zod";
import { isSupportedExternalPort } from "./access";
import { localAdminUsernamePattern } from "./adminAuth";
import { normalizeAccessHostname, validateCustomTls } from "./tls";

export const mailTemplatesInput = z.object({
  alertSubject: z.string().trim().min(1, "请输入故障邮件主题。").max(300),
  repeatAlertSubject: z.string().trim().min(1, "请输入重复故障邮件主题。").max(300),
  alertBody: z.string().trim().min(1, "请输入故障邮件正文。").max(20_000),
  recoverySubject: z.string().trim().min(1, "请输入恢复邮件主题。").max(300),
  recoveryBody: z.string().trim().min(1, "请输入恢复邮件正文。").max(20_000),
});

export const accessSettingsInput = z.object({
  publicUrl: z.string().trim().max(253).nullable()
    .refine(value => {
      if (!value) return true;
      try { normalizeAccessHostname(value); return true; } catch { return false; }
    }, "请输入有效域名，例如 monitor.example.com；无需填写 http:// 或 https://。")
    .transform(value => value ? normalizeAccessHostname(value) : null),
  requestedPort: z.number().int().min(1).max(65_535).nullable().refine(isSupportedExternalPort, "外部访问端口仅支持 80 或 1024–65535；HTTPS 的 443 端口将在域名证书配置时启用。"),
});

export const customTlsInput = z.object({
  hostname: z.string().trim().min(1).max(253),
  certificate: z.string().min(64).max(120_000),
  privateKey: z.string().min(64).max(120_000),
  certificateChain: z.string().max(240_000).nullable().optional(),
  allowInsecureTransport: z.boolean().default(false),
}).transform(value => ({ ...validateCustomTls(value), allowInsecureTransport: value.allowInsecureTransport }));

export const localAdminPasswordInput = z.object({
  password: z.string().min(12, "管理员密码至少需要 12 个字符。").max(256),
  confirmation: z.string(),
}).refine(input => input.password === input.confirmation, { message: "两次输入的管理员密码不一致。", path: ["confirmation"] });

export const localAdminUsernameInput = z.object({
  username: z.string().trim().regex(localAdminUsernamePattern, "管理员用户名需为 3–64 位字母、数字、点、下划线或连字符，且必须以字母或数字开头。"),
});
