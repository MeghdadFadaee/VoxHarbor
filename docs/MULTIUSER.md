# Accounts and private workspaces

VoxHarbor supports username/password registration on one operator-controlled deployment. Each account has its own TeamSpeak identity, nickname, encrypted current connection, bookmarks, preferences and active protocol lease. Accounts are application accounts, not TeamSpeak/vendor accounts. Server permissions still apply.

## Sign in or register

Choose **Create an account**, enter a username and a password, and confirm the password. Usernames contain 3–32 ASCII letters, numbers, underscores or hyphens, starting with a letter or number. They are case-insensitive and stored lowercase. Passwords contain 16–256 characters and are stored as independently salted scrypt hashes. Registration signs in with a fresh opaque HttpOnly session cookie. Create/import a TeamSpeak identity in your private workspace once; the application never silently creates a replacement identity.

There is no email collection, email verification, password reset, account deletion UI or MFA in this milestone. Keep your password and private identity backup secure. Registration limits and generic login failures follow the principles in the [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Username availability is observable through registration; usernames are not treated as private email addresses.

## Existing deployment compatibility

The reserved username **owner** uses the existing `OWNER_PASSWORD_HASH`. Existing password-only API login requests remain supported for this account; the browser uses an explicit username. Pre-account owner sessions continue to access only the legacy owner workspace. Existing owner identity/settings records keep their original storage keys, encryption associated data and ciphertext; no migration or key change is needed. Registration can never claim `owner`, even when no owner password is configured. The legacy owner login does not gain an application route to other users' records.

New accounts have random immutable IDs, separate from usernames. Account records are atomically created at `voxharbor:account:v1:<sha256-of-normalized-username>`; each contains its ID, canonical username, password hash and creation time. Account IDs are not accepted from browser requests to choose a workspace. Sessions contain the authenticated account ID and username; the account record is checked again on authenticated requests and active WebSocket revalidation. Missing/corrupt account storage fails closed.

## Storage and encryption boundaries

New users' application records, leases and authenticated rate counters are prefixed by `voxharbor:user:v1:<account-id>:`. The identity/preference envelope's associated data also includes that account ID, so moving ciphertext between accounts cannot decrypt successfully. A shared deployment encryption key is still required; the trusted operator and backend have access to decrypted material while processing a user's request. This is encryption at rest, not end-to-end encryption from the operator.

Only authenticated metadata exposes the current user's UID and connection fields; passwords remain backend-only. Export/import/rotation routes always operate on the session's workspace. Connection IDs from another account cannot select its saved settings. Each account can hold one live native session; separate users have separate leases and may connect concurrently. One account's logout revokes only its presented browser session and stops that session's sockets. Replacing a browser login revokes its previous session. Other tabs receive a sign-in-change notification and clear their workspace.

## Operator configuration and rollout

`ALLOW_REGISTRATION=1` enables public signup and is the default. Set `ALLOW_REGISTRATION=0` to close new signups while preserving existing accounts' sign-in. Registration also requires `IDENTITY_ENCRYPTION_KEY`. `OWNER_PASSWORD_HASH` is optional for new account-based deployments; preserve it unchanged on existing installations. Production still requires HTTPS, a stable session secret and durable Redis; the development memory store loses all accounts and their data when the process stops.

This source change does not modify private environment values, touch existing Redis data or deploy automatically. Before rollout, back up existing ciphertext and its encryption key separately. Verify the legacy owner UID and saved connections, register two disposable test accounts, check identity/connection separation, concurrent protocol sessions, independent logout and persistence across replacement of the deployed application. On 2026-11-01, production checks verified two-account registration, separate native identities/settings, authenticated WebSockets, independent logout and persistence after sign-in, while the legacy owner identity/settings matched a private pre-deployment baseline. Real concurrent TeamSpeak/voice sessions and hosting cost/capacity still need separate verification. Previous single-owner protocol verification is not multi-user voice certification.

Global limits currently allow 10 registration requests and 120 login requests per minute, with a shared per-username limit of 10 authentication requests per minute. Authenticated settings/identity/socket and connect limits are scoped per account. These limits bound an initial rollout; there is no verified capacity guarantee, billing quota system or bot challenge. Closing signup does not disconnect existing accounts.

For encryption-key rotation, every account's identity and preferences must be rewrapped and verified, including the legacy owner. The existing per-account rotation endpoints affect only the signed-in account. Keep the previous key until **all** records have been rewrapped; rotating only the owner and then removing the old key would strand other accounts. Account password hashes do not use the identity encryption key. Rotating `SESSION_SECRET` revokes all application sessions without changing account records or TS3 identities.
