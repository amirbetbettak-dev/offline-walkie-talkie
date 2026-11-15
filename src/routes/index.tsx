import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Minus, Plus, Power, Radio, Users, Wifi, WifiOff } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { SignalMeter } from "@/components/SignalMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRadio } from "@/hooks/use-radio";
import { CHANNEL_COUNT, channelFrequency, frequencyChannel, tune } from "@/lib/radio/protocol";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "بیسیم آفلاین — ارتباط بدون اینترنت" },
      { name: "description", content: "بیسیم Push-to-Talk روی وای‌فای و هات‌اسپات محلی، با کانال، فرکانس و افکت رادیویی." },
      { property: "og:title", content: "بیسیم آفلاین — ارتباط بدون اینترنت" },
      { property: "og:description", content: "بیسیم Push-to-Talk روی وای‌فای و هات‌اسپات محلی، با کانال، فرکانس و افکت رادیویی." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const r = useRadio();
  const channel = frequencyChannel(r.freq);
  const onAir = r.peers.filter((p) => Math.abs(p.freq - r.freq) < 1e-6);

  const stepChannel = (d: number) => {
    const cur = channel ?? 1;
    const next = ((cur - 1 + d + CHANNEL_COUNT) % CHANNEL_COUNT) + 1;
    r.setFreq(channelFrequency(next));
  };

  // Hold Space to talk
  const { pttDown, pttUp } = r;
  useEffect(() => {
    const isField = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === "INPUT";
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isField(e)) {
        e.preventDefault();
        pttDown();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isField(e)) pttUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pttDown, pttUp]);

  const state = !r.power ? "OFF" : r.tx ? "TX" : r.rx ? "RX" : "STBY";

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[380px_1fr]">
        {/* Radio body */}
        <section aria-label="بیسیم" className="relative mx-auto w-full max-w-[380px] pt-16">
          <div className="absolute top-0 left-12 h-20 w-5 rounded-t-full border border-border bg-secondary" />
          <div className="rounded-[2rem] border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Led on={r.power} className="bg-primary" label="روشن" />
                <Led on={r.tx} className="bg-tx" label="ارسال" />
                <Led on={!!r.rx} className="bg-rx" label="دریافت" />
              </div>
              <Button
                size="icon"
                variant={r.power ? "default" : "secondary"}
                onClick={r.togglePower}
                aria-label={r.power ? "خاموش کردن" : "روشن کردن"}
                className="rounded-full"
              >
                <Power />
              </Button>
            </div>

            {/* LCD */}
            <div
              className={cn(
                "lcd-glow rounded-xl bg-lcd p-4 font-lcd text-lcd-foreground transition-opacity",
                !r.power && "opacity-40",
              )}
              dir="ltr"
            >
              <div className="flex items-center justify-between text-sm">
                <span>CH {channel ? String(channel).padStart(2, "0") : "--"}</span>
                <span className="flex items-center gap-1">
                  {r.status === "online" ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
                  {r.mode === "lan" ? "LAN" : "SIM"}
                </span>
                <span className={cn("rounded px-1", (state === "TX" || state === "RX") && "bg-lcd-foreground text-lcd")}>
                  {state}
                </span>
              </div>
              <div className="my-2 text-4xl tracking-wider">{r.freq.toFixed(5)}</div>
              <div className="flex items-end justify-between text-sm">
                <span className="truncate" dir="auto">
                  {r.notice ?? (r.tx ? "▲ " + r.name : r.rx ? "▼ " + r.rx : `${onAir.length} on ch`)}
                </span>
                <SignalMeter txLevel={r.level} tx={r.tx} getAnalyser={r.analyser} />
              </div>
            </div>

            {/* Tuning */}
            <div className="mt-4 grid grid-cols-2 gap-3" dir="ltr">
              <Control label="کانال" onDec={() => stepChannel(-1)} onInc={() => stepChannel(1)} decIcon={<ChevronLeft />} incIcon={<ChevronRight />} />
              <Control label="فرکانس" onDec={() => r.setFreq(tune(r.freq, -1))} onInc={() => r.setFreq(tune(r.freq, 1))} decIcon={<Minus />} incIcon={<Plus />} />
            </div>

            {/* PTT */}
            <button
              type="button"
              disabled={!r.power}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                r.pttDown();
              }}
              onPointerUp={r.pttUp}
              onPointerCancel={r.pttUp}
              onLostPointerCapture={r.pttUp}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "mt-5 flex aspect-square w-full touch-none select-none flex-col items-center justify-center gap-2 rounded-full border-4 border-border bg-secondary text-secondary-foreground transition-all disabled:opacity-40",
                r.tx && "ptt-tx scale-[0.97] bg-tx text-destructive-foreground",
                !!r.rx && !r.tx && "border-rx",
              )}
            >
              <Radio className="size-12" />
              <span className="text-2xl font-extrabold">PTT</span>
              <span className="text-sm opacity-80">
                {!r.power ? "اول بیسیم را روشن کنید" : r.tx ? "در حال ارسال…" : "نگه دارید و صحبت کنید"}
              </span>
            </button>

            <div className="grille mt-5 h-14 rounded-xl bg-secondary" aria-hidden />
          </div>
          {r.error && <p className="mt-3 text-center text-sm text-destructive">{r.error}</p>}
        </section>

        {/* Panel */}
        <section className="space-y-5">
          <header>
            <h1 className="text-3xl font-extrabold">بیسیم آفلاین</h1>
            <p className="mt-1 text-muted-foreground">
              ارتباط صوتی بدون اینترنت روی وای‌فای یا هات‌اسپات محلی. دکمه PTT (یا کلید Space) را نگه دارید و صحبت کنید.
            </p>
          </header>

          <Panel title="کانال‌ها">
            <div className="grid grid-cols-8 gap-2" dir="ltr">
              {Array.from({ length: CHANNEL_COUNT }, (_, i) => i + 1).map((ch) => (
                <Button
                  key={ch}
                  size="sm"
                  variant={channel === ch ? "default" : "secondary"}
                  onClick={() => r.setFreq(channelFrequency(ch))}
                  className="font-lcd"
                >
                  {ch}
                </Button>
              ))}
            </div>
          </Panel>

          <Panel title="تنظیمات">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">نام ایستگاه</Label>
                <Input id="name" value={r.name} maxLength={20} onChange={(e) => r.setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>نوع اتصال</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={r.mode === "local" ? "default" : "secondary"} onClick={() => r.setMode("local")}>
                    شبیه‌سازی
                  </Button>
                  <Button variant={r.mode === "lan" ? "default" : "secondary"} onClick={() => r.setMode("lan")}>
                    وای‌فای محلی
                  </Button>
                </div>
              </div>
              {r.mode === "lan" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="relay">آدرس دستگاه میزبان در شبکه</Label>
                  <Input id="relay" dir="ltr" value={r.relayUrl} onChange={(e) => r.setRelayUrl(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    روی یک دستگاه متصل به همان وای‌فای/هات‌اسپات، برنامه میزبان (پوشه relay) را اجرا کنید و آدرس آن را اینجا بنویسید.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>بلندی صدا</Label>
                <Slider value={[r.volume * 100]} max={100} step={1} onValueChange={([v]) => r.setVolume(v / 100)} />
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-1">
                <Label htmlFor="fx">افکت صدای رادیویی</Label>
                <Switch id="fx" checked={r.effect} onCheckedChange={r.setEffect} />
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <div>
                  <Label htmlFor="echo">ایستگاه مجازی (تست با یک دستگاه)</Label>
                  <p className="text-xs text-muted-foreground">بعد از رها کردن PTT، صدای شما از طرف ایستگاه مجازی برمی‌گردد.</p>
                </div>
                <Switch id="echo" checked={r.echo} onCheckedChange={r.setEcho} />
              </div>
            </div>
          </Panel>

          <Panel title={`ایستگاه‌ها (${r.peers.length})`} icon={<Users className="size-4" />}>
            {r.peers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {r.power ? "هنوز ایستگاه دیگری پیدا نشده." : "بیسیم را روشن کنید."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {r.peers.map((p) => {
                  const same = Math.abs(p.freq - r.freq) < 1e-6;
                  return (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", same ? "bg-rx" : "bg-muted-foreground")} />
                        {p.name}
                      </span>
                      <span className="font-lcd text-muted-foreground" dir="ltr">
                        {p.freq.toFixed(5)} {same && "• هم‌کانال"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="راهنمای تست">
            <ol className="list-decimal space-y-1 pr-5 text-sm text-muted-foreground">
              <li>حالت «شبیه‌سازی»: این صفحه را در دو زبانه یا دو پنجره باز کنید، هر دو را روشن و روی یک کانال بگذارید.</li>
              <li>برای تست با یک صفحه، «ایستگاه مجازی» را روشن کنید.</li>
              <li>حالت «وای‌فای محلی»: همه گوشی‌ها به یک هات‌اسپات وصل شوند و آدرس میزبان را وارد کنند.</li>
            </ol>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Led({ on, className, label }: { on: boolean; className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2.5 rounded-full transition-opacity", className, on ? "opacity-100 shadow-[0_0_8px_currentColor]" : "opacity-20")} />
      {label}
    </span>
  );
}

function Control(props: { label: string; onDec: () => void; onInc: () => void; decIcon: ReactNode; incIcon: ReactNode }) {
  return (
    <div className="rounded-xl bg-secondary p-2 text-center">
      <div className="mb-1 text-xs text-muted-foreground">{props.label}</div>
      <div className="flex justify-between">
        <Button size="icon" variant="ghost" onClick={props.onDec} aria-label={props.label + " قبلی"}>
          {props.decIcon}
        </Button>
        <Button size="icon" variant="ghost" onClick={props.onInc} aria-label={props.label + " بعدی"}>
          {props.incIcon}
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}
