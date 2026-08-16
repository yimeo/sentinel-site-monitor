import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, chmod, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatAdminUsernameRequest } from "./adminAuth";

const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function runScript(content: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "sentinel-admin-auth-"));
  tempDirs.push(directory);
  const request = path.join(directory, "request");
  const htpasswd = path.join(directory, "htpasswd");
  const nginx = path.join(directory, "nginx");
  await writeFile(request, content, { mode: 0o600 });
  await writeFile(htpasswd, "sentinel-admin:$apr1$hash\n", { mode: 0o644 });
  await writeFile(nginx, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
  await chmod(nginx, 0o700);
  const script = path.resolve(process.cwd(), "scripts/apply-local-admin-username.sh");
  const result = spawnSync("bash", [script], { env: { ...process.env, REQUEST_FILE: request, HTPASSWD_FILE: htpasswd, NGINX_BIN: nginx }, encoding: "utf8" });
  return { result, htpasswd, request, directory };
}

describe("administrator username synchronization", () => {
  it("formats a restricted rename request", () => {
    expect(formatAdminUsernameRequest("sentinel-admin", "admin")).toBe("oldUsername=sentinel-admin\nnewUsername=admin\n");
    expect(() => formatAdminUsernameRequest("admin", "admin")).toThrow("必须与当前用户名不同");
    expect(() => formatAdminUsernameRequest("admin", "bad name")).toThrow("格式无效");
  });

  it("replaces the existing htpasswd username while preserving its hash", async () => {
    const { result, htpasswd, request } = await runScript("oldUsername=sentinel-admin\nnewUsername=admin\n");
    expect(result.status).toBe(0);
    await expect(readFile(htpasswd, "utf8")).resolves.toBe("admin:$apr1$hash\n");
    await expect(readFile(request, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a duplicate target username without changing credentials", async () => {
    const { result, htpasswd, request } = await runScript("oldUsername=sentinel-admin\nnewUsername=admin\n");
    await writeFile(htpasswd, "sentinel-admin:$apr1$hash\nadmin:$apr1$other\n");
    await writeFile(request, "oldUsername=sentinel-admin\nnewUsername=admin\n");
    const script = path.resolve(process.cwd(), "scripts/apply-local-admin-username.sh");
    const directory = path.dirname(htpasswd);
    const rerun = spawnSync("bash", [script], { env: { ...process.env, REQUEST_FILE: request, HTPASSWD_FILE: htpasswd, NGINX_BIN: path.join(directory, "nginx") }, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(rerun.status).not.toBe(0);
    await expect(readFile(htpasswd, "utf8")).resolves.toContain("sentinel-admin:$apr1$hash");
  });

  it("rejects a request when the existing username is absent", async () => {
    const { result, htpasswd } = await runScript("oldUsername=sentinel-admin\nnewUsername=admin\n");
    await writeFile(htpasswd, "other:$apr1$hash\n");
    const directory = path.dirname(htpasswd);
    await writeFile(path.join(directory, "request"), "oldUsername=sentinel-admin\nnewUsername=admin\n");
    const rerun = spawnSync("bash", [path.resolve(process.cwd(), "scripts/apply-local-admin-username.sh")], { env: { ...process.env, REQUEST_FILE: path.join(directory, "request"), HTPASSWD_FILE: htpasswd, NGINX_BIN: path.join(directory, "nginx") }, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain("Current administrator entry was not found");
  });
});
