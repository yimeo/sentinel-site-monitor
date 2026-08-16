import { z } from "zod";

export const monitorTaskTransferSchema = z.object({
  name: z.string().trim().min(1, "请输入任务名称。").max(160),
  url: z.string().trim().min(1, "请输入 URL。"),
  expectedContent: z.string().trim().max(20_000).nullable(),
  forbiddenContent: z.string().trim().max(20_000).nullable(),
  intervalMinutes: z.number().int().min(1, "检查间隔至少为 1 分钟。").max(43_200, "检查间隔不能超过 30 天。"),
  alertMode: z.enum(["once", "repeat"]),
  repeatAlertMinutes: z.number().int().min(1, "连续提醒间隔至少为 1 分钟。").max(43_200, "连续提醒间隔不能超过 30 天。"),
  enabled: z.boolean(),
});

export const monitorTaskBackupSchema = z.object({
  format: z.literal("sentinel-monitor-tasks"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  tasks: z.array(monitorTaskTransferSchema).min(1, "备份文件中没有监控任务。").max(500, "一次最多导入 500 个监控任务。"),
});

export type MonitorTaskTransfer = z.infer<typeof monitorTaskTransferSchema>;

export function createMonitorTaskBackup(tasks: MonitorTaskTransfer[]) {
  return { format: "sentinel-monitor-tasks" as const, version: 1 as const, exportedAt: new Date().toISOString(), tasks };
}
