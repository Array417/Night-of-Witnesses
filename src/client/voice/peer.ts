import type { RtcSignalKind } from './signaling.ts';

export interface MeshAudioTrack {
  readonly kind: string;
  stop(): void;
}

export interface MeshMediaStream {
  getAudioTracks(): MeshAudioTrack[];
}

export interface MeshConnection {
  setStateHandler?(handler: ((state: RTCPeerConnectionState) => void) | null): void;
  getDiagnostics?(): Promise<PeerDiagnostics>;
  setIceCandidateHandler(handler: ((candidate: RTCIceCandidateInit | null) => void) | null): void;
  setTrackHandler(handler: ((stream: MeshMediaStream) => void) | null): void;
  setFailedHandler(handler: (() => void) | null): void;
  addSendRecvTransceiver(): void;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteOffer(sdp: string): Promise<void>;
  setRemoteAnswer(sdp: string): Promise<void>;
  markAnsweredSendRecv(): void;
  addIceCandidate(init: RTCIceCandidateInit): Promise<void>;
  replaceAudioTrack(track: MeshAudioTrack | null): Promise<void>;
  close(): void;
}

export interface PeerDiagnostics {
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  inboundBytes: number;
  outboundBytes: number;
  candidateType: string | null;
}

export interface RemoteAudioSink {
  attach(stream: MeshMediaStream): void;
  setVolume(volume: number): void;
  play(): Promise<void>;
  detach(): void;
}

export type MeshSignalSender = (
  targetPlayerId: string,
  kind: RtcSignalKind,
  payload: string,
) => void;

class NativeMeshConnection implements MeshConnection {
  private readonly pc: RTCPeerConnection;

  constructor(config: RTCConfiguration) {
    this.pc = new RTCPeerConnection(config);
  }

  setIceCandidateHandler(handler: ((candidate: RTCIceCandidateInit | null) => void) | null): void {
    this.pc.onicecandidate = handler
      ? (event) => {
          if (!event.candidate) {
            handler(null);
            return;
          }
          handler({
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment,
          });
        }
      : null;
  }

  setTrackHandler(handler: ((stream: MeshMediaStream) => void) | null): void {
    this.pc.ontrack = handler
      ? (event) => {
          // replaceTrack-injected tracks carry no stream association, so the
          // receiver event routinely arrives with empty streams in Chrome.
          handler(event.streams[0] ?? new MediaStream([event.track]));
        }
      : null;
  }

  setFailedHandler(handler: (() => void) | null): void {
    this.pc.onconnectionstatechange = handler
      ? () => {
          if (this.pc.connectionState === 'failed') handler();
        }
      : null;
  }

  setStateHandler(handler: ((state: RTCPeerConnectionState) => void) | null): void {
    this.pc.addEventListener('connectionstatechange', () => handler?.(this.pc.connectionState));
  }

  async getDiagnostics(): Promise<PeerDiagnostics> {
    const stats = await this.pc.getStats();
    let inboundBytes = 0;
    let outboundBytes = 0;
    let candidateType: string | null = null;
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') inboundBytes += report.bytesReceived ?? 0;
      if (report.type === 'outbound-rtp' && report.kind === 'audio') outboundBytes += report.bytesSent ?? 0;
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        candidateType = stats.get(report.localCandidateId)?.candidateType ?? null;
      }
    });
    return { connectionState: this.pc.connectionState, iceState: this.pc.iceConnectionState, signalingState: this.pc.signalingState, inboundBytes, outboundBytes, candidateType };
  }

  addSendRecvTransceiver(): void {
    this.pc.addTransceiver('audio', { direction: 'sendrecv' });
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return this.pc.createOffer();
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return this.pc.createAnswer();
  }

  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    return this.pc.setLocalDescription(desc);
  }

  setRemoteOffer(sdp: string): Promise<void> {
    return this.pc.setRemoteDescription({ type: 'offer', sdp });
  }

  setRemoteAnswer(sdp: string): Promise<void> {
    return this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  markAnsweredSendRecv(): void {
    for (const transceiver of this.pc.getTransceivers()) {
      if (transceiver.receiver.track.kind === 'audio') {
        transceiver.direction = 'sendrecv';
      }
    }
  }

  addIceCandidate(init: RTCIceCandidateInit): Promise<void> {
    return this.pc.addIceCandidate(init);
  }

  replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    if (track !== null && track.kind !== 'audio') return Promise.resolve();
    // Fan out to every audio sender: with pre-created sendrecv transceivers
    // on both ends, the first sender may belong to an m-line that was never
    // negotiated, while the live negotiated m-line sits further along.
    const tasks: Promise<void>[] = [];
    for (const sender of this.pc.getSenders()) {
      if (sender.track !== null && sender.track.kind !== 'audio') continue;
      tasks.push(sender.replaceTrack(track));
    }
    if (tasks.length === 0) return Promise.resolve();
    return Promise.all(tasks).then(() => undefined);
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      // Already closed; teardown is idempotent
    }
  }
}

class NativeAudioSink implements RemoteAudioSink {
  private readonly element: HTMLAudioElement;

  constructor(peerId: string) {
    this.element = document.createElement('audio');
    this.element.dataset.voicePeer = peerId;
    this.element.style.display = 'none';
    document.body.appendChild(this.element);
  }

  attach(stream: MediaStream): void {
    this.element.srcObject = stream;
  }

  setVolume(volume: number): void {
    this.element.volume = volume;
  }

  play(): Promise<void> {
    return this.element.play();
  }

  detach(): void {
    try {
      this.element.pause();
    } catch {
      // Sink may already be detached
    }
    this.element.srcObject = null;
    this.element.remove();
  }
}

export function createNativeConnection(config: RTCConfiguration): MeshConnection {
  return new NativeMeshConnection(config);
}

export function createNativeAudioSink(peerId: string): RemoteAudioSink {
  return new NativeAudioSink(peerId);
}
