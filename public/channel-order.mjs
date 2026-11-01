// TeamSpeak channel_order is the preceding sibling's ID, not a numeric rank.
export function orderChannels(channels) {
  const byId = new Map(channels.map(channel => [channel.id, channel]));
  const groups = new Map();
  for (const channel of channels) {
    const parent = channel.parentId && byId.has(channel.parentId) ? channel.parentId : 0;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(channel);
  }
  function siblings(group = []) {
    const ids = new Set(group.map(channel => channel.id));
    const links = new Map();
    const seen = new Set();
    const ordered = [];
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const channel of sorted) {
      if (!links.has(channel.order)) links.set(channel.order, []);
      links.get(channel.order).push(channel);
    }
    const starts = [...sorted.filter(channel => !ids.has(channel.order)), ...sorted];
    for (const start of starts) {
      const queue = [start];
      while (queue.length) {
        const channel = queue.pop();
        if (seen.has(channel.id)) continue;
        seen.add(channel.id);
        ordered.push(channel);
        queue.push(...[...(links.get(channel.id) || [])].reverse());
      }
    }
    return ordered;
  }
  const visited = new Set();
  const result = [];
  const roots = [...siblings(groups.get(0)), ...channels];
  for (const root of roots) {
    const stack = [{ channel: root, depth: 0 }];
    while (stack.length) {
      const item = stack.pop();
      if (visited.has(item.channel.id)) continue;
      visited.add(item.channel.id);
      result.push(item);
      stack.push(...siblings(groups.get(item.channel.id)).reverse().map(channel => ({ channel, depth: Math.min(item.depth + 1, 10) })));
    }
  }
  return result;
}
