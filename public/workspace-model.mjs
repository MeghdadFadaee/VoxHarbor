export const pages = new Set(['connections', 'connection', 'identity', 'console', 'channels', 'conversation', 'audio', 'profile', 'diagnostics']);
export function resolvePage(hash) { const page = hash.replace(/^#/, ''); return pages.has(page) ? page : 'connections'; }
export function sameDestination(a, b) { return Boolean(a && b && a.host === b.host && a.port === b.port); }
export function recentChannels(channels, currentId, recentIds) {
  return [...new Set([currentId, ...recentIds])].map(id => channels.find(channel => channel.id === id)).filter(Boolean).slice(0, 4);
}
export function channelPath(channel, channels) {
  const byId = new Map(channels.map(item => [item.id, item])); const seen = new Set([channel.id]); const names = [];
  let parent = byId.get(channel.parentId);
  while (parent && !seen.has(parent.id)) { seen.add(parent.id); names.unshift(parent.name); parent = byId.get(parent.parentId); }
  return names.join(' / ');
}
export function matchesChannel(channel, channels, participants, query) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [channel.name, channelPath(channel, channels), ...participants.filter(person => person.channelId === channel.id).map(person => person.name)].some(text => text.toLocaleLowerCase().includes(needle));
}
