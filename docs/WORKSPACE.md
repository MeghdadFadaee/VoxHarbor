# Workspace and connection storage

The destinations page opens after sign-in. The console shows the current and recently visited rooms, participant playback controls, conversation scopes and a separate voice panel. The full searchable hierarchy and room previews have a dedicated Channels page. Connection editing, private conversations, identity, presence, diagnostics and audio each have a separate page. There are no demonstration people/messages in the product. The default appearance follows the dark console design, with an explicitly saved light theme still supported. See [design implementation](DESIGN_IMPLEMENTATION.md).

## Backend-owned connections

Each user enters a server, voice port, nickname, optional channel and passwords. **Connect** performs an authenticated same-origin CSRF-protected `POST /api/connection`, encrypts the settings, then opens the protocol socket using only the returned opaque connection ID. Native reconnects load those settings from the backend; the browser reconnect controller holds no destination credentials. A stale connection ID cannot silently select settings saved by another session.

Settings/bookmarks use a per-account Redis namespace. The legacy owner retains `voxharbor:preferences:v1:owner`; new accounts add their immutable account prefix and encryption associated data. See [account isolation](MULTIUSER.md). AES-256-GCM uses the separate identity encryption key, independent random nonces and purpose-specific associated data. Identity and preference ciphertext remain separate. Wrong keys/corruption fail closed; unreadable records are never replaced with defaults. The explicit development memory store is volatile.

Ordinary metadata includes only password-presence flags. Opening a bookmark fills public connection fields and passes its ID when connecting; bookmark passwords are resolved on the backend and are never returned by a bookmark credential endpoint. Empty password inputs preserve a current password only for the same server/channel, or select the bookmarked credential. Passwords never follow an edited destination to another server. Use the explicit clear-password control to remove current saved credentials.

Acknowledged nickname/channel changes update the backend connection for recovery. A storage failure after a successful server action is reported separately; the action is not replayed. Bookmark/theme edits use revision checks and preserve omitted secrets. No connection data is stored in localStorage; only the non-sensitive theme is cached there.

## Commands and safety

Typed channel join/subscription, nickname, away, text and poke actions have bounded input and correlated server acknowledgements. Arbitrary protocol names/arguments are rejected. Timeouts and disconnects never automatically resend messages/actions. Private recipients are bound to their public UID when available; channel messages are bound to the channel observed by the user, so reused client numbers or a concurrent move cannot redirect a message silently.

Messages are literal DOM text, bounded to 200 entries in browser memory, and cleared on logout. They are not saved or logged. Diagnostic downloads exclude names, messages, audio, credentials and private keys. Device changes, hidden pages, disconnection and logout stop transmission. Automatic reconnection can restore listening and an explicitly opted-in, previously enabled microphone. Manual disconnect/sign-out clears recovery, and hiding the page cancels pending recovery. Choices live only in the signed-in page; browser restrictions can still require manual audio enablement. See [audio behavior and diagnostics](AUDIO.md).

## Destination policy

The backend validates every connection. It resolves only allowed public IPv4 destinations, rejects private/reserved/metadata addresses and mixed DNS answers, and passes a pinned numeric address to native code. A bookmark is not permission to bypass these checks. The current voice-port policy is 1024–65535. The application is authenticated and operator-hosted; it is not an unauthenticated proxy.

The full [feature matrix](FEATURE_MATRIX.md) remains open. The old production synthetic-tone UI and instance-specific live-test scripts were removed; use the separate silent browser fixture or an authorized two-client manual audio test.
