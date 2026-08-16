// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var LOCAL_SESSION_COOKIE = "sentinel_local_session";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import initSqlJs from "sql.js";

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/monitoring/access.ts
function isSupportedExternalPort(port) {
  return port === null || port === 80 || Number.isInteger(port) && port >= 1024 && port <= 65535;
}
function formatAccessPortRequest(requestedPort, previousPort) {
  if (!isSupportedExternalPort(requestedPort) || !isSupportedExternalPort(previousPort)) {
    throw new Error("\u8BBF\u95EE\u7AEF\u53E3\u4EC5\u652F\u6301 80 \u6216 1024\u201365535\uFF1BHTTPS \u7684 443 \u7AEF\u53E3\u7531\u57DF\u540D\u8BC1\u4E66\u914D\u7F6E\u7BA1\u7406\u3002");
  }
  return `requestedPort=${requestedPort ?? ""}
previousPort=${previousPort ?? ""}
`;
}

// server/monitoring/adminAuth.ts
var localAdminUsernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

// server/db.ts
var defaultMailTemplates = {
  alertSubject: "[Sentinel] \u6545\u969C\u544A\u8B66\uFF1A{{taskName}}",
  alertBody: "\u76D1\u63A7\u76EE\u6807\u9700\u8981\u5173\u6CE8\u3002\n\n\u4EFB\u52A1\uFF1A{{taskName}}\nURL\uFF1A{{url}}\n\u72B6\u6001\uFF1A{{status}}\nHTTP \u72B6\u6001\u7801\uFF1A{{httpStatus}}\n\u54CD\u5E94\u65F6\u957F\uFF1A{{responseTimeMs}}\n\u9519\u8BEF\u8BE6\u60C5\uFF1A{{errorMessage}}\n\u68C0\u6D4B\u65F6\u95F4\uFF1A{{checkedAt}}",
  recoverySubject: "[Sentinel] \u6062\u590D\u901A\u77E5\uFF1A{{taskName}}",
  recoveryBody: "\u76D1\u63A7\u76EE\u6807\u5DF2\u6062\u590D\u6B63\u5E38\u3002\n\n\u4EFB\u52A1\uFF1A{{taskName}}\nURL\uFF1A{{url}}\n\u72B6\u6001\uFF1A{{status}}\nHTTP \u72B6\u6001\u7801\uFF1A{{httpStatus}}\n\u54CD\u5E94\u65F6\u957F\uFF1A{{responseTimeMs}}\n\u6545\u969C\u6301\u7EED\u65F6\u957F\uFF1A{{outageDuration}}\n\u68C0\u6D4B\u65F6\u95F4\uFF1A{{checkedAt}}"
};
var legacyRecoveryBody = "\u76D1\u63A7\u76EE\u6807\u5DF2\u6062\u590D\u6B63\u5E38\u3002\n\n\u4EFB\u52A1\uFF1A{{taskName}}\nURL\uFF1A{{url}}\n\u72B6\u6001\uFF1A{{status}}\nHTTP \u72B6\u6001\u7801\uFF1A{{httpStatus}}\n\u54CD\u5E94\u65F6\u957F\uFF1A{{responseTimeMs}}\n\u68C0\u6D4B\u65F6\u95F4\uFF1A{{checkedAt}}";
var databasePromise = null;
var writeQueue = Promise.resolve();
var databasePath = () => process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "site-monitor.sqlite");
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var toSqlValue = (value) => {
  if (value === void 0 || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
};
async function getSqlite() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const file = databasePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const SQL = await initSqlJs({ locateFile: (wasm) => path.join(process.cwd(), "node_modules", "sql.js", "dist", wasm) });
      let bytes;
      try {
        bytes = new Uint8Array(await fs.readFile(file));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
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
          status TEXT NOT NULL DEFAULT 'unknown', lastCheckedAt TEXT, nextCheckAt TEXT, lastResponseTimeMs INTEGER, lastHttpStatus INTEGER,
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
      const siteSettingsColumns = selectRows(db, "PRAGMA table_info(site_settings)");
      if (!siteSettingsColumns.some((column) => String(column.name) === "adminUsername")) {
        db.exec("ALTER TABLE site_settings ADD COLUMN adminUsername TEXT NOT NULL DEFAULT 'sentinel-admin'");
      }
      const monitorTaskColumns = selectRows(db, "PRAGMA table_info(monitor_tasks)");
      if (!monitorTaskColumns.some((column) => String(column.name) === "nextCheckAt")) {
        db.exec("ALTER TABLE monitor_tasks ADD COLUMN nextCheckAt TEXT");
      }
      const monitorCheckColumns = selectRows(db, "PRAGMA table_info(monitor_checks)");
      if (!monitorCheckColumns.some((column) => String(column.name) === "resolvedAddresses")) {
        db.exec("ALTER TABLE monitor_checks ADD COLUMN resolvedAddresses TEXT");
      }
      if (!bytes) await persist(db);
      return db;
    })();
  }
  return databasePromise;
}
async function persist(db) {
  await fs.writeFile(databasePath(), db.export());
}
function selectRows(db, sql, params = []) {
  const statement = db.prepare(sql, params);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}
async function read(callback) {
  return callback(await getSqlite());
}
async function write(callback) {
  const action = writeQueue.then(async () => {
    const db = await getSqlite();
    const result = await callback(db);
    await persist(db);
    return result;
  });
  writeQueue = action.catch(() => void 0);
  return action;
}
var parseDate = (value) => value ? new Date(String(value)) : null;
var parseBoolean = (value) => Boolean(Number(value));
var parseResolvedAddresses = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
};
function mapUser(row) {
  return { id: Number(row.id), openId: String(row.openId), name: row.name ? String(row.name) : null, email: row.email ? String(row.email) : null, loginMethod: row.loginMethod ? String(row.loginMethod) : null, role: row.role === "admin" ? "admin" : "user", createdAt: parseDate(row.createdAt), updatedAt: parseDate(row.updatedAt), lastSignedIn: parseDate(row.lastSignedIn) };
}
function mapTask(row) {
  return {
    id: Number(row.id),
    ownerId: Number(row.ownerId),
    name: String(row.name),
    url: String(row.url),
    expectedContent: row.expectedContent ? String(row.expectedContent) : null,
    forbiddenContent: row.forbiddenContent ? String(row.forbiddenContent) : null,
    intervalMinutes: Number(row.intervalMinutes),
    alertMode: row.alertMode === "repeat" ? "repeat" : "once",
    repeatAlertMinutes: Number(row.repeatAlertMinutes),
    enabled: parseBoolean(row.enabled),
    status: ["up", "down", "content_mismatch"].includes(String(row.status)) ? row.status : "unknown",
    lastCheckedAt: parseDate(row.lastCheckedAt),
    nextCheckAt: parseDate(row.nextCheckAt),
    lastResponseTimeMs: row.lastResponseTimeMs === null ? null : Number(row.lastResponseTimeMs),
    lastHttpStatus: row.lastHttpStatus === null ? null : Number(row.lastHttpStatus),
    lastError: row.lastError ? String(row.lastError) : null,
    alertOpen: parseBoolean(row.alertOpen),
    lastAlertAt: parseDate(row.lastAlertAt),
    lastFailureAt: parseDate(row.lastFailureAt),
    lastRecoveredAt: parseDate(row.lastRecoveredAt),
    createdAt: parseDate(row.createdAt),
    updatedAt: parseDate(row.updatedAt)
  };
}
function mapCheck(row) {
  return { id: Number(row.id), taskId: Number(row.taskId), status: String(row.status), checkedAt: parseDate(row.checkedAt), responseTimeMs: row.responseTimeMs === null ? null : Number(row.responseTimeMs), httpStatus: row.httpStatus === null ? null : Number(row.httpStatus), errorMessage: row.errorMessage ? String(row.errorMessage) : null, expectedContentMatched: row.expectedContentMatched === null ? null : parseBoolean(row.expectedContentMatched), resolvedAddresses: parseResolvedAddresses(row.resolvedAddresses) };
}
function mapSmtp(row) {
  return { id: Number(row.id), ownerId: Number(row.ownerId), host: String(row.host), port: Number(row.port), secure: parseBoolean(row.secure), username: row.username ? String(row.username) : null, passwordEncrypted: row.passwordEncrypted ? String(row.passwordEncrypted) : null, fromEmail: String(row.fromEmail), recipients: String(row.recipients), updatedAt: parseDate(row.updatedAt) };
}
function mapSiteSettings(row) {
  return {
    alertSubject: String(row.alertSubject),
    alertBody: String(row.alertBody),
    recoverySubject: String(row.recoverySubject),
    recoveryBody: String(row.recoveryBody),
    publicUrl: row.publicUrl ? String(row.publicUrl) : null,
    requestedPort: row.requestedPort === null ? null : Number(row.requestedPort),
    adminUsername: row.adminUsername ? String(row.adminUsername) : "sentinel-admin",
    adminPasswordHash: row.adminPasswordHash ? String(row.adminPasswordHash) : null,
    passwordChangeRequestedAt: parseDate(row.passwordChangeRequestedAt),
    updatedAt: parseDate(row.updatedAt)
  };
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  await write((db) => {
    const timestamp = now();
    const role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
    db.run(
      `INSERT INTO users (openId,name,email,loginMethod,role,createdAt,updatedAt,lastSignedIn) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(openId) DO UPDATE SET name=excluded.name,email=excluded.email,loginMethod=excluded.loginMethod,role=excluded.role,updatedAt=excluded.updatedAt,lastSignedIn=excluded.lastSignedIn`,
      [user.openId, toSqlValue(user.name), toSqlValue(user.email), toSqlValue(user.loginMethod), role, timestamp, timestamp, toSqlValue(user.lastSignedIn) ?? timestamp]
    );
  });
}
async function getUserByOpenId(openId) {
  return read((db) => {
    const row = selectRows(db, "SELECT * FROM users WHERE openId = ? LIMIT 1", [openId])[0];
    return row ? mapUser(row) : void 0;
  });
}
async function getOrCreateLocalAdmin() {
  const existing = await getUserByOpenId("local-admin");
  if (existing) return existing;
  await upsertUser({ openId: "local-admin", name: "\u672C\u5730\u7BA1\u7406\u5458", email: null, loginMethod: "local", role: "admin", lastSignedIn: /* @__PURE__ */ new Date() });
  const user = await getUserByOpenId("local-admin");
  if (!user) throw new Error("\u65E0\u6CD5\u521D\u59CB\u5316\u672C\u5730\u7BA1\u7406\u5458\u8D26\u6237\u3002");
  return user;
}
async function localAdminSetupRequired() {
  return !(await getSiteSettings()).adminPasswordHash;
}
async function initializeLocalAdmin(username, passwordHash) {
  const settings = await getSiteSettings();
  if (settings.adminPasswordHash) throw new Error("\u7BA1\u7406\u5458\u8D26\u6237\u5DF2\u5B8C\u6210\u521D\u59CB\u5316\u3002");
  const user = await getOrCreateLocalAdmin();
  await updateSiteSettings({ adminUsername: username, adminPasswordHash: passwordHash, passwordChangeRequestedAt: /* @__PURE__ */ new Date() });
  await write((db) => db.run("UPDATE users SET name = ?, updatedAt = ?, lastSignedIn = ? WHERE id = ?", [username, now(), now(), user.id]));
  return await getUserByOpenId("local-admin");
}
async function createLocalSession(userId, maxAgeMs) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
  await write((db) => {
    db.run("DELETE FROM local_sessions WHERE expiresAt <= ?", [createdAt]);
    db.run("INSERT INTO local_sessions (tokenHash,userId,expiresAt,createdAt) VALUES (?,?,?,?)", [tokenHash, userId, expiresAt, createdAt]);
  });
  return token;
}
async function getLocalSessionUser(token) {
  if (!token) return void 0;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return read((db) => {
    const row = selectRows(db, `SELECT users.* FROM local_sessions INNER JOIN users ON users.id = local_sessions.userId
      WHERE local_sessions.tokenHash = ? AND local_sessions.expiresAt > ? LIMIT 1`, [tokenHash, now()])[0];
    return row ? mapUser(row) : void 0;
  });
}
async function deleteLocalSession(token) {
  if (!token) return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await write((db) => db.run("DELETE FROM local_sessions WHERE tokenHash = ?", [tokenHash]));
}
async function listMonitorTasks(ownerId) {
  return read((db) => selectRows(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? ORDER BY updatedAt DESC", [ownerId]).map(mapTask));
}
async function getMonitorTask(ownerId, id) {
  return read((db) => {
    const row = selectRows(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? AND id = ? LIMIT 1", [ownerId, id])[0];
    return row ? mapTask(row) : void 0;
  });
}
var SCHEDULER_TICK_MS = 1e4;
function getNextCheckAt(intervalMinutes, offsetTicks, reference = /* @__PURE__ */ new Date()) {
  const intervalMs = Math.max(1, intervalMinutes) * 6e4;
  const ticksPerWindow = Math.max(1, Math.floor(intervalMs / SCHEDULER_TICK_MS));
  const slotOffsetMs = (offsetTicks % ticksPerWindow + ticksPerWindow) % ticksPerWindow * SCHEDULER_TICK_MS;
  const windowStart = Math.floor(reference.getTime() / intervalMs) * intervalMs;
  const candidate = windowStart + slotOffsetMs;
  return new Date(candidate > reference.getTime() ? candidate : candidate + intervalMs);
}
function taskSlotOffset(taskId, index, total, ticksPerWindow, randomize) {
  const start = Math.floor(index * ticksPerWindow / total);
  const nextStart = Math.floor((index + 1) * ticksPerWindow / total);
  const width = Math.max(1, nextStart - start);
  const jitter = randomize ? crypto.randomInt(width) : Math.abs(taskId * 2654435761 % width);
  return Math.min(ticksPerWindow - 1, start + jitter);
}
function scheduleTaskGroup(db, tasks, reference, randomize = false) {
  const byInterval = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const group = byInterval.get(task.intervalMinutes) ?? [];
    group.push(task);
    byInterval.set(task.intervalMinutes, group);
  }
  let scheduled = 0;
  byInterval.forEach((group, intervalMinutes) => {
    const ordered = [...group].sort((left, right) => left.id - right.id);
    if (randomize) {
      for (let index = ordered.length - 1; index > 0; index -= 1) {
        const swapIndex = crypto.randomInt(index + 1);
        [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
      }
    }
    const ticksPerWindow = Math.max(1, intervalMinutes * 6e4 / SCHEDULER_TICK_MS);
    ordered.forEach((task, index) => {
      const minimumTime = task.lastCheckedAt ? new Date(Math.max(reference.getTime(), task.lastCheckedAt.getTime() + intervalMinutes * 6e4)) : reference;
      const nextCheckAt = getNextCheckAt(intervalMinutes, taskSlotOffset(task.id, index, ordered.length, ticksPerWindow, randomize), minimumTime).toISOString();
      db.run("UPDATE monitor_tasks SET nextCheckAt = ?, updatedAt = ? WHERE id = ?", [nextCheckAt, now(), task.id]);
      scheduled += 1;
    });
  });
  return scheduled;
}
async function createMonitorTask(input) {
  return write((db) => {
    const timestamp = now();
    db.run(
      `INSERT INTO monitor_tasks (ownerId,name,url,expectedContent,forbiddenContent,intervalMinutes,alertMode,repeatAlertMinutes,enabled,status,alertOpen,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,'unknown',0,?,?)`,
      [input.ownerId, input.name, input.url, toSqlValue(input.expectedContent), toSqlValue(input.forbiddenContent), input.intervalMinutes ?? 5, input.alertMode ?? "once", input.repeatAlertMinutes ?? 30, toSqlValue(input.enabled ?? true), timestamp, timestamp]
    );
    const row = selectRows(db, "SELECT * FROM monitor_tasks WHERE id = last_insert_rowid() LIMIT 1")[0];
    if (row) {
      const intervalMinutes = Number(row.intervalMinutes);
      const ticksPerWindow = Math.max(1, intervalMinutes * 6e4 / SCHEDULER_TICK_MS);
      db.run("UPDATE monitor_tasks SET nextCheckAt = ? WHERE id = ?", [getNextCheckAt(intervalMinutes, Number(row.id) % ticksPerWindow).toISOString(), Number(row.id)]);
    }
    return row ? mapTask(row) : void 0;
  });
}
async function importMonitorTasks(ownerId, tasks) {
  return write((db) => {
    const existing = new Set(selectRows(db, "SELECT name, url FROM monitor_tasks WHERE ownerId = ?", [ownerId]).map((task) => `${task.name}\0${task.url}`));
    const timestamp = now();
    const importedTasks = [];
    let imported = 0;
    let skipped = 0;
    for (const task of tasks) {
      const key = `${task.name}\0${task.url}`;
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      db.run(
        `INSERT INTO monitor_tasks (ownerId,name,url,expectedContent,forbiddenContent,intervalMinutes,alertMode,repeatAlertMinutes,enabled,status,alertOpen,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,'unknown',0,?,?)`,
        [ownerId, task.name, task.url, toSqlValue(task.expectedContent), toSqlValue(task.forbiddenContent), task.intervalMinutes, task.alertMode, task.repeatAlertMinutes, toSqlValue(task.enabled), timestamp, timestamp]
      );
      const inserted = selectRows(db, "SELECT * FROM monitor_tasks WHERE id = last_insert_rowid() LIMIT 1")[0];
      if (inserted) importedTasks.push(mapTask(inserted));
      existing.add(key);
      imported += 1;
    }
    scheduleTaskGroup(db, importedTasks, new Date(timestamp));
    return { imported, skipped };
  });
}
async function updateMonitorTask(ownerId, id, values) {
  return write((db) => {
    const allowed = ["name", "url", "expectedContent", "forbiddenContent", "intervalMinutes", "alertMode", "repeatAlertMinutes", "enabled", "status", "lastCheckedAt", "nextCheckAt", "lastResponseTimeMs", "lastHttpStatus", "lastError", "alertOpen", "lastAlertAt", "lastFailureAt", "lastRecoveredAt"];
    const updates = allowed.filter((key) => values[key] !== void 0);
    if (updates.length > 0) {
      const assignments = [...updates.map((key) => `${key} = ?`), "updatedAt = ?"];
      const params = [...updates.map((key) => toSqlValue(values[key])), now(), ownerId, id];
      db.run(`UPDATE monitor_tasks SET ${assignments.join(", ")} WHERE ownerId = ? AND id = ?`, params);
    }
    if (values.intervalMinutes !== void 0) {
      const intervalMinutes = Number(values.intervalMinutes);
      const ticksPerWindow = Math.max(1, intervalMinutes * 6e4 / SCHEDULER_TICK_MS);
      db.run("UPDATE monitor_tasks SET nextCheckAt = ? WHERE ownerId = ? AND id = ?", [getNextCheckAt(intervalMinutes, id % ticksPerWindow).toISOString(), ownerId, id]);
    }
    const row = selectRows(db, "SELECT * FROM monitor_tasks WHERE ownerId = ? AND id = ? LIMIT 1", [ownerId, id])[0];
    return row ? mapTask(row) : void 0;
  });
}
async function setMonitorTasksEnabled(ownerId, taskIds, enabled) {
  const ids = Array.from(new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;
  return write((db) => {
    const placeholders = ids.map(() => "?").join(",");
    const ownedIds = selectRows(db, `SELECT id FROM monitor_tasks WHERE ownerId = ? AND id IN (${placeholders})`, [ownerId, ...ids]);
    if (ownedIds.length === 0) return 0;
    db.run(`UPDATE monitor_tasks SET enabled = ?, updatedAt = ? WHERE ownerId = ? AND id IN (${placeholders})`, [toSqlValue(enabled), now(), ownerId, ...ids]);
    return ownedIds.length;
  });
}
async function redistributeMonitorTaskSchedule(ownerId, taskIds) {
  const ids = Array.from(new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;
  return write((db) => {
    const placeholders = ids.map(() => "?").join(",");
    const tasks = selectRows(db, `SELECT * FROM monitor_tasks WHERE ownerId = ? AND id IN (${placeholders})`, [ownerId, ...ids]).map(mapTask);
    return scheduleTaskGroup(db, tasks, /* @__PURE__ */ new Date(), true);
  });
}
async function deleteMonitorTask(ownerId, id) {
  await write((db) => {
    db.run("DELETE FROM monitor_checks WHERE taskId = ?", [id]);
    db.run("DELETE FROM monitor_tasks WHERE ownerId = ? AND id = ?", [ownerId, id]);
  });
}
async function deleteMonitorTasks(ownerId, taskIds) {
  const ids = Array.from(new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;
  return write((db) => {
    const placeholders = ids.map(() => "?").join(",");
    const ownedIds = selectRows(db, `SELECT id FROM monitor_tasks WHERE ownerId = ? AND id IN (${placeholders})`, [ownerId, ...ids]).map((row) => Number(row.id));
    if (ownedIds.length === 0) return 0;
    const ownedPlaceholders = ownedIds.map(() => "?").join(",");
    db.run(`DELETE FROM monitor_checks WHERE taskId IN (${ownedPlaceholders})`, ownedIds);
    db.run(`DELETE FROM monitor_tasks WHERE ownerId = ? AND id IN (${ownedPlaceholders})`, [ownerId, ...ownedIds]);
    return ownedIds.length;
  });
}
async function listMonitorChecks(ownerId, taskId, limit = 100) {
  const task = await getMonitorTask(ownerId, taskId);
  if (!task) return [];
  return read((db) => selectRows(db, "SELECT * FROM monitor_checks WHERE taskId = ? ORDER BY checkedAt DESC LIMIT ?", [taskId, limit]).map(mapCheck));
}
async function getChecksForTasks(taskIds, limit = 12) {
  if (taskIds.length === 0) return [];
  return read((db) => selectRows(db, `SELECT * FROM monitor_checks WHERE taskId IN (${taskIds.map(() => "?").join(",")}) ORDER BY checkedAt DESC LIMIT ?`, [...taskIds, limit]).map(mapCheck));
}
async function listDueMonitorTasks() {
  await write((db) => {
    const unscheduled = selectRows(db, "SELECT * FROM monitor_tasks WHERE enabled = 1 AND nextCheckAt IS NULL").map(mapTask);
    scheduleTaskGroup(db, unscheduled, /* @__PURE__ */ new Date());
  });
  const tasks = await read((db) => selectRows(db, "SELECT * FROM monitor_tasks WHERE enabled = 1").map(mapTask));
  const currentTime = Date.now();
  return tasks.filter((task) => task.nextCheckAt !== null && task.nextCheckAt.getTime() <= currentTime);
}
async function recordMonitorCheck(taskId, result, nextTaskValues) {
  await write((db) => {
    const resolvedAddresses = JSON.stringify(Array.from(new Set(result.resolvedAddresses)).slice(0, 32));
    db.run("INSERT INTO monitor_checks (taskId,status,checkedAt,responseTimeMs,httpStatus,errorMessage,expectedContentMatched,resolvedAddresses) VALUES (?,?,?,?,?,?,?,?)", [taskId, result.status, now(), result.responseTimeMs, toSqlValue(result.httpStatus), toSqlValue(result.errorMessage), toSqlValue(result.expectedContentMatched), resolvedAddresses]);
    const allowed = ["status", "lastCheckedAt", "nextCheckAt", "lastResponseTimeMs", "lastHttpStatus", "lastError", "alertOpen", "lastAlertAt", "lastFailureAt", "lastRecoveredAt"];
    const updates = allowed.filter((key) => nextTaskValues[key] !== void 0);
    if (updates.length) db.run(`UPDATE monitor_tasks SET ${[...updates.map((key) => `${key} = ?`), "updatedAt = ?"].join(", ")} WHERE id = ?`, [...updates.map((key) => toSqlValue(nextTaskValues[key])), now(), taskId]);
  });
}
async function getSmtpSettings(ownerId) {
  return read((db) => {
    const row = selectRows(db, "SELECT * FROM smtp_settings WHERE ownerId = ? LIMIT 1", [ownerId])[0];
    return row ? mapSmtp(row) : void 0;
  });
}
async function upsertSmtpSettings(values) {
  await write((db) => {
    db.run(
      `INSERT INTO smtp_settings (ownerId,host,port,secure,username,passwordEncrypted,fromEmail,recipients,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ownerId) DO UPDATE SET host=excluded.host,port=excluded.port,secure=excluded.secure,username=excluded.username,passwordEncrypted=excluded.passwordEncrypted,fromEmail=excluded.fromEmail,recipients=excluded.recipients,updatedAt=excluded.updatedAt`,
      [values.ownerId, values.host, values.port, toSqlValue(values.secure ?? false), toSqlValue(values.username), toSqlValue(values.passwordEncrypted), values.fromEmail, values.recipients, now()]
    );
  });
  return getSmtpSettings(values.ownerId);
}
async function saveSchedulerTokenHash(ownerId, cronTokenHash) {
  await write((db) => {
    db.run("INSERT INTO scheduler_settings (ownerId,cronTokenHash,updatedAt) VALUES (?,?,?) ON CONFLICT(ownerId) DO UPDATE SET cronTokenHash=excluded.cronTokenHash,updatedAt=excluded.updatedAt", [ownerId, cronTokenHash, now()]);
  });
}
async function listSchedulerTokenHashes() {
  return read((db) => selectRows(db, "SELECT cronTokenHash FROM scheduler_settings"));
}
async function schedulerTokenConfigured(ownerId) {
  return read((db) => selectRows(db, "SELECT id FROM scheduler_settings WHERE ownerId = ? LIMIT 1", [ownerId]).length > 0);
}
async function getSiteSettings() {
  return write((db) => {
    const existing = selectRows(db, "SELECT * FROM site_settings WHERE id = 1 LIMIT 1")[0];
    if (existing) {
      const settings = mapSiteSettings(existing);
      if (settings.recoveryBody === legacyRecoveryBody) {
        const timestamp2 = now();
        db.run("UPDATE site_settings SET recoveryBody = ?, updatedAt = ? WHERE id = 1", [defaultMailTemplates.recoveryBody, timestamp2]);
        return { ...settings, recoveryBody: defaultMailTemplates.recoveryBody, updatedAt: new Date(timestamp2) };
      }
      return settings;
    }
    const timestamp = now();
    db.run("INSERT INTO site_settings (id,alertSubject,alertBody,recoverySubject,recoveryBody,updatedAt) VALUES (1,?,?,?,?,?)", [defaultMailTemplates.alertSubject, defaultMailTemplates.alertBody, defaultMailTemplates.recoverySubject, defaultMailTemplates.recoveryBody, timestamp]);
    return { ...defaultMailTemplates, publicUrl: null, requestedPort: null, adminUsername: "sentinel-admin", adminPasswordHash: null, passwordChangeRequestedAt: null, updatedAt: new Date(timestamp) };
  });
}
async function updateSiteSettings(values) {
  await getSiteSettings();
  await write((db) => {
    const updates = Object.entries(values).filter(([, value]) => value !== void 0);
    if (!updates.length) return;
    db.run(`UPDATE site_settings SET ${[...updates.map(([key]) => `${key} = ?`), "updatedAt = ?"].join(", ")} WHERE id = 1`, [...updates.map(([, value]) => toSqlValue(value)), now()]);
  });
  return getSiteSettings();
}
async function requestAccessSettingsChange(values) {
  const existing = await getSiteSettings();
  const requestPath = process.env.ACCESS_SETTINGS_REQUEST_PATH ?? (process.env.LOCAL_DEPLOYMENT === "true" ? "/var/lib/site-monitor/access-port.request" : void 0);
  if (requestPath) {
    await fs.mkdir(path.dirname(requestPath), { recursive: true });
    const request = formatAccessPortRequest(values.requestedPort, existing.requestedPort);
    await fs.writeFile(requestPath, request, { mode: 384 });
  }
  return updateSiteSettings(values);
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data == null ? void 0 : data.platforms,
      (data == null ? void 0 : data.platform) ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data == null ? void 0 : data.platforms,
      (data == null ? void 0 : data.platform) ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now2 = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now2,
    updatedAt: now2,
    lastSignedIn: now2,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z4 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/monitoring/crypto.ts
import crypto2 from "node:crypto";
var getKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("\u5E94\u7528\u52A0\u5BC6\u5BC6\u94A5\u4E0D\u53EF\u7528\uFF0C\u8BF7\u8BBE\u7F6E JWT_SECRET\u3002");
  return crypto2.createHash("sha256").update(secret).digest();
};
function encryptSecret(value) {
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptSecret(value) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("\u4FDD\u5B58\u7684\u51ED\u636E\u683C\u5F0F\u65E0\u6548\u3002");
  const decipher = crypto2.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
function hashToken(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function createSchedulerToken() {
  return crypto2.randomBytes(32).toString("base64url");
}
function safelyCompareHash(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto2.timingSafeEqual(leftBuffer, rightBuffer);
}
async function hashPassword(value) {
  const salt = crypto2.randomBytes(16).toString("base64url");
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(value, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}
async function verifyPassword(value, encoded) {
  const [algorithm, salt, encodedHash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, "base64url");
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(value, salt, expected.length, (error, key) => error ? reject(error) : resolve(key));
  });
  return expected.length === derived.length && crypto2.timingSafeEqual(expected, derived);
}

// server/monitoring/engine.ts
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
var REQUEST_TIMEOUT_MS = 2e4;
function createFreshDnsDispatcher() {
  return new Agent({
    connections: 1,
    pipelining: 0,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1
  });
}
function validateMonitorUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("\u8BF7\u8F93\u5165\u5B8C\u6574\u7684 HTTP \u6216 HTTPS \u5730\u5740\u3002");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("\u4EC5\u652F\u6301 HTTP \u548C HTTPS \u5730\u5740\u3002");
  }
  return parsed.toString();
}
function toErrorMessage(error) {
  if (error instanceof Error) return error.message.slice(0, 1e3);
  return String(error).slice(0, 1e3);
}
function splitForbiddenContent(value) {
  return (value ?? "").split(/[\n,;，；]/).map((item) => item.trim()).filter(Boolean);
}
async function checkUrl(task) {
  var _a;
  const startedAt = Date.now();
  const controller = new AbortController();
  const dispatcher = createFreshDnsDispatcher();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resolvedAddresses = [];
  try {
    const hostname = new URL(task.url).hostname;
    resolvedAddresses = Array.from(new Set((await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address)));
    console.info(`[Monitoring][DNS] ${hostname} -> ${resolvedAddresses.join(", ")}`);
    const request = globalThis.fetch ?? undiciFetch;
    const response = await request(task.url, {
      redirect: "follow",
      signal: controller.signal,
      dispatcher,
      headers: {
        "user-agent": "SiteMonitor/1.0 (+website-availability-check)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2"
      }
    });
    const responseTimeMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        status: "http_error",
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: `HTTP ${response.status} ${response.statusText}`.trim(),
        expectedContentMatched: null,
        resolvedAddresses
      };
    }
    const expectedContent = (_a = task.expectedContent) == null ? void 0 : _a.trim();
    const forbiddenContent = splitForbiddenContent(task.forbiddenContent);
    if (expectedContent || forbiddenContent.length > 0) {
      const body = await response.text();
      const normalizedBody = body.toLowerCase();
      const expectedMatched = expectedContent ? normalizedBody.includes(expectedContent.toLowerCase()) : null;
      const forbiddenMatch = forbiddenContent.find((item) => normalizedBody.includes(item.toLowerCase()));
      if (forbiddenMatch) {
        return {
          status: "content_mismatch",
          responseTimeMs,
          httpStatus: response.status,
          errorMessage: `\u9875\u9762\u51FA\u73B0\u7981\u6B62\u5185\u5BB9\uFF1A${forbiddenMatch}`.slice(0, 1e3),
          expectedContentMatched: expectedMatched,
          resolvedAddresses
        };
      }
      if (expectedMatched === false) {
        return {
          status: "content_mismatch",
          responseTimeMs,
          httpStatus: response.status,
          errorMessage: "\u9875\u9762\u672A\u5305\u542B\u914D\u7F6E\u7684\u671F\u671B\u5185\u5BB9\u3002",
          expectedContentMatched: false,
          resolvedAddresses
        };
      }
      return {
        status: "success",
        responseTimeMs,
        httpStatus: response.status,
        errorMessage: null,
        expectedContentMatched: expectedMatched,
        resolvedAddresses
      };
    }
    return {
      status: "success",
      responseTimeMs,
      httpStatus: response.status,
      errorMessage: null,
      expectedContentMatched: null,
      resolvedAddresses
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      status: isTimeout ? "timeout" : "network_error",
      responseTimeMs,
      httpStatus: null,
      errorMessage: isTimeout ? `\u8BF7\u6C42\u5728 ${REQUEST_TIMEOUT_MS / 1e3} \u79D2\u540E\u8D85\u65F6\u3002` : toErrorMessage(error),
      expectedContentMatched: null,
      resolvedAddresses
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
}
function statusFromCheck(result) {
  if (result.status === "success") return "up";
  if (result.status === "content_mismatch") return "content_mismatch";
  return "down";
}

// server/monitoring/mail.ts
import nodemailer from "nodemailer";
function buildSmtpTransportOptions(config) {
  var _a;
  const username = (_a = config.username) == null ? void 0 : _a.trim();
  const password = config.passwordEncrypted ? decryptSecret(config.passwordEncrypted) : void 0;
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    family: 4,
    auth: username ? { user: username, pass: password ?? "" } : void 0
  };
}
function buildTransport(config) {
  return nodemailer.createTransport(buildSmtpTransportOptions(config));
}
function parseRecipients(value) {
  return value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
}
function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] ?? character);
}
function renderMailTemplate(template, values) {
  return template.replace(/{{\s*(taskName|url|status|httpStatus|responseTimeMs|errorMessage|checkedAt|outageDuration)\s*}}/g, (_, key) => values[key] ?? "");
}
function renderMonitorEmailHtml(text, url) {
  const html = escapeHtml(text).replace(/\n/g, "<br />");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return html;
    const escapedUrl = escapeHtml(url);
    const link = `<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer" style="color:#0f766e;text-decoration:underline;word-break:break-all">${escapedUrl}</a>`;
    return html.split(escapedUrl).join(link);
  } catch {
    return html;
  }
}
async function verifySmtp(config) {
  await buildTransport(config).verify();
}
async function sendTestEmail(config) {
  const recipients = parseRecipients(config.recipients);
  if (recipients.length === 0) throw new Error("\u8BF7\u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A\u544A\u8B66\u6536\u4EF6\u4EBA\u3002");
  await buildTransport(config).sendMail({
    from: config.fromEmail,
    to: recipients,
    subject: "[Site Monitor] SMTP \u6D4B\u8BD5\u90AE\u4EF6",
    text: "SMTP \u914D\u7F6E\u9A8C\u8BC1\u6210\u529F\u3002\u540E\u7EED\u7F51\u7AD9\u6545\u969C\u548C\u6062\u590D\u4FE1\u606F\u5C06\u53D1\u9001\u5230\u6B64\u6536\u4EF6\u4EBA\u5217\u8868\u3002",
    html: "<p>SMTP \u914D\u7F6E\u9A8C\u8BC1\u6210\u529F\u3002</p><p>\u540E\u7EED\u7F51\u7AD9\u6545\u969C\u548C\u6062\u590D\u4FE1\u606F\u5C06\u53D1\u9001\u5230\u6B64\u6536\u4EF6\u4EBA\u5217\u8868\u3002</p>"
  });
}
async function sendMonitorAlert(config, input) {
  var _a;
  const recipients = parseRecipients(config.recipients);
  if (recipients.length === 0) throw new Error("\u672A\u914D\u7F6E\u544A\u8B66\u6536\u4EF6\u4EBA\u3002");
  const isRecovery = input.type === "recovery";
  const values = {
    taskName: input.taskName,
    url: input.url,
    status: input.status,
    httpStatus: ((_a = input.httpStatus) == null ? void 0 : _a.toString()) ?? "\u2014",
    responseTimeMs: input.responseTimeMs !== null ? `${input.responseTimeMs} ms` : "\u2014",
    errorMessage: input.errorMessage ?? "\u2014",
    checkedAt: (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    outageDuration: input.outageDuration ?? "\u2014"
  };
  const subject = renderMailTemplate(isRecovery ? input.templates.recoverySubject : input.templates.alertSubject, values);
  const bodyTemplate = isRecovery && !input.templates.recoveryBody.includes("{{outageDuration}}") ? `${input.templates.recoveryBody}

\u6545\u969C\u6301\u7EED\u65F6\u957F\uFF1A{{outageDuration}}` : isRecovery ? input.templates.recoveryBody : input.templates.alertBody;
  const text = renderMailTemplate(bodyTemplate, values);
  await buildTransport(config).sendMail({
    from: config.fromEmail,
    to: recipients,
    subject,
    text,
    html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:620px;margin:auto;color:#0f172a;white-space:normal;line-height:1.7">${renderMonitorEmailHtml(text, input.url)}</div>`
  });
}

// server/monitoring/service.ts
var dueMonitorRunInFlight = null;
function formatOutageDuration(durationMs) {
  const seconds = Math.max(0, Math.floor(durationMs / 1e3));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = seconds % 60;
  const parts = [days > 0 ? `${days}\u5929` : "", hours > 0 ? `${hours}\u5C0F\u65F6` : "", minutes > 0 ? `${minutes}\u5206` : "", remainingSeconds > 0 || seconds === 0 ? `${remainingSeconds}\u79D2` : ""].filter(Boolean);
  return parts.join("");
}
async function sendStateChangeEmail(task, type, data) {
  const smtp = await getSmtpSettings(task.ownerId);
  if (!smtp) return false;
  const settings = await getSiteSettings();
  await sendMonitorAlert(smtp, {
    type,
    taskName: task.name,
    url: task.url,
    templates: settings,
    ...data
  });
  return true;
}
async function runMonitorTask(task) {
  var _a;
  const result = await checkUrl(task);
  const nextStatus = statusFromCheck(result);
  const isHealthy = result.status === "success";
  const now2 = /* @__PURE__ */ new Date();
  const shouldInitialAlert = !isHealthy && (!task.alertOpen || !task.lastAlertAt);
  const shouldRepeatAlert = !isHealthy && task.alertOpen && task.alertMode === "repeat" && task.lastAlertAt !== null && now2.getTime() - task.lastAlertAt.getTime() >= task.repeatAlertMinutes * 6e4;
  const shouldAlert = shouldInitialAlert || shouldRepeatAlert;
  const shouldRecover = isHealthy && task.alertOpen;
  await recordMonitorCheck(task.id, result, {
    status: nextStatus,
    lastCheckedAt: now2,
    nextCheckAt: new Date(Math.max(now2.getTime(), ((_a = task.nextCheckAt) == null ? void 0 : _a.getTime()) ?? now2.getTime()) + task.intervalMinutes * 6e4),
    lastResponseTimeMs: result.responseTimeMs,
    lastHttpStatus: result.httpStatus,
    lastError: result.errorMessage,
    alertOpen: !isHealthy,
    lastAlertAt: shouldRecover ? null : task.lastAlertAt,
    lastFailureAt: isHealthy ? task.lastFailureAt : task.alertOpen ? task.lastFailureAt ?? now2 : now2,
    lastRecoveredAt: shouldRecover ? now2 : task.lastRecoveredAt
  });
  if (!shouldAlert && !shouldRecover) {
    return { taskId: task.id, status: nextStatus, notification: "none" };
  }
  try {
    const delivered = await sendStateChangeEmail(task, shouldAlert ? "alert" : "recovery", {
      status: nextStatus === "up" ? "\u6B63\u5E38" : nextStatus === "down" ? "\u4E0D\u53EF\u7528" : "\u5185\u5BB9\u4E0D\u5339\u914D",
      httpStatus: result.httpStatus,
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
      outageDuration: shouldRecover && task.lastFailureAt ? formatOutageDuration(now2.getTime() - task.lastFailureAt.getTime()) : "\u2014"
    });
    if (!delivered) return { taskId: task.id, status: nextStatus, notification: "delivery_failed" };
    if (shouldAlert) await updateMonitorTask(task.ownerId, task.id, { lastAlertAt: now2 });
    return { taskId: task.id, status: nextStatus, notification: shouldAlert ? "alert" : "recovery" };
  } catch (error) {
    console.error(`[Monitoring] Mail notification for task ${task.id} could not be delivered:`, error);
    return { taskId: task.id, status: nextStatus, notification: "delivery_failed" };
  }
}
async function runMonitorTasks(tasks, concurrency = 3) {
  const uniqueTasks = Array.from(new Map(tasks.map((task) => [task.id, task])).values());
  const results = [];
  const limit = Math.min(5, Math.max(1, Math.floor(concurrency)));
  for (let index = 0; index < uniqueTasks.length; index += limit) {
    results.push(...await Promise.all(uniqueTasks.slice(index, index + limit).map(runMonitorTask)));
  }
  return results;
}
async function runDueMonitorTasks() {
  if (dueMonitorRunInFlight) return [];
  const run = (async () => {
    const dueTasks = await listDueMonitorTasks();
    const results = [];
    for (const task of dueTasks) {
      results.push(await runMonitorTask(task));
    }
    return results;
  })();
  dueMonitorRunInFlight = run;
  try {
    return await run;
  } finally {
    if (dueMonitorRunInFlight === run) dueMonitorRunInFlight = null;
  }
}

// server/monitoring/settingsValidation.ts
import { z as z2 } from "zod";
var mailTemplatesInput = z2.object({
  alertSubject: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u6545\u969C\u90AE\u4EF6\u4E3B\u9898\u3002").max(300),
  alertBody: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u6545\u969C\u90AE\u4EF6\u6B63\u6587\u3002").max(2e4),
  recoverySubject: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u6062\u590D\u90AE\u4EF6\u4E3B\u9898\u3002").max(300),
  recoveryBody: z2.string().trim().min(1, "\u8BF7\u8F93\u5165\u6062\u590D\u90AE\u4EF6\u6B63\u6587\u3002").max(2e4)
});
var accessSettingsInput = z2.object({
  publicUrl: z2.string().trim().url("\u8BF7\u8F93\u5165\u5B8C\u6574\u8BBF\u95EE\u5730\u5740\uFF0C\u4F8B\u5982 https://monitor.example.com\u3002").max(500).nullable(),
  requestedPort: z2.number().int().min(1).max(65535).nullable().refine(isSupportedExternalPort, "\u5916\u90E8\u8BBF\u95EE\u7AEF\u53E3\u4EC5\u652F\u6301 80 \u6216 1024\u201365535\uFF1BHTTPS \u7684 443 \u7AEF\u53E3\u5C06\u5728\u57DF\u540D\u8BC1\u4E66\u914D\u7F6E\u65F6\u542F\u7528\u3002")
});
var localAdminPasswordInput = z2.object({
  password: z2.string().min(12, "\u7BA1\u7406\u5458\u5BC6\u7801\u81F3\u5C11\u9700\u8981 12 \u4E2A\u5B57\u7B26\u3002").max(256),
  confirmation: z2.string()
}).refine((input) => input.password === input.confirmation, { message: "\u4E24\u6B21\u8F93\u5165\u7684\u7BA1\u7406\u5458\u5BC6\u7801\u4E0D\u4E00\u81F4\u3002", path: ["confirmation"] });
var localAdminUsernameInput = z2.object({
  username: z2.string().trim().regex(localAdminUsernamePattern, "\u7BA1\u7406\u5458\u7528\u6237\u540D\u9700\u4E3A 3\u201364 \u4F4D\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u70B9\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26\uFF0C\u4E14\u5FC5\u987B\u4EE5\u5B57\u6BCD\u6216\u6570\u5B57\u5F00\u5934\u3002")
});

// server/monitoring/taskTransfer.ts
import { z as z3 } from "zod";
var monitorTaskTransferSchema = z3.object({
  name: z3.string().trim().min(1, "\u8BF7\u8F93\u5165\u4EFB\u52A1\u540D\u79F0\u3002").max(160),
  url: z3.string().trim().min(1, "\u8BF7\u8F93\u5165 URL\u3002"),
  expectedContent: z3.string().trim().max(2e4).nullable(),
  forbiddenContent: z3.string().trim().max(2e4).nullable(),
  intervalMinutes: z3.number().int().min(1, "\u68C0\u67E5\u95F4\u9694\u81F3\u5C11\u4E3A 1 \u5206\u949F\u3002").max(43200, "\u68C0\u67E5\u95F4\u9694\u4E0D\u80FD\u8D85\u8FC7 30 \u5929\u3002"),
  alertMode: z3.enum(["once", "repeat"]),
  repeatAlertMinutes: z3.number().int().min(1, "\u8FDE\u7EED\u63D0\u9192\u95F4\u9694\u81F3\u5C11\u4E3A 1 \u5206\u949F\u3002").max(43200, "\u8FDE\u7EED\u63D0\u9192\u95F4\u9694\u4E0D\u80FD\u8D85\u8FC7 30 \u5929\u3002"),
  enabled: z3.boolean()
});
var monitorTaskBackupSchema = z3.object({
  format: z3.literal("sentinel-monitor-tasks"),
  version: z3.literal(1),
  exportedAt: z3.string().datetime(),
  tasks: z3.array(monitorTaskTransferSchema).min(1, "\u5907\u4EFD\u6587\u4EF6\u4E2D\u6CA1\u6709\u76D1\u63A7\u4EFB\u52A1\u3002").max(500, "\u4E00\u6B21\u6700\u591A\u5BFC\u5165 500 \u4E2A\u76D1\u63A7\u4EFB\u52A1\u3002")
});
function createMonitorTaskBackup(tasks) {
  return { format: "sentinel-monitor-tasks", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), tasks };
}

// server/routers.ts
var taskInput = monitorTaskTransferSchema;
var localSessionMaxAgeMs = 1e3 * 60 * 60 * 24 * 7;
var localCredentialsInput = z4.object({
  username: localAdminUsernameInput.shape.username,
  password: z4.string().min(1, "\u8BF7\u8F93\u5165\u7BA1\u7406\u5458\u5BC6\u7801\u3002").max(256)
});
var localSetupInput = z4.object({
  username: localAdminUsernameInput.shape.username,
  password: z4.string().min(12, "\u7BA1\u7406\u5458\u5BC6\u7801\u81F3\u5C11\u9700\u8981 12 \u4E2A\u5B57\u7B26\u3002").max(256),
  confirmation: z4.string()
}).refine((input) => input.password === input.confirmation, { message: "\u4E24\u6B21\u8F93\u5165\u7684\u7BA1\u7406\u5458\u5BC6\u7801\u4E0D\u4E00\u81F4\u3002", path: ["confirmation"] });
var smtpInput = z4.object({
  host: z4.string().trim().min(1, "\u8BF7\u8F93\u5165 SMTP \u4E3B\u673A\u3002").max(320),
  port: z4.number().int().min(1).max(65535),
  secure: z4.boolean(),
  username: z4.string().trim().max(320).optional().nullable(),
  password: z4.string().max(2e3).optional(),
  fromEmail: z4.string().trim().email("\u8BF7\u8F93\u5165\u6709\u6548\u7684\u53D1\u4EF6\u4EBA\u90AE\u7BB1\u3002").max(320),
  recipients: z4.string().trim().min(1, "\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u4E2A\u6536\u4EF6\u4EBA\u3002").max(1e4)
});
function validatedRecipients(value) {
  const recipients = parseRecipients(value);
  if (recipients.length === 0) throw new TRPCError3({ code: "BAD_REQUEST", message: "\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u4E2A\u6536\u4EF6\u4EBA\u3002" });
  const emailValidator = z4.string().email();
  recipients.forEach((recipient) => {
    if (!emailValidator.safeParse(recipient).success) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: `\u6536\u4EF6\u4EBA\u90AE\u7BB1\u65E0\u6548\uFF1A${recipient}` });
    }
  });
  return recipients;
}
function taskOrNotFound(task) {
  if (!task) throw new TRPCError3({ code: "NOT_FOUND", message: "\u672A\u627E\u5230\u8BE5\u76D1\u63A7\u4EFB\u52A1\u3002" });
  return task;
}
function assertLocalDeployment() {
  if (process.env.LOCAL_DEPLOYMENT !== "true") {
    throw new TRPCError3({ code: "FORBIDDEN", message: "\u8BE5\u8BA4\u8BC1\u65B9\u5F0F\u4EC5\u9002\u7528\u4E8E\u672C\u5730\u90E8\u7F72\u3002" });
  }
}
async function startLocalSession(ctx, userId) {
  const token = await createLocalSession(userId, localSessionMaxAgeMs);
  ctx.res.cookie(LOCAL_SESSION_COOKIE, token, { ...getSessionCookieOptions(ctx.req), maxAge: localSessionMaxAgeMs });
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    setupRequired: publicProcedure.query(async () => ({
      localDeployment: process.env.LOCAL_DEPLOYMENT === "true",
      required: process.env.LOCAL_DEPLOYMENT === "true" && await localAdminSetupRequired()
    })),
    initializeLocalAdmin: publicProcedure.input(localSetupInput).mutation(async ({ ctx, input }) => {
      assertLocalDeployment();
      if (!await localAdminSetupRequired()) {
        throw new TRPCError3({ code: "CONFLICT", message: "\u7BA1\u7406\u5458\u8D26\u6237\u5DF2\u5B8C\u6210\u521D\u59CB\u5316\uFF0C\u8BF7\u76F4\u63A5\u767B\u5F55\u3002" });
      }
      const user = await initializeLocalAdmin(input.username, await hashPassword(input.password));
      await startLocalSession(ctx, user.id);
      return user;
    }),
    localLogin: publicProcedure.input(localCredentialsInput).mutation(async ({ ctx, input }) => {
      assertLocalDeployment();
      const settings = await getSiteSettings();
      if (!settings.adminPasswordHash) {
        throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "\u8BF7\u5148\u5B8C\u6210\u7BA1\u7406\u5458\u521D\u59CB\u5316\u3002" });
      }
      if (settings.adminUsername !== input.username || !await verifyPassword(input.password, settings.adminPasswordHash)) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u4E0D\u6B63\u786E\u3002" });
      }
      const user = await getOrCreateLocalAdmin();
      await startLocalSession(ctx, user.id);
      return user;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      var _a;
      const cookieOptions = getSessionCookieOptions(ctx.req);
      await deleteLocalSession((_a = ctx.req.cookies) == null ? void 0 : _a[LOCAL_SESSION_COOKIE]);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const tasks = await listMonitorTasks(ctx.user.id);
    const recentChecks = await getChecksForTasks(tasks.map((task) => task.id));
    const smtpConfigured = Boolean(await getSmtpSettings(ctx.user.id));
    const schedulerConfigured = await schedulerTokenConfigured(ctx.user.id);
    return { tasks, recentChecks, smtpConfigured, schedulerConfigured };
  }),
  monitor: router({
    list: protectedProcedure.query(({ ctx }) => listMonitorTasks(ctx.user.id)),
    exportConfig: protectedProcedure.mutation(async ({ ctx }) => {
      const tasks = await listMonitorTasks(ctx.user.id);
      return createMonitorTaskBackup(tasks.map((task) => ({ name: task.name, url: task.url, expectedContent: task.expectedContent, forbiddenContent: task.forbiddenContent, intervalMinutes: task.intervalMinutes, alertMode: task.alertMode, repeatAlertMinutes: task.repeatAlertMinutes, enabled: task.enabled })));
    }),
    importConfig: protectedProcedure.input(monitorTaskBackupSchema).mutation(async ({ ctx, input }) => {
      const normalizedTasks = input.tasks.map((task) => {
        var _a, _b;
        let url;
        try {
          url = validateMonitorUrl(task.url);
        } catch (error) {
          throw new TRPCError3({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "\u5BFC\u5165\u6587\u4EF6\u5305\u542B\u65E0\u6548 URL\u3002" });
        }
        return { ...task, url, expectedContent: ((_a = task.expectedContent) == null ? void 0 : _a.trim()) || null, forbiddenContent: ((_b = task.forbiddenContent) == null ? void 0 : _b.trim()) || null };
      });
      return importMonitorTasks(ctx.user.id, normalizedTasks);
    }),
    create: protectedProcedure.input(taskInput).mutation(async ({ ctx, input }) => {
      var _a, _b;
      let url;
      try {
        url = validateMonitorUrl(input.url);
      } catch (error) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "URL \u65E0\u6548\u3002" });
      }
      return createMonitorTask({
        ownerId: ctx.user.id,
        name: input.name,
        url,
        expectedContent: ((_a = input.expectedContent) == null ? void 0 : _a.trim()) || null,
        forbiddenContent: ((_b = input.forbiddenContent) == null ? void 0 : _b.trim()) || null,
        intervalMinutes: input.intervalMinutes,
        alertMode: input.alertMode,
        repeatAlertMinutes: input.repeatAlertMinutes,
        enabled: input.enabled
      });
    }),
    update: protectedProcedure.input(z4.object({ id: z4.number().int().positive(), data: taskInput })).mutation(async ({ ctx, input }) => {
      var _a, _b;
      taskOrNotFound(await getMonitorTask(ctx.user.id, input.id));
      let url;
      try {
        url = validateMonitorUrl(input.data.url);
      } catch (error) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "URL \u65E0\u6548\u3002" });
      }
      return updateMonitorTask(ctx.user.id, input.id, {
        name: input.data.name,
        url,
        expectedContent: ((_a = input.data.expectedContent) == null ? void 0 : _a.trim()) || null,
        forbiddenContent: ((_b = input.data.forbiddenContent) == null ? void 0 : _b.trim()) || null,
        intervalMinutes: input.data.intervalMinutes,
        alertMode: input.data.alertMode,
        repeatAlertMinutes: input.data.repeatAlertMinutes,
        enabled: input.data.enabled
      });
    }),
    remove: protectedProcedure.input(z4.object({ id: z4.number().int().positive() })).mutation(async ({ ctx, input }) => {
      taskOrNotFound(await getMonitorTask(ctx.user.id, input.id));
      await deleteMonitorTask(ctx.user.id, input.id);
      return { success: true };
    }),
    removeBulk: protectedProcedure.input(z4.object({ ids: z4.array(z4.number().int().positive()).min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteMonitorTasks(ctx.user.id, input.ids);
      return { deleted };
    }),
    setEnabled: protectedProcedure.input(z4.object({ id: z4.number().int().positive(), enabled: z4.boolean() })).mutation(async ({ ctx, input }) => {
      taskOrNotFound(await getMonitorTask(ctx.user.id, input.id));
      return updateMonitorTask(ctx.user.id, input.id, { enabled: input.enabled });
    }),
    setEnabledBulk: protectedProcedure.input(z4.object({ ids: z4.array(z4.number().int().positive()).min(1).max(500), enabled: z4.boolean() })).mutation(async ({ ctx, input }) => {
      const updated = await setMonitorTasksEnabled(ctx.user.id, input.ids, input.enabled);
      return { updated, enabled: input.enabled };
    }),
    redistributeSchedule: protectedProcedure.input(z4.object({ ids: z4.array(z4.number().int().positive()).min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const rescheduled = await redistributeMonitorTaskSchedule(ctx.user.id, input.ids);
      return { rescheduled };
    }),
    runNow: protectedProcedure.input(z4.object({ id: z4.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const task = taskOrNotFound(await getMonitorTask(ctx.user.id, input.id));
      return runMonitorTask(task);
    }),
    runSelectedNow: protectedProcedure.input(z4.object({ ids: z4.array(z4.number().int().positive()).min(1).max(50) })).mutation(async ({ ctx, input }) => {
      const ids = Array.from(new Set(input.ids));
      const tasks = (await Promise.all(ids.map((id) => getMonitorTask(ctx.user.id, id)))).filter((task) => Boolean(task));
      const results = await runMonitorTasks(tasks);
      return { checked: results.length, results };
    }),
    history: protectedProcedure.input(z4.object({ taskId: z4.number().int().positive(), limit: z4.number().int().min(1).max(500).default(100) })).query(
      ({ ctx, input }) => listMonitorChecks(ctx.user.id, input.taskId, input.limit)
    )
  }),
  settings: router({
    smtp: protectedProcedure.query(async ({ ctx }) => {
      const settings = await getSmtpSettings(ctx.user.id);
      if (!settings) return null;
      return {
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        username: settings.username,
        fromEmail: settings.fromEmail,
        recipients: settings.recipients,
        passwordConfigured: Boolean(settings.passwordEncrypted),
        updatedAt: settings.updatedAt
      };
    }),
    saveSmtp: protectedProcedure.input(smtpInput).mutation(async ({ ctx, input }) => {
      const recipients = validatedRecipients(input.recipients);
      const existing = await getSmtpSettings(ctx.user.id);
      if ((existing == null ? void 0 : existing.passwordEncrypted) && input.password === "") {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u5982\u9700\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u5BC6\u7801\uFF0C\u8BF7\u5148\u4FDD\u5B58\u65E0\u9700\u8BA4\u8BC1\u7684\u914D\u7F6E\u3002" });
      }
      if (input.username && !input.password && !(existing == null ? void 0 : existing.passwordEncrypted)) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u5DF2\u586B\u5199\u7528\u6237\u540D\uFF0C\u8BF7\u540C\u65F6\u8F93\u5165 SMTP \u5BC6\u7801\u3002" });
      }
      const values = {
        ownerId: ctx.user.id,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username || null,
        passwordEncrypted: input.password ? encryptSecret(input.password) : input.username ? (existing == null ? void 0 : existing.passwordEncrypted) ?? null : null,
        fromEmail: input.fromEmail,
        recipients: recipients.join(", ")
      };
      return upsertSmtpSettings(values);
    }),
    testSmtp: protectedProcedure.mutation(async ({ ctx }) => {
      const settings = await getSmtpSettings(ctx.user.id);
      if (!settings) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "\u8BF7\u5148\u4FDD\u5B58 SMTP \u914D\u7F6E\u3002" });
      await verifySmtp(settings);
      await sendTestEmail(settings);
      return { success: true };
    }),
    site: protectedProcedure.query(async () => {
      const settings = await getSiteSettings();
      return {
        alertSubject: settings.alertSubject,
        alertBody: settings.alertBody,
        recoverySubject: settings.recoverySubject,
        recoveryBody: settings.recoveryBody,
        publicUrl: settings.publicUrl,
        requestedPort: settings.requestedPort,
        adminUsername: settings.adminUsername,
        localPasswordConfigured: Boolean(settings.adminPasswordHash),
        passwordChangeRequestedAt: settings.passwordChangeRequestedAt,
        updatedAt: settings.updatedAt
      };
    }),
    saveMailTemplates: protectedProcedure.input(mailTemplatesInput).mutation(({ input }) => updateSiteSettings(input)),
    saveAccessSettings: protectedProcedure.input(accessSettingsInput).mutation(async ({ input }) => {
      var _a;
      const publicUrl = ((_a = input.publicUrl) == null ? void 0 : _a.replace(/\/$/, "")) || null;
      return requestAccessSettingsChange({ publicUrl, requestedPort: input.requestedPort });
    }),
    changeLocalPassword: protectedProcedure.input(localAdminPasswordInput).mutation(async ({ input }) => {
      const passwordHash = await hashPassword(input.password);
      await updateSiteSettings({ adminPasswordHash: passwordHash, passwordChangeRequestedAt: /* @__PURE__ */ new Date() });
      return { success: true };
    }),
    changeLocalUsername: protectedProcedure.input(localAdminUsernameInput).mutation(({ input }) => updateSiteSettings({ adminUsername: input.username }))
  }),
  scheduler: router({
    status: protectedProcedure.query(async ({ ctx }) => ({ configured: await schedulerTokenConfigured(ctx.user.id) })),
    rotateToken: protectedProcedure.mutation(async ({ ctx }) => {
      const token = createSchedulerToken();
      await saveSchedulerTokenHash(ctx.user.id, hashToken(token));
      return { token };
    })
  })
});

// server/_core/context.ts
function readRequestCookie(req, name) {
  const parsedCookies = req.cookies;
  if (parsedCookies == null ? void 0 : parsedCookies[name]) return parsedCookies[name];
  const header = req.headers.cookie;
  if (!header) return void 0;
  const entry = header.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  if (!entry) return void 0;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return void 0;
  }
}
async function createContext(opts) {
  let user = null;
  if (process.env.LOCAL_DEPLOYMENT === "true") {
    user = await getLocalSessionUser(readRequestCookie(opts.req, LOCAL_SESSION_COOKIE)) ?? null;
  } else {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/static.ts
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
var currentDirectory = path2.dirname(fileURLToPath(import.meta.url));
function serveStatic(app) {
  const distPath = path2.resolve(currentDirectory, "public");
  if (!fs2.existsSync(distPath)) {
    console.error("Could not find the build directory: make sure to build the client first");
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/scheduled.ts
function getBearerToken(request) {
  var _a;
  const authorization = request.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return ((_a = match == null ? void 0 : match[1]) == null ? void 0 : _a.trim()) || null;
}
async function isSchedulerAuthorized(token) {
  const candidate = hashToken(token);
  const localToken = process.env.LOCAL_SCHEDULER_TOKEN;
  if (localToken && safelyCompareHash(hashToken(localToken), candidate)) return true;
  const records = await listSchedulerTokenHashes();
  return records.some((record) => safelyCompareHash(record.cronTokenHash, candidate));
}
async function monitorRunHandler(request, response) {
  const token = getBearerToken(request);
  if (!token || !await isSchedulerAuthorized(token)) {
    return response.status(401).json({ error: "\u65E0\u6548\u7684\u8C03\u5EA6\u4EE4\u724C\u3002" });
  }
  try {
    const results = await runDueMonitorTasks();
    return response.json({ ok: true, checked: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/index.ts
import { fetch as undiciFetch2, File as UndiciFile, FormData as UndiciFormData, Headers as UndiciHeaders, Request as UndiciRequest, Response as UndiciResponse } from "undici";
import { webcrypto } from "crypto";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";
if (typeof globalThis.Headers === "undefined") {
  Object.assign(globalThis, {
    fetch: undiciFetch2,
    Headers: UndiciHeaders,
    Request: UndiciRequest,
    Response: UndiciResponse,
    FormData: UndiciFormData,
    File: UndiciFile,
    crypto: webcrypto,
    ReadableStream,
    WritableStream,
    TransformStream
  });
}
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/scheduled/monitor-run", monitorRunHandler);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  const bindHost = process.env.BIND_HOST || void 0;
  server.listen(port, bindHost, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
