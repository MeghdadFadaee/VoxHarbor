import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolConnection } from '../public/protocol-connection.mjs';

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture({ session = async () => ({ csrf: 'fixture-csrf' }) } = {}) {
  let time = 0; let next = 0; let checks = 0; let expired = 0; let muted = 0;
  const timers = new Map(); const sockets = []; const phases = []; const diagnostics = [];
  class Socket extends EventTarget {
    constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; this.autoClose = true; this.autoPong = true; }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
    send(data) {
      this.sent.push(data);
      if (typeof data === 'string') { const input = JSON.parse(data); if (input.type === 'ping' && this.autoPong) this.message({ type: 'ts3_pong', nonce: input.nonce }); }
    }
    close(code = 1000) { this.readyState = this.autoClose ? 3 : 2; if (this.autoClose) this.dispatchEvent(Object.assign(new Event('close'), { code })); }
    healthy() { this.open(); this.message({ type: 'ts3_status', status: 'connected' }); this.message({ type: 'ts3_state', channels: [], participants: [] }); }
  }
  const connection = new ProtocolConnection({ url: 'wss://fixture.invalid/api/ts3', session: async options => { checks++; return session(options); },
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    diagnostic: event => diagnostics.push(event), phase: phase => phases.push(phase), disconnected: () => { muted++; }, expired: () => { expired++; },
    now: () => time, random: () => 0,
    later: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; }, cancel: id => timers.delete(id),
  });
  async function tick(ms) {
    const target = time + ms;
    while (true) {
      const entry = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      time = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await settle();
    }
    time = target; await settle();
  }
  async function start() { connection.start({ connectionId: 'c'.repeat(32) }); await settle(); return sockets.at(-1); }
  return { connection, sockets, phases, diagnostics, tick, start, timers, checks: () => checks, expired: () => expired, muted: () => muted };
}

test('protocol cap reconnects with a fresh session check and a backend settings reference, audio stays gated', async () => {
  const f = fixture(); const first = await f.start(); first.healthy();
  assert.equal(f.connection.voice(new Uint8Array([1])), true);
  await f.tick(240000);
  first.message({ type: 'ts3_status', status: 'session_limit' }); first.close();
  assert.equal(f.connection.connected, false); assert.equal(f.connection.voice(new Uint8Array([2])), false);
  await f.tick(1000); assert.equal(f.sockets.length, 2); assert.equal(f.checks(), 2);
  const second = f.sockets[1]; second.open();
  const request = JSON.parse(second.sent[0]); assert.equal(request.connectionId, 'c'.repeat(32)); assert.equal('password' in request, false); assert.equal('destination' in request, false);
  assert.equal(second.sent.some(data => typeof data !== 'string'), false);
  second.message({ type: 'ts3_status', status: 'connected' });
  assert.ok(f.muted() >= 3); assert.equal(f.connection.desired, true);
  f.connection.stop(); assert.equal(f.connection.options, undefined); assert.equal(f.timers.size, 0);
});

test('unexpected socket loss retries below the connection rate gate and ignores stale events', async () => {
  const f = fixture(); const first = await f.start(); first.open(); first.close(1006);
  await f.tick(11999); assert.equal(f.sockets.length, 1);
  await f.tick(1); assert.equal(f.sockets.length, 2);
  first.message({ type: 'ts3_status', status: 'connected' }); assert.equal(f.connection.connected, false);
  f.sockets[1].healthy(); assert.equal(f.connection.connected, true); f.connection.stop();
});

test('missing heartbeat abandons a stuck closing socket and reconnects', async () => {
  const f = fixture(); const socket = await f.start(); socket.autoPong = false; socket.autoClose = false; socket.healthy();
  await f.tick(29999); assert.equal(f.connection.connected, true);
  await f.tick(1); assert.equal(f.connection.connected, false); assert.equal(socket.readyState, 2);
  await f.tick(2000); assert.equal(f.sockets.length, 2); f.connection.stop();
});

test('healthy heartbeats avoid reconnecting an otherwise quiet server', async () => {
  const f = fixture(); (await f.start()).healthy(); await f.tick(180000);
  assert.equal(f.sockets.length, 1); assert.equal(f.connection.connected, true); f.connection.stop();
});

test('protocol handshake watchdog bounds an open but nonresponsive transport', async () => {
  const f = fixture(); (await f.start()).open(); await f.tick(45000);
  assert.equal(f.connection.connected, false); assert.ok(f.phases.some(p => p.state === 'retrying')); f.connection.stop();
});

test('expired authentication stops recovery, clears credentials and requests sign-in', async () => {
  const f = fixture({ session: async () => { throw Object.assign(new Error('expired'), { status: 401 }); } });
  await f.start(); await f.tick(120000); assert.equal(f.sockets.length, 0); assert.equal(f.checks(), 1);
  assert.equal(f.expired(), 1); assert.equal(f.connection.options, undefined); assert.equal(f.connection.desired, false);
});

test('revocation on an active socket stops without another connection attempt', async () => {
  const f = fixture(); const socket = await f.start(); socket.healthy(); socket.close(4401); await f.tick(120000);
  assert.equal(f.expired(), 1); assert.equal(f.sockets.length, 1); assert.equal(f.connection.options, undefined);
});

test('disconnect during a pending authentication check cannot open a late socket', async () => {
  let resolve; const f = fixture({ session: () => new Promise(done => { resolve = done; }) });
  await f.start(); f.connection.stop(); resolve({ csrf: 'late' }); await settle();
  assert.equal(f.sockets.length, 0); assert.equal(f.connection.desired, false);
});

test('manual stop cancels scheduled recovery and network restoration cannot restart it', async () => {
  const f = fixture(); const socket = await f.start(); socket.open(); socket.close(1006);
  f.connection.stop(); f.connection.online(); await f.tick(120000); assert.equal(f.sockets.length, 1);
});

test('offline pauses retries, online resumes, and a new owner request clears offline state', async () => {
  const f = fixture(); (await f.start()).healthy(); f.connection.offline(); await f.tick(120000);
  assert.equal(f.sockets.length, 1); assert.equal(f.connection.voice(new Uint8Array()), false);
  f.connection.online(); await f.tick(1000); assert.equal(f.sockets.length, 2);
  f.connection.offline(); f.connection.stop(); await f.start(); assert.equal(f.sockets.length, 3); f.connection.stop();
});

test('server rejection and packet authentication failures require owner action', async () => {
  for (const code of ['server_rejected_connection', 'packet_authentication_failed', 'identity_storage_or_destination_error']) {
    const f = fixture(); const socket = await f.start(); socket.open(); socket.message({ type: 'ts3_error', code }); await f.tick(120000);
    assert.equal(f.sockets.length, 1); assert.equal(f.connection.desired, false); assert.equal(f.connection.options, undefined);
    assert.ok(f.phases.some(p => p.state === 'failed' && p.code === code));
  }
});

test('repeated failures stop after five handshakes instead of retrying indefinitely', async () => {
  const f = fixture(); await f.start();
  for (let i = 0; i < 5; i++) { f.sockets.at(-1).open(); f.sockets.at(-1).close(1006); await f.tick(30000); }
  await f.tick(120000); assert.equal(f.sockets.length, 5); assert.equal(f.connection.desired, false);
});

test('an abandoned native lease waits its expiry before a new handshake', async () => {
  const f = fixture(); const socket = await f.start(); socket.open(); socket.message({ type: 'ts3_error', code: 'another_session_is_active' }); socket.close(1011);
  await f.tick(35999); assert.equal(f.sockets.length, 1); await f.tick(1); assert.equal(f.sockets.length, 2); f.connection.stop();
});

test('a stalled authentication request times out and manual stop aborts the next request', async () => {
  const signals = []; const f = fixture({ session: ({ signal }) => { signals.push(signal); return new Promise(() => {}); } });
  await f.start(); await f.tick(15000); assert.equal(signals[0].aborted, true);
  assert.ok(f.phases.some(p => p.state === 'retrying')); await f.tick(2000);
  assert.equal(signals.length, 2); f.connection.stop(); assert.equal(signals[1].aborted, true); assert.equal(f.timers.size, 0);
});

 test('diagnostics distinguish session cap, socket close, heartbeat timeout and retry timing', async () => {
  const f = fixture(); const socket = await f.start(); socket.healthy();
  await f.tick(10000);
  assert.ok(f.diagnostics.some(e => e.type === 'heartbeat' && e.roundTripMs === 0));
  socket.message({ type: 'ts3_status', status: 'session_limit' }); socket.close(1000);
  assert.ok(f.diagnostics.some(e => e.type === 'protocol_status' && e.stage === 'session_limit'));
  assert.ok(f.diagnostics.some(e => e.type === 'transport_closed' && e.durationMs === 10000 && e.closeCode === 1000));
  assert.ok(f.diagnostics.some(e => e.type === 'retry' && e.delay >= 1000));
  f.connection.stop();
  const g = fixture(); const dead = await g.start(); dead.autoPong = false; dead.healthy(); await g.tick(30000);
  assert.ok(g.diagnostics.some(e => e.type === 'timeout' && e.stage === 'heartbeat'));
  g.connection.stop();
});
