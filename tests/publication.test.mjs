import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContent } from '../scripts/publication-audit.mjs';
import { privatePath } from '../scripts/source-files.mjs';

test('publication excludes private data paths while allowing the blank environment template', () => {
  for (const path of ['.env.local', '.local/identity.enc.json', '.idea/workspace.xml', 'native/bin/client', 'native/target/release/client', 'docs/verification/screenshot.jpg', 'identity.ini', 'backup.pem']) assert.equal(privatePath(path), true, path);
  for (const path of ['.env.example', 'src/preferences.mjs', 'native/Cargo.lock', 'LICENSE']) assert.equal(privatePath(path), false, path);
});

test('publication scans exact and encoded private values without returning their contents', () => {
  const secret = 'synthetic-private-test-value-123';
  for (const content of [secret, Buffer.from(secret).toString('base64'), encodeURIComponent(secret)]) {
    const findings = inspectContent('src/accidental-copy.mjs', Buffer.from(content), [secret]);
    assert.ok(findings.some(item => item.rule === 'local-private-value'));
    assert.equal(JSON.stringify(findings).includes(secret), false);
  }
});

test('publication detects credential formats and personal paths in ordinary source', () => {
  const privateKey = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  for (const [value, rule] of [[privateKey, 'private-key'], ['ghp_' + 'a'.repeat(36), 'credential-format'], ['scrypt:' + 'a'.repeat(32) + ':' + 'b'.repeat(128), 'password-hash'], ['/Users' + '/fixture-person/project/file', 'personal-filesystem-path']]) assert.ok(inspectContent('src/leak.mjs', Buffer.from(value)).some(item => item.rule === rule));
  // A named vendor path alone is not an exemption for a modified codec artifact.
  assert.ok(inspectContent('public/vendor/opus/generated/libopus.generated.mjs', Buffer.from('/Users' + '/fixture-person/project/file')).some(item => item.rule === 'personal-filesystem-path'));
});
