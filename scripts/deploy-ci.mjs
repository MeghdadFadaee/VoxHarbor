import { spawn } from 'node:child_process';
import { packageSource } from './package-source.mjs';

// No Vercel environment pull: application secrets remain on Vercel.
export function validateDeployment(env) {
  for (const name of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'PRODUCTION_URL']) {
    if (!env[name]?.trim()) throw new Error(`Configure ${name} in the production GitHub environment.`);
  }
  const url = new URL(env.PRODUCTION_URL);
  if (url.protocol !== 'https:' || url.origin !== env.PRODUCTION_URL || url.username || url.password) throw new Error('PRODUCTION_URL must be an exact HTTPS origin without credentials or a trailing slash.');
  if (!env.VERCEL_PROJECT_ID.startsWith('prj_') || !env.VERCEL_ORG_ID.startsWith('team_')) throw new Error('Configure the existing Vercel project and team IDs.');
}
// Poll explicit states: the CLI's default wait can hang on a blocked deployment.
export async function waitForDeployment(deploymentUrl, env, {
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 12 * 60_000,
  log = console.log,
} = {}) {
  const endpoint = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(new URL(deploymentUrl).hostname)}`);
  endpoint.searchParams.set('teamId', env.VERCEL_ORG_ID);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      signal: AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - now()))),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Cannot inspect Vercel deployment (HTTP ${response.status}); inspect its status before retrying the upload.`);
    const deployment = await response.json();
    const state = deployment.readyState ?? deployment.status;
    if (state === 'BLOCKED' || deployment.readySubstate === 'BLOCKED') {
      throw new Error('Vercel blocked deployment. Check commit-author permissions: connect the author’s GitHub account in Vercel Account Settings → Authentication and confirm access to this project’s team. Inspect the deployment for details.');
    }
    if (state === 'READY') { log('Vercel deployment is ready.'); return; }
    if (['ERROR', 'CANCELED', 'CANCELLED'].includes(state)) throw new Error(`Vercel deployment ${state.toLowerCase()}; inspect its build logs before retrying.`);
    // Only print known states, never arbitrary API error text or account metadata.
    log(`Waiting for Vercel: ${['QUEUED', 'INITIALIZING', 'BUILDING'].includes(state) ? state : 'pending'}.`);
    await sleep(Math.min(10_000, Math.max(0, deadline - now())));
  }
  throw new Error('Vercel did not finish within 12 minutes. The deployment may still be running; inspect it before retrying.');
}

export async function deploy(env = process.env) {
  validateDeployment(env);
  const directory = await packageSource('deployment');
  const output = await new Promise((resolve, reject) => {
    let stdout = '';
    const child = spawn('npx', ['--yes', 'vercel@65.9.0', 'deploy', '--prod', '--yes', '--no-wait'], {
      cwd: directory, env: { ...env, VERCEL_CLI_USE_NATIVE_BINARY: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Vercel upload exceeded 3 minutes. Inspect recent deployments before retrying.'));
    }, 3 * 60_000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16_384); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error('Vercel upload failed; inspect the workflow and Vercel logs.'));
    });
  });
  const deploymentUrl = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app\b/i)?.[0];
  if (!deploymentUrl) throw new Error('Vercel did not return a deployment URL. Inspect recent deployments before retrying.');
  console.log(`Inspect deployment: ${deploymentUrl}`);
  await waitForDeployment(deploymentUrl, env);
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
}
