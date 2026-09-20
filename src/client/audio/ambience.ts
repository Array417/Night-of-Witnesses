/**
 * Procedural low-cost tavern ambience (fireplace crackle & warm room hum)
 * Uses synthetic web audio noise filtering. Zero audio files or CDN dependencies.
 */
export class ProceduralAmbience {
  private noiseSource: AudioNode | null = null;
  private ambienceGain: GainNode | null = null;
  private isRunning = false;

  private ctx: AudioContext;
  private dest: AudioNode;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.dest = dest;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Generate 2 seconds of pink/brownish noise
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        data[i] = (b0 + b1 + b2) * 0.08;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.dest);

      noise.start();
      this.noiseSource = noise;
      this.ambienceGain = gain;
    } catch {
      this.isRunning = false;
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.noiseSource) {
      try {
        (this.noiseSource as AudioBufferSourceNode).stop();
        this.noiseSource.disconnect();
      } catch {
        // ignore
      }
      this.noiseSource = null;
    }

    if (this.ambienceGain) {
      try {
        this.ambienceGain.disconnect();
      } catch {
        // ignore
      }
      this.ambienceGain = null;
    }
  }

  isPlaying(): boolean {
    return this.isRunning;
  }
}
