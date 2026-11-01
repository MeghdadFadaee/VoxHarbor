# VoxHarbor — Capabilities and Requirements

## Product scope

VoxHarbor is a browser-based TeamSpeak 3 client. Users register on an independently operated instance and connect to existing TeamSpeak servers. Each user has a separate account, TeamSpeak identity, saved connections and nickname.

VoxHarbor accounts are separate from TeamSpeak identities and vendor accounts. Access to server functions depends on the connected server and the permissions assigned to the user's identity.

## Current capabilities and functional requirements

### Accounts and sessions

- Register with a username, password and password confirmation when registration is enabled.
- Sign in with an existing username and password.
- Sign out and revoke the current application session.
- Keep each account's identity, connections and saved data separate from other accounts.
- Support closed registration while allowing existing users to sign in.
- Preserve the reserved legacy `owner` account.
- Handle invalid credentials, duplicate usernames, registration closure, request limits, expired sessions and unavailable account storage.
- Clear account-specific session data when signing out or changing accounts.

| Field | Requirement |
| --- | --- |
| Username | 3–32 characters; letters, numbers, underscores or hyphens; starts with a letter or number; case-insensitive |
| Password | 16–256 characters for registration |
| Password confirmation | Must match the registration password |

Email collection, email verification, password recovery, multi-factor authentication and account deletion are not currently available.

### TeamSpeak identity

- Explicitly create a persistent TeamSpeak identity or import an existing identity file.
- Retain the same identity across sign-ins, browser sessions and application deployments.
- Access the identity's public UID and security level.
- Export a private identity backup.
- Preserve an existing identity rather than silently replacing it.
- Support server-required identity security-level increases without changing the identity's UID.
- Distinguish a missing identity from an unreadable identity, failed import, storage failure or unavailable identity service.
- Require an identity before connecting to a TeamSpeak server.

### Connections and saved destinations

- Connect to a TeamSpeak server using an address, voice port and nickname.
- Support an optional server password, destination channel ID and channel password.
- Save connection settings and passwords encrypted on the backend for the authenticated account.
- Create, name, edit, select and delete saved connections.
- Retain saved connections and nicknames across sign-ins.
- Preserve saved passwords when no replacement is supplied for the same destination.
- Explicitly remove saved passwords.
- Keep saved passwords from being reused for a different destination after an address or channel change.
- Disconnect an active connection or stop an ongoing connection attempt.
- Support one active TeamSpeak connection per account. Separate accounts have independent connections.
- Restrict destinations to permitted public IPv4 addresses and voice ports from 1024 to 65535.

### Server, channels and participants

- Synchronize the connected server's name, channel hierarchy and visible participants.
- Search channels and participants.
- Access channel names, topics, password requirements, subscriptions and codec information.
- Access participant names, channel membership, mute states, away messages and speaking activity where available.
- Distinguish the current user and their current channel.
- Join another channel, including password-protected channels when authorized.
- Subscribe to and unsubscribe from channel updates when permitted.
- Change the current nickname.
- Set an away message and return from away status.
- Retain acknowledged nickname and channel changes in the backend connection settings for recovery.

### Voice communication

- Receive and transmit audio in Opus Voice and Opus Music channels.
- Enable and disable listening independently from microphone activation.
- Enable and mute the microphone.
- Support push-to-talk and hands-free voice activation.
- Adjust the voice activation threshold.
- Select an available microphone.
- Select an audio output device where the browser supports it.
- Adjust individual participants' playback volume from 0% to 200%.
- Track local transmission and remote speaking activity.
- Request browser-supported echo cancellation, noise suppression and automatic gain control.
- Handle denied microphone permission, missing devices, device changes, suspended audio and unsupported codecs.
- Start new sessions with listening and the microphone off.
- Stop microphone transmission when the page is hidden, the connection ends, the user signs out or an audio/device failure occurs.
- Restrict push-to-talk keyboard operation to the focused page; no global shortcut is available.

### Automatic recovery and audio choices

- Attempt bounded automatic recovery after recoverable connection interruptions.
- Reuse the account's existing identity and backend-saved connection settings.
- Recheck account authentication during recovery.
- Restore listening after automatic reconnection when it was previously enabled.
- Resume a previously enabled microphone only when the user has explicitly opted into automatic microphone recovery.
- Retain transmission mode, threshold and selected devices during automatic recovery within the same signed-in page.
- Cancel pending audio recovery on manual disconnect, sign-out, channel changes, device errors or page hiding.
- Never restore a previously held push-to-talk press.
- Start with audio off after reload or a new sign-in.
- Handle browser restrictions that prevent automatic audio resumption.

### Text communication and participant contact

- Send and receive channel, server and private text messages when permitted.
- Send and receive participant pokes when permitted.
- Associate private conversations with the intended participant.
- Distinguish pending actions, confirmed actions, denied actions and unconfirmed results.
- Do not automatically resend messages or participant actions after a timeout or disconnect.
- Keep messages in the current browser session, with a maximum of 200 retained entries.
- Clear messages on sign-out. Durable message history is not available.

### Connection diagnostics

- Record connection status changes, native session-limit events, socket close codes, connection duration and retry attempts/delays.
- Record heartbeat round-trip timing, time since the last transport message, protocol error codes and browser network/visibility changes.
- Export diagnostic data as a JSON file.
- Retain up to 1,000 events in memory for the current signed-in page.
- Clear diagnostics on reload or sign-out.
- Exclude server addresses, account identifiers, passwords, private identity material, messages and audio contents.
- Do not automatically upload diagnostic logs.

## Required operational states

- Signed out; registering; signing in; authenticated; session expired or revoked.
- Registration available or closed.
- No identity; identity available; identity operation pending; identity operation failed.
- No saved connection; saved connections available; settings being saved; conflicting or stale settings; settings storage failure.
- Disconnected; connecting; connected; reconnecting with a retry delay; network offline; recovery exhausted; connection rejected.
- Connection already active for the account.
- Live server data available; no participants; no search matches; previously received data no longer live.
- Listening off or on; microphone off, ready, idle or transmitting; microphone permission pending or denied.
- Unsupported channel codec; unavailable audio device; audio initialization or recovery failure.
- Action pending, confirmed, denied by server permissions, timed out or interrupted.

## Privacy and data requirements

- Require authentication for private account data and server actions.
- Keep private identities and connection credentials encrypted in durable backend storage.
- Keep credentials out of URLs, ordinary account responses and browser local storage.
- Restrict private identity export to an explicit action by the authenticated account.
- Preserve saved identities and connections through application updates.
- Stop account activity when its session expires or is revoked.
- Enforce server permissions for every supported action.
- Treat the instance operator as trusted with backend access; encryption at rest does not prevent operator access.

## Planned capabilities — not currently available

| Area | Required capabilities |
| --- | --- |
| Connection history and quality | Durable connection history; connection latency, packet loss and quality information |
| Multiple servers | Concurrent server connections with an explicit active microphone destination and audio routing |
| Advanced voice | Whisper targets, whisper lists and advanced audio routing |
| Channel management | Channel creation, editing, ordering, deletion and password management |
| Moderation | Authorized participant movement, kick, ban, complaints and ban management |
| Groups and permissions | Server groups, channel groups, privilege keys and detailed permission management |
| Files | Channel file browsing, upload, download, folders and deletion |
| Profiles and presence | Descriptions, avatars, badges and icons where supported |
| Server administration | Server information and authorized changes to server settings |

## Compatibility and verification boundaries

- TeamSpeak 3 is the current protocol target.
- Video, screen sharing, newer protocols and proprietary account services remain separate investigations.
- Server-side permissions can prevent otherwise supported operations.
- Native sessions currently have a 240-second lifetime before automatic reconnection; uninterrupted audio across that boundary is not guaranteed.
- Generated two-way Opus audio has been demonstrated through a real server. Actual microphone conversations, audible browser playback and microphone recovery still require live verification.
- Private messaging and poke interoperability remain unverified where server permissions prevented testing.
- Concurrent multi-user voice capacity, broad browser/device compatibility and reliable mobile background audio remain unverified.
