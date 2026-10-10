import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeConnection } from '../../src/client/voice/peer.ts';

test('native ICE failure notifications rearm when a restart enters checking', () => {
  const Native = globalThis.RTCPeerConnection;
  class FakePC {
    static instance: FakePC;
    connectionState = 'new';
    iceConnectionState = 'new';
    onconnectionstatechange: (() => void) | null = null;
    oniceconnectionstatechange: (() => void) | null = null;
    constructor() { FakePC.instance = this; }
    close() {}
  }
  globalThis.RTCPeerConnection = FakePC as unknown as typeof RTCPeerConnection;
  try {
    const connection = createNativeConnection({});
    const pc = FakePC.instance;
    let failures = 0;
    connection.setFailedHandler(() => failures++);
    for (let attempt = 0; attempt < 3; attempt++) {
      pc.iceConnectionState = 'checking';
      pc.oniceconnectionstatechange?.();
      assert.equal(failures, attempt, 'checking starts a new attempt without reporting failure');
      pc.iceConnectionState = 'failed';
      pc.connectionState = 'failed';
      pc.oniceconnectionstatechange?.();
      pc.onconnectionstatechange?.();
      assert.equal(failures, attempt + 1, 'one notification per failed negotiation, including restarts');
    }
    connection.close();
  } finally { globalThis.RTCPeerConnection = Native; }
});
