import path from 'node:path';
import { createServerInstance } from './http.ts';
import { attachWebSocketServer } from './socket.ts';
import { RoomManager } from './rooms.ts';
import type { IceServerConfig } from '../shared/protocol.ts';

const SUPPORTED_ICE_SCHEMES = ['stun:', 'stuns:', 'turn:', 'turns:'];

function isSupportedIceUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SUPPORTED_ICE_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/**
 * Parse RTC_ICE_SERVERS_JSON env into validated ICE server configs.
 * Bounds: array <= 8 entries; urls string|string[] (each 1..512 chars, supported
 * stun/stuns/turn/turns scheme); username/credential <= 512 chars.
 * Invalid input yields [] (never throws, never logs credentials).
 */
export function parseIceServersEnv(raw: string | undefined): IceServerConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[Night of Witnesses] Invalid RTC_ICE_SERVERS_JSON: not JSON; using no ICE servers.');
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error('[Night of Witnesses] Invalid RTC_ICE_SERVERS_JSON: expected array; using no ICE servers.');
    return [];
  }
  if (parsed.length > 8) {
    console.error('[Night of Witnesses] Invalid RTC_ICE_SERVERS_JSON: too many entries; using no ICE servers.');
    return [];
  }
  const out: IceServerConfig[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const { urls, username, credential } = record;
    const urlList = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : null;
    if (!urlList || urlList.length === 0 || urlList.length > 8) return [];
    for (const url of urlList) {
      if (typeof url !== 'string' || url.length === 0 || url.length > 512 || !isSupportedIceUrl(url)) {
        return [];
      }
    }
    if (username !== undefined && (typeof username !== 'string' || username.length === 0 || username.length > 512)) {
      return [];
    }
    if (credential !== undefined && (typeof credential !== 'string' || credential.length === 0 || credential.length > 512)) {
      return [];
    }
    out.push({
      urls: typeof urls === 'string' ? urls : (urlList as string[]),
      ...(typeof username === 'string' ? { username } : {}),
      ...(typeof credential === 'string' ? { credential } : {}),
    });
  }
  return out;
}

const host = process.env.HOST || '127.0.0.1';
const port = parseInt(process.env.PORT || '3000', 10);
const rawOrigin = process.env.ORIGIN || `http://${host}:${port}`;
const allowedOrigins = rawOrigin.split(',').map((o) => o.trim());

// Allow localhost variants when running locally
if (host === '127.0.0.1' || host === 'localhost') {
  if (!allowedOrigins.includes('http://localhost:3000')) {
    allowedOrigins.push('http://localhost:3000');
  }
  if (!allowedOrigins.includes('http://127.0.0.1:3000')) {
    allowedOrigins.push('http://127.0.0.1:3000');
  }
  if (!allowedOrigins.includes(`http://localhost:${port}`)) {
    allowedOrigins.push(`http://localhost:${port}`);
  }
  if (!allowedOrigins.includes(`http://127.0.0.1:${port}`)) {
    allowedOrigins.push(`http://127.0.0.1:${port}`);
  }
}

const testSeed = process.env.TEST_SEED;
const iceServers = parseIceServersEnv(process.env.RTC_ICE_SERVERS_JSON);
const manager = new RoomManager({
  getSeed: testSeed ? () => testSeed : undefined,
});
const { server } = createServerInstance({
  clientDistDir: path.resolve('dist/client'),
  allowedOrigins,
});

const { close: closeSockets } = attachWebSocketServer(server, manager, {
  allowedOrigins,
  iceServers,
});

server.listen(port, host, () => {
  console.log(`[Night of Witnesses] Server listening on http://${host}:${port}`);
});

let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Night of Witnesses] Received ${signal}, starting graceful shutdown...`);

  try {
    await closeSockets();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('[Night of Witnesses] Server closed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[Night of Witnesses] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
