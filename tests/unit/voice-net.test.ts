import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../../src/client/net.ts';

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

class FakeSender {
  track: { kind: string } | null = null;
  replaced: Array<{ kind: string } | null> = [];
  async replaceTrack(track: { kind: string } | null): Promise<void> {
    this.track = track;
    this.replaced.push(track);
  }
}

class FakeNativePC {
  static instances: FakeNativePC[] = [];
  onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  connectionState = 'new';
  stateListeners: Array<() => void> = [];
  addEventListener(type: string, listener: () => void): void {
    if (type === 'connectionstatechange') this.stateListeners.push(listener);
  }
  sender = new FakeSender();
  closed = false;
  constructor(_config: unknown) {
    FakeNativePC.instances.push(this);
  }
  addTransceiver(): void {}
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'net-offer-sdp' };
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: 'answer', sdp: 'net-answer-sdp' };
  }
  async setLocalDescription(_desc: unknown): Promise<void> {}
  async setRemoteDescription(_desc: unknown): Promise<void> {}
  getTransceivers(): Array<{ receiver: { track: { kind: string } }; direction: string }> {
    return [];
  }
  getSenders(): FakeSender[] {
    return [this.sender];
  }
  async addIceCandidate(_init: unknown): Promise<void> {}
  close(): void {
    this.closed = true;
  }
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readonly url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  serverSend(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

function installGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = new MockLocalStorage();
  g.window = {
    location: {
      protocol: 'http:',
      host: 'example.test',
      hostname: 'example.test',
      href: 'http://example.test/',
      search: '',
    },
    history: {
      replaceState: () => {},
    },
  };
  g.WebSocket = FakeSocket;
  g.RTCPeerConnection = FakeNativePC;
}

function removeGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.localStorage;
  delete g.window;
  delete g.WebSocket;
  delete g.RTCPeerConnection;
}

function projection(version: number, phase: string, players: string[]): Record<string, unknown> {
  return {
    type: 'projection',
    projection: {
      roomCode: 'ABC123',
      version,
      phase,
      level: 'L1',
      viewerId: 'p1',
      isHost: true,
      players: players.map((id) => ({
        playerId: id,
        playerName: id,
        connected: true,
        ready: true,
        locationId: null,
        isHost: id === 'p1',
      })),
      publicRoleRoster: [],
      currentActorId: null,
      servedPlayerIds: [],
      testimonyTrail: [],
    },
  };
}

const welcome = {
  type: 'welcome',
  roomCode: 'ABC123',
  seatToken: 'tok-1',
  playerId: 'p1',
};

function lastSent(socket: FakeSocket): Record<string, unknown> {
  return JSON.parse(socket.sent[socket.sent.length - 1] ?? '{}') as Record<string, unknown>;
}

function advanceSends(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((msg) => msg.type === 'advance_to_vote');
}

async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe('game client voice signaling', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    FakeNativePC.instances = [];
    installGlobals();
  });
  afterEach(() => {
    removeGlobals();
  });

  test('rtc signals bypass the single-game-action guard while an action is pending', async () => {
    const client = new GameClient();
    client.connect();
    const socket = FakeSocket.instances[0];
    assert.ok(socket);
    socket.serverSend(welcome);
    socket.serverSend(projection(10, 'discussion', ['p1', 'p2']));
    await flush();

    const offer = socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((msg) => msg.type === 'rtc_signal' && msg.kind === 'offer');
    assert.ok(offer);
    assert.equal(offer.targetPlayerId, 'p2');
    assert.equal(client.voice.getState().peers[0].connectionState, 'new');
    const connection = FakeNativePC.instances[0];
    connection.connectionState = 'connected';
    connection.stateListeners.forEach(listener => listener());
    assert.equal(client.voice.getState().peers[0].connectionState, 'connected');

    assert.equal(client.dispatchAction({ type: 'advance_to_vote' }), true);
    assert.equal(client.isActionPending(), true);

    const pc = FakeNativePC.instances[0];
    assert.ok(pc);
    pc.onicecandidate?.({
      candidate: { candidate: 'trickle-1', sdpMid: '0', sdpMLineIndex: 0 },
    });
    const ice = lastSent(socket);
    assert.equal(ice.type, 'rtc_signal');
    assert.equal(ice.kind, 'ice');
    assert.equal(client.isActionPending(), true);
    client.disconnect();
  });

  test('advance_to_vote STALE_VERSION retries once after fresh projection', async () => {
    const errors: string[] = [];
    const client = new GameClient({ onError: (code) => errors.push(code) });
    client.connect();
    const socket = FakeSocket.instances[0];
    assert.ok(socket);
    socket.serverSend(welcome);
    socket.serverSend(projection(10, 'discussion', ['p1', 'p2']));
    await flush();

    assert.equal(client.dispatchAction({ type: 'advance_to_vote' }), true);
    assert.equal(advanceSends(socket).length, 1);
    assert.equal(advanceSends(socket)[0]?.baseVersion, 10);

    socket.serverSend({ type: 'error', code: 'STALE_VERSION', message: 'stale' });
    assert.deepEqual(errors, ['STALE_VERSION']);
    socket.serverSend(projection(11, 'discussion', ['p1', 'p2']));
    await flush();
    assert.equal(advanceSends(socket).length, 2);
    assert.equal(advanceSends(socket)[1]?.baseVersion, 11);

    socket.serverSend({ type: 'error', code: 'STALE_VERSION', message: 'stale again' });
    socket.serverSend(projection(12, 'discussion', ['p1', 'p2']));
    await flush();
    assert.equal(advanceSends(socket).length, 2);
    client.disconnect();
  });

  test('STALE_VERSION on other actions does not trigger retry', async () => {
    const client = new GameClient();
    client.connect();
    const socket = FakeSocket.instances[0];
    assert.ok(socket);
    socket.serverSend(welcome);
    socket.serverSend(projection(10, 'discussion', ['p1', 'p2']));
    await flush();

    assert.equal(client.dispatchAction({ type: 'set_ready', ready: true }), true);
    socket.serverSend({ type: 'error', code: 'STALE_VERSION', message: 'stale' });
    const before = socket.sent.length;
    socket.serverSend(projection(11, 'discussion', ['p1', 'p2']));
    await flush();
    assert.equal(socket.sent.length, before);
    client.disconnect();
  });

  test('leave rejection permits retry and revoked rejoin after lost acknowledgement returns home', () => {
    let closed = false;
    const client = new GameClient({ onRoomClosed: () => { closed = true; } });
    client.connect();
    const socket = FakeSocket.instances[0];
    socket.serverSend(welcome);
    socket.serverSend(projection(10, 'lobby', ['p1', 'p2']));
    assert.equal(client.dispatchAction({ type: 'leave' }), true);
    assert.equal(client.dispatchAction({ type: 'leave' }), false);
    socket.serverSend({ type: 'error', code: 'INVALID_ACTION', message: 'retry' });
    assert.ok(client.getProjection());
    assert.equal(client.dispatchAction({ type: 'leave' }), true);
    // The server has removed the seat, but the close acknowledgement was lost.
    client.connect();
    const reconnected = FakeSocket.instances[1];
    reconnected.onopen?.();
    assert.equal(lastSent(reconnected).type, 'rejoin');
    reconnected.serverSend({ type: 'error', code: 'INVALID_TOKEN', message: 'revoked' });
    assert.equal(client.getProjection(), null);
    assert.equal(closed, true);
    assert.equal(client.createRoom('again'), true);
    client.disconnect();
  });

  test('phase exit and room close tear down voice peers', async () => {
    const client = new GameClient();
    client.connect();
    const socket = FakeSocket.instances[0];
    assert.ok(socket);
    socket.serverSend(welcome);
    socket.serverSend(projection(10, 'discussion', ['p1', 'p2']));
    await flush();
    assert.equal(client.voice.getState().active, true);

    socket.serverSend(projection(11, 'voting', ['p1', 'p2']));
    assert.equal(client.voice.getState().active, false);
    assert.equal(FakeNativePC.instances[0]?.closed, true);

    socket.serverSend(projection(12, 'discussion', ['p1', 'p2']));
    await flush();
    assert.equal(client.voice.getState().active, true);
    assert.equal(FakeNativePC.instances.length, 2);

    socket.serverSend({ type: 'room_closed', reason: 'done' });
    assert.equal(client.voice.getState().active, false);
    client.disconnect();
  });
});
