import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CircleAlert, Download, ExternalLink, FileJson, Pause, Pencil, Play, Plus, Power, Shuffle, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MonitorTask } from "../../../drizzle/schema";

type TaskForm = {
  name: string;
  url: string;
  expectedContent: string;
  forbiddenContent: string;
  intervalMinutes: string;
  alertMode: "once" | "repeat";
  repeatAlertMinutes: string;
  enabled: boolean;
};

const emptyForm: TaskForm = {
  name: "",
  url: "https://",
  expectedContent: "",
  forbiddenContent: "",
  intervalMinutes: "5",
  alertMode: "once",
  repeatAlertMinutes: "30",
  enabled: true,
};

function statusPill(status: MonitorTask["status"]) {
  const config = {
    up: ["正常", "bg-emerald-50 text-emerald-700 border-emerald-100"],
    down: ["异常", "bg-rose-50 text-rose-700 border-rose-100"],
    content_mismatch: ["内容不符", "bg-amber-50 text-amber-700 border-amber-100"],
    unknown: ["待检查", "bg-slate-100 text-slate-600 border-slate-200"],
  } as const;
  const [label, classes] = config[status];
  return <Badge variant="outline" className={`${classes} justify-center font-medium`}>{label}</Badge>;
}

function formatDate(value: Date | string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "尚未检查";
}

function ContentRule({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <p className={`${compact ? "mt-1" : "mt-2"} truncate text-xs text-slate-500`}>
      {label}：<span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{value}</span>
    </p>
  );
}

export default function Monitors() {
  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.monitor.list.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MonitorTask | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const createMutation = trpc.monitor.create.useMutation({
    onSuccess: () => {
      toast.success("监控任务已创建");
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
      closeDialog();
    },
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.monitor.update.useMutation({
    onSuccess: () => {
      toast.success("监控任务已更新");
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
      closeDialog();
    },
    onError: error => toast.error(error.message),
  });
  const deleteMutation = trpc.monitor.remove.useMutation({
    onSuccess: () => {
      toast.success("监控任务已删除");
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const batchDeleteMutation = trpc.monitor.removeBulk.useMutation({
    onSuccess: result => {
      toast.success(`已批量删除 ${result.deleted} 个监控任务及其检查历史。`);
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const enabledMutation = trpc.monitor.setEnabled.useMutation({
    onSuccess: () => {
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const batchEnabledMutation = trpc.monitor.setEnabledBulk.useMutation({
    onSuccess: result => {
      toast.success(`已批量${result.enabled ? "开启" : "暂停"} ${result.updated} 个监控任务。`);
      setSelectedIds(new Set());
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const runMutation = trpc.monitor.runNow.useMutation({
    onSuccess: result => {
      toast.success(result.status === "up" ? "检查完成：目标正常" : "检查完成：发现异常");
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const runSelectedMutation = trpc.monitor.runSelectedNow.useMutation({
    onSuccess: result => {
      toast.success(`已立即检查 ${result.checked} 个监控目标。`);
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const redistributeMutation = trpc.monitor.redistributeSchedule.useMutation({
    onSuccess: result => {
      toast.success(`已将 ${result.rescheduled} 个任务随机分散到各自的下一个检查窗口。`);
      void utils.monitor.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const exportMutation = trpc.monitor.exportConfig.useMutation({
    onSuccess: backup => {
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sentinel-monitor-tasks-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${backup.tasks.length} 个监控任务配置。`);
    },
    onError: error => toast.error(error.message),
  });
  const importMutation = trpc.monitor.importConfig.useMutation({
    onSuccess: result => {
      toast.success(`导入完成：新增 ${result.imported} 个任务，跳过 ${result.skipped} 个重复任务。`);
      void utils.monitor.list.invalidate();
      void utils.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        url: editing.url,
        expectedContent: editing.expectedContent ?? "",
        forbiddenContent: editing.forbiddenContent ?? "",
        intervalMinutes: editing.intervalMinutes.toString(),
        alertMode: editing.alertMode,
        repeatAlertMinutes: editing.repeatAlertMinutes.toString(),
        enabled: editing.enabled,
      });
    }
  }, [editing]);

  useEffect(() => {
    if (!tasks) return;
    const taskIds = new Set(tasks.map(task => task.id));
    setSelectedIds(previous => new Set(Array.from(previous).filter(id => taskIds.has(id))));
  }, [tasks]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const save = () => {
    const data = {
      name: form.name,
      url: form.url,
      expectedContent: form.expectedContent || null,
      forbiddenContent: form.forbiddenContent || null,
      intervalMinutes: Number(form.intervalMinutes),
      alertMode: form.alertMode,
      repeatAlertMinutes: Number(form.repeatAlertMinutes),
      enabled: form.enabled,
    };
    if (!Number.isInteger(data.intervalMinutes)) return toast.error("检查间隔必须是整数分钟。");
    if (!Number.isInteger(data.repeatAlertMinutes)) return toast.error("连续提醒间隔必须是整数分钟。");
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      importMutation.mutate(JSON.parse(await file.text()));
    } catch {
      toast.error("无法读取导入文件，请选择 Sentinel 导出的 JSON 文件。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const selectedCount = selectedIds.size;
  const allSelected = Boolean(tasks?.length) && tasks!.every(task => selectedIds.has(task.id));
  const batchUpdating = batchEnabledMutation.isPending;
  const batchDeleting = batchDeleteMutation.isPending;
  const batchChecking = runSelectedMutation.isPending;
  const batchRedistributing = redistributeMutation.isPending;
  const toggleSelectedTask = (id: number, selected: boolean) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAllTasks = (selected: boolean) => setSelectedIds(selected ? new Set(tasks?.map(task => task.id) ?? []) : new Set());

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-teal-700">任务管理</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">监控目标</h1>
            <p className="mt-2 text-sm text-slate-500">为每个 URL 单独设定检查频率与页面内容校验规则。</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={event => void importFile(event.target.files?.[0])} />
            <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} variant="outline" className="h-7 border-slate-200 px-1.5 text-[11px] text-slate-700 hover:bg-slate-50">
              <Download className="mr-0.5 h-3 w-3" />{exportMutation.isPending ? "导出中…" : "导出任务"}
            </Button>
            <Button onClick={() => importInputRef.current?.click()} disabled={importMutation.isPending} variant="outline" className="h-7 border-teal-200 px-1.5 text-[11px] text-teal-700 hover:bg-teal-50">
              <Upload className="mr-0.5 h-3 w-3" />{importMutation.isPending ? "导入中…" : "导入任务"}
            </Button>
            <Button onClick={() => runSelectedMutation.mutate({ ids: Array.from(selectedIds) })} disabled={!selectedCount || batchChecking} variant="outline" className="h-7 border-sky-200 px-1.5 text-[11px] text-sky-700 hover:bg-sky-50">
              <Play className="mr-0.5 h-3 w-3" />{batchChecking ? "检查中…" : "检查"}{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
            <Button onClick={() => redistributeMutation.mutate({ ids: Array.from(selectedIds) })} disabled={!selectedCount || batchRedistributing} variant="outline" title="将所选任务的下一次检查时间随机错开，不会立即发起请求" className="h-7 border-violet-200 px-1.5 text-[11px] text-violet-700 hover:bg-violet-50">
              <Shuffle className="mr-0.5 h-3 w-3" />{batchRedistributing ? "安排中…" : "错峰"}{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
            <Button onClick={() => batchEnabledMutation.mutate({ ids: Array.from(selectedIds), enabled: true })} disabled={!selectedCount || batchUpdating} variant="outline" className="h-7 border-emerald-200 px-1.5 text-[11px] text-emerald-700 hover:bg-emerald-50">
              <Power className="mr-0.5 h-3 w-3" />开启{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
            <Button onClick={() => batchEnabledMutation.mutate({ ids: Array.from(selectedIds), enabled: false })} disabled={!selectedCount || batchUpdating} variant="outline" className="h-7 border-slate-200 px-1.5 text-[11px] text-slate-700 hover:bg-slate-50">
              <Pause className="mr-0.5 h-3 w-3" />暂停{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
            <Button onClick={() => setBulkDeleteOpen(true)} disabled={!selectedCount || batchDeleting} variant="outline" className="h-7 border-rose-200 px-1.5 text-[11px] text-rose-700 hover:bg-rose-50">
              <Trash2 className="mr-0.5 h-3 w-3" />删除{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
            <Button onClick={openCreate} className="h-7 rounded-lg bg-[#0f766e] px-2 text-[11px] hover:bg-[#115e59]"><Plus className="mr-0.5 h-3 w-3" />添加任务</Button>
          </div>
        </header>

        <div className="mt-5 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs leading-5 text-sky-900">
          <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <p>导入仅新增未存在的同名同 URL 任务，并会自动将同频率任务分散到各自检查窗口，避免同时请求。选中任务后可点击“错峰”重新随机安排下一次检查时间；该操作不会立即发起检查，也不会改变频率或告警策略。</p>
        </div>

        <Card className="mt-8 overflow-hidden border-slate-200/80 bg-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.28)]">
          <CardContent className="p-0">
            {isLoading ? <div className="p-8 text-sm text-slate-400">正在加载任务…</div> : !tasks?.length ? (
              <div className="p-16 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700"><CircleAlert className="h-5 w-5" /></div>
                <p className="mt-4 text-sm font-semibold text-slate-700">从第一个站点开始</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">添加 URL、设置检查间隔，并可选择期望或禁止出现的页面文字。</p>
                <Button onClick={openCreate} variant="outline" className="mt-5 border-teal-200 text-teal-700 hover:bg-teal-50">新建监控任务</Button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Checkbox checked={allSelected} onCheckedChange={checked => toggleAllTasks(checked === true)} aria-label="全选监控任务" />
                    全选当前任务
                  </label>
                  {selectedCount > 0 && <span className="text-xs text-slate-400">已选择 {selectedCount} 个任务</span>}
                </div>
              <div className="divide-y divide-slate-100">
                {tasks.map(task => (
                  <div key={task.id} className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <Checkbox checked={selectedIds.has(task.id)} onCheckedChange={checked => toggleSelectedTask(task.id, checked === true)} aria-label={`选择监控任务：${task.name}`} className="mt-1.5 shrink-0" />
                      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${task.status === "up" ? "bg-emerald-500" : task.status === "unknown" ? "bg-slate-300" : "bg-rose-500"}`} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-slate-800">{task.name}</p>
                          {statusPill(task.status)}
                          {!task.enabled && <Badge variant="outline" className="border-slate-200 bg-white text-slate-400">已暂停</Badge>}
                        </div>
                        <a href={task.url} target="_blank" rel="noreferrer" className="mt-1.5 flex max-w-full items-center gap-1 truncate text-xs text-slate-400 hover:text-teal-700">
                          <span className="truncate">{task.url}</span><ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        {task.expectedContent && <ContentRule label="必须出现" value={task.expectedContent} />}
                        {task.forbiddenContent && <ContentRule label="禁止出现" value={task.forbiddenContent} compact={Boolean(task.expectedContent)} />}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:flex sm:items-center sm:gap-7 lg:min-w-[455px] lg:justify-end">
                      <div><p className="text-slate-400">检查频率</p><p className="mt-1 font-medium text-slate-700">每 {task.intervalMinutes} 分钟</p></div>
                      <div><p className="text-slate-400">告警策略</p><p className="mt-1 font-medium text-slate-700">{task.alertMode === "repeat" ? `每 ${task.repeatAlertMinutes} 分钟提醒` : "仅首次提醒"}</p></div>
                      <div><p className="text-slate-400">最近检查</p><p className="mt-1 font-medium text-slate-700">{formatDate(task.lastCheckedAt)}</p></div>
                      <div><p className="text-slate-400">下次检查</p><p className="mt-1 font-medium text-slate-700">{formatDate(task.nextCheckAt)}</p></div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button aria-label="立即检查" title="立即检查" onClick={() => runMutation.mutate({ id: task.id })} disabled={runMutation.isPending} variant="ghost" size="icon" className="text-slate-500 hover:bg-teal-50 hover:text-teal-700"><Play className="h-4 w-4" /></Button>
                      <Button aria-label="编辑任务" title="编辑任务" onClick={() => { setEditing(task); setDialogOpen(true); }} variant="ghost" size="icon" className="text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></Button>
                      <Button aria-label={task.enabled ? "暂停任务" : "启用任务"} title={task.enabled ? "暂停任务" : "启用任务"} onClick={() => enabledMutation.mutate({ id: task.id, enabled: !task.enabled })} variant="ghost" size="icon" className="text-slate-500 hover:bg-slate-100"><Power className="h-4 w-4" /></Button>
                      <Button aria-label="删除任务" title="删除任务" onClick={() => { if (confirm(`确定删除“${task.name}”吗？`)) deleteMutation.mutate({ id: task.id }); }} variant="ghost" size="icon" className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
              </div>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除已选择的 {selectedCount} 个监控任务？</AlertDialogTitle>
              <AlertDialogDescription>此操作会同时永久删除这些任务的检查历史和告警状态，且无法恢复。请确认后继续。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={batchDeleting}>取消</AlertDialogCancel>
              <AlertDialogAction onClick={event => { event.preventDefault(); batchDeleteMutation.mutate({ ids: Array.from(selectedIds) }); }} disabled={batchDeleting} className="bg-rose-600 hover:bg-rose-700">
                {batchDeleting ? "正在删除…" : "确认批量删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={dialogOpen} onOpenChange={open => !open && closeDialog()}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "编辑监控任务" : "新增监控任务"}</DialogTitle><DialogDescription>填写 URL、内容规则和告警策略。保存后可在任务列表中立即手动检查。</DialogDescription></DialogHeader>
            <div className="grid gap-5 py-2">
              <div className="grid gap-2"><Label htmlFor="task-name">任务名称</Label><Input id="task-name" placeholder="例如：官网首页" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="task-url">监控 URL</Label><Input id="task-url" placeholder="https://example.com" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} /><p className="text-xs text-slate-400">仅支持 HTTP 和 HTTPS 地址。</p></div>
              <div className="grid gap-2"><Label htmlFor="expected-content">必须出现的内容 <span className="font-normal text-slate-400">（可选）</span></Label><Textarea id="expected-content" rows={3} placeholder="例如：欢迎来到我们的网站" value={form.expectedContent} onChange={event => setForm({ ...form, expectedContent: event.target.value })} /><p className="text-xs text-slate-500">响应成功但不含此文字时，标记为内容不匹配。</p></div>
              <div className="grid gap-2"><Label htmlFor="forbidden-content">禁止出现的内容 <span className="font-normal text-slate-400">（可选）</span></Label><Textarea id="forbidden-content" rows={3} placeholder="例如：系统维护中；访问被拒绝" value={form.forbiddenContent} onChange={event => setForm({ ...form, forbiddenContent: event.target.value })} /><p className="text-xs text-slate-500">页面出现任一禁止内容将立即标记异常并发送告警；多个内容可用逗号、分号或换行分隔。</p></div>
              <div className="grid gap-2"><Label htmlFor="interval">检查间隔（分钟）</Label><Input id="interval" min="1" max="43200" type="number" value={form.intervalMinutes} onChange={event => setForm({ ...form, intervalMinutes: event.target.value })} /></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Label htmlFor="alert-mode">故障告警策略</Label><select id="alert-mode" value={form.alertMode} onChange={event => setForm({ ...form, alertMode: event.target.value as TaskForm["alertMode"] })} className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"><option value="once">仅首次提醒，恢复即时通知</option><option value="repeat">故障期间连续提醒，恢复即时通知</option></select>{form.alertMode === "repeat" && <div className="mt-3 grid gap-2"><Label htmlFor="repeat-interval" className="text-xs">连续提醒间隔（分钟）</Label><Input id="repeat-interval" min="1" max="43200" type="number" value={form.repeatAlertMinutes} onChange={event => setForm({ ...form, repeatAlertMinutes: event.target.value })} /></div>}<p className="mt-2 text-xs leading-5 text-slate-500">默认仅在首次故障告警。开启连续提醒后，只要异常未恢复，系统会按所设间隔再次提醒。</p></div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><div><p className="text-sm font-medium text-slate-700">启用监控</p><p className="mt-1 text-xs text-slate-400">关闭后系统不会再自动检查该任务。</p></div><Switch checked={form.enabled} onCheckedChange={enabled => setForm({ ...form, enabled })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={closeDialog}>取消</Button><Button onClick={save} disabled={saving} className="bg-[#0f766e] hover:bg-[#115e59]">{saving ? "正在保存…" : editing ? "保存修改" : "创建任务"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
