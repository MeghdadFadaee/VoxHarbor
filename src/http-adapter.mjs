import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createStore } from './auth/store.mjs';
import { createSessions } from './auth/session.mjs';
import { createAccounts } from './auth/accounts.mjs';
import { createUserContext } from './auth/user-context.mjs';
import { createHash } from 'node:crypto';
import { identityOperation, nativeAvailable } from './platform/native-protocol.mjs';
import { createProtocolControl } from './protocol/session.mjs';

const assets = new Map([
  ['/favicon.ico', ['favicon.ico', 'image/x-icon']],
  ...['favicon.svg', 'icons/safari-pinned-tab.svg'].map(file => [`/${file}`, [file, 'image/svg+xml']]),
  ...['favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'icons/app-192.png', 'icons/app-512.png', 'icons/app-maskable-512.png'].map(file => [`/${file}`, [file, 'image/png']]),
  ['/site.webmanifest', ['site.webmanifest', 'application/manifest+json']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace.mjs', ['workspace.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace-model.mjs', ['workspace-model.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ...['ibm-plex-sans-regular', 'ibm-plex-sans-medium', 'ibm-plex-sans-semibold', 'ibm-plex-mono-regular', 'ibm-plex-mono-medium'].map(name => [`/fonts/${name}.ttf`, [`fonts/${name}.ttf`, 'font/ttf']]),
  ...['microphone', 'headphones'].map(name => [`/icons/${name}.svg`, [`icons/${name}.svg`, 'image/svg+xml']]),
  ['/fonts/OFL.txt', ['fonts/OFL.txt', 'text/plain; charset=utf-8']],
  ['/protocol.mjs', ['protocol.mjs', 'text/javascript; charset=utf-8']],
  ['/protocol-connection.mjs', ['protocol-connection.mjs', 'text/javascript; charset=utf-8']],
  ['/channel-order.mjs', ['channel-order.mjs', 'text/javascript; charset=utf-8']],
  ...['audio-recovery.mjs', 'connection-diagnostics.mjs', 'voice.mjs', 'voice-frame.mjs', 'voice-worker.mjs', 'voice-worklet.mjs', 'jitter-buffer.mjs', 'vendor/opus/index.js', 'vendor/opus/generated/libopus.generated.mjs'].map(file => [`/${file}`, [file, 'text/javascript; charset=utf-8']]),
  ...['LICENSE', 'THIRD_PARTY_NOTICES.md', 'COPYING.libopus'].map(file => [`/vendor/opus/${file}`, [`vendor/opus/${file}`, 'text/plain; charset=utf-8']]),
]);

export function createApp(config, store = createStore(config)) {
  const sessions = createSessions(config, store);
  const accounts = createAccounts(config, store);
  async function readSession(req) {
    const session = await sessions.read(req);
    if (!session) return null;
    const principal = await accounts.principal(session);
    return principal ? { ...session, principal } : null;
  }
  const instance = randomUUID();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const metadata = () => ({
    node: process.version, platform: process.platform, arch: process.arch, instance,
    environment: config.production ? 'deployment' : 'local',
    deployment: process.env.VERCEL_URL || null, region: process.env.VERCEL_REGION || null,
    sessionStore: config.memory ? 'volatile-development' : 'redis',
    teamSpeak: 'ts3-opus-experimental',
  });
  function originAllowed(req) { return req.headers.origin === config.origin; }
  function reply(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
  }
  async function body(req, maxSize = 2048) {
    if (req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('Expected JSON'), { status: 415 });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxSize) throw Object.assign(new Error('Request too large'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, config.origin);
      // Never accept credentials, alternate destinations, or probe configuration in URLs.
      if (url.search) return reply(res, 400, { error: 'Query parameters are not accepted' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, contentType] = assets.get(url.pathname);
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(content);
      }
      if (req.method === 'POST' && !originAllowed(req)) return reply(res, 403, { error: 'Origin rejected' });
      if (url.pathname === '/api/auth' && req.method === 'GET') return reply(res, 200, { registrationEnabled: config.registration !== false && Boolean(config.identityKey), ownerAvailable: Boolean(config.passwordHash) });
      if (['/api/login', '/api/register'].includes(url.pathname) && req.method === 'POST') {
        const registering = url.pathname === '/api/register';
        if (!await store.limit(sessions.rateKey(registering ? 'registration-global' : 'login-global'), registering ? 10 : 120, 60)) return reply(res, 429, { error: 'Authentication limit reached; try again in one minute' });
        const input = await body(req);
        const name = typeof input?.username === 'string' ? input.username.toLowerCase() : 'owner';
        const bucket = createHash('sha256').update(name).digest('hex');
        if (!await store.limit(sessions.rateKey(`authentication:${bucket}`), 10, 60)) return reply(res, 429, { error: 'Authentication limit reached; try again in one minute' });
        const principal = registering ? await accounts.register(input) : await accounts.authenticate(input);
        if (!principal) return reply(res, 401, { error: 'Invalid username or password' });
        // Replacing a browser's login revokes its previous session and stops only that session's sockets.
        const previous = await sessions.read(req);
        await sessions.revoke(req);
        if (previous) for (const ws of wss.clients) if (ws.sessionCsrf === previous.csrf) ws.close(4401, 'Session replaced');
        const result = await sessions.create(principal);
        return reply(res, registering ? 201 : 200, { csrf: result.session.csrf, user: { username: principal.username } }, { 'Set-Cookie': result.cookie });
      }
      const session = await readSession(req);
      if (!session) return reply(res, 401, { error: 'Sign-in required' });
      const { vault, preferences, store: userStore } = createUserContext(config, store, session.principal);
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return reply(res, 403, { error: 'CSRF check failed' });
      if (url.pathname === '/api/session' && req.method === 'GET') return reply(res, 200, { csrf: session.csrf, expires: session.expires, user: { username: session.principal.username }, runtime: metadata() });
      if (url.pathname === '/api/preferences' && req.method === 'GET') return reply(res, 200, await preferences.read());
      if (url.pathname === '/api/connection' && req.method === 'POST') {
        if (!await userStore.limit(sessions.rateKey('connection-settings'), 30, 60)) return reply(res, 429, { error: 'Connection save limit reached; try again shortly.' });
        return reply(res, 200, await preferences.saveConnection(await body(req, 8192)));
      }
      if (url.pathname === '/api/preferences' && req.method === 'POST') {
        if (!await userStore.limit(sessions.rateKey('preferences'), 30, 60)) return reply(res, 429, { error: 'Preference save limit reached; try again shortly.' });
        return reply(res, 200, await preferences.save(await body(req, 65536)));
      }
      if (url.pathname === '/api/preferences/rotate' && req.method === 'POST') { await preferences.rotate(); return reply(res, 200, { rotated: true }); }
      if (url.pathname === '/api/protocol' && req.method === 'GET') {
        return reply(res, 200, { nativeAvailable: await nativeAvailable(config), identityEncryptionConfigured: vault.configured(),
          library: 'ReSpeak/tsclientlib', revision: 'ee3bc6f45a7137db7793ba5593a321df400d53e5', voice: 'opus-synthetic-network-verified' });
      }
      if (url.pathname === '/api/identity' && req.method === 'GET') {
        const identity = await vault.read();
        return reply(res, 200, { identity: identity ? { ...identity.metadata, createdAt: identity.createdAt } : null });
      }
      if (['/api/identity/create', '/api/identity/import'].includes(url.pathname) && req.method === 'POST') {
        if (!await userStore.limit(sessions.rateKey('identity'), 3, 60)) return reply(res, 429, { error: 'Identity operation limit reached' });
        if (!vault.configured()) return reply(res, 409, { error: 'Configure IDENTITY_ENCRYPTION_KEY first' });
        if (await vault.read()) return reply(res, 409, { error: 'An identity already exists; it was not replaced' });
        let request = { op: 'generate' };
        if (url.pathname.endsWith('/import')) {
          const input = await body(req, 20000);
          if (typeof input?.value !== 'string' || input.value.length > 16384) return reply(res, 400, { error: 'Invalid identity import' });
          // Official-client INI export or the compatible identity string itself.
          const match = input.value.match(/^identity\s*=\s*"?([^"\r\n]+)"?\s*$/mi);
          request = { op: 'import', value: (match ? match[1] : input.value).trim() };
        }
        const generated = await identityOperation(config, request);
        return reply(res, 201, { identity: await vault.initialize(generated) });
      }
      if (url.pathname === '/api/identity/export' && req.method === 'POST') {
        const identity = await vault.read();
        if (!identity) return reply(res, 404, { error: 'No identity exists' });
        const exported = await identityOperation(config, { op: 'export', identity: identity.identity });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="VoxHarbor-identity.ini"' });
        return res.end(`[Identity]\nid=VoxHarbor\nidentity="${exported.value}"\nnickname=VoxHarbor\n`);
      }
      if (url.pathname === '/api/identity/rotate' && req.method === 'POST') return reply(res, 200, { identity: await vault.rotate() });
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        const cookie = await sessions.revoke(req);
        for (const ws of wss.clients) if (ws.sessionCsrf === session.csrf) ws.close(4401, 'Session revoked');
        return reply(res, 200, { signedOut: true }, { 'Set-Cookie': cookie });
      }
      return reply(res, 404, { error: 'Route not found' });
    } catch (error) {
      // Never emit exception messages that might contain storage credentials or user input.
      reply(res, error.status || 503, { error: error.status ? error.message : 'Service unavailable; check configuration and storage' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    socket.setTimeout(10000, () => socket.destroy());
    function reject(status) {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    try {
      if (req.method !== 'GET' || req.url !== '/api/ts3' || !originAllowed(req)) return reject('403 Forbidden');
      const session = await readSession(req);
      if (!session) return reject('401 Unauthorized');
      const context = createUserContext(config, store, session.principal);
      if (!await context.store.limit(sessions.rateKey('ws'), 60, 60)) return reject('429 Too Many Requests');
      if (socket.destroyed) return;
      socket.setTimeout(0);
      wss.handleUpgrade(req, socket, head, ws => {
        ws.sessionCsrf = session.csrf;
        let count = 0;
        let voiceCount = 0;
        let windowStart = Date.now();
        let checking = false;
        let validatedUntil = Date.now() + 1000;
        const stopTimers = [];
        const close = (code, reason) => {
          if (ws.readyState !== 1) return;
          ws.close(code, reason);
          stopTimers.push(setTimeout(() => ws.terminate(), 1000));
        };
        const protocol = createProtocolControl(ws, { ...context, csrf: session.csrf, close });
        const sendMetadata = () => ws.send(JSON.stringify({ type: 'runtime', ...metadata(), connectedAt: new Date().toISOString() }));
        ws.on('error', () => {});
        ws.on('close', () => stopTimers.forEach(clearTimeout));
        ws.on('close', () => { void protocol?.stop().catch(() => {}); });
        // Cross-instance revocation is rechecked at least once per second, failing closed.
        const validate = async () => {
          if (checking) return false;
          checking = true;
          try {
            if (!await readSession(req)) { close(4401, 'Session expired or revoked'); return false; }
            validatedUntil = Date.now() + 1000;
            return true;
          } catch { close(1011, 'Session storage unavailable'); return false; }
          finally { checking = false; }
        };
        stopTimers.push(setInterval(() => { void validate(); }, 1000));
        stopTimers.push(setTimeout(() => close(4401, 'Session expired'), Math.max(1, session.expires - Date.now())));
        ws.on('message', async (data, isBinary) => {
          if (Date.now() - windowStart >= 1000) { count = 0; voiceCount = 0; windowStart = Date.now(); }
          const exceeded = isBinary ? ++voiceCount > 65 : ++count > 20;
          if (exceeded || ws.bufferedAmount > 65536) return close(1008, 'Transport capacity exceeded');
          if (Date.now() >= validatedUntil && !await validate()) return;
          if (ws.readyState !== 1) return;
          if (isBinary) return protocol.voice(data);
          try { await protocol.command(data); } catch { close(1011, 'Protocol command failed'); }
        });
        sendMetadata();
      });
    } catch { reject('503 Service Unavailable'); }
  });
  return { server, wss, sessions };
}
