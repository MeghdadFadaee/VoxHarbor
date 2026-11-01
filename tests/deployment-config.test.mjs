import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../scripts/deploy-ci.mjs';
test('CI deployment fails before upload without an explicit existing project and HTTPS origin', () => {
  const env = { VERCEL_TOKEN: 'synthetic-ci-token', VERCEL_ORG_ID: 'team_fixture', VERCEL_PROJECT_ID: 'prj_fixture', PRODUCTION_URL: 'https://example.com' };
  assert.doesNotThrow(() => validateDeployment(env));
  for (const key of Object.keys(env)) assert.throws(() => validateDeployment({ ...env, [key]: '' }), new RegExp(key));
  for (const origin of ['http://example.com', 'https://example.com/', 'https://user:password@example.com']) assert.throws(() => validateDeployment({ ...env, PRODUCTION_URL: origin }));
  assert.throws(() => validateDeployment({ ...env, VERCEL_PROJECT_ID: 'another-project' }));
});
