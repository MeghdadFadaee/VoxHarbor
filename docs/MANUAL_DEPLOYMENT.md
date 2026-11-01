# Manual deployment

Use the complete [deployment guide](DEPLOYMENT.md) for variables and platform constraints.

```sh
npm run deployment:package
```

Upload the generated folder to the intended project in your Vercel account. The allowlist excludes `.env.local`, `.local`, identities, private evidence, editor metadata, dependencies, local binaries and Git metadata. A source manifest records SHA-256 hashes. Build Linux native code on Vercel instead of copying a development binary.

Preserve existing secrets and encrypted records. Never rotate credentials merely to update source. After deployment, sign in as `owner` with the existing password, verify legacy continuity, then test two separate registered accounts and independent logout. See [multi-user rollout](MULTIUSER.md). In each account, open your backend-saved connection, verify identity continuity and test only an authorized destination. No hardcoded test server, channel, password, UID or account is required.

Git operations are separate from this upload workflow. See [public repository preparation](PUBLICATION.md) before publishing source.
