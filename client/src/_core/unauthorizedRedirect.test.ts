import { describe, expect, it } from "vitest";
import { shouldStartOAuthRedirect } from "./unauthorizedRedirect";

describe("未授权重定向策略", () => {
  it("本地登录和初始化页面不触发 OAuth 跳转", () => {
    expect(shouldStartOAuthRedirect("/login", true)).toBe(false);
    expect(shouldStartOAuthRedirect("/setup", true)).toBe(false);
  });

  it("管理页面未授权时仍触发 OAuth 跳转", () => {
    expect(shouldStartOAuthRedirect("/", true)).toBe(true);
    expect(shouldStartOAuthRedirect("/monitors", true)).toBe(true);
  });

  it("非未授权错误不触发跳转", () => {
    expect(shouldStartOAuthRedirect("/login", false)).toBe(false);
    expect(shouldStartOAuthRedirect("/", false)).toBe(false);
  });
});
