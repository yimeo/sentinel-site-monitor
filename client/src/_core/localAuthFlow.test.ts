import { describe, expect, it } from "vitest";
import { completeLocalAuth } from "./localAuthFlow";

describe("本地认证成功流程", () => {
  it("先写入认证缓存并提示成功，再跳转到管理首页", () => {
    const calls: string[] = [];
    const user = { id: 1, name: "admin" };
    completeLocalAuth(user, {
      setCurrentUser: received => { expect(received).toBe(user); calls.push("cache"); },
      notifySuccess: () => calls.push("toast"),
      navigateHome: () => calls.push("navigate"),
    });
    expect(calls).toEqual(["cache", "toast", "navigate"]);
  });
});
