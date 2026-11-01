import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditPublication } from './publication-audit.mjs';
import { projectRoot } from './source-files.mjs';
export async function packageSource(kind) {
  const report = await auditPublication({ checkGit: kind === 'publication' });
  if (!report.passed) { console.error(JSON.stringify({ passed: false, issues: report.issues }, null, 2)); throw new Error('Source audit failed. No package was published or pushed.'); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(projectRoot, '.local', `${kind}-${stamp}`, 'VoxHarbor');
  await mkdir(destination, { recursive: true, mode: 0o700 }); const manifest = [];
  for (const path of report.files) {
    const bytes = report.sources.get(path); // Copy the exact audited bytes, not a later filesystem version.
    await mkdir(join(destination, path, '..'), { recursive: true }); await writeFile(join(destination, path), bytes);
    manifest.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(destination, 'SOURCE_MANIFEST.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2) + '\n');
  console.log(`${kind === 'publication' ? 'Public source' : 'Deployment source'}: ${destination}`);
  console.log(`${manifest.length} source files. No Git metadata, private configuration, identities, evidence, dependencies or local binaries.`);
  return destination;
}
