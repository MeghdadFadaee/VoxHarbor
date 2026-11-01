import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const path = new URL('../.env.local', import.meta.url);
let source;
try { source = await readFile(path, 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  source = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
}
const existing = parseEnv(source).IDENTITY_ENCRYPTION_KEY;
if (/^[a-f0-9]{64}$/i.test(existing || '')) {
  console.log('IDENTITY_ENCRYPTION_KEY is already configured; it was preserved.');
} else {
  if (existing) throw new Error('An existing identity key value is invalid; correct it manually instead of regenerating it.');
  source = source.replace(/^[\t ]*(?:export[\t ]+)?IDENTITY_ENCRYPTION_KEY[\t ]*=.*$/gm, '').trimEnd();
  const temporary = new URL(`../.env.local.${randomBytes(8).toString('hex')}.tmp`, import.meta.url);
  await writeFile(temporary, `${source}\nIDENTITY_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  console.log('Added a separate identity encryption key to .env.local. Back it up securely; no private identity was created.');
}
