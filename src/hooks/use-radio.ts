import { useCallback, useEffect, useRef, useState } from "react";

import { RadioAudio } from "@/lib/radio/audio";
import {
  channelFrequency,
  decodePcm,
  encodePcm,
  frequencyChannel,
  shouldAccept,
  type RadioMessage,
} from "@/lib/radio/protocol";
import {
  createUdpTransport,
  fetchNetworkInfo,
  isNativeApp,
  routeToLoudspeaker,
  type NetworkInfo,
  type Transport,
  type TransportStatus,
} from "@/lib/radio/transport";

export type Peer = {
  id: string;
  name: string;
  freq: number;
  channel?: string;
  ip?: string;
  seen: number;
};

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("bisim:" + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function useRadio() {
  const [id] = useState(() => Math.random().toString(36).slice(2, 10));
  const [ready, setReady] = useState(false);
  const [power, setPower] = useState(true); // Default to active for zero-friction
  const [name, setName] = useState("ایستگاه");
  const [channel, setChannelState] = useState("1");
  const [freq, setFreq] = useState(channelFrequency(1));
  const [native, setNative] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [effect, setEffect] = useState(true);
  const [status, setStatus] = useState<TransportStatus>("offline");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [tx, setTx] = useState(false);
  const [rx, setRx] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const audio = useRef<RadioAudio | null>(null);
  const transport = useRef<Transport | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const talkers = useRef(new Map<string, string>()); // id -> name
  const st = useRef({ name, freq, channel, tx });
  st.current = { name, freq, channel, tx };

  const setChannel = useCallback((newCh: string) => {
    setChannelState(newCh);
    const num = parseInt(newCh, 10);
    if (!isNaN(num) && num >= 1 && num <= 16) {
      setFreq(channelFrequency(num));
    }
  }, []);

  // Load persisted settings after hydration
  useEffect(() => {
    setName(loadSetting("name", "گوشی " + Math.floor(Math.random() * 900 + 100)));
    const savedChannel = loadSetting("channel", "1");
    setChannel(savedChannel);
    setNative(isNativeApp());
    setVolume(loadSetting("volume", 0.9));
    setEffect(loadSetting("effect", true));
    setReady(true);
  }, [setChannel]);

  useEffect(() => {
    if (!ready) return;
    const s = { name, channel, volume, effect };
    for (const [k, v] of Object.entries(s)) localStorage.setItem("bisim:" + k, JSON.stringify(v));
  }, [ready, name, channel, volume, effect]);

  useEffect(() => audio.current?.setVolume(volume), [volume]);
  useEffect(() => {
    if (audio.current) audio.current.effect = effect;
  }, [effect]);

  const refreshPeers = useCallback(() => {
    const now = Date.now();
    for (const [k, p] of peersRef.current) if (now - p.seen > 8000) peersRef.current.delete(k);
    setPeers([...peersRef.current.values()]);
  }, []);

  const updateNetwork = useCallback(async () => {
    const info = await fetchNetworkInfo();
    if (info) setNetworkInfo(info);
  }, []);

  const updateRx = () => {
    const names = [...talkers.current.values()];
    setRx(names.length ? names.join("، ") : null);
    audio.current?.rxStatic(names.length > 0);
  };

  const endTalk = useCallback((sender: string) => {
    const a = audio.current;
    const wait = a ? a.pending(sender) * 1000 : 0;
    setTimeout(() => {
      if (!talkers.current.delete(sender)) return;
      updateRx();
      a?.squelchTail();
      navigator.vibrate?.(30);
    }, wait);
  }, []);

  const handle = useCallback(
    (msg: RadioMessage, fromIp?: string) => {
      if (!shouldAccept(msg, id, st.current.freq, st.current.channel)) return;
      const a = audio.current;
      switch (msg.t) {
        case "hello":
          peersRef.current.set(msg.id, {
            id: msg.id,
            name: msg.name,
            freq: msg.freq,
            channel: msg.channel,
            ip: fromIp || msg.ip,
            seen: Date.now(),
          });
          refreshPeers();
          break;
        case "bye":
          peersRef.current.delete(msg.id);
          talkers.current.delete(msg.id);
          updateRx();
          refreshPeers();
          break;
        case "start":
          talkers.current.set(msg.id, msg.name);
          updateRx();
          navigator.vibrate?.(40);
          break;
        case "audio":
          if (!talkers.current.has(msg.id)) {
            talkers.current.set(msg.id, peersRef.current.get(msg.id)?.name ?? "؟");
            updateRx();
          }
          a?.playFrame(msg.id, decodePcm(msg.data));
          break;
        case "end":
          endTalk(msg.id);
          break;
      }
    },
    [id, refreshPeers, endTalk],
  );

  const send = useCallback((m: RadioMessage, targetIp?: string) => {
    transport.current?.send(m, targetIp);
  }, []);

  const hello = useCallback(() => {
    send({
      t: "hello",
      id,
      name: st.current.name,
      freq: st.current.freq,
      channel: st.current.channel,
    });
  }, [id, send]);

  // Connect / reconnect transport while powered
  useEffect(() => {
    if (!power) return;
    const h = { onMessage: handle, onStatus: setStatus };
    transport.current = createUdpTransport(h);

    const beat = setInterval(() => {
      hello();
      refreshPeers();
    }, 2000);

    const first = setTimeout(() => {
      hello();
      updateNetwork();
    }, 400);

    return () => {
      clearInterval(beat);
      clearTimeout(first);
      send({ t: "bye", id, freq: st.current.freq, channel: st.current.channel });
      transport.current?.close();
      transport.current = null;
      peersRef.current.clear();
      talkers.current.clear();
      setRx(null);
      setPeers([]);
    };
  }, [power, handle, hello, refreshPeers, send, id, updateNetwork]);

  // Announce new name / frequency / channel right away
  useEffect(() => {
    if (power) {
      hello();
      transport.current?.scan().catch(() => {});
      updateNetwork();
    }
    talkers.current.clear();
    setRx(null);
    audio.current?.rxStatic(false);
  }, [power, name, freq, channel, hello, updateNetwork]);

  useEffect(() => {
    const close = () => send({ t: "bye", id, freq: st.current.freq, channel: st.current.channel });
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [id, send]);

  const ensureAudio = useCallback(async () => {
    if (!audio.current) {
      audio.current = new RadioAudio();
      audio.current.setVolume(volume);
      audio.current.effect = effect;
    }
    await audio.current.initMic();
    routeToLoudspeaker();
  }, [volume, effect]);

  const togglePower = useCallback(async () => {
    if (power) {
      setPower(false);
      setStatus("offline");
      return;
    }
    setError(null);
    try {
      await ensureAudio();
      setPower(true);
      audio.current?.roger();
      updateNetwork();
    } catch {
      setError("اجازه دسترسی به میکروفون را در تنظیمات فعال کنید.");
    }
  }, [power, ensureAudio, updateNetwork]);

  const scanNetwork = useCallback(async () => {
    setNotice("در حال جستجوی گوشی‌های متصل به هات‌اسپات…");
    try {
      const helloJson = JSON.stringify({ t: "hello", id, name: st.current.name, freq: st.current.freq, channel: st.current.channel }); await transport.current?.scan(helloJson);
      hello();
      await updateNetwork();
    } catch {}
    setTimeout(() => setNotice(null), 2500);
  }, [hello, updateNetwork]);

  const addPeerManual = useCallback(
    async (ip: string) => {
      if (!ip) return;
      await transport.current?.addPeerIp(ip);
      hello();
      await updateNetwork();
    },
    [hello, updateNetwork],
  );

  const pttDown = useCallback(async () => {
    if (!power) {
      await togglePower();
      return;
    }
    if (!audio.current) {
      try {
        await ensureAudio();
      } catch {
        setError("دسترسی به میکروفون داده نشد.");
        return;
      }
    }
    const a = audio.current;
    if (!a || st.current.tx) return;
    if (talkers.current.size > 0) {
      a.busy();
      navigator.vibrate?.([60, 60, 60]);
      setNotice("کانال مشغول است");
      setTimeout(() => setNotice(null), 1500);
      return;
    }
    setTx(true);
    navigator.vibrate?.(30);
    a.chirp();
    send({
      t: "start",
      id,
      name: st.current.name,
      freq: st.current.freq,
      channel: st.current.channel,
    });
    a.startCapture(
      (pcm) =>
        send({
          t: "audio",
          id,
          freq: st.current.freq,
          channel: st.current.channel,
          data: encodePcm(pcm),
        }),
      setLevel,
    );
  }, [power, togglePower, ensureAudio, id, send]);

  const pttUp = useCallback(() => {
    const a = audio.current;
    if (!st.current.tx || !a) return;
    a.stopCapture();
    setTx(false);
    setLevel(0);
    send({ t: "end", id, freq: st.current.freq, channel: st.current.channel });
    a.roger();
    navigator.vibrate?.(20);
  }, [id, send]);

  return {
    id,
    native,
    power,
    name,
    setName,
    channel,
    setChannel,
    freq,
    setFreq,
    volume,
    setVolume,
    effect,
    setEffect,
    status,
    peers,
    networkInfo,
    tx,
    rx,
    level,
    error,
    notice,
    togglePower,
    scanNetwork,
    addPeerManual,
    pttDown,
    pttUp,
    analyser: () => audio.current?.analyser ?? null,
  };
}
