# Feature matrix

Statuses distinguish implemented code, observed private-deployment results and pending verification. The public-source cleanup changes connection storage and removes old experiment endpoints; it is not automatically a new production certification.

| Capability | Status / scope |
| --- | --- |
| Registration/login, account isolation, origin/CSRF, revocation | Implemented; local isolation/concurrent simulated session tests and production two-account registration/settings/identity/WebSocket/logout checks; real concurrent native voice/capacity unverified |
| Durable encrypted TS3 identity | Persistence demonstrated across sign-ins/redeployments; import/export/rotation tested locally; official-client restore drill pending |
| Backend connection settings and bookmarks | Implemented; encrypted/redacted, stale-edit and destination isolation tests; cleanup flow verified locally |
| Real TS3 connection / synchronized channels and participants | Demonstrated in a private Vercel deployment |
| Channel/participant search and previews | Implemented; browser checks with real and simulated state |
| Channel movement / subscriptions | Implemented; password-protected self-movement verified; server permissions apply |
| Nickname and away/return | Implemented; previous production server acknowledgements verified |
| Opus send/receive | Generated two-way network audio demonstrated; actual microphone/audible browser conversation unverified |
| PTT, VAD, microphone/output mute, per-user volume | Implemented with codec/worker/lifecycle tests; comprehensive live device verification pending |
| Speaking indicators and bounded queues | Implemented; worker tests and browser integration checks; broader live multi-speaker testing pending |
| Private/channel/server text, poke | Typed acknowledged controls implemented; private live test was server-denied; successful real messaging/poke interoperability remains unverified |
| Responsive workspace and themes | Implemented; partial in-app Chromium narrow/desktop checks; comprehensive accessibility/mobile/browser testing pending |
| Automatic recovery | Native-cap/socket-drop recovery demonstrated; identity retained and audio muted; actual Function kill/server restart unverified |
| Durable connection history / quality metrics | Planned; worker loss counters are not a full TS3 quality dashboard |
| Whisper / advanced routing / concurrent servers | Planned |
| Channel management / moderation / groups / permissions | Planned |
| File browsing/transfer/management | Planned |
| Rich profiles, icons, avatars, badges | Planned |
| Video, screen sharing, newer protocols / proprietary accounts | Separate investigation; no compatibility claim |

A custom client grants no additional server privileges. No control is represented as verified merely because it builds or passes a simulated fixture. The [implementation plan](../IMPLEMENTATION_PLAN.md) remains unfinished.
