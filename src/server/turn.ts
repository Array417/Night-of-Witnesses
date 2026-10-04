import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '../shared/protocol.ts';

export interface TurnConfig { host: string; secret: string }

/** Coturn REST credentials. Never send or log the shared signing secret. */
export function createTurnIceServers(config: TurnConfig | undefined, playerId: string, now = Date.now()): IceServerConfig[] {
  if (!config) return [];
  if (!/^[a-zA-Z0-9.-]+$/.test(config.host) || !config.secret) {
    throw new Error('TURN_HOST must be a hostname or IPv4 address and TURN_SHARED_SECRET must be set');
  }
  const username = `${Math.floor(now / 1000) + 5 * 60 * 60}:${playerId}`;
  const credential = createHmac('sha1', config.secret).update(username).digest('base64');
  return [
    { urls: `stun:${config.host}:3478` },
    { urls: [`turn:${config.host}:3478?transport=udp`, `turn:${config.host}:3478?transport=tcp`], username, credential },
  ];
}
