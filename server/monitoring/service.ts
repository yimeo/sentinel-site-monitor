import type { MonitorTask } from "../../drizzle/schema";
import * as db from "../db";
import { checkUrl, statusFromCheck } from "./engine";
import { sendMonitorAlert } from "./mail";

export type RunResult = {
  taskId: number;
  status: "up" | "down" | "content_mismatch";
  notification: "alert" | "recovery" | "none" | "delivery_failed";
};

export function formatOutageDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [days > 0 ? `${days}天` : "", hours > 0 ? `${hours}小时` : "", minutes > 0 ? `${minutes}分` : "", remainingSeconds > 0 || seconds === 0 ? `${remainingSeconds}秒` : ""].filter(Boolean);
  return parts.join("");
}

async function sendStateChangeEmail(
  task: MonitorTask,
  type: "alert" | "recovery",
  data: { status: string; httpStatus: number | null; responseTimeMs: number | null; errorMessage: string | null; outageDuration?: string }
): Promise<boolean> {
  const smtp = await db.getSmtpSettings(task.ownerId);
  if (!smtp) return false;
  const settings = await db.getSiteSettings();
  await sendMonitorAlert(smtp, {
    type,
    taskName: task.name,
    url: task.url,
    templates: settings,
    ...data,
  });
  return true;
}

export async function runMonitorTask(task: MonitorTask): Promise<RunResult> {
  const result = await checkUrl(task);
  const nextStatus = statusFromCheck(result);
  const isHealthy = result.status === "success";
  const now = new Date();
  const shouldInitialAlert = !isHealthy && (!task.alertOpen || !task.lastAlertAt);
  const shouldRepeatAlert = !isHealthy && task.alertOpen && task.alertMode === "repeat" && task.lastAlertAt !== null
    && now.getTime() - task.lastAlertAt.getTime() >= task.repeatAlertMinutes * 60_000;
  const shouldAlert = shouldInitialAlert || shouldRepeatAlert;
  const shouldRecover = isHealthy && task.alertOpen;

  await db.recordMonitorCheck(task.id, result, {
    status: nextStatus,
    lastCheckedAt: now,
    nextCheckAt: new Date(now.getTime() + task.intervalMinutes * 60_000),
    lastResponseTimeMs: result.responseTimeMs,
    lastHttpStatus: result.httpStatus,
    lastError: result.errorMessage,
    alertOpen: !isHealthy,
    lastAlertAt: shouldRecover ? null : task.lastAlertAt,
    lastFailureAt: isHealthy ? task.lastFailureAt : (task.alertOpen ? task.lastFailureAt ?? now : now),
    lastRecoveredAt: shouldRecover ? now : task.lastRecoveredAt,
  });

  if (!shouldAlert && !shouldRecover) {
    return { taskId: task.id, status: nextStatus, notification: "none" };
  }

  try {
    const delivered = await sendStateChangeEmail(task, shouldAlert ? "alert" : "recovery", {
      status: nextStatus === "up" ? "正常" : nextStatus === "down" ? "不可用" : "内容不匹配",
      httpStatus: result.httpStatus,
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
      outageDuration: shouldRecover && task.lastFailureAt ? formatOutageDuration(now.getTime() - task.lastFailureAt.getTime()) : "—",
    });
    if (!delivered) return { taskId: task.id, status: nextStatus, notification: "delivery_failed" };
    if (shouldAlert) await db.updateMonitorTask(task.ownerId, task.id, { lastAlertAt: now });
    return { taskId: task.id, status: nextStatus, notification: shouldAlert ? "alert" : "recovery" };
  } catch (error) {
    console.error(`[Monitoring] Mail notification for task ${task.id} could not be delivered:`, error);
    return { taskId: task.id, status: nextStatus, notification: "delivery_failed" };
  }
}

export async function runMonitorTasks(tasks: MonitorTask[], concurrency = 3): Promise<RunResult[]> {
  const uniqueTasks = Array.from(new Map(tasks.map(task => [task.id, task])).values());
  const results: RunResult[] = [];
  const limit = Math.min(5, Math.max(1, Math.floor(concurrency)));
  for (let index = 0; index < uniqueTasks.length; index += limit) {
    results.push(...await Promise.all(uniqueTasks.slice(index, index + limit).map(runMonitorTask)));
  }
  return results;
}

export async function runDueMonitorTasks(): Promise<RunResult[]> {
  const dueTasks = await db.listDueMonitorTasks();
  const results: RunResult[] = [];
  for (const task of dueTasks) {
    results.push(await runMonitorTask(task));
  }
  return results;
}
