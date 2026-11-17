import { useCallback, useEffect, useRef, useState } from "react";

import { RadioAudio } from "@/lib/radio/audio";
import {
  channelFrequency,
  shouldAccept,
  type RadioMessage,
} from "@/lib/radio/protocol";
import {
  createUdpTransport,
  prepareNativeAudio,
  configureNativeAudio,
  fetchNetworkInfo,
  isNativeApp,
  openWifiSettingsNative,
  routeToLoudspeaker,
  scanWifiNetworksNative,
  type NetworkInfo,
  type ScannedWifi,
  type Transport,
  type TransportStatus,
} from "@/lib/radio/transport";

export type Peer = {
  id: string;
  name: string;
  freq: number;
  channel?: string | undefined;
  groupName?: string | undefined;
  groupCode?: string | undefined;
  ip?: string | undefined;
  seen: number;
};

export type DiscoveredGroup = {
  code: string;
  name: string;
  hostName: string;
  hostIp?: string | undefined;
  lastSeen: number;
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
  const [power, setPower] = useState(true);
  const [name, setName] = useState("ایستگاه");
  const [channel, setChannelState] = useState("1");
  const [groupName, setGroupName] = useState("کانال عمومی");
  const [freq, setFreq] = useState(channelFrequency(1));
  const [native, setNative] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [effect, setEffect] = useState(false);
  const [status, setStatus] = useState<TransportStatus>("offline");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [groups, setGroups] = useState<DiscoveredGroup[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [wifiList, setWifiList] = useState<ScannedWifi[]>([]);
  const [isScanningWifi, setIsScanningWifi] = useState(false);
  const [tx, setTx] = useState(false);
  const [rx, setRx] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const audio = useRef<RadioAudio | null>(null);
  const transport = useRef<Transport | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const groupsRef = useRef(new Map<string, DiscoveredGroup>());
  const talkers = useRef(new Map<string, string>());
  const talkIntent = useRef(false);
  const startingTalk = useRef(false);
  const st = useRef({ name, freq, channel, groupName, tx });
  st.current = { name, freq, channel, groupName, tx };

  const setChannel = useCallback((newCh: string, newGroupName?: string) => {
    setChannelState(newCh);
    if (newGroupName) setGroupName(newGroupName);
    const num = parseInt(newCh, 10);
    if (!isNaN(num) && num >= 1 && num <= 16) {
      setFreq(channelFrequency(num));
    }

  }, []);

  // Load persisted settings
  useEffect(() => {
    setName(loadSetting("name", "گوشی " + Math.floor(Math.random() * 900 + 100)));
    const savedChannel = loadSetting("channel", "1");
    const savedGroupName = loadSetting("groupName", "کانال عمومی");
    setChannel(savedChannel, savedGroupName);
    setNative(isNativeApp());
    setVolume(loadSetting("volume", 0.9));
    setEffect(loadSetting("effect", false));
    setReady(true);
  }, [setChannel]);

  useEffect(() => {
    if (!ready) return;
    const s = { name, channel, groupName, volume, effect };
    for (const [k, v] of Object.entries(s)) localStorage.setItem("bisim:" + k, JSON.stringify(v));
  }, [ready, name, channel, groupName, volume, effect]);

  useEffect(() => {
    audio.current?.setVolume(volume);
    configureNativeAudio(volume);
  }, [volume, status]);
  useEffect(() => {
    if (audio.current) audio.current.effect = effect;
  }, [effect]);

  const refreshPeers = useCallback(() => {
    const now = Date.now();
    for (const [k, p] of peersRef.current) if (now - p.seen > 8000) peersRef.current.delete(k);
    for (const [k, g] of groupsRef.current) if (now - g.lastSeen > 12000) groupsRef.current.delete(k);
    setPeers([...peersRef.current.values()]);
    setGroups([...groupsRef.current.values()]);
  }, []);

  const updateNetwork = useCallback(async () => {
    const info = await fetchNetworkInfo();
    if (info) {
      setNetworkInfo(info);
      if (info.rxActive && info.lastRxSender) {
        setRx(info.lastRxSender);
      } else if (!info.rxActive && talkers.current.size === 0) {
        setRx(null);
      }
      setLevel(info.txLevel / 100);
      if (!info.rxActive) { talkers.current.clear(); setRx(null); }
      if (!info.txActive && st.current.tx && !startingTalk.current) {
        st.current.tx = false; setTx(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!power || !native) return;
    const timer = setInterval(updateNetwork, 150);
    return () => clearInterval(timer);
  }, [power, native, updateNetwork]);

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
      switch (msg.t) {
        case "hello":
          peersRef.current.set(msg.id, {
            id: msg.id,
            name: msg.name,
            freq: msg.freq,
            channel: msg.channel,
            groupName: msg.groupName,
            groupCode: msg.groupCode || msg.channel,
            ip: fromIp || msg.ip,
            seen: Date.now(),
          });
          if (msg.channel) {
            groupsRef.current.set(msg.channel, {
              code: msg.channel,
              name: msg.groupName || `گروه ${msg.channel}`,
              hostName: msg.name,
              hostIp: fromIp || msg.ip,
              lastSeen: Date.now(),
            });
          }
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
          // Do not mix legacy JSON voice with the native v2 stream.
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
      groupName: st.current.groupName,
      groupCode: st.current.channel,
    });
  }, [id, send]);

  // Connect / reconnect transport while powered
  useEffect(() => {
    if (!power || !ready) return;
    const h = { onMessage: handle, onStatus: setStatus, onAudioError: (message: string) => {
      talkIntent.current = false; st.current.tx = false; setTx(false); setError(message);
    } };
    transport.current = createUdpTransport(h);

    const beat = setInterval(() => {
      hello();
      refreshPeers();
      updateNetwork();
    }, 1500);

    const first = setTimeout(() => {
      hello();
      updateNetwork();
    }, 300);

    return () => {
      talkIntent.current = false;
      st.current.tx = false;
      setTx(false);
      clearInterval(beat);
      clearTimeout(first);
      send({ t: "bye", id, freq: st.current.freq, channel: st.current.channel });
      transport.current?.close();
      transport.current = null;
      peersRef.current.clear();
      groupsRef.current.clear();
      talkers.current.clear();
      setRx(null);
      setPeers([]);
      setGroups([]);
    };
  }, [power, ready, handle, hello, refreshPeers, send, id, updateNetwork]);

  useEffect(() => {
    if (power && ready) {
      talkIntent.current = false;
      st.current.tx = false;
      setTx(false);
      transport.current?.setChannelCode(channel, freq).then(hello).catch(() => {});
      hello();
      transport.current?.scan().catch(() => {});
      updateNetwork();
    }
    talkers.current.clear();
    setRx(null);
    audio.current?.rxStatic(false);
  }, [power, ready, name, freq, channel, groupName, hello, updateNetwork]);

  useEffect(() => {
    const close = () => send({ t: "bye", id, freq: st.current.freq, channel: st.current.channel });
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [id, send]);

  const ensureAudio = useCallback(async () => {
    await prepareNativeAudio();
    // Web Audio only plays local feedback; never opens a second microphone or sends voice.
    if (!audio.current) {
      audio.current = new RadioAudio();
      audio.current.setVolume(volume);
      audio.current.effect = effect;
    }
    if (audio.current.ctx.state === "suspended") await audio.current.ctx.resume();
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
      setError("اجازه دسترسی به میکروفون را فعال کنید.");
    }
  }, [power, ensureAudio, updateNetwork]);

  const scanNetwork = useCallback(async () => {
    setNotice("در حال اسکن تمام آی‌پی‌های هات‌اسپات (Subnet Sweep)…");
    try {
      hello();
      await transport.current?.scan();
      hello();
      await updateNetwork();
    } catch {}
    setTimeout(() => setNotice(null), 2500);
  }, [hello, updateNetwork, id]);

  const scanWifi = useCallback(async () => {
    setIsScanningWifi(true);
    setNotice("در حال جستجوی وای‌فای‌ها و هات‌اسپات‌های اطراف…");
    try {
      const list = await scanWifiNetworksNative();
      setWifiList(list);
    } catch {}
    setIsScanningWifi(false);
    setTimeout(() => setNotice(null), 2000);
  }, []);

  const openWifiSettings = useCallback(async () => {
    await openWifiSettingsNative();
  }, []);

  const createGroup = useCallback((customName?: string) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const gName = customName?.trim() || `گروه ${code}`;
    setChannel(code, gName);
    setNotice(`گروه ساخته شد! کد اشتراک: ${code}`);
    setTimeout(() => setNotice(null), 3500);
    hello();
    return code;
  }, [setChannel, hello]);

  const joinGroup = useCallback((code: string, gName?: string) => {
    if (!code) return;
    const cleanCode = code.trim();
    setChannel(cleanCode, gName || `گروه ${cleanCode}`);
    setNotice(`وارد گروه ${cleanCode} شدید`);
    setTimeout(() => setNotice(null), 3000);
    hello();
    scanNetwork();
  }, [setChannel, hello, scanNetwork]);

  const addPeerManual = useCallback(
    async (ip: string) => {
      if (!ip) return;
      await transport.current?.addPeerIp(ip);
      hello();
      await updateNetwork();
      setNotice(`آی‌پی ${ip} اضافه شد`);
      setTimeout(() => setNotice(null), 2500);
    },
    [hello, updateNetwork],
  );

  const pttDown = useCallback(async () => {
    if (!isNativeApp()) { setError("ارتباط صوتی فقط در برنامه نصب‌شده اندروید فعال است."); return; }
    if (!power) { await togglePower(); return; }
    if (st.current.tx || startingTalk.current) return;
    if (rx || talkers.current.size > 0) {
      audio.current?.busy();
      setNotice("کانال مشغول است");
      setTimeout(() => setNotice(null), 1500);
      return;
    }
    talkIntent.current = true;
    startingTalk.current = true;
    setError(null);
    try {
      await ensureAudio();
      if (!talkIntent.current) return;
      const activeTransport = transport.current;
      if (!activeTransport) throw new Error("ارتباط شبکه آماده نیست.");
      await activeTransport.startNativeTx();
      if (!talkIntent.current) { await activeTransport.stopNativeTx(); return; }
      st.current.tx = true;
      setTx(true);
      navigator.vibrate?.(30);
      send({ t: "start", id, name: st.current.name, freq: st.current.freq, channel: st.current.channel });
    } catch (failure) {
      talkIntent.current = false;
      st.current.tx = false; setTx(false);
      setError(failure instanceof Error ? failure.message : "ارسال صدا شروع نشد؛ اجازه میکروفون را بررسی کنید.");
    } finally { startingTalk.current = false; }
  }, [power, rx, togglePower, ensureAudio, id, send]);

  const pttUp = useCallback(() => {
    talkIntent.current = false;
    if (!st.current.tx) return;
    st.current.tx = false;
    transport.current?.stopNativeTx();
    setTx(false);
    setLevel(0);
    send({ t: "end", id, freq: st.current.freq, channel: st.current.channel });
    audio.current?.roger();
    navigator.vibrate?.(20);
  }, [id, send]);

  useEffect(() => {
    const stop = () => { if (document.hidden) pttUp(); };
    window.addEventListener("blur", pttUp);
    document.addEventListener("visibilitychange", stop);
    return () => { window.removeEventListener("blur", pttUp); document.removeEventListener("visibilitychange", stop); };
  }, [pttUp]);

  useEffect(() => () => audio.current?.close(), []);
  const analyser = useCallback(() => audio.current?.analyser ?? null, []);

  return {
    id,
    analyser,
    native,
    power,
    name,
    setName,
    channel,
    setChannel,
    groupName,
    setGroupName,
    freq,
    setFreq,
    volume,
    setVolume,
    effect,
    setEffect,
    status,
    peers,
    groups,
    networkInfo,
    wifiList,
    isScanningWifi,
    tx,
    rx,
    level,
    error,
    notice,
    togglePower,
    scanNetwork,
    scanWifi,
    openWifiSettings,
    createGroup,
    joinGroup,
    addPeerManual,
    pttDown,
    pttUp,
  };
}
