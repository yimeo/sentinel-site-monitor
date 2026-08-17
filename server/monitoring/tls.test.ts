import { describe, expect, it } from "vitest";
import { formatTlsSettingsRequest, normalizeAccessHostname } from "./tls";

describe("TLS 域名与请求格式", () => {
  it("接受无协议域名并兼容误输入的协议前缀", () => {
    expect(normalizeAccessHostname("monitor.example.com")).toBe("monitor.example.com");
    expect(normalizeAccessHostname("https://Monitor.Example.com/")).toBe("monitor.example.com");
    expect(() => normalizeAccessHostname("https://monitor.example.com/path")).toThrow("有效域名");
  });

  it("拒绝不匹配的证书与私钥", () => {
    expect(() => formatTlsSettingsRequest({ hostname: "monitor.example.com", certificate: "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----", privateKey: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----" })).toThrow("证书校验失败");
  });
});
