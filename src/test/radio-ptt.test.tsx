import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  prepare: vi.fn(async () => {}),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  send: vi.fn(),
}));
vi.mock("@/lib/radio/transport", () => ({
  isNativeApp: () => true,
  prepareNativeAudio: native.prepare,
  configureNativeAudio: vi.fn(),
  routeToLoudspeaker: vi.fn(),
  fetchNetworkInfo: vi.fn(async () => null),
  scanWifiNetworksNative: vi.fn(async () => []),
  openWifiSettingsNative: vi.fn(async () => {}),
  createUdpTransport: () => ({
    send: native.send, close: vi.fn(), scan: vi.fn(async () => {}),
    setChannelCode: vi.fn(async () => {}), addPeerIp: vi.fn(async () => {}),
    startNativeTx: native.start, stopNativeTx: native.stop,
  }),
}));
vi.mock("@/lib/radio/audio", () => ({
  RadioAudio: class {
    ctx = { state: "running" }; analyser = null;
    setVolume() {} close() {} roger() {} rxStatic() {} busy() {}
  },
}));
import { useRadio } from "@/hooks/use-radio";

describe("native PTT lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    native.prepare.mockImplementation(async () => {});
    native.start.mockImplementation(async () => {});
  });
  it("release before microphone initialization prevents transmission", async () => {
    let release: () => void = () => {};
    native.prepare.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result, unmount } = renderHook(() => useRadio());
    await waitFor(() => expect(result.current.native).toBe(true));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.pttDown(); });
    act(() => result.current.pttUp());
    await act(async () => { release(); await pending; });
    expect(native.start).not.toHaveBeenCalled();
    expect(result.current.tx).toBe(false);
    unmount();
  });
  it("release while native start is pending stops it as soon as it completes", async () => {
    let started: () => void = () => {};
    native.start.mockImplementation(() => new Promise<void>((resolve) => { started = resolve; }));
    const { result, unmount } = renderHook(() => useRadio());
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.pttDown(); });
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(1));
    act(() => result.current.pttUp());
    await act(async () => { started(); await pending; });
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(result.current.tx).toBe(false);
    unmount();
  });
  it("one press starts one native stream and release stops it", async () => {
    const { result, unmount } = renderHook(() => useRadio());
    await act(async () => { await result.current.pttDown(); });
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(result.current.tx).toBe(true);
    act(() => result.current.pttUp());
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(result.current.tx).toBe(false);
    expect(native.send.mock.calls.some(([m]) => m.t === "audio")).toBe(false);
    unmount();
  });
  it("native microphone failure never reports transmission as active", async () => {
    native.start.mockRejectedValueOnce(new Error("microphone unavailable"));
    const { result, unmount } = renderHook(() => useRadio());
    await act(async () => { await result.current.pttDown(); });
    expect(result.current.tx).toBe(false);
    expect(result.current.error).toBe("microphone unavailable");
    unmount();
  });
});
