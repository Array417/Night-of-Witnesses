import { VoiceMesh, type VoiceMeshOptions } from './mesh.ts';
import {
  clampMicGain,
  clampOutputVolume,
  getVoicePreferences,
  saveVoicePreferences,
} from './prefs.ts';
import type { MeshMediaStream, MeshSignalSender } from './peer.ts';
import { describeMicError, stopStream, type AcquiredMic, type MicPipeline } from './mic.ts';
import { nativeErrorMessage } from './signaling.ts';

export interface VoiceState {
  peers: Array<{ playerId: string; connectionState: RTCPeerConnectionState }>;
  available: boolean;
  active: boolean;
  micEnabled: boolean;
  micPending: boolean;
  outputVolume: number;
  micGain: number;
  error: string | null;
  playbackBlocked: boolean;
}

export interface VoiceSyncInput {
  roomCode: string | null;
  selfId: string | null;
  peerIds: readonly string[];
  phase: string;
  iceServers: RTCIceServer[];
}

export interface VoiceControllerOptions extends VoiceMeshOptions {
  acquireMic?: (gain: number) => Promise<AcquiredMic>;
}

interface ActiveMic {
  raw: MeshMediaStream;
  processed: MeshMediaStream;
  pipeline: MicPipeline;
  disposeStack(): void;
}

export class VoiceController {
  private readonly mesh: VoiceMesh;
  private readonly acquireMic: (gain: number) => Promise<AcquiredMic>;
  private readonly listeners = new Set<() => void>();
  private readonly state: VoiceState;
  private readonly available: boolean;
  private active = false;
  private mic: ActiveMic | null = null;
  private micWanted = false;
  private micGeneration = 0;
  private audioCtx: AudioContext | null = null;

  constructor(sendSignal: MeshSignalSender, options: VoiceControllerOptions = {}) {
    this.available =
      typeof RTCPeerConnection !== 'undefined' || options.createConnection !== undefined;
    const prefs = getVoicePreferences();
    this.state = {
      peers: [],
      available: this.available,
      active: false,
      micEnabled: false,
      micPending: false,
      outputVolume: prefs.outputVolume,
      micGain: prefs.micGain,
      error: this.available ? null : '此瀏覽器不支援語音通話',
      playbackBlocked: false,
    };
    this.acquireMic = options.acquireMic ?? ((gain) => this.defaultAcquireMic(gain));
    this.mesh = new VoiceMesh(
      {
        notifyPeerState: () => { this.patch({ peers: this.mesh.getPeerStates() }); },
        sendSignal,
        reportError: (message) => {
          this.patch({ error: message });
        },
        notifyPlaybackBlocked: () => {
          this.patch({ playbackBlocked: true });
        },
      },
      options,
    );
    this.mesh.setOutputVolume(this.state.outputVolume);
  }

  getState(): VoiceState {
    return { ...this.state, peers: this.state.peers.map(peer => ({ ...peer })) };
  }

  /** User-triggered diagnostics contain counters/states, never SDP, device IDs or ICE secrets. */
  async getDiagnostics(): Promise<unknown> {
    let permission = 'unknown';
    try { permission = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; } catch { /* browser may not expose mic permission */ }
    return {
      secureContext: typeof window === 'undefined' ? null : window.isSecureContext,
      permission,
      audioContextState: this.audioCtx?.state ?? 'not-created',
      state: this.getState(),
      transport: await this.mesh.getDiagnostics(),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.micWanted = false;
      this.micGeneration += 1;
      this.teardownMic();
      this.patch({ micPending: false });
      return;
    }
    if (!this.available) {
      this.patch({ error: '此瀏覽器不支援語音通話' });
      return;
    }
    if (!this.active) {
      this.patch({ error: '僅能在討論階段開啟麥克風' });
      return;
    }
    if (this.state.micEnabled) return;
    this.micWanted = true;
    const generation = (this.micGeneration += 1);
    this.patch({ micPending: true, error: null });
    // Invoke receive playback within the same user gesture as mic acquisition.
    const playback = this.resumePlayback();
    let acquired: AcquiredMic | null = null;
    try {
      acquired = await this.acquireMic(this.state.micGain);
    } catch (err) {
      if (generation !== this.micGeneration) return;
      this.patch({ error: describeMicError(err), micEnabled: false, micPending: false });
      return;
    }
    if (generation !== this.micGeneration || !this.micWanted || !this.active || !acquired) {
      if (acquired) {
        stopStream(acquired.raw);
        stopStream(acquired.pipeline.output());
        acquired.disposeStack();
      }
      return;
    }
    this.teardownMic();
    const processed = acquired.pipeline.output();
    this.mic = {
      raw: acquired.raw,
      processed,
      pipeline: acquired.pipeline,
      disposeStack: acquired.disposeStack,
    };
    try {
      await this.mesh.setLocalStream(processed);
    } catch (err) {
      if (generation === this.micGeneration) {
        this.teardownMic();
        this.patch({ error: `同步麥克風音軌失敗：${nativeErrorMessage(err)}`, micPending: false });
      }
      return;
    }
    if (generation !== this.micGeneration || !this.micWanted || !this.active) {
      // Cancellation already stopped this operation's mic. A newer enable may
      // now own this.mic, so an obsolete completion must not tear it down.
      return;
    }
    this.patch({ micEnabled: true, micPending: false, error: null });
    await playback;
  }

  async resumePlayback(): Promise<void> {
    if (!this.available || !this.active) return;
    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      await this.mesh.replayAll();
      this.patch({ playbackBlocked: false });
    } catch {
      this.patch({ playbackBlocked: true });
    }
  }

  setOutputVolume(volume: number): void {
    const prefs = getVoicePreferences();
    prefs.outputVolume = clampOutputVolume(volume);
    saveVoicePreferences(prefs);
    this.mesh.setOutputVolume(prefs.outputVolume);
    this.patch({ outputVolume: prefs.outputVolume });
  }

  setMicGain(gain: number): void {
    const prefs = getVoicePreferences();
    prefs.micGain = clampMicGain(gain);
    saveVoicePreferences(prefs);
    if (this.mic) {
      try {
        this.mic.pipeline.setGain(prefs.micGain);
      } catch (err) {
        this.patch({ error: `調整麥克風增益失敗：${nativeErrorMessage(err)}` });
        return;
      }
    }
    this.patch({ micGain: prefs.micGain });
  }

  sync(input: VoiceSyncInput): void {
    this.mesh.setIceServers(input.iceServers);
    const selfId = input.selfId;
    if (input.phase !== 'discussion' || input.roomCode === null || selfId === null) {
      this.micWanted = false;
      this.micGeneration += 1;
      this.teardownMic();
      this.mesh.suspend();
      this.active = false;
      this.patch({ active: false, micEnabled: false, micPending: false, error: this.available ? null : this.state.error, playbackBlocked: false });
      return;
    }
    this.active = true;
    this.mesh.syncPeers(selfId, input.peerIds);
    this.patch({ active: true });
  }

  handleSignal(fromPlayerId: string, kind: 'offer' | 'answer' | 'ice', payload: string): void {
    if (!this.active) return;
    this.mesh.handleSignal(fromPlayerId, kind, payload);
  }

  dispose(): void {
    this.micWanted = false;
    this.micGeneration += 1;
    this.teardownMic();
    this.mesh.dispose();
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (ctx) {
      ctx.close().catch((err: unknown) => {
        this.patch({ error: `關閉語音音訊失敗：${nativeErrorMessage(err)}` });
      });
    }
    this.active = false;
    this.patch({ active: false, micEnabled: false, micPending: false, playbackBlocked: false, error: this.available ? null : this.state.error });
  }

  private async defaultAcquireMic(gain: number): Promise<AcquiredMic> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('Microphone requires a secure context', 'SecurityError');
    }
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    const raw = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioCtx.createMediaStreamSource(raw);
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = gain;
    const dest = this.audioCtx.createMediaStreamDestination();
    source.connect(gainNode);
    gainNode.connect(dest);
    const pipeline: MicPipeline = {
      setGain: (value) => {
        gainNode.gain.value = value;
      },
      output: () => dest.stream,
      dispose: () => {
        source.disconnect();
        gainNode.disconnect();
      },
    };
    return { raw, pipeline, disposeStack: () => pipeline.dispose() };
  }

  private teardownMic(): void {
    const mic = this.mic;
    this.mic = null;
    if (mic) {
      stopStream(mic.raw);
      stopStream(mic.processed);
      mic.disposeStack();
    }
    void this.mesh.setLocalStream(null).catch(() => {});
    this.patch({ micEnabled: false });
  }

  private patch(partial: Partial<VoiceState>): void {
    Object.assign(this.state, partial);
    this.state.available = this.available;
    for (const listener of [...this.listeners]) listener();
  }
}
