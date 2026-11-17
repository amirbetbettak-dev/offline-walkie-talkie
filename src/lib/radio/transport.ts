import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { createDeduper, type Packet, type RadioMessage } from "./protocol";

export type TransportStatus = "connecting" | "online" | "offline" | "unsupported";

export interface DiscoveredPeer {
  ip: string;
  name: string;
  channel: string;
  lastSeenSec: number;
}

export interface NetworkInfo {
  ip: string;
  isHotspot: boolean;
  port: number;
  socketBound: boolean;
  ssid: string;
  knownPeers: DiscoveredPeer[];
  peerCount: number;
  txActive: boolean;
  txPackets: number;
  txBytes: number;
  txLevel: number;
  rxActive: boolean;
  rxPackets: number;
  rxBytes: number;
  rxLevel: number;
  lastRxSender: string;
  lastRxAgeSec: number;
  hasAudioPermission: boolean;
  hasLocationPermission: boolean;
}

export interface ScannedWifi {
  ssid: string;
  bssid: string;
  level: number;
  frequency: number;
  capabilities: string;
}

export interface Transport {
  send(msg: RadioMessage, targetIp?: string): void;
  close(): void;
  scan(data?: string): Promise<void>;
  getNetwork(): Promise<NetworkInfo | null>;
  addPeerIp(ip: string): Promise<void>;
  startNativeTx(): Promise<void>;
  stopNativeTx(): Promise<void>;
  scanWifi(): Promise<ScannedWifi[]>;
  openWifiSettings(): Promise<void>;
  setChannelCode(code: string, frequency?: number): Promise<void>;
}

type Handlers = {
  onMessage: (msg: RadioMessage, fromIp?: string) => void;
  onStatus: (s: TransportStatus) => void;
  onAudioError?: (message: string) => void;
};

interface BisimUdpPlugin {
  start(opts: { port: number }): Promise<{ status: string; port: number }>;
  send(opts: { data: string; targetIp?: string }): Promise<void>;
  stop(): Promise<void>;
  useSpeaker(): Promise<void>;
  getNetworkInfo(): Promise<NetworkInfo>;
  scanSubnet(opts?: { data?: string }): Promise<void>;
  addPeer(opts: { ip: string }): Promise<void>;
  prepareAudio(): Promise<void>;
  configureAudio(opts: { volume: number }): Promise<void>;
  startNativeTx(): Promise<void>;
  stopNativeTx(): Promise<void>;
  scanWifiNetworks(): Promise<{ networks: ScannedWifi[] }>;
  openWifiSettings(): Promise<void>;
  setChannelCode(opts: { channel: string; frequency?: number }): Promise<void>;
  addListener(
    event: "message",
    cb: (e: { data: string; from: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "audioError",
    cb: (e: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "peerDiscovered",
    cb: (e: { peerIp: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const BisimUdp = registerPlugin<BisimUdpPlugin>("BisimUdp");
export const UDP_PORT = 47474;

export const isNativeApp = () => Capacitor.isNativePlatform();

export function routeToLoudspeaker() {
  if (isNativeApp()) BisimUdp.useSpeaker().catch(() => {});
}

export async function prepareNativeAudio() {
  if (!isNativeApp()) throw new Error("ارتباط صوتی فقط در برنامه نصب‌شده اندروید فعال است.");
  await BisimUdp.prepareAudio();
}

export function configureNativeAudio(volume: number) {
  if (isNativeApp()) BisimUdp.configureAudio({ volume }).catch(() => {});
}

export async function fetchNetworkInfo(): Promise<NetworkInfo | null> {
  if (!isNativeApp()) return null;
  try {
    return await BisimUdp.getNetworkInfo();
  } catch {
    return null;
  }
}

export async function scanWifiNetworksNative(): Promise<ScannedWifi[]> {
  if (!isNativeApp()) return [];
  try {
    const res = await BisimUdp.scanWifiNetworks();
    return res.networks || [];
  } catch {
    return [];
  }
}

export async function openWifiSettingsNative(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await BisimUdp.openWifiSettings();
  } catch {}
}

/** Wi-Fi / hotspot transport: UDP broadcast + unicast from the native Android plugin. No server, no internet. */
export function createUdpTransport({ onMessage, onStatus, onAudioError }: Handlers): Transport {
  if (!isNativeApp()) {
    onStatus("unsupported");
    return {
      send: () => {},
      close: () => {},
      scan: async () => {},
      getNetwork: async () => null,
      addPeerIp: async () => {},
      startNativeTx: async () => {},
      stopNativeTx: async () => {},
      scanWifi: async () => [],
      openWifiSettings: async () => {},
      setChannelCode: async () => {},
    };
  }
  let seq = 1;
  let open = true;
  let starting = false;
  let channel = "1";
  let frequency = 446.00625;
  const handles: PluginListenerHandle[] = [];
  const fresh = createDeduper();
  onStatus("connecting");

  BisimUdp.addListener("message", ({ data, from }) => {
    try {
      const p = JSON.parse(data) as Packet;
      if (fresh(p)) onMessage(p as RadioMessage, from);
    } catch {
      /* ignore foreign packets */
    }
  }).then((h) => {
    if (open) handles.push(h);
    else h.remove();
  });

  BisimUdp.addListener("peerDiscovered", ({ peerIp }) => {
    BisimUdp.addPeer({ ip: peerIp }).catch(() => {});
  }).then((h) => {
    if (open) handles.push(h);
    else h.remove();
  });

  BisimUdp.addListener("audioError", ({ message }) => {
    if (open) onAudioError?.(message);
  }).then((h) => { if (open) handles.push(h); else h.remove(); });

  const connect = async () => {
    if (!open || starting) return;
    starting = true;
    onStatus("connecting");
    try {
      await BisimUdp.start({ port: UDP_PORT });
      if (!open) { await BisimUdp.stop(); return; }
      await BisimUdp.setChannelCode({ channel, frequency });
      onStatus("online");
      BisimUdp.prepareAudio().catch(() => {});
    } catch { if (open) onStatus("offline"); }
    finally { starting = false; }
  };
  void connect();
  const reconnect = setInterval(async () => {
    if (!open || starting) return;
    try {
      const info = await BisimUdp.getNetworkInfo();
      if (!info.socketBound) await connect();
    } catch { await connect(); }
  }, 1500);

  return {
    send: (m, targetIp) => {
      if (!open) return;
      BisimUdp.send({ data: JSON.stringify({ ...m, s: seq++ }), ...(targetIp ? { targetIp } : {}) }).catch(() => {});
    },
    close: () => {
      open = false;
      clearInterval(reconnect);
      for (const h of handles) h.remove();
      handles.length = 0;
      BisimUdp.stop().catch(() => {});
      onStatus("offline");
    },
    scan: async (data?: string) => {
      if (open) await BisimUdp.scanSubnet(data ? { data } : {}).catch(() => {});
    },
    getNetwork: async () => {
      try {
        return await BisimUdp.getNetworkInfo();
      } catch {
        return null;
      }
    },
    addPeerIp: async (ip: string) => {
      try {
        await BisimUdp.addPeer({ ip });
      } catch {}
    },
    startNativeTx: async () => {
      if (!open) throw new Error("ارتباط شبکه قطع است.");
      await BisimUdp.startNativeTx();
    },
    stopNativeTx: async () => {
      try {
        await BisimUdp.stopNativeTx();
      } catch {}
    },
    scanWifi: async () => {
      try {
        const res = await BisimUdp.scanWifiNetworks();
        return res.networks || [];
      } catch {
        return [];
      }
    },
    openWifiSettings: async () => {
      try {
        await BisimUdp.openWifiSettings();
      } catch {}
    },
    setChannelCode: async (code: string, freq?: number) => {
      channel = code;
      if (freq !== undefined) frequency = freq;
      await BisimUdp.setChannelCode({ channel, frequency });
    },
  };
}
