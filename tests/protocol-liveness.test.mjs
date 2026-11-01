import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProtocolControl } from '../src/protocol/session.mjs';

test('an unresponsive owner transport stops its native child and releases the lease', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voxharbor-owner-liveness-'));
  const binary = join(directory, 'protocol');
  await writeFile(binary, `#!/bin/sh\nread -r request\nprintf '%s\\n' '{"type":"status","status":"connected"}'\ncat >/dev/null\n`, { mode: 0o700 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['setInterval'] });
  const actualNow = Date.now; let offset = 0; Date.now = () => actualNow() + offset;
  t.after(() => { Date.now = actualNow; });
  const events = []; const closes = []; let released = 0;
  const ws = { readyState: 1, bufferedAmount: 0, send: data => events.push(JSON.parse(data)) };
  const control = createProtocolControl(ws, {
    config: { protocolBinary: binary, ts3Host: '1.1.1.1', ts3Port: 9987 },
    // No real network or Redis: this executable reads stdin and writes status only.
    store: { limit: async () => true, putIfAbsent: async () => true, compareSet: async () => true, compareDelete: async () => { released++; return true; } },
    preferences: { activeConnection: async () => ({ id: 'c'.repeat(32), host: '1.1.1.1', port: 9987, nickname: 'Fixture' }) }, vault: { read: async () => ({ identity: {} }) }, csrf: 'fixture-csrf',
    close: code => { if (ws.readyState === 1) { closes.push(code); ws.readyState = 3; } },
  });
  t.after(() => control.stop());
  await control.command(Buffer.from(JSON.stringify({ type: 'connect', csrf: 'fixture-csrf', connectionId: 'c'.repeat(32), heartbeat: true })));
  for (let i = 0; i < 100 && !events.some(event => event.status === 'connected'); i++) await sleep(10);
  assert.ok(events.some(event => event.status === 'connected'));
  offset = 40000; t.mock.timers.tick(10000);
  for (let i = 0; i < 100 && !released; i++) await sleep(10);
  assert.ok(events.some(event => event.code === 'owner_transport_timeout'));
  assert.deepEqual(closes, [4000]); assert.equal(released, 1);
});
