# VoxHarbor — Implementation Plan

Build VoxHarbor, a polished, self-hosted TeamSpeak web client. An operator can deploy an independent instance in their Vercel account and enable public registration. Every user has a private workspace and retains their own TeamSpeak identity, connections and nickname across sessions, redeployments and devices.

## Current scope

The experimental core implements account-isolated authentication with public registration, encrypted identity/settings/bookmark storage, full-client TS3 synchronization, Opus audio and bounded session recovery. Private deployment observations are summarized in docs/FEASIBILITY.md without account, destination, identity or private evidence details. Connections are stored on the backend. The multi-user production rollout passed two-account identity/settings/authentication/logout checks on 2026-11-01 while preserving the legacy owner. Real concurrent multi-user TeamSpeak/voice capacity remains unverified.

The plan remains unfinished. Actual microphone/device/browser verification, Function-kill/server-restart behavior, administration, file transfer, whisper, rich profiles, history and concurrent servers remain open. A private server denied messaging for the verification identities; permissions were not changed. Simulated fixtures never constitute a successful live interoperability test. See docs/FEATURE_MATRIX.md.

Act as a senior engineer responsible for architecture, implementation, security, interface design, and verification. Deliver working software, not a mockup or architecture proposal.

## Product requirements

- One deployment belongs to an operator; each registered account has its own private workspace.
- Each user connects to existing, unmodified TeamSpeak servers using their address, port, nickname, identity, and any required passwords.
- Support TeamSpeak 3 first. Treat compatibility with newer TeamSpeak servers and their additional features as separately verified capabilities.
- Aim for comprehensive feature coverage comparable to the official client, within the permissions granted by the server.
- No shared vendor-operated gateway, mandatory central account, analytics, or advertising.
- All application compute must run within the owner's Vercel deployment. Durable storage may use an owner-controlled integration supported by Vercel.
- Do not silently introduce a VPS, external protocol gateway, or required desktop companion.

## First milestone: prove Vercel feasibility

Do this before investing in the full interface.

Inspect current official Vercel documentation and build a minimal deployable experiment using an appropriate runtime. Verify on an actual Vercel deployment:

1. Bidirectional binary WebSocket communication with the browser.
2. Outbound UDP with validated responses from a non-DNS endpoint.
3. A real TeamSpeak protocol handshake and authenticated connection to an authorized test server.
4. Channel and participant synchronization.
5. Actual two-way voice with another client.
6. Connection behavior near the Function execution limit, including reconnection and recovery.
7. Whether the chosen protocol library and any native dependencies build and run in Vercel's production environment.

Local execution does not prove Vercel compatibility. A successful UDP send does not prove a response was received. A DNS-only UDP test does not establish TeamSpeak compatibility.

Document the exact deployment, runtime, configuration, test results, and remaining uncertainty. Treat timeouts as inconclusive until investigated.

If a hard platform limitation prevents the required architecture, report the evidence clearly. Do not claim the project meets the requirements, fabricate a successful test, or silently move compute elsewhere. Complete useful independent work and identify the smallest decision needed from the owner.

## Protocol core

Evaluate existing open-source full-client protocol implementations, including TS3J and tsclientlib and relevant maintained forks. Choose based on demonstrated compatibility, correctness, maintainability, licensing, and Vercel execution.

ServerQuery alone is not sufficient for a voice client.

Keep the protocol implementation independent of the UI. Separate:

- Identity management.
- Address resolution and connection establishment.
- Protocol transport, cryptography, packet ordering, acknowledgements, and reconnect behavior.
- Server session state and event processing.
- Commands, permissions, and capability detection.
- Voice processing and routing.
- File transfer.
- Platform-specific adapters.

Expose typed commands and events to the frontend. Keep authoritative server state synchronized through actual protocol events.

Do not invent cryptography or implement an incomplete protocol merely to avoid using a suitable library. Do not pretend a successful connection means full compatibility.

## Feature coverage

Maintain a feature matrix with these statuses: implemented and verified, implemented but unverified, planned, unsupported by the selected server/protocol, or blocked by the browser/platform.

Cover at least:

- Persistent identities, identity import/export, and required identity security levels.
- Server and channel passwords.
- Server bookmarks and connection history.
- Channel hierarchy, subscriptions, participant lists, and speaking indicators.
- Voice send/receive, push-to-talk, voice activation, microphone/output mute, and per-user volume.
- Whisper targets and lists.
- Private, channel, and server text messages.
- Poke, away status, nickname, descriptions, avatars, badges, and icons where supported.
- Channel creation, editing, ordering, deletion, and password handling.
- User movement, kick, ban, complaints, and ban management.
- Server groups, channel groups, privilege keys, and detailed permission management.
- Channel file browsing, upload, download, folders, and deletion.
- Connection quality, latency, packet loss, and actionable errors.
- Multiple server sessions with explicit active microphone and audio routing.
- Server information and editable settings permitted by the owner's identity.

Respect server-side permissions. Never imply that a custom client grants additional privileges.

Investigate video, screen sharing, newer TeamSpeak features, and proprietary account services separately. Do not confuse GreenTeaSpeak extensions with standard TeamSpeak capabilities. Clearly document unsupported functionality rather than creating nonfunctional controls.

## Audio requirements

Build a real audio pipeline with codec support appropriate to the compatibility target.

Include bounded queues, jitter buffering, packet-loss handling, per-speaker decoding and mixing, and protection against runaway latency.

Implement microphone permissions, device changes, echo cancellation and noise suppression where supported, and clear transmission indicators.

State browser limitations honestly: global push-to-talk shortcuts, background execution, output selection, and mobile behavior must be tested rather than assumed.

## Accounts and authentication

The operator controls registration; each user accesses only their own workspace. The requested multi-user scope supersedes the earlier owner-only requirement. See docs/MULTIUSER.md.

- Provide a secure, documented owner bootstrap process.
- Support username/password registration and login, with an operator switch to close new registrations. Preserve the reserved legacy owner account without migrating its encrypted records.
- Use server-enforced authentication for every sensitive HTTP route, WebSocket upgrade, file operation, and protocol action.
- Use secure, HttpOnly session cookies, appropriate SameSite settings, origin validation, and CSRF protection.
- Never rely solely on a hidden URL, frontend checks, or an obscure deployment address.
- Do not put credentials or bearer tokens in URLs.
- Handle expiration, logout, and session revocation.
- Protect any public deployment with a setup/authentication gate from its first request.

Because the backend makes network connections on the owner's behalf, validate destinations and prevent unauthenticated proxy use. Block internal and metadata-service destinations by default; make any intentional private-network support explicit.

## Durable TeamSpeak identity

The same identity must survive browser restarts, Function replacement, redeployment, and signing in from another device.

- Generate a proper TeamSpeak identity once and persist it.
- Support compatible import and owner-initiated export.
- Never regenerate an identity silently after a storage or decryption error.
- Encrypt private identity material at rest using authenticated encryption.
- Keep the encryption secret separate from stored ciphertext, using deployment secrets or an appropriate managed key facility.
- Do not store plaintext private keys or server passwords in browser localStorage.
- Do not expose private keys through ordinary API responses.
- Explain where signing occurs and which owner-controlled backend components can access decrypted material.
- Exclude keys, passwords, privilege tokens, voice contents, and private messages from logs.
- Provide documented backup, recovery, and key-rotation behavior.

Use durable storage, not the Function filesystem or process memory, for identity persistence. Store preferences and bookmarks appropriately, encrypting sensitive fields.

## Interface and experience

The user-approved Console design now supplies the page structure: destinations first, a unified connection editor, the voice console, searchable channel browser with preview, private conversation workspace, and separate identity/audio/presence/diagnostics pages. The console room strip contains a bounded recent-room list, not the full server hierarchy. See docs/DESIGN_IMPLEMENTATION.md for implemented flows and verification.

Create a distinctive, professional communication app with a calm visual style, excellent typography, restrained color, accessible contrast, and polished interaction states.

Suggested layout:

- Server connections and bookmarks on the left.
- A clear, searchable channel and participant tree.
- Conversation and activity views in the main area.
- A persistent voice control bar showing connection, microphone, output, and active transmission.
- Contextual user/channel actions and focused settings panels.

Support responsive desktop and mobile layouts, keyboard navigation, light/dark themes, and accessible controls.

Make connection progress, permission errors, reconnecting, unsupported codecs, unavailable features, and identity/storage failures understandable.

Use genuine server data in working flows. Keep any demonstration data explicitly separate.

## Vercel deployment and lifecycle

Provide a straightforward deployment process, ideally a Deploy to Vercel button when the repository is ready.

Document required secrets, owner authentication setup, durable storage integration, runtime configuration, region selection, and relevant account features.

Treat Function termination as a real operational boundary. Saving a snapshot in a database does not preserve a live UDP socket or an authenticated TeamSpeak session. Implement and verify reconnection accordingly, and disclose any unavoidable audio interruption.

Avoid a design that only works because a developer process remains running locally.

## Validation and delivery

Test the areas that can invalidate the product:

- Account isolation, authenticated HTTP/WebSocket access, registration controls, legacy owner continuity and independent logout.
- Identity persistence through redeployment and different browser sessions.
- Real TeamSpeak connection and two-way audio.
- Password-protected channels and insufficient permissions.
- Reconnection, server restart, and Function termination.
- Multiple speakers, jitter, and bounded audio queues.
- File-transfer authorization and destination validation.
- Malformed server packets and untrusted chat content.
- Current Chrome, Firefox, and Safari, with documented results.

Deliver the source, lockfiles, environment-variable template, deployment instructions, architecture notes, feature matrix, and reproducible verification evidence.

Work incrementally through verified milestones. Do not stop at a scaffold. Distinguish demonstrated behavior from assumptions and remaining work.

Do not create, modify, or delete GitHub resources, or commit, push, or change Git state automatically. Leave project changes uncommitted unless separately authorized.
