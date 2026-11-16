package com.bisim.udp;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
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
    private int currentChannelHash = 1;
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
            socket.bind(new InetSocketAddress(port));
            running = true;

            listenThread = new Thread(this::listenLoop, "BisimUdpListener");
            listenThread.start();

            heartbeatThread = new Thread(this::heartbeatLoop, "BisimHeartbeat");
            heartbeatThread.start();

            // Initial subnet sweep
            triggerSubnetSweep(null);

            JSObject res = new JSObject();
            res.put("status", "started");
            res.put("port", port);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to start UDP: " + e.getMessage(), e);
        }
    }

    private void initAudioTrack() {
        try {
            int bufferSize = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            if (bufferSize < 4096) bufferSize = 4096;

            audioTrack = new AudioTrack(
                    AudioManager.STREAM_MUSIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 2,
                    AudioTrack.MODE_STREAM
            );
            audioTrack.play();

            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(true);
            }
        } catch (Exception ignored) {}
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
                lastRxTimestamp = System.currentTimeMillis();

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

                    if (type == TYPE_AUDIO) {
                        int pcmLen = len - 8;
                        if (pcmLen > 0 && audioTrack != null) {
                            audioTrack.write(data, offset + 8, pcmLen);

                            // Calculate RMS volume level (0-100)
                            int sum = 0;
                            int count = pcmLen / 2;
                            for (int i = 0; i < count; i++) {
                                int sample = (data[offset + 8 + i * 2] & 0xFF) | (data[offset + 8 + i * 2 + 1] << 8);
                                sum += Math.abs(sample);
                            }
                            int avg = count > 0 ? sum / count : 0;
                            rxAudioLevel.set(Math.min(100, avg / 120));
                            lastRxSender = from;
                        }
                    } else if (type == TYPE_PING) {
                        // Reply with PONG directly to sender
                        sendRawPacket(new byte[]{MAGIC_BYTE_1, MAGIC_BYTE_2, TYPE_PONG, (byte) currentChannelHash, 0, 0, 0, 0}, from);
                    }
                } else {
                    // JSON text message (hello / bye / start / end / audio)
                    String text = new String(data, offset, len, StandardCharsets.UTF_8);
                    try {
                        if (text.contains("\"t\":\"hello\"") || text.contains("\"t\":\"start\"")) {
                            if (text.contains("\"name\":\"")) {
                                int s = text.indexOf("\"name\":\"") + 8;
                                int e = text.indexOf("\"", s);
                                if (s > 7 && e > s) peer.name = text.substring(s, e);
                            }
                            if (text.contains("\"channel\":\"")) {
                                int s = text.indexOf("\"channel\":\"") + 11;
                                int e = text.indexOf("\"", s);
                                if (s > 10 && e > s) peer.channel = text.substring(s, e);
                            }
                        }
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
                Thread.sleep(2000);
                if (!running) break;

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

                // Reset RX audio level if quiet for > 300ms
                if (now - lastRxTimestamp > 300) {
                    rxAudioLevel.set(0);
                }
            } catch (InterruptedException e) {
                break;
            } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void startNativeTx(PluginCall call) {
        if (isTransmitting.get()) {
            call.resolve();
            return;
        }

        try {
            int minBuf = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            int bufSize = Math.max(minBuf, 4096);

            Context ctx = getContext();
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                call.reject("میکروفون اجازه ندارد");
                return;
            }

            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufSize
            );

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                call.reject("خطا در راه‌اندازی ضبط صدا");
                return;
            }

            audioRecord.startRecording();
            isTransmitting.set(true);

            txThread = new Thread(() -> {
                byte[] pcmBuf = new byte[640]; // 20ms frames at 16000Hz (320 samples * 2 bytes)
                byte[] packetBuf = new byte[648]; // 8 bytes header + 640 bytes PCM
                packetBuf[0] = MAGIC_BYTE_1;
                packetBuf[1] = MAGIC_BYTE_2;
                packetBuf[2] = TYPE_AUDIO;
                packetBuf[3] = (byte) currentChannelHash;

                int seq = 0;
                while (isTransmitting.get() && audioRecord != null && audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    int read = audioRecord.read(pcmBuf, 0, pcmBuf.length);
                    if (read > 0) {
                        seq++;
                        packetBuf[4] = (byte) ((seq >> 24) & 0xFF);
                        packetBuf[5] = (byte) ((seq >> 16) & 0xFF);
                        packetBuf[6] = (byte) ((seq >> 8) & 0xFF);
                        packetBuf[7] = (byte) (seq & 0xFF);
                        System.arraycopy(pcmBuf, 0, packetBuf, 8, read);

                        // Calculate TX volume level (0-100)
                        int sum = 0;
                        int count = read / 2;
                        for (int i = 0; i < count; i++) {
                            int sample = (pcmBuf[i * 2] & 0xFF) | (pcmBuf[i * 2 + 1] << 8);
                            sum += Math.abs(sample);
                        }
                        int avg = count > 0 ? sum / count : 0;
                        txAudioLevel.set(Math.min(100, avg / 120));

                        // Broadcast & unicast to peers
                        sendRawPacketToAll(packetBuf, read + 8);
                    }
                }
                txAudioLevel.set(0);
            }, "BisimNativeTx");
            txThread.start();

            call.resolve();
        } catch (Exception e) {
            isTransmitting.set(false);
            call.reject("خطای ارسال صدا: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopNativeTx(PluginCall call) {
        isTransmitting.set(false);
        txAudioLevel.set(0);
        if (audioRecord != null) {
            try {
                audioRecord.stop();
                audioRecord.release();
            } catch (Exception ignored) {}
            audioRecord = null;
        }
        if (txThread != null) {
            txThread.interrupt();
            txThread = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        String targetIp = call.getString("targetIp");
        if (data == null) {
            call.reject("Data missing");
            return;
        }

        new Thread(() -> {
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
        }).start();
    }

    private void sendRawPacketToAll(byte[] bytes, int length) {
        try {
            DatagramSocket sendSock = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
            sendSock.setBroadcast(true);

            List<InetAddress> targets = new ArrayList<>();

            // 1. Direct unicast to all known peers
            for (String peerIp : peersMap.keySet()) {
                try { targets.add(InetAddress.getByName(peerIp)); } catch (Exception ignored) {}
            }

            // 2. Subnet broadcast
            targets.addAll(getBroadcastAddresses());

            // 3. Global broadcast
            try { targets.add(InetAddress.getByName("255.255.255.255")); } catch (Exception ignored) {}

            // 4. Hotspot gateway
            String myIp = getLocalIpAddress();
            if (myIp != null && myIp.startsWith("192.168.43.")) {
                try { targets.add(InetAddress.getByName("192.168.43.1")); } catch (Exception ignored) {}
            }

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
            DatagramSocket sendSock = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
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
            currentChannelHash = Math.abs(ch.hashCode() % 250) + 1;
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void addPeer(PluginCall call) {
        String ip = call.getString("ip");
        if (ip != null && !ip.isEmpty()) {
            peersMap.put(ip.trim(), new PeerRecord(ip.trim()));
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
                            DatagramSocket s = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
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
        isTransmitting.set(false);
        if (txThread != null) {
            txThread.interrupt();
            txThread = null;
        }
        if (audioRecord != null) {
            try { audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
        }
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
            listenThread = null;
        }
        if (heartbeatThread != null) {
            heartbeatThread.interrupt();
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
        String myIp = getLocalIpAddress();
        return ip.equals("127.0.0.1") || (myIp != null && ip.equals(myIp));
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        sweepExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
