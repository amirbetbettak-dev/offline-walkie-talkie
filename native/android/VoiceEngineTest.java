package com.bisim.udp;

import java.util.Arrays;

public final class VoiceEngineTest {
    private static void check(boolean ok, String rule) { if (!ok) throw new AssertionError(rule); }
    private static VoiceEngine.Frame frame(int session, int seq, byte[] pcm, byte[] previous) {
        byte[] p = VoiceEngine.packet(session, VoiceEngine.channelKey("1"), seq, pcm, previous);
        return VoiceEngine.decode(p, 0, p.length);
    }
    public static void main(String[] args) {
        byte[] pcm = new byte[640]; Arrays.fill(pcm, (byte) 12);
        VoiceEngine.Frame f = frame(1, 1, pcm, pcm);
        check(f != null && Arrays.equals(f.pcm, pcm), "PCM payload survives framing");
        check(VoiceEngine.packet(1, 1, 1, pcm, pcm).length <= 1400, "Redundant voice stays below MTU");
        check(VoiceEngine.decode(new byte[20], 0, 20) == null, "Malformed packets rejected");
        check(VoiceEngine.channelKey("Wi-Fi") == VoiceEngine.channelKey("wifi"), "Normalized channels match");
        check(VoiceEngine.channelKey("groupA") != VoiceEngine.channelKey("groupB"), "Distinct groups are isolated");
        VoiceEngine.JitterBuffer b = new VoiceEngine.JitterBuffer();
        b.offer(f, 1000); b.offer(f, 1001);
        check(b.duplicates == 1 && b.queued() == 1, "Multiple routes never double-play voice");
        check(b.poll(1039) == null && Arrays.equals(b.poll(1040), pcm), "Initial playout delay is 40ms");
        b.offer(frame(1, 3, pcm, pcm), 1041);
        check(Arrays.equals(b.poll(1060), pcm) && b.recovered == 1, "Previous frame repairs an isolated packet loss");
        check(Arrays.equals(b.poll(1080), pcm), "Sequence order preserved");
        byte[] concealed = b.poll(1100);
        check(concealed != null && !Arrays.equals(concealed, pcm), "Lost speech fades rather than repeats at full volume");
        for (int i = 4; i < 30; i++) b.offer(frame(1, i, pcm, null), 1100 + i * 20);
        check(b.queued() <= 6, "At most 120ms can accumulate");
        check(b.poll(2000) != null && b.queued() <= 3, "Scheduler stall discards old audio");
        b.offer(frame(2, 1, pcm, null), 2100);
        check(Arrays.equals(b.poll(2140), pcm), "New sender session restarts cleanly");
        check(b.poll(2500) == null, "Playback stops after sender vanishes");
        long rejected = b.duplicates;
        b.offer(frame(1, 31, pcm, null), 2510);
        check(b.duplicates == rejected + 1 && b.queued() == 0, "Retired session cannot replay old audio");
        b.clear(); b.offer(frame(3, 1, pcm, null), 3000); b.offer(frame(3, 3, pcm, null), 3020); b.offer(frame(3, 2, pcm, null), 3021);
        check(Arrays.equals(b.poll(3040), pcm) && Arrays.equals(b.poll(3060), pcm), "Reordered packets play in order");
        VoiceEngine.JitterBuffer silence = new VoiceEngine.JitterBuffer();
        silence.offer(frame(9, 1, pcm, null), 1000);
        silence.poll(1040); silence.poll(1060); silence.poll(1080);
        silence.offer(frame(9, 2, pcm, null), 1110);
        check(Arrays.equals(silence.poll(1110), pcm), "Short PTT pause never consumes unsent sequence numbers");
        VoiceEngine.Processor processor = new VoiceEngine.Processor();
        byte[] signal = new byte[640];
        double before = 0, after = 0;
        for (int frame = 0; frame < 150; frame++) {
            for (int i = 0; i < 320; i++) {
                short x = (short) (1600 * Math.sin(2 * Math.PI * 600 * i / 16000));
                signal[2*i] = (byte) x; signal[2*i+1] = (byte) (x >> 8);
                if (frame == 149) before += x * (double)x;
            }
            processor.process(signal, false, false);
        }
        for (int i = 0; i < 320; i++) { short x = (short)((signal[2*i]&255)|(signal[2*i+1]<<8)); after += x*(double)x; }
        check(after > before * 2, "Quiet speech is amplified");
        Arrays.fill(signal, (byte) 127); processor.process(signal, false, false);
        for (int i = 0; i < 320; i++) { short x = (short)((signal[2*i]&255)|(signal[2*i+1]<<8)); check(Math.abs((int)x) <= 30000, "Limiter never clips or wraps PCM"); }
        for (int i = 0; i < 200; i++) { for (int j = 0; j < 320; j++) { signal[2*j] = (byte) 0x10; signal[2*j+1] = 0x27; } processor.process(signal, true, true); }
        short dc = (short)((signal[638]&255)|(signal[639]<<8));
        check(Math.abs((int)dc) < 5, "Wind/DC rumble attenuated by high-pass filter");
        System.out.println("VoiceEngine: all real engine regression checks passed");
    }
}
