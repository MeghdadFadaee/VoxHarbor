import { safeDiagnostic } from './connection-diagnostics.mjs';
import { loadProtocol, resetProtocol } from './protocol.mjs';
import { loadWorkspace, resetWorkspace } from './workspace.mjs';
const $ = id => document.getElementById(id);
let csrf;
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  const target = $('lab').hidden ? $('username') : document.querySelector('section[data-page]:not(#lab):not([hidden])');
  if (!target) return; if (target.tagName === 'SECTION') target.setAttribute('tabindex', '-1'); target.focus(); target.scrollIntoView({ block: 'start' });
});
let registering = false; let registrationEnabled = false; let ownerAvailable = false; let authBusy = false;
const authChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('voxharbor-auth') : null;
authChannel?.addEventListener('message', () => { locked(); $('notice').textContent = 'Sign-in changed in another tab. Sign in to continue.'; });
$('notice-dismiss').addEventListener('click', () => { $('notice').textContent = ''; });
new MutationObserver(() => { $('notice-toast').hidden = !$('notice').textContent; }).observe($('notice'), { childList: true, characterData: true, subtree: true });
function authMode() {
  $('welcome').dataset.authMode = registering ? 'register' : 'login'; $('auth-route').textContent = registering ? 'ACCOUNT / CREATE ACCOUNT' : 'ACCOUNT / SIGN IN';
  $('auth-title').textContent = registering ? 'Your own place on the dial.' : 'Welcome back.'; $('auth-eyebrow').textContent = registering ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  $('auth-toggle').textContent = registering ? 'Already registered? Sign in' : 'Create an account';
  $('auth-toggle').hidden = !registrationEnabled;
  $('confirm-field').hidden = !registering; $('confirm-password').required = registering;
  $('password').autocomplete = registering ? 'new-password' : 'current-password';
  $('password').minLength = registering ? 16 : 0;
  $('auth-hint').textContent = registering ? 'Use 16–256 characters for your password. Keep it safe; password recovery is not available yet.' : 'Your identity and saved connections belong to your account.';
}
$('auth-toggle').addEventListener('click', () => { if (authBusy) return; registering = !registering; $('password').value = ''; $('confirm-password').value = ''; $('auth-status').textContent = ''; $('notice').textContent = ''; authMode(); });
async function loadAuth() {
  try { const options = await api('/api/auth'); registrationEnabled = options.registrationEnabled; ownerAvailable = options.ownerAvailable; authMode(); $('auth-submit').disabled = false; }
  catch { $('auth-status').textContent = 'Sign-in is unavailable. Reload to try again.'; }
}
let sessionGeneration = 0;
const evidence = { schema: 'voxharbor-diagnostics-v1', startedAt: new Date().toISOString(), events: [] };
function record(type, data) {
  evidence.events.push({ at: new Date().toISOString(), type, data });
  if (evidence.events.length > 1000) evidence.events.shift();
  $('events').textContent = JSON.stringify(evidence.events.slice(-30), null, 2);
}
window.addEventListener('voxharbor-protocol-diagnostic', event => record('protocol', safeDiagnostic(event.detail)));
for (const type of ['online', 'offline']) window.addEventListener(type, () => record('browser', { state: type }));
document.addEventListener('visibilitychange', () => record('browser', { state: document.hidden ? 'hidden' : 'visible' }));
async function api(path, body) {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(15000), method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  return data;
}
function locked() {
  ++sessionGeneration; registering = false; authMode(); $('auth-status').textContent = ''; $('password').value = ''; $('confirm-password').value = '';
  resetProtocol(); resetWorkspace(); csrf = undefined; $('account-label').textContent = 'Your account'; $('account-label').setAttribute('aria-label', 'Account settings'); $('own-initials').textContent = '—';
  evidence.events.length = 0; $('events').textContent = 'No connection diagnostics recorded.';
  $('login').hidden = false; $('lab').hidden = true; $('welcome').hidden = false;
  window.scrollTo(0, 0);
}
window.addEventListener('voxharbor-owner-expired', () => {
  locked(); $('notice').textContent = 'Your session expired or was signed out. Sign in to reconnect.';
});
async function loadSession() {
  const generation = sessionGeneration;
  const data = await api('/api/session');
  if (generation !== sessionGeneration) return;
  csrf = data.csrf; $('account-label').textContent = data.user.username; $('account-label').setAttribute('aria-label', `Account settings for ${data.user.username}`); $('own-initials').textContent = [...data.user.username].slice(0, 2).join('').toUpperCase(); $('profile-account-name').textContent = data.user.username;
  $('login').hidden = true; $('lab').hidden = false; $('welcome').hidden = true;
  $('runtime').textContent = `${data.runtime.environment} · ${data.runtime.node} · ${data.runtime.sessionStore}`;
  record('runtime', { node: data.runtime.node, platform: data.runtime.platform, arch: data.runtime.arch, sessionStore: data.runtime.sessionStore });
  void loadProtocol(csrf); void loadWorkspace(csrf);
}
$('login').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy) return;
  if (registering && $('password').value !== $('confirm-password').value) { $('auth-status').textContent = 'Passwords do not match.'; return; }
  const button = $('auth-submit'); authBusy = true; button.disabled = true; $('auth-toggle').disabled = true; $('auth-status').textContent = '';
  try {
    await api(registering ? '/api/register' : '/api/login', { username: $('username').value, password: $('password').value }); $('password').value = ''; $('confirm-password').value = '';
    locked(); authChannel?.postMessage('changed'); await loadSession(); window.scrollTo(0, 0); $('notice').textContent = '';
  } catch (error) { $('auth-status').textContent = error.message; }
  finally { $('password').value = ''; $('confirm-password').value = ''; authBusy = false; button.disabled = false; $('auth-toggle').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  resetProtocol();
  try { await api('/api/logout', {}); locked(); authChannel?.postMessage('changed'); $('notice').textContent = 'Signed out. Session revoked.'; }
  catch { locked(); $('notice').textContent = 'Connection stopped. Server sign-out could not be confirmed; retry when storage is available.'; }
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'voxharbor-diagnostics.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void loadAuth();
loadSession().catch(() => locked());
