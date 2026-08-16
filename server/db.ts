import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type { InsertUser, MonitorCheck, MonitorTask, SchedulerSettings, SmtpSettings, User } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { formatAccessPortRequest } from "./monitoring/access";
import { formatAdminUsernameRequest } from "./monitoring/adminAuth";
import type { MonitorTaskTransfer } from "./monitoring/taskTransfer";

export type MailTemplates = {
  alertSubject: string;
  alertBody: string;
  recoverySubject: string;
  recoveryBody: string;
};

export const defaultMailTemplates: MailTemplates = {
  alertSubject: "[Sentinel] 故障告警：{{taskName}}",
  alertBody: "监控目标需要关注。\n\n任务：{{taskName}}\nURL：{{url}}\n状态：{{status}}\nHTTP 状态码：{{httpStatus}}\n响应时长：{{responseTimeMs}}\n错误详情：{{errorMessage}}\n检测时间：{{checkedAt}}",
  recoverySubject: "[Sentinel] 恢复通知：{{taskName}}",
  recoveryBody: "监控目标已恢复正常。\n\n任务：{{taskName}}\nURL：{{url}}\n状态：{{status}}\nHTTP 状态码：{{httpStatus}}\n响应时长：{{responseTimeMs}}\n故障持续时长：{{outageDuration}}\n检测时间：{{checkedAt}}",
};

const legacyRecoveryBody = "监控目标已恢复正常。\n\n任务：{{taskName}}\nURL：{{url}}\n状态：{{status}}\nHTTP 状态码：{{httpStatus}}\n响应时长：{{responseTimeMs}}\n检测时间：{{checkedAt}}";

export type SiteSettings = MailTemplates & {
  publicUrl: string | null;
  requestedPort: number | null;
  adminUsername: string;
  adminPasswordHash: string | null;
  passwordChangeRequestedAt: Date | null;
  updatedAt: Date;
};

type Row = Record<string, SqlValue | null>;
export type MonitorCheckHistory = Omit<MonitorCheck, "resolvedAddresses"> & { resolvedAddresses: string[] };

let databasePromise: Promise<Database> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

const databasePath = () => process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "site-monitor.sqlite");
const now = () => new Date().toISOString();
const toSqlValue = (value: unknown): SqlValue | null => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as SqlValue;
};

async function getSqlite(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const file = databasePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const SQL = await initSqlJs({ locateFile: wasm => path.join(process.cwd(), "node_modules", "sql.js", "dist", wasm) });
      let bytes: Uint8Array | undefined;
      try { bytes = new Uint8Array(await fs.readFile(file)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT, openId TEXT NOT NULL UNIQUE, name TEXT, email TEXT,
          loginMethod TEXT, role TEXT NOT NULL DEFAULT 'user', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastSignedIn TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS monitor_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ownerId INTEGER NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
          expectedContent TEXT, forbiddenContent TEXT, intervalMinutes INTEGER NOT NULL DEFAULT 5,
          alertMode TEXT NOT NULL DEFAULT 'once', repeatAlertMinutes INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'unknown', lastCheckedAt TEXT, lastResponseTimeMs INTEGER, lastHttpStatus INTEGER,
          lastError TEXT, alertOpen INTEGER NOT NULL DEFAULT 0, lastAlertAt TEXT, lastFailureAt TEXT, lastRecoveredAt TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS monitor_tasks_owner_idx ON monitor_tasks(ownerId);
        CREATE INDEX IF NOT EXISTS monitor_tasks_due_idx ON monitor_tasks(enabled, lastCheckedAt);
        CREATE TABLE IF NOT EXISTS monitor_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER NOT NULL, status TEXT NOT NULL, checkedAt TEXT NOT NULL,
          responseTimeMs INTEGER, httpStatus INTEGER, errorMessage TEXT, expectedContentMatched INTEGER, resolvedAddresses TEXT
        );
        CREATE INDEX IF NOT EXISTS monitor_checks_task_checked_idx ON monitor_checks(taskId, checkedAt DESC);
        CREATE TABLE IF NOT EXISTS smtp_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ownerId INTEGER NOT NULL UNIQUE, host TEXT NOT NULL, port INTEGER NOT NULL,
          secure INTEGER NOT NULL DEFAULT 0, username TEXT, passwordEncrypted TEXT, fromEmail TEXT NOT NULL, recipients TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scheduler_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ownerId INTEGER NOT NULL UNIQUE, cronTokenHash TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_sessions (
          tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS local_sessions_expiry_idx ON local_sessions(expiresAt);
        CREATE TABLE IF NOT EXISTS site_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1), alertSubject TEXT NOT NULL, alertBody TEXT NOT NULL,
          recoverySubject TEXT NOT NULL, recoveryBody TEXT NOT NULL, publicUrl TEXT, requestedPort INTEGER,
          adminUsername TEXT NOT NULL DEFAULT 'sentinel-admin', adminPasswordHash TEXT, passwordChangeRequestedAt TEXT, updatedAt TEXT NOT NULL
        );
      `);
      const siteSettingsColumns = selectRows<Row>(db, "PRAGMA table_info(site_settings)");
      if (!siteSettingsColumns.some(column => String(column.name) === "adminUsername")) {
        db.exec("ALTER TABLE site_settings ADD COLUMN adminUsername TEXT NOT NULL DEFAULT 'sentinel-admin'");
      }
      const monitorCheckColumns = selectRows<Row>(db, "PRAGMA table_info(monitor_checks)");
      if (!monitorCheckColumns.some(column => String(column.name) === "resolvedAddresses")) {
        db.exec("ALTER TABLE monitor_checks ADD COLUMN resolvedAddresses TEXT");
      }
      if (!bytes) await persist(db);
      return db;
    })();
  }
  return databasePromise;
}

async function persist(db: Database) {
  await fs.writeFile(databasePath(), db.export());
}

function selectRows<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql, params);
  const rows: T[] = [];
  while (statement.step()) rows.push(statement.getAsObject() as T);
  statement.free();
  return rows;
}

async function read<T>(callback: (db: Database) => T | Promise<T>): Promise<T> {
  return callback(await getSqlite());
}

async function write<T>(callback: (db: Database) => T | Promise<T>): Promise<T> {
  const action = writeQueue.then(async () => {
    const db = await getSqlite();
    const result = await callback(db);
    await persist(db);
    return result;
  });
  writeQueue = action.catch(() => undefined);
  return action;
}

const parseDate = (value: unknown) => value ? new Date(String(value)) : null;
const parseBoolean = (value: unknown) => Boolean(Number(value));
const parseResolvedAddresses = (value: unknown): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
};

function mapUser(row: Row): User {
  return { id: Number(row.id), openId: String(row.openId), name: row.name ? String(row.name) : null, email: row.email ? String(row.email) : null, loginMethod: row.loginMethod ? String(row.loginMethod) : null, role: (row.role === "admin" ? "admin" : "user"), createdAt: parseDate(row.createdAt)!, updatedAt: parseDate(row.updatedAt)!, lastSignedIn: parseDate(row.lastSignedIn)! };
}

function mapTask(row: Row): MonitorTask {
  return {
    id: Number(row.id), ownerId: Number(row.ownerId), name: String(row.name), url: String(row.url), expectedContent: row.expectedContent ? String(row.expectedContent) : null,
    forbiddenContent: row.forbiddenContent ? String(row.forbiddenContent) : null, intervalMinutes: Number(row.intervalMinutes), alertMode: row.alertMode === "repeat" ? "repeat" : "once", repeatAlertMinutes: Number(row.repeatAlertMinutes), enabled: parseBoolean(row.enabled),
    status: (["up", "down", "content_mismatch"].includes(String(row.status)) ? row.status : "unknown") as MonitorTask["status"], lastCheckedAt: parseDate(row.lastCheckedAt), lastResponseTimeMs: row.lastResponseTimeMs === null ? null : Number(row.lastResponseTimeMs), lastHttpStatus: row.lastHttpStatus === null ? null : Number(row.lastHttpStatus), lastError: row.lastError ? String(row.lastError) : null,
    alertOpen: parseBoolean(row.alertOpen), lastAlertAt: parseDate(row.lastAlertAt), lastFailureAt: parseDate(row.lastFailureAt), lastRecoveredAt: parseDate(row.lastRecoveredAt), createdAt: parseDate(row.createdAt)!, updatedAt: parseDate(row.updatedAt)!,
  };
}

function mapCheck(row: Row): MonitorCheckHistory {
  return { id: Number(row.id), taskId: Number(row.taskId), status: String(row.status) as MonitorCheck["status"], checkedAt: parseDate(row.checkedAt)!, responseTimeMs: row.responseTimeMs === null ? null : Number(row.responseTimeMs), httpStatus: row.httpStatus === null ? null : Number(row.httpStatus), errorMessage: row.errorMessage ? String(row.errorMessage) : null, expectedContentMatched: row.expectedContentMatched === null ? null : parseBoolean(row.expectedContentMatched), resolvedAddresses: parseResolvedAddresses(row.resolvedAddresses) };
}

function mapSmtp(row: Row): SmtpSettings {
  return { id: Number(row.id), ownerId: Number(row.ownerId), host: String(row.host), port: Number(row.port), secure: parseBoolean(row.secure), username: row.username ? String(row.username) : null, passwordEncrypted: row.passwordEncrypted ? String(row.passwordEncrypted) : null, fromEmail: String(row.fromEmail), recipients: String(row.recipients), updatedAt: parseDate(row.updatedAt)! };
}

function mapSiteSettings(row: Row): SiteSettings {
  return {
    alertSubject: String(row.alertSubject), alertBody: String(row.alertBody), recoverySubject: String(row.recoverySubject), recoveryBody: String(row.recoveryBody),
    publicUrl: row.publicUrl ? String(row.publicUrl) : null, requestedPort: row.requestedPort === null ? null : Number(row.requestedPort), adminUsername: row.adminUsername ? String(row.adminUsername) : "sentinel-admin",
    adminPasswordHash: row.adminPasswordHash ? String(row.adminPasswordHash) : null, passwordChangeRequestedAt: parseDate(row.passwordChangeRequestedAt), updatedAt: parseDate(row.updatedAt)!,
  };
}

export async function getDb() { return getSqlite(); }

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  await write(db => {
    const timestamp = now();
    const role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
    db.run(`INSERT INTO users (openId,name,email,loginMethod,role,createdAt,updatedAt,lastSignedIn) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(openId) DO UPDATE SET name=excluded.name,email=excluded.email,loginMethod=excluded.loginMethod,role=excluded.role,updatedAt=excluded.updatedAt,lastSignedIn=excluded.lastSignedIn`,
      [user.openId, toSqlValue(user.name), toSqlValue(user.email), toSqlValue(user.loginMethod), role, timestamp, timestamp, toSqlValue(user.lastSignedIn) ?? timestamp]);
  });
}

export async function getUserByOpenId(openId: string) {
  return read(db => {
    const row = selectRows<Row>(db, "SELECT * FROM users WHERE openId = ? LIMIT 1", [openId])[0];
    return row ? mapUser(row) : undefined;
  });
}

export async function getOrCreateLocalAdmin() {
  const existing = await getUserByOpenId("local-admin");
  if (existing) return existing;
  await upsertUser({ openId: "local-admin", name: "本地管理员", email: null, loginMethod: "local", role: "admin", lastSignedIn: new Date() });
  const user = await getUserByOpenId("local-admin");
  if (!user) throw new Error("无法初始化本地管理员账户。");
  return user;
}

export async function localAdminSetupRequired() {
  return !(await getSiteSettings()).adminPasswordHash;
}

export async function initializeLocalAdmin(username: string, passwordHash: string) {
  const settings = await getSiteSettings();
  if (settings.adminPasswordHash) throw new Error("管理员账户已完成初始化。");
  const user = await getOrCreateLocalAdmin();
  await updateSiteSettings({ adminUsername: username, adminPasswordHash: passwordHash, passwordChangeRequestedAt: new Date() });
  await write(db => db.run("UPDATE users SET name = ?, updatedAt = ?, lastSignedIn = ? WHERE id = ?", [username, now(), now(), user.id]));
  return (await getUserByOpenId("local-admin"))!;
}

export async function createLocalSession(userId: number, maxAgeMs: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
  await write(db => {
    db.run("DELETE FROM local_sessions WHERE expiresAt <= ?", [createdAt]);
    db.run("INSERT INTO local_sessions (tokenHash,userId,expiresAt,createdAt) VALUES (?,?,?,?)", [tokenHash, userId, expiresAt, createdAt]);
  });
  return token;
}

export async function getLocalSessionUser(token: string | undefined) {
  if (!token) return undefined;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return read(db => {
    const row = selectRows<Row>(db, `SELECT users.* FROM local_sessions INNER JOIN users ON users.id = local_sessions.userId
      WHERE local_sessions.tokenHash = ? AND local_sessions.expiresAt > ? LIMIT 1`, [tokenHash, now()])[0];
    return row ? mapUser(row) : undefined;
  });
}

export async function deleteLocalSession(token: string | undefined) {
  if (!token) return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await write(db => db.run("DELETE FROM local_sessions WHERE tokenHash = ?", [tokenHash]));
}

export async function listMonitorTasks(ownerId: number) {
  return read(db => selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? ORDER BY updatedAt DESC", [ownerId]).map(mapTask));
}

export async function getMonitorTask(ownerId: number, id: number) {
  return read(db => {
    const row = selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? AND id = ? LIMIT 1", [ownerId, id])[0];
    return row ? mapTask(row) : undefined;
  });
}

export async function getMonitorTaskById(id: number) {
  return read(db => {
    const row = selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE id = ? LIMIT 1", [id])[0];
    return row ? mapTask(row) : undefined;
  });
}

export async function createMonitorTask(input: typeof import("../drizzle/schema").monitorTasks.$inferInsert) {
  return write(db => {
    const timestamp = now();
    db.run(`INSERT INTO monitor_tasks (ownerId,name,url,expectedContent,forbiddenContent,intervalMinutes,alertMode,repeatAlertMinutes,enabled,status,alertOpen,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,'unknown',0,?,?)`,
      [input.ownerId!, input.name!, input.url!, toSqlValue(input.expectedContent), toSqlValue(input.forbiddenContent), input.intervalMinutes ?? 5, input.alertMode ?? "once", input.repeatAlertMinutes ?? 30, toSqlValue(input.enabled ?? true), timestamp, timestamp]);
    const row = selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE id = last_insert_rowid() LIMIT 1")[0];
    return row ? mapTask(row) : undefined;
  });
}

export async function importMonitorTasks(ownerId: number, tasks: MonitorTaskTransfer[]) {
  return write(db => {
    const existing = new Set(selectRows<{ name: string; url: string }>(db, "SELECT name, url FROM monitor_tasks WHERE ownerId = ?", [ownerId]).map(task => `${task.name}\u0000${task.url}`));
    const timestamp = now();
    let imported = 0;
    let skipped = 0;
    for (const task of tasks) {
      const key = `${task.name}\u0000${task.url}`;
      if (existing.has(key)) { skipped += 1; continue; }
      db.run(`INSERT INTO monitor_tasks (ownerId,name,url,expectedContent,forbiddenContent,intervalMinutes,alertMode,repeatAlertMinutes,enabled,status,alertOpen,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,'unknown',0,?,?)`,
        [ownerId, task.name, task.url, toSqlValue(task.expectedContent), toSqlValue(task.forbiddenContent), task.intervalMinutes, task.alertMode, task.repeatAlertMinutes, toSqlValue(task.enabled), timestamp, timestamp]);
      existing.add(key);
      imported += 1;
    }
    return { imported, skipped };
  });
}

export async function updateMonitorTask(ownerId: number, id: number, values: Partial<typeof import("../drizzle/schema").monitorTasks.$inferInsert>) {
  return write(db => {
    const allowed = ["name", "url", "expectedContent", "forbiddenContent", "intervalMinutes", "alertMode", "repeatAlertMinutes", "enabled", "status", "lastCheckedAt", "lastResponseTimeMs", "lastHttpStatus", "lastError", "alertOpen", "lastAlertAt", "lastFailureAt", "lastRecoveredAt"] as const;
    const updates = allowed.filter(key => values[key] !== undefined);
    if (updates.length > 0) {
      const assignments = [...updates.map(key => `${key} = ?`), "updatedAt = ?"];
      const params = [...updates.map(key => toSqlValue(values[key])), now(), ownerId, id];
      db.run(`UPDATE monitor_tasks SET ${assignments.join(", ")} WHERE ownerId = ? AND id = ?`, params);
    }
    const row = selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? AND id = ? LIMIT 1", [ownerId, id])[0];
    return row ? mapTask(row) : undefined;
  });
}

export async function setMonitorTasksEnabled(ownerId: number, taskIds: number[], enabled: boolean) {
  const ids = Array.from(new Set(taskIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;
  return write(db => {
    const placeholders = ids.map(() => "?").join(",");
    const ownedIds = selectRows<{ id: number }>(db, `SELECT id FROM monitor_tasks WHERE ownerId = ? AND id IN (${placeholders})`, [ownerId, ...ids]);
    if (ownedIds.length === 0) return 0;
    db.run(`UPDATE monitor_tasks SET enabled = ?, updatedAt = ? WHERE ownerId = ? AND id IN (${placeholders})`, [toSqlValue(enabled), now(), ownerId, ...ids]);
    return ownedIds.length;
  });
}

export async function deleteMonitorTask(ownerId: number, id: number) {
  await write(db => { db.run("DELETE FROM monitor_checks WHERE taskId = ?", [id]); db.run("DELETE FROM monitor_tasks WHERE ownerId = ? AND id = ?", [ownerId, id]); });
}

export async function deleteMonitorTasks(ownerId: number, taskIds: number[]) {
  const ids = Array.from(new Set(taskIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;
  return write(db => {
    const placeholders = ids.map(() => "?").join(",");
    const ownedIds = selectRows<{ id: number }>(db, `SELECT id FROM monitor_tasks WHERE ownerId = ? AND id IN (${placeholders})`, [ownerId, ...ids]).map(row => Number(row.id));
    if (ownedIds.length === 0) return 0;
    const ownedPlaceholders = ownedIds.map(() => "?").join(",");
    db.run(`DELETE FROM monitor_checks WHERE taskId IN (${ownedPlaceholders})`, ownedIds);
    db.run(`DELETE FROM monitor_tasks WHERE ownerId = ? AND id IN (${ownedPlaceholders})`, [ownerId, ...ownedIds]);
    return ownedIds.length;
  });
}

export async function listMonitorChecks(ownerId: number, taskId: number, limit = 100) {
  const task = await getMonitorTask(ownerId, taskId);
  if (!task) return [];
  return read(db => selectRows<Row>(db, "SELECT * FROM monitor_checks WHERE taskId = ? ORDER BY checkedAt DESC LIMIT ?", [taskId, limit]).map(mapCheck));
}

export async function getChecksForTasks(taskIds: number[], limit = 12) {
  if (taskIds.length === 0) return [];
  return read(db => selectRows<Row>(db, `SELECT * FROM monitor_checks WHERE taskId IN (${taskIds.map(() => "?").join(",")}) ORDER BY checkedAt DESC LIMIT ?`, [...taskIds, limit]).map(mapCheck));
}

export async function listDueMonitorTasks() {
  const tasks = await read(db => selectRows<Row>(db, "SELECT * FROM monitor_tasks WHERE enabled = 1").map(mapTask));
  const currentTime = Date.now();
  return tasks.filter(task => !task.lastCheckedAt || currentTime - task.lastCheckedAt.getTime() >= task.intervalMinutes * 60_000);
}

export async function recordMonitorCheck(taskId: number, result: { status: "success" | "http_error" | "content_mismatch" | "network_error" | "timeout"; responseTimeMs: number; httpStatus: number | null; errorMessage: string | null; expectedContentMatched: boolean | null; resolvedAddresses: string[] }, nextTaskValues: Partial<typeof import("../drizzle/schema").monitorTasks.$inferInsert>) {
  await write(db => {
    const resolvedAddresses = JSON.stringify(Array.from(new Set(result.resolvedAddresses)).slice(0, 32));
    db.run("INSERT INTO monitor_checks (taskId,status,checkedAt,responseTimeMs,httpStatus,errorMessage,expectedContentMatched,resolvedAddresses) VALUES (?,?,?,?,?,?,?,?)", [taskId, result.status, now(), result.responseTimeMs, toSqlValue(result.httpStatus), toSqlValue(result.errorMessage), toSqlValue(result.expectedContentMatched), resolvedAddresses]);
    const allowed = ["status", "lastCheckedAt", "lastResponseTimeMs", "lastHttpStatus", "lastError", "alertOpen", "lastAlertAt", "lastFailureAt", "lastRecoveredAt"] as const;
    const updates = allowed.filter(key => nextTaskValues[key] !== undefined);
    if (updates.length) db.run(`UPDATE monitor_tasks SET ${[...updates.map(key => `${key} = ?`), "updatedAt = ?"].join(", ")} WHERE id = ?`, [...updates.map(key => toSqlValue(nextTaskValues[key])), now(), taskId]);
  });
}

export async function getSmtpSettings(ownerId: number) {
  return read(db => { const row = selectRows<Row>(db, "SELECT * FROM smtp_settings WHERE ownerId = ? LIMIT 1", [ownerId])[0]; return row ? mapSmtp(row) : undefined; });
}

export async function upsertSmtpSettings(values: typeof import("../drizzle/schema").smtpSettings.$inferInsert) {
  await write(db => {
    db.run(`INSERT INTO smtp_settings (ownerId,host,port,secure,username,passwordEncrypted,fromEmail,recipients,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ownerId) DO UPDATE SET host=excluded.host,port=excluded.port,secure=excluded.secure,username=excluded.username,passwordEncrypted=excluded.passwordEncrypted,fromEmail=excluded.fromEmail,recipients=excluded.recipients,updatedAt=excluded.updatedAt`,
      [values.ownerId!, values.host!, values.port!, toSqlValue(values.secure ?? false), toSqlValue(values.username), toSqlValue(values.passwordEncrypted), values.fromEmail!, values.recipients!, now()]);
  });
  return getSmtpSettings(values.ownerId!);
}

export async function saveSchedulerTokenHash(ownerId: number, cronTokenHash: string) {
  await write(db => { db.run("INSERT INTO scheduler_settings (ownerId,cronTokenHash,updatedAt) VALUES (?,?,?) ON CONFLICT(ownerId) DO UPDATE SET cronTokenHash=excluded.cronTokenHash,updatedAt=excluded.updatedAt", [ownerId, cronTokenHash, now()]); });
}

export async function listSchedulerTokenHashes() {
  return read(db => selectRows<{ cronTokenHash: string }>(db, "SELECT cronTokenHash FROM scheduler_settings"));
}

export async function schedulerTokenConfigured(ownerId: number) {
  return read(db => selectRows<Row>(db, "SELECT id FROM scheduler_settings WHERE ownerId = ? LIMIT 1", [ownerId]).length > 0);
}

export async function getSiteSettings(): Promise<SiteSettings> {
  return write(db => {
    const existing = selectRows<Row>(db, "SELECT * FROM site_settings WHERE id = 1 LIMIT 1")[0];
    if (existing) {
      const settings = mapSiteSettings(existing);
      if (settings.recoveryBody === legacyRecoveryBody) {
        const timestamp = now();
        db.run("UPDATE site_settings SET recoveryBody = ?, updatedAt = ? WHERE id = 1", [defaultMailTemplates.recoveryBody, timestamp]);
        return { ...settings, recoveryBody: defaultMailTemplates.recoveryBody, updatedAt: new Date(timestamp) };
      }
      return settings;
    }
    const timestamp = now();
    db.run("INSERT INTO site_settings (id,alertSubject,alertBody,recoverySubject,recoveryBody,updatedAt) VALUES (1,?,?,?,?,?)", [defaultMailTemplates.alertSubject, defaultMailTemplates.alertBody, defaultMailTemplates.recoverySubject, defaultMailTemplates.recoveryBody, timestamp]);
    return { ...defaultMailTemplates, publicUrl: null, requestedPort: null, adminUsername: "sentinel-admin", adminPasswordHash: null, passwordChangeRequestedAt: null, updatedAt: new Date(timestamp) };
  });
}

export async function updateSiteSettings(values: Partial<Pick<SiteSettings, "alertSubject" | "alertBody" | "recoverySubject" | "recoveryBody" | "publicUrl" | "requestedPort" | "adminUsername" | "adminPasswordHash" | "passwordChangeRequestedAt">>) {
  await getSiteSettings();
  await write(db => {
    const updates = Object.entries(values).filter(([, value]) => value !== undefined) as [string, unknown][];
    if (!updates.length) return;
    db.run(`UPDATE site_settings SET ${[...updates.map(([key]) => `${key} = ?`), "updatedAt = ?"].join(", ")} WHERE id = 1`, [...updates.map(([, value]) => toSqlValue(value)), now()]);
  });
  return getSiteSettings();
}

export async function requestAccessSettingsChange(values: Pick<SiteSettings, "publicUrl" | "requestedPort">) {
  const existing = await getSiteSettings();
  const requestPath = process.env.ACCESS_SETTINGS_REQUEST_PATH ?? (process.env.LOCAL_DEPLOYMENT === "true" ? "/var/lib/site-monitor/access-port.request" : undefined);
  if (requestPath) {
    await fs.mkdir(path.dirname(requestPath), { recursive: true });
    const request = formatAccessPortRequest(values.requestedPort, existing.requestedPort);
    await fs.writeFile(requestPath, request, { mode: 0o600 });
  }
  return updateSiteSettings(values);
}

export async function requestLocalAdminPasswordChange(password: string, passwordHash: string) {
  const settings = await getSiteSettings();
  const requestPath = process.env.ADMIN_PASSWORD_REQUEST_PATH ?? (process.env.LOCAL_DEPLOYMENT === "true" ? "/var/lib/site-monitor/admin-password.request" : undefined);
  if (!requestPath) throw new Error("服务器尚未启用本地管理员密码同步服务。请联系服务器管理员完成部署。");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await fs.writeFile(requestPath, `username=${settings.adminUsername}\npassword=${password}\n`, { mode: 0o600 });
  return updateSiteSettings({ adminPasswordHash: passwordHash, passwordChangeRequestedAt: new Date() });
}

export async function requestLocalAdminUsernameChange(username: string) {
  const settings = await getSiteSettings();
  if (settings.adminUsername === username) return settings;
  const requestPath = process.env.ADMIN_AUTH_REQUEST_PATH ?? (process.env.LOCAL_DEPLOYMENT === "true" ? "/var/lib/site-monitor/admin-auth.request" : undefined);
  if (!requestPath) throw new Error("服务器尚未启用本地管理员账号同步服务。请联系服务器管理员完成部署。");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await fs.writeFile(requestPath, formatAdminUsernameRequest(settings.adminUsername, username), { mode: 0o600 });
  return updateSiteSettings({ adminUsername: username });
}

export type { SchedulerSettings };
