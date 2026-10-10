import { reduceGame, finishCardMotion, type GameAction } from '../../src/shared/game.ts';
import type { CanonicalGameState } from '../../src/shared/state.ts';
import { RoomManager } from '../../src/server/rooms.ts';
import { randomUUID } from 'node:crypto';

/** Complete real draw actions when a rules/discussion test needs a ready two-card hand. */
export function reducePreparedGame(state: Readonly<CanonicalGameState>, action: GameAction): CanonicalGameState {
  let next = reduceGame(state, action);
  if (action.type !== 'start_game' && action.type !== 'choose_and_pass') return next;
  next = finishCardMotion(next, next.cardMotion?.endsAt ?? 0);
  while (next.phase === 'draft' && next.currentActorId && next.pendingCards[next.currentActorId].length < 2) {
    next = reduceGame(next, { type: 'draw_card', actionId: `test-draw-${next.version}`, baseVersion: next.version, playerId: next.currentActorId });
    next = finishCardMotion(next, next.cardMotion!.endsAt);
  }
  return next;
}

export function prepareRoomHand(manager: RoomManager, code: string): void {
  const room = manager.getRoom(code)!;
  room.state = finishCardMotion(room.state, room.state.cardMotion?.endsAt ?? 0);
  while (room.state.phase === 'draft' && room.state.currentActorId && room.state.pendingCards[room.state.currentActorId].length < 2) {
    manager.dispatchAction(code, room.state.currentActorId, { type: 'draw_card', actionId: randomUUID(), baseVersion: room.state.version });
    room.state = finishCardMotion(room.state, room.state.cardMotion!.endsAt);
  }
}
