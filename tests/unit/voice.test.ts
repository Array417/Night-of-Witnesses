import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../../src/client/voice/controller.ts';
import type { AcquiredMic } from '../../src/client/voice/mic.ts';
import type {
  MeshConnection,
  MeshMediaStream,
  MeshAudioTrack,
  RemoteAudioSink,
} from '../../src/client/voice/peer.ts';
import {
  VOICE_STORAGE_KEY,
  getVoicePreferences,
} from '../../src/client/voice/prefs.ts';
import { AUDIO_STORAGE_KEY } from '../../src/client/audio/preferences.ts';

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

class FakeTrack implements MeshAudioTrack {
  readonly kind = 'audio';
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream implements MeshMediaStream {
  readonly tracks: FakeTrack[];
  constructor(tracks?: FakeTrack[]) {
    this.tracks = tracks ?? [new FakeTrack()];
  }
  getAudioTracks(): MeshAudioTrack[] {
    return this.tracks;
  }
}

class FakeSender {
  track: MeshAudioTrack | null = null;
  replaced: Array<MeshAudioTrack | null> = [];
  replaceTrack(track: MeshAudioTrack | null): Promise<void> {
    this.track = track;
    this.replaced.push(track);
    return Promise.resolve();
  }
}

class FakeConnection implements MeshConnection {
  iceHandler: ((candidate: RTCIceCandidateInit | null) => void) | null = null;
  trackHandler: ((stream: MeshMediaStream) => void) | null = null;
  failedHandler: (() => void) | null = null;
  transceivers = 0;
  localDesc: RTCSessionDescriptionInit | null = null;
  remoteOffer: string | null = null;
  remoteAnswer: string | null = null;
  addedCandidates: RTCIceCandidateInit[] = [];
  senders = [new FakeSender(), new FakeSender()];
  closed = false;
  deferRemoteOffer = false;
  remoteOfferResolvers: Array<() => void> = [];

  setIceCandidateHandler(handler: ((candidate: RTCIceCandidateInit | null) => void) | null): void {
    this.iceHandler = handler;
  }
  setTrackHandler(handler: ((stream: MeshMediaStream) => void) | null): void {
    this.trackHandler = handler;
  }
  setFailedHandler(handler: (() => void) | null): void {
    this.failedHandler = handler;
  }
  addSendRecvTransceiver(): void {
    this.transceivers += 1;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDesc = desc;
  }
  async setRemoteOffer(sdp: string): Promise<void> {
    this.remoteOffer = sdp;
    if (this.deferRemoteOffer) {
      await new Promise<void>((resolve) => {
        this.remoteOfferResolvers.push(resolve);
      });
    }
    // Native setRemoteDescription mints fresh senders for the offered m-lines.
    this.senders.push(new FakeSender());
  }
  async setRemoteAnswer(sdp: string): Promise<void> {
    this.remoteAnswer = sdp;
  }
  markAnsweredSendRecv(): void {
    // Fake binds the existing transceiver; no new m-line.
  }
  async addIceCandidate(init: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(init);
  }
  get sender(): FakeSender {
    return this.senders[0];
  }
  replaceAudioTrack(track: MeshAudioTrack | null): Promise<void> {
    // Mirror the native fan-out: every audio sender carries the track, since
    // the first sender may sit on an unnegotiated m-line.
    for (const sender of this.senders) {
      void sender.replaceTrack(track);
    }
    return Promise.resolve();
  }
  close(): void {
    this.closed = true;
  }
}

class FakeSink implements RemoteAudioSink {
  attached: MeshMediaStream | null = null;
  volume = -1;
  plays = 0;
  detached = 0;
  playMode: 'ok' | 'blocked' = 'ok';
  attach(stream: MeshMediaStream): void {
    this.attached = stream;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  async play(): Promise<void> {
    this.plays += 1;
    if (this.playMode === 'blocked') throw new Error('autoplay blocked');
  }
  detach(): void {
    this.detached += 1;
  }
}

interface Harness {
  controller: VoiceController;
  signals: Array<{ target: string; kind: string; payload: string }>;
  conns: FakeConnection[];
  sinks: FakeSink[];
  setAcquire: (impl: (gain: number) => Promise<AcquiredMic>) => void;
  gainSet: number[];
}

function makeHarness(): Harness {
  const signals: Harness['signals'] = [];
  const conns: FakeConnection[] = [];
  const sinks: FakeSink[] = [];
  const gainSet: number[] = [];
  let acquire: (gain: number) => Promise<AcquiredMic> = () => {
    const raw = new FakeStream();
    const processed = new FakeStream();
    return Promise.resolve({
      raw,
      pipeline: {
        setGain: (value: number) => {
          gainSet.push(value);
        },
        output: () => processed,
        dispose: () => {},
      },
      disposeStack: () => {},
    });
  };
  const controller = new VoiceController(
    (target, kind, payload) => {
      signals.push({ target, kind, payload });
    },
    {
      createConnection: () => {
        const conn = new FakeConnection();
        conns.push(conn);
        return conn;
      },
      createAudioSink: () => {
        const sink = new FakeSink();
        sinks.push(sink);
        return sink;
      },
      acquireMic: (gain) => acquire(gain),
    },
  );
  return {
    controller,
    signals,
    conns,
    sinks,
    gainSet,
    setAcquire: (impl) => {
      acquire = impl;
    },
  };
}

function discussionInput(peerIds: string[] = ['p2']): {
  roomCode: string;
  selfId: string;
  peerIds: string[];
  phase: string;
  iceServers: RTCIceServer[];
} {
  return { roomCode: 'ABC123', selfId: 'p1', peerIds, phase: 'discussion', iceServers: [] };
}

async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe('voice controller defaults', () => {
  let originalStorage: unknown;
  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage =
      new MockLocalStorage();
  });
  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('mic off by default with output .8 and gain 1', () => {
    const h = makeHarness();
    const state = h.controller.getState();
    assert.equal(state.available, true);
    assert.equal(state.active, false);
    assert.equal(state.micEnabled, false);
    assert.equal(state.micPending, false);
    assert.equal(state.outputVolume, 0.8);
    assert.equal(state.micGain, 1);
    assert.equal(state.error, null);
    assert.equal(state.playbackBlocked, false);
  });

  test('mic requires discussion phase', async () => {
    const h = makeHarness();
    await h.controller.setMicEnabled(true);
    const state = h.controller.getState();
    assert.equal(state.micEnabled, false);
    assert.equal(state.error, '僅能在討論階段開啟麥克風');
  });

  test('receive-only mesh needs no mic prompt', async () => {
    const h = makeHarness();
    let micRequested = false;
    h.setAcquire(() => {
      micRequested = true;
      return Promise.reject(new Error('should not be called'));
    });
    h.controller.sync(discussionInput());
    await flush();
    assert.equal(micRequested, false);
    assert.equal(h.conns.length, 1);
    assert.equal(h.conns[0]?.transceivers, 1);
    assert.equal(h.signals[0]?.kind, 'offer');
  });

  test('subscribe notifies and unsubscribes', () => {
    const h = makeHarness();
    let calls = 0;
    const off = h.controller.subscribe(() => {
      calls += 1;
    });
    h.controller.setOutputVolume(0.3);
    assert.equal(calls, 1);
    off();
    h.controller.setOutputVolume(0.5);
    assert.equal(calls, 1);
  });
});

describe('voice mic opt-in and disable', () => {
  let originalStorage: unknown;
  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage =
      new MockLocalStorage();
  });
  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('opt-in replaces sender track without renegotiation', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    const state = h.controller.getState();
    assert.equal(state.micEnabled, true);
    assert.equal(state.error, null);
    const sender = h.conns[0]?.sender;
    assert.ok(sender);
    const live = sender.replaced[sender.replaced.length - 1];
    assert.ok(live !== null && live !== undefined);
  });

  test('opt-in fans out to every audio sender, not just the first', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    const senders = h.conns[0]?.senders ?? [];
    assert.equal(senders.length, 2);
    for (const sender of senders) {
      const live = sender.replaced[sender.replaced.length - 1];
      assert.ok(live !== null && live !== undefined);
      assert.equal(sender.track, live);
    }
  });

  test('track set before the offer still reaches the negotiated sender', async () => {
    const h = makeHarness();
    h.controller.sync({ ...discussionInput(['p0']), selfId: 'p9' });
    await flush();
    await h.controller.setMicEnabled(true);
    assert.equal(h.controller.getState().micEnabled, true);
    h.controller.handleSignal('p0', 'offer', 'remote-offer-sdp');
    await flush();
    const negotiated = h.conns[0]?.senders[2];
    assert.ok(negotiated);
    const live = negotiated.replaced[negotiated.replaced.length - 1];
    assert.ok(live !== null && live !== undefined);
  });

  test('mic turned off mid-negotiation is not resurrected by the offer', async () => {
    const h = makeHarness();
    h.controller.sync({ ...discussionInput(['p0']), selfId: 'p9' });
    await flush();
    const conn = h.conns[0];
    assert.ok(conn);
    conn.deferRemoteOffer = true;
    await h.controller.setMicEnabled(true);
    h.controller.handleSignal('p0', 'offer', 'remote-offer-sdp');
    await flush(2);
    await h.controller.setMicEnabled(false);
    for (const release of conn.remoteOfferResolvers.splice(0)) release();
    await flush();
    assert.equal(h.controller.getState().micEnabled, false);
    const negotiated = conn.senders[2];
    assert.ok(negotiated);
    assert.equal(negotiated.track, null);
    assert.equal(negotiated.replaced.length, 0);
  });

  test('disable stops capture and clears sender track', async () => {
    const h = makeHarness();
    const seenRaw: FakeStream[] = [];
    const seenProcessed: FakeStream[] = [];
    h.setAcquire(() => {
      const raw = new FakeStream();
      const processed = new FakeStream();
      seenRaw.push(raw);
      seenProcessed.push(processed);
      return Promise.resolve({
        raw,
        pipeline: {
          setGain: () => {},
          output: () => processed,
          dispose: () => {},
        },
        disposeStack: () => {},
      });
    });
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    assert.equal(h.controller.getState().micEnabled, true);
    await h.controller.setMicEnabled(false);
    assert.equal(h.controller.getState().micEnabled, false);
    assert.equal(seenRaw[0]?.tracks[0]?.stopped, true);
    assert.equal(seenProcessed[0]?.tracks[0]?.stopped, true);
    const sender = h.conns[0]?.sender;
    assert.equal(sender?.replaced[sender.replaced.length - 1], null);
  });

  test('late permission grant is cancelled when disabled while prompting', async () => {
    const h = makeHarness();
    const grants: Array<(mic: AcquiredMic) => void> = [];
    h.setAcquire(
      () =>
        new Promise<AcquiredMic>((resolve) => {
          grants.push(resolve);
        }),
    );
    h.controller.sync(discussionInput());
    await flush();
    const enabling = h.controller.setMicEnabled(true);
    await flush(2);
    assert.equal(h.controller.getState().micPending, true);
    await h.controller.setMicEnabled(false);
    const raw = new FakeStream();
    const processed = new FakeStream();
    grants[0]?.({
      raw,
      pipeline: {
        setGain: () => {},
        output: () => processed,
        dispose: () => {},
      },
      disposeStack: () => {},
    });
    await enabling;
    await flush();
    assert.equal(h.controller.getState().micEnabled, false);
    assert.equal(h.controller.getState().micPending, false);
    assert.equal(raw.tracks[0]?.stopped, true);
    assert.equal(processed.tracks[0]?.stopped, true);
    assert.equal(h.conns[0]?.sender.track, null);
  });

  test('denied permission surfaces Traditional Chinese notice', async () => {
    const h = makeHarness();
    h.setAcquire(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    const state = h.controller.getState();
    assert.equal(state.micEnabled, false);
    assert.equal(state.error, '已拒絕麥克風權限，仍可收聽其他玩家語音');
  });

  test('phase exit tears down peers and mic', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    assert.equal(h.controller.getState().micEnabled, true);
    h.controller.sync({ ...discussionInput(), phase: 'voting' });
    const state = h.controller.getState();
    assert.equal(state.active, false);
    assert.equal(state.micEnabled, false);
    assert.equal(h.conns[0]?.closed, true);
    assert.equal(h.conns[0]?.sender.track, null);
  });

  test('dispose closes peers and clears capture', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    h.controller.dispose();
    const state = h.controller.getState();
    assert.equal(state.active, false);
    assert.equal(state.micEnabled, false);
    assert.equal(h.conns[0]?.closed, true);
    assert.equal(h.sinks.length, 0);
  });
});

describe('voice ICE ordering and limits', () => {
  let originalStorage: unknown;
  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage =
      new MockLocalStorage();
  });
  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('ICE before offer is queued and applied after description', async () => {
    const h = makeHarness();
    // Answerer side: remote offerer p0 < self p9, no auto-offer.
    h.controller.sync({ ...discussionInput(['p0']), selfId: 'p9' });
    await flush();
    assert.equal(h.conns.length, 1);
    h.controller.handleSignal(
      'p0',
      'ice',
      JSON.stringify({ candidate: 'early', sdpMid: '0', sdpMLineIndex: 0 }),
    );
    await flush();
    assert.equal(h.conns[0]?.addedCandidates.length, 0);
    h.controller.handleSignal('p0', 'offer', 'remote-offer-sdp');
    await flush();
    assert.equal(h.conns[0]?.remoteOffer, 'remote-offer-sdp');
    assert.equal(h.conns[0]?.addedCandidates.length, 1);
    assert.equal(h.conns[0]?.addedCandidates[0]?.candidate, 'early');
    assert.equal(h.conns[0]?.transceivers, 1);
    const answer = h.signals.find((s) => s.kind === 'answer');
    assert.ok(answer);
  });

  test('malformed ICE is ignored without breaking the peer', async () => {
    const h = makeHarness();
    h.controller.sync({ ...discussionInput(['p0']), selfId: 'p9' });
    await flush();
    h.controller.handleSignal('p0', 'ice', 'not-json{{{');
    h.controller.handleSignal('p0', 'offer', 'remote-offer-sdp');
    await flush();
    assert.equal(h.conns[0]?.addedCandidates.length, 0);
    assert.ok(h.signals.find((s) => s.kind === 'answer'));
  });

  test('mesh caps peers at five', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput(['p2', 'p3', 'p4', 'p5', 'p6', 'p7']));
    await flush();
    assert.equal(h.conns.length, 5);
  });

  test('autoplay failure flags playbackBlocked until resumed', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    h.conns[0]?.trackHandler?.(new FakeStream());
    await flush();
    assert.equal(h.sinks.length, 1);
    assert.equal(h.sinks[0]?.volume, 0.8);
    const sink = h.sinks[0];
    assert.ok(sink);
    sink.playMode = 'blocked';
    await h.controller.resumePlayback();
    assert.equal(h.controller.getState().playbackBlocked, true);
    sink.playMode = 'ok';
    await h.controller.resumePlayback();
    assert.equal(h.controller.getState().playbackBlocked, false);
  });
});

describe('voice volume clamping and prefs isolation', () => {
  let originalStorage: unknown;
  let storage: MockLocalStorage;
  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    storage = new MockLocalStorage();
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = storage;
  });
  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('output volume clamps to [0,1] and drives sinks', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    h.conns[0]?.trackHandler?.(new FakeStream());
    h.controller.setOutputVolume(-0.5);
    assert.equal(h.controller.getState().outputVolume, 0);
    h.controller.setOutputVolume(2);
    assert.equal(h.controller.getState().outputVolume, 1);
    assert.equal(h.sinks[0]?.volume, 1);
  });

  test('mic gain clamps to [0,2] and reaches live pipeline', async () => {
    const h = makeHarness();
    h.controller.sync(discussionInput());
    await flush();
    await h.controller.setMicEnabled(true);
    h.controller.setMicGain(5);
    assert.equal(h.controller.getState().micGain, 2);
    h.controller.setMicGain(-1);
    assert.equal(h.controller.getState().micGain, 0);
    assert.deepEqual(h.gainSet, [2, 0]);
  });

  test('voice prefs use isolated key and never touch audio prefs', () => {
    const h = makeHarness();
    h.controller.setOutputVolume(0.3);
    h.controller.setMicGain(1.5);
    const raw = storage.getItem(VOICE_STORAGE_KEY);
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw), { outputVolume: 0.3, micGain: 1.5 });
    assert.equal(storage.getItem(AUDIO_STORAGE_KEY), null);
    assert.deepEqual(getVoicePreferences(), { outputVolume: 0.3, micGain: 1.5 });
  });
});
