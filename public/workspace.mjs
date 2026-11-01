import { clientCommand, joinChannel, getParticipantVolume, setParticipantVolume } from './protocol.mjs';
import { orderChannels } from './channel-order.mjs';
import { resolvePage, recentChannels, channelPath, matchesChannel, sameDestination } from './workspace-model.mjs';
const $ = id => document.getElementById(id);
let selected, state, previousOwnChannel, privatePeer, privatePeerUid, workspaceCsrf, preferences, selectedBookmark;
let connected = false, connectionActive = false, sequence = 0, sending = false, workspaceEpoch = 0, preferenceBusy = false;
let activeSpeakers = new Set(); const messages = []; const drafts = new Map(); let draftKey; const threads = new Map(); const unread = new Map(); let recent = [];
let page = 'connections', editorDirty = false, routeGeneration = 0, signedIn = false;
let theme = 'system'; const themes = ['system', 'light', 'dark'];
const pageCopy = { connections: 'CONNECTIONS / SAVED DESTINATIONS', connection: 'CONNECTIONS / EDIT DESTINATION', identity: 'ACCOUNT / TEAMSPEAK IDENTITY', console: 'VOICE CONSOLE', channels: 'WORKSPACE / FIND A CHANNEL', conversation: 'CONVERSATION / PRIVATE', audio: 'AUDIO / PREFERENCES', profile: 'ACCOUNT / PRESENCE', diagnostics: 'CONNECTION / DIAGNOSTICS' };
async function workspaceApi(path, body) {
  const response = await fetch(path, { signal: AbortSignal.timeout(15000), method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': workspaceCsrf }, body: JSON.stringify(body) }) });
  if (response.status === 401) window.dispatchEvent(new Event('voxharbor-owner-expired'));
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Workspace storage is unavailable.'); return result;
}
let confirmResolve;
function confirmAction(title, description, accept = 'Continue') {
  if (confirmResolve) return Promise.resolve(false);
  $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-accept').textContent = accept;
  $('confirm-dialog').showModal(); return new Promise(resolve => { confirmResolve = resolve; });
}
function finishConfirm(value) { const resolve = confirmResolve; confirmResolve = undefined; $('confirm-dialog').close(); resolve?.(value); }
$('confirm-form').addEventListener('submit', event => { event.preventDefault(); finishConfirm(true); });
$('confirm-cancel').addEventListener('click', () => finishConfirm(false));
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); finishConfirm(false); });
async function navigate(next, { replace = false, fromHistory = false, force = false } = {}) {
  next = resolvePage('#' + next); const generation = ++routeGeneration;
  if (!signedIn) return;
  if (!force && page === 'connection' && next !== page && editorDirty && !await confirmAction('Discard unsaved changes?', 'Your saved connection has not changed. Leave this editor and discard the changes?', 'Discard changes')) {
    if (fromHistory) history.replaceState(null, '', '#' + page); return;
  }
  if (generation !== routeGeneration) return;
  if (page === 'connection' && next !== page) { clearEditorSecrets(); editorDirty = false; }
  page = next;
  if (page === 'conversation' && privatePeer && connected && $('chat-scope').querySelector('option[value=private]')) $('chat-scope').value = 'private';
  if (page === 'console' && scope() === 'private') { $('chat-scope').value = 'channel'; renderMessages(); }
  for (const section of document.querySelectorAll('section[data-page]:not(#lab)')) section.hidden = section.dataset.page !== page;
  $('lab').dataset.page = page; $('page-breadcrumb').textContent = pageCopy[page];
  for (const button of document.querySelectorAll('.top-actions [data-route]')) { if (button.dataset.route === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  (page === 'conversation' ? $('direct-chat-slot') : $('console-chat-slot')).append($('chat-panel'));
  $('session-ribbon').hidden = !connectionActive || page === 'console';
  if (!fromHistory && location.hash !== '#' + page) history[replace ? 'replaceState' : 'pushState'](null, '', '#' + page);
  document.title = `VoxHarbor · ${pageCopy[page].split(' / ').at(-1).toLowerCase()}`;
  document.querySelector('.skip-link').href = page === 'console' ? '#workspace-content' : `#page-${page}`;
  const section = document.querySelector(`section[data-page="${page}"]:not(#lab)`); section.id ||= `page-${page}`;
  window.scrollTo(0, 0); section.querySelector('h1')?.focus({ preventScroll: true });
  if (page === 'channels') renderBrowser(); if (page === 'conversation') renderMessages();
}
window.addEventListener('hashchange', () => void navigate(resolvePage(location.hash), { fromHistory: true }));
for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', event => { event.preventDefault(); void navigate(button.dataset.route); });
function clearEditorSecrets() { $('ts3-password').value = ''; $('ts3-channel-password').value = ''; $('bookmark-clear-passwords').checked = false; $('connection-clear-passwords').checked = false; }
function applyConnection(connection) {
  delete $('settings-dialog').dataset.bookmarkId; clearEditorSecrets();
  $('ts3-host').value = connection?.host || ''; $('ts3-port').value = String(connection?.port || 9987); $('ts3-nickname').value = connection?.nickname || preferences?.nickname || '';
  $('ts3-channel').value = connection?.channelId ? String(connection.channelId) : '';
  $('ts3-password').placeholder = connection?.hasPassword ? 'Saved on backend; leave blank to keep' : 'Optional';
  $('ts3-channel-password').placeholder = connection?.hasChannelPassword ? 'Saved on backend; leave blank to keep' : 'Optional';
}
async function editConnection(connection) {
  if (page === 'connection' && editorDirty && !await confirmAction('Discard unsaved changes?', 'Open another destination and discard the current edits?', 'Discard changes')) return;
  selectedBookmark = connection?.id && preferences?.bookmarks.some(item => item.id === connection.id) ? connection.id : undefined;
  applyConnection(connection); if (selectedBookmark) $('settings-dialog').dataset.bookmarkId = selectedBookmark;
  $('bookmark-name').value = connection?.name || ''; $('bookmark-delete').hidden = !selectedBookmark;
  $('bookmark-passwords').checked = true; $('editor-status').textContent = ''; editorDirty = false;
  await navigate('connection');
}
async function startConnection(connection, passwords = {}) {
  if ($('ts3-connect').disabled) { $('notice').textContent = 'Set up your identity before connecting, or wait for the current connection to finish.'; if (!connectionActive) await navigate('identity'); return; }
  if (connectionActive) return;
  applyConnection(connection); if (typeof passwords.password === 'string') $('ts3-password').value = passwords.password; if (typeof passwords.channelPassword === 'string') $('ts3-channel-password').value = passwords.channelPassword; $('server-name').textContent = connection.name || connection.host;
  if (preferences.bookmarks.some(item => item.id === connection.id)) $('settings-dialog').dataset.bookmarkId = connection.id;
  $('ts3-connect').click(); await navigate('console', { force: true });
}
function renderBookmarks() {
  if (!preferences) return;
  const fragment = document.createDocumentFragment();
  for (const bookmark of preferences?.bookmarks || []) {
    const active = connectionActive && sameDestination(bookmark, preferences.connection);
    const row = node('article', undefined, 'destination-row');
    const info = node('div'); info.append(node('h2', bookmark.name), node('p', `${bookmark.host}:${bookmark.port}${bookmark.channelId ? ` · Channel ${bookmark.channelId}` : ''}`, 'hint'));
    row.append(info, node('span', bookmark.nickname, 'destination-nickname'), node('span', active ? $('connection-badge').textContent : 'Disconnected', `destination-state${active ? ' is-active' : ''}`));
    const actions = node('div', undefined, 'row');
    const connect = node('button', active ? connected ? 'Open console' : 'View connection' : 'Connect', 'secondary'); connect.disabled = !active && (connectionActive || !$('ts3-connect') || $('ts3-connect').disabled);
    connect.setAttribute('aria-label', `${active ? 'Open console for' : 'Connect to'} ${bookmark.name}`);
    connect.addEventListener('click', () => active ? navigate('console') : startConnection(bookmark));
    const edit = node('button', 'Edit', 'quiet'); edit.setAttribute('aria-label', `Edit ${bookmark.name}`); edit.addEventListener('click', () => void editConnection(bookmark)); actions.append(connect, edit);
    if (active) { const disconnect = node('button', 'Disconnect', 'quiet'); disconnect.addEventListener('click', () => $('ts3-disconnect').click()); actions.append(disconnect); }
    row.append(actions); fragment.append(row);
  }
  if (!fragment.childNodes.length) { const empty = node('div', undefined, 'destinations-empty'); empty.append(node('h2', 'Your next destination starts here.'), node('p', 'Save a server, nickname and optional channel. Come back to it whenever you sign in.', 'hint')); const add = node('button', 'Add your first connection'); add.addEventListener('click', () => void editConnection()); empty.append(add); fragment.append(empty); }
  $('bookmarks').replaceChildren(fragment);
  const last = preferences?.connection;
  $('recent-connection').hidden = !last || preferences.bookmarks.some(item => sameDestination(item, last));
  if (last) { const description = node('div'); description.append(node('p', 'LAST USED CONNECTION', 'eyebrow'), node('h2', `${last.host}:${last.port}`), node('p', last.nickname, 'hint')); const reconnect = node('button', connectionActive ? 'Open console' : 'Reconnect', 'secondary'); reconnect.disabled = !connectionActive && $('ts3-connect').disabled; reconnect.addEventListener('click', () => connectionActive ? navigate('console') : startConnection(last)); $('recent-connection').replaceChildren(description, reconnect); }
  $('workspace-loading').hidden = Boolean(preferences);
  if (connectionActive) $('preferences-status').textContent = 'One connection is active. Open its console or disconnect before connecting to another server.';
}
function applyTheme() { document.documentElement.dataset.theme = theme === 'system' ? 'dark' : theme; $('theme-toggle').textContent = `Theme: ${theme}`; }
export async function loadWorkspace(token) {
  const epoch = ++workspaceEpoch; workspaceCsrf = token; preferences = undefined; signedIn = true; editorDirty = false;
  await navigate(resolvePage(location.hash), { replace: true, force: true });
  try {
    const value = await workspaceApi('/api/preferences'); if (epoch !== workspaceEpoch) return;
    preferences = value; theme = value.theme; applyTheme(); applyConnection(page === 'connection' ? undefined : value.connection); $('profile-nickname').value = value.nickname;
    $('bookmark-save').disabled = false; $('preferences-status').textContent = 'Your saved destinations are ready.'; renderBookmarks();
  } catch (error) { if (epoch === workspaceEpoch) { $('workspace-loading').textContent = 'Destinations could not be loaded. Reload to try again.'; $('preferences-status').textContent = error.message; } }
}
export function resetWorkspace() {
  ++workspaceEpoch; signedIn = false; preferences = undefined; workspaceCsrf = undefined; selectedBookmark = undefined; preferenceBusy = false; editorDirty = false;
  clearEditorSecrets(); $('connection-form').reset(); $('profile-nickname').value = ''; $('bookmarks').replaceChildren(); $('workspace-loading').hidden = false; $('workspace-loading').textContent = 'Loading your destinations…'; $('recent-connection').hidden = true;
  $('editor-status').textContent = ''; $('preferences-status').textContent = ''; delete $('settings-dialog').dataset.bookmarkId;
  if (confirmResolve) finishConfirm(false); history.replaceState(null, '', '#connections');
}
async function savePreferences(value) {
  if (!preferences || preferenceBusy) throw new Error('Wait for your destinations to finish loading or saving.');
  const epoch = workspaceEpoch; preferenceBusy = true; $('bookmark-save').disabled = true;
  try { const result = await workspaceApi('/api/preferences', value); if (epoch !== workspaceEpoch) return; preferences = result; renderBookmarks(); return result; }
  finally { if (epoch === workspaceEpoch) { preferenceBusy = false; $('bookmark-save').disabled = false; } }
}
window.addEventListener('voxharbor-connection-saved', ({ detail }) => { if (!workspaceCsrf) return; preferences = detail; renderBookmarks(); });
window.addEventListener('voxharbor-capabilities', renderBookmarks);
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function scope() { return $('chat-scope').value; }
function own() { return state?.participants.find(client => client.id === state.ownClientId); }
function scopeKey(message) { return message.target === 'private' || message.target === 'poke' ? `private:${message.peerUid || (message.peerId ?? message.clientId)}` : message.target === 'channel' ? `channel:${message.channelId}` : 'server'; }
function activeKey() { return scope() === 'private' ? `private:${privatePeerUid || privatePeer}` : scope() === 'channel' ? `channel:${own()?.channelId}` : 'server'; }
function renderMessages() {
  const nextDraftKey = activeKey();
  if (draftKey !== nextDraftKey) {
    if (draftKey) { if ($('message-input').value) drafts.set(draftKey, $('message-input').value); else drafts.delete(draftKey); }
    if (drafts.size > 40) drafts.delete(drafts.keys().next().value);
    $('message-input').value = drafts.get(nextDraftKey) || ''; draftKey = nextDraftKey;
  }
  const list = $('messages'); const oldScroll = list.scrollTop; const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const fragment = document.createDocumentFragment();
  for (const message of (page === 'conversation' && scope() !== 'private' ? [] : messages.filter(message => scopeKey(message) === activeKey()))) {
    const row = node('li', undefined, `message${message.outgoing ? ' own-message' : ''}`);
    row.dataset.message = String(message.id);
    const heading = node('div', undefined, 'message-heading');
    heading.append(node('strong', message.name), node('time', new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    row.append(heading, node('p', message.message)); fragment.append(row);
  }
  list.replaceChildren(fragment);
  $('chat-empty').hidden = list.children.length > 0;
  $('chat-empty').replaceChildren(document.createTextNode(page === 'conversation' && scope() !== 'private' ? 'Choose a participant.' : 'No messages yet.'), node('span', page === 'conversation' && scope() !== 'private' ? 'Your private conversations appear here.' : 'Your conversation starts here.'));
  list.scrollTop = pinned ? list.scrollHeight : oldScroll;
  const channel = state?.channels.find(channel => channel.id === own()?.channelId);
  const peer = state?.participants.find(client => client.id === privatePeer && (!privatePeerUid || client.uid === privatePeerUid));
  $('chat-context').textContent = scope() === 'private' ? `Private conversation with ${peer?.name || 'a disconnected participant'}` : scope() === 'server' ? 'Visible to the server. Messages are not saved.' : channel ? `Current channel · ${channel.name}` : 'Messages stay in this browser session.';
  $('message-input').disabled = !connected || (scope() === 'private' && !peer);
  $('message-send').disabled = $('message-input').disabled || sending;
  for (const button of document.querySelectorAll('[data-chat-scope]')) button.setAttribute('aria-pressed', String(button.dataset.chatScope === scope()));
  $('private-chat').setAttribute('aria-pressed', String(scope() === 'private'));
  $('private-chat').textContent = scope() === 'private' && peer ? `Private · ${peer.name}` : 'Private';
  $('message-input').placeholder = scope() === 'private' ? `Message ${peer?.name || 'participant'}…` : scope() === 'server' ? 'Message the server…' : channel ? `Message ${channel.name}…` : 'Message this room…';
  renderThreads();
  $('poke-open').hidden = scope() !== 'private'; $('poke-open').disabled = !connected || !peer;
}
function appendMessage(message) {
  const duplicate = messages.some(previous => previous.outgoing !== message.outgoing && previous.clientId === message.clientId && scopeKey(previous) === scopeKey(message) && previous.message === message.message && Math.abs(previous.at - message.at) < 5000);
  if (duplicate) return;
  messages.push({ ...message, id: ++sequence }); if (messages.length > 200) messages.shift(); renderMessages();
}
function openPrivate(client) {
  unread.delete(client.uid || String(client.id));
  privatePeer = client.id;
  privatePeerUid = client.uid || undefined;
  let option = $('chat-scope').querySelector('option[value="private"]');
  if (!option) { option = new Option('', 'private'); $('chat-scope').add(option); }
  option.textContent = `Private · ${client.name}`; $('chat-scope').value = 'private';
  threads.set(client.uid || String(client.id), { ...client }); renderMessages(); void navigate('conversation').then(() => $('message-input').focus());
}

function emptyRoom() {
  const empty = node('div', undefined, 'room-empty');
  empty.append(node('p', 'NO ROOM SELECTED', 'eyebrow'), node('h2', 'A little quieter here.'), node('p', 'Connect to your server to see rooms and people.', 'hint'));
  const button = node('button', 'Set up a connection ↗', 'secondary'); button.addEventListener('click', () => navigate('connections')); empty.append(button);
  $('member-list').replaceChildren(empty);
}
function renderChannel() {
  renderRooms();
  if (!state) return;
  const channel = state.channels.find(channel => channel.id === own()?.channelId);
  if (!channel) return;
  const current = channel.id === own()?.channelId;
  const peers = state.participants.filter(client => client.channelId === channel.id && client.id !== state.ownClientId);
  $('selected-channel-name').textContent = channel.name;
  $('selected-channel-topic').textContent = channel.topic || (current ? 'A place to catch up. Keep it kind.' : 'Select Join channel to move here.');
  $('channel-context').textContent = `${current ? 'Your room' : 'Channel preview'} / ${peers.length} ${peers.length === 1 ? 'other' : 'others'} / ${channel.codec === 4 || channel.codec === 5 ? 'Opus voice' : 'Unsupported audio codec'}`;
  $('join-selected').hidden = current; $('join-selected').disabled = !connected;
  $('subscription-toggle').hidden = false; $('subscription-toggle').disabled = !connected;
  $('subscription-toggle').textContent = channel.subscribed ? 'Subscribed / Unsubscribe' : 'Subscribe';
  const fragment = document.createDocumentFragment();
  for (const [index, client] of peers.entries()) {
    const card = node('div', undefined, 'member'); card.dataset.member = String(client.id);
    card.classList.toggle('speaking', activeSpeakers.has(client.id));
    const top = node('div', undefined, 'member-top'); top.append(node('span', String(index + 1).padStart(2, '0'))); card.append(top);
    const baseStatus = client.awayMessage !== null && client.awayMessage !== undefined ? `Away${client.awayMessage ? ` · ${client.awayMessage}` : ''}` : client.outputMuted ? 'Output muted' : client.inputMuted ? 'Microphone muted' : 'Listening';
    const status = node('span', activeSpeakers.has(client.id) ? 'Speaking' : baseStatus, 'hint'); status.dataset.baseStatus = baseStatus;
    const info = node('div', undefined, 'member-info'); info.append(node('strong', client.name), status); card.append(info);
    const mix = node('div', undefined, 'member-mix'); const value = Math.round(getParticipantVolume(client.id) * 100);
    const readout = node('div'); const output = node('output', String(value), 'volume-value'); output.dataset.volumeReadout = String(client.id); output.append(node('small', 'PLAYBACK %'));
    readout.append(output, node('p', 'Volume', 'volume-label'));
    const fader = node('div', undefined, 'fader'); const volume = node('input'); volume.type = 'range'; volume.min = '0'; volume.max = '200'; volume.value = String(value); volume.disabled = !connected;
    volume.dataset.volumeClient = String(client.id); volume.setAttribute('aria-label', `Playback volume for ${client.name}`); volume.setAttribute('aria-valuetext', `${value} percent`);
    volume.addEventListener('input', () => setParticipantVolume(client.id, Number(volume.value) / 100));
    const scale = node('div', undefined, 'fader-scale'); scale.setAttribute('aria-hidden', 'true'); scale.append(node('span', '200'), node('span', '100'), node('span', '0'));
    fader.append(volume, scale); mix.append(readout, fader); card.append(mix);
    const actions = node('div', undefined, 'member-actions');
    const message = node('button', 'Message', 'quiet'); message.disabled = !connected; message.addEventListener('click', () => openPrivate(client));
    const poke = node('button', 'Poke', 'quiet'); poke.disabled = !connected; poke.addEventListener('click', () => { openPrivate(client); $('poke-open').click(); });
    actions.append(message, poke); card.append(actions); fragment.append(card);
  }
  if (!fragment.childNodes.length) {
    const empty = node('div', undefined, 'room-empty'); empty.append(node('p', current ? 'YOU’RE HERE' : 'ROOM PREVIEW', 'eyebrow'), node('h2', 'Room for conversation.'), node('p', 'No other visible participants in this channel.', 'hint')); fragment.append(empty);
  }
  const focused = document.activeElement?.dataset.volumeClient; const scroll = $('member-list').scrollTop;
  $('member-list').replaceChildren(fragment); $('member-list').scrollTop = scroll;
  if (focused) $('member-list').querySelector(`[data-volume-client="${focused}"]`)?.focus({ preventScroll: true });
  $('mixer-count').textContent = `${peers.length} ${peers.length === 1 ? 'participant' : 'participants'} · Playback volume 0–200%`;
}
window.addEventListener('voxharbor-volume', ({ detail }) => {
  for (const input of document.querySelectorAll('[data-volume-client]')) if (Number(input.dataset.volumeClient) === detail.id) { input.value = String(Math.round(detail.volume * 100)); input.setAttribute('aria-valuetext', `${input.value} percent`); }
  for (const output of document.querySelectorAll('[data-volume-readout]')) if (Number(output.dataset.volumeReadout) === detail.id) { output.replaceChildren(document.createTextNode(String(Math.round(detail.volume * 100))), node('small', 'PLAYBACK %')); }
});

$('subscription-toggle').addEventListener('click', async () => {
  const channel = state?.channels.find(channel => channel.id === own()?.channelId); if (!channel) return;
  $('subscription-toggle').disabled = true;
  try { await clientCommand({ type: 'subscribe', channelId: channel.id, subscribed: !channel.subscribed }); }
  catch (error) { $('notice').textContent = error.message; }
  finally { renderChannel(); }
});
$('nickname-update').addEventListener('click', async () => {
  $('nickname-update').disabled = true;
  try { await clientCommand({ type: 'nickname', name: $('profile-nickname').value.trim() }); $('ts3-nickname').value = $('profile-nickname').value.trim(); $('profile-status').textContent = 'Nickname updated.'; }
  catch (error) { $('profile-status').textContent = error.message; }
  finally { $('nickname-update').disabled = !connected; }
});
$('away-toggle').addEventListener('click', async () => {
  $('away-toggle').disabled = true;
  try {
    if (new TextEncoder().encode($('away-message').value).length > 500) throw new Error('Keep the away message within 500 UTF-8 bytes.');
    await clientCommand({ type: 'away', away: own()?.awayMessage === null || own()?.awayMessage === undefined, message: $('away-message').value }); $('profile-status').textContent = 'Status updated.';
  }
  catch (error) { $('profile-status').textContent = error.message; }
  finally { $('away-toggle').disabled = !connected; }
});
$('poke-open').addEventListener('click', () => { const peer = state?.participants.find(client => client.id === privatePeer && (!privatePeerUid || client.uid === privatePeerUid)); if (!peer) return; $('poke-recipient').textContent = peer.name; $('poke-message').value = ''; $('poke-status').textContent = ''; $('poke-dialog').showModal(); });
$('poke-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = privatePeer; const uid = privatePeerUid;
  if (!connected || !state?.participants.some(client => client.id === id && (!uid || client.uid === uid))) { $('poke-status').textContent = 'This participant is no longer connected.'; return; }
  if (new TextEncoder().encode($('poke-message').value).length > 500) { $('poke-status').textContent = 'Keep the poke within 500 UTF-8 bytes.'; return; }
  let message = $('poke-message').value; $('poke-message').value = ''; $('poke-submit').disabled = true;
  try { await clientCommand({ type: 'poke', clientId: id, ...(uid ? { clientUid: uid } : {}), message }); $('poke-dialog').close(); $('message-status').textContent = 'Poke sent.'; }
  catch (error) { $('poke-status').textContent = error.message; }
  finally { message = ''; $('poke-submit').disabled = false; }
});
$('poke-dialog').addEventListener('close', () => { $('poke-message').value = ''; });
for (const button of document.querySelectorAll('[data-chat-scope]')) button.addEventListener('click', () => { $('chat-scope').value = button.dataset.chatScope; $('chat-scope').dispatchEvent(new Event('change')); });
$('chat-scope').addEventListener('change', () => { $('message-status').textContent = ''; renderMessages(); });
$('message-form').addEventListener('submit', async event => {
  event.preventDefault(); if (sending) return; const message = $('message-input').value.trim(); if (!message) return;
  if (new TextEncoder().encode(message).length > 1000) { $('message-status').textContent = 'Message is too long. Keep it within 1,000 UTF-8 bytes.'; return; }
  const epoch = workspaceEpoch; const requestDraftKey = activeKey(); const target = scope(); const peerId = privatePeer; const peerUid = privatePeerUid; const channelId = own()?.channelId; const sender = own();
  sending = true; $('message-send').disabled = true; $('message-status').textContent = 'Sending…';
  try {
    await clientCommand({ type: 'text_message', target, ...(target === 'channel' ? { channelId } : {}), ...(target === 'private' ? { clientId: peerId, ...(peerUid ? { clientUid: peerUid } : {}) } : {}), message });
    if (epoch !== workspaceEpoch) return;
    appendMessage({ target, peerId, peerUid, channelId, clientId: sender.id, name: sender.name, message, outgoing: true, at: Date.now() });
    drafts.delete(requestDraftKey); if (activeKey() === requestDraftKey && $('message-input').value.trim() === message) $('message-input').value = ''; $('message-status').textContent = 'Sent.';
  } catch (error) { if (epoch === workspaceEpoch) $('message-status').textContent = error.message; }
  finally { if (epoch === workspaceEpoch) { sending = false; renderMessages(); } }
});

function renderRooms() {
  const fragment = document.createDocumentFragment();
  for (const channel of recentChannels(state?.channels || [], own()?.channelId, recent)) {
    const row = node('li'); const button = node('button', channel.name);
    button.setAttribute('aria-current', String(channel.id === own()?.channelId)); button.setAttribute('aria-label', `Preview channel ${channel.name}`);
    button.append(node('span', String(state.participants.filter(client => client.channelId === channel.id).length).padStart(2, '0'), 'room-number'));
    button.addEventListener('click', () => { selected = channel.id; void navigate('channels'); }); row.append(button); fragment.append(row);
  }
  if (!fragment.childNodes.length) fragment.append(node('li', 'Connect to find your rooms.', 'hint'));
  $('room-tabs').replaceChildren(fragment);
}
function renderBrowser() {
  const fragment = document.createDocumentFragment(); const query = $('channel-search').value; let count = 0;
  for (const { channel, depth } of orderChannels(state?.channels || [])) {
    if (!matchesChannel(channel, state.channels, state.participants, query)) continue;
    count++; const row = node('li'); row.dataset.channel = String(channel.id); row.dataset.depth = String(Math.min(depth, 4));
    const button = node('button', undefined, 'channel-result'); button.setAttribute('aria-label', `Preview ${channel.name}`); button.setAttribute('aria-pressed', String(selected === channel.id));
    const text = node('div'); text.append(node('strong', channel.name), node('span', channelPath(channel, state.channels) || 'Top-level channel', 'hint'));
    const people = state.participants.filter(person => person.channelId === channel.id);
    const matching = query.trim() ? people.filter(person => person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(person => person.name).join(', ') : '';
    if (matching) text.append(node('span', `People: ${matching}`, 'hint'));
    button.append(text, node('span', `${people.length} ${people.length === 1 ? 'person' : 'people'}${channel.passwordProtected ? ' · Password' : ''}${channel.id === own()?.channelId ? ' · You’re here' : ''}`, 'hint'));
    button.addEventListener('click', () => { selected = channel.id; $('join-password').value = ''; $('join-status').textContent = ''; renderBrowser(); if (matchMedia('(max-width: 660px)').matches) $('channel-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); row.append(button); fragment.append(row);
  }
  const focus = document.activeElement?.closest('[data-channel]')?.dataset.channel; const scroll = $('ts3-channels').scrollTop;
  $('ts3-channels').replaceChildren(fragment); $('ts3-channels').scrollTop = scroll;
  if (focus) $('ts3-channels').querySelector(`[data-channel="${focus}"] button`)?.focus({ preventScroll: true });
  $('channel-count').textContent = `${count} / ${state?.channels.length || 0}`; $('tree-empty').hidden = Boolean(state?.channels.length); $('search-empty').hidden = !state || count > 0;
  const channel = state?.channels.find(channel => channel.id === selected);
  $('browse-channel-name').textContent = channel?.name || 'Choose a channel'; $('browse-channel-topic').textContent = channel?.topic || '';
  $('browse-channel-meta').textContent = channel ? `${channelPath(channel, state.channels) || 'Top-level channel'}${channel.passwordProtected ? ' / Password required' : ''}${!connected ? ' / Last received state' : ''}` : 'Select a room to preview its participants.';
  const people = document.createDocumentFragment();
  for (const person of state?.participants.filter(person => person.channelId === selected) || []) { const item = node('li', person.name); if (person.id !== state.ownClientId) { const message = node('button', 'Message', 'quiet'); message.disabled = !connected; message.addEventListener('click', () => openPrivate(person)); item.append(message); } people.append(item); }
  $('browse-participants').replaceChildren(people);
  $('join-form').hidden = !channel || channel.id === own()?.channelId; $('browse-return').hidden = !channel || channel.id !== own()?.channelId;
  $('join-password').hidden = !channel?.passwordProtected; $('join-password-label').hidden = !channel?.passwordProtected; $('join-password').required = Boolean(channel?.passwordProtected);
  $('join-submit').disabled = !connected; $('join-name').textContent = channel?.name || '';
}
function renderThreads() {
  const fragment = document.createDocumentFragment();
  const totalUnread = [...unread.values()].reduce((sum, count) => sum + count, 0); $('messages-nav').textContent = totalUnread ? `Messages (${totalUnread})` : 'Messages';
  const peers = state?.participants.filter(person => person.id !== state.ownClientId) || [];
  for (const person of peers) { const key = person.uid || String(person.id); if (!threads.has(key)) threads.set(key, person); }
  for (const [key, person] of threads) {
    const current = peers.find(peer => (peer.uid || String(peer.id)) === key);
    const button = node('button', undefined, 'thread'); button.append(node('strong', person.name), node('span', `${unread.get(key) ? `${unread.get(key)} unread · ` : ''}${current && connected ? 'Available · This session' : 'Disconnected · This session'}`, 'hint'));
    button.setAttribute('aria-pressed', String(Boolean(current && privatePeer === current.id))); button.disabled = !current || !connected;
    button.addEventListener('click', () => openPrivate(current)); fragment.append(button);
  }
  if (!fragment.childNodes.length) fragment.append(node('p', 'Connected participants will appear here.', 'hint'));
  $('conversation-threads').replaceChildren(fragment);
  const peer = state?.participants.find(person => person.id === privatePeer && (!privatePeerUid || person.uid === privatePeerUid));
  $('direct-name').textContent = peer?.name || 'Choose someone'; $('direct-status').textContent = peer ? state.channels.find(channel => channel.id === peer.channelId)?.name || 'Connected participant' : 'Choose a participant to start a private conversation.';
  $('direct-volume').disabled = !peer || !connected; $('direct-poke').disabled = !peer || !connected;
  $('direct-volume').value = String(Math.round(getParticipantVolume(peer?.id) * 100)); $('direct-volume-value').textContent = `${$('direct-volume').value}% / Range 0–200%`;
  if (page === 'conversation' && scope() !== 'private') { $('message-input').disabled = true; $('message-send').disabled = true; $('chat-context').textContent = 'Choose a participant to open a private conversation.'; }
}
$('direct-volume').addEventListener('input', () => { if (privatePeer) { setParticipantVolume(privatePeer, Number($('direct-volume').value) / 100); $('direct-volume-value').textContent = `${$('direct-volume').value}% / Range 0–200%`; } });
$('ribbon-mute').addEventListener('click', () => { if ($('voice-mic').getAttribute('aria-pressed') === 'true') $('voice-mic').click(); });
$('direct-poke').addEventListener('click', () => $('poke-open').click());
for (const button of document.querySelectorAll('[data-return-scope]')) button.addEventListener('click', () => { $('chat-scope').value = button.dataset.returnScope; renderMessages(); void navigate('console'); });
$('private-chat').addEventListener('click', () => { void navigate('conversation'); });
$('channel-search').addEventListener('input', renderBrowser);
$('join-selected').addEventListener('click', () => { selected = own()?.channelId; void navigate('channels'); });
$('join-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = selected; let password = $('join-password').value; $('join-password').value = ''; $('join-submit').disabled = true;
  try { await joinChannel(id, password); $('join-status').textContent = ''; await navigate('console'); }
  catch (error) { $('join-status').textContent = error.message; }
  finally { password = ''; $('join-submit').disabled = !connected; }
});
$('quick-connect').addEventListener('click', () => void navigate('connections'));
$('connection-add').addEventListener('click', () => void editConnection());
$('connection-form').addEventListener('input', () => { editorDirty = true; });
async function saveEditor(connect) {
  if (!$('connection-form').reportValidity() || preferenceBusy) return;
  if (connect && ($('ts3-connect').disabled || connectionActive)) { $('editor-status').textContent = 'Set up your identity and disconnect any active server before connecting.'; return; }
  const epoch = workspaceEpoch; const id = selectedBookmark || crypto.randomUUID();
  const connectionPasswords = {}; if ($('ts3-password').value) connectionPasswords.password = $('ts3-password').value; if ($('ts3-channel-password').value) connectionPasswords.channelPassword = $('ts3-channel-password').value; if ($('bookmark-clear-passwords').checked) { connectionPasswords.password = ''; connectionPasswords.channelPassword = ''; }
  const bookmark = { id, name: $('bookmark-name').value.trim(), host: $('ts3-host').value.trim(), port: Number($('ts3-port').value), nickname: $('ts3-nickname').value.trim(), channelId: $('ts3-channel').value ? Number($('ts3-channel').value) : null };
  if ($('bookmark-passwords').checked) { if ($('ts3-password').value) bookmark.password = $('ts3-password').value; if ($('ts3-channel-password').value) bookmark.channelPassword = $('ts3-channel-password').value; }
  if ($('bookmark-clear-passwords').checked) { bookmark.password = ''; bookmark.channelPassword = ''; }
  $('editor-status').textContent = 'Saving your destination…'; $('editor-connect').disabled = true;
  try {
    const result = await savePreferences({ ...preferences, nickname: bookmark.nickname, theme, bookmarks: [...preferences.bookmarks.filter(item => item.id !== id), bookmark] });
    if (!result || epoch !== workspaceEpoch) return; editorDirty = false; selectedBookmark = id; clearEditorSecrets();
    $('editor-status').textContent = 'Connection saved.';
    if (connect) await startConnection(preferences.bookmarks.find(item => item.id === id), connectionPasswords); else await navigate('connections');
  } catch (error) { if (epoch === workspaceEpoch) $('editor-status').textContent = error.message; }
  finally { connectionPasswords.password = ''; connectionPasswords.channelPassword = ''; bookmark.password = ''; bookmark.channelPassword = ''; if (epoch === workspaceEpoch) $('editor-connect').disabled = $('ts3-connect').disabled; }
}
$('connection-form').addEventListener('submit', event => { event.preventDefault(); void saveEditor(true); });
$('bookmark-save').addEventListener('click', () => void saveEditor(false));
$('bookmark-delete').addEventListener('click', async () => {
  if (!selectedBookmark || !preferences || preferenceBusy) return;
  const id = selectedBookmark;
  if (!await confirmAction('Delete this saved connection?', 'This removes only the saved destination. Your account and TeamSpeak identity are kept.', 'Delete connection')) return;
  try { const result = await savePreferences({ ...preferences, bookmarks: preferences.bookmarks.filter(item => item.id !== id) }); if (!result) return; editorDirty = false; await navigate('connections'); }
  catch (error) { $('editor-status').textContent = error.message; }
});
$('mixer-layout').addEventListener('click', () => { const compact = $('mixer-layout').getAttribute('aria-pressed') !== 'true'; $('mixer-layout').setAttribute('aria-pressed', String(compact)); $('mixer-layout').textContent = compact ? 'Mixer view' : 'Compact view'; $('member-list').classList.toggle('compact-members', compact); });
function syncAudioModes() { for (const button of document.querySelectorAll('[data-audio-mode]')) button.setAttribute('aria-pressed', String(button.dataset.audioMode === $('voice-mode').value)); }
for (const button of document.querySelectorAll('[data-audio-mode]')) button.addEventListener('click', () => { $('voice-mode').value = button.dataset.audioMode; $('voice-mode').dispatchEvent(new Event('change')); });
$('voice-mode').addEventListener('change', syncAudioModes); syncAudioModes();
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
$('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('message-send').disabled) $('message-form').requestSubmit(); } });
$('theme-toggle').addEventListener('click', async () => { theme = themes[(themes.indexOf(theme) + 1) % themes.length]; applyTheme(); if (preferences) try { await savePreferences({ ...preferences, theme }); } catch (error) { $('notice').textContent = error.message; } });
window.addEventListener('voxharbor-speaking', ({ detail }) => { activeSpeakers = new Set(detail); for (const card of $('member-list').querySelectorAll('[data-member]')) { const active = activeSpeakers.has(Number(card.dataset.member)); card.classList.toggle('speaking', active); const status = card.querySelector('[data-base-status]'); if (status) status.textContent = active ? 'Speaking' : status.dataset.baseStatus; } });
window.addEventListener('voxharbor-state', ({ detail }) => {
  state = detail; const current = own()?.channelId;
  if (previousOwnChannel && previousOwnChannel !== current && scope() === 'channel') { $('message-input').value = ''; $('message-status').textContent = 'Channel changed. The previous draft was cleared.'; }
  if (previousOwnChannel !== current) recent = [current, ...recent].filter(Boolean).slice(0, 4);
  if (!selected || !state.channels.some(channel => channel.id === selected)) selected = current;
  previousOwnChannel = current; if (document.activeElement !== $('profile-nickname')) $('profile-nickname').value = own()?.name || '';
  $('away-toggle').textContent = own()?.awayMessage !== null && own()?.awayMessage !== undefined ? 'Return from away' : 'Set away';
  $('server-name').textContent = state.server.name; renderChannel(); renderBrowser(); renderMessages();
});
window.addEventListener('voxharbor-connection', ({ detail }) => {
  connected = detail.state === 'connected'; connectionActive = ['connected', 'connecting', 'retrying', 'offline'].includes(detail.state);
  $('lab').dataset.connection = detail.state;
  $('connection-badge').textContent = ({connected:'Connected',connecting:'Connecting',retrying:'Reconnecting',stopped:'Offline',offline:'Network offline',failed:'Connection failed',expired:'Signed out'})[detail.state] || detail.state;
  $('connection-badge').dataset.state = detail.state; $('ribbon-status').textContent = $('connection-badge').textContent;
  $('session-ribbon').hidden = !connectionActive || page === 'console'; $('nickname-update').disabled = !connected; $('away-toggle').disabled = !connected;
  if (!connected) { privatePeer = undefined; privatePeerUid = undefined; $('chat-scope').querySelector('option[value="private"]')?.remove(); if (scope() === 'private') $('chat-scope').value = 'channel'; $('message-input').value = ''; }
  if (detail.state === 'stopped') { messages.length = 0; drafts.clear(); draftKey = undefined; threads.clear(); unread.clear(); }
  if (['stopped','failed','expired'].includes(detail.state)) { state = undefined; selected = undefined; recent = []; emptyRoom(); $('selected-channel-name').textContent = 'Your place to talk.'; $('channel-context').textContent = 'READY WHEN YOU ARE'; $('subscription-toggle').hidden = true; }
  renderBookmarks(); renderChannel(); renderBrowser(); renderMessages();
});
window.addEventListener('voxharbor-message', ({ detail }) => {
  if ((detail.target === 'private' || detail.target === 'poke') && detail.clientId !== state?.ownClientId && !(page === 'conversation' && privatePeer === detail.clientId)) { const key = detail.uid || String(detail.clientId); unread.set(key, (unread.get(key) || 0) + 1); }
  const outgoing = detail.clientId === state?.ownClientId; const peerId = outgoing ? detail.targetClientId : detail.clientId;
  const peerUid = (outgoing ? detail.targetUid : detail.uid) || state?.participants.find(client => client.id === peerId)?.uid;
  appendMessage({ ...detail, peerId, peerUid, at: Date.now(), outgoing });
  if ((detail.target === 'private' || detail.target === 'poke') && scope() !== 'private') $('message-status').textContent = `New ${detail.target === 'poke' ? 'poke' : 'private message'} from ${detail.name}. Open Private to read it.`;
});
window.addEventListener('voxharbor-reset', () => { state = undefined; connected = false; connectionActive = false; selected = undefined; recent = []; privatePeer = undefined; privatePeerUid = undefined; previousOwnChannel = undefined; messages.length = 0; drafts.clear(); draftKey = undefined; threads.clear(); unread.clear(); sending = false; $('messages').replaceChildren(); $('message-input').value = ''; $('message-status').textContent = ''; $('channel-search').value = ''; $('away-message').value = ''; $('profile-status').textContent = ''; $('poke-message').value = ''; $('server-name').textContent = 'Your destinations'; $('session-ribbon').hidden = true; emptyRoom(); renderRooms(); renderBrowser(); renderMessages(); syncAudioModes(); for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
applyTheme();

const phoneLayout = matchMedia('(max-width: 660px)');
function layoutEditorActions() { const target = phoneLayout.matches ? $('editor-mobile-actions') : $('editor-primary'); for (const element of [document.querySelector('.editor-actions'), $('editor-status'), $('native-status')]) target.append(element); }
phoneLayout.addEventListener('change', layoutEditorActions); layoutEditorActions();
$('direct-tools-toggle').addEventListener('click', () => { const expanded = $('direct-tools-toggle').getAttribute('aria-expanded') !== 'true'; $('direct-tools-toggle').setAttribute('aria-expanded', String(expanded)); $('direct-grid').classList.toggle('show-direct-controls', expanded); });
