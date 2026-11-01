# Persistent TeamSpeak identity

The native child inside the owner's Node Function uses tsclientlib to generate a real P-256 TeamSpeak identity and security-level offset, and to sign protocol packets. Node persists each private identity in its account-scoped Redis record (the legacy owner retains `voxharbor:identity:v1:owner`), encrypted with AES-256-GCM and a fresh random 96-bit nonce per write. The envelope has a version, key ID, ciphertext and authentication tag. AAD binds the record to its purpose, account and key ID. Legacy owner associated data remains unchanged.

`IDENTITY_ENCRYPTION_KEY` is a separate 32-byte deployment secret. It is not derived from `SESSION_SECRET`, stored in Redis, inherited by the native child, or sent to the browser. Node decrypts the identity and gives it to the child through private stdin for signing. Those trusted backend components can access private material while active. Ordinary authenticated API responses expose only the signed-in account’s UID, security level and creation time.

Creation/import requires an explicit authenticated, same-origin, CSRF-protected owner action. Atomic create-if-absent prevents concurrent replacement. Storage errors are distinct from missing records; decryption errors stop the operation without regenerating an identity. Counter upgrades must preserve both the private key and UID.

One live protocol session per account is allowed in this milestone. An account-scoped Redis lease renews every ten seconds and expires after 35 seconds if abandoned. Socket closure, account logout/expiration, or lease failure stops the child. Sessions have a deliberate 240-second cap before the configured 300-second Function boundary. Automatic full-protocol recovery at that cap and after an abrupt socket drop is verified in production, as is two-way synthetic Opus through the real server. Actual microphone capture remains unverified. Recovery reuses the identity and loads the current encrypted connection record on the backend through an opaque settings ID. It checks account authentication again and keeps audio muted. Changing connection settings invalidates older recovery IDs. The experimental audio pipeline starts muted and requires explicit user actions.

## Local development

`npm run identity:key` adds a separate key to `.env.local` once, preserving a valid existing value and refusing to silently replace an invalid one. The development web app uses the explicitly volatile memory store unless configured with Redis; its identity will not survive process replacement in that mode. Production rejects volatile storage. Never upload `.env` or `.local` files.

## Backup and recovery

**Export private identity** makes an owner-initiated POST with CSRF and downloads a TeamSpeak-style INI containing a compatible obfuscated identity string. Obfuscation is not encryption; secure that backup. The library export/import round trip preserves UID and level in tests. Direct import into the official client remains unverified.

For infrastructure recovery, back up Redis ciphertext and its encryption secret separately. Both are required. Keep the encryption secret stable across redeployments, Functions and sign-ins. Rotating the login password/session secret revokes sessions without changing the TeamSpeak identity slot.

When storage is unavailable, restore it before reconnecting. When decryption fails, restore the correct secret and ciphertext. Do not generate a new identity to hide the failure; the creation route refuses to replace existing records.

## Deliberate encryption-key rotation

1. Securely back up the current ciphertext and key.
2. Set the new `IDENTITY_ENCRYPTION_KEY` and old `IDENTITY_PREVIOUS_ENCRYPTION_KEY`, then redeploy.
3. As the authenticated owner, POST `/api/identity/rotate` and `/api/preferences/rotate` with the current CSRF header and exact allowed Origin. These authenticate and atomically re-encrypt each record under the new key, preserving the identity key/UID and saved connections. Keep both encryption keys configured if either operation fails.
4. Repeat rewrapping and verification for every account, including dormant accounts, before retiring an old key. The endpoints affect only the signed-in account. Keep both keys until every identity/preference record is rewrapped. Verify UID, connectivity and reopening saved connections; then remove the previous-key variable, redeploy, and retire older deployments retaining old environment values.

Rotation is covered locally; production rotation and restore drills remain pending. Raw keys, import/export contents, passwords, private messages and voice contents remain excluded from logs.

## Saved connection encryption

The client workspace also encrypts owner preferences, current connection settings and bookmarks with the separate identity encryption key, using independent nonces and purpose-specific associated data. Identity and preference records remain separate. During key rotation, keep `IDENTITY_PREVIOUS_ENCRYPTION_KEY` until both records have been rewrapped and verified: use the existing owner-authenticated identity rotation action and POST `/api/preferences/rotate` with the same session/CSRF protection. Verify identity metadata and reopening saved connections before retiring the old key. Do not remove an old key after rewrapping only the identity. See WORKSPACE.md for bookmark credential access and clearing behavior.

See [multi-user storage and key rotation](MULTIUSER.md). The trusted operator controls the shared encryption key; user isolation does not imply encryption from that operator.
