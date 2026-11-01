import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment, waitForDeployment } from '../scripts/deploy-ci.mjs';
test('CI deployment fails before upload without an explicit existing project and HTTPS origin', () => {
  const env = { VERCEL_TOKEN: 'synthetic-ci-token', VERCEL_ORG_ID: 'team_fixture', VERCEL_PROJECT_ID: 'prj_fixture', PRODUCTION_URL: 'https://example.com' };
  assert.doesNotThrow(() => validateDeployment(env));
  for (const key of Object.keys(env)) assert.throws(() => validateDeployment({ ...env, [key]: '' }), new RegExp(key));
  for (const origin of ['http://example.com', 'https://example.com/', 'https://user:password@example.com']) assert.throws(() => validateDeployment({ ...env, PRODUCTION_URL: origin }));
  assert.throws(() => validateDeployment({ ...env, VERCEL_PROJECT_ID: 'another-project' }));
});

const deploymentEnv = { VERCEL_TOKEN: 'synthetic-ci-token', VERCEL_ORG_ID: 'team_fixture' };
const deploymentUrl = 'https://fixture-deployment.vercel.app';
function pollingFixture(states) {
  let time = 0;
  const calls = [];
  const logs = [];
  return {
    calls, logs,
    options: {
      now: () => time,
      sleep: async ms => { time += ms; },
      log: message => logs.push(message),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        const state = states[Math.min(calls.length - 1, states.length - 1)];
        return { ok: true, json: async () => typeof state === 'string' ? { readyState: state } : state };
      },
    },
  };
}

test('CI detects the observed Vercel TEAM_ACCESS_REQUIRED block without waiting or exposing metadata', async () => {
  const fixture = pollingFixture([{ readyState: 'BLOCKED', status: 'BLOCKED', seatBlock: { blockCode: 'TEAM_ACCESS_REQUIRED', isVerified: false }, privateData: 'must-not-be-logged' }]);
  await assert.rejects(waitForDeployment(deploymentUrl, deploymentEnv, fixture.options), /blocked.*commit-author permissions/);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.logs, []);
  assert.equal(fixture.calls[0].url.origin, 'https://api.vercel.com');
  assert.equal(fixture.calls[0].url.searchParams.get('teamId'), 'team_fixture');
  assert.equal(fixture.calls[0].options.headers.Authorization, 'Bearer synthetic-ci-token');
  assert.equal(fixture.calls[0].options.redirect, 'error');
});

test('CI waits for readiness and stops polling immediately after success', async () => {
  const fixture = pollingFixture(['QUEUED', 'BUILDING', 'READY']);
  await waitForDeployment(deploymentUrl, deploymentEnv, fixture.options);
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.logs.at(-1), 'Vercel deployment is ready.');
});

test('CI stops on build errors, cancellation and blocked substates', async () => {
  for (const state of ['ERROR', 'CANCELED', { readyState: 'BUILDING', readySubstate: 'BLOCKED' }]) {
    const fixture = pollingFixture([state]);
    await assert.rejects(waitForDeployment(deploymentUrl, deploymentEnv, fixture.options), /Vercel deployment|Vercel blocked/);
    assert.equal(fixture.calls.length, 1);
  }
});

test('CI bounds queue/build waits and warns against duplicate uploads after timeout', async () => {
  const fixture = pollingFixture(['BUILDING']);
  await assert.rejects(waitForDeployment(deploymentUrl, deploymentEnv, { ...fixture.options, timeoutMs: 20_000 }), /may still be running.*inspect it before retrying/);
  assert.equal(fixture.calls.length, 2);
});

test('CI surfaces inspection access failures without printing response bodies', async () => {
  await assert.rejects(waitForDeployment(deploymentUrl, deploymentEnv, {
    fetchImpl: async () => ({ ok: false, status: 403, json: () => { throw new Error('private response must not be read'); } }),
  }), /HTTP 403/);
});
