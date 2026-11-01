# VoxHarbor

A self-hosted TeamSpeak 3 web client with private user accounts. Anyone can register on an open instance; each user keeps their own encrypted identity, nickname, connections and bookmarks. Application compute runs in the operator’s Vercel deployment and uses their Redis database.

**Experimental software.** Native TS3 synchronization, generated two-way Opus audio, identity persistence and session recovery have been demonstrated in a private deployment. Actual microphone/device compatibility, uninterrupted conversation and comprehensive official-client feature coverage are not certified. See the [feature matrix](docs/FEATURE_MATRIX.md).

## Run locally

Requires Node.js 22, npm and a Rust toolchain for the native adapter.

```sh
npm ci
npm run owner:setup
npm run identity:key
npm run native:build
npm run dev
```

Open the local address printed by the development server and create an account, or sign in as `owner` with the password from owner setup. Open **Identity** to create or import your TeamSpeak identity, then enter your server, voice port, nickname and optional channel/passwords in **Connection**. There is no built-in server or account.

**Connect saves the connection encrypted on the backend first.** Reconnects send only its saved-settings ID; the backend loads the address and credentials. Bookmarks also keep credentials on the backend. Ordinary API responses redact passwords, and secrets are never stored in browser storage. Audio starts muted. Automatic recovery remembers listening; microphone recovery requires an explicit opt-in in Audio settings. Choices last for the signed-in page. See [audio behavior and connection logs](docs/AUDIO.md).

The default development memory store is volatile: accounts, identities, connections and sessions disappear when that development process stops. Configure your own Redis credentials and disable the memory-store setting for local persistence. Production always requires Redis. Keep encryption keys stable and back up your identity securely.

## Deploy your own instance

Follow [deployment setup](docs/DEPLOYMENT.md). Configure the application origin, session secret, Redis credentials and separate identity encryption key as private environment variables. Public signup is enabled by default; set `ALLOW_REGISTRATION=0` to close signup. Existing `owner` credentials and records are preserved. See [accounts and rollout](docs/MULTIUSER.md). Configure TeamSpeak connections through the signed-in app, not source code or deployment variables.

```sh
npm run deployment:package
```

Upload only the printed clean folder. It excludes environment files, identities, local evidence, dependencies, Git metadata and build outputs. Native code builds for the deployment platform. A successful local build is not proof that another deployment/account works.

## Development and verification

```sh
npm run check
npm test
npm run audio:qa
npm run publication:check
npm run publication:package
```

Tests use synthetic secrets, local sockets and fixtures. They do not connect to public TeamSpeak servers. Build the native adapter before testing its identity endpoints. The separate audio QA page uses generated sound with silent local output; it requests no microphone. See [testing](docs/TESTING.md) and [audio behavior](docs/AUDIO.md).

Implemented: registration/login, account-isolated HTTP/WebSocket access, encrypted identities/settings/bookmarks, live channel/participant state and search, channel movement, nickname/away/subscription controls, typed text/poke actions, experimental Opus/PTT/VAD and bounded automatic recovery. Server permissions apply; a private server denied messaging during verification, so successful live messaging remains unverified.

Pending: administration and detailed permissions, file transfer, whisper, richer profiles, history, concurrent servers, and broader hardware/browser testing. The [implementation plan](IMPLEMENTATION_PLAN.md) remains open.

## Public source and licensing

Target repository: [MeghdadFadaee/VoxHarbor](https://github.com/MeghdadFadaee/VoxHarbor). Original code is [MIT licensed](LICENSE); preserve the [third-party notices](THIRD_PARTY_NOTICES.md).

Before your first commit or public upload, read [publication preparation](docs/PUBLICATION.md). Private development records are intentionally excluded. Never commit actual environment values, identity backups, connection exports, cookies, screenshots of private accounts, or voice/chat recordings. See [security reporting](SECURITY.md) and [contributing](CONTRIBUTING.md).
