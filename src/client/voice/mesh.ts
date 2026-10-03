import {
  MAX_SIGNAL_PAYLOAD_CHARS,
  MAX_VOICE_PEERS,
  nativeErrorMessage,
  type RtcSignalKind,
} from './signaling.ts';
import {
  createNativeAudioSink,
  createNativeConnection,
  type MeshAudioTrack,
  type MeshConnection,
  type MeshMediaStream,
  type MeshSignalSender,
  type RemoteAudioSink,
} from './peer.ts';
import { VoicePeer, type VoicePeerEvents } from './peer-connection.ts';

export interface VoiceMeshEvents {
  sendSignal: MeshSignalSender;
  reportError(message: string): void;
  notifyPlaybackBlocked(): void;
}

export interface VoiceMeshOptions {
  createConnection?: (config: RTCConfiguration) => MeshConnection;
  createAudioSink?: (peerId: string) => RemoteAudioSink;
  maxPeers?: number;
}

function isOfferer(selfId: string, peerId: string): boolean {
  return selfId < peerId;
}

export class VoiceMesh {
  private readonly events: VoiceMeshEvents;
  private readonly peerEvents: VoicePeerEvents;
  private readonly createConnection: (config: RTCConfiguration) => MeshConnection;
  private readonly createAudioSink: (peerId: string) => RemoteAudioSink;
  private readonly maxPeers: number;
  private readonly peers = new Map<string, VoicePeer>();
  private iceServers: RTCIceServer[] = [];
  private outputVolume = 0.8;
  private localTrack: MeshAudioTrack | null = null;

  constructor(events: VoiceMeshEvents, options: VoiceMeshOptions = {}) {
    this.events = events;
    this.peerEvents = events;
    this.createConnection = options.createConnection ?? createNativeConnection;
    this.createAudioSink = options.createAudioSink ?? createNativeAudioSink;
    this.maxPeers = options.maxPeers ?? MAX_VOICE_PEERS;
  }

  setIceServers(servers: RTCIceServer[]): void {
    this.iceServers = servers;
  }

  setOutputVolume(volume: number): void {
    this.outputVolume = volume;
    for (const peer of this.peers.values()) peer.setVolume(volume);
  }

  syncPeers(selfId: string, peerIds: readonly string[]): void {
    const wanted = [...new Set(peerIds)]
      .filter((id) => id !== selfId)
      .sort()
      .slice(0, this.maxPeers);
    const wantedSet = new Set(wanted);
    for (const id of [...this.peers.keys()]) {
      if (!wantedSet.has(id)) this.removePeer(id);
    }
    for (const id of wanted) {
      if (this.peers.has(id)) continue;
      const peer = this.createPeer(id);
      if (!peer) continue;
      this.peers.set(id, peer);
      if (isOfferer(selfId, id)) void peer.run(() => peer.makeOffer());
    }
  }

  suspend(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  handleSignal(fromPlayerId: string, kind: RtcSignalKind, payload: string): void {
    if (payload.length > MAX_SIGNAL_PAYLOAD_CHARS) {
      this.events.reportError('收到過長的語音訊號，已忽略');
      return;
    }
    let peer = this.peers.get(fromPlayerId);
    if (!peer) {
      if (kind !== 'offer') return;
      const created = this.createPeer(fromPlayerId);
      if (!created) return;
      this.peers.set(fromPlayerId, created);
      peer = created;
    }
    switch (kind) {
      case 'offer':
        void peer.run(() => peer.acceptOffer(payload));
        break;
      case 'answer':
        void peer.run(() => peer.acceptAnswer(payload));
        break;
      case 'ice':
        void peer.run(() => peer.acceptCandidate(payload));
        break;
    }
  }

  setLocalStream(stream: MeshMediaStream | null): void {
    const track = stream ? (stream.getAudioTracks()[0] ?? null) : null;
    if (track !== null && track.kind !== 'audio') return;
    this.localTrack = track;
    for (const peer of this.peers.values()) peer.setLocalTrack(track);
  }

  async replayAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const peer of this.peers.values()) tasks.push(peer.replay());
    await Promise.all(tasks);
  }

  dispose(): void {
    this.suspend();
    this.iceServers = [];
    this.localTrack = null;
  }

  private createPeer(peerId: string): VoicePeer | null {
    let connection: MeshConnection;
    try {
      connection = this.createConnection({ iceServers: this.iceServers });
    } catch (err) {
      this.events.reportError(`無法建立語音連線：${nativeErrorMessage(err)}`);
      return null;
    }
    try {
      const peer = new VoicePeer(peerId, connection, {
        events: this.peerEvents,
        createSink: this.createAudioSink,
      });
      peer.setVolume(this.outputVolume);
      peer.setLocalTrack(this.localTrack);
      return peer;
    } catch (err) {
      this.events.reportError(`建立語音音軌失敗：${nativeErrorMessage(err)}`);
      connection.close();
      return null;
    }
  }

  private removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.detach();
  }
}
