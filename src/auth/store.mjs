// Production state always lives in the owner's Redis, never the Function filesystem.
export function createStore(config) {
  if (config.memory) {
    const entries = new Map();
    function get(key) {
      const entry = entries.get(key);
      if (!entry || entry.expires <= Date.now()) { entries.delete(key); return null; }
      return entry.value;
    }
    return {
      async get(key) { return get(key); },
      async set(key, value, ttl) { entries.set(key, { value, expires: Date.now() + ttl * 1000 }); },
      async delete(key) { entries.delete(key); },
      async putIfAbsent(key, value, ttl) {
        if (get(key) !== null) return false;
        entries.set(key, { value, expires: ttl ? Date.now() + ttl * 1000 : Infinity });
        return true;
      },
      async compareSet(key, expected, value, ttl) {
        if (get(key) !== expected) return false;
        entries.set(key, { value, expires: ttl ? Date.now() + ttl * 1000 : Infinity });
        return true;
      },
      async compareDelete(key, expected) {
        if (get(key) !== expected) return false;
        entries.delete(key);
        return true;
      },
      async limit(key, max, ttl) {
        // Prune development-only state so expired rate keys cannot accumulate.
        for (const k of entries.keys()) get(k);
        const count = Number(get(key) || 0) + 1;
        entries.set(key, { value: count, expires: entries.get(key)?.expires || Date.now() + ttl * 1000 });
        return count <= max;
      },
    };
  }
  async function command(args) {
    const response = await fetch(config.redisUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${config.redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error('Session storage unavailable');
    const result = await response.json();
    if (result.error) throw new Error('Session storage unavailable');
    return result.result;
  }
  return {
    get: key => command(['GET', key]),
    set: (key, value, ttl) => command(['SET', key, value, 'EX', ttl]),
    delete: key => command(['DEL', key]),
    async putIfAbsent(key, value, ttl) {
      return (await command(['SET', key, value, 'NX', ...(ttl ? ['EX', ttl] : [])])) === 'OK';
    },
    async compareSet(key, expected, value, ttl) {
      return Number(await command(['EVAL', "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); if tonumber(ARGV[3])>0 then redis.call('EXPIRE',KEYS[1],ARGV[3]) end; return 1", 1, key, expected, value, ttl || 0])) === 1;
    },
    async compareDelete(key, expected) {
      return Number(await command(['EVAL', "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0", 1, key, expected])) === 1;
    },
    async limit(key, max, ttl) {
      const count = await command(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, ttl]);
      return Number(count) <= max;
    },
  };
}
