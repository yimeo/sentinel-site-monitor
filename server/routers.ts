import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME, LOCAL_SESSION_COOKIE } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createSchedulerToken, encryptSecret, hashPassword, hashToken, verifyPassword } from "./monitoring/crypto";
import { validateMonitorUrl } from "./monitoring/engine";
import { parseRecipients, sendTestEmail, verifySmtp } from "./monitoring/mail";
import { runMonitorTask, runMonitorTasks } from "./monitoring/service";
import { accessSettingsInput, customTlsInput, localAdminPasswordInput, localAdminUsernameInput, mailTemplatesInput } from "./monitoring/settingsValidation";
import { createMonitorTaskBackup, monitorTaskBackupSchema, monitorTaskTransferSchema } from "./monitoring/taskTransfer";

const taskInput = monitorTaskTransferSchema;
const localSessionMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const localCredentialsInput = z.object({
  username: localAdminUsernameInput.shape.username,
  password: z.string().min(1, "请输入管理员密码。").max(256),
});
const localSetupInput = z.object({
  username: localAdminUsernameInput.shape.username,
  password: z.string().min(12, "管理员密码至少需要 12 个字符。").max(256),
  confirmation: z.string(),
}).refine(input => input.password === input.confirmation, { message: "两次输入的管理员密码不一致。", path: ["confirmation"] });

const smtpInput = z.object({
  host: z.string().trim().min(1, "请输入 SMTP 主机。").max(320),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().max(320).optional().nullable(),
  password: z.string().max(2_000).optional(),
  fromEmail: z.string().trim().email("请输入有效的发件人邮箱。").max(320),
  recipients: z.string().trim().min(1, "请至少填写一个收件人。").max(10_000),
});

function validatedRecipients(value: string): string[] {
  const recipients = parseRecipients(value);
  if (recipients.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "请至少填写一个收件人。" });
  const emailValidator = z.string().email();
  recipients.forEach(recipient => {
    if (!emailValidator.safeParse(recipient).success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `收件人邮箱无效：${recipient}` });
    }
  });
  return recipients;
}

function taskOrNotFound(task: Awaited<ReturnType<typeof db.getMonitorTask>>) {
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "未找到该监控任务。" });
  return task;
}

function assertLocalDeployment() {
  if (process.env.LOCAL_DEPLOYMENT !== "true") {
    throw new TRPCError({ code: "FORBIDDEN", message: "该认证方式仅适用于本地部署。" });
  }
}

async function startLocalSession(ctx: { req: Parameters<typeof getSessionCookieOptions>[0]; res: { cookie: Function } }, userId: number) {
  const token = await db.createLocalSession(userId, localSessionMaxAgeMs);
  ctx.res.cookie(LOCAL_SESSION_COOKIE, token, { ...getSessionCookieOptions(ctx.req), maxAge: localSessionMaxAgeMs });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    setupRequired: publicProcedure.query(async () => ({
      localDeployment: process.env.LOCAL_DEPLOYMENT === "true",
      required: process.env.LOCAL_DEPLOYMENT === "true" && await db.localAdminSetupRequired(),
    })),
    initializeLocalAdmin: publicProcedure.input(localSetupInput).mutation(async ({ ctx, input }) => {
      assertLocalDeployment();
      if (!(await db.localAdminSetupRequired())) {
        throw new TRPCError({ code: "CONFLICT", message: "管理员账户已完成初始化，请直接登录。" });
      }
      const user = await db.initializeLocalAdmin(input.username, await hashPassword(input.password));
      await startLocalSession(ctx, user.id);
      return user;
    }),
    localLogin: publicProcedure.input(localCredentialsInput).mutation(async ({ ctx, input }) => {
      assertLocalDeployment();
      const settings = await db.getSiteSettings();
      if (!settings.adminPasswordHash) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先完成管理员初始化。" });
      }
      if (settings.adminUsername !== input.username || !(await verifyPassword(input.password, settings.adminPasswordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码不正确。" });
      }
      const user = await db.getOrCreateLocalAdmin();
      await startLocalSession(ctx, user.id);
      return user;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      await db.deleteLocalSession(ctx.req.cookies?.[LOCAL_SESSION_COOKIE]);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const tasks = await db.listMonitorTasks(ctx.user.id);
    const recentChecks = await db.getChecksForTasks(tasks.map(task => task.id));
    const smtpConfigured = Boolean(await db.getSmtpSettings(ctx.user.id));
    const schedulerConfigured = await db.schedulerTokenConfigured(ctx.user.id);
    return { tasks, recentChecks, smtpConfigured, schedulerConfigured };
  }),

  monitor: router({
    list: protectedProcedure.query(({ ctx }) => db.listMonitorTasks(ctx.user.id)),
    exportConfig: protectedProcedure.mutation(async ({ ctx }) => {
      const tasks = await db.listMonitorTasks(ctx.user.id);
      return createMonitorTaskBackup(tasks.map(task => ({ name: task.name, url: task.url, expectedContent: task.expectedContent, forbiddenContent: task.forbiddenContent, intervalMinutes: task.intervalMinutes, alertMode: task.alertMode, repeatAlertMinutes: task.repeatAlertMinutes, enabled: task.enabled })));
    }),
    importConfig: protectedProcedure.input(monitorTaskBackupSchema).mutation(async ({ ctx, input }) => {
      const normalizedTasks = input.tasks.map(task => {
        let url: string;
        try { url = validateMonitorUrl(task.url); } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "导入文件包含无效 URL。" });
        }
        return { ...task, url, expectedContent: task.expectedContent?.trim() || null, forbiddenContent: task.forbiddenContent?.trim() || null };
      });
      return db.importMonitorTasks(ctx.user.id, normalizedTasks);
    }),
    create: protectedProcedure.input(taskInput).mutation(async ({ ctx, input }) => {
      let url: string;
      try {
        url = validateMonitorUrl(input.url);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "URL 无效。" });
      }
      return db.createMonitorTask({
        ownerId: ctx.user.id,
        name: input.name,
        url,
        expectedContent: input.expectedContent?.trim() || null,
        forbiddenContent: input.forbiddenContent?.trim() || null,
        intervalMinutes: input.intervalMinutes,
        alertMode: input.alertMode,
        repeatAlertMinutes: input.repeatAlertMinutes,
        enabled: input.enabled,
      });
    }),
    update: protectedProcedure.input(z.object({ id: z.number().int().positive(), data: taskInput })).mutation(async ({ ctx, input }) => {
      taskOrNotFound(await db.getMonitorTask(ctx.user.id, input.id));
      let url: string;
      try {
        url = validateMonitorUrl(input.data.url);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "URL 无效。" });
      }
      return db.updateMonitorTask(ctx.user.id, input.id, {
        name: input.data.name,
        url,
        expectedContent: input.data.expectedContent?.trim() || null,
        forbiddenContent: input.data.forbiddenContent?.trim() || null,
        intervalMinutes: input.data.intervalMinutes,
        alertMode: input.data.alertMode,
        repeatAlertMinutes: input.data.repeatAlertMinutes,
        enabled: input.data.enabled,
      });
    }),
    remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      taskOrNotFound(await db.getMonitorTask(ctx.user.id, input.id));
      await db.deleteMonitorTask(ctx.user.id, input.id);
      return { success: true };
    }),
    removeBulk: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const deleted = await db.deleteMonitorTasks(ctx.user.id, input.ids);
      return { deleted };
    }),
    setEnabled: protectedProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      taskOrNotFound(await db.getMonitorTask(ctx.user.id, input.id));
      return db.updateMonitorTask(ctx.user.id, input.id, { enabled: input.enabled });
    }),
    setEnabledBulk: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const updated = await db.setMonitorTasksEnabled(ctx.user.id, input.ids, input.enabled);
      return { updated, enabled: input.enabled };
    }),
    redistributeSchedule: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const rescheduled = await db.redistributeMonitorTaskSchedule(ctx.user.id, input.ids);
      return { rescheduled };
    }),
    runNow: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const task = taskOrNotFound(await db.getMonitorTask(ctx.user.id, input.id));
      return runMonitorTask(task);
    }),
    runSelectedNow: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) })).mutation(async ({ ctx, input }) => {
      const ids = Array.from(new Set(input.ids));
      const tasks = (await Promise.all(ids.map(id => db.getMonitorTask(ctx.user.id, id)))).filter((task): task is NonNullable<typeof task> => Boolean(task));
      const results = await runMonitorTasks(tasks);
      return { checked: results.length, results };
    }),
    history: protectedProcedure.input(z.object({ taskId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) })).query(({ ctx, input }) =>
      db.listMonitorChecks(ctx.user.id, input.taskId, input.limit)
    ),
  }),

  settings: router({
    smtp: protectedProcedure.query(async ({ ctx }) => {
      const settings = await db.getSmtpSettings(ctx.user.id);
      if (!settings) return null;
      return {
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        username: settings.username,
        fromEmail: settings.fromEmail,
        recipients: settings.recipients,
        passwordConfigured: Boolean(settings.passwordEncrypted),
        updatedAt: settings.updatedAt,
      };
    }),
    saveSmtp: protectedProcedure.input(smtpInput).mutation(async ({ ctx, input }) => {
      const recipients = validatedRecipients(input.recipients);
      const existing = await db.getSmtpSettings(ctx.user.id);
      if (existing?.passwordEncrypted && input.password === "") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "如需清除已保存的密码，请先保存无需认证的配置。" });
      }
      if (input.username && !input.password && !existing?.passwordEncrypted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已填写用户名，请同时输入 SMTP 密码。" });
      }
      const values = {
        ownerId: ctx.user.id,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username || null,
        passwordEncrypted: input.password ? encryptSecret(input.password) : input.username ? existing?.passwordEncrypted ?? null : null,
        fromEmail: input.fromEmail,
        recipients: recipients.join(", "),
      };
      return db.upsertSmtpSettings(values);
    }),
    testSmtp: protectedProcedure.mutation(async ({ ctx }) => {
      const settings = await db.getSmtpSettings(ctx.user.id);
      if (!settings) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先保存 SMTP 配置。" });
      await verifySmtp(settings);
      await sendTestEmail(settings);
      return { success: true };
    }),
    site: protectedProcedure.query(async () => {
      const settings = await db.getSiteSettings();
      return {
        alertSubject: settings.alertSubject,
        repeatAlertSubject: settings.repeatAlertSubject,
        alertBody: settings.alertBody,
        recoverySubject: settings.recoverySubject,
        recoveryBody: settings.recoveryBody,
        publicUrl: settings.publicUrl,
        requestedPort: settings.requestedPort,
        adminUsername: settings.adminUsername,
        localPasswordConfigured: Boolean(settings.adminPasswordHash),
        passwordChangeRequestedAt: settings.passwordChangeRequestedAt,
        updatedAt: settings.updatedAt,
      };
    }),
    saveMailTemplates: protectedProcedure.input(mailTemplatesInput).mutation(({ input }) => db.updateSiteSettings(input)),
    saveAccessSettings: protectedProcedure.input(accessSettingsInput).mutation(async ({ input }) => db.requestAccessSettingsChange({ publicUrl: input.publicUrl, requestedPort: input.requestedPort })),
    saveCustomTls: protectedProcedure.input(customTlsInput).mutation(async ({ ctx, input }) => {
      if (process.env.LOCAL_DEPLOYMENT === "true" && ctx.req.headers["x-forwarded-proto"] !== "https" && !input.allowInsecureTransport) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前通过 HTTP 访问。请在页面勾选风险确认后再提交证书和私钥，或先使用 HTTPS。" });
      }
      return db.requestCustomTlsSettings(input);
    }),
    changeLocalPassword: protectedProcedure.input(localAdminPasswordInput).mutation(async ({ input }) => {
      const passwordHash = await hashPassword(input.password);
      await db.updateSiteSettings({ adminPasswordHash: passwordHash, passwordChangeRequestedAt: new Date() });
      return { success: true };
    }),
    changeLocalUsername: protectedProcedure.input(localAdminUsernameInput).mutation(({ input }) => db.updateSiteSettings({ adminUsername: input.username })),
  }),

  scheduler: router({
    status: protectedProcedure.query(async ({ ctx }) => ({ configured: await db.schedulerTokenConfigured(ctx.user.id) })),
    rotateToken: protectedProcedure.mutation(async ({ ctx }) => {
      const token = createSchedulerToken();
      await db.saveSchedulerTokenHash(ctx.user.id, hashToken(token));
      return { token };
    }),
  }),
});

export type AppRouter = typeof appRouter;
