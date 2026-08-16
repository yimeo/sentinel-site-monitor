import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SESSION_COOKIE } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const originalDatabasePath = process.env.SQLITE_DB_PATH;
const originalLocalDeployment = process.env.LOCAL_DEPLOYMENT;
const databaseFiles: string[] = [];

afterEach(async () => {
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.SQLITE_DB_PATH;
  else process.env.SQLITE_DB_PATH = originalDatabasePath;
  if (originalLocalDeployment === undefined) delete process.env.LOCAL_DEPLOYMENT;
  else process.env.LOCAL_DEPLOYMENT = originalLocalDeployment;
  await Promise.all(databaseFiles.splice(0).map(file => fs.rm(file, { force: true })));
});

describe("本地管理员会话上下文", () => {
  it("从原始 Cookie 请求头恢复已初始化管理员的身份", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-auth-context-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    process.env.LOCAL_DEPLOYMENT = "true";
    vi.resetModules();
    const db = await import("./db");
    const admin = await db.initializeLocalAdmin("admin", "password-hash");
    const token = await db.createLocalSession(admin.id, 60_000);
    const { createContext } = await import("./_core/context");

    const context = await createContext({
      req: { headers: { cookie: `other=value; ${LOCAL_SESSION_COOKIE}=${token}` } },
      res: {},
    } as any);

    expect(context.user?.openId).toBe("local-admin");
    expect(context.user?.name).toBe("admin");
  });

  it("首次初始化和后续登录均会签发可供 auth.me 恢复的本地会话", async () => {
    const databaseFile = path.join(os.tmpdir(), `sentinel-auth-router-${Date.now()}-${Math.random()}.sqlite`);
    databaseFiles.push(databaseFile);
    process.env.SQLITE_DB_PATH = databaseFile;
    process.env.LOCAL_DEPLOYMENT = "true";
    vi.resetModules();
    const { appRouter } = await import("./routers");
    const { createContext } = await import("./_core/context");

    const issueCookie = async (procedure: "initialize" | "login") => {
      const cookies: Array<{ name: string; value: string }> = [];
      const ctx = {
        user: null,
        req: { protocol: "http", headers: {} },
        res: { cookie: (name: string, value: string) => cookies.push({ name, value }) },
      } as unknown as TrpcContext;
      const caller = appRouter.createCaller(ctx);
      if (procedure === "initialize") await caller.auth.initializeLocalAdmin({ username: "admin", password: "correct-horse-battery", confirmation: "correct-horse-battery" });
      else await caller.auth.localLogin({ username: "admin", password: "correct-horse-battery" });
      return cookies.find(cookie => cookie.name === LOCAL_SESSION_COOKIE)?.value;
    };

    const initializedToken = await issueCookie("initialize");
    expect(initializedToken).toBeTruthy();
    const afterInitialization = await createContext({ req: { headers: { cookie: `${LOCAL_SESSION_COOKIE}=${initializedToken}` } }, res: {} } as any);
    expect(await appRouter.createCaller(afterInitialization).auth.me()).toMatchObject({ openId: "local-admin", name: "admin" });

    const loggedInToken = await issueCookie("login");
    expect(loggedInToken).toBeTruthy();
    const afterLogin = await createContext({ req: { headers: { cookie: `${LOCAL_SESSION_COOKIE}=${loggedInToken}` } }, res: {} } as any);
    expect(await appRouter.createCaller(afterLogin).auth.me()).toMatchObject({ openId: "local-admin", name: "admin" });
  });
});
