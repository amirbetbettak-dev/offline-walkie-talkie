package com.bisim.udp;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioAttributes;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.Process;
import android.os.SystemClock;
import java.util.Arrays;
import java.util.LinkedHashSet;
import org.json.JSONObject;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@CapacitorPlugin(name = "BisimUdp")
public class BisimUdpPlugin extends Plugin {
    public static final int UDP_PORT = 47474;
    private static final int SAMPLE_RATE = 16000;
    private static final byte MAGIC_BYTE_1 = (byte) 0x42; // 'B'
    private static final byte MAGIC_BYTE_2 = (byte) 0x53; // 'S'
    private static final byte TYPE_AUDIO = 0x01;
    private static final byte TYPE_PING = 0x02;
    private static final byte TYPE_PONG = 0x03;

    private DatagramSocket socket;
    private Thread listenThread;
    private Thread heartbeatThread;
    private volatile boolean running = false;
    private WifiManager.MulticastLock multicastLock;
    private WifiManager.WifiLock wifiLock;
    private int currentPort = UDP_PORT;

    // Telemetry & stats
    private final AtomicLong txPacketsCount = new AtomicLong(0);
    private final AtomicLong rxPacketsCount = new AtomicLong(0);
    private final AtomicLong txBytesCount = new AtomicLong(0);
    private final AtomicLong rxBytesCount = new AtomicLong(0);
    private final AtomicInteger txAudioLevel = new AtomicInteger(0);
    private final AtomicInteger rxAudioLevel = new AtomicInteger(0);
    private volatile String lastRxSender = "";
    private volatile long lastRxTimestamp = 0;

    // Known peers: IP -> PeerRecord
    public static class PeerRecord {
        public String ip;
        public String name = "";
        public String channel = "1";
        public long lastSeen = 0;
        public long pingMs = 0;

        public PeerRecord(String ip) {
            this.ip = ip;
            this.lastSeen = System.currentTimeMillis();
        }
    }
    private final Map<String, PeerRecord> peersMap = new ConcurrentHashMap<>();

    // Native Audio Engine
    private AudioTrack audioTrack;
    private AudioRecord audioRecord;
    private final AtomicBoolean isTransmitting = new AtomicBoolean(false);
    private Thread txThread;
    private volatile int currentChannelHash = VoiceEngine.channelKey("1");
    private volatile String currentChannel = "1";
    private volatile double currentFrequency = 446.00625;
    private volatile float outputVolume = 0.9f;
    private final Map<String, VoiceEngine.JitterBuffer> jitterBuffers = new ConcurrentHashMap<>();
    private Thread playbackThread;
    private AcousticEchoCanceler aec;
    private NoiseSuppressor ns;
    private AutomaticGainControl agc;
    private volatile boolean hardwareAgc, hardwareNs;
    private volatile int wifiRssi = -100;
    private volatile List<InetAddress> audioTargets = Collections.emptyList();
    private volatile List<InetAddress> cachedTargets = Collections.emptyList();
    private volatile Set<String> localAddresses = Collections.emptySet();
    private volatile String networkAddress;
    private final int audioSession = new java.security.SecureRandom().nextInt();
    private final AtomicInteger audioSequence = new AtomicInteger();
    private final ExecutorService sendExecutor = Executors.newSingleThreadExecutor();
    private volatile long lastSweep;

    private int voiceChannel() {
        return VoiceEngine.channelKey(currentChannel) ^ Double.valueOf(currentFrequency).hashCode();
    }
    private final ExecutorService sweepExecutor = Executors.newFixedThreadPool(16);

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", UDP_PORT);
        currentPort = port;
        try {
            stopInternal();

            Context context = getContext();
            WifiManager wm = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                try {
                    multicastLock = wm.createMulticastLock("bisim_multicast");
                    multicastLock.setReferenceCounted(true);
                    multicastLock.acquire();
                } catch (Exception ignored) {}

                try {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "bisim_wifi");
                    wifiLock.setReferenceCounted(true);
                    wifiLock.acquire();
                } catch (Exception ignored) {}
            }

            // Init AudioTrack for loudspeaker
            initAudioTrack();

            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.setReceiveBufferSize(64 * 1024);
            socket.setSendBufferSize(64 * 1024);
            socket.setSoTimeout(1000);
            socket.bind(new InetSocketAddress(port));
            refreshTargets();
            running = true;

            listenThread = new Thread(this::listenLoop, "BisimUdpListener");
            listenThread.start();
            playbackThread = new Thread(this::playbackLoop, "BisimPlayback");
            playbackThread.start();

            heartbeatThread = new Thread(this::heartbeatLoop, "BisimHeartbeat");
            heartbeatThread.start();

            // Initial subnet sweep
            triggerSubnetSweep(null);

            JSObject res = new JSObject();
            res.put("status", "started");
            res.put("port", port);
            call.resolve(res);
        } catch (Exception e) {
            stopInternal();
            call.reject("Failed to start UDP: " + e.getMessage(), e);
        }
    }

    private void initAudioTrack() {
        int min = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new IllegalStateException("Audio output unavailable");
        audioTrack = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(Math.max(min, 1280))
                .setTransferMode(AudioTrack.MODE_STREAM).setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY).build();
        audioTrack.setVolume(outputVolume);
        audioTrack.play();
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) { am.setMode(AudioManager.MODE_IN_COMMUNICATION); am.setSpeakerphoneOn(true); }
    }

    private void playbackLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        long next = SystemClock.elapsedRealtime();
        boolean playing = false;
        while (running) {
            try {
                long now = SystemClock.elapsedRealtime();
                if (now < next) { Thread.sleep(Math.min(20, next - now)); continue; }
                next = now + VoiceEngine.FRAME_MS;
                int[] mix = new int[VoiceEngine.SAMPLES];
                boolean available = false;
                for (Map.Entry<String, VoiceEngine.JitterBuffer> entry : jitterBuffers.entrySet()) {
                    byte[] pcm = entry.getValue().poll(now);
                    if (pcm == null) continue;
                    available = true;
                    for (int i = 0; i < mix.length; i++) mix[i] += (short) ((pcm[2*i] & 255) | (pcm[2*i+1] << 8));
                }
                AudioTrack track = audioTrack;
                if (track == null) continue;
                if (!available) {
                    if (playing) { track.pause(); track.flush(); playing = false; }
                    rxAudioLevel.set(0);
                    continue;
                }
                if (!playing) { track.play(); playing = true; }
                byte[] output = new byte[VoiceEngine.SAMPLES * 2];
                long sum = 0;
                for (int i = 0; i < mix.length; i++) {
                    int value = Math.max(-30000, Math.min(30000, mix[i]));
                    sum += Math.abs(value);
                    output[2*i] = (byte) value; output[2*i+1] = (byte) (value >> 8);
                }
                rxAudioLevel.set((int) Math.min(100, sum / mix.length / 120));
                int written = track.write(output, 0, output.length, AudioTrack.WRITE_NON_BLOCKING);
                if (written < output.length) { track.pause(); track.flush(); track.play(); }
            } catch (InterruptedException e) { break; }
            catch (Exception ignored) {}
        }
    }

    private void refreshTargets() {
        Set<String> locals = new LinkedHashSet<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) locals.add(a.getHostAddress());
            }
        } catch (Exception ignored) {}
        localAddresses = locals;
        Set<InetAddress> targets = new LinkedHashSet<>();
        for (String ip : peersMap.keySet()) try { targets.add(InetAddress.getByName(ip)); } catch (Exception ignored) {}
        audioTargets = new ArrayList<>(targets);
        WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        try { wifiRssi = wm != null && wm.isWifiEnabled() ? wm.getConnectionInfo().getRssi() : -100; }
        catch (Exception ignored) { wifiRssi = -100; }
        targets.addAll(getBroadcastAddresses());
        try { targets.add(InetAddress.getByName("255.255.255.255")); } catch (Exception ignored) {}
        cachedTargets = new ArrayList<>(targets);
    }

    private void listenLoop() {
        byte[] buf = new byte[8192];
        while (running && socket != null && !socket.isClosed()) {
            try {
                DatagramPacket packet = new DatagramPacket(buf, buf.length);
                socket.receive(packet);
                int len = packet.getLength();
                if (len <= 0) continue;

                String from = packet.getAddress().getHostAddress();
                if (from == null || isLocalAddress(from)) continue;

                rxPacketsCount.incrementAndGet();
                rxBytesCount.addAndGet(len);
                

                PeerRecord peer = peersMap.get(from);
                boolean isNew = (peer == null);
                if (isNew) {
                    peer = new PeerRecord(from);
                    peersMap.put(from, peer);
                }
                peer.lastSeen = System.currentTimeMillis();

                byte[] data = packet.getData();
                int offset = packet.getOffset();

                // Check for binary protocol: Magic 'B' 'S'
                if (len >= 8 && data[offset] == MAGIC_BYTE_1 && data[offset + 1] == MAGIC_BYTE_2) {
                    byte type = data[offset + 2];
                    int channel = data[offset + 3] & 0xFF;

                    if (type == VoiceEngine.AUDIO_V2) {
                        VoiceEngine.Frame frame = VoiceEngine.decode(data, offset, len);
                        if (frame != null && frame.channel == voiceChannel() && !isTransmitting.get()) {
                            jitterBuffers.computeIfAbsent(from, key -> new VoiceEngine.JitterBuffer()).offer(frame, SystemClock.elapsedRealtime());
                            lastRxTimestamp = System.currentTimeMillis();
                            lastRxSender = peer.name.isEmpty() ? from : peer.name;
                        }
                    } else if (type == TYPE_AUDIO) {
                        // Legacy PCM is intentionally not mixed with v2: upgrade both phones together.
                    } else if (type == TYPE_PING) {
                        // Reply with PONG directly to sender
                        sendRawPacket(new byte[]{MAGIC_BYTE_1, MAGIC_BYTE_2, TYPE_PONG, (byte) currentChannelHash, 0, 0, 0, 0}, from);
                    }
                } else {
                    // JSON text message (hello / bye / start / end / audio)
                    String text = new String(data, offset, len, StandardCharsets.UTF_8);
                    try {
                        JSONObject message = new JSONObject(text);
                        String type = message.optString("t");
                        if (type.equals("hello") || type.equals("start")) {
                            peer.name = message.optString("name", peer.name);
                            peer.channel = message.optString("channel", peer.channel);
                        }
                        if (type.equals("bye")) peersMap.remove(from);
                    } catch (Exception ignored) {}

                    if (isNew) {
                        JSObject disc = new JSObject();
                        disc.put("peerIp", from);
                        notifyListeners("peerDiscovered", disc);
                    }

                    JSObject ret = new JSObject();
                    ret.put("data", text);
                    ret.put("from", from);
                    notifyListeners("message", ret);
                }
            } catch (Exception e) {
                if (!running) break;
            }
        }
    }

    private void heartbeatLoop() {
        while (running) {
            try {
                Thread.sleep(1000);
                if (!running) break;

                String newAddress = getLocalIpAddress();
                boolean changed = !java.util.Objects.equals(networkAddress, newAddress);
                networkAddress = newAddress;
                refreshTargets();
                if (changed || peersMap.isEmpty()) triggerSubnetSweep(null);
                if (socket == null || socket.isClosed()) {
                    DatagramSocket replacement = new DatagramSocket(null);
                    replacement.setReuseAddress(true); replacement.setBroadcast(true);
                    replacement.setReceiveBufferSize(64 * 1024); replacement.setSoTimeout(1000);
                    replacement.bind(new InetSocketAddress(currentPort)); socket = replacement;
                    if (listenThread == null || !listenThread.isAlive()) {
                        listenThread = new Thread(this::listenLoop, "BisimUdpListener"); listenThread.start();
                    }
                }
                // Ping gateway (hotspot) and all known peers
                String myIp = getLocalIpAddress();
                if (myIp != null) {
                    byte[] ping = new byte[]{MAGIC_BYTE_1, MAGIC_BYTE_2, TYPE_PING, (byte) currentChannelHash, 0, 0, 0, 0};
                    if (myIp.startsWith("192.168.43.")) {
                        sendRawPacket(ping, "192.168.43.1");
                    }
                    for (String peerIp : peersMap.keySet()) {
                        sendRawPacket(ping, peerIp);
                    }
                }

                // Cleanup stale peers (> 8 seconds inactive)
                long now = System.currentTimeMillis();
                peersMap.entrySet().removeIf(entry -> (now - entry.getValue().lastSeen) > 8000);
                jitterBuffers.keySet().removeIf(ip -> !peersMap.containsKey(ip));

                // Reset RX audio level if quiet for > 300ms
                if (now - lastRxTimestamp > 300) {
                    rxAudioLevel.set(0);
                }
            } catch (InterruptedException e) {
                break;
            } catch (Exception ignored) {}
        }
    }

    private synchronized void prepareRecorder() {
        if (audioRecord != null && audioRecord.getState() == AudioRecord.STATE_INITIALIZED) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("اجازه میکروفون را فعال کنید");
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new IllegalStateException("Microphone unavailable");
        audioRecord = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 1280));
        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release(); audioRecord = null; throw new IllegalStateException("Microphone initialization failed");
        }
        int session = audioRecord.getAudioSessionId();
        try { if (AcousticEchoCanceler.isAvailable()) { aec = AcousticEchoCanceler.create(session); if (aec != null) aec.setEnabled(true); } } catch (Exception ignored) {}
        try { if (NoiseSuppressor.isAvailable()) { ns = NoiseSuppressor.create(session); if (ns != null) hardwareNs = ns.setEnabled(true) == 0; } } catch (Exception ignored) {}
        try { if (AutomaticGainControl.isAvailable()) { agc = AutomaticGainControl.create(session); if (agc != null) hardwareAgc = agc.setEnabled(true) == 0; } } catch (Exception ignored) {}
    }

    @PluginMethod
    public void prepareAudio(PluginCall call) {
        try { prepareRecorder(); call.resolve(); } catch (Exception e) { call.reject(e.getMessage(), e); }
    }

    @PluginMethod
    public void configureAudio(PluginCall call) {
        outputVolume = Math.max(0f, Math.min(1f, call.getFloat("volume", 0.9f)));
        if (audioTrack != null) audioTrack.setVolume(outputVolume);
        call.resolve();
    }

    @PluginMethod
    public synchronized void startNativeTx(PluginCall call) {
        if (isTransmitting.get()) { call.resolve(); return; }
        try {
            if (!running || socket == null || socket.isClosed()) throw new IllegalStateException("ارتباط شبکه آماده نیست");
            prepareRecorder();
            AudioRecord recorder = audioRecord;
            recorder.startRecording();
            isTransmitting.set(true);
            jitterBuffers.clear();
            final int channel = voiceChannel();
            txThread = new Thread(() -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
                VoiceEngine.Processor processor = new VoiceEngine.Processor();
                byte[] pcm = new byte[VoiceEngine.SAMPLES * 2];
                byte[] previous = null;
                try {
                    while (isTransmitting.get() && running) {
                        int filled = 0;
                        while (filled < pcm.length && isTransmitting.get()) {
                            int n = recorder.read(pcm, filled, pcm.length - filled, AudioRecord.READ_BLOCKING);
                            if (n <= 0) throw new IllegalStateException("Microphone read failed");
                            filled += n;
                        }
                        if (!isTransmitting.get()) break;
                        txAudioLevel.set(processor.process(pcm, hardwareAgc, hardwareNs));
                        // Piggyback the preceding frame on weak/unknown links; recover isolated loss without retransmit delay.
                        boolean protect = wifiRssi <= -65 || wifiRssi >= 0;
                        byte[] packet = VoiceEngine.packet(audioSession, channel, audioSequence.incrementAndGet(), pcm, protect ? previous : null);
                        sendRawPacketToAll(packet, packet.length);
                        previous = Arrays.copyOf(pcm, pcm.length);
                    }
                } catch (Exception e) {
                    if (isTransmitting.get()) {
                        JSObject failure = new JSObject(); failure.put("message", "ضبط صدا قطع شد؛ دوباره دکمه صحبت را بزنید.");
                        notifyListeners("audioError", failure);
                    }
                } finally {
                    isTransmitting.set(false); txAudioLevel.set(0);
                    try { recorder.stop(); } catch (Exception ignored) {}
                }
            }, "BisimNativeTx");
            txThread.start(); call.resolve();
        } catch (Exception e) { isTransmitting.set(false); call.reject("خطای ارسال صدا: " + e.getMessage(), e); }
    }

    private synchronized void stopTransmitting() {
        isTransmitting.set(false); txAudioLevel.set(0);
        if (audioRecord != null) try { audioRecord.stop(); } catch (Exception ignored) {}
        if (txThread != null) {
            try { txThread.join(250); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            txThread = null;
        }
    }

    @PluginMethod
    public void stopNativeTx(PluginCall call) { stopTransmitting(); call.resolve(); }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        String targetIp = call.getString("targetIp");
        if (data == null) {
            call.reject("Data missing");
            return;
        }

        sendExecutor.execute(() -> {
            try {
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                if (targetIp != null && !targetIp.isEmpty()) {
                    sendRawPacket(bytes, targetIp);
                } else {
                    sendRawPacketToAll(bytes, bytes.length);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Send error: " + e.getMessage(), e);
            }
        });
    }

    private void sendRawPacketToAll(byte[] bytes, int length) {
        try {
            DatagramSocket sendSock = socket;
            if (!running || sendSock == null || sendSock.isClosed()) return;
            boolean voice = length > 2 && bytes[2] == VoiceEngine.AUDIO_V2 && bytes[0] == 'B' && bytes[1] == 'S';
            List<InetAddress> targets = voice && !audioTargets.isEmpty() ? audioTargets : cachedTargets;
            for (InetAddress dest : targets) {
                try {
                    DatagramPacket packet = new DatagramPacket(bytes, length, dest, currentPort);
                    sendSock.send(packet);
                    txPacketsCount.incrementAndGet();
                    txBytesCount.addAndGet(length);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    private void sendRawPacket(byte[] bytes, String ip) {
        try {
            DatagramSocket sendSock = socket;
            if (!running || sendSock == null || sendSock.isClosed()) return;
            InetAddress dest = InetAddress.getByName(ip);
            DatagramPacket packet = new DatagramPacket(bytes, bytes.length, dest, currentPort);
            sendSock.send(packet);
            txPacketsCount.incrementAndGet();
            txBytesCount.addAndGet(bytes.length);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            JSObject res = new JSObject();
            String myIp = getLocalIpAddress();
            res.put("ip", myIp != null ? myIp : "127.0.0.1");
            res.put("isHotspot", myIp != null && myIp.equals("192.168.43.1"));
            res.put("port", currentPort);
            res.put("socketBound", running && socket != null && !socket.isClosed());

            // Wi-Fi info
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            String ssid = "قطع";
            if (wm != null && wm.isWifiEnabled()) {
                WifiInfo winfo = wm.getConnectionInfo();
                if (winfo != null && winfo.getSSID() != null) {
                    ssid = winfo.getSSID().replace("\"", "");
                }
            }
            res.put("ssid", ssid);

            // Peer list
            JSArray peersArr = new JSArray();
            long now = System.currentTimeMillis();
            for (PeerRecord p : peersMap.values()) {
                JSObject po = new JSObject();
                po.put("ip", p.ip);
                po.put("name", p.name.isEmpty() ? p.ip : p.name);
                po.put("channel", p.channel);
                po.put("lastSeenSec", (now - p.lastSeen) / 1000);
                peersArr.put(po);
            }
            res.put("knownPeers", peersArr);
            res.put("peerCount", peersMap.size());

            // Telemetry Counters
            res.put("txActive", isTransmitting.get());
            res.put("txPackets", txPacketsCount.get());
            res.put("txBytes", txBytesCount.get());
            res.put("txLevel", txAudioLevel.get());

            res.put("rxActive", (now - lastRxTimestamp) < 300);
            res.put("rxPackets", rxPacketsCount.get());
            res.put("rxBytes", rxBytesCount.get());
            res.put("rxLevel", rxAudioLevel.get());
            res.put("lastRxSender", lastRxSender);
            res.put("lastRxAgeSec", (now - lastRxTimestamp) / 1000);

            // Permissions
            boolean hasAudio = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            boolean hasLoc = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            res.put("hasAudioPermission", hasAudio);
            res.put("hasLocationPermission", hasLoc);

            call.resolve(res);
        } catch (Exception e) {
            call.reject("Network info error: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void scanWifiNetworks(PluginCall call) {
        try {
            Context ctx = getContext();
            WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) {
                call.reject("وای‌فای در دسترس نیست");
                return;
            }

            try {
                wm.startScan();
            } catch (Exception ignored) {}

            List<ScanResult> results = wm.getScanResults();
            JSArray arr = new JSArray();
            if (results != null) {
                for (ScanResult r : results) {
                    if (r.SSID != null && !r.SSID.isEmpty()) {
                        JSObject obj = new JSObject();
                        obj.put("ssid", r.SSID);
                        obj.put("bssid", r.BSSID);
                        obj.put("level", r.level);
                        obj.put("frequency", r.frequency);
                        obj.put("capabilities", r.capabilities);
                        arr.put(obj);
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("networks", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("خطا در اسکن وای‌فای: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                intent = new Intent(Settings.Panel.ACTION_WIFI);
            } else {
                intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_WIFI_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception ex) {
                call.reject("امکان باز کردن تنظیمات نیست: " + ex.getMessage(), ex);
            }
        }
    }

    @PluginMethod
    public void setChannelCode(PluginCall call) {
        String ch = call.getString("channel", "1");
        try {
            double newFrequency = call.getDouble("frequency", currentFrequency);
            if (currentChannel.equals(ch) && currentFrequency == newFrequency) { call.resolve(); return; }
            stopTransmitting();
            currentChannel = ch;
            currentChannelHash = VoiceEngine.channelKey(ch);
            currentFrequency = newFrequency;
            jitterBuffers.clear();
            if (audioTrack != null) { audioTrack.pause(); audioTrack.flush(); }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void addPeer(PluginCall call) {
        String ip = call.getString("ip");
        if (ip != null && !ip.isEmpty()) {
            peersMap.computeIfAbsent(ip.trim(), PeerRecord::new);
            refreshTargets();
        }
        call.resolve();
    }

    @PluginMethod
    public void scanSubnet(PluginCall call) {
        String data = call.getString("data");
        triggerSubnetSweep(data);
        call.resolve();
    }

    private void triggerSubnetSweep(String optionalData) {
        long now = SystemClock.elapsedRealtime();
        if (!running || isTransmitting.get() || now - lastSweep < 3000) return;
        lastSweep = now;
        new Thread(() -> {
            try {
                String myIp = getLocalIpAddress();
                if (myIp == null || !myIp.contains(".")) return;
                String prefix = myIp.substring(0, myIp.lastIndexOf('.') + 1);

                byte[] packetBytes = (optionalData != null && !optionalData.isEmpty())
                        ? optionalData.getBytes(StandardCharsets.UTF_8)
                        : new byte[]{MAGIC_BYTE_1, MAGIC_BYTE_2, TYPE_PING, (byte) currentChannelHash, 0, 0, 0, 0};

                // Parallel unicast to entire /24 subnet (1..254)
                for (int i = 1; i <= 254; i++) {
                    final String target = prefix + i;
                    if (target.equals(myIp)) continue;
                    sweepExecutor.execute(() -> {
                        try {
                            DatagramSocket s = socket;
                            if (!running || s == null || s.isClosed()) return;
                            s.send(new DatagramPacket(packetBytes, packetBytes.length, InetAddress.getByName(target), currentPort));
                        } catch (Exception ignored) {}
                    });
                }
            } catch (Exception ignored) {}
        }).start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    @PluginMethod
    public void useSpeaker(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(true);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void stopInternal() {
        running = false;
        stopTransmitting();
        if (playbackThread != null) { playbackThread.interrupt();
            try { playbackThread.join(250); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            playbackThread = null;
        }
        jitterBuffers.clear();
        if (aec != null) { aec.release(); aec = null; }
        if (ns != null) { ns.release(); ns = null; }
        if (agc != null) { agc.release(); agc = null; }
        hardwareAgc = false; hardwareNs = false;
        if (audioRecord != null) { try { audioRecord.release(); } catch (Exception ignored) {} audioRecord = null; }
        if (audioTrack != null) {
            try { audioTrack.stop(); audioTrack.release(); } catch (Exception ignored) {}
            audioTrack = null;
        }
        if (socket != null && !socket.isClosed()) {
            socket.close();
            socket = null;
        }
        if (listenThread != null) {
            listenThread.interrupt();
            try { listenThread.join(1100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            listenThread = null;
        }
        if (heartbeatThread != null) {
            heartbeatThread.interrupt();
            try { heartbeatThread.join(250); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            heartbeatThread = null;
        }
        if (multicastLock != null && multicastLock.isHeld()) {
            try { multicastLock.release(); } catch (Exception ignored) {}
            multicastLock = null;
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            try { wifiLock.release(); } catch (Exception ignored) {}
            wifiLock = null;
        }
    }

    private List<InetAddress> getBroadcastAddresses() {
        List<InetAddress> list = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null) list.add(b);
                }
            }
        } catch (Exception ignored) {}
        return list;
    }

    private String getLocalIpAddress() {
        try {
            // First check Wi-Fi and Hotspot interfaces
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                String name = ni.getName().toLowerCase();
                if (name.contains("wlan") || name.contains("ap") || name.contains("swlan") || name.contains("p2p") || name.contains("rndis")) {
                    for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                        InetAddress addr = ia.getAddress();
                        if (addr != null && !addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                            return addr.getHostAddress();
                        }
                    }
                }
            }
            // Fallback to any non-loopback IPv4
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress addr = ia.getAddress();
                    if (addr != null && !addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private boolean isLocalAddress(String ip) {
        return ip.equals("127.0.0.1") || localAddresses.contains(ip);
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        sweepExecutor.shutdownNow();
        sendExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
