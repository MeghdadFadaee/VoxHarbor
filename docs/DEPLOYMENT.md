# Deploying an operator-hosted instance

Use your own Vercel project and Redis REST integration. The application targets Node.js 22, Linux native execution, and a finite Function lifetime. This is experimental; verify the deployed account rather than assuming every platform configuration works.

## Private deployment settings

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact HTTPS origin of your application, with no trailing slash/path |
| `OWNER_PASSWORD_HASH` | Optional reserved `owner` login; preserve existing values; generate privately with `npm run owner:hash` |
| `ALLOW_REGISTRATION` | `1` (default) enables signup; `0` closes new signups while existing users can sign in |
| `SESSION_SECRET` | Independent random 32-byte hex secret; keep stable unless revoking all sessions |
| `IDENTITY_ENCRYPTION_KEY` | Independent random 32-byte hex key for identities and connection preferences |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | A complete owner-controlled Redis REST credential pair |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Alternative Marketplace-provided credential pair; do not mix pairs |
| `IDENTITY_PREVIOUS_ENCRYPTION_KEY` | Only during deliberate encryption-key rotation |

Do not enable `ALLOW_LOCAL_MEMORY_STORE` in production. There is no TeamSpeak host, channel, identity, owner password or Redis endpoint bundled into the source. Earlier experimental `TS3_SERVER_*`, UDP probe and rotation variables are no longer used; configure connections through the authenticated app. Existing unrelated environment values are not modified by this cleanup.

## Build and upload

1. Configure the required private variables. Keep them out of source, issue reports and logs.
2. Run `npm ci`, `npm run check`, `npm test` and `npm run deployment:package` locally.
3. Upload the printed clean source folder to your intended Vercel project. Do not upload the working directory or connect a private evidence folder.
4. Use framework **Other**, Node **22**, and the `vercel.json` build command. The pinned native adapter is built with Cargo's lockfile and packaged for Linux; never upload a local macOS binary.
5. Confirm startup and account isolation on the real URL. Register or sign in, create/import an identity once, then enter and connect to a server you are authorized to use.
6. Confirm the same UID and saved connection survive reload and redeployment. Test audio only in an appropriate authorized channel with consenting participants.

If your account changes Fluid Compute, WebSocket support, execution duration, region, architecture or networking behavior, re-run deployment checks. The configured Function limit is 300 seconds; native sessions rotate at 240 seconds. Recovery interrupts audio and restarts it muted. A dead transport may require waiting for its 35-second ownership lease to expire. One simultaneous native session per account is supported locally; production concurrency/capacity must be verified.

## Operations

Preserve your Redis database and encryption key across redeployments. Do not recreate an identity to hide a decryption/storage error. Account sessions expire after 15 minutes. Restore storage before reconnecting after an outage. See [identity recovery](IDENTITY.md), [workspace storage](WORKSPACE.md) and [testing](TESTING.md).

Read [multi-user rollout](MULTIUSER.md) before opening signup. Preserve the legacy owner records and verify separate users. Encryption-key rotation must cover every account before retiring the previous key.
