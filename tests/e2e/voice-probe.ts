/**
 * Native WebRTC probe helpers for e2e voice tests.
 *
 * Records (never replaces) native getUserMedia calls and RTCPeerConnections
 * via an init script, and measures transport stats plus remote audio energy.
 * The ONLY synthetic input is the browser's fake capture device; every media
 * object measured here is created by the real native stack.
 */
import type { Page } from '@playwright/test';
import fs from 'node:fs';

export interface ProbeStats {
  readonly gumCalls: number;
  readonly pcCount: number;
  readonly pcStates: readonly string[];
  readonly inboundBytes: number;
}

export interface EnergySample {
  readonly sinks: number;
  readonly liveSinks: number;
  readonly rms: number;
}

declare global {
  interface Window {
    __VOICE_PROBE__?: { gumCalls: number };
    __VOICE_STREAMS__?: MediaStream[];
    __VOICE_PCS__?: RTCPeerConnection[];
  }
}

/** Looping 440Hz tone so the fake capture device always carries energy. */
export function writeToneWav(filePath: string): void {
  const sampleRate = 48000;
  const seconds = 5;
  const frames = sampleRate * seconds;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    data.writeInt16LE(sample, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

/** Records native media objects without changing any behavior. */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window;
    if (w.__VOICE_PROBE__) return;
    w.__VOICE_PROBE__ = { gumCalls: 0 };
    w.__VOICE_STREAMS__ = [];
    w.__VOICE_PCS__ = [];
    const origGetUserMedia = w.navigator.mediaDevices?.getUserMedia?.bind(w.navigator.mediaDevices);
    if (origGetUserMedia) {
      w.navigator.mediaDevices.getUserMedia = async (...args: Parameters<MediaDevices['getUserMedia']>) => {
        const probe = w.__VOICE_PROBE__;
        if (probe) probe.gumCalls += 1;
        const stream = await origGetUserMedia(...args);
        w.__VOICE_STREAMS__?.push(stream);
        return stream;
      };
    }
    const OrigPC = w.RTCPeerConnection;
    if (OrigPC) {
      function Wrapped(
        this: unknown,
        ...args: ConstructorParameters<typeof RTCPeerConnection>
      ): RTCPeerConnection {
        const pc = new OrigPC(...args);
        w.__VOICE_PCS__?.push(pc);
        return pc;
      }
      Wrapped.prototype = OrigPC.prototype;
      Object.setPrototypeOf(Wrapped, OrigPC);
      w.RTCPeerConnection = Wrapped as unknown as typeof RTCPeerConnection;
    }
  });
}

export async function probeStats(page: Page): Promise<ProbeStats> {
  return page.evaluate(async () => {
    const pcs = window.__VOICE_PCS__ ?? [];
    let inboundBytes = 0;
    const pcStates: string[] = [];
    for (const pc of pcs) {
      pcStates.push(pc.connectionState);
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            const bytes = (report as RTCInboundRtpStreamStats).bytesReceived;
            if (typeof bytes === 'number') inboundBytes += bytes;
          }
        });
      } catch {
        // A closing PC may reject getStats; states still tell the story.
      }
    }
    return {
      gumCalls: window.__VOICE_PROBE__?.gumCalls ?? -1,
      pcCount: pcs.length,
      pcStates,
      inboundBytes,
    };
  });
}

/**
 * Peak RMS summed across every live remote sink. Summing (rather than picking
 * one sink) keeps the measurement deterministic no matter which peer speaks:
 * silent peers contribute ~0 regardless of sink ordering.
 */
export async function remoteEnergy(page: Page): Promise<EnergySample> {
  return page.evaluate(async () => {
    const audios = [...document.querySelectorAll<HTMLAudioElement>('audio[data-voice-peer]')];
    const live = audios.filter((a) => a.srcObject instanceof MediaStream);
    if (live.length === 0) return { sinks: audios.length, liveSinks: 0, rms: -1 };
    const ctx = new AudioContext();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      for (const audio of live) {
        ctx.createMediaStreamSource(audio.srcObject as MediaStream).connect(analyser);
      }
      const buffer = new Float32Array(analyser.fftSize);
      let peak = 0;
      for (let round = 0; round < 6; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) sum += value * value;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      return { sinks: audios.length, liveSinks: live.length, rms: peak };
    } finally {
      await ctx.close();
    }
  });
}

export async function rawTrackStates(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    (window.__VOICE_STREAMS__ ?? []).flatMap((stream) =>
      stream.getAudioTracks().map((track) => track.readyState)
    )
  );
}
