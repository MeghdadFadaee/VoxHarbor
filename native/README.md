# Native TS3 adapter

This executable implements a bounded private newline-JSON protocol for the owner's Node backend. It uses the pinned ReSpeak tsclientlib client stack for identity signing, handshake, encryption, transport and synchronized state. Identity material passes through private stdin, never deployment-secret environment variables or logs.

```sh
npm run native:build
```

The build uses Cargo's lockfile and release profile, then packages the current platform executable under ignored `native/bin/`. Vercel builds its own Linux executable; do not commit or upload a local binary. Compiler/download setup is in `scripts/build-native.mjs` and `scripts/bootstrap-rust.sh`. No project Git mutation is involved.

The owner configures the destination and credentials in the signed-in app. The backend decrypts stored settings, validates/pins a public numeric address, and supervises one native session with bounded stdio, timeout and lease ownership. There is no default test server in native code. The adapter does not write server files or private identity backups to disk.

Vendor provenance, exact source/declaration revisions, archive digests and local patches are in `vendor/provenance.json`. Retain the original MIT/Apache licenses. `raw-audio.patch` exposes encoded packets without native codec defaults. `bounded-reordering.patch` provides bounded 2048-ID command reordering and duplicate suppression while retaining packet authentication/encryption and ordering. Its native regression tests cover burst, duplicates, wraparound and priority isolation.

A Linux build, full TS3 state and generated two-way Opus were observed in a private deployment before source cleanup. See [feasibility limits](../docs/FEASIBILITY.md). Actual hardware conversation, complete official-client parity and all remaining features are not certified.
