import path from 'node:path';
import { createServerInstance } from './http.ts';
import { attachWebSocketServer } from './socket.ts';
import { RoomManager } from './rooms.ts';

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

const manager = new RoomManager();
const { server } = createServerInstance({
  clientDistDir: path.resolve('dist/client'),
  allowedOrigins,
});

const { close: closeSockets } = attachWebSocketServer(server, manager, {
  allowedOrigins,
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
