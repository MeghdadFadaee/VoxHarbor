import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPreferences, destinationOptions } from '../src/preferences.mjs';
import { createStore } from '../src/auth/store.mjs';

const fixture = () => ({ config: { identityKey: randomBytes(32).toString('hex') }, store: createStore({ memory: true }) });
const input = revision => ({ revision, theme: 'dark', nickname: 'Owner', bookmarks: [{ id: 'fixture', name: 'Test server', host: 'ts.example.com', port: 9987, nickname: 'Owner', channelId: 411, password: 'fixture-server-password', channelPassword: 'fixture-channel-password' }] });

test('saved connections survive a new preferences instance and never expose passwords in metadata', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  const saved = await vault.save(input((await vault.read()).revision));
  assert.equal(saved.bookmarks[0].hasPassword, true); assert.equal(saved.bookmarks[0].hasChannelPassword, true);
  assert.equal(JSON.stringify(saved).includes('fixture-channel-password'), false);
  assert.equal(JSON.stringify(saved).includes('fixture-server-password'), false);
  const ciphertext = await store.get('voxharbor:preferences:v1:owner');
  assert.equal(ciphertext.includes('fixture-channel-password'), false); assert.equal(ciphertext.includes('ts.example.com'), false);
  const restarted = createPreferences(config, store);
  assert.deepEqual(await restarted.read(), saved);
  assert.equal((await restarted.connection('fixture')).channelPassword, 'fixture-channel-password');
  await assert.rejects(restarted.connection('missing'), error => error.status === 404);
});

test('metadata edits preserve stored secrets, explicit clearing removes them, and stale writes fail', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  const saved = await vault.save(input('empty')); const edited = await vault.save({ ...saved, nickname: 'Renamed' });
  assert.equal((await vault.connection('fixture')).password, 'fixture-server-password');
  await assert.rejects(vault.save(saved), error => error.status === 409);
  const cleared = await vault.save({ ...edited, bookmarks: edited.bookmarks.map(bookmark => ({ ...bookmark, password: '', channelPassword: '' })) });
  assert.equal(cleared.bookmarks[0].hasPassword, false); assert.equal((await vault.connection('fixture')).channelPassword, '');
});

test('wrong keys and tampering fail closed without resetting saved connections', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store); await vault.save(input('empty'));
  const original = await store.get('voxharbor:preferences:v1:owner');
  const wrong = createPreferences({ identityKey: randomBytes(32).toString('hex') }, store);
  await assert.rejects(wrong.read(), /could not be decrypted/); await assert.rejects(wrong.save(input('empty')), /could not be decrypted/);
  assert.equal(await store.get('voxharbor:preferences:v1:owner'), original);
  const envelope = JSON.parse(original); envelope.tag = Buffer.alloc(16).toString('base64');
  await store.compareSet('voxharbor:preferences:v1:owner', original, JSON.stringify(envelope));
  await assert.rejects(vault.read(), /could not be decrypted/);
});

test('preferences can be rewrapped with the previous key without replacing identity data', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store); await vault.save(input('empty'));
  await store.putIfAbsent('voxharbor:identity:v1:owner', 'untouched-fixture-identity');
  const newKey = randomBytes(32).toString('hex');
  await createPreferences({ identityKey: newKey, previousIdentityKey: config.identityKey }, store).rotate();
  assert.equal((await createPreferences({ identityKey: newKey }, store).connection('fixture')).password, 'fixture-server-password');
  assert.equal(await store.get('voxharbor:identity:v1:owner'), 'untouched-fixture-identity');
});

test('saved connection inputs are bounded and destinations are normalized without resolving them', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  for (const options of [{ host: 'http://example.com', port: 9987 }, { host: 'example.com', port: 80 }, { host: 'example.com', port: 65536 }, { host: 'example.com', port: '9987' }]) assert.throws(() => destinationOptions(options));
  assert.deepEqual(destinationOptions({ host: 'TS.Example.com', port: 9987 }), { host: 'ts.example.com', port: 9987 });
  await assert.rejects(vault.save({ ...input('empty'), bookmarks: [...input('empty').bookmarks, ...input('empty').bookmarks] }), /Invalid saved connection/);
  await assert.rejects(vault.save({ ...input('empty'), theme: 'anything' }), /Invalid workspace/);
});

test('current connection credentials stay encrypted and survive reload without metadata disclosure', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  const saved = await vault.saveConnection({ host: 'voice.example.test', port: 9987, nickname: 'Owner', channelId: 12, password: 'fixture-server-secret', channelPassword: 'fixture-channel-secret' });
  assert.equal(saved.connection.hasPassword, true); assert.equal(saved.connection.hasChannelPassword, true);
  assert.equal(JSON.stringify(saved).includes('fixture-server-secret'), false); assert.equal(JSON.stringify(saved).includes('fixture-channel-secret'), false);
  assert.equal((await store.get('voxharbor:preferences:v1:owner')).includes('fixture-server-secret'), false);
  const restarted = createPreferences(config, store);
  assert.equal((await restarted.activeConnection(saved.connection.id)).channelPassword, 'fixture-channel-secret');
  await assert.rejects(restarted.activeConnection('a'.repeat(32)), error => error.code === 'connection_settings_changed');
  const edited = await restarted.save({ ...saved, theme: 'light' });
  assert.equal((await restarted.activeConnection(edited.connection.id)).password, 'fixture-server-secret');
});

test('passwords are preserved only for the same destination and channel and can be cleared explicitly', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  const base = { host: 'one.example.test', port: 9987, nickname: 'Owner', channelId: 12 };
  await vault.saveConnection({ ...base, password: 'server-fixture-secret', channelPassword: 'channel-fixture-secret' });
  let result = await vault.saveConnection(base);
  assert.equal((await vault.activeConnection(result.connection.id)).password, 'server-fixture-secret');
  result = await vault.saveConnection({ ...base, channelId: 13 });
  let connection = await vault.activeConnection(result.connection.id);
  assert.equal(connection.password, 'server-fixture-secret'); assert.equal(connection.channelPassword, '');
  result = await vault.saveConnection({ ...base, host: 'two.example.test' });
  connection = await vault.activeConnection(result.connection.id); assert.equal(connection.password, ''); assert.equal(connection.channelPassword, '');
  await vault.saveConnection({ ...base, password: 'server-fixture-secret' });
  result = await vault.saveConnection({ ...base, password: '', channelPassword: '' });
  assert.equal((await vault.activeConnection(result.connection.id)).password, '');
});

test('bookmark credentials are selected on the backend and cannot follow an edited host', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store); await vault.save(input('empty'));
  const bookmark = { bookmarkId: 'fixture', host: 'ts.example.com', port: 9987, nickname: 'Owner', channelId: 411 };
  let result = await vault.saveConnection(bookmark);
  assert.equal((await vault.activeConnection(result.connection.id)).password, 'fixture-server-password');
  result = await vault.saveConnection({ ...bookmark, host: 'different.example.test' });
  const connection = await vault.activeConnection(result.connection.id); assert.equal(connection.password, ''); assert.equal(connection.channelPassword, '');
  await assert.rejects(vault.saveConnection({ ...bookmark, bookmarkId: 'missing' }), error => error.status === 404);
});

test('acknowledged connection changes preserve bookmarks, IDs and secrets without reviving stale settings', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store); await vault.save(input('empty'));
  const initial = await vault.saveConnection({ host: 'voice.example.test', port: 9987, nickname: 'Owner', password: 'fixture-secret', channelId: 12 });
  const id = initial.connection.id;
  const changed = await vault.updateConnection(id, { channelId: 13, channelPassword: 'fixture-channel-secret' });
  assert.equal(changed.connection.id, id); assert.equal(changed.bookmarks.length, 1);
  assert.equal((await vault.activeConnection(id)).password, 'fixture-secret');
  await vault.saveConnection({ host: 'new.example.test', port: 9987, nickname: 'New' });
  assert.equal(await vault.updateConnection(id, { nickname: 'Stale' }), false);
});


test('editing a bookmark destination never carries credentials to another server or channel', async () => {
  const { config, store } = fixture(); const vault = createPreferences(config, store);
  let saved = await vault.save(input('empty'));
  saved = await vault.save({ ...saved, bookmarks: saved.bookmarks.map(bookmark => ({ ...bookmark, channelId: 12 })) });
  let bookmark = await vault.connection('fixture');
  assert.equal(bookmark.password, 'fixture-server-password'); assert.equal(bookmark.channelPassword, '');
  await vault.save({ ...saved, bookmarks: saved.bookmarks.map(bookmark => ({ ...bookmark, host: 'other.example.test' })) });
  bookmark = await vault.connection('fixture');
  assert.equal(bookmark.password, ''); assert.equal(bookmark.channelPassword, '');
});
