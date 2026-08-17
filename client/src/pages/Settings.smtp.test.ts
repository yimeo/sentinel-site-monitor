import { describe, expect, it } from "vitest";
import { getSmtpPortForSecurity } from "./Settings";

describe("SMTP SSL/TLS 默认端口联动", () => {
  it("开启 SSL/TLS 时将标准提交端口 587 切换为 465", () => {
    expect(getSmtpPortForSecurity("587", true)).toBe("465");
  });

  it("关闭 SSL/TLS 时将标准隐式 TLS 端口 465 恢复为 587", () => {
    expect(getSmtpPortForSecurity("465", false)).toBe("587");
  });

  it("保留管理员手动指定的其他 SMTP 端口", () => {
    expect(getSmtpPortForSecurity("2525", true)).toBe("2525");
    expect(getSmtpPortForSecurity("2525", false)).toBe("2525");
  });
});
