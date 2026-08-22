import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./crypto";
import { buildMonitorAlertBody, buildMonitorAlertSubject, buildSmtpTransportOptions, renderMailTemplate, renderMonitorEmailHtml } from "./mail";
import { defaultMailTemplates } from "../db";

describe("local administrator password", () => {
  it("uses a salted hash and verifies only the original password", async () => {
    const password = "sentinel-admin-password";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect-password", hash)).resolves.toBe(false);
  });
});

describe("mail template variables", () => {
  it("重复告警主题显示次数，首次告警主题保持不变", () => {
    expect(buildMonitorAlertSubject("[Sentinel] 故障告警：{{taskName}}", "alert", 1)).toBe("[Sentinel] 故障告警：{{taskName}}");
    expect(buildMonitorAlertSubject("[Sentinel] 故障告警：{{taskName}}", "alert", 2)).toBe("[Sentinel] 故障告警2：{{taskName}}");
    expect(buildMonitorAlertSubject("故障告警：{{taskName}}", "alert", 3)).toBe("故障告警3：{{taskName}}");
    expect(buildMonitorAlertSubject("告警 {{alertCount}}：{{taskName}}", "alert", 4)).toBe("告警 {{alertCount}}：{{taskName}}");
  });

  it("首次故障保持普通正文，重复告警才追加次数和时长摘要", () => {
    expect(buildMonitorAlertBody("状态：{{status}}", "alert", 1)).toBe("状态：{{status}}");
    expect(buildMonitorAlertBody("状态：{{status}}", "alert", 2)).toContain("当前告警次数：第 {{alertCount}} 次");
    expect(buildMonitorAlertBody("状态：{{status}}", "alert", 2)).toContain("故障持续时长：{{outageDuration}}");
  });

  it("includes an editable outage duration field in the default recovery template", () => {
    expect(defaultMailTemplates.recoveryBody).toContain("故障持续时长：{{outageDuration}}");
  });

  it("renders supported variables without replacing unknown placeholders", () => {
    const output = renderMailTemplate("{{ taskName }} · {{status}} · {{unknown}}", {
      taskName: "官网首页", url: "https://example.com", status: "内容不匹配", httpStatus: "200", responseTimeMs: "32 ms", errorMessage: "—", outageDuration: "2分15秒", checkedAt: "2026/08/14 21:00:00",
    });
    expect(output).toBe("官网首页 · 内容不匹配 · {{unknown}}");
  });

  it("renders the monitored URL as a safe clickable HTML link", () => {
    const html = renderMonitorEmailHtml("目标：https://example.com/\n详情：<script>", "https://example.com/");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<br />");
  });

  it("keeps a plain escaped body when the URL is unsupported", () => {
    expect(renderMonitorEmailHtml("目标：javascript:alert(1)", "javascript:alert(1)")).not.toContain("href=");
  });

  it("renders the outage duration variable", () => {
    const output = renderMailTemplate("故障持续 {{outageDuration}}", {
      taskName: "官网首页", url: "https://example.com", status: "正常", httpStatus: "200", responseTimeMs: "32 ms", errorMessage: "—", outageDuration: "1小时2分3秒", checkedAt: "2026/08/14 21:00:00",
    });
    expect(output).toBe("故障持续 1小时2分3秒");
  });

  it("forces SMTP connections to prefer IPv4 when the server has no IPv6 route", () => {
    const options = buildSmtpTransportOptions({
      host: "smtp.example.com", port: 587, secure: false, username: "monitor@example.com",
      passwordEncrypted: null, fromEmail: "monitor@example.com", recipients: "ops@example.com",
    });
    expect(options.family).toBe(4);
    expect(options.host).toBe("smtp.example.com");
  });
});
