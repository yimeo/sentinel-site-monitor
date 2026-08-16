import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Activity, ChevronRight, Clock3, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const resultMeta = { success: ["正常", "bg-emerald-50 text-emerald-700 border-emerald-100"], http_error: ["HTTP 异常", "bg-rose-50 text-rose-700 border-rose-100"], content_mismatch: ["内容不符", "bg-amber-50 text-amber-700 border-amber-100"], network_error: ["网络错误", "bg-rose-50 text-rose-700 border-rose-100"], timeout: ["请求超时", "bg-rose-50 text-rose-700 border-rose-100"] } as const;
function formatDate(value: Date | string) { return new Date(value).toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

export default function History() {
  const { data: tasks } = trpc.monitor.list.useQuery();
  const [taskId, setTaskId] = useState<string>(() => new URLSearchParams(window.location.search).get("taskId") ?? "all");
  useEffect(() => {
    if (taskId !== "all" && tasks && !tasks.some(item => item.id === Number(taskId))) {
      setTaskId("all");
    }
  }, [taskId, tasks]);
  const task = taskId === "all" ? undefined : tasks?.find(item => item.id === Number(taskId));
  const { data: history, isLoading } = trpc.monitor.history.useQuery({ taskId: Number(taskId), limit: 200 }, { enabled: taskId !== "all" });
  const [, setLocation] = useLocation();
  return <DashboardLayout><div className="mx-auto max-w-7xl"><header><p className="text-xs font-semibold tracking-[0.14em] text-teal-700">检查历史</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">每一次检查，都有记录</h1><p className="mt-2 text-sm text-slate-500">选择具体任务，查看最近 200 条 HTTP 可用性及内容校验结果。</p></header>
    <Card className="mt-8 border-slate-200/80 bg-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.28)]"><CardContent className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="w-full sm:max-w-md"><label className="text-xs font-medium text-slate-500">选择监控任务</label><Select value={taskId} onValueChange={setTaskId}><SelectTrigger className="mt-2 h-10"><SelectValue placeholder="请选择任务" /></SelectTrigger><SelectContent><SelectItem value="all">请选择一个监控任务</SelectItem>{tasks?.map(item => <SelectItem key={item.id} value={item.id.toString()}>{item.name}</SelectItem>)}</SelectContent></Select></div>{task && <Button variant="outline" onClick={() => setLocation("/monitors")} className="border-slate-200 text-slate-600">管理该任务<ChevronRight className="ml-1 h-4 w-4" /></Button>}</div></CardContent></Card>
    <Card className="mt-5 overflow-hidden border-slate-200/80 bg-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.28)]"><CardContent className="p-0">{taskId === "all" ? <div className="p-16 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-4 text-sm font-semibold text-slate-700">请先选择一个任务</p><p className="mt-2 text-sm text-slate-400">历史记录按任务保存，便于快速定位问题。</p></div> : isLoading ? <div className="p-10 text-sm text-slate-400">正在加载历史记录…</div> : !history?.length ? <div className="p-16 text-center"><Activity className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-4 text-sm font-semibold text-slate-700">尚无检查记录</p><p className="mt-2 text-sm text-slate-400">回到监控任务页执行首次手动检查，或等待定时检查触发。</p></div> : <div className="divide-y divide-slate-100">{history.map(record => { const [label, cls] = resultMeta[record.status]; const addresses = record.resolvedAddresses.join(", "); return <div key={record.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[180px_100px_1fr_110px_90px] sm:items-center"><div><p className="text-sm font-medium text-slate-700">{formatDate(record.checkedAt)}</p><p className="mt-1 text-xs text-slate-400">检查时间</p></div><Badge variant="outline" className={`${cls} w-fit justify-center font-medium`}>{label}</Badge><div className="min-w-0"><p className="truncate text-sm text-slate-500" title={record.errorMessage ?? ""}>{record.errorMessage || (record.expectedContentMatched === true ? "期望内容匹配" : "响应正常")}</p>{addresses && <p className="mt-1 truncate text-xs text-slate-400" title={addresses}>DNS：{addresses}</p>}</div><div className="text-sm text-slate-600"><span className="font-medium">{record.responseTimeMs ?? "—"}</span>{record.responseTimeMs !== null && " ms"}</div><div className="text-right text-sm font-medium text-slate-600">{record.httpStatus ?? "—"}</div></div>; })}</div>}</CardContent></Card>
  </div></DashboardLayout>;
}
