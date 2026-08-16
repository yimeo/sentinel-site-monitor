import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const databaseFiles: string[] = [];
const originalDatabasePath = process.env.SQLITE_DB_PATH;

afterEach(async () => {
  vi.useRealTimers();
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.SQLITE_DB_PATH;
  else process.env.SQLITE_DB_PATH = originalDatabasePath;
  await Promise.all(databaseFiles.splice(0).map(file => fs.rm(file, { force: true })));
});

describe("SQLite DNS 解析地址历史", () => {
  it("将解析地址写入并以字符串数组形式返回", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-dns-history-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    vi.resetModules();
    const db = await import("./db");
    const task = await db.createMonitorTask({
      ownerId: 9,
      name: "DNS 历史测试",
      url: "https://example.com/",
      intervalMinutes: 5,
      enabled: true,
      alertMode: "once",
      repeatAlertMinutes: 30,
    });

    await db.recordMonitorCheck(task!.id, {
      status: "success",
      responseTimeMs: 21,
      httpStatus: 200,
      errorMessage: null,
      expectedContentMatched: null,
      resolvedAddresses: ["203.0.113.10", "2001:db8::10", "203.0.113.10"],
    }, { status: "up", lastCheckedAt: new Date() });

    const records = await db.listMonitorChecks(9, task!.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.resolvedAddresses).toEqual(["203.0.113.10", "2001:db8::10"]);
  });

  it("仅批量更新当前管理员拥有的任务并去重任务编号", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-bulk-enabled-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    vi.resetModules();
    const db = await import("./db");
    const first = await db.createMonitorTask({ ownerId: 9, name: "任务一", url: "https://one.example/", intervalMinutes: 5, enabled: false, alertMode: "once", repeatAlertMinutes: 30 });
    const second = await db.createMonitorTask({ ownerId: 9, name: "任务二", url: "https://two.example/", intervalMinutes: 5, enabled: false, alertMode: "once", repeatAlertMinutes: 30 });
    const foreign = await db.createMonitorTask({ ownerId: 10, name: "其他管理员任务", url: "https://other.example/", intervalMinutes: 5, enabled: false, alertMode: "once", repeatAlertMinutes: 30 });

    const updated = await db.setMonitorTasksEnabled(9, [first!.id, first!.id, second!.id, foreign!.id], true);
    expect(updated).toBe(2);
    expect((await db.getMonitorTask(9, first!.id))?.enabled).toBe(true);
    expect((await db.getMonitorTask(9, second!.id))?.enabled).toBe(true);
    expect((await db.getMonitorTask(10, foreign!.id))?.enabled).toBe(false);
  });

  it("仅批量删除当前管理员拥有的任务及其历史", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-bulk-delete-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    vi.resetModules();
    const db = await import("./db");
    const owned = await db.createMonitorTask({ ownerId: 9, name: "待删除任务", url: "https://delete.example/", intervalMinutes: 5, enabled: true, alertMode: "once", repeatAlertMinutes: 30 });
    const foreign = await db.createMonitorTask({ ownerId: 10, name: "保留任务", url: "https://keep.example/", intervalMinutes: 5, enabled: true, alertMode: "once", repeatAlertMinutes: 30 });
    await db.recordMonitorCheck(owned!.id, { status: "success", responseTimeMs: 10, httpStatus: 200, errorMessage: null, expectedContentMatched: null, resolvedAddresses: [] }, { status: "up", lastCheckedAt: new Date() });

    expect(await db.deleteMonitorTasks(9, [owned!.id, owned!.id, foreign!.id])).toBe(1);
    expect(await db.getMonitorTask(9, owned!.id)).toBeUndefined();
    expect(await db.listMonitorChecks(9, owned!.id)).toEqual([]);
    expect((await db.getMonitorTask(10, foreign!.id))?.name).toBe("保留任务");
  });

  it("首次初始化管理员后仅可通过本地会话读取管理员身份", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-local-session-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    vi.resetModules();
    const db = await import("./db");

    expect(await db.localAdminSetupRequired()).toBe(true);
    const admin = await db.initializeLocalAdmin("admin", "test-password-hash");
    expect(await db.localAdminSetupRequired()).toBe(false);
    expect((await db.getSiteSettings()).adminUsername).toBe("admin");

    const token = await db.createLocalSession(admin.id, 60_000);
    expect((await db.getLocalSessionUser(token))?.openId).toBe("local-admin");
    await db.deleteLocalSession(token);
    expect(await db.getLocalSessionUser(token)).toBeUndefined();
  });

  it("导入任务会按频率窗口错峰，到期检查和手动重排均隔离其他管理员任务", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T20:54:30.000Z"));
    const databaseFile = path.join(os.tmpdir(), `sentinel-stagger-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    vi.resetModules();
    const db = await import("./db");
    const imported = await db.importMonitorTasks(9, Array.from({ length: 5 }, (_, index) => ({
      name: `错峰任务 ${index + 1}`,
      url: `https://stagger-${index + 1}.example/`,
      expectedContent: null,
      forbiddenContent: null,
      intervalMinutes: 5,
      alertMode: "once" as const,
      repeatAlertMinutes: 30,
      enabled: true,
    })));
    expect(imported.imported).toBe(5);
    const tasks = await db.listMonitorTasks(9);
    expect(new Set(tasks.map(task => task.nextCheckAt?.getTime())).size).toBe(5);
    expect(await db.listDueMonitorTasks()).toHaveLength(0);

    vi.setSystemTime(new Date("2026-08-16T20:57:00.000Z"));
    expect(await db.listDueMonitorTasks()).toHaveLength(3);

    const foreign = await db.createMonitorTask({ ownerId: 10, name: "其他管理员", url: "https://foreign.example/", intervalMinutes: 5, enabled: true, alertMode: "once", repeatAlertMinutes: 30 });
    const foreignBefore = (await db.getMonitorTask(10, foreign!.id))!.nextCheckAt;
    expect(await db.redistributeMonitorTaskSchedule(9, [...tasks.map(task => task.id), foreign!.id])).toBe(5);
    expect((await db.getMonitorTask(10, foreign!.id))!.nextCheckAt).toEqual(foreignBefore);
  });
});
