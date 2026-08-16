import nodemailer from "nodemailer";
import type { SmtpSettings } from "../../drizzle/schema";
import type { MailTemplates } from "../db";
import { decryptSecret } from "./crypto";

type MailConfig = Pick<SmtpSettings, "host" | "port" | "secure" | "username" | "passwordEncrypted" | "fromEmail" | "recipients">;

function buildTransport(config: MailConfig) {
  const username = config.username?.trim();
  const password = config.passwordEncrypted ? decryptSecret(config.passwordEncrypted) : undefined;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: username ? { user: username, pass: password ?? "" } : undefined,
  });
}

export function parseRecipients(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] ?? character));
}

export type MailTemplateValues = Record<"taskName" | "url" | "status" | "httpStatus" | "responseTimeMs" | "errorMessage" | "checkedAt" | "outageDuration", string>;

export function renderMailTemplate(template: string, values: MailTemplateValues): string {
  return template.replace(/{{\s*(taskName|url|status|httpStatus|responseTimeMs|errorMessage|checkedAt|outageDuration)\s*}}/g, (_, key: keyof MailTemplateValues) => values[key] ?? "");
}

export function renderMonitorEmailHtml(text: string, url: string): string {
  const html = escapeHtml(text).replace(/\n/g, "<br />");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return html;
    const escapedUrl = escapeHtml(url);
    const link = `<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer" style="color:#0f766e;text-decoration:underline;word-break:break-all">${escapedUrl}</a>`;
    return html.split(escapedUrl).join(link);
  } catch {
    return html;
  }
}

export async function verifySmtp(config: MailConfig): Promise<void> {
  await buildTransport(config).verify();
}

export async function sendTestEmail(config: MailConfig): Promise<void> {
  const recipients = parseRecipients(config.recipients);
  if (recipients.length === 0) throw new Error("请至少配置一个告警收件人。");
  await buildTransport(config).sendMail({
    from: config.fromEmail,
    to: recipients,
    subject: "[Site Monitor] SMTP 测试邮件",
    text: "SMTP 配置验证成功。后续网站故障和恢复信息将发送到此收件人列表。",
    html: "<p>SMTP 配置验证成功。</p><p>后续网站故障和恢复信息将发送到此收件人列表。</p>",
  });
}

export async function sendMonitorAlert(
  config: MailConfig,
  input: { type: "alert" | "recovery"; taskName: string; url: string; status: string; httpStatus: number | null; responseTimeMs: number | null; errorMessage: string | null; outageDuration?: string; templates: MailTemplates }
): Promise<void> {
  const recipients = parseRecipients(config.recipients);
  if (recipients.length === 0) throw new Error("未配置告警收件人。");
  const isRecovery = input.type === "recovery";
  const values: MailTemplateValues = {
    taskName: input.taskName, url: input.url, status: input.status, httpStatus: input.httpStatus?.toString() ?? "—",
    responseTimeMs: input.responseTimeMs !== null ? `${input.responseTimeMs} ms` : "—", errorMessage: input.errorMessage ?? "—",
    checkedAt: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }), outageDuration: input.outageDuration ?? "—",
  };
  const subject = renderMailTemplate(isRecovery ? input.templates.recoverySubject : input.templates.alertSubject, values);
  const bodyTemplate = isRecovery && !input.templates.recoveryBody.includes("{{outageDuration}}")
    ? `${input.templates.recoveryBody}\n\n故障持续时长：{{outageDuration}}`
    : (isRecovery ? input.templates.recoveryBody : input.templates.alertBody);
  const text = renderMailTemplate(bodyTemplate, values);
  await buildTransport(config).sendMail({
    from: config.fromEmail,
    to: recipients,
    subject,
    text,
    html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:620px;margin:auto;color:#0f172a;white-space:normal;line-height:1.7">${renderMonitorEmailHtml(text, input.url)}</div>`,
  });
}
