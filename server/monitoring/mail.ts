import nodemailer from "nodemailer";
import type { SmtpSettings } from "../../drizzle/schema";
import type { MailTemplates } from "../db";
import { decryptSecret } from "./crypto";

type MailConfig = Pick<SmtpSettings, "host" | "port" | "secure" | "username" | "passwordEncrypted" | "fromEmail" | "recipients">;

export function buildSmtpTransportOptions(config: MailConfig) {
  const username = config.username?.trim();
  const password = config.passwordEncrypted ? decryptSecret(config.passwordEncrypted) : undefined;
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    family: 4 as const,
    auth: username ? { user: username, pass: password ?? "" } : undefined,
  };
}

function buildTransport(config: MailConfig) {
  return nodemailer.createTransport(buildSmtpTransportOptions(config));
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

export type MailTemplateValues = Record<"taskName" | "url" | "status" | "httpStatus" | "responseTimeMs" | "errorMessage" | "checkedAt" | "outageDuration" | "alertCount" | "firstFailureAt", string>;

export function renderMailTemplate(template: string, values: MailTemplateValues): string {
  return template.replace(/{{\s*(taskName|url|status|httpStatus|responseTimeMs|errorMessage|checkedAt|outageDuration|alertCount|firstFailureAt)\s*}}/g, (_, key: keyof MailTemplateValues) => values[key] ?? "");
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

export function buildMonitorAlertSubject(template: string, type: "alert" | "recovery", alertCount = 1): string {
  if (type === "recovery" || alertCount <= 1) return template;
  let subject = template;
  if (template.includes("{{alertCount}}")) subject = template;
  else if (/故障告警\s*[：:]/.test(template)) subject = template.replace(/故障告警\s*(?=[：:])/, `故障告警${alertCount}`);
  else if (/故障\s*[：:]/.test(template)) subject = template.replace(/故障\s*(?=[：:])/, `故障告警${alertCount}`);
  else subject = `故障告警${alertCount}：${template}`;
  return subject.includes("{{outageDuration}}") ? subject : `${subject} 故障持续时长：{{outageDuration}}`;
}
export function buildMonitorAlertBody(template: string, type: "alert" | "recovery", alertCount = 1): string {
  if (type === "recovery" || alertCount <= 1) return template;
  return `${template}\n\n【持续故障提醒】\n当前告警次数：第 {{alertCount}} 次\n首次故障时间：{{firstFailureAt}}\n故障持续时长：{{outageDuration}}`;
}

export async function sendMonitorAlert(
  config: MailConfig,
  input: { type: "alert" | "recovery"; taskName: string; url: string; status: string; httpStatus: number | null; responseTimeMs: number | null; errorMessage: string | null; outageDuration?: string; alertCount?: number; firstFailureAt?: string; templates: MailTemplates }
): Promise<void> {
  const recipients = parseRecipients(config.recipients);
  if (recipients.length === 0) throw new Error("未配置告警收件人。");
  const isRecovery = input.type === "recovery";
  const values: MailTemplateValues = {
    taskName: input.taskName, url: input.url, status: input.status, httpStatus: input.httpStatus?.toString() ?? "—",
    responseTimeMs: input.responseTimeMs !== null ? `${input.responseTimeMs} ms` : "—", errorMessage: input.errorMessage ?? "—",
    checkedAt: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }), outageDuration: input.outageDuration ?? "—", alertCount: input.alertCount?.toString() ?? "1", firstFailureAt: input.firstFailureAt ?? "—",
  };
  const subjectTemplate = isRecovery ? input.templates.recoverySubject : (input.alertCount ?? 1) > 1 ? input.templates.repeatAlertSubject : input.templates.alertSubject;
  const subject = renderMailTemplate(subjectTemplate, values);
  const bodyTemplate = isRecovery && !input.templates.recoveryBody.includes("{{outageDuration}}")
    ? `${input.templates.recoveryBody}\n\n故障持续时长：{{outageDuration}}`
    : buildMonitorAlertBody(isRecovery ? input.templates.recoveryBody : input.templates.alertBody, input.type, input.alertCount ?? 1);
  const text = renderMailTemplate(bodyTemplate, values);
  await buildTransport(config).sendMail({
    from: config.fromEmail,
    to: recipients,
    subject,
    text,
    html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:620px;margin:auto;color:#0f172a;white-space:normal;line-height:1.7">${renderMonitorEmailHtml(text, input.url)}</div>`,
  });
}
