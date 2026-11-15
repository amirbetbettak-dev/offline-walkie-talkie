import type { RadioMessage } from "./protocol";

export type TransportStatus = "connecting" | "online" | "offline";

export interface Transport {
  send(msg: RadioMessage): void;
  close(): void;
}

type Handlers = {
  onMessage: (msg: RadioMessage) => void;
  onStatus: (s: TransportStatus) => void;
};

/** Same-device simulation: every tab/window of the app on this device shares the air. */
export function createLocalTransport({ onMessage, onStatus }: Handlers): Transport {
  const bc = new BroadcastChannel("bisim-radio-air");
  bc.onmessage = (e) => onMessage(e.data as RadioMessage);
  onStatus("online");
  return {
    send: (m) => bc.postMessage(m),
    close: () => {
      bc.close();
      onStatus("offline");
    },
  };
}

/** Wi-Fi / hotspot: talks to the tiny relay (relay/server.mjs) running on any device in the LAN. */
export function createLanTransport(url: string, { onMessage, onStatus }: Handlers): Transport {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    onStatus("connecting");
    try {
      ws = new WebSocket(url);
    } catch {
      onStatus("offline");
      retry = setTimeout(connect, 2000);
      return;
    }
    ws.onopen = () => onStatus("online");
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)) as RadioMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus("offline");
      retry = setTimeout(connect, 2000);
    };
  };
  connect();

  return {
    send: (m) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
      onStatus("offline");
    },
  };
}
