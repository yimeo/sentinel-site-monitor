import type { MonitorTask } from "../../drizzle/schema";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";

export type CheckResult = {
  status: "success" | "http_error" | "content_mismatch" | "network_error" | "timeout";
  responseTimeMs: number;
  httpStatus: number | null;
  errorMessage: string | null;
  expectedContentMatched: boolean | null;
  resolvedAddresses: string[];
};

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * 每次检查创建独立 Agent，并在检查结束后关闭它。
 * Node 的 dns.lookup 默认不维护应用层缓存；不复用连接可避免 keep-alive
 * 继续向旧 IP 发请求，从而确保下一次检查会遵循当前域名解析结果。
 */
export function createFreshDnsDispatcher() {
  return new Agent({
    connections: 1,
    pipelining: 0,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
}

export function validateMonitorUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("请输入完整的 HTTP 或 HTTPS 地址。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 HTTP 和 HTTPS 地址。");
  }
  return parsed.toString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function splitForbiddenContent(value: string | null): string[] {
  return (value ?? "")
    .split(/[\n,;，；]/)
    .map(item => item.trim())
    .filter(Boolean);
}

export async function checkUrl(task: Pick<MonitorTask, "url" | "expectedContent" | "forbiddenContent">): Promise<CheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const dispatcher = createFreshDnsDispatcher();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resolvedAddresses: string[] = [];

  try {
    const hostname = new URL(task.url).hostname;
    resolvedAddresses = Array.from(new Set((await lookup(hostname, { all: true, verbatim: true })).map(record => record.address)));
    console.info(`[Monitoring][DNS] ${hostname} -> ${resolvedAddresses.join(", ")}`);
    const request = globalThis.fetch ?? undiciFetch;
    const response = await request(task.url, {
      redirect: "follow",
      signal: controller.signal,
      dispatcher,
      headers: {
        "user-agent": "SiteMonitor/1.0 (+website-availability-check)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
      },
    } as RequestInit & { dispatcher: Agent });
    const responseTimeMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        status: "http_error",
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: `HTTP ${response.status} ${response.statusText}`.trim(),
        expectedContentMatched: null,
        resolvedAddresses,
      };
    }

    const expectedContent = task.expectedContent?.trim();
    const forbiddenContent = splitForbiddenContent(task.forbiddenContent);
    if (expectedContent || forbiddenContent.length > 0) {
      const body = await response.text();
      const normalizedBody = body.toLowerCase();
      const expectedMatched = expectedContent ? normalizedBody.includes(expectedContent.toLowerCase()) : null;
      const forbiddenMatch = forbiddenContent.find(item => normalizedBody.includes(item.toLowerCase()));
      if (forbiddenMatch) {
        return {
          status: "content_mismatch",
          responseTimeMs,
          httpStatus: response.status,
          errorMessage: `页面出现禁止内容：${forbiddenMatch}`.slice(0, 1000),
          expectedContentMatched: expectedMatched,
          resolvedAddresses,
        };
      }
      if (expectedMatched === false) {
        return {
          status: "content_mismatch",
          responseTimeMs,
          httpStatus: response.status,
          errorMessage: "页面未包含配置的期望内容。",
          expectedContentMatched: false,
          resolvedAddresses,
        };
      }
      return {
        status: "success",
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: null,
        expectedContentMatched: expectedMatched,
        resolvedAddresses,
      };
    }

    return {
      status: "success",
      responseTimeMs,
      httpStatus: response.status,
      errorMessage: null,
      expectedContentMatched: null,
      resolvedAddresses,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      status: isTimeout ? "timeout" : "network_error",
      responseTimeMs,
      httpStatus: null,
      errorMessage: isTimeout ? `请求在 ${REQUEST_TIMEOUT_MS / 1000} 秒后超时。` : toErrorMessage(error),
      expectedContentMatched: null,
      resolvedAddresses,
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
}

export function statusFromCheck(result: CheckResult): "up" | "down" | "content_mismatch" {
  if (result.status === "success") return "up";
  if (result.status === "content_mismatch") return "content_mismatch";
  return "down";
}
