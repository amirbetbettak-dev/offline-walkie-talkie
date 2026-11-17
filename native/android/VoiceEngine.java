package com.bisim.udp;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.TreeMap;

/** Android-independent, bounded real-time PCM transport and gentle speech processing. */
public final class VoiceEngine {
    public static final int SAMPLES = 320;
    public static final int FRAME_MS = 20;
    public static final int HEADER = 20;
    public static final int MAX_DELAY_MS = 120;
    public static final byte AUDIO_V2 = 4;

    public static int channelKey(String value) {
        return value.trim().toLowerCase(java.util.Locale.ROOT).replaceAll("[\\s_-]", "").hashCode();
    }

    public static byte[] packet(int session, int channel, int sequence, byte[] pcm, byte[] previous) {
        int extra = previous == null ? 0 : previous.length;
        ByteBuffer b = ByteBuffer.allocate(HEADER + pcm.length + extra).order(ByteOrder.BIG_ENDIAN);
        b.put((byte) 'B').put((byte) 'S').put(AUDIO_V2).put((byte) (extra > 0 ? 1 : 0));
        b.putInt(session).putInt(channel).putInt(sequence).putShort((short) pcm.length).putShort((short) extra);
        b.put(pcm);
        if (previous != null) b.put(previous);
        return b.array();
    }

    public static final class Frame {
        public final int session, channel, sequence;
        public final byte[] pcm, previous;
        private Frame(int session, int channel, int sequence, byte[] pcm, byte[] previous) {
            this.session = session; this.channel = channel; this.sequence = sequence;
            this.pcm = pcm; this.previous = previous;
        }
    }

    public static Frame decode(byte[] data, int offset, int length) {
        if (length < HEADER || offset < 0 || offset + length > data.length) return null;
        ByteBuffer b = ByteBuffer.wrap(data, offset, length).order(ByteOrder.BIG_ENDIAN);
        if (b.get() != 'B' || b.get() != 'S' || b.get() != AUDIO_V2) return null;
        b.get();
        int session = b.getInt(), channel = b.getInt(), sequence = b.getInt();
        int size = b.getShort() & 65535, extra = b.getShort() & 65535;
        if (size != SAMPLES * 2 || (extra != 0 && extra != size) || length != HEADER + size + extra) return null;
        byte[] pcm = new byte[size]; b.get(pcm);
        byte[] previous = extra == 0 ? null : new byte[extra];
        if (previous != null) b.get(previous);
        return new Frame(session, channel, sequence, pcm, previous);
    }

    public static final class JitterBuffer {
        private final TreeMap<Integer, byte[]> queue = new TreeMap<>();
        private int expected, session;
        private boolean active, initialized;
        private final java.util.Set<Integer> retiredSessions = new java.util.HashSet<>();
        private long due, lastArrival;
        private int lastSequence, missing;
        private double jitter;
        private byte[] last;
        public long lost, recovered, duplicates;

        public synchronized void offer(Frame frame, long now) {
            if (retiredSessions.contains(frame.session)) { duplicates++; return; }
            if (initialized && session == frame.session && frame.sequence < expected) { duplicates++; return; }
            if (!active || session != frame.session || now - lastArrival > 250) {
                if (initialized && session != frame.session) { retiredSessions.add(session); jitter = 0; }
                if (retiredSessions.size() > 32) retiredSessions.clear();
                queue.clear(); session = frame.session; expected = frame.sequence;
                int delay = Math.max(20, Math.min(80, (int) (40 + jitter * 2)));
                due = now + delay; active = true; initialized = true; last = null; missing = 0; lastSequence = frame.sequence;
            } else {
                int distance = frame.sequence - lastSequence;
                if (distance > 0) jitter += (Math.abs(now - lastArrival - distance * FRAME_MS) - jitter) / 16;
            }
            if (queue.containsKey(frame.sequence)) { duplicates++; return; }
            if (frame.previous != null && frame.sequence - 1 >= expected && !queue.containsKey(frame.sequence - 1)) {
                queue.put(frame.sequence - 1, frame.previous); recovered++;
            }
            queue.put(frame.sequence, frame.pcm);
            lastArrival = now; lastSequence = Math.max(lastSequence, frame.sequence);
            // Never retain more than 120ms of old speech, even after a long scheduler stall.
            while (queue.size() > MAX_DELAY_MS / FRAME_MS) queue.pollFirstEntry();
            if (!queue.isEmpty() && queue.firstKey() - expected > MAX_DELAY_MS / FRAME_MS) {
                expected = queue.firstKey(); due = now;
            }
        }

        public synchronized byte[] poll(long now) {
            if (!active || now < due) return null;
            if (now - lastArrival > 180 && queue.isEmpty()) { clear(); return null; }
            int targetFrames = Math.max(2, Math.min(4, (int) Math.ceil((40 + jitter * 2) / FRAME_MS)));
            if (queue.size() > targetFrames + 1 || now - due > MAX_DELAY_MS) {
                while (queue.size() > targetFrames) queue.pollFirstEntry();
                if (!queue.isEmpty()) expected = queue.firstKey();
                due = now;
            }
            byte[] pcm = queue.remove(expected);
            // Silence is not packet loss: do not consume sequence numbers after PTT ends.
            if (pcm != null || !queue.isEmpty()) expected++;
            queue.headMap(expected).clear();
            due += FRAME_MS;
            if (pcm != null) { last = pcm; missing = 0; return pcm; }
            lost++; missing++;
            byte[] concealed = new byte[SAMPLES * 2];
            if (last != null && missing <= 3) {
                double fade = Math.pow(0.55, missing);
                for (int i = 0; i < SAMPLES; i++) {
                    short sample = (short) ((last[i * 2] & 255) | (last[i * 2 + 1] << 8));
                    short scaled = (short) (sample * fade);
                    concealed[i * 2] = (byte) scaled; concealed[i * 2 + 1] = (byte) (scaled >> 8);
                }
            }
            return concealed;
        }
        public synchronized void clear() { queue.clear(); active = false; last = null; lastSequence = 0; }
        public synchronized int queued() { return queue.size(); }
    }

    public static final class Processor {
        private double input, highpass, gain = 1, noise = 100, attenuation = 1;
        private final double[] samples = new double[SAMPLES];
        public int process(byte[] pcm, boolean hardwareAgc, boolean hardwareNs) {
            double sum = 0;
            if (pcm.length != SAMPLES * 2) throw new IllegalArgumentException("Expected 20ms PCM frame");
            for (int i = 0; i < samples.length; i++) {
                short x = (short) ((pcm[i * 2] & 255) | (pcm[i * 2 + 1] << 8));
                highpass = 0.969 * (highpass + x - input); input = x;
                samples[i] = highpass; sum += highpass * highpass;
            }
            double rms = Math.sqrt(sum / Math.max(1, samples.length));
            if (rms < noise * 1.8) noise += (rms - noise) * 0.01;
            noise = Math.max(40, Math.min(600, noise));
            double target = rms > Math.max(250, noise * 2) ? Math.min(hardwareAgc ? 1.25 : 2.5, 5000 / rms) : 1;
            gain += (target - gain) * (target < gain ? 0.35 : 0.025);
            double quiet = !hardwareNs && rms < noise * 1.5 ? 0.4 : 1;
            attenuation += (quiet - attenuation) * 0.25;
            for (int i = 0; i < samples.length; i++) {
                double x = samples[i] * gain * attenuation;
                // Soft knee limiter; normal speech remains linear and natural.
                double a = Math.abs(x);
                if (a > 26000) x = Math.signum(x) * (26000 + 4000 * Math.tanh((a - 26000) / 4000));
                short out = (short) Math.max(-30000, Math.min(30000, x));
                pcm[i * 2] = (byte) out; pcm[i * 2 + 1] = (byte) (out >> 8);
            }
            return (int) Math.min(100, rms * gain / 120);
        }
    }
    private VoiceEngine() {}
}
