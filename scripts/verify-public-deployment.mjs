import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const url = new URL(process.argv[2]);
if (url.protocol !== 'https:' || url.origin !== process.argv[2]) throw new Error('Pass the exact HTTPS deployment origin');
const checks = [];
async function http(name, path, expected, options = {}) {
  const response = await fetch(new URL(path, url), { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, `${name}: expected ${expected}, got ${response.status}`);
  checks.push({ name, status: response.status });
  return response;
}
function upgrade(name, origin, expected) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`${url.origin.replace('https:', 'wss:')}/api/ts3`, { origin, handshakeTimeout: 15000 });
    client.on('error', () => {});
    client.once('unexpected-response', (_req, response) => {
      response.resume();
      client.terminate();
      try {
        assert.equal(response.statusCode, expected, name);
        checks.push({ name, status: response.statusCode });
        resolve();
      } catch (error) { reject(error); }
    });
    client.once('open', () => { client.terminate(); reject(new Error(`${name}: unauthorized upgrade succeeded`)); });
    client.once('error', reject);
  });
}
try {
  const shell = await http('public-sign-in-shell', '/', 200);
  assert.match(await shell.text(), /<label for="username">Username<\/label>/);
  const csp = shell.headers.get('content-security-policy') || '';
  await http('unauthenticated-session', '/api/session', 401);
  await http('unauthenticated-connection-settings', '/api/connection', 401, { method: 'POST', headers: { Origin: url.origin } });
  await http('cross-origin-login', '/api/login', 403, { method: 'POST', headers: { Origin: 'https://example.invalid' } });
  await http('query-credential-rejection', '/api/session?token=nonsecret-test', 400);
  await upgrade('unauthenticated-websocket', url.origin, 401);
  await upgrade('cross-origin-websocket', 'https://example.invalid', 403);
  assert.match(csp, /frame-ancestors 'none'/);
  console.log(JSON.stringify({ testedAt: new Date().toISOString(), origin: url.origin, status: 'passed', checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ testedAt: new Date().toISOString(), origin: url.origin, status: 'failed', checks, error: error.message }, null, 2));
  process.exitCode = 1;
}
