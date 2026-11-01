import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPreferences } from '../src/preferences.mjs';
import { createStore } from '../src/auth/store.mjs';
import { normalizeCommand } from '../src/protocol/commands.mjs';
import { createProtocolControl } from '../src/protocol/session.mjs';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

test('only typed client commands cross the native boundary', () => {
  assert.equal(normalizeCommand({ type: 'raw', command: 'serverstop' }), null);
  assert.equal(normalizeCommand({ type: 'text_message', target: 'all', message: 'test' }), null);
  assert.equal(normalizeCommand({ type: 'text_message', target: 'private', clientId: 65536, message: 'test' }), null);
  assert.equal(normalizeCommand({ type: 'join_channel', channelId: '411' }), null);
  assert.equal(normalizeCommand({ type: 'join_channel', channelId: 0 }), null);
  assert.equal(normalizeCommand({ type: 'join_channel', channelId: 411, password: 'x'.repeat(257) }), null);
  assert.equal(normalizeCommand({ type: 'nickname', name: 'x'.repeat(65) }), null);
  assert.equal(normalizeCommand({ type: 'subscribe', channelId: 1, subscribed: 'yes' }), null);
  assert.equal(normalizeCommand({ type: 'away', away: true, message: '\u0000' }), null);
  assert.deepEqual(normalizeCommand({ type: 'join_channel', channelId: 411, password: 'fixture-only', extra: 'never forwarded' }), { type: 'join_channel', channel_id: 411, password: 'fixture-only' });
  assert.deepEqual(normalizeCommand({ type: 'text_message', target: 'channel', channelId: 1, clientId: 25, message: '<img src=x onerror=alert(1)>' }), { type: 'text_message', target: 'channel', channel_id: 1, client_id: null, client_uid: null, message: '<img src=x onerror=alert(1)>' });
});

test('message byte and control limits fit the bounded native input without truncating Unicode', () => {
  assert.ok(normalizeCommand({ type: 'text_message', target: 'channel', channelId: 1, message: '🙂'.repeat(250) }));
  assert.equal(normalizeCommand({ type: 'text_message', target: 'channel', channelId: 1, message: '🙂'.repeat(251) }), null);
  assert.equal(normalizeCommand({ type: 'text_message', target: 'channel', channelId: 1, message: '  ' }), null);
  assert.equal(normalizeCommand({ type: 'text_message', target: 'channel', channelId: 1, message: 'secret\u0001control' }), null);
});

test('client commands require the live owner CSRF and fail explicitly before connection', async () => {
  const events = []; const closes = [];
  const control = createProtocolControl({ readyState: 1, bufferedAmount: 0, send: data => events.push(JSON.parse(data)) }, { config: {}, store: {}, vault: {}, csrf: 'fixture', close: (...args) => closes.push(args) });
  await control.command(Buffer.from(JSON.stringify({ type: 'command', csrf: 'wrong', requestId: 1, command: { type: 'nickname', name: 'Fixture' } })));
  assert.equal(closes[0][0], 4403);
  await control.command(Buffer.from(JSON.stringify({ type: 'command', csrf: 'fixture', requestId: 2, command: { type: 'nickname', name: 'Fixture' } })));
  assert.deepEqual(events.at(-1), { type: 'ts3_command_result', requestId: 2, ok: false, code: 'not_connected' });
  await control.command(Buffer.from(JSON.stringify({ type: 'command', csrf: 'fixture', requestId: 3, command: { type: 'raw', value: 'clientkick' } })));
  assert.equal(closes.at(-1)[0], 1003);
});

test('native command acknowledgements are correlated and message contents stay outside diagnostics', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voxharbor-command-fixture-')); const binary = join(directory, 'native');
  await symlink(process.execPath, join(directory, 'node'));
  await writeFile(binary, `#!${directory}/node\nconst readline = require('node:readline');\nlet first = true;\n(async () => { for await (const line of readline.createInterface({input:process.stdin})) {\n const request=JSON.parse(line);\n if(first){first=false; require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'request.json'))}, JSON.stringify(request)); console.log(JSON.stringify({type:'status',status:'connected'})); continue;}\n if(request.op==='disconnect') break;\n if(request.op==='command') { console.log(JSON.stringify({type:'client_command_result',requestId:request.request_id,ok:true,privateKey:'never forwarded'})); if(request.command.type==='text_message') console.log(JSON.stringify({type:'message',target:'private',clientId:7,name:'<b>sender</b>',message:request.command.message,privateKey:'never forwarded'})); }\n} })().catch(() => process.exit(1));\n`, { mode: 0o700 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: data => events.push(JSON.parse(data)) };
  const config = { protocolBinary: binary, identityKey: randomBytes(32).toString('hex') };
  const store = createStore({ memory: true }); const preferences = createPreferences(config, store);
  const settings = await preferences.saveConnection({ host: '1.1.1.1', port: 9987, nickname: 'Fixture', channelId: 12, password: 'fixture-private-server', channelPassword: 'fixture-private-channel' });
  const control = createProtocolControl(ws, { config, store, preferences, vault: { read: async () => ({ identity: { simulated: true } }) }, csrf: 'fixture', close: () => { ws.readyState = 3; } });
  t.after(() => control.stop());
  await control.command(Buffer.from(JSON.stringify({ type: 'connect', csrf: 'fixture', connectionId: settings.connection.id })));
  for (let i = 0; i < 100 && !events.some(event => event.status === 'connected'); i++) await sleep(10);
  assert.ok(events.some(event => event.status === 'connected'));
  const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
  assert.equal(request.address, '1.1.1.1:9987');
  assert.equal(request.nickname, 'Fixture'); assert.equal(request.channel_id, 12);
  assert.equal(request.password, 'fixture-private-server'); assert.equal(request.channel_password, 'fixture-private-channel');
  assert.equal(JSON.stringify(events).includes('fixture-private'), false);
  await control.command(Buffer.from(JSON.stringify({ type: 'command', csrf: 'fixture', requestId: 41, command: { type: 'nickname', name: 'Renamed' } })));
  for (let i = 0; i < 100 && !events.some(event => event.type === 'ts3_connection_saved'); i++) await sleep(10);
  assert.equal((await preferences.activeConnection(settings.connection.id)).nickname, 'Renamed');
  assert.equal(events.find(event => event.type === 'ts3_connection_saved').preferences.connection.hasPassword, true);
  assert.equal(JSON.stringify(events).includes('fixture-private'), false);
  const content = '<img src=x onerror=alert(1)> [b]literal[/b]';
  await control.command(Buffer.from(JSON.stringify({ type: 'command', csrf: 'fixture', requestId: 42, command: { type: 'text_message', target: 'private', clientId: 7, message: content } })));
  for (let i = 0; i < 100 && !events.some(event => event.type === 'ts3_message'); i++) await sleep(10);
  assert.deepEqual(events.find(event => event.type === 'ts3_command_result' && event.requestId === 42), { type: 'ts3_command_result', requestId: 42, ok: true });
  assert.equal(events.find(event => event.type === 'ts3_message').message, content);
  assert.equal(JSON.stringify(events).includes('privateKey'), false);
  await control.stop();
});


test('stale saved connection IDs fail before reading the identity or starting a child', async () => {
  const config = { identityKey: randomBytes(32).toString('hex') }; const store = createStore({ memory: true });
  const preferences = createPreferences(config, store);
  const first = await preferences.saveConnection({ host: 'one.example.test', port: 9987, nickname: 'Fixture' });
  await preferences.saveConnection({ host: 'two.example.test', port: 9987, nickname: 'Fixture' });
  const events = []; let identityReads = 0; const closes = [];
  const control = createProtocolControl({ readyState: 1, bufferedAmount: 0, send: data => events.push(JSON.parse(data)) }, {
    config, store, preferences, vault: { read: async () => { identityReads++; } }, csrf: 'fixture', close: (...args) => closes.push(args),
  });
  await control.command(Buffer.from(JSON.stringify({ type: 'connect', csrf: 'fixture', connectionId: first.connection.id })));
  assert.equal(events.at(-1).code, 'connection_settings_changed'); assert.equal(identityReads, 0); assert.equal(closes[0][0], 1011);
  await control.stop();
});
