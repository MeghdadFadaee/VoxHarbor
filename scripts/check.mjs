import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
}
for (const file of (await Promise.all(['api', 'src', 'scripts', 'tests', 'public'].map(files))).flat().filter(file => file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
console.log('JavaScript syntax checks passed');
