import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { createDeduper, type Packet, type RadioMessage } from "./protocol";

export type TransportStatus = "connecting" | "online" | "offline" | "unsupported";

export interface Transport {
  send(msg: RadioMessage): void;
  close(): void;
}

type Handlers = {
  onMessage: (msg: RadioMessage) => void;
  onStatus: (s: TransportStatus) => void;
};

interface BisimUdpPlugin {
  start(opts: { port: number }): Promise<{ broadcast: string[] }>;
  send(opts: { data: string }): Promise<void>;
  stop(): Promise<void>;
  useSpeaker(): Promise<void>;
  addListener(
    event: "message",
    cb: (e: { data: string; from: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const BisimUdp = registerPlugin<BisimUdpPlugin>("BisimUdp");
export const UDP_PORT = 47474;

export const isNativeApp = () => Capacitor.isNativePlatform();

export function useLoudspeaker() {
  if (isNativeApp()) BisimUdp.useSpeaker().catch(() => {});
}

/** Wi-Fi / hotspot transport: UDP broadcast from the native Android plugin. No server, no internet. */
export function createUdpTransport({ onMessage, onStatus }: Handlers): Transport {
  if (!isNativeApp()) {
    onStatus("unsupported");
    return { send: () => {}, close: () => {} };
  }
  let seq = 1;
  let open = true;
  let listener: PluginListenerHandle | undefined;
  const fresh = createDeduper();
  onStatus("connecting");

  BisimUdp.addListener("message", ({ data }) => {
    try {
      const p = JSON.parse(data) as Packet;
      if (fresh(p)) onMessage(p);
    } catch {
      /* ignore foreign packets */
    }
  }).then((h) => {
    if (open) listener = h;
    else h.remove();
  });

  BisimUdp.start({ port: UDP_PORT })
    .then(() => open && onStatus("online"))
    .catch(() => open && onStatus("offline"));

  return {
    send: (m) => {
      if (!open) return;
      BisimUdp.send({ data: JSON.stringify({ ...m, s: seq++ }) }).catch(() => {});
    },
    close: () => {
      open = false;
      listener?.remove();
      BisimUdp.stop().catch(() => {});
      onStatus("offline");
    },
  };
}
