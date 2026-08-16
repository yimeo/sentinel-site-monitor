import { describe, expect, it } from "vitest";
import { formatAccessPortRequest, isSupportedExternalPort } from "./access";

describe("访问端口同步请求", () => {
  it("仅接受默认 HTTP 端口或非特权自定义端口", () => {
    expect(isSupportedExternalPort(null)).toBe(true);
    expect(isSupportedExternalPort(80)).toBe(true);
    expect(isSupportedExternalPort(1024)).toBe(true);
    expect(isSupportedExternalPort(65535)).toBe(true);
    expect(isSupportedExternalPort(443)).toBe(false);
    expect(isSupportedExternalPort(1023)).toBe(false);
    expect(isSupportedExternalPort(65536)).toBe(false);
  });

  it("以最小、可解析的格式传递新旧端口", () => {
    expect(formatAccessPortRequest(8080, null)).toBe("requestedPort=8080\npreviousPort=\n");
    expect(formatAccessPortRequest(null, 8080)).toBe("requestedPort=\npreviousPort=8080\n");
    expect(() => formatAccessPortRequest(443, null)).toThrow("访问端口仅支持");
  });
});
