export function isSupportedExternalPort(port: number | null): boolean {
  return port === null || port === 80 || (Number.isInteger(port) && port >= 1024 && port <= 65_535);
}

export function formatAccessPortRequest(requestedPort: number | null, previousPort: number | null): string {
  if (!isSupportedExternalPort(requestedPort) || !isSupportedExternalPort(previousPort)) {
    throw new Error("访问端口仅支持 80 或 1024–65535；HTTPS 的 443 端口由域名证书配置管理。");
  }
  return `requestedPort=${requestedPort ?? ""}\npreviousPort=${previousPort ?? ""}\n`;
}
