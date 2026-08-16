import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { completeLocalAuth } from "@/_core/localAuthFlow";
import { CheckCircle2, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { AuthShell } from "./Login";

export default function Setup() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const setup = trpc.auth.setupRequired.useQuery();
  const initialize = trpc.auth.initializeLocalAdmin.useMutation({
    onSuccess: user => {
      completeLocalAuth(user, {
        setCurrentUser: currentUser => utils.auth.me.setData(undefined, currentUser),
        notifySuccess: () => toast.success("管理员账户已创建，正在进入监控中心。"),
        navigateHome: () => setLocation("/"),
      });
    },
    onError: error => toast.error(error.message),
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (setup.data && (!setup.data.localDeployment || !setup.data.required)) setLocation("/login");
  }, [setLocation, setup.data]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    initialize.mutate({ username, password, confirmation });
  };

  return <AuthShell eyebrow="首次安装 · 管理员初始化" title="设置管理员账户" description="请先创建唯一的本地管理员账号。此账号用于登录 Sentinel 管理界面。">
    {setup.isLoading ? <div className="h-72 animate-pulse rounded-2xl bg-slate-100" /> : <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-3.5 text-xs leading-5 text-teal-900"><span className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />初始化后将自动登录</span><p className="mt-1 pl-6">用户名需为 3–64 位字母、数字、点、下划线或连字符；密码至少 12 个字符。</p></div>
      <div className="space-y-2"><Label htmlFor="setup-username">管理员用户名</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="setup-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="例如：admin" className="h-11 pl-10" required /></div></div>
      <div className="space-y-2"><Label htmlFor="setup-password">设置密码</Label><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 12 个字符" className="h-11 pl-10" required /></div></div>
      <div className="space-y-2"><Label htmlFor="setup-confirmation">确认密码</Label><Input id="setup-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="再次输入管理员密码" className="h-11" required /></div>
      <Button type="submit" className="mt-2 h-11 w-full bg-teal-700 font-semibold hover:bg-teal-800" disabled={initialize.isPending}>{initialize.isPending ? "正在创建…" : "创建管理员并进入系统"}</Button>
    </form>}
  </AuthShell>;
}
