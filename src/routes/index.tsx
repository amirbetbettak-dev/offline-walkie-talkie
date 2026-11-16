import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  LayoutGrid,
  Mic,
  MapPin,
  Power,
  RefreshCw,
  Search,
  Settings2,
  Smartphone,
  Users,
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
import { CHANNEL_COUNT, channelFrequency, frequencyChannel } from "@/lib/radio/protocol";
import { cn } from "@/lib/utils";

const TITLE = "بیسیم — Two Way Walkie Talkie";
const DESC = "بیسیم PTT آفلاین برای ارتباط صوتی از طریق وای‌فای و هات‌اسپات محلی بدون اینترنت.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: Index,
});

const STATUS_TEXT = {
  online: "متصل به وای‌فای / هات‌اسپات",
  connecting: "در حال اتصال به شبکه…",
  offline: "خاموش",
  unsupported: "در برنامه اندروید باز شود",
} as const;

function Index() {
  const r = useRadio();
  const [channelSheetOpen, setChannelSheetOpen] = useState(false);
  const [manualIp, setManualIp] = useState("");

  const numChannel = parseInt(r.channel, 10);
  const isNumeric = !isNaN(numChannel) && numChannel >= 1 && numChannel <= CHANNEL_COUNT;

  const sameChannelPeers = r.peers.filter((p) => {
    if (p.channel) return p.channel.trim().toLowerCase() === r.channel.trim().toLowerCase();
    return Math.abs(p.freq - r.freq) < 1e-6;
  });

  const stepChannel = (d: number) => {
    const cur = isNumeric ? numChannel : 1;
    const next = (((cur - 1 + d + CHANNEL_COUNT) % CHANNEL_COUNT) + 1).toString();
    r.setChannel(next);
  };

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

  const statusTone =
    r.status === "online" ? "bg-emerald-500 shadow-emerald-500/50" : r.status === "connecting" ? "bg-amber-500" : "bg-muted-foreground";

  return (
    <main className="bg-glow min-h-screen select-none bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-between gap-4 px-5 pt-6 pb-6">
        {/* Top Header - Two Way style */}
        <header className="flex items-center justify-between gap-2 border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChannelSheetOpen(true)}
              className="flex items-center gap-2 rounded-2xl border-primary/30 bg-primary/10 px-3 py-2 text-primary hover:bg-primary/20"
            >
              <LayoutGrid className="size-4" />
              <span className="font-bold text-sm tracking-wide">
                {r.channel === "wifi" ? "کانال عمومی وای‌فای" : isNumeric ? `کانال ${r.channel}` : r.channel}
              </span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick scan button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={r.scanNetwork}
              title="اسکن گوشی‌های هات‌اسپات"
              className="size-9 rounded-full text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-4" />
            </Button>

            <SettingsSheet r={r} />

            <Button
              size="icon"
              variant={r.power ? "default" : "secondary"}
              onClick={r.togglePower}
              aria-label={r.power ? "خاموش کردن" : "روشن کردن"}
              className={cn("size-9 rounded-full", r.power && "bg-emerald-600 hover:bg-emerald-500")}
            >
              <Power className="size-4" />
            </Button>
          </div>
        </header>

        {/* Network & IP status pill */}
        <div className="flex items-center justify-between rounded-2xl bg-card/60 px-4 py-2 border border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full shadow-sm", r.power ? statusTone : "bg-muted-foreground")} />
            <span>{r.power ? STATUS_TEXT[r.status] : "بیسیم خاموش است"}</span>
          </div>
          {r.networkInfo?.ip && (
            <span className="font-mono text-foreground font-semibold" dir="ltr">
              IP: {r.networkInfo.ip} {r.networkInfo.isHotspot && "(هات‌اسپات)"}
            </span>
          )}
        </div>

        {!r.native && (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
            <Smartphone className="size-4 shrink-0" />
            <p>در فایل نصبی اندروید، ارتباط از طریق هات‌اسپات و وای‌فای آفلاین کار می‌کند.</p>
          </div>
        )}

        {/* Main PTT Button Section - Two Way Clean Style */}
        <section className="flex flex-1 flex-col items-center justify-center gap-6 py-4">
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
                "relative grid size-64 touch-none select-none place-items-center rounded-full border-4 transition-all duration-150 shadow-2xl active:scale-95",
                r.tx
                  ? "border-emerald-500 bg-emerald-500/20 shadow-emerald-500/40"
                  : r.rx
                    ? "border-cyan-400 bg-cyan-500/20 shadow-cyan-500/40"
                    : "border-primary/40 bg-card hover:border-primary/70",
              )}
            >
              <div className="flex flex-col items-center gap-3">
                <div
                  className={cn(
                    "grid size-24 place-items-center rounded-full transition-colors",
                    r.tx
                      ? "bg-emerald-500 text-white"
                      : r.rx
                        ? "bg-cyan-500 text-white"
                        : "bg-primary/10 text-primary",
                  )}
                >
                  <Mic className="size-12" />
                </div>
                <span className="font-display text-2xl font-black tracking-widest text-foreground">
                  {r.tx ? "در حال صحبت" : r.rx ? "دریافت صدا" : "PTT"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.tx ? "برای پایان رها کنید" : "نگه دارید و صحبت کنید"}
                </span>
              </div>
            </button>
          </div>

          <div className="flex h-10 flex-col items-center gap-1.5 text-center">
            <p className={cn("text-sm font-semibold", r.tx ? "text-emerald-400" : r.rx ? "text-cyan-400" : "text-muted-foreground")}>
              {r.error ??
                r.notice ??
                (r.tx ? "صدای شما برای همه ارسال می‌شود…" : r.rx ? `${r.rx} در حال صحبت است` : "آماده برای مکالمه")}
            </p>
            <span className={cn(r.tx ? "text-emerald-400" : "text-cyan-400", !(r.tx || r.rx) && "opacity-0")}>
              <SignalMeter txLevel={r.level} tx={r.tx} getAnalyser={r.analyser} />
            </span>
          </div>
        </section>

        {/* Bottom Station / Channel Section */}
        <section className="rounded-3xl border border-border bg-card/90 p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-sm font-semibold">دستگاه‌های این کانال</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground font-mono">
                {sameChannelPeers.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChannelSheetOpen(true)}
              className="h-8 rounded-xl text-xs gap-1"
            >
              <Wifi className="size-3.5" />
              تغییر کانال
            </Button>
          </div>

          {sameChannelPeers.length === 0 ? (
            <div className="pt-3 text-center">
              <p className="text-xs text-muted-foreground">
                هنوز گوشی دیگری به این کانال متصل نشده است.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                گوشی دوم را به هات‌اسپات وصل کنید و برنامه را باز کنید.
              </p>
            </div>
          ) : (
            <ul className="flex flex-wrap gap-2 pt-3">
              {sameChannelPeers.map((p) => (
                <li
                  key={p.id}
                  className={cn(
                    "flex items-center gap-2 rounded-2xl bg-secondary/80 px-3 py-1.5 text-xs font-medium border border-border/50",
                    r.rx?.includes(p.name) && "border-cyan-500 bg-cyan-500/10 text-cyan-300",
                  )}
                >
                  <span className="grid size-6 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {p.name.trim().charAt(0) || "؟"}
                  </span>
                  <span>{p.name}</span>
                  {p.ip && <span className="font-mono text-[10px] text-muted-foreground">({p.ip})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Join Channel Sheet - Two Way Style Modal */}
        <Sheet open={channelSheetOpen} onOpenChange={setChannelSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-6" dir="rtl">
            <SheetHeader className="text-right pb-4">
              <SheetTitle className="text-lg font-bold">انتخاب و اتصال به کانال</SheetTitle>
            </SheetHeader>

            <div className="space-y-4">
              {/* Channel name input */}
              <div className="space-y-1.5">
                <Label htmlFor="channelName" className="text-xs text-muted-foreground">
                  نام یا شماره کانال (عددی یا الفبایی)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="channelName"
                    value={r.channel}
                    onChange={(e) => r.setChannel(e.target.value)}
                    placeholder="مثال: 1 یا bisim یا wifi"
                    className="font-medium"
                  />
                  <Button
                    onClick={() => setChannelSheetOpen(false)}
                    className="rounded-xl px-5"
                  >
                    پیوستن
                  </Button>
                </div>
              </div>

              {/* Two Way Style Big Action Cards */}
              <div className="grid gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    r.setChannel("wifi");
                    r.scanNetwork();
                    setChannelSheetOpen(false);
                  }}
                  className="flex items-center justify-between rounded-2xl border border-primary/40 bg-primary/10 p-4 text-right transition-colors hover:bg-primary/20"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                      <Wifi className="size-5" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-foreground">اتصال به کانال وای‌فای (Wi-Fi Channel)</p>
                      <p className="text-xs text-muted-foreground">گفتگو با تمام گوشی‌های متصل به همین نقطه اتصال یا مودم</p>
                    </div>
                  </div>
                  <ChevronLeft className="size-5 text-primary" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    r.setChannel("1");
                    setChannelSheetOpen(false);
                  }}
                  className="flex items-center justify-between rounded-2xl border border-border bg-secondary/50 p-4 text-right transition-colors hover:bg-secondary"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-secondary text-foreground">
                      <MapPin className="size-5" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-foreground">کانال عمومی محلی (Local Channel 1)</p>
                      <p className="text-xs text-muted-foreground">کانال پیش‌فرض شماره ۱ برای ارتباط سریع</p>
                    </div>
                  </div>
                  <ChevronLeft className="size-5 text-muted-foreground" />
                </button>
              </div>

              {/* Direct IP Connect Option */}
              <div className="rounded-2xl border border-border/80 bg-background/50 p-4 space-y-2">
                <Label className="text-xs font-semibold text-foreground">
                  اتصال مستقیم با IP گوشی مقابل (در صورت نیاز)
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
                        setChannelSheetOpen(false);
                      }
                    }}
                    className="shrink-0 text-xs"
                  >
                    اتصال به IP
                  </Button>
                </div>
                {r.networkInfo?.ip && (
                  <p className="text-[11px] text-muted-foreground">
                    آی‌پی این گوشی: <span className="font-mono text-foreground font-bold">{r.networkInfo.ip}</span>
                  </p>
                )}
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
        <Button size="icon" variant="ghost" className="size-9 rounded-full text-muted-foreground hover:text-foreground" aria-label="تنظیمات">
          <Settings2 className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl border-border bg-card p-6" dir="rtl">
        <SheetHeader className="pr-2 pb-4">
          <SheetTitle className="text-right">تنظیمات بیسیم</SheetTitle>
        </SheetHeader>
        <div className="mx-auto w-full max-w-md space-y-5">
          <Field label="نام نمایشی شما">
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
