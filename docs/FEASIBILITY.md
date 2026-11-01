# Feasibility and verification scope

A private owner-operated Vercel deployment demonstrated the following before the public-source cleanup. Raw account screenshots, private deployment URLs/IDs, destination details, UIDs and session evidence are kept outside the public source.

| Area | Observed result | Limits |
| --- | --- | --- |
| Binary WebSocket / outbound UDP | Bidirectional binary transport and validated non-DNS STUN responses | Historical transport experiments; their product endpoints were removed during cleanup |
| Native runtime | Linux x64 Node 22 deployment build and native execution; local macOS build | Re-verify your account/runtime; no universal hosting claim |
| Full TS3 session | Real handshake, authentication, channel and participant synchronization | Existing unmodified authorized TS3 server; newer server features are separate |
| Identity and settings | Same encrypted identity across sign-ins/redeployments; durable encrypted preferences | Production restore/key-rotation drills are not certified |
| Opus | Browser/native peer exchanged generated audio through the real server; nonzero decode/playback energy | No microphone permission requested; local hardware output stayed silent; real capture/browser audibility unverified |
| Recovery | Recovered after the 240-second native cap and deliberate socket loss; identity unchanged and audio off | Roughly 8.5 seconds at cap and 41 seconds after the dropped socket in one final run, including lease expiry; no actual process-kill/server-restart attribution |
| Permissions | Server denied private messages for the test identities | No successful live messaging pass; permissions were preserved |
| Browser rendering | Literal markup-like names/text in an isolated local simulated fixture | Simulation is UI integration evidence, not real messaging interoperability |

The subsequent public-source cleanup replaces environment-based connection defaults and browser-held reconnect credentials with encrypted backend settings and an opaque settings reference. It also removes the superseded echo/STUN product experiments and production test-tone controls. Its current test results are described in [testing](TESTING.md); changes validated locally are not automatically a new production verification pass.

The architecture uses an owner-controlled native Function adapter, not ServerQuery, a vendor gateway, a VPS or a desktop companion. No hard platform prohibition was proven in the tested configuration. Finite Function lifetime still interrupts audio. Local source now supports restoring listening and opt-in microphone recovery; deployment and real-device verification of that change are separate. Comprehensive official-client parity, hardware/browser certification and uninterrupted conversation remain unfinished. See the [feature matrix](FEATURE_MATRIX.md).

Relevant primary platform references: [WebSocket Functions](https://vercel.com/docs/functions/websockets), [Function limitations](https://vercel.com/docs/functions/limitations). Check current documentation and actual account behavior before deploying; historical observations do not override platform changes.

The subsequent multi-user milestone adds registration, account-bound sessions, per-user encrypted records and independent protocol leases. Local tests include separate real native identity generation/export and simultaneous simulated protocol sessions. A production deployment on 2026-11-01 passed two-account registration, distinct native identity creation, connection/bookmark isolation, authenticated WebSocket heartbeat and independent logout/persistence checks, with legacy owner continuity preserved. Real multi-user voice/capacity remains unverified. See [accounts and rollout](MULTIUSER.md).
