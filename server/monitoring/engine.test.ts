import { afterEach, describe, expect, it, vi } from "vitest";
import { checkUrl, createFreshDnsDispatcher, validateMonitorUrl } from "./engine";

describe("monitor engine", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("只接受完整的 HTTP(S) URL", () => {
    expect(validateMonitorUrl("https://example.com")).toBe("https://example.com/");
    expect(() => validateMonitorUrl("example.com")).toThrow("请输入完整");
    expect(() => validateMonitorUrl("file:///etc/passwd")).toThrow("仅支持 HTTP");
  });

  it("为每次检查创建独立的 DNS 请求调度器", async () => {
    const first = createFreshDnsDispatcher();
    const second = createFreshDnsDispatcher();
    expect(first).not.toBe(second);
    await first.close();
    await second.close();
  });

  it("在页面缺少期望内容时返回内容不匹配", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>Welcome</h1>", { status: 200 })));
    const result = await checkUrl({ url: "https://example.com", expectedContent: "Dashboard" } as never);
    expect(result).toMatchObject({ status: "content_mismatch", httpStatus: 200, expectedContentMatched: false });
  });

  it("在成功响应且内容匹配时返回成功", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("System Online", { status: 200 })));
    const result = await checkUrl({ url: "https://example.com", expectedContent: "Online" } as never);
    expect(result).toMatchObject({ status: "success", httpStatus: 200, expectedContentMatched: true, resolvedAddresses: expect.any(Array) });
  });

  it("期望内容匹配不区分英文字母大小写", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("SYSTEM ONLINE", { status: 200 })));
    const result = await checkUrl({ url: "https://example.com", expectedContent: "system online" } as never);
    expect(result).toMatchObject({ status: "success", httpStatus: 200, expectedContentMatched: true });
  });

  it("在页面出现禁止内容时返回内容不匹配和具体命中项", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("系统维护中，请稍后再试", { status: 200 })));
    const result = await checkUrl({ url: "https://example.com", expectedContent: null, forbiddenContent: "访问被拒绝；系统维护中" } as never);
    expect(result).toMatchObject({ status: "content_mismatch", httpStatus: 200, errorMessage: "页面出现禁止内容：系统维护中" });
  });

  it("禁止内容匹配不区分英文字母大小写且保留配置中的命中项", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service is MAINTENANCE MODE", { status: 200 })));
    const result = await checkUrl({ url: "https://example.com", expectedContent: null, forbiddenContent: "maintenance mode" } as never);
    expect(result).toMatchObject({ status: "content_mismatch", httpStatus: 200, errorMessage: "页面出现禁止内容：maintenance mode" });
  });
});
