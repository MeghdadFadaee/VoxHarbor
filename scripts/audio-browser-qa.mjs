// Local, disposable QA page. Synthetic audio only: no microphone, owner data or network server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/qa.mjs', 'tests/fixtures/audio-browser-qa.mjs'],
  ['/probe.mjs', 'tests/fixtures/playback-probe.mjs'],
  ...['voice-worker.mjs', 'voice-frame.mjs', 'voice-worklet.mjs', 'jitter-buffer.mjs', 'vendor/opus/index.js', 'vendor/opus/generated/libopus.generated.mjs'].map(file => [`/${file}`, `public/${file}`]),
]);
const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="en"><title>VoxHarbor silent audio QA</title><h1>Silent browser audio test</h1><p>Synthetic signal only. No microphone access, audible playback or TeamSpeak connection.</p><button id="run">Run silent pipeline test</button><pre id="result" role="status">Ready</pre><script type="module" src="/qa.mjs"></script></html>'); return;
  }
  if (!files.has(req.url)) { res.writeHead(404); res.end(); return; }
  try { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(await readFile(new URL(files.get(req.url), root))); }
  catch { res.writeHead(404); res.end(); }
});
server.listen(3147, '127.0.0.1', () => console.log('Silent audio QA: http://localhost:3147'));
