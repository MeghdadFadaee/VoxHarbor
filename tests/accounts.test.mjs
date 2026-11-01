import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { createAccounts, accountKey } from '../src/auth/accounts.mjs';
import { createUserContext } from '../src/auth/user-context.mjs';
import { createSessions } from '../src/auth/session.mjs';
import { createStore } from '../src/auth/store.mjs';
import { createVault } from '../src/identity/vault.mjs';
import { createPreferences } from '../src/preferences.mjs';
import { hashPassword } from '../src/auth/password.mjs';
import { readConfig } from '../src/config.mjs';

const password = 'synthetic-account-password';
const ownerHash = await hashPassword(password);
const config = () => ({ memory: true, secret: randomBytes(32).toString('hex'), identityKey: randomBytes(32).toString('hex'), passwordHash: ownerHash, sessionSeconds: 900 });
const identity = suffix => ({ identity: { key: `synthetic-key-${suffix}` }, metadata: { uid: `synthetic-uid-${suffix}`, level: 8 } });

test('registration is atomic, canonical, durable, and stores a salted password hash', async () => {
  const settings = config(); const store = createStore(settings); const accounts = createAccounts(settings, store);
  const results = await Promise.allSettled(['Alice', 'ALICE'].map(username => accounts.register({ username, password })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const user = results.find(result => result.status === 'fulfilled').value;
  assert.equal(user.username, 'alice'); assert.match(user.id, /^[a-f0-9]{32}$/);
  const raw = await store.get(accountKey('alice'));
  assert.equal(raw.includes(password), false); assert.match(JSON.parse(raw).passwordHash, /^scrypt:/);
  assert.deepEqual(await createAccounts(settings, store).authenticate({ username: 'ALICE', password }), user);
  for (const input of [{ username: 'alice', password: 'wrong' }, { username: 'missing', password }, { username: '../alice', password }, { username: 'owner', password: 'wrong' }]) assert.equal(await accounts.authenticate(input), null);
  assert.deepEqual(await accounts.authenticate({ password }), { id: 'owner', username: 'owner' });
  for (const username of ['owner', 'OwNeR', 'ab', 'with space', '../owner', 'a'.repeat(33)]) await assert.rejects(accounts.register({ username, password }));
  await assert.rejects(accounts.register({ username: 'valid', password: 'short' }), error => error.status === 400);
});

test('registration can close without disabling existing accounts; no owner secret is needed for a new deployment', async () => {
  const settings = { ...config(), passwordHash: undefined }; const store = createStore(settings);
  const user = await createAccounts(settings, store).register({ username: 'alice', password });
  const closed = createAccounts({ ...settings, registration: false }, store);
  await assert.rejects(closed.register({ username: 'bob', password }), error => error.status === 403);
  assert.deepEqual(await closed.authenticate({ username: 'alice', password }), user);
  assert.equal(await closed.authenticate({ username: 'owner', password }), null);
  assert.equal(await closed.principal({}), null);
  await assert.rejects(createAccounts({ ...settings, identityKey: undefined }, store).register({ username: 'bob', password }), error => error.status === 409);
  assert.equal(readConfig({ APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: settings.secret, ALLOW_LOCAL_MEMORY_STORE: '1', ALLOW_REGISTRATION: '0' }).registration, false);
});

test('user identities, settings, leases and rate limits are isolated and ciphertext is bound to its account', async () => {
  const settings = config(); const store = createStore(settings); const accounts = createAccounts(settings, store);
  const a = await accounts.register({ username: 'alice', password }); const b = await accounts.register({ username: 'bob', password });
  const alice = createUserContext(settings, store, a); const bob = createUserContext(settings, store, b);
  await alice.vault.initialize(identity('alice')); await bob.vault.initialize(identity('bob'));
  const saved = await alice.preferences.saveConnection({ host: 'voice.example.test', port: 9987, nickname: 'Alice nickname', password: 'synthetic-server-password' });
  assert.equal((await bob.preferences.read()).connection, null); assert.equal((await bob.preferences.read()).nickname, 'bob');
  await assert.rejects(bob.preferences.activeConnection(saved.connection.id), error => error.code === 'connection_required');
  assert.equal((await bob.vault.read()).metadata.uid, 'synthetic-uid-bob');
  assert.equal(await alice.store.putIfAbsent('lease', 'alice', 35), true); assert.equal(await bob.store.putIfAbsent('lease', 'bob', 35), true);
  assert.equal(await alice.store.limit('rate', 1, 60), true); assert.equal(await alice.store.limit('rate', 1, 60), false); assert.equal(await bob.store.limit('rate', 1, 60), true);
  const aIdentity = await alice.store.get('voxharbor:identity:v1:owner'); const bIdentity = await bob.store.get('voxharbor:identity:v1:owner');
  await bob.store.compareSet('voxharbor:identity:v1:owner', bIdentity, aIdentity);
  await assert.rejects(bob.vault.read(), /could not be decrypted/);
  const aPreferences = await alice.store.get('voxharbor:preferences:v1:owner');
  await bob.store.putIfAbsent('voxharbor:preferences:v1:owner', aPreferences);
  await assert.rejects(bob.preferences.read(), /could not be decrypted/);
  assert.equal((await alice.vault.read()).metadata.uid, 'synthetic-uid-alice');
  assert.throws(() => createUserContext(settings, store, { id: '../owner' }));
});

test('legacy owner ciphertext and pre-account sessions keep their existing scope unchanged', async () => {
  const settings = config(); const store = createStore(settings);
  await createVault(settings, store).initialize(identity('owner'));
  await createPreferences(settings, store).saveConnection({ host: 'owner.example.test', port: 9987, nickname: 'Original owner' });
  const before = await store.get('voxharbor:identity:v1:owner'); const prefsBefore = await store.get('voxharbor:preferences:v1:owner');
  const sessions = createSessions(settings, store); const created = await sessions.create();
  const token = created.cookie.split(';')[0].split('=')[1];
  const namespace = createHmac('sha256', settings.secret).update('session-namespace-v1').digest('hex');
  const key = `vh:${namespace}:session:${createHash('sha256').update(token).digest('hex')}`;
  await store.set(key, JSON.stringify({ csrf: created.session.csrf, expires: created.session.expires }), 900);
  const legacy = await sessions.read({ headers: { cookie: created.cookie.split(';')[0] } });
  const principal = await createAccounts(settings, store).principal(legacy);
  const owner = createUserContext(settings, store, principal);
  assert.equal((await owner.vault.read()).metadata.uid, 'synthetic-uid-owner');
  assert.equal((await owner.preferences.read()).connection.nickname, 'Original owner');
  assert.equal(await store.get('voxharbor:identity:v1:owner'), before); assert.equal(await store.get('voxharbor:preferences:v1:owner'), prefsBefore);
});

test('sessions cannot claim another account ID and deleted account sessions fail closed', async () => {
  const settings = config(); const store = createStore(settings); const accounts = createAccounts(settings, store);
  const alice = await accounts.register({ username: 'alice', password }); const bob = await accounts.register({ username: 'bob', password });
  const session = { userId: alice.id, username: alice.username };
  assert.deepEqual(await accounts.principal(session), alice);
  assert.equal(await accounts.principal({ ...session, userId: bob.id }), null);
  assert.equal(await accounts.principal({ userId: 'owner', username: 'alice' }), null);
  await store.delete(accountKey('alice')); assert.equal(await accounts.principal(session), null);
});
