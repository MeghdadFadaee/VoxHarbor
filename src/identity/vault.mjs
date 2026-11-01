import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const STORAGE_KEY = 'voxharbor:identity:v1:owner';
function unavailable(message) { return Object.assign(new Error(message), { status: 503 }); }
function keysFor(config) {
  const values = [config.identityKey, config.previousIdentityKey].filter(Boolean);
  if (!values.length) throw Object.assign(new Error('Configure a separate IDENTITY_ENCRYPTION_KEY before creating an identity'), { status: 409 });
  return values.map(value => {
    if (!/^[a-f0-9]{64}$/i.test(value)) throw unavailable('Identity encryption key is invalid');
    const key = Buffer.from(value, 'hex');
    return { key, id: createHash('sha256').update(key).digest('hex').slice(0, 16) };
  });
}
export function sealIdentity(config, identity) {
  const { key, id } = keysFor(config)[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`voxharbor:identity:v1:owner:${id}${config.recordScope ? `:user:${config.recordScope}` : ''}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(identity), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, keyId: id, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}
export function openIdentity(config, serialized) {
  try {
    const envelope = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    const { key, id } = keysFor(config).find(item => item.id === envelope.keyId) || {};
    if (envelope.version !== 1 || !key) throw new Error();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`voxharbor:identity:v1:owner:${id}${config.recordScope ? `:user:${config.recordScope}` : ''}`));
    decipher.setAuthTag(tag);
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (!data.identity || !data.metadata?.uid || !Number.isInteger(data.metadata.level)) throw new Error();
    return data;
  } catch { throw unavailable('Identity could not be decrypted. Restore the correct encryption key and ciphertext; no identity was regenerated.'); }
}
export function createVault(config, store) {
  return {
    configured: () => Boolean(config.identityKey),
    async read() {
      const record = await store.get(STORAGE_KEY);
      return record === null ? null : openIdentity(config, record);
    },
    async initialize(result) {
      const record = { identity: result.identity, metadata: result.metadata, createdAt: new Date().toISOString() };
      const encrypted = sealIdentity(config, record);
      if (!await store.putIfAbsent(STORAGE_KEY, encrypted)) {
        throw Object.assign(new Error('An identity already exists; it was not replaced'), { status: 409 });
      }
      return { ...record.metadata, createdAt: record.createdAt };
    },
    async update(result) {
      const serialized = await store.get(STORAGE_KEY);
      if (serialized === null) throw unavailable('Stored identity is missing; reconnect stopped');
      const current = openIdentity(config, serialized);
      // An offset upgrade must preserve the actual private key, not just a claimed UID.
      if (current.metadata.uid !== result.metadata.uid || current.identity.key !== result.identity.key) throw unavailable('Protocol identity changed unexpectedly');
      const next = sealIdentity(config, { ...current, identity: result.identity, metadata: result.metadata });
      if (!await store.compareSet(STORAGE_KEY, serialized, next)) throw unavailable('Identity changed concurrently; reconnect stopped');
      return result.metadata;
    },
    async rotate() {
      const serialized = await store.get(STORAGE_KEY);
      if (serialized === null) throw Object.assign(new Error('No identity exists'), { status: 404 });
      const current = openIdentity(config, serialized);
      if (!await store.compareSet(STORAGE_KEY, serialized, sealIdentity(config, current))) throw unavailable('Identity changed concurrently');
      return current.metadata;
    },
  };
}
