import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { Activity, BellRing, Clock3, LayoutDashboard, LogOut, PanelLeft, RadioTower, Settings2 } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "状态总览", path: "/" },
  { icon: RadioTower, label: "监控任务", path: "/monitors" },
  { icon: Clock3, label: "检查历史", path: "/history" },
  { icon: Settings2, label: "通知与调度", path: "/settings" },
];

const SIDEBAR_WIDTH_KEY = "site-monitor-sidebar-width";
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString()), [sidebarWidth]);
  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [loading, setLocation, user]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <DashboardLayoutSkeleton />;

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (width: number) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const width = event.clientX - left;
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) setSidebarWidth(width);
    };
    const up = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const active = menuItems.find(item => item.path === location) ?? menuItems[0];
  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-slate-200/75 bg-white" disableTransition={isResizing}>
          <SidebarHeader className="h-[88px] justify-center px-3">
            <div className="flex items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center">
              <button onClick={() => setIsResizing(false)} className="sr-only" aria-hidden="true" />
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0f766e] text-white shadow-lg shadow-teal-900/15"><Activity className="h-[18px] w-[18px]" /></div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="font-semibold leading-none text-slate-900">Sentinel</p><p className="mt-1.5 text-[11px] font-medium tracking-[0.16em] text-teal-700">SITE MONITOR</p></div>
            </div>
          </SidebarHeader>
          <SidebarContent className="gap-0 px-2">
            <p className="px-3 pb-2 pt-2 text-[10px] font-semibold tracking-[0.14em] text-slate-400 group-data-[collapsible=icon]:hidden">工作空间</p>
            <SidebarMenu>
              {menuItems.map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton isActive={location === item.path} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-11 rounded-xl text-slate-600 data-[active=true]:bg-teal-50 data-[active=true]:text-teal-800 data-[active=true]:font-medium hover:bg-slate-50">
                    <item.icon className="h-[18px] w-[18px]" /><span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <div className="mx-3 mt-8 rounded-2xl bg-gradient-to-br from-[#f0fdfa] to-[#ecfeff] p-3.5 group-data-[collapsible=icon]:hidden">
              <BellRing className="h-4 w-4 text-teal-700" /><p className="mt-2 text-xs font-semibold text-slate-700">一次故障，一次告警</p><p className="mt-1 text-[11px] leading-4 text-slate-500">连续异常不会重复发送邮件，恢复后自动通知。</p>
            </div>
          </SidebarContent>
          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-slate-50 group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
                  <Avatar className="h-8 w-8 border border-slate-200"><AvatarFallback className="bg-slate-100 text-xs font-semibold text-slate-600">{user?.name?.charAt(0).toUpperCase() ?? "U"}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-slate-700">{user?.name || "用户"}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{user?.email || "已登录"}</p></div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />退出登录</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div className="absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition-colors hover:bg-teal-500/20" onMouseDown={() => setIsResizing(true)} />
      </div>
      <SidebarInset className="bg-[#f7f9fc]">
        {isMobile && <div className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur"><SidebarTrigger className="h-9 w-9 rounded-lg" /><span className="font-semibold text-slate-800">{active.label}</span></div>}
        <main className="min-h-screen p-4 sm:p-7 lg:p-9">{children}</main>
      </SidebarInset>
    </>
  );
}
