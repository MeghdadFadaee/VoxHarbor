import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const STORAGE_KEY = 'voxharbor:preferences:v1:owner';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
export function destinationOptions(input) {
  if (!plain(input) || !text(input.host, 253) || !/^[a-zA-Z0-9.-]+$/.test(input.host) || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw fail('Enter a hostname or public IPv4 address and a port from 1024 to 65535.');
  return { host: input.host.toLowerCase(), port: input.port };
}
export function connectionOptions(input) {
  if (!plain(input) || !text(input.nickname, 64) || (input.channelId !== undefined && input.channelId !== null && (!Number.isSafeInteger(input.channelId) || input.channelId < 1)) || !text(input.password ?? '', 256, true) || !text(input.channelPassword ?? '', 256, true)) throw fail('Invalid connection settings.');
  return { ...destinationOptions(input), nickname: input.nickname.trim(), channelId: input.channelId || null, password: input.password || '', channelPassword: input.channelPassword || '' };
}
export function normalizePreferences(input) {
  if (!plain(input) || !['system', 'light', 'dark'].includes(input.theme) || !text(input.nickname, 64) || !Array.isArray(input.bookmarks) || input.bookmarks.length > 20) throw fail('Invalid workspace preferences.');
  const ids = new Set();
  const bookmarks = input.bookmarks.map(bookmark => {
    if (!plain(bookmark) || !/^[A-Za-z0-9_-]{1,64}$/.test(bookmark.id || '') || ids.has(bookmark.id) || !text(bookmark.name, 80) || !text(bookmark.nickname, 64) || (bookmark.channelId !== undefined && bookmark.channelId !== null && (!Number.isSafeInteger(bookmark.channelId) || bookmark.channelId < 1)) || !text(bookmark.password ?? '', 256, true) || !text(bookmark.channelPassword ?? '', 256, true)) throw fail('Invalid saved connection.');
    ids.add(bookmark.id);
    return { id: bookmark.id, name: bookmark.name.trim(), ...connectionOptions(bookmark) };
  });
  let connection = null;
  if (input.connection !== undefined && input.connection !== null) {
    if (!/^[a-f0-9]{32}$/.test(input.connection.id || '')) throw fail('Invalid saved connection ID.');
    connection = { id: input.connection.id, ...connectionOptions(input.connection) };
  }
  return { version: 1, theme: input.theme, nickname: input.nickname.trim(), bookmarks, connection };
}
const defaults = () => ({ version: 1, theme: 'system', nickname: 'VoxHarbor', bookmarks: [], connection: null });
function keys(config) {
  const values = [config.identityKey, config.previousIdentityKey].filter(Boolean);
  if (!values.length || values.some(value => !/^[a-f0-9]{64}$/i.test(value))) throw fail('A valid identity encryption key is required to save preferences.', 409);
  return values.map(value => { const key = Buffer.from(value, 'hex'); return { key, id: createHash('sha256').update(key).digest('hex').slice(0, 16) }; });
}
function seal(config, value) {
  const { key, id } = keys(config)[0]; const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${STORAGE_KEY}:${id}${config.recordScope ? `:user:${config.recordScope}` : ''}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ version: 1, keyId: id, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}
function open(config, serialized) {
  try {
    const envelope = JSON.parse(serialized); const { key, id } = keys(config).find(item => item.id === envelope.keyId) || {};
    if (!key || envelope.version !== 1) throw new Error();
    const iv = Buffer.from(envelope.iv, 'base64'); const tag = Buffer.from(envelope.tag, 'base64'); if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(Buffer.from(`${STORAGE_KEY}:${id}${config.recordScope ? `:user:${config.recordScope}` : ''}`)); decipher.setAuthTag(tag);
    return normalizePreferences(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')));
  } catch { throw fail('Saved preferences could not be decrypted. Restore the correct key; existing data was not replaced.', 503); }
}
function metadata(value) {
  const redact = ({ password, channelPassword, ...connection }) => ({ ...connection, hasPassword: Boolean(password), hasChannelPassword: Boolean(channelPassword) });
  return { version: 1, theme: value.theme, nickname: value.nickname, bookmarks: value.bookmarks.map(redact), connection: value.connection ? redact(value.connection) : null };
}
const revision = serialized => serialized === null ? 'empty' : createHash('sha256').update(serialized).digest('hex');
export function createPreferences(config, store) {
  async function read() { const serialized = await store.get(STORAGE_KEY); return { serialized, value: serialized === null ? { ...defaults(), nickname: config.defaultNickname || 'VoxHarbor' } : open(config, serialized) }; }
  return {
    async read() { const previous = await read(); return { ...metadata(previous.value), revision: revision(previous.serialized) }; },
    async save(input) {
      const previous = await read();
      if (input?.revision !== revision(previous.serialized)) throw fail('Preferences changed in another session. Reload before saving again.', 409);
      // Missing password fields preserve existing ciphertext-backed secrets. Explicit empty strings clear them.
      const merged = plain(input) && Array.isArray(input.bookmarks) ? { ...input, bookmarks: input.bookmarks.map(bookmark => {
        const old = previous.value.bookmarks.find(item => item.id === bookmark?.id);
        const sameServer = old && typeof bookmark?.host === 'string' && old.host === bookmark.host.toLowerCase() && old.port === bookmark.port;
        const sameChannel = sameServer && old.channelId === (bookmark.channelId || null);
        return { ...bookmark, password: bookmark?.password === undefined ? (sameServer ? old.password : '') : bookmark.password, channelPassword: bookmark?.channelPassword === undefined ? (sameChannel ? old.channelPassword : '') : bookmark.channelPassword };
      }) } : input;
      const value = normalizePreferences({ ...merged, connection: previous.value.connection }); const encrypted = seal(config, value);
      const saved = previous.serialized === null ? await store.putIfAbsent(STORAGE_KEY, encrypted) : await store.compareSet(STORAGE_KEY, previous.serialized, encrypted);
      if (!saved) throw fail('Preferences changed in another session. Reload before saving again.', 409);
      return { ...metadata(value), revision: revision(encrypted) };
    },
    async connection(id) {
      const bookmark = (await read()).value.bookmarks.find(bookmark => bookmark.id === id);
      if (!bookmark) throw fail('Saved connection not found.', 404);
      return bookmark;
    },
    async activeConnection(id) {
      const connection = (await read()).value.connection;
      if (!connection) throw Object.assign(fail('Save connection settings before connecting.', 409), { code: 'connection_required' });
      if (connection.id !== id) throw Object.assign(fail('Connection settings changed. Reload before connecting.', 409), { code: 'connection_settings_changed' });
      return connection;
    },
    async saveConnection(input) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await read();
        let old = previous.value.connection;
        if (input?.bookmarkId !== undefined) {
          if (typeof input.bookmarkId !== 'string') throw fail('Invalid saved connection reference.');
          old = previous.value.bookmarks.find(bookmark => bookmark.id === input.bookmarkId);
          if (!old) throw fail('Saved connection not found. Reload before connecting.', 404);
        }
        const normalized = connectionOptions(input);
        const sameServer = old && old.host === normalized.host && old.port === normalized.port;
        const sameChannel = sameServer && old.channelId === normalized.channelId;
        const connection = { id: randomBytes(16).toString('hex'), ...normalized,
          password: input.password === undefined && sameServer ? old.password : normalized.password,
          channelPassword: input.channelPassword === undefined && sameChannel ? old.channelPassword : normalized.channelPassword };
        const value = { ...previous.value, nickname: connection.nickname, connection }; const encrypted = seal(config, value);
        const saved = previous.serialized === null ? await store.putIfAbsent(STORAGE_KEY, encrypted) : await store.compareSet(STORAGE_KEY, previous.serialized, encrypted);
        if (saved) return { ...metadata(value), revision: revision(encrypted) };
      }
      throw fail('Connection settings changed concurrently. Try saving again.', 409);
    },
    async updateConnection(id, changes) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await read(); const old = previous.value.connection;
        if (!old || old.id !== id) return false;
        const connection = { id, ...connectionOptions({ ...old, ...changes }) };
        const value = { ...previous.value, nickname: connection.nickname, connection }; const encrypted = seal(config, value);
        if (await store.compareSet(STORAGE_KEY, previous.serialized, encrypted)) return { ...metadata(value), revision: revision(encrypted) };
      }
      return false;
    },
    async rotate() {
      const previous = await read(); if (previous.serialized === null) return;
      if (!await store.compareSet(STORAGE_KEY, previous.serialized, seal(config, previous.value))) throw fail('Preferences changed concurrently.', 409);
    },
  };
}
