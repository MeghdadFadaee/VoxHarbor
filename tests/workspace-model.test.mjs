import test from 'node:test';
import assert from 'node:assert/strict';
import { recentChannels, matchesChannel, channelPath, resolvePage, sameDestination } from '../public/workspace-model.mjs';
test('a large channel list never becomes a full row of room tabs', () => {
  const channels = Array.from({length:150}, (_,i) => ({id:i+1,name:`Room ${i+1}`}));
  assert.deepEqual(recentChannels(channels, 80, [79, 80, 78, 77, 76, 999]).map(x=>x.id), [80,79,78,77]);
});
test('channel search finds people and ancestors, and malformed hierarchies terminate', () => {
  const channels = [{id:1,parentId:0,name:'Community'},{id:2,parentId:1,name:'Studio'},{id:3,parentId:2,name:'Quiet'}];
  assert.equal(channelPath(channels[2],channels),'Community / Studio');
  assert.equal(matchesChannel(channels[2],channels,[{channelId:3,name:'Sofia'}],'sof'),true);
  assert.equal(matchesChannel(channels[2],channels,[],'studio'),true);
  assert.equal(matchesChannel(channels[2],channels,[{channelId:2,name:'Alex'}],'alex'),false);
  channels[0].parentId=3;
  assert.equal(channelPath(channels[2],channels),'Community / Studio');
});
test('page routes accept only known page names and destination status includes the voice port', () => {
  assert.equal(resolvePage('#channels'),'channels'); assert.equal(resolvePage('#not-a-page'),'connections'); assert.equal(resolvePage('#connection?password=secret'),'connections');
  assert.equal(sameDestination({host:'example.com',port:9987},{host:'example.com',port:9988}),false);
});
