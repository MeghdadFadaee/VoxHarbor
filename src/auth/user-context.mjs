import { createVault } from '../identity/vault.mjs';
import { createPreferences } from '../preferences.mjs';

export function createUserContext(config, store, principal) {
  if (!principal || !(principal.id === 'owner' || /^[a-f0-9]{32}$/.test(principal.id))) throw new Error('Invalid account scope');
  const legacy = principal.id === 'owner';
  const prefix = legacy ? '' : `voxharbor:user:v1:${principal.id}:`;
  const scoped = {};
  for (const method of ['get', 'set', 'delete', 'putIfAbsent', 'compareSet', 'compareDelete', 'limit']) {
    scoped[method] = (key, ...args) => store[method](prefix + key, ...args);
  }
  const scopedConfig = legacy ? config : { ...config, recordScope: principal.id, defaultNickname: principal.username };
  return { config: scopedConfig, store: scoped, vault: createVault(scopedConfig, scoped), preferences: createPreferences(scopedConfig, scoped) };
}
