// Reconnects carry only a saved-settings ID; credentials stay on the backend.
const retryable = new Set(['connection_failed', 'handshake_timeout', 'server_initialization_timeout', 'protocol_network_error', 'native_protocol_failed', 'session_lease_lost', 'another_session_is_active', 'connection_rate_limit', 'owner_transport_timeout']);
const advisory = new Set(['server_permission_or_command_error', 'subscription_unavailable', 'connection_settings_not_saved']);

export class ProtocolConnection {
  constructor({ url, session, socket = address => new WebSocket(address), phase = () => {}, event = () => {}, disconnected = () => {}, expired = () => {}, diagnostic = () => {},
    now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = timer => clearTimeout(timer), random = Math.random }) {
    Object.assign(this, { url, session, createSocket: socket, phase, event, disconnected, expired, diagnostic, now, later, cancel, random });
    this.timers = new Set(); this.epoch = 0; this.desired = false; this.connected = false;
    this.lastAttempt = -Infinity; this.failures = 0;
  }
  timer(fn, delay) {
    const id = this.later(() => { this.timers.delete(id); fn(); }, delay);
    this.timers.add(id); return id;
  }
  clearTimers() { for (const id of this.timers) this.cancel(id); this.timers.clear(); }
  start(options) {
    this.stop();
    this.options = { connectionId: options.connectionId };
    this.desired = true; this.paused = false; this.failures = 0; this.lastAttempt = -Infinity;
    void this.attempt();
  }
  stop(reason = 'Owner stopped connection') {
    this.desired = false; this.paused = false; this.options = undefined; this.connected = false;
    ++this.epoch; this.clearTimers();
    this.authAbort?.abort(); this.authAbort = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket?.readyState === 1) {
      try { socket.send(JSON.stringify({ type: 'disconnect', csrf: this.csrf })); } catch {}
    }
    try { socket?.close(1000, reason); } catch {}
    this.csrf = undefined; this.disconnected(); this.phase({ state: 'stopped' });
  }
  send(command) {
    if (!this.connected || this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify({ ...command, csrf: this.csrf })); return true; } catch { return false; }
  }
  voice(frame) {
    if (!this.connected || this.socket?.readyState !== 1 || this.socket.bufferedAmount > 4096) return false;
    try { this.socket.send(frame); return true; } catch { return false; }
  }
  offline() {
    if (!this.desired) return;
    this.clearTimers(); ++this.epoch;
    this.authAbort?.abort(); this.authAbort = undefined;
    const socket = this.socket; this.socket = undefined;
    try { socket?.close(4000, 'Network offline'); } catch {}
    this.connected = false; this.disconnected(); this.phase({ state: 'offline' });
    this.paused = true;
  }
  online() {
    if (!this.desired || !this.paused) return;
    this.paused = false; this.schedule();
  }
  schedule(code) {
    if (!this.desired || this.paused) return;
    if (this.failures >= 5) { this.stop(); this.phase({ state: 'failed', code: code || 'recovery_limit' }); return; }
    // At most five new handshakes per minute, below the server's six-per-minute gate.
    const delay = Math.max(12000 - (this.now() - this.lastAttempt), Math.min(30000, 1000 * 2 ** this.failures) + Math.floor(this.random() * 500),
      code === 'another_session_is_active' ? 36000 : 0, code === 'connection_rate_limit' ? 61000 : 0);
    this.diagnostic({ type: 'retry', attempt: this.failures, delay, ...(code ? { code } : {}) });
    this.phase({ state: 'retrying', delay, code });
    this.timer(() => { void this.attempt(); }, delay);
  }
  async attempt() {
    if (!this.desired || this.paused) return;
    this.clearTimers(); const epoch = ++this.epoch;
    this.connected = false; this.disconnected(); this.lastAttempt = this.now();
    this.diagnostic({ type: 'attempt', attempt: this.failures + 1 });
    this.phase({ state: 'connecting' });
    let auth; let authTimer;
    const controller = new AbortController(); this.authAbort = controller;
    try { auth = await Promise.race([this.session({ signal: controller.signal }), new Promise((_, reject) => {
      authTimer = this.timer(() => { controller.abort(); reject(new Error('Session check timed out')); }, 15000);
    })]); }
    catch (error) {
      if (epoch !== this.epoch || !this.desired) return;
      if ([401, 403].includes(error.status)) { this.stop(); this.phase({ state: 'expired' }); this.expired(); return; }
      this.failures++; this.schedule('session_unavailable'); return;
    }
    finally {
      this.cancel(authTimer); this.timers.delete(authTimer);
      if (this.authAbort === controller) this.authAbort = undefined;
    }
    if (epoch !== this.epoch || !this.desired || this.paused) return;
    this.csrf = auth.csrf;
    let socket;
    try { socket = this.createSocket(this.url); } catch { this.failures++; this.schedule('transport_unavailable'); return; }
    this.socket = socket; socket.binaryType = 'arraybuffer';
    const openedAt = this.now();
    let lastMessageAt = openedAt; let timeoutKind = 'handshake';
    let fault; let healthySince; let receivedState = false; let pong; let nonce = 0; let ended = false;
    const current = () => epoch === this.epoch && this.desired && !ended;
    const finish = (code = 1006) => {
      if (!current()) return;
      this.diagnostic({ type: 'transport_closed', closeCode: code, durationMs: this.now() - openedAt, lastMessageAgeMs: this.now() - lastMessageAt, receivedState, ...(fault ? { code: fault } : {}) });
      ended = true; this.clearTimers(); this.socket = undefined;
      this.connected = false; this.disconnected();
      if ([4401, 4403].includes(code)) { this.stop(); this.phase({ state: 'expired' }); this.expired(); return; }
      if ((fault && !retryable.has(fault)) || [1003, 1008].includes(code)) { this.stop(); this.phase({ state: 'failed', code: fault || 'transport_rejected' }); return; }
      if (receivedState && healthySince !== undefined && this.now() - healthySince >= 30000) this.failures = 0;
      else this.failures++;
      this.schedule(fault);
    };
    const abandon = () => {
      if (!current()) return;
      this.diagnostic({ type: 'timeout', stage: timeoutKind, lastMessageAgeMs: this.now() - lastMessageAt });
      try { socket.close(4000, 'Protocol response timeout'); } catch {}
      // A dead TCP transport can remain CLOSING. Do not wait indefinitely for close.
      finish();
    };
    let handshake = this.timer(abandon, 45000);
    const heartbeat = () => {
      if (!current() || socket.readyState !== 1) return;
      if (pong && this.now() - pong.at >= 15000) { timeoutKind = 'heartbeat'; abandon(); return; }
      if (!pong) {
        pong = { nonce: nonce++ % 0x100000000, at: this.now() };
        try { socket.send(JSON.stringify({ type: 'ping', csrf: this.csrf, nonce: pong.nonce })); } catch { abandon(); return; }
      }
      this.timer(heartbeat, 10000);
    };
    socket.addEventListener('open', () => {
      if (!current()) { try { socket.close(1000, 'Connection canceled'); } catch {} return; }
      try { socket.send(JSON.stringify({ type: 'connect', csrf: this.csrf, heartbeat: true, ...this.options })); } catch { abandon(); return; }
      this.timer(heartbeat, 10000);
    });
    socket.addEventListener('message', ({ data }) => {
      if (!current()) return;
      lastMessageAt = this.now();
      if (data instanceof ArrayBuffer) { if (this.connected) this.event(data); return; }
      let message; try { message = JSON.parse(data); } catch { return; }
      if (message.type === 'ts3_pong') { if (pong && message.nonce === pong.nonce) { this.diagnostic({ type: 'heartbeat', roundTripMs: this.now() - pong.at }); pong = undefined; } return; }
      if (message.type === 'ts3_status') {
        this.diagnostic({ type: 'protocol_status', stage: message.status });
        this.connected = message.status === 'connected';
        if (this.connected) { healthySince = this.now(); this.phase({ state: 'connected' }); }
        else {
          this.cancel(handshake); this.timers.delete(handshake); handshake = this.timer(abandon, 45000);
          this.disconnected(); this.phase({ state: 'connecting', status: message.status });
        }
      }
      if (message.type === 'ts3_state' && this.connected) {
        receivedState = true; this.cancel(handshake); this.timers.delete(handshake);
      }
      if (message.type === 'ts3_error') this.diagnostic({ type: 'protocol_error', code: message.code });
      if (message.type === 'ts3_error' && !advisory.has(message.code) && (!fault || retryable.has(fault))) fault = message.code;
      this.event(message);
      if (fault && !retryable.has(fault)) { try { socket.close(1000, 'Protocol recovery requires owner action'); } catch {} finish(1000); }
    });
    socket.addEventListener('close', ({ code }) => finish(code));
    socket.addEventListener('error', () => { this.diagnostic({ type: 'transport_error' }); /* close/watchdog owns the single retry path */ });
  }
}
