import type { Request, Response } from "express";
import * as db from "./db";
import { hashToken, safelyCompareHash } from "./monitoring/crypto";
import { runDueMonitorTasks } from "./monitoring/service";

function getBearerToken(request: Request): string | null {
  const authorization = request.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function isSchedulerAuthorized(token: string): Promise<boolean> {
  const candidate = hashToken(token);
  const localToken = process.env.LOCAL_SCHEDULER_TOKEN;
  if (localToken && safelyCompareHash(hashToken(localToken), candidate)) return true;
  const records = await db.listSchedulerTokenHashes();
  return records.some(record => safelyCompareHash(record.cronTokenHash, candidate));
}

export async function monitorRunHandler(request: Request, response: Response) {
  const token = getBearerToken(request);
  if (!token || !(await isSchedulerAuthorized(token))) {
    return response.status(401).json({ error: "无效的调度令牌。" });
  }

  try {
    const results = await runDueMonitorTasks();
    return response.json({ ok: true, checked: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
