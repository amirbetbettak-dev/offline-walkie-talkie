import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Hash,
  LayoutGrid,
  MapPin,
  Mic,
  Network,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Smartphone,
  Users,
  Volume2,
  Wifi,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { SignalMeter } from "@/components/SignalMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRadio } from "@/hooks/use-radio";
import { CHANNEL_COUNT } from "@/lib/radio/protocol";
import { cn } from "@/lib/utils";

const TITLE = "bisim tak — بیسیم آفلاین";
const DESC = "بیسیم PTT آفلاین برای ارتباط صوتی از طریق وای‌فای و هات‌اسپات محلی بدون اینترنت.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const r = useRadio();
  const [wifiSheetOpen, setWifiSheetOpen] = useState(false);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [manualIp, setManualIp] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [newGroupNameInput, setNewGroupNameInput] = useState("");

  const numChannel = parseInt(r.channel, 10);
  const isNumeric = !isNaN(numChannel) && numChannel >= 1 && numChannel <= CHANNEL_COUNT;

  const sameChannelPeers = r.peers.filter((p) => {
    if (p.channel) return p.channel.trim().toLowerCase() === r.channel.trim().toLowerCase();
    return Math.abs(p.freq - r.freq) < 1e-6;
  });

  const discoveredPeer = r.peers[0] || (r.networkInfo?.knownPeers?.[0] ? {
    name: r.networkInfo.knownPeers[0].name,
    ip: r.networkInfo.knownPeers[0].ip,
    channel: r.networkInfo.knownPeers[0].channel,
  } : null);

  const isConnected = !!discoveredPeer || sameChannelPeers.length > 0;

  // Spacebar support for desktop testing
  const { pttDown, pttUp } = r;
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === "INPUT";
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typing(e)) {
        e.preventDefault();
        pttDown();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && !typing(e) && pttUp();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pttDown, pttUp]);

  return (
    <main className="bg-glow min-h-screen select-none bg-background text-foreground font-sans" dir="rtl">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-between gap-3 px-4 pt-4 pb-5">
        
        {/* Top Header */}
        <header className="flex items-center justify-between gap-2 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGroupSheetOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl border-primary/30 bg-primary/10 px-3 py-1.5 text-primary hover:bg-primary/20"
            >
              <Radio className="size-4" />
              <span className="font-bold text-xs tracking-wide">
                {r.groupName || (isNumeric ? `کانال ${r.channel}` : `گروه ${r.channel}`)}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setWifiSheetOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Wifi className="size-3.5 text-emerald-500" />
              <span>وای‌فای</span>
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Quick diagnostics button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDiagSheetOpen(true)}
              title="وضعیت زنده چهارگانه"
              className="size-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Activity className="size-4 text-cyan-400" />
            </Button>

            {/* Quick scan button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={r.scanNetwork}
              title="اسکن گوشی‌های هات‌اسپات"
              className="size-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-4" />
            </Button>

            <SettingsSheet r={r} />

            <Button
              size="icon"
              variant={r.power ? "default" : "secondary"}
              onClick={r.togglePower}
              aria-label={r.power ? "خاموش کردن" : "روشن کردن"}
              className={cn("size-8 rounded-full", r.power && "bg-emerald-600 hover:bg-emerald-500")}
            >
              <Power className="size-4" />
            </Button>
          </div>
        </header>

        {/* Live Peer Connection Banner */}
        {isConnected ? (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-400 animate-in fade-in duration-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
              <span className="font-semibold">اتصال یافت!</span>
              <span>{discoveredPeer?.name || "گوشی مقابل"}</span>
            </div>
            {discoveredPeer?.ip && (
              <span className="font-mono text-[11px] text-emerald-300/80" dir="ltr">
                {discoveredPeer.ip}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span>در حال جستجوی گوشی طرف مقابل…</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={r.scanNetwork}
              className="h-6 px-2 text-[11px] text-primary"
            >
              اسکن فوری
            </Button>
          </div>
        )}

        {/* 4-Part Live Telemetry Summary Card */}
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-card/70 p-2.5 text-xs shadow-sm">
          {/* 1. Socket */}
          <div className="flex flex-col gap-0.5 rounded-xl bg-background/50 p-2 border border-border/40">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Network className="size-3 text-emerald-400" />
                اتصال سوکت
              </span>
              <span className="size-1.5 rounded-full bg-emerald-400" />
            </div>
            <p className="font-mono text-[11px] text-foreground font-semibold truncate" dir="ltr">
              {r.networkInfo?.ip || "127.0.0.1"}:47474
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {r.networkInfo?.isHotspot ? "میزبان هات‌اسپات" : r.networkInfo?.ssid ? `وای‌فای: ${r.networkInfo.ssid}` : "متصل به هات‌اسپات"}
            </p>
          </div>

          {/* 2. Peer Discovery */}
          <div className="flex flex-col gap-0.5 rounded-xl bg-background/50 p-2 border border-border/40">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Users className="size-3 text-cyan-400" />
                گوشی مقابل
              </span>
              <span className={cn("size-1.5 rounded-full", isConnected ? "bg-emerald-400" : "bg-amber-400")} />
            </div>
            <p className="font-semibold text-[11px] text-foreground truncate">
              {isConnected ? (discoveredPeer?.name || "متصل شد ✓") : "یافت نشد"}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">
              {discoveredPeer?.ip || "اسکن شبکه…"}
            </p>
          </div>

          {/* 3. TX (Audio Sending) */}
          <div className="flex flex-col gap-0.5 rounded-xl bg-background/50 p-2 border border-border/40">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Mic className="size-3 text-emerald-400" />
                ارسال صدا (TX)
              </span>
              <span className={cn("text-[9px] font-mono", r.tx ? "text-emerald-400 font-bold" : "text-muted-foreground")}>
                {r.tx ? "درحال ضبط" : "آماده"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>بسته‌ها: {r.networkInfo?.txPackets ?? 0}</span>
              <span className={cn("text-[10px]", r.tx && "text-emerald-400")}>
                {r.tx ? `${Math.round(r.level * 100)}%` : "۰"}
              </span>
            </div>
          </div>

          {/* 4. RX (Audio Receiving) */}
          <div className="flex flex-col gap-0.5 rounded-xl bg-background/50 p-2 border border-border/40">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Volume2 className="size-3 text-cyan-400" />
                دریافت صدا (RX)
              </span>
              <span className={cn("text-[9px] font-mono", r.rx ? "text-cyan-400 font-bold" : "text-muted-foreground")}>
                {r.rx ? "درحال پخش" : "آماده"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>بسته‌ها: {r.networkInfo?.rxPackets ?? 0}</span>
              <span className={cn("text-[10px]", r.rx && "text-cyan-400")}>
                {r.networkInfo?.rxLevel ? `${r.networkInfo.rxLevel}%` : "۰"}
              </span>
            </div>
          </div>
        </div>

        {/* Main PTT Button Section */}
        <section className="flex flex-1 flex-col items-center justify-center gap-5 py-2">
          <div className="relative grid place-items-center">
            {/* Pulse rings when transmitting (green) or receiving (blue/cyan) */}
            {(r.tx || r.rx) && (
              <>
                <span
                  className={cn(
                    "ptt-ring absolute inset-0 rounded-full animate-ping duration-1000",
                    r.tx ? "bg-emerald-500/30" : "bg-cyan-500/30",
                  )}
                />
                <span
                  className={cn(
                    "ptt-ring absolute inset-0 rounded-full animate-pulse",
                    r.tx ? "bg-emerald-500/20" : "bg-cyan-500/20",
                  )}
                />
              </>
            )}

            <button
              type="button"
              aria-label="PTT — نگه دارید و صحبت کنید"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                r.pttDown();
              }}
              onPointerUp={r.pttUp}
              onPointerCancel={r.pttUp}
              onLostPointerCapture={r.pttUp}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "relative grid size-60 touch-none select-none place-items-center rounded-full border-4 transition-all duration-150 shadow-2xl active:scale-95",
                r.tx
                  ? "border-emerald-500 bg-emerald-500/20 shadow-emerald-500/40"
                  : r.rx
                    ? "border-cyan-400 bg-cyan-500/20 shadow-cyan-500/40"
                    : "border-primary/40 bg-card hover:border-primary/70",
              )}
            >
              <div className="flex flex-col items-center gap-2.5">
                <div
                  className={cn(
                    "grid size-20 place-items-center rounded-full transition-colors",
                    r.tx
                      ? "bg-emerald-500 text-white"
                      : r.rx
                        ? "bg-cyan-500 text-white"
                        : "bg-primary/10 text-primary",
                  )}
                >
                  <Mic className="size-10" />
                </div>
                <span className="font-display text-2xl font-black tracking-widest text-foreground">
                  {r.tx ? "در حال صحبت" : r.rx ? "دریافت صدا" : "PTT"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {r.tx ? "برای پایان رها کنید" : "نگه دارید و صحبت کنید"}
                </span>
              </div>
            </button>
          </div>

          <div className="flex h-9 flex-col items-center gap-1 text-center">
            <p className={cn("text-xs font-semibold", r.tx ? "text-emerald-400" : r.rx ? "text-cyan-400" : "text-muted-foreground")}>
              {r.error ??
                r.notice ??
                (r.tx ? "صدای شما مستقیم ارسال می‌شود…" : r.rx ? `${r.rx} در حال صحبت است` : "آماده برای مکالمه")}
            </p>
            <span className={cn(r.tx ? "text-emerald-400" : "text-cyan-400", !(r.tx || r.rx) && "opacity-0")}>
              <SignalMeter txLevel={r.level} tx={r.tx} getAnalyser={r.analyser} />
            </span>
          </div>
        </section>

        {/* Quick Connection Action Bar */}
        <section className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => setWifiSheetOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border-border bg-card/80 py-4 text-xs font-semibold hover:bg-card"
          >
            <Wifi className="size-4 text-emerald-400" />
            <span>راه‌های ارتباط وای‌فای</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => setGroupSheetOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border-border bg-card/80 py-4 text-xs font-semibold hover:bg-card"
          >
            <Users className="size-4 text-primary" />
            <span>ایجاد و جستجوی گروه</span>
          </Button>
        </section>

        {/* 1. Wi-Fi Manager Sheet */}
        <Sheet open={wifiSheetOpen} onOpenChange={setWifiSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-5 max-h-[85vh] overflow-y-auto" dir="rtl">
            <SheetHeader className="text-right pb-3 border-b border-border/40">
              <SheetTitle className="text-base font-bold flex items-center gap-2">
                <Wifi className="size-5 text-emerald-400" />
                راه‌های ارتباط با وای‌فای و هات‌اسپات
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 pt-3">
              {/* Current Network Status Card */}
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-1">
                <p className="font-semibold text-xs text-emerald-400">شبکه فعلی دستگاه شما:</p>
                <div className="flex items-center justify-between text-xs text-foreground">
                  <span>نام وای‌فای / هات‌اسپات:</span>
                  <span className="font-bold">{r.networkInfo?.ssid || "نقطه اتصال محلی"}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground font-mono" dir="ltr">
                  <span>آی‌پی محلی: {r.networkInfo?.ip || "127.0.0.1"}</span>
                  <span>{r.networkInfo?.isHotspot ? "(میزبان هات‌اسپات)" : "(کلاینت)"}</span>
                </div>
              </div>

              {/* Big Action: Open Android Wi-Fi Settings */}
              <div className="space-y-2">
                <Button
                  onClick={r.openWifiSettings}
                  className="w-full rounded-2xl bg-primary text-primary-foreground font-bold text-xs py-5 flex items-center justify-center gap-2 shadow-lg"
                >
                  <Wifi className="size-4" />
                  باز کردن مستقیم تنظیمات وای‌فای گوشی
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  برای اتصال به نقطه اتصال (هات‌اسپات) گوشی طرف مقابل، روی دکمه بالا بزنید.
                </p>
              </div>

              {/* Scan Nearby Wi-Fi / Hotspots */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">وای‌فای‌ها و هات‌اسپات‌های اطراف:</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={r.scanWifi}
                    disabled={r.isScanningWifi}
                    className="h-7 text-xs rounded-xl gap-1"
                  >
                    <RefreshCw className={cn("size-3", r.isScanningWifi && "animate-spin")} />
                    اسکن اطراف
                  </Button>
                </div>

                {r.wifiList.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    برای مشاهده لیست شبکه‌ها و هات‌اسپات‌های اطراف، روی «اسکن اطراف» بزنید.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {r.wifiList.map((net, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl bg-card p-2.5 text-xs border border-border/50"
                      >
                        <div className="flex items-center gap-2">
                          <Wifi className="size-3.5 text-primary" />
                          <span className="font-semibold">{net.ssid}</span>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                          {net.level} dBm
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual IP fallback */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-2">
                <Label className="text-xs font-semibold text-foreground">
                  اتصال دستی با آی‌پی (در صورت عدم کشف خودکار):
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="مثال: 192.168.43.1"
                    className="font-mono text-xs"
                    dir="ltr"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (manualIp.trim()) {
                        r.addPeerManual(manualIp.trim());
                        setManualIp("");
                        setWifiSheetOpen(false);
                      }
                    }}
                    className="shrink-0 text-xs rounded-xl"
                  >
                    اتصال به IP
                  </Button>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* 2. Group & Signal Sheet */}
        <Sheet open={groupSheetOpen} onOpenChange={setGroupSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-5 max-h-[85vh] overflow-y-auto" dir="rtl">
            <SheetHeader className="text-right pb-3 border-b border-border/40">
              <SheetTitle className="text-base font-bold flex items-center gap-2">
                <Users className="size-5 text-primary" />
                ارتباط سیگنالی و ایجاد گروه
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 pt-3">
              {/* Current Group Banner */}
              <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3.5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">گروه فعلی شما:</p>
                  <p className="font-bold text-sm text-foreground">{r.groupName || `گروه ${r.channel}`}</p>
                </div>
                <div className="text-left font-mono">
                  <span className="text-[10px] text-muted-foreground">کد گروه:</span>
                  <p className="font-black text-primary text-base" dir="ltr">{r.channel}</p>
                </div>
              </div>

              {/* Create Group Box */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-2.5">
                <Label className="text-xs font-semibold text-foreground">ایجاد گروه جدید:</Label>
                <div className="flex gap-2">
                  <Input
                    value={newGroupNameInput}
                    onChange={(e) => setNewGroupNameInput(e.target.value)}
                    placeholder="نام گروه (اختیاری)"
                    className="text-xs"
                  />
                  <Button
                    onClick={() => {
                      const code = r.createGroup(newGroupNameInput);
                      setNewGroupNameInput("");
                    }}
                    className="shrink-0 rounded-xl text-xs gap-1"
                  >
                    <Plus className="size-3.5" />
                    ایجاد گروه
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  با ایجاد گروه، یک کد ۴ رقمی اختصاصی تولید می‌شود که بقیه می‌توانند با آن به شما متصل شوند.
                </p>
              </div>

              {/* Search & Join Group Box */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-3">
                <Label className="text-xs font-semibold text-foreground">جستجو و ورود به گروه با کد:</Label>
                <div className="flex gap-2">
                  <Input
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    placeholder="کد ۴ رقمی گروه طرف مقابل را وارد کنید"
                    className="text-xs font-mono"
                    dir="ltr"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (groupSearchQuery.trim()) {
                        r.joinGroup(groupSearchQuery.trim());
                        setGroupSearchQuery("");
                        setGroupSheetOpen(false);
                      }
                    }}
                    className="shrink-0 rounded-xl text-xs"
                  >
                    ورود به گروه
                  </Button>
                </div>

                {/* Discovered Active Groups Nearby */}
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">گروه‌های فعال پیدا شده در شبکه:</p>
                  {r.groups.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70 text-center py-2">
                      هنوز گروهی در شبکه پخش نشده است.
                    </p>
                  ) : (
                    r.groups.map((g) => (
                      <div
                        key={g.code}
                        className="flex items-center justify-between rounded-xl bg-card p-2.5 text-xs border border-border/50"
                      >
                        <div>
                          <p className="font-bold text-foreground">{g.name}</p>
                          <p className="text-[10px] text-muted-foreground">میزبان: {g.hostName}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            r.joinGroup(g.code, g.name);
                            setGroupSheetOpen(false);
                          }}
                          className="h-7 rounded-xl text-xs"
                        >
                          پیوستن
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* 3. Detailed 4-Part Diagnostics Modal */}
        <Sheet open={diagSheetOpen} onOpenChange={setDiagSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-5 max-h-[85vh] overflow-y-auto" dir="rtl">
            <SheetHeader className="text-right pb-3 border-b border-border/40">
              <SheetTitle className="text-base font-bold flex items-center gap-2">
                <Activity className="size-5 text-cyan-400" />
                وضعیت زنده چهارگانه و عیب‌یابی ارتباط
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-3.5 pt-3 text-xs">
              {/* Item 1: Socket */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Network className="size-4 text-emerald-400" />
                    ۱. وضعیت اتصال سوکت و شبکه
                  </span>
                  <span className="text-emerald-400">متصل (Port 47474)</span>
                </div>
                <div className="text-muted-foreground space-y-0.5 font-mono text-[11px]" dir="ltr">
                  <div>Local IP: {r.networkInfo?.ip || "127.0.0.1"}</div>
                  <div>SSID: {r.networkInfo?.ssid || "Hotspot"}</div>
                  <div>Socket Bound: {r.networkInfo?.socketBound ? "YES" : "NO"}</div>
                </div>
              </div>

              {/* Item 2: Peer Discovery */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-4 text-cyan-400" />
                    ۲. پیدا شدن گوشی مقابل
                  </span>
                  <span className={isConnected ? "text-emerald-400" : "text-amber-400"}>
                    {isConnected ? "پیدا شد ✓" : "در حال جستجو"}
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  تعداد گوشی‌های پیدا شده: {r.peers.length}
                </p>
                {discoveredPeer && (
                  <div className="rounded-xl bg-card p-2 border border-border/50 text-[11px] font-mono" dir="ltr">
                    Peer: {discoveredPeer.name} ({discoveredPeer.ip})
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={r.scanNetwork} className="w-full text-xs rounded-xl mt-1">
                  اسکن مجدد تمام آی‌پی‌ها (Subnet Sweep)
                </Button>
              </div>

              {/* Item 3: Audio TX */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Mic className="size-4 text-emerald-400" />
                    ۳. ارسال صدا (TX)
                  </span>
                  <span className={r.tx ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                    {r.tx ? "در حال ارسال PTT" : "آماده"}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground font-mono text-[11px]" dir="ltr">
                  <span>TX Packets: {r.networkInfo?.txPackets ?? 0}</span>
                  <span>Bytes: {r.networkInfo?.txBytes ?? 0}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-[11px]">
                  <span>ولوم میکروفون:</span>
                  <span className="font-mono">{Math.round(r.level * 100)}%</span>
                </div>
              </div>

              {/* Item 4: Audio RX */}
              <div className="rounded-2xl border border-border bg-background/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="size-4 text-cyan-400" />
                    ۴. دریافت صدا (RX)
                  </span>
                  <span className={r.rx ? "text-cyan-400 font-bold" : "text-muted-foreground"}>
                    {r.rx ? "در حال پخش صدا" : "آماده"}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground font-mono text-[11px]" dir="ltr">
                  <span>RX Packets: {r.networkInfo?.rxPackets ?? 0}</span>
                  <span>Bytes: {r.networkInfo?.rxBytes ?? 0}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-[11px]">
                  <span>آخرین فرستنده:</span>
                  <span className="font-semibold text-foreground">{r.rx || r.networkInfo?.lastRxSender || "هیچ‌کس"}</span>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

      </div>
    </main>
  );
}

function SettingsSheet({ r }: { r: ReturnType<typeof useRadio> }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8 rounded-full text-muted-foreground hover:text-foreground" aria-label="تنظیمات">
          <Settings2 className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-6" dir="rtl">
        <SheetHeader className="pr-2 pb-4">
          <SheetTitle className="text-right">تنظیمات bisim tak</SheetTitle>
        </SheetHeader>
        <div className="mx-auto w-full max-w-md space-y-5">
          <Field label="نام نمایشی شما در شبکه">
            <Input value={r.name} maxLength={20} onChange={(e) => r.setName(e.target.value)} />
          </Field>
          <Field label="بلندی صدای بلندگو">
            <Slider value={[r.volume * 100]} max={100} step={1} onValueChange={([v]) => r.setVolume((v ?? 0) / 100)} />
          </Field>
          <div className="flex items-center justify-between pt-2">
            <div>
              <Label htmlFor="fx">افکت رادیویی بیسیم</Label>
              <p className="text-xs text-muted-foreground">صدای طبیعی بیسیم با نویز پایان مکالمه (Roger)</p>
            </div>
            <Switch id="fx" dir="ltr" checked={r.effect} onCheckedChange={r.setEffect} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
