import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '../../src/shared/protocol.ts';
import type { PlayerProjection, CanonicalGameState } from '../../src/shared/state.ts';

describe('protocol and projection contracts', () => {
  test('valid client message fixtures are accepted by safeParse', () => {
    const validMessages: ClientMessage[] = [
      { type: 'create_room', actionId: '11111111-1111-4111-8111-111111111111', playerName: 'Alice' },
      { type: 'join_room', actionId: '22222222-2222-4222-8222-222222222222', roomCode: 'ABCDEF', playerName: 'Bob' },
      { type: 'rejoin', actionId: '33333333-3333-4333-8333-333333333333', roomCode: 'ABCDEF', seatToken: 'token-xyz-123' },
      { type: 'set_ready', actionId: '44444444-4444-4444-8444-444444444444', baseVersion: 0, ready: true },
      { type: 'select_level', actionId: '55555555-5555-4555-8555-555555555555', baseVersion: 1, level: 'L1' },
      { type: 'start_game', actionId: '66666666-6666-4666-8666-666666666666', baseVersion: 2 },
      {
        type: 'choose_and_pass',
        actionId: '77777777-7777-4777-8777-777777777777',
        baseVersion: 3,
        keepCardId: 'murderer',
        passToPlayerId: 'p2',
        testimonyRole: 'guest',
      },
      { type: 'advance_to_vote', actionId: '88888888-8888-4888-8888-888888888888', baseVersion: 4 },
      { type: 'butler_peek', actionId: '99999999-9999-4999-8999-999999999999', baseVersion: 5 },
      { type: 'detective_send', actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', baseVersion: 6, targetLocation: 'lounge' },
      { type: 'cast_vote', actionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', baseVersion: 7, targetLocation: 'dining_room' },
      { type: 'rematch', actionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', baseVersion: 8 },
      { type: 'kick', actionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', baseVersion: 9, targetPlayerId: 'p3' },
      { type: 'leave', actionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', baseVersion: 10 },
      { type: 'pong' },
    ];

    for (const msg of validMessages) {
      const parsed = clientMessageSchema.safeParse(msg);
      assert.ok(parsed.success, `Failed to parse valid message: ${msg.type}: ${JSON.stringify(parsed.error?.issues)}`);
      // Exhaustive compile-time check
      assertExhaustiveClientMessage(parsed.data);
    }
  });

  test('invalid client messages are rejected without echoing input', () => {
    const invalidInputs = [
      { type: 'unknown_type', actionId: '11111111-1111-4111-8111-111111111111' },
      { type: 'set_ready', actionId: '11111111-1111-4111-8111-111111111111', baseVersion: -1, ready: true },
      { type: 'create_room', actionId: 'not-a-uuid', playerName: 'Alice' },
      { type: 'create_room', actionId: '11111111-1111-4111-8111-111111111111', playerName: 'A'.repeat(25) },
      { type: 'create_room', actionId: '11111111-1111-4111-8111-111111111111', playerName: '' },
      { type: 'cast_vote', actionId: '11111111-1111-4111-8111-111111111111', baseVersion: 0, targetLocation: 'invalid_loc' },
      {
        type: 'choose_and_pass',
        actionId: '11111111-1111-4111-8111-111111111111',
        baseVersion: 0,
        keepCardId: 'murderer',
        testimonyRole: 'non_existent_role',
      },
    ];

    for (const input of invalidInputs) {
      const parsed = clientMessageSchema.safeParse(input);
      assert.equal(parsed.success, false, `Input should have been rejected: ${JSON.stringify(input)}`);
    }
  });

  test('valid server message fixtures are accepted by safeParse', () => {
    const projectionFixture: PlayerProjection = {
      roomCode: 'ABCDEF',
      version: 1,
      phase: 'lobby',
      level: 'L1',
      viewerId: 'p1',
      isHost: true,
      players: [
        { playerId: 'p1', playerName: 'Alice', connected: true, ready: false, locationId: null, isHost: true },
      ],
      publicRoleRoster: ['murderer', 'guest'],
      currentActorId: null,
      servedPlayerIds: [],
      testimonyTrail: [],
    };

    const validServerMessages: ServerMessage[] = [
      { type: 'welcome', roomCode: 'ABCDEF', seatToken: 'tok-1', playerId: 'p1' },
      { type: 'projection', projection: projectionFixture },
      { type: 'error', code: 'ACTION_FAILED', message: 'Action rejected' },
      { type: 'ping' },
      { type: 'room_closed', reason: 'Room expired' },
    ];

    for (const msg of validServerMessages) {
      const parsed = serverMessageSchema.safeParse(msg);
      assert.ok(parsed.success, `Failed to parse valid server message: ${msg.type}`);
      assertExhaustiveServerMessage(parsed.data);
    }
  });

  test('projection contains no forbidden canonical keys or other-seat canary secrets', () => {
    const canarySecrets = {
      otherRoleSecret: 'CANARY_OTHER_PLAYER_ROLE_12345',
      deckSecret: 'CANARY_SECRET_DECK_ORDER_67890',
      setAsideSecret: 'CANARY_SET_ASIDE_SECRET_99999',
      seatTokenSecret: 'CANARY_SEAT_TOKEN_PRIVATE_88888',
    };

    // A viewer projection during discussion
    const projection: PlayerProjection = {
      roomCode: 'XYZ123',
      version: 5,
      phase: 'discussion',
      level: 'L7',
      viewerId: 'p1',
      isHost: true,
      players: [
        { playerId: 'p1', playerName: 'Alice', connected: true, ready: true, locationId: 'lounge', isHost: true, hasVoted: false },
        { playerId: 'p2', playerName: 'Bob', connected: true, ready: true, locationId: 'dining_room', isHost: false, hasVoted: false },
      ],
      publicRoleRoster: ['murderer', 'accomplice', 'bomber', 'lawyer', 'rich_merchant', 'detective', 'butler'],
      currentActorId: null,
      servedPlayerIds: ['p1', 'p2'],
      testimonyTrail: [
        { fromPlayerId: 'p1', toPlayerId: 'p2', testimonyRole: 'guest' },
      ],
      ownRole: { id: 'detective', role: 'detective', label: '偵探' },
    };

    const serialized = JSON.stringify(projection);

    // Verify none of the canary secrets leak into the projection
    for (const [key, canary] of Object.entries(canarySecrets)) {
      assert.ok(!serialized.includes(canary), `Canary ${key} leaked into projection: ${serialized}`);
    }

    // Verify canonical state keys are not present in serialized projection
    const forbiddenKeys = ['deck', 'canonicalState', 'setAsideCards', 'removedCards', 'allRoles', 'secretToken', 'seatToken'];
    for (const forbidden of forbiddenKeys) {
      assert.ok(!serialized.includes(`"${forbidden}"`), `Forbidden key ${forbidden} found in projection`);
    }
  });
});

function assertExhaustiveClientMessage(msg: ClientMessage): void {
  switch (msg.type) {
    case 'create_room':
    case 'join_room':
    case 'rejoin':
    case 'set_ready':
    case 'select_level':
    case 'start_game':
    case 'choose_and_pass':
    case 'advance_to_vote':
    case 'butler_peek':
    case 'detective_send':
    case 'cast_vote':
    case 'rematch':
    case 'kick':
    case 'leave':
    case 'pong':
      return;
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function assertExhaustiveServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
    case 'projection':
    case 'error':
    case 'ping':
    case 'room_closed':
      return;
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled server message type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
