import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { collectSourceFiles, privatePath, projectRoot } from './source-files.mjs';

export function inspectContent(path, bytes, privateValues = []) {
  const findings = new Set(); const text = bytes.toString('utf8');
  for (const value of privateValues) {
    if (typeof value !== 'string' || value.length < 4) continue;
    if ([value, Buffer.from(value).toString('base64'), encodeURIComponent(value)].some(encoded => bytes.includes(Buffer.from(encoded)))) findings.add('local-private-value');
  }
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/.test(text)) findings.add('credential-format');
  if (/scrypt:[a-f0-9]{32}:[a-f0-9]{128}/i.test(text)) findings.add('password-hash');
  if (/^\s*identity\s*=\s*["']?[A-Za-z0-9+/]{40,}/m.test(text)) findings.add('identity-export');
  // Upstream crypto tests contain intentional published fixtures. Local-value matching still applies there.
  if (!path.startsWith('native/vendor/') && /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.add('private-key');
  const publishedCodec = path === 'public/vendor/opus/generated/libopus.generated.mjs' && createHash('sha256').update(bytes).digest('hex') === '0041fc800ccd26f56b27eaeb1834c8c6854e5167d48cd628a4f98ec5b590c6f1';
  if (!path.startsWith('native/vendor/') && !publishedCodec && /\/Users\/[^/\s]+\//.test(text)) findings.add('personal-filesystem-path');
  if (/https:\/\/[a-z0-9-]+-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app/i.test(text)) findings.add('private-deployment-url');
  return [...findings].map(rule => ({ path, rule }));
}
async function knownPrivateValues(root) {
  const values = [root];
  try {
    const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
    for (const [key, value] of Object.entries(env)) if (/SECRET|TOKEN|PASSWORD|ENCRYPTION_KEY|REDIS.*URL|TS3.*HOST/.test(key)) values.push(value);
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Private configuration could not be checked; no values were printed.'); }
  try {
    const identity = JSON.parse(await readFile(join(root, '.local/identity.enc.json'), 'utf8'));
    if (identity.ciphertext) values.push(identity.ciphertext);
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Local identity exclusion check failed; no contents were printed.'); }
  return values;
}
function git(root, args) { return spawnSync('git', args, { cwd: root, encoding: null, maxBuffer: 16 * 1024 * 1024 }); }
export async function auditPublication({ root = projectRoot, checkGit = true } = {}) {
  const files = await collectSourceFiles(root); const privateValues = await knownPrivateValues(root); const issues = [];
  const allowed = new Set(files); const sources = new Map();
  for (const path of files) { const bytes = await readFile(join(root, path)); sources.set(path, bytes); issues.push(...inspectContent(path, bytes, privateValues)); }
  let history = 'not-checked'; let gitCandidateCount = null;
  if (checkGit) {
    const candidates = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (candidates.status !== 0) throw new Error('Cannot inspect Git publication candidates. No Git state was changed.');
    const paths = [...new Set(candidates.stdout.toString('utf8').split('\0').filter(Boolean))]; gitCandidateCount = paths.length;
    for (const path of paths) {
      if (privatePath(path)) issues.push({ path, rule: 'private-git-path' });
      if (!allowed.has(path)) issues.push({ path, rule: 'outside-source-allowlist' });
    }
    const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
    if (staged.status !== 0) throw new Error('Cannot inspect staged publication paths.');
    for (const path of staged.stdout.toString('utf8').split('\0').filter(Boolean)) {
      const blob = git(root, ['show', `:${path}`]);
      if (blob.status !== 0) issues.push({ path, rule: 'staged-content-unavailable' });
      else issues.push(...inspectContent(path, blob.stdout, privateValues).map(issue => ({ ...issue, snapshot: 'staged' })));
    }
    history = git(root, ['rev-parse', '--verify', 'HEAD']).status === 0 ? 'existing-history-requires-separate-review' : 'no-commits';
  }
  return { passed: issues.length === 0, sourceFileCount: files.length, gitCandidateCount, history, issues, files, sources };
}
