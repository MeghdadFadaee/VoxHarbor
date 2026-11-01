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
export async function deploy(env = process.env) {
  validateDeployment(env);
  const directory = await packageSource('deployment');
  await new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'vercel@65.9.0', 'deploy', '--prod', '--yes'], {
      cwd: directory, env: { ...env, VERCEL_CLI_USE_NATIVE_BINARY: '0' }, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Vercel deployment failed; inspect the workflow and Vercel build logs.')));
  });
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
}
