import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { RoomManager } from './rooms.ts';

export interface ServerInstanceOptions {
  clientDistDir?: string;
  allowedOrigins?: string[];
  manager?: RoomManager;
  apiBaseUrl?: string;
  internalSecret?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'"
  );
}

export function createServerInstance(options: ServerInstanceOptions = {}): {
  server: http.Server;
} {
  const clientDistDir = options.clientDistDir || path.resolve('dist/client');

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);

    let url: URL;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { res.writeHead(400); res.end(); return; }
    const pathname = url.pathname;

    if (pathname.startsWith('/internal') || /%2f|%5c|%2e/i.test(pathname)) {
      res.writeHead(404); res.end(); return;
    }
    if (pathname === '/api/rooms/public' && req.method === 'GET' && options.manager) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ rooms: options.manager.listPublicRooms() }));
      return;
    }
    if (pathname.startsWith('/api/') && options.apiBaseUrl) {
      try {
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 65_536) { res.writeHead(413); res.end(); return; }
          parts.push(Buffer.from(part));
        }
        const headers: Record<string, string> = {};
        for (const name of ['content-type', 'origin', 'cookie', 'x-csrf-token']) {
          const value = req.headers[name];
          if (typeof value === 'string') headers[name] = value;
        }
        if (options.internalSecret) {
          let address = req.socket.remoteAddress ?? 'unknown';
          const proxyToken = req.headers['x-now-proxy-token'];
          const proxyAddress = req.headers['x-now-client-ip'];
          const expected = Buffer.from(options.internalSecret);
          if (typeof proxyToken === 'string' && Buffer.byteLength(proxyToken) === expected.length && timingSafeEqual(Buffer.from(proxyToken), expected) && typeof proxyAddress === 'string' && isIP(proxyAddress)) address = proxyAddress;
          headers['x-now-client-ip'] = address;
          headers['x-now-client-signature'] = createHmac('sha256', options.internalSecret).update(address).digest('hex');
        }
        const upstream = new URL(options.apiBaseUrl);
        upstream.pathname = pathname;
        upstream.search = url.search;
        const response = await fetch(upstream, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(parts),
          signal: AbortSignal.timeout(15_000),
          redirect: 'manual',
        });
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: '帳戶服務暫時無法使用，請稍後再試。' }));
      }
      return;
    }

    // 1. Health check endpoint
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 2. Robots.txt allow crawling while disallowing websocket endpoints
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\nDisallow: /ws/\n');
      return;
    }

    // Only allow GET/HEAD for static files
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // 3. Static file resolution with path traversal guard
    let normalizedPath: string;
    try { normalizedPath = path.normalize(decodeURIComponent(pathname)); }
    catch { res.writeHead(400); res.end(); return; }
    const targetPath = path.resolve(clientDistDir, '.' + normalizedPath);

    // Prevent path traversal outside clientDistDir
    if (targetPath !== clientDistDir && !targetPath.startsWith(clientDistDir + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // If file exists and is a file, serve it
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(targetPath).pipe(res);
      }
      return;
    }

    // 4. SPA Fallback: serve index.html if it exists
    const indexPath = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(indexPath).pipe(res);
      }
      return;
    }

    // If index.html doesn't exist, 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return { server };
}
