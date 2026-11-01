// Unit-test adapter for the application worker. It does not open or automate a browser.
import { parentPort } from 'node:worker_threads';
globalThis.onmessage = null;
globalThis.postMessage = (message, transfer = []) => parentPort.postMessage(message, transfer);
globalThis.close = () => process.exit(0);
await import('../../public/voice-worker.mjs');
parentPort.on('message', data => { void globalThis.onmessage({ data }); });
