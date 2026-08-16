import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("需要提供 SQLite 数据库文件路径。");

const SQL = await initSqlJs({
  locateFile: file => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
});
const database = new SQL.Database(new Uint8Array(await fs.readFile(databasePath)));
database.run(`CREATE TABLE IF NOT EXISTS scheduler_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL UNIQUE,
  cronTokenHash TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)`);

const token = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(token).digest("hex");
database.run(
  `INSERT INTO scheduler_settings (ownerId, cronTokenHash, updatedAt) VALUES (?, ?, ?)
   ON CONFLICT(ownerId) DO UPDATE SET cronTokenHash=excluded.cronTokenHash, updatedAt=excluded.updatedAt`,
  [1, hash, new Date().toISOString()]
);

await fs.writeFile(databasePath, database.export());
console.log(token);
