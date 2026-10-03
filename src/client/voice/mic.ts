import type { MeshMediaStream } from './peer.ts';

export interface MicPipeline {
  setGain(gain: number): void;
  output(): MeshMediaStream;
  dispose(): void;
}

export interface AcquiredMic {
  raw: MeshMediaStream;
  pipeline: MicPipeline;
  disposeStack(): void;
}

export function stopStream(stream: MeshMediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) track.stop();
}

export function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '已拒絕麥克風權限，仍可收聽其他玩家語音';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '找不到可用的麥克風裝置，仍可收聽其他玩家語音';
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location?.protocol;
    const hostname = window.location?.hostname ?? '';
    const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (protocol === 'http:' && !local) return '語音通話需要 HTTPS 連線，目前僅能收聽';
  }
  return '無法啟用麥克風，仍可收聽其他玩家語音';
}
