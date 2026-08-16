import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export function serveStatic(app: Express) {
  const distPath = path.resolve(currentDirectory, "public");
  if (!fs.existsSync(distPath)) {
    console.error("Could not find the build directory: make sure to build the client first");
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
