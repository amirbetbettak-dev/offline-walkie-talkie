import { useCallback, useEffect, useRef, useState } from "react";

import { RadioAudio } from "@/lib/radio/audio";
import {
  channelFrequency,
  decodePcm,
  encodePcm,
  SAMPLE_RATE,
  shouldAccept,
  type RadioMessage,
} from "@/lib/radio/protocol";
import {
  createLanTransport,
  createLocalTransport,
  type Transport,
  type TransportStatus,
} from "@/lib/radio/transport";

export type Mode = "local" | "lan";
export type Peer = { id: string; name: string; freq: number; seen: number; virtual?: boolean };

const VIRTUAL_ID = "virtual-echo";
const VIRTUAL_NAME = "ایستگاه مجازی";

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
  const [power, setPower] = useState(false);
  const [name, setName] = useState("ایستگاه");
  const [freq, setFreq] = useState(channelFrequency(1));
  const [mode, setMode] = useState<Mode>("local");
  const [relayUrl, setRelayUrl] = useState("ws://192.168.43.1:8787");
  const [volume, setVolume] = useState(0.9);
  const [effect, setEffect] = useState(true);
  const [echo, setEcho] = useState(false);
  const [status, setStatus] = useState<TransportStatus>("offline");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [tx, setTx] = useState(false);
  const [rx, setRx] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const audio = useRef<RadioAudio | null>(null);
  const transport = useRef<Transport | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const talkers = useRef(new Map<string, string>()); // id -> name
  const echoBuf = useRef<Int16Array[]>([]);
  const st = useRef({ name, freq, echo, tx });
  st.current = { name, freq, echo, tx };

  // Load persisted settings after hydration
  useEffect(() => {
    setName(loadSetting("name", "ایستگاه " + Math.floor(Math.random() * 90 + 10)));
    setFreq(loadSetting("freq", channelFrequency(1)));
    setMode(loadSetting("mode", "local"));
    setRelayUrl(loadSetting("relay", "ws://192.168.43.1:8787"));
    setVolume(loadSetting("volume", 0.9));
    setEffect(loadSetting("effect", true));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const s = { name, freq, mode, relay: relayUrl, volume, effect };
    for (const [k, v] of Object.entries(s)) localStorage.setItem("bisim:" + k, JSON.stringify(v));
  }, [ready, name, freq, mode, relayUrl, volume, effect]);

  useEffect(() => audio.current?.setVolume(volume), [volume]);
  useEffect(() => {
    if (audio.current) audio.current.effect = effect;
  }, [effect]);

  const refreshPeers = useCallback(() => {
    const now = Date.now();
    for (const [k, p] of peersRef.current) if (!p.virtual && now - p.seen > 7000) peersRef.current.delete(k);
    setPeers([...peersRef.current.values()]);
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
    (msg: RadioMessage) => {
      if (!shouldAccept(msg, id, st.current.freq)) return;
      const a = audio.current;
      switch (msg.t) {
        case "hello":
          peersRef.current.set(msg.id, { id: msg.id, name: msg.name, freq: msg.freq, seen: Date.now() });
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

  const send = useCallback((m: RadioMessage) => transport.current?.send(m), []);
  const hello = useCallback(
    () => send({ t: "hello", id, name: st.current.name, freq: st.current.freq }),
    [id, send],
  );

  // Connect / reconnect transport while powered
  useEffect(() => {
    if (!power) return;
    const h = { onMessage: handle, onStatus: setStatus };
    transport.current = mode === "lan" ? createLanTransport(relayUrl, h) : createLocalTransport(h);
    const beat = setInterval(() => {
      hello();
      refreshPeers();
    }, 2000);
    const first = setTimeout(hello, 300);
    return () => {
      clearInterval(beat);
      clearTimeout(first);
      send({ t: "bye", id, freq: st.current.freq });
      transport.current?.close();
      transport.current = null;
      peersRef.current.forEach((p, k) => !p.virtual && peersRef.current.delete(k));
      talkers.current.clear();
      setRx(null);
      setPeers([...peersRef.current.values()]);
    };
  }, [power, mode, relayUrl, handle, hello, refreshPeers, send, id]);

  // Announce new name / frequency right away
  useEffect(() => {
    if (power) hello();
    talkers.current.clear();
    setRx(null);
    audio.current?.rxStatic(false);
  }, [power, name, freq, hello]);

  // Virtual echo station for single-device testing
  useEffect(() => {
    if (echo) peersRef.current.set(VIRTUAL_ID, { id: VIRTUAL_ID, name: VIRTUAL_NAME, freq, seen: Date.now(), virtual: true });
    else peersRef.current.delete(VIRTUAL_ID);
    setPeers([...peersRef.current.values()]);
  }, [echo, freq]);

  useEffect(() => {
    const close = () => send({ t: "bye", id, freq: st.current.freq });
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [id, send]);

  const togglePower = useCallback(async () => {
    if (power) {
      setPower(false);
      setStatus("offline");
      return;
    }
    setError(null);
    try {
      if (!audio.current) audio.current = new RadioAudio();
      audio.current.setVolume(volume);
      audio.current.effect = effect;
      await audio.current.initMic();
      setPower(true);
      audio.current.roger();
    } catch {
      setError("دسترسی به میکروفون داده نشد. اجازه میکروفون را فعال کنید.");
    }
  }, [power, volume, effect]);

  const pttDown = useCallback(() => {
    const a = audio.current;
    if (!power || !a || st.current.tx) return;
    if (talkers.current.size > 0) {
      a.busy();
      navigator.vibrate?.([60, 60, 60]);
      setNotice("کانال مشغول است");
      setTimeout(() => setNotice(null), 1500);
      return;
    }
    setTx(true);
    navigator.vibrate?.(25);
    a.chirp();
    echoBuf.current = [];
    send({ t: "start", id, name: st.current.name, freq: st.current.freq });
    a.startCapture(
      (pcm) => {
        send({ t: "audio", id, freq: st.current.freq, data: encodePcm(pcm) });
        if (st.current.echo) echoBuf.current.push(pcm);
      },
      setLevel,
    );
  }, [power, id, send]);

  const pttUp = useCallback(() => {
    const a = audio.current;
    if (!st.current.tx || !a) return;
    a.stopCapture();
    setTx(false);
    setLevel(0);
    send({ t: "end", id, freq: st.current.freq });
    a.roger();
    navigator.vibrate?.(15);

    if (st.current.echo && echoBuf.current.length) {
      const frames = echoBuf.current;
      echoBuf.current = [];
      setTimeout(() => {
        talkers.current.set(VIRTUAL_ID, VIRTUAL_NAME);
        updateRx();
        frames.forEach((f) => a.playFrame(VIRTUAL_ID, f));
        const dur = frames.reduce((s, f) => s + f.length, 0) / SAMPLE_RATE;
        setTimeout(() => endTalk(VIRTUAL_ID), dur * 1000);
      }, 700);
    }
  }, [id, send, endTalk]);

  return {
    id, power, name, setName, freq, setFreq, mode, setMode, relayUrl, setRelayUrl,
    volume, setVolume, effect, setEffect, echo, setEcho, status, peers, tx, rx, level,
    error, notice, togglePower, pttDown, pttUp, analyser: () => audio.current?.analyser ?? null,
  };
}
