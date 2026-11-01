import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { identityOperation } from '../src/platform/native-protocol.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { readConfig } from '../src/config.mjs';
import { createApp } from '../src/http-adapter.mjs';
import { createStore } from '../src/auth/store.mjs';
import { createAccounts } from '../src/auth/accounts.mjs';
import { createUserContext } from '../src/auth/user-context.mjs';
import { hashPassword } from '../src/auth/password.mjs';

const password = 'synthetic-multiuser-password';
const ownerHash = await hashPassword(password);
async function fixture(t) {
  const config = readConfig({ APP_ORIGIN: 'http://localhost:3000', OWNER_PASSWORD_HASH: ownerHash, SESSION_SECRET: randomBytes(32).toString('hex'), IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('hex'), ALLOW_LOCAL_MEMORY_STORE: '1' });
  const store = createStore(config); const app = createApp(config, store);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`; config.origin = origin;
  t.after(async () => { for (const ws of app.wss.clients) ws.terminate(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); });
  const request = (path, options = {}) => fetch(origin + path, options);
  const post = (path, input, auth = {}, requestOrigin = origin) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: auth.cookie || '', 'X-CSRF-Token': auth.csrf || '' }, body: JSON.stringify(input) });
  async function sign(username, register = true, previous) {
    const response = await post(register ? '/api/register' : '/api/login', { username, password }, previous);
    assert.equal(response.status, register ? 201 : 200); const data = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: data.csrf, user: data.user };
  }
  const get = async (path, auth) => { const response = await request(path, { headers: { Cookie: auth.cookie } }); assert.equal(response.status, 200); return response.json(); };
  async function socket(auth) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/ts3', { headers: { Cookie: auth.cookie, Origin: origin } });
    ws.events = []; ws.on('message', data => ws.events.push(JSON.parse(data)));
    await once(ws, 'open'); return ws;
  }
  return { config, store, app, origin, request, post, sign, get, socket };
}
function event(ws, predicate) {
  const existing = ws.events.find(predicate); if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', handler); reject(new Error('Expected protocol event did not arrive')); }, 3000);
    function handler(data) { const value = JSON.parse(data); if (predicate(value)) { clearTimeout(timeout); ws.off('message', handler); resolve(value); } }
    ws.on('message', handler);
  });
}
const settings = nickname => ({ host: '1.1.1.1', port: 9987, nickname, password: 'synthetic-connection-password' });

test('registration has an origin gate and validation, and cannot replace the reserved owner or an existing account', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/auth')).status, 200);
  assert.equal((await f.post('/api/register', { username: 'alice', password }, {}, 'https://other.invalid')).status, 403);
  assert.equal((await f.post('/api/register', { username: '../alice', password })).status, 400);
  assert.equal((await f.post('/api/register', { username: 'alice', password: 'short' })).status, 400);
  const alice = await f.sign('alice'); assert.deepEqual(alice.user, { username: 'alice' });
  assert.equal((await f.post('/api/register', { username: 'ALICE', password })).status, 409);
  assert.equal((await f.post('/api/register', { username: 'owner', password })).status, 409);
  assert.equal((await f.get('/api/session', alice)).user.username, 'alice');
  f.config.registration = false;
  assert.equal((await (await f.request('/api/auth')).json()).registrationEnabled, false);
  assert.equal((await f.post('/api/register', { username: 'bob', password })).status, 403);
  await f.sign('alice', false); await f.sign('owner', false);
});

test('HTTP settings and bookmarks belong to the session, ignore supplied account selectors, and survive a new sign-in', async t => {
  const f = await fixture(t); const alice = await f.sign('alice'); const bob = await f.sign('bob'); const owner = await f.sign('owner', false);
  assert.equal((await f.post('/api/connection', settings('Alice'), { ...alice, csrf: bob.csrf })).status, 403);
  const response = await f.post('/api/connection', { ...settings('Alice'), userId: 'owner', username: 'bob' }, alice);
  assert.equal(response.status, 200); const saved = await response.json();
  assert.equal(saved.connection.nickname, 'Alice'); assert.equal(JSON.stringify(saved).includes('synthetic-connection-password'), false);
  const pref = await f.get('/api/preferences', alice);
  const update = await f.post('/api/preferences', { ...pref, bookmarks: [{ id: 'alice-only', name: 'Alice bookmark', host: 'voice.example.test', port: 9987, nickname: 'Alice' }] }, alice);
  assert.equal(update.status, 200);
  for (const auth of [bob, owner]) { const result = await f.get('/api/preferences', auth); assert.equal(result.connection, null); assert.equal(result.bookmarks.length, 0); }
  const again = await f.sign('ALICE', false);
  const restored = await f.get('/api/preferences', again); assert.equal(restored.connection.id, saved.connection.id); assert.equal(restored.bookmarks[0].id, 'alice-only');
  assert.equal((await f.post('/api/preferences', { ...restored, userId: 'owner' }, bob)).status, 409);
  const a = await createAccounts(f.config, f.store).authenticate({ username: 'alice', password });
  const b = await createAccounts(f.config, f.store).authenticate({ username: 'bob', password });
  await createUserContext(f.config, f.store, a).vault.initialize({ identity: { key: 'synthetic-alice-key' }, metadata: { uid: 'synthetic-alice-uid', level: 8 } });
  await createUserContext(f.config, f.store, b).vault.initialize({ identity: { key: 'synthetic-bob-key' }, metadata: { uid: 'synthetic-bob-uid', level: 8 } });
  assert.equal((await f.get('/api/identity', alice)).identity.uid, 'synthetic-alice-uid'); assert.equal((await f.get('/api/identity', bob)).identity.uid, 'synthetic-bob-uid');
  assert.equal((await f.get('/api/identity', owner)).identity, null);
  assert.equal((await f.post('/api/identity/create', {}, bob)).status, 409);
});

test('two users can hold simulated protocol sessions concurrently; cross-user connection IDs fail and logout is isolated', async t => {
  const f = await fixture(t); const alice = await f.sign('alice'); const bob = await f.sign('bob');
  const directory = await mkdtemp(join(tmpdir(), 'voxharbor-multiuser-')); await symlink(process.execPath, join(directory, 'node'));
  const binary = join(directory, 'native');
  await writeFile(binary, `#!${directory}/node\nconst readline=require('node:readline'); let first=true; (async()=>{for await(const line of readline.createInterface({input:process.stdin})){const input=JSON.parse(line);if(first){first=false;console.log(JSON.stringify({type:'status',status:'connected'}));}else if(input.op==='disconnect')break;}})();\n`, { mode: 0o700 });
  t.after(() => rm(directory, { recursive: true, force: true })); f.config.protocolBinary = binary;
  const accounts = createAccounts(f.config, f.store);
  for (const name of ['alice', 'bob']) {
    const principal = await accounts.authenticate({ username: name, password });
    await createUserContext(f.config, f.store, principal).vault.initialize({ identity: { key: `synthetic-${name}` }, metadata: { uid: `synthetic-${name}`, level: 8 } });
  }
  const a = await (await f.post('/api/connection', settings('Alice'), alice)).json(); const b = await (await f.post('/api/connection', settings('Bob'), bob)).json();
  const wrong = await f.socket(bob); const denied = event(wrong, value => value.type === 'ts3_error');
  wrong.send(JSON.stringify({ type: 'connect', csrf: bob.csrf, connectionId: a.connection.id }));
  assert.equal((await denied).code, 'connection_settings_changed');
  const aw = await f.socket(alice); const bw = await f.socket(bob);
  for (const [ws, auth, saved] of [[aw, alice, a], [bw, bob, b]]) {
    const connected = event(ws, value => value.type === 'ts3_status' && value.status === 'connected');
    ws.send(JSON.stringify({ type: 'connect', csrf: auth.csrf, connectionId: saved.connection.id })); await connected;
  }
  const duplicate = await f.socket(alice); const capacity = event(duplicate, value => value.type === 'ts3_error');
  duplicate.send(JSON.stringify({ type: 'connect', csrf: alice.csrf, connectionId: a.connection.id }));
  assert.equal((await capacity).code, 'another_session_is_active');
  const closed = once(aw, 'close'); assert.equal((await f.post('/api/logout', {}, alice)).status, 200); assert.equal((await closed)[0], 4401);
  const pong = event(bw, value => value.type === 'ts3_pong'); bw.send(JSON.stringify({ type: 'ping', csrf: bob.csrf, nonce: 10 })); assert.equal((await pong).nonce, 10);
  assert.equal((await f.request('/api/preferences', { headers: { Cookie: alice.cookie } })).status, 401);
  assert.equal((await f.get('/api/preferences', bob)).connection.nickname, 'Bob');
});

test('replacing a browser login revokes the old session and socket without revoking another browser', async t => {
  const f = await fixture(t); const alice = await f.sign('alice'); const bob = await f.sign('bob');
  const ws = await f.socket(alice); const closed = once(ws, 'close');
  const replacement = await f.sign('bob', false, alice); assert.equal((await closed)[0], 4401);
  assert.equal((await f.request('/api/session', { headers: { Cookie: alice.cookie } })).status, 401);
  assert.equal((await f.get('/api/session', replacement)).user.username, 'bob'); assert.equal((await f.get('/api/session', bob)).user.username, 'bob');
});


const nativePath = fileURLToPath(new URL('../native/bin/voxharbor-protocol', import.meta.url));
test('registered users generate different real native identities and export only their own identity', { skip: !existsSync(nativePath) }, async t => {
  const f = await fixture(t); f.config.protocolBinary = nativePath;
  const alice = await f.sign('alice'); const bob = await f.sign('bob');
  const identities = [];
  for (const auth of [alice, bob]) {
    const created = await f.post('/api/identity/create', {}, auth); assert.equal(created.status, 201);
    const result = await created.json(); assert.equal(Object.hasOwn(result.identity, 'key'), false); identities.push(result.identity);
  }
  assert.notEqual(identities[0].uid, identities[1].uid);
  const exports = [];
  for (const [i, auth] of [alice, bob].entries()) {
    const response = await f.post('/api/identity/export', { username: i === 0 ? 'bob' : 'alice' }, auth); assert.equal(response.status, 200);
    const exported = await response.text(); const value = exported.match(/^identity="([^"\r\n]+)"/m)[1];
    const restored = await identityOperation(f.config, { op: 'import', value }); assert.equal(restored.metadata.uid, identities[i].uid); exports.push(exported);
  }
  assert.notEqual(exports[0], exports[1]);
  await f.post('/api/logout', {}, alice); const again = await f.sign('alice', false);
  assert.equal((await f.get('/api/identity', again)).identity.uid, identities[0].uid);
  assert.equal((await f.get('/api/identity', bob)).identity.uid, identities[1].uid);
});
