import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getSmtpSettings: vi.fn(),
  getSiteSettings: vi.fn(),
  recordMonitorCheck: vi.fn(),
  updateMonitorTask: vi.fn(),
  listDueMonitorTasks: vi.fn(),
}));
vi.mock("./engine", () => ({ checkUrl: vi.fn(), statusFromCheck: vi.fn() }));
vi.mock("./mail", () => ({ sendMonitorAlert: vi.fn() }));

import * as db from "../db";
import { checkUrl, statusFromCheck } from "./engine";
import { sendMonitorAlert } from "./mail";
import { formatOutageDuration, runDueMonitorTasks, runMonitorTask, runMonitorTasks } from "./service";

const task = {
  id: 7,
  ownerId: 1,
  name: "官网首页",
  url: "https://example.com",
  expectedContent: null,
  intervalMinutes: 5,
  enabled: true,
  alertMode: "once",
  repeatAlertMinutes: 30,
  status: "up",
  lastCheckedAt: null,
  lastResponseTimeMs: null,
  lastHttpStatus: null,
  lastError: null,
  alertOpen: false,
  lastAlertAt: null,
  lastFailureAt: null,
  lastRecoveredAt: null,
  recoverySuccessStreak: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const smtp = {
  host: "smtp.example.com", port: 587, secure: false, username: "user", passwordEncrypted: "encrypted", fromEmail: "alerts@example.com", recipients: "ops@example.com",
};

describe("monitor alert state transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getSmtpSettings).mockResolvedValue(smtp as never);
    vi.mocked(db.getSiteSettings).mockResolvedValue({
      alertSubject: "[Sentinel] 故障：{{taskName}}", alertBody: "{{status}}", recoverySubject: "[Sentinel] 恢复：{{taskName}}", recoveryBody: "{{status}}",
      publicUrl: null, requestedPort: null, adminPasswordHash: null, passwordChangeRequestedAt: null, updatedAt: new Date(),
    } as never);
  });

  it("首次异常时记录状态并只发送一次告警", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "network_error", responseTimeMs: 42, httpStatus: null, errorMessage: "连接失败", expectedContentMatched: null, resolvedAddresses: ["203.0.113.10"] });
    vi.mocked(statusFromCheck).mockReturnValue("down");
    await expect(runMonitorTask(task as never)).resolves.toMatchObject({ status: "down", notification: "alert" });
    expect(db.recordMonitorCheck).toHaveBeenCalledWith(7, expect.objectContaining({ status: "network_error", resolvedAddresses: ["203.0.113.10"] }), expect.objectContaining({ alertOpen: true }));
    expect(sendMonitorAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "alert", taskName: "官网首页" }));
    const values = vi.mocked(db.recordMonitorCheck).mock.calls[0]?.[2] as { nextCheckAt: Date };
    expect(values.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(values.nextCheckAt.getTime()).toBeLessThan(Date.now() + 130_000);
  });

  it("连续异常时保持静默，避免邮件轰炸", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "timeout", responseTimeMs: 20_000, httpStatus: null, errorMessage: "超时", expectedContentMatched: null });
    vi.mocked(statusFromCheck).mockReturnValue("down");
    await expect(runMonitorTask({ ...task, alertOpen: true, lastAlertAt: new Date() } as never)).resolves.toMatchObject({ notification: "none" });
    expect(sendMonitorAlert).not.toHaveBeenCalled();
  });

  it("故障期间每 2 分钟复查，单次成功即恢复并发送通知", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "success", responseTimeMs: 32, httpStatus: 200, errorMessage: null, expectedContentMatched: null });
    vi.mocked(statusFromCheck).mockReturnValue("up");
    const failureStartedAt = new Date(Date.now() - 65_000);
    await expect(runMonitorTask({ ...task, alertOpen: true, lastFailureAt: failureStartedAt } as never)).resolves.toMatchObject({ status: "up", notification: "recovery" });
    const values = vi.mocked(db.recordMonitorCheck).mock.calls[0]?.[2] as { nextCheckAt: Date; recoverySuccessStreak: number };
    expect(values.recoverySuccessStreak).toBe(1);
    expect(values.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(sendMonitorAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "recovery" }));
  });

  it("从异常恢复时发送恢复通知", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "success", responseTimeMs: 32, httpStatus: 200, errorMessage: null, expectedContentMatched: null });
    vi.mocked(statusFromCheck).mockReturnValue("up");
    const failureStartedAt = new Date(Date.now() - 65_000);
    await expect(runMonitorTask({ ...task, alertOpen: true, lastFailureAt: failureStartedAt } as never)).resolves.toMatchObject({ status: "up", notification: "recovery" });
    expect(sendMonitorAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "recovery", outageDuration: "1分5秒" }));
  });

  it("连续提醒模式在间隔到期后再次发送告警", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "http_error", responseTimeMs: 89, httpStatus: 503, errorMessage: "HTTP 503", expectedContentMatched: null });
    vi.mocked(statusFromCheck).mockReturnValue("down");
    const staleAlertAt = new Date(Date.now() - 31 * 60_000);
    const failureStartedAt = new Date(Date.now() - 2 * 60 * 60_000);
    await expect(runMonitorTask({ ...task, alertOpen: true, alertMode: "repeat", repeatAlertMinutes: 30, lastAlertAt: staleAlertAt, lastFailureAt: failureStartedAt } as never)).resolves.toMatchObject({ notification: "alert" });
    expect(sendMonitorAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "alert" }));
    expect(db.recordMonitorCheck).toHaveBeenCalledWith(7, expect.anything(), expect.objectContaining({ lastFailureAt: failureStartedAt }));
  });

  it("连续提醒模式在间隔未到时保持静默", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "http_error", responseTimeMs: 89, httpStatus: 503, errorMessage: "HTTP 503", expectedContentMatched: null });
    vi.mocked(statusFromCheck).mockReturnValue("down");
    await expect(runMonitorTask({ ...task, alertOpen: true, alertMode: "repeat", repeatAlertMinutes: 30, lastAlertAt: new Date() } as never)).resolves.toMatchObject({ notification: "none" });
    expect(sendMonitorAlert).not.toHaveBeenCalled();
  });

  it("以易读格式展示故障持续时长", () => {
    expect(formatOutageDuration(0)).toBe("0秒");
    expect(formatOutageDuration(3_723_000)).toBe("1小时2分3秒");
    expect(formatOutageDuration(90_061_000)).toBe("1天1小时1分1秒");
  });

  it("批量即时检查会去重任务并保留每个任务的结果", async () => {
    vi.mocked(checkUrl).mockResolvedValue({ status: "success", responseTimeMs: 32, httpStatus: 200, errorMessage: null, expectedContentMatched: null, resolvedAddresses: [] });
    vi.mocked(statusFromCheck).mockReturnValue("up");
    const results = await runMonitorTasks([task as never, { ...task, id: 8, name: "第二个目标" } as never, task as never]);

    expect(results).toHaveLength(2);
    expect(results.map(result => result.taskId)).toEqual([7, 8]);
    expect(checkUrl).toHaveBeenCalledTimes(2);
  });

  it("高频调度请求重叠时只执行一轮到期检查", async () => {
    let resolveCheck: ((value: Awaited<ReturnType<typeof checkUrl>>) => void) | undefined;
    vi.mocked(db.listDueMonitorTasks).mockResolvedValue([task] as never);
    vi.mocked(checkUrl).mockImplementation(() => new Promise(resolve => { resolveCheck = resolve; }) as never);
    vi.mocked(statusFromCheck).mockReturnValue("up");

    const first = runDueMonitorTasks();
    const second = runDueMonitorTasks();
    expect(db.listDueMonitorTasks).toHaveBeenCalledOnce();
    await expect(second).resolves.toEqual([]);

    resolveCheck?.({ status: "success", responseTimeMs: 21, httpStatus: 200, errorMessage: null, expectedContentMatched: null, resolvedAddresses: [] });
    await expect(first).resolves.toHaveLength(1);
    expect(checkUrl).toHaveBeenCalledOnce();
  });
});
