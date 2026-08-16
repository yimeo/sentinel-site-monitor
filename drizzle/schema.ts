import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core user table backing the authentication flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const monitorTaskStatus = ["unknown", "up", "down", "content_mismatch"] as const;
export const checkResultStatus = ["success", "http_error", "content_mismatch", "network_error", "timeout"] as const;
export const alertModes = ["once", "repeat"] as const;

export const monitorTasks = mysqlTable(
  "monitor_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    expectedContent: text("expectedContent"),
    forbiddenContent: text("forbiddenContent"),
    intervalMinutes: int("intervalMinutes").notNull().default(5),
    alertMode: mysqlEnum("alertMode", alertModes).notNull().default("once"),
    repeatAlertMinutes: int("repeatAlertMinutes").notNull().default(30),
    enabled: boolean("enabled").notNull().default(true),
    status: mysqlEnum("status", monitorTaskStatus).notNull().default("unknown"),
    lastCheckedAt: timestamp("lastCheckedAt"),
    nextCheckAt: timestamp("nextCheckAt"),
    lastResponseTimeMs: int("lastResponseTimeMs"),
    lastHttpStatus: int("lastHttpStatus"),
    lastError: text("lastError"),
    alertOpen: boolean("alertOpen").notNull().default(false),
    lastAlertAt: timestamp("lastAlertAt"),
    lastFailureAt: timestamp("lastFailureAt"),
    lastRecoveredAt: timestamp("lastRecoveredAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("monitor_tasks_owner_idx").on(table.ownerId),
    index("monitor_tasks_due_idx").on(table.enabled, table.nextCheckAt),
  ]
);

export const monitorChecks = mysqlTable(
  "monitor_checks",
  {
    id: int("id").autoincrement().primaryKey(),
    taskId: int("taskId").notNull(),
    status: mysqlEnum("status", checkResultStatus).notNull(),
    checkedAt: timestamp("checkedAt").defaultNow().notNull(),
    responseTimeMs: int("responseTimeMs"),
    httpStatus: int("httpStatus"),
    errorMessage: text("errorMessage"),
    expectedContentMatched: boolean("expectedContentMatched"),
    resolvedAddresses: text("resolvedAddresses"),
  },
  table => [
    index("monitor_checks_task_checked_idx").on(table.taskId, table.checkedAt),
  ]
);

export const smtpSettings = mysqlTable(
  "smtp_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    host: varchar("host", { length: 320 }).notNull(),
    port: int("port").notNull(),
    secure: boolean("secure").notNull().default(false),
    username: varchar("username", { length: 320 }),
    passwordEncrypted: text("passwordEncrypted"),
    fromEmail: varchar("fromEmail", { length: 320 }).notNull(),
    recipients: text("recipients").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("smtp_settings_owner_unique").on(table.ownerId)]
);

export const schedulerSettings = mysqlTable(
  "scheduler_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    cronTokenHash: varchar("cronTokenHash", { length: 128 }).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("scheduler_settings_owner_unique").on(table.ownerId)]
);

export type MonitorTask = typeof monitorTasks.$inferSelect;
export type MonitorCheck = typeof monitorChecks.$inferSelect;
export type SmtpSettings = typeof smtpSettings.$inferSelect;
export type SchedulerSettings = typeof schedulerSettings.$inferSelect;
