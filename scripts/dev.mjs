import { readConfig } from '../src/config.mjs';
import { createApp } from '../src/http-adapter.mjs';
let config;
try { config = readConfig(); }
catch (error) {
  console.error(`Cannot start VoxHarbor: ${error.message}`);
  console.error('For local owner setup, run: npm run owner:setup');
  console.error('Review .env.example for the remaining configuration.');
  process.exit(1);
}
const { server } = createApp(config);
const url = new URL(config.origin);
if (url.hostname !== 'localhost' || url.protocol !== 'http:') throw new Error('Local dev requires http://localhost:<port>');
server.listen(Number(url.port || 80), '127.0.0.1', () => console.log(`VoxHarbor feasibility lab: ${config.origin}`));
