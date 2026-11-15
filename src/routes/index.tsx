import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Mic, Minus, Plus, Power, Settings2, Smartphone, Users } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { SignalMeter } from "@/components/SignalMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRadio } from "@/hooks/use-radio";
import { CHANNEL_COUNT, channelFrequency, frequencyChannel, tune } from "@/lib/radio/protocol";
import { cn } from "@/lib/utils";

const TITLE = "بیسیم — ارتباط صوتی بدون اینترنت";
const DESC = "بیسیم Push-to-Talk بین گوشی‌ها روی وای‌فای یا هات‌اسپات محلی، با کانال، فرکانس و افکت رادیویی.";

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

const STATUS_TEXT = {
  online: "متصل به شبکه محلی",
  connecting: "در حال اتصال…",
  offline: "خاموش",
  unsupported: "فقط در برنامه گوشی",
} as const;

function Index() {
  const r = useRadio();
  const channel = frequencyChannel(r.freq);
  const sameChannel = r.peers.filter((p) => Math.abs(p.freq - r.freq) < 1e-6);
  const chipRow = useRef<HTMLDivElement>(null);

  const stepChannel = (d: number) => {
    const next = (((channel ?? 1) - 1 + d + CHANNEL_COUNT) % CHANNEL_COUNT) + 1;
    r.setFreq(channelFrequency(next));
  };

  useEffect(() => {
    chipRow.current?.querySelector('[data-active="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [channel]);

  // Hold Space to talk (keyboards / desktop)
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

  const statusTone = r.status === "online" ? "bg-primary" : r.status === "connecting" ? "bg-rx" : "bg-muted-foreground";

  return (
    <main className="bg-glow min-h-screen select-none">
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-5 pt-6 pb-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Mic className="size-5" />
            </div>
            <div>
              <h1 className="text-lg leading-tight font-extrabold">بیسیم</h1>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", r.power ? statusTone : "bg-muted-foreground")} />
                {r.power ? STATUS_TEXT[r.status] : STATUS_TEXT.offline}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SettingsSheet r={r} />
            <Button
              size="icon"
              variant={r.power ? "default" : "secondary"}
              onClick={r.togglePower}
              aria-label={r.power ? "خاموش کردن" : "روشن کردن"}
              className="size-10 rounded-full"
            >
              <Power />
            </Button>
          </div>
        </header>

        {!r.native && (
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>ارتباط صوتی بین گوشی‌ها در برنامه نصب‌شده اندروید کار می‌کند؛ گوشی‌ها فقط باید به یک وای‌فای یا هات‌اسپات وصل باشند.</p>
          </div>
        )}

        {/* Channel */}
        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="icon" className="size-11 rounded-full" onClick={() => stepChannel(1)} aria-label="کانال بعدی">
              <ChevronRight />
            </Button>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">کانال</p>
              <p className="font-display text-6xl leading-none font-bold tabular-nums" dir="ltr">
                {channel ? String(channel).padStart(2, "0") : "--"}
              </p>
            </div>
            <Button variant="secondary" size="icon" className="size-11 rounded-full" onClick={() => stepChannel(-1)} aria-label="کانال قبلی">
              <ChevronLeft />
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-center gap-3" dir="ltr">
            <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => r.setFreq(tune(r.freq, -1))} aria-label="کاهش فرکانس">
              <Minus className="size-4" />
            </Button>
            <span className="font-display text-sm tracking-wide text-muted-foreground tabular-nums">{r.freq.toFixed(5)} MHz</span>
            <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => r.setFreq(tune(r.freq, 1))} aria-label="افزایش فرکانس">
              <Plus className="size-4" />
            </Button>
          </div>

          <div ref={chipRow} className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" dir="ltr">
            {Array.from({ length: CHANNEL_COUNT }, (_, i) => i + 1).map((ch) => (
              <button
                key={ch}
                data-active={channel === ch}
                onClick={() => r.setFreq(channelFrequency(ch))}
                className={cn(
                  "font-display h-9 min-w-9 shrink-0 rounded-full px-3 text-sm tabular-nums transition-colors",
                  channel === ch ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {ch}
              </button>
            ))}
          </div>
        </section>

        {/* PTT */}
        <section className="flex flex-1 flex-col items-center justify-center gap-5 py-2">
          <div className="relative grid place-items-center">
            {(r.tx || r.rx) && (
              <>
                <span className={cn("ptt-ring absolute inset-0 rounded-full", r.tx ? "bg-tx" : "bg-rx")} />
                <span className={cn("ptt-ring absolute inset-0 rounded-full [animation-delay:0.8s]", r.tx ? "bg-tx" : "bg-rx")} />
              </>
            )}
            <button
              type="button"
              disabled={!r.power}
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
                "relative grid size-56 touch-none place-items-center rounded-full border border-border bg-card shadow-2xl transition-all duration-150 disabled:opacity-40",
                r.tx && "scale-95 border-transparent bg-tx text-destructive-foreground",
                !r.tx && r.rx && "border-rx",
                !r.tx && !r.rx && r.power && "active:scale-95",
              )}
            >
              <span className="flex flex-col items-center gap-2">
                <Mic className={cn("size-14", !r.tx && (r.rx ? "text-rx" : "text-primary"))} />
                <span className="font-display text-xl font-bold tracking-widest">PTT</span>
              </span>
            </button>
          </div>

          <div className="flex h-12 flex-col items-center gap-2 text-center">
            <p className={cn("text-sm font-semibold", r.tx ? "text-tx" : r.rx ? "text-rx" : "text-muted-foreground")}>
              {r.error ??
                r.notice ??
                (!r.power ? "برای شروع، بیسیم را روشن کنید" : r.tx ? "در حال صحبت…" : r.rx ? `${r.rx} صحبت می‌کند` : "نگه دارید و صحبت کنید")}
            </p>
            <span className={cn(r.tx ? "text-tx" : "text-rx", !(r.tx || r.rx) && "opacity-0")}>
              <SignalMeter txLevel={r.level} tx={r.tx} getAnalyser={r.analyser} />
            </span>
          </div>
        </section>

        {/* Stations */}
        <section className="rounded-3xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-primary" />
            ایستگاه‌های این کانال
            <span className="ms-auto rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{sameChannel.length}</span>
          </h2>
          {sameChannel.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {r.power ? "هنوز کسی روی این کانال نیست." : "بیسیم خاموش است."}
              {r.peers.length > sameChannel.length && ` ${r.peers.length - sameChannel.length} ایستگاه در کانال‌های دیگر.`}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {sameChannel.map((p) => (
                <li key={p.id} className={cn("flex items-center gap-2 rounded-full bg-secondary py-1 ps-1 pe-3 text-sm", r.rx?.includes(p.name) && "ring-2 ring-rx")}>
                  <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">{p.name.trim().charAt(0) || "؟"}</span>
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function SettingsSheet({ r }: { r: ReturnType<typeof useRadio> }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="icon" variant="secondary" className="size-10 rounded-full" aria-label="تنظیمات">
          <Settings2 />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl border-border" dir="rtl">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-right">تنظیمات</SheetTitle>
        </SheetHeader>
        <div className="mx-auto w-full max-w-md space-y-6 px-4 pb-8">
          <Field label="نام شما" htmlFor="name">
            <Input id="name" value={r.name} maxLength={20} onChange={(e) => r.setName(e.target.value)} />
          </Field>
          <Field label="بلندی صدا">
            <Slider value={[r.volume * 100]} max={100} step={1} onValueChange={([v]) => r.setVolume((v ?? 0) / 100)} />
          </Field>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="fx">افکت صدای رادیویی</Label>
              <p className="text-xs text-muted-foreground">صدای بیسیمی با نویز کوتاه پایان پیام</p>
            </div>
            <Switch id="fx" dir="ltr" checked={r.effect} onCheckedChange={r.setEffect} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
