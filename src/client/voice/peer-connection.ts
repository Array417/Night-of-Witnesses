import {
  nativeErrorMessage,
  parseSafeIceCandidate,
} from './signaling.ts';
import type {
  MeshAudioTrack,
  MeshConnection,
  MeshMediaStream,
  MeshSignalSender,
  RemoteAudioSink,
  PeerDiagnostics,
} from './peer.ts';

export interface VoicePeerEvents {
  notifyPeerState?(): void;
  sendSignal: MeshSignalSender;
  reportError(message: string): void;
  notifyPlaybackBlocked(): void;
}

export interface VoicePeerDeps {
  events: VoicePeerEvents;
  createSink: (peerId: string) => RemoteAudioSink;
}

export class VoicePeer {
  connectionState: RTCPeerConnectionState = 'new';
  private queue: Promise<void> = Promise.resolve();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private sink: RemoteAudioSink | null = null;
  private volume = 0.8;
  private localTrack: MeshAudioTrack | null = null;
  private detached = false;
  private readonly peerId: string;
  private readonly connection: MeshConnection;
  private readonly events: VoicePeerEvents;
  private readonly createSink: (peerId: string) => RemoteAudioSink;

  constructor(peerId: string, connection: MeshConnection, deps: VoicePeerDeps) {
    this.peerId = peerId;
    this.connection = connection;
    this.events = deps.events;
    this.createSink = deps.createSink;
    connection.setIceCandidateHandler((candidate) => {
      if (!candidate) return;
      const raw = candidate.candidate;
      if (typeof raw !== 'string' || raw.length === 0) return;
      try {
        this.events.sendSignal(
          peerId,
          'ice',
          JSON.stringify({
            candidate: raw,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          }),
        );
      } catch (err) {
        this.events.reportError(`傳送語音連線資訊失敗：${nativeErrorMessage(err)}`);
      }
    });
    connection.setTrackHandler((stream) => {
      this.attachSink(stream);
    });
    connection.setFailedHandler(() => {
      this.connectionState = 'failed';
      this.events.notifyPeerState?.();
      this.events.reportError('與玩家語音連線失敗，仍可繼續遊戲');
    });
    connection.setStateHandler?.(state => {
      if (this.detached) return;
      this.connectionState = state;
      this.events.notifyPeerState?.();
    });
    connection.addSendRecvTransceiver();
  }

  run(task: () => Promise<void>): Promise<void> {
    const next = this.queue
      .then(() => {
        if (!this.detached) return task();
      })
      .catch((err: unknown) => {
        this.events.reportError(`語音連線處理失敗：${nativeErrorMessage(err)}`);
      });
    this.queue = next;
    return next;
  }

  async makeOffer(): Promise<void> {
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    const sdp = offer.sdp;
    if (typeof sdp !== 'string' || sdp.length === 0) {
      this.events.reportError('建立語音邀請失敗，仍可繼續遊戲');
      return;
    }
    this.events.sendSignal(this.peerId, 'offer', sdp);
  }

  async acceptOffer(sdp: string): Promise<void> {
    await this.connection.setRemoteOffer(sdp);
    this.connection.markAnsweredSendRecv();
    this.remoteSet = true;
    // setRemoteDescription may mint new senders for the offered m-lines after
    // setLocalTrack already fanned out; reapply the remembered track so the
    // negotiated sender is never left silent. Re-read after the await so a
    // mic-off that landed mid-negotiation stays off.
    if (this.localTrack) {
      await this.connection.replaceAudioTrack(this.localTrack);
    }
    await this.drainCandidates();
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    const answerSdp = answer.sdp;
    if (typeof answerSdp !== 'string' || answerSdp.length === 0) {
      this.events.reportError('回應語音邀請失敗，仍可繼續遊戲');
      return;
    }
    this.events.sendSignal(this.peerId, 'answer', answerSdp);
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.connection.setRemoteAnswer(sdp);
    this.remoteSet = true;
    await this.drainCandidates();
  }

  async acceptCandidate(payload: string): Promise<void> {
    const init = parseSafeIceCandidate(payload);
    if (!init) return;
    if (!this.remoteSet) {
      this.pendingCandidates.push(init);
      return;
    }
    await this.connection.addIceCandidate(init);
  }

  setLocalTrack(track: MeshAudioTrack | null): Promise<void> {
    if (track !== null && track.kind !== 'audio') return Promise.resolve();
    this.localTrack = track;
    return this.connection.replaceAudioTrack(track).catch((err: unknown) => {
      this.events.reportError(`同步麥克風音軌失敗：${nativeErrorMessage(err)}`);
      throw err;
    });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.sink) this.sink.setVolume(volume);
  }

  replay(): Promise<void> {
    if (!this.sink) return Promise.resolve();
    return this.sink.play();
  }

  diagnostics(): Promise<PeerDiagnostics | null> {
    return this.connection.getDiagnostics?.() ?? Promise.resolve(null);
  }

  detach(): void {
    this.detached = true;
    this.pendingCandidates.length = 0;
    if (this.sink) {
      const sink = this.sink;
      this.sink = null;
      try {
        sink.detach();
      } catch (err) {
        this.events.reportError(`清理語音播放器失敗：${nativeErrorMessage(err)}`);
      }
    }
    this.connection.close();
  }

  private attachSink(stream: MeshMediaStream): void {
    try {
      if (!this.sink) this.sink = this.createSink(this.peerId);
      this.sink.attach(stream);
      this.sink.setVolume(this.volume);
    } catch (err) {
      this.events.reportError(`播放玩家語音失敗：${nativeErrorMessage(err)}`);
      return;
    }
    this.sink.play().catch(() => {
      this.events.notifyPlaybackBlocked();
    });
  }

  private async drainCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0, this.pendingCandidates.length);
    for (const init of queued) {
      await this.connection.addIceCandidate(init);
    }
  }
}
