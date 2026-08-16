import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { completeLocalAuth } from "@/_core/localAuthFlow";
import { Activity, ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const setup = trpc.auth.setupRequired.useQuery();
  const login = trpc.auth.localLogin.useMutation({
    onSuccess: user => {
      completeLocalAuth(user, {
        setCurrentUser: currentUser => utils.auth.me.setData(undefined, currentUser),
        notifySuccess: () => toast.success("登录成功，正在进入监控中心。"),
        navigateHome: () => setLocation("/"),
      });
    },
    onError: error => toast.error(error.message),
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (setup.data?.localDeployment && setup.data.required) setLocation("/setup");
  }, [setLocation, setup.data]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <AuthShell eyebrow="SENTINEL · SITE MONITOR" title="登录监控中心" description="使用管理员账号管理监控任务、告警邮件与检查历史。">
      {setup.isLoading ? <div className="h-48 animate-pulse rounded-2xl bg-slate-100" /> : setup.data?.localDeployment ? (
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="username">管理员用户名</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="例如：admin" className="h-11 pl-10" required /></div></div>
          <div className="space-y-2"><Label htmlFor="password">管理员密码</Label><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="输入您的密码" className="h-11 pl-10" required /></div></div>
          <Button type="submit" className="h-11 w-full bg-teal-700 font-semibold hover:bg-teal-800" disabled={login.isPending}>{login.isPending ? "正在验证…" : <><span>登录并继续</span><ArrowRight className="h-4 w-4" /></>}</Button>
        </form>
      ) : (
        <div className="space-y-5"><p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">此实例使用统一账户认证。继续后将在安全认证页面完成登录。</p><Button onClick={startLogin} className="h-11 w-full bg-teal-700 font-semibold hover:bg-teal-800">继续登录<ArrowRight className="h-4 w-4" /></Button></div>
      )}
    </AuthShell>
  );
}

export function AuthShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ccfbf1,_transparent_35%),linear-gradient(135deg,_#f8fafc,_#f0fdfa)] px-5 py-10 sm:grid sm:place-items-center sm:p-8"><section className="w-full max-w-[460px] rounded-[28px] border border-white/70 bg-white/90 p-7 shadow-[0_28px_80px_-34px_rgba(15,23,42,0.42)] backdrop-blur sm:p-9"><div className="mb-8"><div className="mb-6 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-700 text-white shadow-lg shadow-teal-900/20"><Activity className="h-5 w-5" /></span><span className="text-[10px] font-bold tracking-[0.18em] text-teal-700">{eyebrow}</span></div><h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{description}</p></div>{children}<p className="mt-7 flex items-center justify-center gap-2 text-center text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-teal-600" />受本机安全会话保护</p></section></main>;
}
