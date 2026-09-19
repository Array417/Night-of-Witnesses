import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export interface ServerInstanceOptions {
  clientDistDir?: string;
  allowedOrigins?: string[];
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

  const server = http.createServer((req, res) => {
    setSecurityHeaders(res);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // 1. Health check endpoint
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 2. Robots.txt disallow all
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /\n');
      return;
    }

    // Only allow GET/HEAD for static files
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // 3. Static file resolution with path traversal guard
    const normalizedPath = path.normalize(decodeURIComponent(pathname));
    const targetPath = path.resolve(clientDistDir, '.' + normalizedPath);

    // Prevent path traversal outside clientDistDir
    if (!targetPath.startsWith(clientDistDir)) {
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
