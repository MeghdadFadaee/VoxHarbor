import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';

export function updateOwnerConfig(source, hash, secret) {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) throw new Error('Invalid owner password hash');
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid session secret');
  let result = source;
  for (const [key, value] of Object.entries({ OWNER_PASSWORD_HASH: hash, SESSION_SECRET: secret })) {
    // Replace all active assignments, including duplicates and optional dotenv export syntax.
    const assignment = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=.*$`, 'gm');
    result = result.replace(assignment, '').trimEnd();
    result += `\n${key}=${value}\n`;
  }
  return result;
}

export async function saveLocalOwner(hash, directory = new URL('../', import.meta.url)) {
  const destination = new URL('.env.local', directory);
  let source;
  try { source = await readFile(destination, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    source = await readFile(new URL('.env.example', directory), 'utf8');
  }
  // Replacing the password also revokes sessions using the previous credentials.
  const updated = updateOwnerConfig(source, hash, randomBytes(32).toString('hex'));
  const temporary = new URL(`.env.local.${randomBytes(8).toString('hex')}.tmp`, directory);
  try {
    await writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
