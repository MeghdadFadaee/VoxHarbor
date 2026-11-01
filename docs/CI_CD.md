# CI/CD

GitHub Actions runs `.github/workflows/pipeline.yml` to test pull requests and deploy passing changes from `main` to the existing Vercel project.

## Pipeline

Pull requests run secret-free verification on the latest stable GitHub-hosted Ubuntu and macOS images. Each platform tests two toolchain combinations:

| Toolchain | Node.js | Rust |
| --- | --- | --- |
| Production | Latest Node.js 22 patch | 1.96.0, matching the Vercel native build |
| Latest | Latest LTS (`lts/*`, currently 26) | Latest stable (currently 1.99.1) |

Each job installs locked npm dependencies, builds the native adapter and browser codec, checks syntax, runs the complete test suite, audits public source and verifies clean deployment packaging. Building before tests enables the real native identity tests instead of silently skipping them. Latest-toolchain jobs test upgrade compatibility; the application's declared production runtime remains Node.js 22.

Fork pull requests receive no Vercel credentials. The workflow uses `pull_request`. Official `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0 are pinned to release commit IDs. Node patches, latest LTS, stable Rust and hosted runner images resolve at execution time; action commit pins and the Vercel CLI version are updated explicitly. Superseded verification jobs are canceled. Rust dependency downloads and compiled outputs are cached separately by operating system, architecture, exact compiler version and dependency lockfile. The first run builds from scratch; subsequent runs can reuse compatible cached work.

A push to `main`, or a manual run on `main`, deploys only after all four verification jobs succeed. The production job has read-only repository permissions, uses the `production` environment and serializes deployments without interrupting an active release. It checks the current main SHA before upload and skips superseded commits.

The deployment job runs on the latest Node.js LTS and uses the pinned official Vercel CLI 65.9.0 with the configured existing team/project IDs. It uploads only the audited folder returned by `deployment:package`. Vercel builds the Linux native executable remotely using its existing production configuration. No application environment values are pulled into GitHub; no local binaries, identity files or private development evidence are uploaded. The CLI token is supplied through the environment, not printed or embedded in a command argument.

Upload returns immediately with a deployment URL. The workflow then polls Vercel every ten seconds, reports progress, and stops immediately on blocked, failed or canceled states. Upload is limited to three minutes and readiness polling to twelve minutes. A timeout does not cancel the remote deployment; inspect it before uploading again.

After Vercel reports readiness, the workflow checks that production serves this release's HTML, browser modules, styles, favicon and manifest. It also checks public sign-in, authentication, origin rejection and WebSocket upgrade gates. These checks do not sign in, create accounts, contact TeamSpeak or test real voice. Failures mark the workflow as failed; an already published release is not automatically rolled back.

## GitHub and Vercel setup

1. Push the project, including `.github/workflows/pipeline.yml`, to GitHub. Pull requests start verification automatically; pushes to `main` also run the production deployment job.
2. In GitHub repository **Settings → Environments**, create `production`. Restrict deployment branches to `main`; add required reviewers if you want a release approval gate.
3. Add the environment secret `VERCEL_TOKEN`: a Vercel token authorized for the existing project's team. Create it in Vercel account settings and save it as a GitHub environment secret.
4. Add these **environment variables**, not application credentials:

   | Name | Value |
   | --- | --- |
   | `VERCEL_ORG_ID` | Existing Vercel team ID (`team_…`) |
   | `VERCEL_PROJECT_ID` | Existing VoxHarbor project ID (`prj_…`) |
   | `PRODUCTION_URL` | Exact production HTTPS origin, without a trailing slash |

   IDs are available in the Vercel project settings or existing local `.vercel/project.json`. Do not create another project just to populate these values.
5. In Vercel **Account Settings → Authentication**, connect the GitHub account used to author commits. That account must have deployment access to the project’s team. For a Hobby team, the author must be its owner. A valid CLI token alone does not grant commit-author access. See [Vercel collaboration troubleshooting](https://vercel.com/docs/deployments/troubleshoot-project-collaboration).
6. Keep `APP_ORIGIN`, Redis credentials, session secret, identity encryption key, reserved owner hash and registration configuration in Vercel. Preserve existing values and data. Do not copy them into GitHub.
7. Configure branch protection/rules for `main` to require **Verify (linux, production)**, **Verify (macos, production)**, **Verify (linux, latest)** and **Verify (macos, latest)** and block direct pushes as appropriate. Give workflows read-only repository permission; no GitHub write token is needed.
8. If Vercel's Git integration is enabled, disable its independent automatic Git deployments for this project before relying on this workflow as the deployment gate. Otherwise Vercel can deploy a commit before CI succeeds. Do this in Vercel project settings; keep the project's runtime and private environment unchanged.
9. Publish a reviewed change and inspect its first Actions run. Verify the existing owner identity and saved connections after the first rollout. Trigger later manual redeploys through Actions on `main`.

If the default branch has another name, update both the workflow trigger/condition and its main-head check together. Keep the environment branch restriction consistent.

## Preview isolation

Pull requests are tested but are not deployed with production credentials. Preview apps must have their own Vercel project/environment, stable allowed origin, separate Redis database and separate encryption/session keys. The current exact-origin policy and durable account data make reusing production secrets in arbitrary preview URLs inappropriate. Preview deployment is intentionally not enabled by this pipeline.

## Failures and rollback

- A blocked deployment can indicate missing commit-author access. Check the deployment details, connect the correct GitHub account in Vercel Authentication and verify team membership before trying again.
- A verification failure prevents the deployment job. Fix the failing check; do not bypass it by loosening authentication or changing secrets.
- A native/Vercel build failure leaves the previous production deployment serving traffic.
- A post-deployment smoke failure can occur after the new release is live. Inspect the Actions/Vercel logs, then manually promote a known-good existing deployment in Vercel if necessary. Check data/schema compatibility first; source rollback does not undo database changes.
- Do not rotate keys, clear Redis or recreate identities to recover a code deployment.
- Configure Actions failure notifications for the maintainers. Do not upload environment files, private runtime logs or account screenshots as workflow artifacts.

Check the first Actions run after setup to confirm runner builds, Vercel token access and live release verification. Review action release pins and the Vercel CLI version regularly; production runtime upgrades require their own deployment verification.

Version references: [checkout releases](https://github.com/actions/checkout/releases), [setup-node releases](https://github.com/actions/setup-node/releases), [Node.js releases](https://nodejs.org/en/about/previous-releases), [Rust stable releases](https://releases.rs/), [Vercel CLI package](https://www.npmjs.com/package/vercel).

References: [Vercel GitHub deployments](https://vercel.com/docs/git/vercel-for-github), [Vercel CLI deployments](https://vercel.com/docs/deployments), [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [fork pull-request permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
