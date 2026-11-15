package com.bisim.udp;

import android.content.Context;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BisimUdp")
public class BisimUdpPlugin extends Plugin {
    private DatagramSocket socket;
    private Thread listenThread;
    private volatile boolean running = false;
    private WifiManager.MulticastLock multicastLock;
    private int currentPort = 47474;

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 47474);
        currentPort = port;
        try {
            stopInternal();

            Context context = getContext();
            WifiManager wm = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("bisim_multicast");
                multicastLock.setReferenceCounted(true);
                multicastLock.acquire();
            }

            socket = new DatagramSocket(port);
            socket.setBroadcast(true);
            running = true;

            listenThread = new Thread(() -> {
                byte[] buf = new byte[8192];
                while (running && socket != null && !socket.isClosed()) {
                    try {
                        DatagramPacket packet = new DatagramPacket(buf, buf.length);
                        socket.receive(packet);
                        String data = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
                        String from = packet.getAddress().getHostAddress();

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
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to start UDP: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Data missing");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                DatagramSocket sendSock = (socket != null && !socket.isClosed()) ? socket : new DatagramSocket();
                sendSock.setBroadcast(true);

                InetAddress broadcastAddr = InetAddress.getByName("255.255.255.255");
                DatagramPacket packet = new DatagramPacket(bytes, bytes.length, broadcastAddr, currentPort);
                sendSock.send(packet);
                call.resolve();
            } catch (Exception e) {
                call.reject("Send error: " + e.getMessage(), e);
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
            multicastLock.release();
            multicastLock = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
