package com.bisim.udp;

import android.content.Context;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "BisimUdp")
public class BisimUdpPlugin extends Plugin {
    private DatagramSocket socket;
    private Thread listenThread;
    private volatile boolean running = false;
    private WifiManager.MulticastLock multicastLock;
    private WifiManager.WifiLock wifiLock;
    private int currentPort = 47474;
    private final Set<String> knownPeerIps = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 47474);
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

            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(port));
            running = true;

            listenThread = new Thread(() -> {
                byte[] buf = new byte[8192];
                while (running && socket != null && !socket.isClosed()) {
                    try {
                        DatagramPacket packet = new DatagramPacket(buf, buf.length);
                        socket.receive(packet);
                        String data = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
                        String from = packet.getAddress().getHostAddress();

                        if (from != null && !isLocalAddress(from)) {
                            boolean isNew = knownPeerIps.add(from);
                            if (isNew) {
                                JSObject disc = new JSObject();
                                disc.put("peerIp", from);
                                notifyListeners("peerDiscovered", disc);
                            }
                        }

                        JSObject ret = new JSObject();
                        ret.put("data", data);
                        ret.put("from", from);
                        notifyListeners("message", ret);
                    } catch (Exception e) {
                        if (!running) break;
                    }
                }
            });
            listenThread.start();

            JSObject res = new JSObject();
            res.put("status", "started");
            res.put("port", port);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to start UDP: " + e.getMessage(), e);
        }
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
                DatagramSocket sendSock = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
                sendSock.setBroadcast(true);

                Set<InetAddress> targets = new HashSet<>();

                // 1. Explicit target IP
                if (targetIp != null && !targetIp.isEmpty()) {
                    try {
                        targets.add(InetAddress.getByName(targetIp));
                    } catch (Exception ignored) {}
                }

                // 2. All discovered peers via direct unicast (reliable on Android hotspots)
                for (String peerIp : knownPeerIps) {
                    try {
                        targets.add(InetAddress.getByName(peerIp));
                    } catch (Exception ignored) {}
                }

                // 3. Subnet broadcast addresses from network interfaces
                List<InetAddress> broadcasts = getBroadcastAddresses();
                targets.addAll(broadcasts);

                // 4. Global broadcast
                try {
                    targets.add(InetAddress.getByName("255.255.255.255"));
                } catch (Exception ignored) {}

                // 5. Special hotspot handling: if on 192.168.43.x, always include gateway 192.168.43.1
                String myIp = getLocalIpAddress();
                if (myIp != null && myIp.startsWith("192.168.43.")) {
                    try {
                        targets.add(InetAddress.getByName("192.168.43.1"));
                    } catch (Exception ignored) {}
                }

                for (InetAddress dest : targets) {
                    try {
                        DatagramPacket packet = new DatagramPacket(bytes, bytes.length, dest, currentPort);
                        sendSock.send(packet);
                    } catch (Exception ignored) {}
                }

                call.resolve();
            } catch (Exception e) {
                call.reject("Send error: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            JSObject res = new JSObject();
            String myIp = getLocalIpAddress();
            res.put("ip", myIp != null ? myIp : "127.0.0.1");
            res.put("isHotspot", myIp != null && myIp.equals("192.168.43.1"));

            JSArray peers = new JSArray();
            for (String peer : knownPeerIps) {
                peers.put(peer);
            }
            res.put("knownPeers", peers);

            JSArray bcasts = new JSArray();
            for (InetAddress b : getBroadcastAddresses()) {
                bcasts.put(b.getHostAddress());
            }
            res.put("broadcasts", bcasts);

            call.resolve(res);
        } catch (Exception e) {
            call.reject("Network info error: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void addPeer(PluginCall call) {
        String ip = call.getString("ip");
        if (ip != null && !ip.isEmpty()) {
            knownPeerIps.add(ip.trim());
        }
        call.resolve();
    }

    @PluginMethod
    public void scanSubnet(PluginCall call) {
        String data = call.getString("data");
        new Thread(() -> {
            try {
                String myIp = getLocalIpAddress();
                if (myIp != null && myIp.contains(".")) {
                    String prefix = myIp.substring(0, myIp.lastIndexOf('.') + 1);
                    byte[] packetBytes = (data != null && !data.isEmpty())
                            ? data.getBytes(StandardCharsets.UTF_8)
                            : "{\"t\":\"ping\"}".getBytes(StandardCharsets.UTF_8);

                    DatagramSocket s = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
                    s.setBroadcast(true);

                    // 1. Gateway (1)
                    try {
                        s.send(new DatagramPacket(packetBytes, packetBytes.length, InetAddress.getByName(prefix + "1"), currentPort));
                    } catch (Exception ignored) {}

                    // 2. Early range 2..35 (typical client range)
                    for (int i = 2; i <= 35; i++) {
                        try {
                            String target = prefix + i;
                            if (!target.equals(myIp)) {
                                s.send(new DatagramPacket(packetBytes, packetBytes.length, InetAddress.getByName(target), currentPort));
                            }
                        } catch (Exception ignored) {}
                    }

                    // 3. High DHCP range 100..140 (Samsung/Xiaomi typical)
                    for (int i = 100; i <= 140; i++) {
                        try {
                            String target = prefix + i;
                            if (!target.equals(myIp)) {
                                s.send(new DatagramPacket(packetBytes, packetBytes.length, InetAddress.getByName(target), currentPort));
                            }
                        } catch (Exception ignored) {}
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.resolve();
            }
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
        if (socket != null && !socket.isClosed()) {
            socket.close();
            socket = null;
        }
        if (listenThread != null) {
            listenThread.interrupt();
            listenThread = null;
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
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                String name = ni.getName().toLowerCase();
                if (name.contains("wlan") || name.contains("ap") || name.contains("swlan") || name.contains("p2p")) {
                    for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                        InetAddress addr = ia.getAddress();
                        if (addr != null && !addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                            return addr.getHostAddress();
                        }
                    }
                }
            }
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
        super.handleOnDestroy();
    }
}
