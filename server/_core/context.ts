import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { LOCAL_SESSION_COOKIE } from "../../shared/const";
import { sdk } from "./sdk";
import { getLocalSessionUser } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

function readRequestCookie(req: CreateExpressContextOptions["req"], name: string) {
  const parsedCookies = req.cookies as Record<string, string> | undefined;
  if (parsedCookies?.[name]) return parsedCookies[name];
  const header = req.headers.cookie;
  if (!header) return undefined;
  const entry = header.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return undefined; }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

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
    user,
  };
}
