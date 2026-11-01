import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = process.argv[2];
const url = new URL(origin);
if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Pass an exact HTTPS production origin.');
const files = ['index.html', 'app.mjs', 'workspace.mjs', 'workspace-model.mjs', 'protocol.mjs', 'protocol-connection.mjs', 'audio-recovery.mjs', 'style.css', 'favicon.svg', 'favicon.ico', 'site.webmanifest'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    for (const file of files) {
      const response = await fetch(new URL(file === 'index.html' ? '/' : `/${file}`, origin), { redirect: 'error', signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `${file} must be publicly served`);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await readFile(new URL(`../public/${file}`, import.meta.url))), `${file} must match this release`);
    }
    console.log(`Production release verified: ${files.length} assets match the tested source.`);
    break;
  } catch (error) {
    if (attempt === 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
