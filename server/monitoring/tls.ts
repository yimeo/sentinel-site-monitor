import crypto from "node:crypto";

export type TlsSettingsInput = {
  hostname: string;
  certificate: string;
  privateKey: string;
  certificateChain?: string | null;
};

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeAccessHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请输入域名，例如 monitor.example.com。");
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (withoutProtocol.includes("/") || withoutProtocol.includes(":") || !hostnamePattern.test(withoutProtocol)) {
    throw new Error("请输入有效域名，例如 monitor.example.com；无需填写 http:// 或 https://。");
  }
  return withoutProtocol.toLowerCase();
}

export function validateCustomTls(input: TlsSettingsInput): TlsSettingsInput {
  const hostname = normalizeAccessHostname(input.hostname);
  const certificate = input.certificate.trim();
  const privateKey = input.privateKey.trim();
  const certificateChain = input.certificateChain?.trim() || null;
  if (!certificate.includes("-----BEGIN CERTIFICATE-----")) throw new Error("证书内容不是有效的 PEM 证书。");
  if (!privateKey.includes("-----BEGIN") || !privateKey.includes("PRIVATE KEY-----")) throw new Error("私钥内容不是有效的 PEM 私钥。");
  try {
    const x509 = new crypto.X509Certificate(certificate);
    const key = crypto.createPrivateKey(privateKey);
    if (!x509.checkPrivateKey(key)) throw new Error("私钥与证书不匹配。");
    if (x509.validTo && new Date(x509.validTo).getTime() <= Date.now()) throw new Error("证书已经过期。");
  } catch (error) {
    throw new Error(error instanceof Error && error.message ? `证书校验失败：${error.message}` : "证书或私钥校验失败。");
  }
  if (certificateChain && !certificateChain.includes("-----BEGIN CERTIFICATE-----")) throw new Error("证书链必须是 PEM 格式证书。");
  return { hostname, certificate: `${certificate}\n`, privateKey: `${privateKey}\n`, certificateChain: certificateChain ? `${certificateChain}\n` : null };
}

export function formatTlsSettingsRequest(input: TlsSettingsInput): string {
  const valid = validateCustomTls(input);
  const encode = (value: string | null | undefined) => value ? Buffer.from(value, "utf8").toString("base64") : "";
  return `hostname=${valid.hostname}\ncertificateBase64=${encode(valid.certificate)}\nprivateKeyBase64=${encode(valid.privateKey)}\ncertificateChainBase64=${encode(valid.certificateChain)}\n`;
}
