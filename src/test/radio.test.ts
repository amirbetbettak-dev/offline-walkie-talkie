import { describe, expect, it } from "vitest";

import {
  channelFrequency,
  decodePcm,
  encodePcm,
  frequencyChannel,
  shouldAccept,
  tune,
} from "@/lib/radio/protocol";

describe("radio channels", () => {
  it("channel 1 is 446.00625 MHz and channel 16 is 446.19375 MHz", () => {
    expect(channelFrequency(1)).toBe(446.00625);
    expect(channelFrequency(16)).toBe(446.19375);
  });

  it("tuning moves in 12.5 kHz steps and maps back to a channel", () => {
    expect(tune(446.00625, 1)).toBe(446.01875);
    expect(frequencyChannel(446.01875)).toBe(2);
    expect(frequencyChannel(446.0)).toBeNull();
  });
});

describe("message filtering", () => {
  const me = "me";
  it("voice from another frequency is ignored", () => {
    expect(shouldAccept({ t: "audio", id: "a", freq: 446.01875, data: "" }, me, 446.00625)).toBe(false);
    expect(shouldAccept({ t: "audio", id: "a", freq: 446.00625, data: "" }, me, 446.00625)).toBe(true);
  });
  it("own messages are ignored, presence from any frequency is accepted", () => {
    expect(shouldAccept({ t: "start", id: me, name: "x", freq: 446.00625 }, me, 446.00625)).toBe(false);
    expect(shouldAccept({ t: "hello", id: "b", name: "y", freq: 446.1 }, me, 446.00625)).toBe(true);
  });
});

it("audio frames survive encoding", () => {
  const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
  expect([...decodePcm(encodePcm(pcm))]).toEqual([...pcm]);
});

it("a packet heard twice plays only once", async () => {
  const { createDeduper } = await import("@/lib/radio/protocol");
  const fresh = createDeduper();
  const p = { t: "audio" as const, id: "a", freq: 446.00625, data: "", s: 5 };
  expect(fresh(p)).toBe(true);
  expect(fresh(p)).toBe(false);
  expect(fresh({ ...p, s: 6 })).toBe(true);
});
