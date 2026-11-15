import { SAMPLE_RATE } from "./protocol";

/** Mic capture + radio-style playback chain built on Web Audio. */
export class RadioAudio {
  ctx: AudioContext;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private master: GainNode;
  private fxIn: GainNode;
  private dryIn: GainNode;
  private noise: GainNode;
  private nextTime = new Map<string, number>();
  analyser: AnalyserNode;
  effect = true;

  constructor() {
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.master = c.createGain();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(this.analyser).connect(c.destination);

    // Radio effect: narrow band-pass + soft clipping
    this.fxIn = c.createGain();
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 350;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3.5) / Math.tanh(3.5);
    }
    shaper.curve = curve;
    const post = c.createGain();
    post.gain.value = 0.8;
    this.fxIn.connect(hp).connect(lp).connect(shaper).connect(post).connect(this.master);

    this.dryIn = c.createGain();
    this.dryIn.connect(this.master);

    // Background static while receiving
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource();
    ns.buffer = buf;
    ns.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.6;
    this.noise = c.createGain();
    this.noise.gain.value = 0;
    ns.connect(bp).connect(this.noise).connect(this.master);
    ns.start();
  }

  setVolume(v: number) {
    this.master.gain.value = v;
  }

  async initMic() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
  }

  startCapture(onFrame: (pcm: Int16Array) => void, onLevel: (l: number) => void) {
    if (!this.stream) return;
    this.stopCapture();
    const c = this.ctx;
    this.src = c.createMediaStreamSource(this.stream);
    this.proc = c.createScriptProcessor(2048, 1, 1);
    const ratio = c.sampleRate / SAMPLE_RATE;
    this.proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const out = new Int16Array(outLen);
      let sum = 0;
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));
        let acc = 0;
        for (let j = start; j < end; j++) acc += input[j] ?? 0;
        const s = Math.max(-1, Math.min(1, acc / Math.max(1, end - start)));
        sum += s * s;
        out[i] = s * 0x7fff;
      }
      onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, outLen)) * 4));
      onFrame(out);
    };
    const mute = c.createGain();
    mute.gain.value = 0;
    this.src.connect(this.proc).connect(mute).connect(c.destination);
  }

  stopCapture() {
    this.proc?.disconnect();
    this.src?.disconnect();
    this.proc = null;
    this.src = null;
  }

  playFrame(sender: string, pcm: Int16Array) {
    const c = this.ctx;
    if (!pcm.length) return;
    const buf = c.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) / 0x7fff;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(this.effect ? this.fxIn : this.dryIn);
    const t = Math.max(c.currentTime + 0.12, this.nextTime.get(sender) ?? 0);
    s.start(t);
    this.nextTime.set(sender, t + buf.duration);
  }

  /** Seconds of audio still queued for a sender. */
  pending(sender: string) {
    return Math.max(0, (this.nextTime.get(sender) ?? 0) - this.ctx.currentTime);
  }

  rxStatic(on: boolean) {
    const g = this.noise.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(on && this.effect ? 0.025 : 0, this.ctx.currentTime, 0.03);
  }

  squelchTail() {
    if (!this.effect) return;
    const g = this.noise.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.2, t);
    g.exponentialRampToValueAtTime(0.0001, t + 0.22);
    g.setValueAtTime(0, t + 0.23);
  }

  private tone(freq: number, start: number, dur: number, vol = 0.12, type: OscillatorType = "sine") {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.005);
    g.gain.setValueAtTime(vol, start + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  chirp() {
    this.tone(1400, this.ctx.currentTime, 0.05);
  }

  roger() {
    const t = this.ctx.currentTime;
    this.tone(1200, t, 0.07);
    this.tone(850, t + 0.08, 0.09);
  }

  busy() {
    const t = this.ctx.currentTime;
    this.tone(420, t, 0.12, 0.12, "square");
    this.tone(420, t + 0.18, 0.12, 0.12, "square");
  }

  close() {
    this.stopCapture();
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.ctx.close();
  }
}
