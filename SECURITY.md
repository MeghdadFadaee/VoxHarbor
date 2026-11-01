# Security

VoxHarbor is experimental operator-hosted software with private user workspaces and optional public registration. The operator controls the deployment, Redis and encryption keys. All sensitive HTTP operations and WebSocket upgrades require account authentication; writes/controls also check origin and CSRF. Keep the exact HTTPS app origin configured. The app blocks private/reserved network destinations by default.

Keep `.env.local`, `.local`, Redis values, identity backups, deployment screenshots, HAR files, cookies, voice/chat contents and connection exports private. `.gitignore` is a convenience, not a secret manager. Run `npm run publication:check` before committing and inspect the files you stage. Do not bypass its findings by force-adding excluded material.

Preserve the separate identity encryption key and encrypted Redis records. Incorrect keys/corrupt records fail closed; do not generate a replacement identity to hide a recovery error. See [identity recovery](docs/IDENTITY.md). Saved connection/bookmark passwords are encrypted and never included in ordinary metadata responses. Runtime diagnostics must not contain credentials or private content.

Report vulnerabilities through GitHub's private security reporting for the intended repository if available. Otherwise ask the maintainer for a private reporting channel without posting exploit details or secrets publicly. Do not include real keys, tokens, private server/channel addresses, identities or recordings. If a secret was already published, revoke/rotate it and review repository history before making further public releases; deleting the working file alone does not remove it from history.

Known limits include finite Function lifetime, one simultaneous native session per account, audio restarting muted after recovery and incomplete hardware/browser/feature verification. See the feature matrix. No automated scan guarantees that publication is safe; review the publication report and source manifest before you push.

Registration is enabled by default and can be closed with `ALLOW_REGISTRATION=0`. New accounts cannot access the legacy owner or another account’s records. The operator remains trusted with encryption keys and backend signing. Password recovery, MFA and capacity certification are not included in this milestone; see [accounts](docs/MULTIUSER.md).
