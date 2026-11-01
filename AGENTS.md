# VoxHarbor agent guide

## Git and GitHub: strictly read-only

Use Git and GitHub only to inspect information. Leave project file changes uncommitted.

- Allowed: read status, diffs, logs, commits, branches, tags, remotes, pull requests, issues, releases, and Actions runs/checks/logs.
- Never stage, commit, push, pull, fetch, merge, rebase, reset, restore, clean, stash, switch branches, create/delete branches or tags, manage worktrees, change Git configuration, or modify Git metadata directly.
- Never create, edit, close, merge, approve, comment on, or delete GitHub resources. Never trigger, rerun, cancel, or modify GitHub workflows or deployments.
- `gh api` may perform read operations only. GraphQL queries are allowed; mutations are forbidden. HTTP POST is allowed only for a read-only GraphQL query.
- Do not bypass these restrictions through scripts, libraries, integrations, or the browser. If prohibited work is necessary, explain the manual step for the user.

A source upload to the operator's existing Vercel project is separate from GitHub operations. Perform it only within the user's deployment authorization.

## Start with the existing project

Continue the existing implementation; do not restart it, replace it with a scaffold, or overwrite unrelated work. Inspect current files and read:

1. `IMPLEMENTATION_PLAN.md` and `README.md`.
2. `docs/FEASIBILITY.md` and `docs/AUDIO.md`.
3. `docs/MANUAL_DEPLOYMENT.md` before packaging or deployment.
4. The relevant detailed documents: `docs/ARCHITECTURE.md`, `docs/MULTIUSER.md`, `docs/WORKSPACE.md`, `docs/DESIGN_IMPLEMENTATION.md`, `docs/FEATURE_MATRIX.md`, and `docs/TESTING.md`.

Use source code and current checks to establish behavior. Documentation and old deployment reports can describe historical results; do not turn them into claims that the current release was tested. Keep the implementation plan and feature matrix honest about unfinished work.

## Product and architecture

VoxHarbor is an experimental, self-hosted TeamSpeak 3 browser client with separate application accounts. Each account owns its identity, nickname, encrypted connections/bookmarks, preferences, and protocol lease. Application accounts are distinct from TeamSpeak identities and vendor accounts. One active native server session per account is supported; server permissions remain authoritative.

Application compute belongs in the operator's Vercel deployment, with durable operator-controlled Redis storage. Preserve the full-client TS3 protocol architecture. ServerQuery alone is not a voice client. Do not silently introduce a VPS, vendor gateway, desktop companion, or shared central account service.

| Location | Responsibility |
| --- | --- |
| `api/server.mjs` | Deployment entry point |
| `src/http-adapter.mjs` | HTTP routes, static asset allowlist, security headers, WebSocket upgrades |
| `src/auth/` | Accounts, password hashing, sessions, storage, authenticated user context |
| `src/identity/vault.mjs`, `src/preferences.mjs` | Encrypted identities, connections and bookmarks |
| `src/protocol/`, `src/platform/`, `src/transport/` | Typed commands/events, native sessions, leases and destination policy |
| `native/src/` | Rust full-client protocol adapter |
| `native/vendor/` | Pinned upstream sources and notices |
| `public/app.mjs` | Authentication and diagnostic export |
| `public/workspace.mjs`, `public/workspace-model.mjs` | Page navigation, destinations, channels, participants and conversations |
| `public/protocol.mjs`, `public/protocol-connection.mjs` | Browser protocol integration, commands and bounded reconnection |
| `public/voice*.mjs`, `public/audio-recovery.mjs`, `public/jitter-buffer.mjs` | Capture/playback, Opus workers/worklets and audio recovery |
| `tests/`, `scripts/` | Automated tests, synthetic fixtures, development and packaging utilities |

Use the existing vanilla HTML/CSS/browser ES module stack and Node.js 22 backend. Match nearby JavaScript conventions: `.mjs`, two-space indentation, single quotes and semicolons. Follow existing Rust conventions. Keep protocol logic separate from interface rendering. TeamSpeak channel ordering uses the preceding sibling ID; reuse `public/channel-order.mjs` instead of sorting the order field as a numeric rank. Preserve third-party licenses and record vendor patches explicitly.

## Account, storage and privacy invariants

- Derive workspace ownership from the authenticated session, never from a browser-supplied account ID. Preserve account-scoped storage keys, encryption associated data, leases and rate limits.
- Preserve the reserved legacy `owner` account and its original encrypted records. Do not migrate or replace them merely to change the interface.
- Keep HTTP/WebSocket authentication, origin validation, CSRF checks, secure cookies, destination validation and bounded inputs/queues intact.
- Connections and credentials belong on the backend. Reconnect using an opaque saved-settings ID. Never hardcode real servers, channels, nicknames, passwords, UIDs, or account data into source or product examples.
- Ordinary responses redact passwords and private identity material. Blank saved passwords preserve credentials only for the same destination; explicit clearing removes them. Distinguish current-connection recovery credentials from optional bookmark password storage.
- Preserve existing environment values, Redis data and identities. Never regenerate an identity after a storage/decryption error or rotate encryption/session secrets as routine troubleshooting.
- `.env.local`, `.local/`, identity exports, credentials, cookies, private screenshots/logs and recordings must stay outside public source and upload packages. Never print secret values or copy private evidence into documentation.
- Render server names, participant names and messages as literal text. Keep drafts separated by conversation. Preserve recipient ID/UID checks and asynchronous account/generation guards. Never automatically resend unconfirmed messages or commands.

Read `SECURITY.md`, `docs/PUBLICATION.md` and `THIRD_PARTY_NOTICES.md` when changing security, distribution or dependencies.

## UX and design requirements

Implement the supplied design's page structure, sectioning and interactions, not just its colors and typography. Follow `docs/DESIGN_IMPLEMENTATION.md` and inspect the relevant design screens before interface changes.

- Connections is the starting page after sign-in. Saved destinations need visible, direct connection and editing actions.
- Keep the complete connection form together. Save returns to the list; Save & connect saves first and opens the console. Protect unsaved edits and preserve clear password semantics.
- The console represents the actual joined room. Its recent-room strip is capped at four; never squeeze the full server hierarchy into horizontal tabs.
- The Channels page provides hierarchy, parent paths, occupancy, room/participant search and a separate preview/join flow. Previewing must not move the user or redirect channel messages.
- Private conversations, identity, audio, presence and diagnostics are separate pages. Use dialogs for short confirmations and pokes, not as the main page architecture.
- Page navigation must preserve the live connection and audio choices. Keep connection/transmission state understandable outside the console. Browser Back/Forward and Skip to content must work without unexpected navigation or data loss.
- Adapt phone workflows, not just widths: complete form before save actions, usable channel previews, bounded lists, compact participants and accessible voice controls.
- Use genuine account/server data in product flows. Keep simulated people, destinations and messages confined to clearly identified test fixtures. Do not add controls for unimplemented capabilities.

New public modules, fonts and icons require explicit routes in `src/http-adapter.mjs`. Keep its content security policy consistent with `vercel.json`; prefer local assets and retain their licenses. Verify actual page transitions and representative desktop/phone layouts in the browser.

## Audio and recovery invariants

New sessions start with listening and microphone off. Listening may resume after automatic recovery if previously enabled; microphone recovery requires explicit opt-in and a previously enabled microphone. Choices live only in the signed-in page and clear on reload/sign-out. Never restore a held push-to-talk press.

Hidden pages, device loss and sign-out stop transmission. Successful channel changes turn audio off; a denied join preserves the current channel/audio. Pending permission or initialization work must not resurrect a stopped audio instance. Preserve codec validation, per-speaker volume bounds, jitter buffering and backpressure.

The native session cap is currently 240 seconds, inside a 300-second Function limit. Periodic reconnects can therefore be intentional. Use bounded, privacy-filtered diagnostics to distinguish session caps, transport loss, heartbeat timeouts and server errors. Do not log credentials, destinations, identities, message contents or media.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked JavaScript dependencies |
| `npm run native:build` | Prepare audio assets and build the native adapter |
| `npm run dev` | Start local development using existing `.env.local` |
| `npm run check` | JavaScript syntax checks; not a formatter, type checker or full verification |
| `npm test` | Node's built-in test suite |
| `npm run audio:qa` | Separate silent browser audio fixture |
| `npm run publication:check` | Audit public-source candidates without changing Git state |
| `npm run deployment:package` | Create an audited clean deployment folder |
| `npm run publication:package` | Create an audited public-source folder; does not push |

`owner:setup` and `identity:key` are installation/bootstrap tools. Do not run them against an existing setup as ordinary development preparation. The development memory store is volatile; never treat its accounts or identities as durable production records.

Use `node:test` in `tests/*.test.mjs` with synthetic secrets, temporary files, local sockets and simulated adapters. Add meaningful coverage for changed behavior. Run syntax checks and relevant tests for code changes, native builds for native changes, and browser/audio checks when those flows change. Documentation-only edits need reference/content checks rather than an unrelated full build. Report actual results, not a remembered test count.

For UX work, verify populated and empty states, large channel lists, long/untrusted names, direct connect/edit/save flows, denied actions, private/channel draft separation, reconnection, keyboard navigation and phone layouts as applicable. Keep local fixtures separate from private production configuration.

Generated Opus exchange, simulated UI tests and a successful deployment do not certify actual microphone conversations, audible playback, browser/device compatibility, concurrent multi-user voice capacity, Function-kill recovery or server restart recovery. Treat timeouts as inconclusive. Live server/audio tests require an authorized destination and consenting participants; never broadcast test tones or record others without authorization.

## Deployment and handoff

Follow `docs/MANUAL_DEPLOYMENT.md` and `docs/DEPLOYMENT.md`:

1. Finish the authorized changes and appropriate checks.
2. Run `npm run deployment:package`; upload only its printed clean folder. Exclude private files, dependencies, Git metadata and local native binaries. Build native code for Linux on Vercel.
3. Reuse the intended existing project and preserve its private production configuration. Do not download environment values into the source package or expose authentication tokens in output.
4. Verify the production alias, current release assets, security gates and affected signed-in flows. Check identity and saved-connection continuity without recreating data. Test additional accounts when account isolation changes; do not manufacture unnecessary production test data for unrelated edits.
5. Distinguish local, simulated, deployed and real-server verification. Keep private deployment IDs, evidence and account details in excluded local records.

Respect explicit browser/tool access denials. Do not bypass them or repeat permission-reset troubleshooting loops. Use authorized supported tools when available, and report concrete blockers when necessary.

Leave changes uncommitted. In the handoff, state what changed, what was verified, whether it is deployed, and any remaining material limits. Do not claim the overall implementation plan is complete while its required milestones remain open.
