import crypto from "node:crypto";

const getKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("应用加密密钥不可用，请设置 JWT_SECRET。");
  return crypto.createHash("sha256").update(secret).digest();
};

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("保存的凭据格式无效。");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createSchedulerToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function safelyCompareHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function hashPassword(value: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(value, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(value: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, encodedHash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, "base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(value, salt, expected.length, (error, key) => error ? reject(error) : resolve(key));
  });
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
