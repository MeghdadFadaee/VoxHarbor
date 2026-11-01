// Local-only simulated protocol fixture. No real TS3 identities or network connections.
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/password.mjs';
import { readConfig } from '../src/config.mjs';
import { createStore } from '../src/auth/store.mjs';
import { createVault } from '../src/identity/vault.mjs';
import { createPreferences } from '../src/preferences.mjs';
import { createApp } from '../src/http-adapter.mjs';
if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('This simulated fixture is local-only.');
const directory = await mkdtemp(join(tmpdir(), 'voxharbor-render-fixture-'));
await symlink(process.execPath, join(directory, 'node'));
const binary = join(directory, 'protocol');
const ownUid = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='; const peerUid = 'BBBBBBBBBBBBBBBBBBBBBBBBBBB=';
await writeFile(binary, `#!${directory}/node
const readline = require('node:readline');
const emit = value => console.log(JSON.stringify(value));
let first = true; let sequence = 0;
const snapshot = () => emit({type:'state',sequence:++sequence,ownClientId:1,server:{name:'Local rendering fixture — SIMULATED'},channels:[{id:411,parentId:0,name:'Rendering verification (simulated)',topic:'No TeamSpeak connection or human recipients',order:0,subscribed:true,codec:4,passwordProtected:false}],participants:[{id:1,channelId:411,name:'Fixture owner (simulated)',uid:'${ownUid}',inputMuted:true,outputMuted:true},{id:2,channelId:411,name:'<strong>Literal sender</strong>',uid:'${peerUid}',inputMuted:true,outputMuted:true}]});
(async () => { for await (const line of readline.createInterface({input:process.stdin})) {
 const request = JSON.parse(line);
 if (first) { first=false; emit({type:'status',status:'connected'}); snapshot(); continue; }
 if (request.op==='disconnect') break;
 if (request.op==='command') {
  emit({type:'client_command_result',requestId:request.request_id,ok:true});
  if(request.command.type==='text_message') emit({type:'message',target:request.command.target,clientId:2,targetClientId:1,uid:'${peerUid}',targetUid:'${ownUid}',name:'<strong>Literal sender</strong>',channelId:411,message:'Fixture reply: <img src=x> [b]literal[/b]'});
 }
 if(request.op==='audio_state') emit({type:'audio_status',canSend:false,canReceive:false});
} })().catch(()=>process.exit(1));
`, { mode: 0o700 });
const config = readConfig({ APP_ORIGIN: 'http://localhost:3151', OWNER_PASSWORD_HASH: await hashPassword('workspace-render-fixture-only'), SESSION_SECRET: randomBytes(32).toString('hex'), IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('hex'), ALLOW_LOCAL_MEMORY_STORE: '1' });
config.protocolBinary = binary;
const store = createStore(config);
// A deliberately synthetic payload for the fake executable, held in volatile memory only.
await createVault(config, store).initialize({ identity: { simulated: true }, metadata: { uid: ownUid, level: 16 } });
await createPreferences(config, store).saveConnection({ host: '1.1.1.1', port: 9987, nickname: 'Fixture owner' });
const app = createApp(config, store);
app.server.listen(3151, '127.0.0.1', () => console.log('SIMULATED rendering fixture: http://localhost:3151 (no real TS3 network or identity)'));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  for (const client of app.wss.clients) client.terminate();
  app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  await rm(directory, { recursive: true, force: true }); process.stdin.pause();
}
process.stdin.setEncoding('utf8'); process.stdin.resume(); process.stdin.on('data', data => { if (data.trim() === 'quit') void stop(); });
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
