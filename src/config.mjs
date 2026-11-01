export function readConfig(env = process.env) {
  const production = env.VERCEL === '1' || env.NODE_ENV === 'production';
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:3000');
  if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password ||
      (production ? origin.protocol !== 'https:' : !['https:', 'http:'].includes(origin.protocol))) {
    throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production)');
  }
  if (!/^[a-f0-9]{64}$/i.test(env.SESSION_SECRET || '')) throw new Error('SESSION_SECRET must be 32 random hex bytes');
  if (env.OWNER_PASSWORD_HASH && !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.OWNER_PASSWORD_HASH)) throw new Error('Configure OWNER_PASSWORD_HASH');
  if (env.ALLOW_REGISTRATION !== undefined && !['0', '1'].includes(env.ALLOW_REGISTRATION)) throw new Error('ALLOW_REGISTRATION must be 0 or 1');
  // The Vercel Marketplace integration provisions KV_* names by default.
  // Keep each credential pair together rather than mixing values from two stores.
  const explicitRedis = Boolean(env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_TOKEN);
  const redisUrl = explicitRedis ? env.UPSTASH_REDIS_REST_URL : env.KV_REST_API_URL;
  const redisToken = explicitRedis ? env.UPSTASH_REDIS_REST_TOKEN : env.KV_REST_API_TOKEN;
  if (redisUrl && new URL(redisUrl).protocol !== 'https:') throw new Error('Redis requires HTTPS');
  const memory = !production && env.ALLOW_LOCAL_MEMORY_STORE === '1';
  if (!memory && (!redisUrl || !redisToken)) throw new Error('Durable Redis sessions are required');
  for (const key of ['IDENTITY_ENCRYPTION_KEY', 'IDENTITY_PREVIOUS_ENCRYPTION_KEY']) {
    if (env[key] && !/^[a-f0-9]{64}$/i.test(env[key])) throw new Error(`${key} must be 32 random hex bytes`);
  }
  return {
    origin: origin.origin, secure: origin.protocol === 'https:', production,
    secret: env.SESSION_SECRET, passwordHash: env.OWNER_PASSWORD_HASH, registration: env.ALLOW_REGISTRATION !== '0',
    redisUrl, redisToken, memory,
    sessionSeconds: 900,
    identityKey: env.IDENTITY_ENCRYPTION_KEY, previousIdentityKey: env.IDENTITY_PREVIOUS_ENCRYPTION_KEY,
    protocolBinary: !production ? env.PROTOCOL_BINARY_PATH : undefined,
  };
}
