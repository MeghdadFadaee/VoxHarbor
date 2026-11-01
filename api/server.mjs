import { readConfig } from '../src/config.mjs';
import { createApp } from '../src/http-adapter.mjs';

// Invalid configuration fails before any sensitive endpoint can be served.
const { server } = createApp(readConfig());
export default server;
