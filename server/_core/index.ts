import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { monitorRunHandler } from "../scheduled";
import { fetch as undiciFetch, File as UndiciFile, FormData as UndiciFormData, Headers as UndiciHeaders, Request as UndiciRequest, Response as UndiciResponse } from "undici";
import { webcrypto } from "crypto";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";

if (typeof globalThis.Headers === "undefined") {
  Object.assign(globalThis, {
    fetch: undiciFetch,
    Headers: UndiciHeaders,
    Request: UndiciRequest,
    Response: UndiciResponse,
    FormData: UndiciFormData,
    File: UndiciFile,
    crypto: webcrypto,
    ReadableStream,
    WritableStream,
    TransformStream,
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/scheduled/monitor-run", monitorRunHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
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

  const bindHost = process.env.BIND_HOST || undefined;
  server.listen(port, bindHost, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
