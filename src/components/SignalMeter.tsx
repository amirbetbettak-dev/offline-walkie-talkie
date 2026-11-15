import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** 10-bar meter: shows mic level while transmitting, received audio level otherwise. */
export function SignalMeter({
  txLevel,
  tx,
  getAnalyser,
}: {
  txLevel: number;
  tx: boolean;
  getAnalyser: () => AnalyserNode | null;
}) {
  const [rxLevel, setRxLevel] = useState(0);

  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(256);
    const loop = () => {
      const an = getAnalyser();
      if (an) {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setRxLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser]);

  const level = tx ? txLevel : rxLevel;
  const lit = Math.round(level * 10);
  return (
    <div className="flex h-5 items-end gap-0.5" dir="ltr" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 rounded-[1px] transition-opacity",
            i < lit ? "opacity-100" : "opacity-20",
            "bg-lcd-foreground",
          )}
          style={{ height: `${30 + i * 7}%` }}
        />
      ))}
    </div>
  );
}
