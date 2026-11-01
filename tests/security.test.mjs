import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { hashPassword } from '../src/auth/password.mjs';
import { readConfig } from '../src/config.mjs';
import { createStore } from '../src/auth/store.mjs';
import { createApp } from '../src/http-adapter.mjs';

const password = 'test-only-owner-password';
const passwordHash = await hashPassword(password);
function env() {
  return { APP_ORIGIN: 'http://localhost:3000', OWNER_PASSWORD_HASH: passwordHash, SESSION_SECRET: randomBytes(32).toString('hex'), ALLOW_LOCAL_MEMORY_STORE: '1' };
}
test('deployment fails closed without secure configuration and durable storage', () => {
  assert.throws(() => readConfig({ ...env(), VERCEL: '1' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env(), APP_ORIGIN: 'https://example.com', VERCEL: '1' }), /Redis/);
  assert.throws(() => readConfig({ ...env(), SESSION_SECRET: 'weak' }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ ...env(), APP_ORIGIN: 'http://localhost:3000/' }), /exact origin/);
});

test('browser audio assets load under a CSP allowing WASM without inline scripts', async t => {
  const f = await fixture(t);
  const response = await f.request('/voice-worker.mjs');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /'wasm-unsafe-eval'/);
  assert.match(response.headers.get('content-security-policy'), /font-src 'self'; img-src 'self'/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /'unsafe-inline'|'unsafe-eval'/);
  for (const path of ['/workspace-model.mjs', '/fonts/ibm-plex-sans-regular.ttf', '/fonts/ibm-plex-sans-medium.ttf', '/fonts/ibm-plex-sans-semibold.ttf', '/fonts/ibm-plex-mono-regular.ttf', '/fonts/ibm-plex-mono-medium.ttf', '/fonts/OFL.txt', '/icons/microphone.svg', '/icons/headphones.svg', '/audio-recovery.mjs', '/connection-diagnostics.mjs', '/voice-worklet.mjs', '/voice-frame.mjs', '/jitter-buffer.mjs', '/vendor/opus/index.js', '/vendor/opus/generated/libopus.generated.mjs']) assert.equal((await f.request(path)).status, 200);
});

test('app icons and manifest are public, valid images allowed by the content policy', async t => {
  const f = await fixture(t);
  const shell = await f.request('/');
  const html = await shell.text();
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(shell.headers.get('content-security-policy'), /manifest-src 'self'/);
  const response = await f.request('/site.webmanifest');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const [path, size] of [['/favicon-16x16.png', 16], ['/favicon-32x32.png', 32], ['/apple-touch-icon.png', 180], ...manifest.icons.map(icon => [icon.src, Number(icon.sizes.split('x')[0])])]) {
    const image = await f.request(path); assert.equal(image.status, 200, path);
    assert.match(image.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
  const ico = await f.request('/favicon.ico'); assert.equal(ico.status, 200);
  const bytes = Buffer.from(await ico.arrayBuffer()); assert.equal(bytes.readUInt16LE(2), 1); assert.equal(bytes.readUInt16LE(4), 3);
  for (const path of ['/favicon.svg', '/icons/safari-pinned-tab.svg']) {
    const svg = await f.request(path); assert.equal(svg.status, 200); assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  }
});

test('protocol audio controls reject wrong CSRF and malformed binary frames', async t => {
  const f = await fixture(t); const auth = await f.login();
  for (const payload of [JSON.stringify({ type: 'audio_state', inputMuted: false, outputMuted: false, csrf: 'wrong' }), Buffer.from([1, 2])]) {
    const client = f.ws(auth.cookie, f.origin, '/api/ts3');
    await once(client, 'open'); client.send(payload);
    const [code] = await once(client, 'close');
    assert.equal(code, typeof payload === 'string' ? 4403 : 1003);
  }
});

test('protocol heartbeat requires owner authentication, origin and CSRF, and validates its nonce', async t => {
  const f = await fixture(t); const auth = await f.login();
  assert.equal(await rejectedUpgrade(f.ws('', f.origin, '/api/ts3')), 401);
  assert.equal(await rejectedUpgrade(f.ws(auth.cookie, 'https://other.invalid', '/api/ts3')), 403);
  for (const [nonce, csrf, expected] of [[0, auth.csrf, null], [-1, auth.csrf, 1003], ['0', auth.csrf, 1003], [0, 'wrong', 4403]]) {
    const client = f.ws(auth.cookie, f.origin, '/api/ts3'); await once(client, 'open');
    if (expected) { const closed = once(client, 'close'); client.send(JSON.stringify({ type: 'ping', nonce, csrf })); assert.equal((await closed)[0], expected); }
    else {
      const reply = new Promise(resolve => client.on('message', data => { const event = JSON.parse(data); if (event.type === 'ts3_pong') resolve(event); }));
      client.send(JSON.stringify({ type: 'ping', nonce, csrf })); assert.deepEqual(await reply, { type: 'ts3_pong', nonce: 0 }); client.close();
    }
  }
});

test('channel connection options are bounded and local channel creation is not a public command', async t => {
  const f = await fixture(t); const auth = await f.login();
  for (const options of [{ channelId: 0 }, { channelId: 1.5 }, { channelId: '411' }, { channelPassword: {} }, { channelPassword: 'x'.repeat(257) }, { heartbeat: 'yes' }]) {
    const client = f.ws(auth.cookie, f.origin, '/api/ts3'); await once(client, 'open');
    const error = new Promise(resolve => client.on('message', data => { const event = JSON.parse(data); if (event.type === 'ts3_error') resolve(event); }));
    client.send(JSON.stringify({ type: 'connect', csrf: auth.csrf, connectionId: 'c'.repeat(32), ...options }));
    assert.equal((await error).code, 'invalid_connection_options'); client.close();
  }
  const client = f.ws(auth.cookie, f.origin, '/api/ts3'); await once(client, 'open');
  const closed = once(client, 'close'); client.send(JSON.stringify({ type: 'create_test_channel', csrf: auth.csrf }));
  assert.equal((await closed)[0], 1003);
});

test('Marketplace Redis aliases are supported without mixing incomplete credential pairs', () => {
  const settings = { ...env(), APP_ORIGIN: 'https://example.com', VERCEL: '1', KV_REST_API_URL: 'https://redis.example.com', KV_REST_API_TOKEN: 'test-only-token' };
  const config = readConfig(settings);
  assert.equal(config.redisUrl, settings.KV_REST_API_URL);
  assert.equal(config.redisToken, settings.KV_REST_API_TOKEN);
  assert.throws(() => readConfig({ ...settings, UPSTASH_REDIS_REST_URL: 'https://other.example.com' }), /Redis/);
});

async function fixture(t, storeOverride) {
  const config = readConfig(env());
  const store = storeOverride || createStore(config);
  const app = createApp(config, store);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  config.origin = origin;
  t.after(async () => {
    for (const client of app.wss.clients) client.terminate();
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
  });
  const request = (path, options = {}) => fetch(origin + path, options);
  const post = (path, body = {}, cookie = '', csrf = '', requestOrigin = origin) => request(path, {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify(body),
  });
  async function login() {
    const response = await post('/api/login', { password });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrf, header: response.headers.get('set-cookie') };
  }
  function ws(cookie = '', customOrigin = origin, path = '/api/ts3') {
    return new WebSocket(origin.replace('http:', 'ws:') + path, { headers: { Cookie: cookie, Origin: customOrigin } });
  }
  return { ...app, config, store, origin, request, post, login, ws };
}
function rejectedUpgrade(client) {
  return new Promise((resolve, reject) => {
    client.once('unexpected-response', (_req, res) => { res.resume(); client.terminate(); resolve(res.statusCode); });
    client.on('error', () => {});
    client.once('open', () => { client.terminate(); reject(new Error('Unauthorized upgrade succeeded')); });
  });
}
test('owner HTTP gate, origin checks, CSRF and durable logout revocation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/session')).status, 401);
  assert.equal((await f.post('/api/connection')).status, 401);
  assert.equal((await f.post('/api/login', { password }, '', '', 'https://attacker.invalid')).status, 403);
  assert.equal((await f.post('/api/login', { password: 'wrong' })).status, 401);
  const auth = await f.login();
  assert.match(auth.header, /HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('/api/session', { headers: { Cookie: auth.cookie } })).status, 200);
  assert.equal((await f.post('/api/connection', {}, auth.cookie)).status, 403);
  assert.equal((await f.post('/api/connection', {}, auth.cookie, auth.csrf)).status, 400);
  assert.equal((await f.post('/api/logout', {}, auth.cookie, auth.csrf)).status, 200);
  assert.equal((await f.request('/api/session', { headers: { Cookie: auth.cookie } })).status, 401);
  assert.equal((await f.request('/api/session?token=forbidden')).status, 400);
});

test('saving connection settings requires owner origin and CSRF and never returns bookmark passwords', async t => {
  const f = await fixture(t); f.config.identityKey = randomBytes(32).toString('hex');
  for (const path of ['/api/preferences', '/api/connection']) assert.equal((await f.request(path)).status, 401);
  const auth = await f.login();
  const value = { revision: 'empty', theme: 'system', nickname: 'Fixture', bookmarks: [{ id: 'only-me', name: 'Fixture', host: 'example.com', port: 9987, nickname: 'Fixture', password: 'test-only-bookmark-secret' }] };
  assert.equal((await f.post('/api/preferences', value, auth.cookie, 'wrong')).status, 403);
  assert.equal((await f.post('/api/preferences', value, auth.cookie, auth.csrf)).status, 200);
  const metadata = await (await f.request('/api/preferences', { headers: { Cookie: auth.cookie } })).text();
  assert.equal(metadata.includes('test-only-bookmark-secret'), false);
  const connection = { bookmarkId: 'only-me', host: 'example.com', port: 9987, nickname: 'Fixture' };
  assert.equal((await f.post('/api/connection', connection, auth.cookie, auth.csrf, 'https://other.invalid')).status, 403);
  assert.equal((await f.post('/api/connection', connection, auth.cookie)).status, 403);
  const saved = await f.post('/api/connection', connection, auth.cookie, auth.csrf);
  assert.equal(saved.status, 200);
  const body = await saved.text();
  assert.equal(body.includes('test-only-bookmark-secret'), false);
  const current = JSON.parse(body).connection;
  assert.match(current.id, /^[a-f0-9]{32}$/);
  assert.equal(current.hasPassword, true);
  assert.equal(Object.hasOwn(current, 'password'), false);
  const reloaded = await (await f.request('/api/preferences', { headers: { Cookie: auth.cookie } })).json();
  assert.equal(reloaded.connection.id, current.id);
  assert.equal(reloaded.connection.hasPassword, true);
  assert.equal((await f.post('/api/bookmarks/connection', { id: 'only-me' }, auth.cookie, auth.csrf)).status, 404);
});
test('WebSocket upgrades reject missing auth, cross-origin requests and query tokens', async t => {
  const f = await fixture(t);
  assert.equal(await rejectedUpgrade(f.ws()), 401);
  const auth = await f.login();
  assert.equal(await rejectedUpgrade(f.ws(auth.cookie, 'https://attacker.invalid')), 403);
  assert.equal(await rejectedUpgrade(f.ws(auth.cookie, f.origin, '/api/ts3?token=x')), 403);
});
test('authenticated protocol heartbeats work and logout closes active sockets', async t => {
  const f = await fixture(t);
  const auth = await f.login();
  const client = f.ws(auth.cookie);
  const metadata = once(client, 'message');
  await once(client, 'open');
  assert.equal(JSON.parse((await metadata)[0]).type, 'runtime');
  const response = once(client, 'message');
  client.send(JSON.stringify({ type: 'ping', nonce: 7, csrf: auth.csrf }));
  assert.deepEqual(JSON.parse((await response)[0]), { type: 'ts3_pong', nonce: 7 });
  const closed = once(client, 'close');
  await f.post('/api/logout', {}, auth.cookie, auth.csrf);
  assert.equal((await closed)[0], 4401);
});
test('sessions survive application replacement with the same durable store; secret rotation revokes them', async t => {
  const first = await fixture(t);
  const auth = await first.login();
  const replacement = createApp(first.config, first.store);
  assert.ok(await replacement.sessions.read({ headers: { cookie: auth.cookie } }));
  const rotated = createApp({ ...first.config, secret: randomBytes(32).toString('hex') }, first.store);
  assert.equal(await rotated.sessions.read({ headers: { cookie: auth.cookie } }), null);
  replacement.wss.close();
  rotated.wss.close();
});
test('session expiration and duplicate cookies fail authentication', async t => {
  const f = await fixture(t);
  f.config.sessionSeconds = 0;
  const auth = await f.login();
  assert.equal((await f.request('/api/session', { headers: { Cookie: auth.cookie } })).status, 401);
  assert.equal((await f.request('/api/session', { headers: { Cookie: `${auth.cookie}; ${auth.cookie}` } })).status, 401);
});
test('storage failure cannot open HTTP or WebSocket access', async t => {
  const failed = async () => { throw new Error('secret backend error'); };
  const f = await fixture(t, { get: failed, set: failed, delete: failed, limit: failed });
  const cookie = `voxharbor-local=${'a'.repeat(64)}`;
  const response = await f.request('/api/session', { headers: { Cookie: cookie } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret backend/);
  assert.equal(await rejectedUpgrade(f.ws(cookie)), 503);
});
test('login attempts are bounded across clients', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.post('/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await f.post('/api/login', { password })).status, 429);
});

test('revocation through another application instance closes the original socket', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const auth = await f.login();
  const client = f.ws(auth.cookie);
  await once(client, 'open');
  const closed = once(client, 'close');
  const replacement = createApp(f.config, f.store);
  await replacement.sessions.revoke({ headers: { cookie: auth.cookie } });
  assert.equal((await closed)[0], 4401);
  replacement.wss.close();
});

test('oversized WebSocket frames are rejected before processing', async t => {
  const f = await fixture(t);
  const auth = await f.login();
  const client = f.ws(auth.cookie);
  await once(client, 'open');
  const closed = once(client, 'close');
  client.send(randomBytes(4097));
  assert.equal((await closed)[0], 1009);
});

test('malformed and oversized login bodies cannot bypass authentication', async t => {
  const f = await fixture(t);
  const headers = { Origin: f.origin, 'Content-Type': 'application/json' };
  assert.equal((await f.request('/api/login', { method: 'POST', headers, body: '{broken' })).status, 400);
  assert.equal((await f.post('/api/login', { password: 'a'.repeat(3000) })).status, 413);
  const response = await f.request('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /<label for="username">Username<\/label>/);
  assert.equal((await f.request('/app.mjs')).status, 200);
  assert.equal((await f.request('/style.css')).status, 200);
});

test('protocol and identity operations enforce authentication, origin and CSRF before native execution', async t => {
  const f = await fixture(t);
  for (const path of ['/api/identity', '/api/protocol']) assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.post('/api/identity/create')).status, 401);
  assert.equal(await rejectedUpgrade(f.ws('', f.origin, '/api/ts3')), 401);
  const auth = await f.login();
  assert.equal((await f.post('/api/identity/create', {}, auth.cookie)).status, 403);
  assert.equal((await f.post('/api/identity/create', {}, auth.cookie, auth.csrf)).status, 409);
  assert.equal((await f.request('/api/identity/export', { headers: { Cookie: auth.cookie } })).status, 404);
  assert.equal(await rejectedUpgrade(f.ws(auth.cookie, 'https://attacker.invalid', '/api/ts3')), 403);
});

test('an authenticated protocol socket still rejects a command with the wrong CSRF token', async t => {
  const f = await fixture(t);
  const auth = await f.login();
  const client = f.ws(auth.cookie, f.origin, '/api/ts3');
  const welcome = once(client, 'message');
  await once(client, 'open');
  await welcome;
  const closed = once(client, 'close');
  client.send(JSON.stringify({ type: 'connect', csrf: 'wrong', nickname: 'test' }));
  assert.equal((await closed)[0], 4403);
});

const nativePath = fileURLToPath(new URL('../native/bin/voxharbor-protocol', import.meta.url));
test('real native identity creation persists once; ordinary responses never contain private material', { skip: !existsSync(nativePath) }, async t => {
  const f = await fixture(t);
  f.config.identityKey = randomBytes(32).toString('hex');
  f.config.protocolBinary = nativePath;
  const auth = await f.login();
  const created = await f.post('/api/identity/create', {}, auth.cookie, auth.csrf);
  assert.equal(created.status, 201);
  const metadata = (await created.json()).identity;
  assert.equal(metadata.level >= 16, true);
  assert.deepEqual(Object.keys(metadata).sort(), ['createdAt', 'level', 'uid']);
  const again = await f.post('/api/identity/create', {}, auth.cookie, auth.csrf);
  assert.equal(again.status, 409);
  const ordinary = await f.request('/api/identity', { headers: { Cookie: auth.cookie } });
  assert.deepEqual((await ordinary.json()).identity, metadata);
  const backup = await f.post('/api/identity/export', {}, auth.cookie, auth.csrf);
  assert.equal(backup.status, 200);
  assert.match(backup.headers.get('content-disposition'), /attachment/);
  const value = await backup.text();
  const replacement = await fixture(t);
  replacement.config.identityKey = randomBytes(32).toString('hex');
  replacement.config.protocolBinary = nativePath;
  const auth2 = await replacement.login();
  const imported = await replacement.post('/api/identity/import', { value }, auth2.cookie, auth2.csrf);
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).identity.uid, metadata.uid);
});
