import test from 'node:test';
import assert from 'node:assert/strict';
import { orderChannels } from '../public/channel-order.mjs';

test('channel hierarchy follows preceding-sibling links, not numeric IDs or order ranks', () => {
  const result = orderChannels([
    { id: 1, parentId: 2, order: 0 },
    { id: 20, parentId: 100, order: 30 },
    { id: 30, parentId: 100, order: 2 },
    { id: 100, parentId: 0, order: 0 },
    { id: 2, parentId: 100, order: 0 },
  ]);
  assert.deepEqual(result.map(item => [item.channel.id, item.depth]), [[100, 0], [2, 1], [1, 2], [30, 1], [20, 1]]);
});
test('malformed channel cycles and missing parents remain finite and appear once', () => {
  const channels = [{ id: 1, parentId: 2, order: 2 }, { id: 2, parentId: 1, order: 1 }, { id: 3, parentId: 900, order: 0 }];
  const result = orderChannels(channels);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map(item => item.channel.id)).size, 3);
});
