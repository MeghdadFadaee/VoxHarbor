# Testing

Run `npm ci`, `npm run native:build`, `npm run check` and `npm test`. Automated tests use synthetic credentials, temporary directories, local sockets and simulated native fixtures; they do not contact public TeamSpeak servers. Native identity endpoint tests require the built executable. Mock fixtures are not real server compatibility evidence.

`npm run audio:qa` starts a local silent AudioWorklet/Opus test with deliberately missing packets. It requests no microphone, sends no audio to a server and emits silence to local hardware. Close it after testing.

`node scripts/workspace-render-fixture.mjs` starts a clearly labelled local simulated workspace. Sign in as `owner`; its fixture-only password is in that source. It uses an ephemeral synthetic identity payload, no real TS3 network, and volatile storage. Test message/name markup remains literal text. Enter `quit` to remove its temporary executable and stop it. It is forbidden in production.

For an authorized deployment, configure the connection through its owner UI first. These optional scripts require an explicit HTTPS origin and hidden owner password:

```sh
node scripts/verify-public-deployment.mjs https://your-project.vercel.app
node scripts/verify-production-protocol.mjs https://your-project.vercel.app 45 .local/protocol-result.json
node scripts/verify-recovery.mjs https://your-project.vercel.app 350 .local/recovery-result.json
```

They use the backend-saved connection, do not create/replace an identity, keep audio muted and revoke their own verification sessions. Results may contain private instance metadata: keep them under `.local`, not in a public issue or commit. Do not run concurrent native verification sessions against the same owner lease.

Real voice testing needs another authorized client and a suitable channel whose participants expect testing. Record outcomes/counters, not audio/chat contents. Verify microphone permission, audible receive/send, mute/deafen, denied talk power, devices, multiple speakers, background behavior and reconnects separately. Never infer hardware/browser compatibility from codec tests.

The current cleanup is tested locally; it has not been redeployed automatically. Previous production observations are summarized without private account/destination data in [FEASIBILITY.md](FEASIBILITY.md).

## Public-source cleanup verification

On 2026-10-31, JavaScript syntax checks and all 80 automated tests passed, with no skips. The macOS native release build passed. A disposable simulated workspace verified saving and reloading connection metadata while password inputs remained empty and backend-saved password indicators persisted; browser error logs were empty. The silent browser audio test passed with three simulated speakers, nonzero decoded/playback energy, deliberate packet loss handling and stopped transmission after PTT release. These are local checks, not a deployment or real microphone test.

Account tests cover atomic case-insensitive registration, reserved-owner compatibility, password hashing, session/account binding, ciphertext substitution rejection, independent identity/settings/bookmark/lease/rate scopes, HTTP origin/CSRF, cross-account connection IDs, simultaneous simulated native sessions and independent logout. These do not establish multi-user production capacity.

## Multi-user milestone verification

On 2026-11-01, syntax checks and all 90 automated tests passed, with no skips. New registered accounts generated different real native identities; exports restored to the correct account UID. Browser verification in a disposable volatile fixture confirmed registration, separate identities/bookmarks/default nicknames, restoration after sign-in and cross-tab logout cleanup, with no browser errors. No private environment, existing Redis or actual TeamSpeak server was used in these account tests.

## Production account rollout

On 2026-11-01, the Linux native release build and public HTTP/WebSocket access gates passed after deployment. Two new test accounts registered, generated distinct native identities, retained isolated connections/bookmarks/nicknames, rejected a cross-account connection reference, used authenticated WebSockets, logged out independently and retained identity/settings after signing in again. The legacy owner UID and saved preference digest matched a private baseline from before deployment. Reports and encrypted test-account credentials remain private under `.local`. These checks made no TeamSpeak server connections and transmitted no audio; real multi-user voice and capacity remain unverified.

## Audio recovery and connection diagnostics

The local suite now has 96 passing tests. Recovery tests cover listening/device restoration, microphone opt-in and opt-out, repeated disconnect notifications, muted/background state, cancellation during initialization, automatic-resume failures and diagnostics redaction. Transport fixtures distinguish the native session cap, heartbeat timeout, socket close duration and retry timing. A disposable browser fixture verified the recovery checkbox and sign-out reset without microphone access or TeamSpeak traffic. These are automated and UI checks, not a real microphone recovery pass.

The audio-recovery update was deployed on 2026-11-01. All six changed browser entry/module assets matched the tested source on the public domain, and public authentication/origin/WebSocket gates passed. Actual microphone recovery remains unverified.
