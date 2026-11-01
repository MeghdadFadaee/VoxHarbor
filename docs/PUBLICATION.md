# Preparing a public repository

Intended destination: [MeghdadFadaee/VoxHarbor](https://github.com/MeghdadFadaee/VoxHarbor). Original project code is MIT licensed; third-party notices remain separate.

```sh
npm run check
npm test
npm run publication:check
npm run publication:package
```

The checker reads current source and Git's tracked/unignored candidates, including staged content. It flags private paths, known local secret values (without printing them), credential/private-key formats, personal filesystem paths, private deployment URLs and files outside the source allowlist. Intentional published upstream crypto fixtures are distinguished from local secrets. The unchanged, hash-pinned upstream Opus artifact contains compiler paths from its original build; its provenance is recorded alongside the artifact. Known local secrets and this project’s filesystem path are still checked in every file, including vendored code. A generated source manifest records hashes for review.

The exported folder contains no Git history or metadata. Keep `.env.local`, `.local`, editor settings, dependencies, binaries, raw verification records/screenshots and identity backups out of the public repository. The cleanup privately archives old instance-specific material under `.local/private-archive/`; do not upload that directory. Examples and synthetic test fixtures are not real connection settings.

A scanner is not a guarantee. Review the exact files you stage and any existing Git history. If credentials ever entered history, removing a working file or adding an ignore rule is insufficient: revoke affected credentials and perform a deliberate history cleanup before publication. An empty history avoids that historical exposure, but still inspect the first commit.

## Owner publication steps

Git and GitHub operations are intentionally not automated by these scripts. If your workflow requires read-only Git/GitHub access for the coding agent, you must perform the final operations yourself:

1. Create or verify the intended public GitHub repository. Avoid adding a conflicting initial README/license when the local source is ready.
2. Review `git status`, then stage only reviewed files. Inspect `git diff --cached --stat` and `git diff --cached`; run `npm run publication:check` again so staged bytes are checked too.
3. Commit the reviewed source, set/verify the remote destination, and push it yourself. Do not force-push or rewrite existing history casually.
4. Confirm repository visibility, licensing and that no private configuration/evidence was included.

The clean export is also suitable for starting a separate fresh publication checkout if desired. It is not a reason to upload private local folders or bypass audit findings. The `private: true` flag in package.json prevents accidental npm-registry publication; it does not make a GitHub repository private.
