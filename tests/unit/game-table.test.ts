import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTableSeats } from '../../src/client/views/game-seating.ts';

function makePlayers(n: number): Array<{ playerId: string; playerName: string }> {
  return Array.from({ length: n }, (_, i) => ({
    playerId: `p${i + 1}`,
    playerName: `P${i + 1}`,
  }));
}

describe('canonical clockwise seating', () => {
  for (const n of [3, 4, 5, 6]) {
    test(`Given ${n} players When every viewer seats Then self is bottom-center with order preserved`, () => {
      const players = makePlayers(n);
      for (const viewer of players) {
        const before = JSON.stringify(players);
        const seats = getTableSeats(players, viewer.playerId);
        // Guest Room excluded: one seat per player, no guest_room seat
        assert.equal(seats.length, n);
        assert.ok(seats.every((s) => s.playerId !== 'guest_room'));
        // Self resolves to x=50,y=88
        const self = seats.find((s) => s.playerId === viewer.playerId);
        assert.ok(self);
        assert.equal(self.relativeIndex, 0);
        assert.equal(self.x, 50);
        assert.equal(self.y, 88);
        // Preserves player order: relativeIndex matches projection index distance
        for (const seat of seats) {
          const idx = players.findIndex((p) => p.playerId === seat.playerId);
          const viewerIdx = players.findIndex((p) => p.playerId === viewer.playerId);
          const expected = (idx - viewerIdx + n) % n;
          assert.equal(seat.relativeIndex, expected);
        }
        // Input not mutated
        assert.equal(JSON.stringify(players), before);
      }
    });

    test(`Given ${n} players When seated Then next is right and previous is left`, () => {
      const players = makePlayers(n);
      for (const viewer of players) {
        const seats = getTableSeats(players, viewer.playerId);
        const viewerIdx = players.findIndex((p) => p.playerId === viewer.playerId);
        const nextId = players[(viewerIdx + 1) % n]?.playerId;
        const prevId = players[(viewerIdx - 1 + n) % n]?.playerId;
        const next = seats.find((s) => s.playerId === nextId);
        const prev = seats.find((s) => s.playerId === prevId);
        assert.ok(next && prev);
        if (n > 2) {
          assert.ok(next.x > 50, `next ${next.playerId} x=${next.x} should be right of center`);
          assert.ok(prev.x < 50, `prev ${prev.playerId} x=${prev.x} should be left of center`);
        }
      }
    });

    test(`Given ${n} players When seated Then coordinates are finite, in-bounds and follow the oval formula`, () => {
      const players = makePlayers(n);
      for (const viewer of players) {
        const seats = getTableSeats(players, viewer.playerId);
        for (const seat of seats) {
          const expectedDegrees = (90 - (seat.relativeIndex * 360) / n + 360) % 360;
          const expectedRadians = (expectedDegrees * Math.PI) / 180;
          const expectedX = Math.round((50 + 45 * Math.cos(expectedRadians)) * 100) / 100;
          const expectedY = Math.round((50 + 38 * Math.sin(expectedRadians)) * 100) / 100;
          assert.equal(seat.degrees, expectedDegrees);
          assert.equal(seat.radians, expectedRadians);
          assert.equal(seat.x, expectedX);
          assert.equal(seat.y, expectedY);
          assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.y));
          assert.ok(seat.x >= 0 && seat.x <= 100);
          assert.ok(seat.y >= 0 && seat.y <= 100);
        }
      }
    });

    test(`Given ${n} players When viewed reciprocally Then adjacency is reciprocal and rerenders are stable`, () => {
      const players = makePlayers(n);
      for (const viewer of players) {
        const seats = getTableSeats(players, viewer.playerId);
        const viewerIdx = players.findIndex((p) => p.playerId === viewer.playerId);
        const nextId = players[(viewerIdx + 1) % n]?.playerId ?? '';
        // Reciprocal: from next's perspective, viewer is previous (relativeIndex n-1)
        const fromNext = getTableSeats(players, nextId);
        const back = fromNext.find((s) => s.playerId === viewer.playerId);
        assert.ok(back);
        assert.equal(back.relativeIndex, (n - 1) % n);
        // Stable rerenders: repeat calls deep-equal
        assert.deepEqual(getTableSeats(players, viewer.playerId), seats);
      }
    });
  }

  test('Given invalid player counts When seating Then it throws without mutating input', () => {
    assert.throws(() => getTableSeats(makePlayers(2), 'p1'));
    assert.throws(() => getTableSeats(makePlayers(7), 'p1'));
    assert.throws(() => getTableSeats(makePlayers(4), 'ghost'));
  });
});
