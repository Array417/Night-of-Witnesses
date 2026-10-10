import type { CanonicalGameState, PlayerProjection } from '../shared/state.ts';
import type { RoleId } from '../shared/rules.ts';

export function projectForViewer(
  state: Readonly<CanonicalGameState>,
  viewerPlayerId: string,
  now = Date.now()
): PlayerProjection {
  const isHost = viewerPlayerId === state.hostPlayerId;

  // Build public role roster for current setup/level
  const publicRoleSet = new Set<RoleId>();
  if (state.playableCards.length > 0) {
    for (const card of state.playableCards) {
      publicRoleSet.add(card.role);
    }
    for (const card of state.setAsideCards) {
      publicRoleSet.add(card.role);
    }
  } else {
    // In lobby, default roster based on level
    if (state.level === 'L1') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('guest');
    } else if (state.level === 'L2') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('accomplice');
      publicRoleSet.add('guest');
    } else if (state.level === 'L3') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('accomplice');
      publicRoleSet.add('lawyer');
      publicRoleSet.add('guest');
    } else if (state.level === 'L4') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('bomber');
      publicRoleSet.add('guest');
    } else if (state.level === 'L5') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('bomber');
      publicRoleSet.add('rich_merchant');
      publicRoleSet.add('guest');
    } else if (state.level === 'L6') {
      publicRoleSet.add('murderer');
      publicRoleSet.add('bomber');
      publicRoleSet.add('detective');
      publicRoleSet.add('guest');
    } else {
      // L7, L8
      publicRoleSet.add('murderer');
      publicRoleSet.add('accomplice');
      publicRoleSet.add('bomber');
      publicRoleSet.add('lawyer');
      publicRoleSet.add('rich_merchant');
      publicRoleSet.add('detective');
      publicRoleSet.add('butler');
      publicRoleSet.add('guest');
    }
  }

  const players = state.players.map((p) => ({
    playerId: p.playerId,
    playerName: p.playerName,
    connected: p.connected,
    ready: p.ready,
    locationId: p.locationId,
    isHost: p.playerId === state.hostPlayerId,
    hasVoted: state.phase === 'voting' ? Boolean(state.votes[p.playerId]) : undefined,
    handCount: state.pendingCards[p.playerId]?.length ?? (state.keptRoles[p.playerId] ? 1 : 0),
  }));

  // Private viewer properties
  const ownCards =
    state.phase === 'draft'
      ? state.pendingCards[viewerPlayerId]
      : undefined;

  const ownRole = state.keptRoles[viewerPlayerId];
  const ownBallot = state.votes[viewerPlayerId];

  // Butler peek projection: ONLY Butler viewer who has peeked gets to see setAsideCards
  const isButler = ownRole?.role === 'butler';
  const butlerPeek =
    isButler && state.butlerPeeked && state.setAsideCards.length > 0
      ? state.setAsideCards
      : undefined;

  const detectiveSentLocation = state.detectiveUsed
    ? state.detectiveTargetLocation
    : undefined;

  const result =
    state.phase === 'resolution' || state.phase === 'game_over'
      ? (state.result ?? undefined)
      : undefined;

  const motion = state.cardMotion;
  const cardMotion = motion ? {
    id: motion.id, kind: motion.kind, fromPlayerId: motion.fromPlayerId, toPlayerId: motion.toPlayerId,
    startedAt: motion.startedAt, endsAt: motion.endsAt,
    ...(viewerPlayerId === motion.fromPlayerId || viewerPlayerId === motion.toPlayerId ? { card: motion.card } : {}),
  } : null;

  return {
    roomCode: state.roomCode,
    version: state.version,
    phase: state.phase,
    level: state.level,
    viewerId: viewerPlayerId,
    isHost,
    players,
    publicRoleRoster: Array.from(publicRoleSet),
    currentActorId: state.currentActorId,
    servedPlayerIds: state.servedPlayerIds,
    testimonyTrail: state.testimonyTrail,
    drawPileCount: Math.max(0, state.playableCards.length - (state.drawPileIndex ?? 0)),
    cardMotion,
    serverTime: motion ? now : undefined,
    ownCards,
    ownRole,
    ownBallot,
    butlerPeek,
    detectiveSentLocation,
    discussionConsents: state.discussionConsents ?? [],
    discussionDeadlineAt: state.discussionDeadlineAt ?? null,
    result,
  };
}
