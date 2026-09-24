/**
 * Canonical clockwise seating ring with oval coordinates.
 * Pure helper: preserves projection.players order, viewer bottom-center,
 * next player right / previous player left. Guest Room is never a seat.
 */

export interface SeatInput {
  readonly playerId: string;
}

export interface SeatPosition {
  readonly playerId: string;
  readonly relativeIndex: number;
  readonly degrees: number;
  readonly radians: number;
  readonly x: number;
  readonly y: number;
  readonly isViewer: boolean;
}

export class SeatingError extends Error {
  readonly code: 'INVALID_PLAYER_COUNT' | 'UNKNOWN_VIEWER';
  constructor(code: 'INVALID_PLAYER_COUNT' | 'UNKNOWN_VIEWER', message: string) {
    super(message);
    this.name = 'SeatingError';
    this.code = code;
  }
}

const CENTER_X = 50;
const CENTER_Y = 50;
const RADIUS_X = 45;
const RADIUS_Y = 38;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getTableSeats(
  players: readonly SeatInput[],
  viewerId: string
): readonly SeatPosition[] {
  const count = players.length;
  if (count < 3 || count > 6) {
    throw new SeatingError('INVALID_PLAYER_COUNT', `Need 3 to 6 players, got ${count}`);
  }
  const viewerIndex = players.findIndex((p) => p.playerId === viewerId);
  if (viewerIndex === -1) {
    throw new SeatingError('UNKNOWN_VIEWER', `Viewer ${viewerId} not in player list`);
  }
  return players.map((player, index) => {
    const relativeIndex = (index - viewerIndex + count) % count;
    const degrees = (90 - (relativeIndex * 360) / count + 360) % 360;
    const radians = (degrees * Math.PI) / 180;
    return {
      playerId: player.playerId,
      relativeIndex,
      degrees,
      radians,
      x: round2(CENTER_X + RADIUS_X * Math.cos(radians)),
      y: round2(CENTER_Y + RADIUS_Y * Math.sin(radians)),
      isViewer: player.playerId === viewerId,
    };
  });
}
