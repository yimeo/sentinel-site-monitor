import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ listSchedulerTokenHashes: vi.fn() }));
vi.mock("./monitoring/service", () => ({ runDueMonitorTasks: vi.fn() }));

import * as db from "./db";
import { runDueMonitorTasks } from "./monitoring/service";
import { monitorRunHandler } from "./scheduled";

const originalLocalToken = process.env.LOCAL_SCHEDULER_TOKEN;

afterEach(() => {
  vi.clearAllMocks();
  if (originalLocalToken === undefined) delete process.env.LOCAL_SCHEDULER_TOKEN;
  else process.env.LOCAL_SCHEDULER_TOKEN = originalLocalToken;
});

describe("本地 cron 调度授权", () => {
  it("接受部署时生成的本地调度令牌并执行到期任务", async () => {
    process.env.LOCAL_SCHEDULER_TOKEN = "local-scheduler-token";
    vi.mocked(runDueMonitorTasks).mockResolvedValue([]);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = { header: vi.fn().mockReturnValue("Bearer local-scheduler-token") };

    await monitorRunHandler(request as never, response as never);

    expect(runDueMonitorTasks).toHaveBeenCalledOnce();
    expect(response.json).toHaveBeenCalledWith({ ok: true, checked: 0, results: [] });
    expect(db.listSchedulerTokenHashes).not.toHaveBeenCalled();
  });
});
