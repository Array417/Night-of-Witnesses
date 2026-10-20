import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServerInstance } from '../../src/server/http.ts';

test('proxy signs distinct client IPs and ignores forged forwarding headers', async () => {
  const secret = 'proxy-test-secret-at-least-32-characters';
  const upstream = http.createServer((request, response) => { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(request.headers)); });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const {server} = createServerInstance({apiBaseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`, internalSecret:secret});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as {port:number}).port;
  const request = (address: string, trusted = false) => new Promise<Record<string,string>>((resolve,reject) => {
    http.get({host:'127.0.0.1',port,path:'/api/auth/me',localAddress:address,headers:{'x-now-client-ip':'198.51.100.7','x-now-client-signature':'forged','x-now-proxy-token':trusted ? secret : 'forged','x-forwarded-for':'203.0.113.1'}}, response => {
      let body = ''; response.on('data',chunk => { body += chunk; }); response.on('end',() => resolve(JSON.parse(body)));
    }).on('error',reject);
  });
  try {
    for (const address of ['127.0.0.2','127.0.0.3']) {
      const headers = await request(address);
      assert.equal(headers['x-now-client-ip'],address);
      assert.equal(headers['x-now-client-signature'],createHmac('sha256',secret).update(address).digest('hex'));
      assert.equal(headers['x-now-proxy-token'],undefined);
    }
    assert.equal((await request('127.0.0.2',true))['x-now-client-ip'],'198.51.100.7');
  } finally { await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),new Promise<void>(resolve => upstream.close(() => resolve()))]); }
});

test('proxy forwards session and CSRF cookies but never exposes internal endpoints', async () => {
  let requests = 0;
  const upstream = http.createServer((request, response) => {
    requests += 1;
    response.writeHead(200, { 'Content-Type':'application/json', 'Set-Cookie':['now_user_session=example; HttpOnly; Path=/', 'other=value; Path=/'] });
    response.end(JSON.stringify({cookie:request.headers.cookie, csrf:request.headers['x-csrf-token'], authorization:request.headers.authorization ?? null}));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const upstreamPort = (upstream.address() as {port:number}).port;
  const {server} = createServerInstance({apiBaseUrl:`http://127.0.0.1:${upstreamPort}`});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const response = await fetch(base+'/api/auth/me', {headers:{Cookie:'now_user_session=example', 'X-CSRF-Token':'csrf', Authorization:'Bearer browser-forgery'}});
    assert.deepEqual(await response.json(), {cookie:'now_user_session=example',csrf:'csrf',authorization:null});
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal((await fetch(base+'/internal/sessions/resolve')).status, 404);
    assert.equal((await fetch(base+'/api%2finternal/sessions/resolve')).status, 404);
    assert.equal(requests, 1);
    const malformed = await new Promise<number>((resolve, reject) => {
      const request = http.get(base+'/%', response => { response.resume(); resolve(response.statusCode!); });
      request.setTimeout(1000, () => request.destroy(new Error('Malformed path was not answered')));
      request.on('error', reject);
    });
    assert.equal(malformed, 400);
  } finally { await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),new Promise<void>(resolve => upstream.close(() => resolve()))]); }
});
