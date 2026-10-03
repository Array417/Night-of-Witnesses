import type { CanonicalGameState } from './state.ts';

/** Server-armed discussion deadline: strict majority starts a 15s clock. */
export const DISCUSSION_DEADLINE_MS = 15_000;

export function connectedPlayerIds(state: Readonly<CanonicalGameState>): string[] {
  return state.players.filter((p) => p.connected).map((p) => p.playerId);
}

/** Unanimous consent of all connected players (>0 required). */
export function isDiscussionUnanimous(state: Readonly<CanonicalGameState>): boolean {
  const connected = connectedPlayerIds(state);
  if (connected.length === 0) return false;
  const consents = new Set(state.discussionConsents ?? []);
  return connected.every((id) => consents.has(id));
}

/** Strict majority (>half) of connected players have consented. */
export function hasDiscussionMajority(state: Readonly<CanonicalGameState>): boolean {
  const connected = connectedPlayerIds(state);
  if (connected.length === 0) return false;
  const consents = new Set(state.discussionConsents ?? []);
  let count = 0;
  for (const id of connected) {
    if (consents.has(id)) count += 1;
  }
  return count * 2 > connected.length;
}

export function clearDiscussion(state: {
  discussionConsents: string[];
  discussionDeadlineAt: number | null;
}): void {
  state.discussionConsents = [];
  state.discussionDeadlineAt = null;
}
