import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveLocalOwner, updateOwnerConfig } from '../scripts/local-owner-config.mjs';

const hash = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;
test('owner setup replaces duplicate assignments and preserves unrelated settings', () => {
  const result = updateOwnerConfig('APP_ORIGIN=http://localhost:4000\n# Keep this comment\nOWNER_PASSWORD_HASH=\nexport OWNER_PASSWORD_HASH=old\nSESSION_SECRET=old\nOTHER_PRIVATE_SETTING=45987\n', hash, 'c'.repeat(64));
  assert.equal(result.match(/^OWNER_PASSWORD_HASH=/gm).length, 1);
  assert.match(result, /APP_ORIGIN=http:\/\/localhost:4000/);
  assert.match(result, /# Keep this comment/);
  assert.match(result, /OTHER_PRIVATE_SETTING=45987/);
  assert.doesNotMatch(result, /old/);
  assert.throws(() => updateOwnerConfig('', 'password', 'c'.repeat(64)), /Invalid/);
});
test('owner setup initializes a private env file and rotates the secret on replacement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voxharbor-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}/`);
  await writeFile(new URL('.env.example', root), 'APP_ORIGIN=http://localhost:3000\nOWNER_PASSWORD_HASH=\nSESSION_SECRET=\n');
  await saveLocalOwner(hash, root);
  const first = await readFile(new URL('.env.local', root), 'utf8');
  assert.ok(first.includes(hash));
  assert.match(first, /^SESSION_SECRET=[a-f0-9]{64}$/m);
  assert.equal((await stat(new URL('.env.local', root))).mode & 0o777, 0o600);
  await saveLocalOwner(hash, root);
  assert.notEqual(await readFile(new URL('.env.local', root), 'utf8'), first);
});
