import { describe, expect, it } from "vitest";
import { accessSettingsInput, localAdminPasswordInput, localAdminUsernameInput, mailTemplatesInput } from "./settingsValidation";

const validTemplates = {
  alertSubject: "故障 {{taskName}}",
  repeatAlertSubject: "故障告警{{alertCount}}（N）：{{taskName}} 故障持续时长：{{outageDuration}}",
  alertBody: "目标 {{url}} 不可用",
  recoverySubject: "恢复 {{taskName}}",
  recoveryBody: "目标 {{url}} 已恢复",
};

describe("安全与通知设置输入校验", () => {
  it("拒绝过短或不一致的管理员密码", () => {
    expect(localAdminPasswordInput.safeParse({ password: "short", confirmation: "short" }).success).toBe(false);
    expect(localAdminPasswordInput.safeParse({ password: "0123456789ab", confirmation: "different-pass" }).success).toBe(false);
    expect(localAdminPasswordInput.safeParse({ password: "0123456789ab", confirmation: "0123456789ab" }).success).toBe(true);
  });

  it("拒绝空邮件模板字段并接受完整模板", () => {
    expect(mailTemplatesInput.safeParse({ ...validTemplates, alertBody: "   " }).success).toBe(false);
    expect(mailTemplatesInput.safeParse(validTemplates).success).toBe(true);
  });

  it("执行邮件主题和正文的长度边界限制", () => {
    expect(mailTemplatesInput.safeParse({ ...validTemplates, alertSubject: "a".repeat(300), alertBody: "b".repeat(20_000) }).success).toBe(true);
    expect(mailTemplatesInput.safeParse({ ...validTemplates, alertSubject: "a".repeat(301) }).success).toBe(false);
    expect(mailTemplatesInput.safeParse({ ...validTemplates, alertBody: "b".repeat(20_001) }).success).toBe(false);
  });

  it("接受无协议域名与受支持的管理端口", () => {
    expect(accessSettingsInput.safeParse({ publicUrl: "monitor.example.com", requestedPort: 8080 }).data?.publicUrl).toBe("monitor.example.com");
    expect(accessSettingsInput.safeParse({ publicUrl: null, requestedPort: 443 }).success).toBe(false);
    expect(accessSettingsInput.safeParse({ publicUrl: "https://monitor.example.com", requestedPort: 8080 }).data?.publicUrl).toBe("monitor.example.com");
    expect(accessSettingsInput.safeParse({ publicUrl: "monitor.example.com/path", requestedPort: 8080 }).success).toBe(false);
    expect(accessSettingsInput.safeParse({ publicUrl: null, requestedPort: 65_535 }).success).toBe(true);
    expect(accessSettingsInput.safeParse({ publicUrl: null, requestedPort: 65_536 }).success).toBe(false);
  });

  it("限制本地管理员用户名的安全字符和长度", () => {
    expect(localAdminUsernameInput.safeParse({ username: "admin" }).success).toBe(true);
    expect(localAdminUsernameInput.safeParse({ username: "ops_admin-01" }).success).toBe(true);
    expect(localAdminUsernameInput.safeParse({ username: "ab" }).success).toBe(false);
    expect(localAdminUsernameInput.safeParse({ username: "admin name" }).success).toBe(false);
    expect(localAdminUsernameInput.safeParse({ username: ".admin" }).success).toBe(false);
  });
});
