import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, CheckCircle2, CircleAlert, Clock3, Loader2, Mail, Pencil, Play, Plus, Power, RadioTower, ScrollText, ServerCrash } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type MonitorStatus = "unknown" | "up" | "down" | "content_mismatch";
const statusMeta: Record<MonitorStatus, { label: string; className: string }> = {
  up: { label: "正常", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  down: { label: "异常", className: "bg-rose-50 text-rose-700 border-rose-100" },
  content_mismatch: { label: "内容不符", className: "bg-amber-50 text-amber-700 border-amber-100" },
  unknown: { label: "待检查", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

function formatDate(date: Date | string | null) {
  if (!date) return "尚未检查";
  return new Date(date).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function MetricCard({ label, value, caption, icon: Icon, tone }: { label: string; value: number; caption: string; icon: typeof Activity; tone: "teal" | "rose" | "amber" | "slate" }) {
  const tones = { teal: "bg-teal-50 text-teal-700", rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-600" };
  return <Card className="border-slate-200/80 bg-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.28)]"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p><p className="mt-2 text-xs text-slate-400">{caption}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></div></div></CardContent></Card>;
}

export default function Home() {
  const { data, isLoading } = trpc.dashboard.useQuery();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<"all" | MonitorStatus | "paused">("all");
  const tasks = data?.tasks ?? [];
  const normal = tasks.filter(task => task.status === "up").length;
  const faulty = tasks.filter(task => task.status === "down" || task.status === "content_mismatch").length;
  const unknown = tasks.filter(task => task.status === "unknown").length;
  const filteredTasks = tasks.filter(task => {
    if (statusFilter === "all") return true;
    if (statusFilter === "paused") return !task.enabled;
    return task.enabled && task.status === statusFilter;
  });
  const runMutation = trpc.monitor.runNow.useMutation({
    onSuccess: result => {
      toast.success(result.status === "up" ? "检查完成：目标正常" : "检查完成：发现异常");
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const enabledMutation = trpc.monitor.setEnabled.useMutation({
    onSuccess: (_, values) => {
      toast.success(values.enabled ? "监控任务已启用" : "监控任务已暂停");
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  return <DashboardLayout>
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.14em] text-teal-700">运行概览</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">网站可用性，一目了然</h1><p className="mt-2 text-sm text-slate-500">聚合每个站点最新检测结果，并在状态变更时发出通知。</p></div><Button onClick={() => setLocation("/monitors")} className="rounded-xl bg-[#0f766e] px-4 hover:bg-[#115e59]"><Plus className="mr-2 h-4 w-4" />新增监控任务</Button></header>
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{isLoading ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[138px] rounded-2xl" />) : <><MetricCard label="监控任务" value={tasks.length} caption="已创建的 URL 检查" icon={RadioTower} tone="teal" /><MetricCard label="运行正常" value={normal} caption="最近一次检查成功" icon={CheckCircle2} tone="teal" /><MetricCard label="需要关注" value={faulty} caption="不可用或内容不匹配" icon={CircleAlert} tone="rose" /><MetricCard label="等待检查" value={unknown} caption="新建或未有检查结果" icon={Clock3} tone="slate" /></>}</section>
      {!isLoading && (!data?.smtpConfigured || !data?.schedulerConfigured) && <section className="mt-5 rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4 sm:flex sm:items-center sm:justify-between"><div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><CircleAlert className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-amber-900">完成通知与调度设置</p><p className="mt-1 text-xs leading-5 text-amber-800">{!data?.smtpConfigured ? "SMTP 尚未配置，状态变化时将无法发送邮件。" : "尚未生成调度令牌，Linux cron 无法自动触发检查。"}</p></div></div><Button variant="outline" onClick={() => setLocation("/settings")} className="mt-3 border-amber-200 bg-white text-amber-900 hover:bg-amber-100 sm:mt-0">前往设置<ArrowRight className="ml-2 h-4 w-4" /></Button></section>}
      <section className="mt-8 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]"><Card className="border-slate-200/80 bg-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.28)]"><CardContent className="p-0"><div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">监控任务</h2><p className="mt-1 text-xs text-slate-400">按最后更新时间排序</p></div><button onClick={() => setLocation("/monitors")} className="text-xs font-medium text-teal-700 hover:text-teal-800">管理任务</button></div><div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">{([['all', '全部'], ['up', '正常'], ['down', '异常'], ['content_mismatch', '内容不符'], ['unknown', '待检查'], ['paused', '已暂停']] as const).map(([value, label]) => <button key={value} onClick={() => setStatusFilter(value)} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === value ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{label}</button>)}</div></div><div className="divide-y divide-slate-100">{isLoading ? Array.from({ length: 4 }).map((_, index) => <div className="flex items-center gap-3 p-5" key={index}><Skeleton className="h-9 w-9 rounded-xl" /><Skeleton className="h-8 flex-1" /></div>) : filteredTasks.length ? filteredTasks.slice(0, 6).map(task => { const meta = statusMeta[task.status]; return <div className="flex items-center gap-3 px-5 py-4" key={task.id}><div className={`h-2.5 w-2.5 rounded-full ${task.status === "up" ? "bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.11)]" : task.status === "unknown" ? "bg-slate-300" : "bg-rose-500 shadow-[0_0_0_5px_rgba(244,63,94,0.09)]"}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{task.name}</p><p className="mt-1 truncate text-xs text-slate-400">{task.url}</p></div><div className="hidden min-w-24 text-right sm:block"><p className="text-xs text-slate-600">{task.lastResponseTimeMs ? `${task.lastResponseTimeMs} ms` : "—"}</p><p className="mt-1 text-[11px] text-slate-400">{formatDate(task.lastCheckedAt)}</p></div><Badge variant="outline" className={`${meta.className} min-w-[60px] justify-center font-medium`}>{meta.label}</Badge><div className="flex shrink-0 items-center"><Button onClick={() => runMutation.mutate({ id: task.id })} disabled={runMutation.isPending} aria-label={`立即检查 ${task.name}`} title="立即检查" variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-teal-50 hover:text-teal-700">{runMutation.isPending && runMutation.variables?.id === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}</Button><Button onClick={() => enabledMutation.mutate({ id: task.id, enabled: !task.enabled })} disabled={enabledMutation.isPending} aria-label={task.enabled ? `暂停 ${task.name}` : `启用 ${task.name}`} title={task.enabled ? "暂停监控" : "启用监控"} variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100">{enabledMutation.isPending && enabledMutation.variables?.id === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}</Button><Button onClick={() => setLocation(`/history?taskId=${task.id}`)} aria-label={`查看 ${task.name} 的检查历史`} title="查看检查历史" variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100"><ScrollText className="h-4 w-4" /></Button><Button onClick={() => setLocation("/monitors")} aria-label={`管理 ${task.name}`} title="管理任务" variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></Button></div></div>; }) : <div className="px-5 py-12 text-center"><Activity className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">{tasks.length ? "没有匹配的监控任务" : "尚未添加监控任务"}</p><Button onClick={() => tasks.length ? setStatusFilter("all") : setLocation("/monitors")} variant="link" className="mt-1 text-teal-700">{tasks.length ? "清除筛选" : "立即开始监控"}</Button></div>}</div></CardContent></Card>
        <Card className="border-slate-200/80 bg-[#0f172a] text-white shadow-[0_20px_40px_-25px_rgba(15,23,42,0.65)]"><CardContent className="flex h-full flex-col p-6"><div className="flex items-center justify-between"><p className="text-sm font-semibold">监控规则</p><ServerCrash className="h-5 w-5 text-teal-300" /></div><p className="mt-4 text-2xl font-semibold leading-tight">故障只提醒一次，恢复即时通知。</p><p className="mt-3 text-sm leading-6 text-slate-300">当站点首次不可用或页面内容不符时发送告警。连续失败保持静默，直至目标恢复。</p><div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-xs text-slate-300"><Mail className="h-4 w-4 text-teal-300" />邮件发送由 SMTP 配置控制</div><Button onClick={() => setLocation("/settings")} variant="secondary" className="mt-4 w-full rounded-lg bg-white text-slate-900 hover:bg-slate-100">配置通知与调度</Button></div></CardContent></Card></section>
    </div>
  </DashboardLayout>;
}
