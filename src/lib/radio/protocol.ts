// Wire protocol shared by every transport (BroadcastChannel, LAN relay, future native UDP).
export const BASE_FREQ = 446.00625; // PMR446 channel 1 (MHz)
export const FREQ_STEP = 0.0125; // 12.5 kHz
export const CHANNEL_COUNT = 16;
export const FREQ_MIN = 430;
export const FREQ_MAX = 470;
export const SAMPLE_RATE = 16000;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function channelFrequency(channel: number): number {
  return round5(BASE_FREQ + (channel - 1) * FREQ_STEP);
}

export function frequencyChannel(freq: number): number | null {
  for (let ch = 1; ch <= CHANNEL_COUNT; ch++) {
    if (Math.abs(channelFrequency(ch) - freq) < 1e-6) return ch;
  }
  return null;
}

export function tune(freq: number, steps: number): number {
  return Math.min(FREQ_MAX, Math.max(FREQ_MIN, round5(freq + steps * FREQ_STEP)));
}

export type RadioMessage =
  | { t: "hello"; id: string; name: string; freq: number }
  | { t: "bye"; id: string; freq: number }
  | { t: "start"; id: string; name: string; freq: number }
  | { t: "audio"; id: string; freq: number; data: string }
  | { t: "end"; id: string; freq: number };

/** Presence (hello/bye) is network-wide; voice only reaches stations tuned to the same frequency. */
export function shouldAccept(msg: RadioMessage, myId: string, myFreq: number): boolean {
  if (msg.id === myId) return false;
  if (msg.t === "hello" || msg.t === "bye") return true;
  return Math.abs(msg.freq - myFreq) < 1e-6;
}

export function encodePcm(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function decodePcm(b64: string): Int16Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Every packet carries a per-sender sequence number `s`. */
export type Packet = RadioMessage & { s: number };

/**
 * A phone can hear the same broadcast on more than one network path; drop repeats
 * and stale packets so audio never plays twice.
 */
export function createDeduper() {
  const last = new Map<string, number>();
  return (p: Packet): boolean => {
    const prev = last.get(p.id);
    if (prev !== undefined && p.s <= prev && prev - p.s < 10000) return false;
    last.set(p.id, p.s);
    return true;
  };
}
