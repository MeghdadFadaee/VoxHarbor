import { createHash, createHmac, randomBytes } from 'node:crypto';

export function createSessions(config, store) {
  const name = config.secure ? '__Host-voxharbor' : 'voxharbor-local';
  const namespace = createHmac('sha256', config.secret).update('session-namespace-v1').digest('hex');
  function key(token) { return `vh:${namespace}:session:${createHash('sha256').update(token).digest('hex')}`; }
  function tokenFrom(req) {
    const cookies = (req.headers.cookie || '').split(';').map(s => s.trim());
    const values = cookies.filter(s => s.startsWith(`${name}=`));
    const token = values.length === 1 ? values[0].slice(name.length + 1) : '';
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  function cookie(token, ttl) {
    return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${config.secure ? '; Secure' : ''}`;
  }
  return {
    async create(principal = { id: 'owner', username: 'owner' }) {
      const token = randomBytes(32).toString('hex');
      const session = { userId: principal.id, username: principal.username, csrf: randomBytes(32).toString('hex'), expires: Date.now() + config.sessionSeconds * 1000 };
      await store.set(key(token), JSON.stringify(session), config.sessionSeconds);
      return { session, cookie: cookie(token, config.sessionSeconds) };
    },
    async read(req) {
      const token = tokenFrom(req);
      if (!token) return null;
      const value = await store.get(key(token));
      if (!value) return null;
      const session = typeof value === 'string' ? JSON.parse(value) : value;
      return session.expires > Date.now() ? session : null;
    },
    async revoke(req) {
      const token = tokenFrom(req);
      if (token) await store.delete(key(token));
      return cookie('', 0);
    },
    rateKey(action) { return `vh:${namespace}:rate:${action}:${Math.floor(Date.now() / 60000)}`; },
  };
}
