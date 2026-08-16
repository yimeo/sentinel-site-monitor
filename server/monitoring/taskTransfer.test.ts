import { describe, expect, it } from "vitest";
import { createMonitorTaskBackup, monitorTaskBackupSchema } from "./taskTransfer";

const task = { name: "官网首页", url: "https://example.com/", expectedContent: "在线", forbiddenContent: "维护中", intervalMinutes: 5, alertMode: "once" as const, repeatAlertMinutes: 30, enabled: true };

describe("monitor task transfer", () => {
  it("creates a versioned task-only backup", () => {
    const backup = createMonitorTaskBackup([task]);
    expect(backup).toMatchObject({ format: "sentinel-monitor-tasks", version: 1, tasks: [task] });
    expect(monitorTaskBackupSchema.safeParse(backup).success).toBe(true);
  });

  it("rejects unknown formats, empty backups and oversized imports", () => {
    expect(monitorTaskBackupSchema.safeParse({ format: "other", version: 1, exportedAt: new Date().toISOString(), tasks: [task] }).success).toBe(false);
    expect(monitorTaskBackupSchema.safeParse({ format: "sentinel-monitor-tasks", version: 1, exportedAt: new Date().toISOString(), tasks: [] }).success).toBe(false);
    expect(monitorTaskBackupSchema.safeParse({ format: "sentinel-monitor-tasks", version: 1, exportedAt: new Date().toISOString(), tasks: Array.from({ length: 501 }, () => task) }).success).toBe(false);
  });
});
