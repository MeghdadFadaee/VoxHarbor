# Contributing

Read README.md, IMPLEMENTATION_PLAN.md and docs/FEATURE_MATRIX.md. Keep implemented, verified, simulated and planned behavior distinct. Use synthetic fixtures and reserved example names in tests; live destinations and identities belong in private owner settings, never source.

Run `npm run check`, `npm test` and `npm run publication:check` for changes. Build the native adapter for native/identity changes and use the silent browser fixture for audio changes. Test real servers only with authorization and consenting participants; never create channels, alter permissions, upload files or broadcast messages/audio as an incidental test.

Preserve origin/CSRF/session checks, destination pinning, queue/rate bounds, encrypted storage and fail-closed behavior. Never log keys, session tokens, passwords, private messages or voice contents. Retain upstream licenses/provenance and record vendor modifications as explicit patches. Changes to original project code are MIT licensed; third-party licenses remain separate.

Keep generated outputs, evidence, editor settings, dependencies, binaries and private configuration out of contributions. Publication and Git/GitHub operations are performed by the owner; no automatic commit/push workflow is included.
