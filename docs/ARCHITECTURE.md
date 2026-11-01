# Architecture

- `public/`: account workspace, session/recovery controller, AudioWorklets and Opus worker. No default destination, account, private key or server password is bundled.
- `src/http-adapter.mjs`: account-isolated HTTP/WebSocket boundary, origin/CSRF checks, limits and fail-closed session revalidation.
- `src/auth/`: atomic username registration, scrypt verification, account-bound expiring cookies, Redis account/session records and server-selected workspace scoping.
- `src/preferences.mjs`: encrypted backend connection/bookmark settings, metadata redaction and revision checks.
- `src/identity/`: authenticated encryption, create-if-absent identity persistence and explicit import/export/rewrap.
- `src/protocol/`: typed controls/events, per-account lease, server acknowledgements and audio gates.
- `src/transport/destination.mjs`: public-address validation and DNS pinning.
- `src/platform/`: bounded private stdio supervision. Native children receive no deployment-secret environment variables.
- `native/`: pinned Rust tsclientlib bridge. The native child signs/encrypts the actual full TS3 protocol; ServerQuery is not used as a voice substitute.

`api/server.mjs` exports the Node server for Vercel; `scripts/dev.mjs` binds locally. Production uses the owner's Redis REST integration and rejects volatile memory. Cookies are HttpOnly/SameSite=Strict, Secure and `__Host-` scoped on HTTPS. WebSocket upgrades require account auth and exact origin; controls require CSRF. Revocation/storage failures close active transports. Frames, rates, state, audio queues and pending commands are bounded.

Connection settings are encrypted before a connect command. A socket references an opaque settings ID; the backend retrieves credentials and pins the public destination. Settings changes from another session for the same account cannot redirect a stale reconnect silently. The native session rotates at 240 seconds within the configured 300-second Function boundary. A renewed Redis lease limits overlapping identity use; abandoned leases expire after 35 seconds. Recovering a socket does not preserve UDP state or audio capture.

## Protocol source

The selected adapter is ReSpeak/tsclientlib, pinned by source archive revision/digest in `native/vendor/provenance.json` with Cargo lockfiles. Source and declaration snapshots are retained with their licenses. TS3J was considered but would require an independently proven JVM runtime/package. No claim is made that selecting a library establishes full feature parity.

Recorded vendor patches expose encoded audio while retaining transport crypto/permission behavior, and use bounded 2048-ID command reordering with duplicate suppression. The original archive digests and patches distinguish this source from unmodified upstream. The codec stays in the browser; native libopus/OpenSSL codec defaults are disabled.

See [verification scope](FEASIBILITY.md), [audio constraints](AUDIO.md), [identity recovery](IDENTITY.md) and [feature matrix](FEATURE_MATRIX.md). Historic private transport/account evidence is intentionally outside the public repository.

User record prefixes and authenticated encryption associated data both bind records to an account. Legacy owner keys/envelopes remain unchanged. HTTP request bodies never select an account scope. See [multi-user storage and rollout](MULTIUSER.md).
