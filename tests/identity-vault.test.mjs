import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createVault, openIdentity, sealIdentity } from '../src/identity/vault.mjs';
import { createStore } from '../src/auth/store.mjs';
import { resolveTeamSpeak } from '../src/transport/destination.mjs';

const key = () => randomBytes(32).toString('hex');
const material = { identity: { key: 'sensitive-test-key', counter: 4, max_counter: 4 }, metadata: { uid: 'test-uid', level: 16 }, createdAt: '2026-10-30' };
test('identity encryption authenticates ciphertext, nonce, key ID and key selection', () => {
  const config = { identityKey: key() };
  const ciphertext = sealIdentity(config, material);
  assert.doesNotMatch(ciphertext, /sensitive-test-key|test-uid/);
  assert.deepEqual(openIdentity(config, ciphertext), material);
  assert.notEqual(sealIdentity(config, material), ciphertext);
  for (const field of ['ciphertext', 'iv', 'tag', 'keyId']) {
    const tampered = JSON.parse(ciphertext);
    tampered[field] = `a${tampered[field].slice(1)}`;
    if (tampered[field] === JSON.parse(ciphertext)[field]) tampered[field] = `b${tampered[field].slice(1)}`;
    assert.throws(() => openIdentity(config, JSON.stringify(tampered)), /no identity was regenerated/);
  }
  assert.throws(() => openIdentity({ identityKey: key() }, ciphertext), /no identity was regenerated/);
});
test('durable identity is initialized once and survives session secret changes', async () => {
  const config = { identityKey: key(), memory: true };
  const store = createStore(config);
  const first = createVault(config, store);
  await first.initialize(material);
  await assert.rejects(first.initialize(material), /already exists/);
  const replacement = createVault({ ...config, secret: key() }, store);
  const loaded = await replacement.read();
  assert.deepEqual(loaded.identity, material.identity);
  await assert.rejects(replacement.update({ ...material, identity: { ...material.identity, key: 'changed-key' } }), /changed unexpectedly/);
  assert.deepEqual((await replacement.read()).identity, material.identity);
});
test('key rotation rewrites ciphertext and retains the same identity', async () => {
  const oldKey = key();
  const config = { identityKey: oldKey, memory: true };
  const store = createStore(config);
  await createVault(config, store).initialize(material);
  const nextConfig = { identityKey: key(), previousIdentityKey: oldKey };
  await createVault(nextConfig, store).rotate();
  assert.deepEqual((await createVault({ identityKey: nextConfig.identityKey }, store).read()).identity, material.identity);
  await assert.rejects(createVault(config, store).read(), /no identity was regenerated/);
});
test('a store read failure is never treated as a missing identity', async () => {
  const vault = createVault({ identityKey: key() }, { get: async () => { throw new Error('storage unavailable'); } });
  await assert.rejects(vault.read(), /storage unavailable/);
});
test('TeamSpeak resolution pins public addresses and rejects mixed/private DNS results', async () => {
  const config = { ts3Host: 'voice.example.test', ts3Port: 9987 };
  assert.equal((await resolveTeamSpeak(config, async () => ['1.1.1.1'])).address, '1.1.1.1:9987');
  for (const addresses of [[], ['127.0.0.1'], ['1.1.1.1', '169.254.169.254'], ['::ffff:127.0.0.1'], ['100.100.100.200']]) {
    await assert.rejects(resolveTeamSpeak(config, async () => addresses));
  }
});
