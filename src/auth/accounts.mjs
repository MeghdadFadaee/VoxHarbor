import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.mjs';

const owner = Object.freeze({ id: 'owner', username: 'owner' });
const fail = (message, status) => Object.assign(new Error(message), { status });
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(value)) throw fail('Use a username of 3–32 letters, numbers, underscores or hyphens.', 400);
  return value.toLowerCase();
}
export const accountKey = name => `voxharbor:account:v1:${createHash('sha256').update(name).digest('hex')}`;
export function createAccounts(config, store) {
  // Unknown accounts still perform the same password derivation as known accounts.
  let dummy;
  const dummyHash = () => config.passwordHash || (dummy ||= hashPassword(randomBytes(32).toString('hex')));
  async function find(name) {
    const serialized = await store.get(accountKey(name));
    if (serialized === null) return null;
    const record = JSON.parse(serialized);
    if (record.version !== 1 || record.username !== name || !/^[a-f0-9]{32}$/.test(record.id || '') || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(record.passwordHash || '')) throw new Error('Account storage unavailable');
    return record;
  }
  return {
    async register(input) {
      if (config.registration === false) throw fail('Registration is currently closed.', 403);
      if (!config.identityKey) throw fail('Registration is unavailable until encrypted storage is configured.', 409);
      const name = username(input?.username);
      const passwordHash = await hashPassword(input?.password).catch(() => { throw fail('Use a password of 16–256 characters.', 400); });
      const record = { version: 1, id: randomBytes(16).toString('hex'), username: name, passwordHash, createdAt: new Date().toISOString() };
      // One atomic record owns both the username and ID: concurrent signup cannot replace an account.
      if (name === 'owner' || !await store.putIfAbsent(accountKey(name), JSON.stringify(record))) throw fail('Account could not be created. Choose another username or sign in.', 409);
      return { id: record.id, username: name };
    },
    async authenticate(input) {
      let name;
      try { name = username(input?.username === undefined ? 'owner' : input.username); } catch { name = null; }
      const record = name && name !== 'owner' ? await find(name) : null;
      const hash = name === 'owner' && config.passwordHash ? config.passwordHash : record?.passwordHash || await dummyHash();
      const valid = await verifyPassword(input?.password, hash);
      if (!valid || !name || (name === 'owner' ? !config.passwordHash : !record)) return null;
      return name === 'owner' ? owner : { id: record.id, username: record.username };
    },
    async principal(session) {
      // Pre-multi-user sessions belong only to the reserved legacy owner.
      if (session.userId === undefined) return config.passwordHash ? owner : null;
      if (session.userId === 'owner') return config.passwordHash && session.username === 'owner' ? owner : null;
      let name;
      try { name = username(session.username); } catch { return null; }
      if (name === 'owner') return null;
      const record = await find(name);
      return record && record.id === session.userId ? { id: record.id, username: record.username } : null;
    },
  };
}
