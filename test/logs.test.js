// -----------------------------------------------------------------------------
// Quiet logs. At the default level, a normal reading writes nothing: info
// keeps the lifecycle (start, connection, loss and recovery, user actions).
// A failure that repeats at every retry writes one line when it starts and
// one when it ends. Everything else is debug (LOG_LEVEL=debug).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT, createFakePortal } from './helpers/fakePortal.js';
import { setup } from './helpers/setup.js';

function captureLogs(t, level) {
  const lines = [];
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.after(() => {
    if (previousLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLevel;
    }
  });
  return lines;
}

const SECRETS = [ACCOUNT.email, ACCOUNT.password, 'session-1', 'session-2'];

test('a normal reading writes nothing at the default level', async (t) => {
  const portal = createFakePortal();
  const { sync, clock } = await setup(t, { portal });
  await sync.refresh(); // first sign-in of the run: a lifecycle line
  const lines = captureLogs(t, 'info');

  // The next day: the portal dropped the session, the integration signs in
  // again and reads the new day. Business as usual.
  portal.expireSessions();
  clock.now = new Date('2026-10-13T10:00:00');
  assert.equal((await sync.refresh()).ok, true);
  clock.now = new Date('2026-10-14T10:00:00');
  assert.equal((await sync.refresh()).ok, true);
  assert.deepEqual(lines, []);
});

test('the debug lines of a reading carry no secret of the configuration', async (t) => {
  const lines = captureLogs(t, 'debug');
  const portal = createFakePortal();
  const { sync, clock } = await setup(t, { portal });
  await sync.refresh();
  portal.expireSessions();
  clock.now = new Date('2026-10-13T10:00:00');
  await sync.refresh();
  assert.ok(
    lines.some((line) => line.includes('[DEBUG]')),
    'debug lines are written',
  );
  for (const secret of SECRETS) {
    assert.ok(!lines.join('\n').includes(secret), `the logs contain "${secret}"`);
  }
});

test('a repeated failure logs one line when it starts and one when it ends', async (t) => {
  const portal = createFakePortal();
  let down = true;
  const flaky = {
    ...portal,
    fetch: async (...args) => {
      if (down) {
        throw new TypeError('fetch failed');
      }
      return portal.fetch(...args);
    },
  };
  const { sync } = await setup(t, { portal: flaky });
  const lines = captureLogs(t, 'info');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await sync.refresh()).ok, false);
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[ERROR\].*Reading the ista portal failed: fetch failed/);

  down = false;
  assert.equal((await sync.refresh()).ok, true);
  await sync.refresh();
  // The first sign-in, and the recovery.
  assert.equal(lines.length, 3);
  assert.match(lines[1], /\[INFO\].*Signed in/);
  assert.match(lines[2], /\[INFO\].*answers again/);
});

test('the connection test writes one line', async (t) => {
  const { gladys } = await setup(t, { config: { ...ACCOUNT, password: 'wrong' } });
  const lines = captureLogs(t, 'info');
  await gladys.fake.action('test_connection', {});
  await gladys.fake.action('test_connection', {});
  // The refused sign-in once, then one line per test.
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\[WARN\].*Sign-in to the ista portal failed/);
  assert.match(lines[1], /\[INFO\].*Connection test: failed \(status_invalid_credentials\)/);
  assert.match(lines[2], /\[INFO\].*Connection test: failed/);
});
