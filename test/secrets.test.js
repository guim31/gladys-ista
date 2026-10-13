// -----------------------------------------------------------------------------
// Credentials never reach the logs: not the e-mail, not the password, not a
// session cookie, not the one-time code of a login redirect. The logs end up
// in forum posts and bug reports. Every path is exercised at debug level:
// sign-in, readings, an expired session, refused credentials, an unexpected
// answer, the cookie mode.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT, createFakePortal } from './helpers/fakePortal.js';
import { setup } from './helpers/setup.js';

const SECRETS = [
  ACCOUNT.email,
  ACCOUNT.password,
  'session-1',
  'session-2',
  'pasted-session',
  'ONE-TIME-CODE',
  'auth-1',
  'SESSIONCODE',
];

function captureLogs(t) {
  const lines = [];
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const record = (...args) =>
    lines.push(
      args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '),
    );
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.after(() => {
    process.env.LOG_LEVEL = previousLevel;
  });
  return lines;
}

function assertNoSecret(text, where) {
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), `${where} contains "${secret}"`);
  }
}

test('no credential in the logs, whatever happens', async (t) => {
  const lines = captureLogs(t);
  const portal = createFakePortal();
  const { gladys, sync, clock } = await setup(t, { portal });

  await gladys.fake.action('test_connection', {});
  portal.expireSessions();
  clock.now = new Date('2026-10-13T10:00:00');
  await sync.refresh();

  // Refused password.
  await gladys.fake.configUpdated({ ...ACCOUNT, password: `${ACCOUNT.password}-old` });
  await gladys.fake.action('test_connection', {});

  // An answer in an unknown format, carrying personal data.
  const odd = createFakePortal({
    answer: () => ({ erreur: { utilisateur: ACCOUNT.email, jeton: 'session-1' } }),
  });
  const second = await setup(t, { portal: odd });
  await second.gladys.fake.action('test_connection', {});

  // Cookie mode, then the pasted cookie expires.
  const cookiePortal = createFakePortal();
  cookiePortal.sessions.add('pasted-session');
  const third = await setup(t, {
    portal: cookiePortal,
    config: { auth_mode: 'cookie', session_cookie: 'JSESSIONID=pasted-session' },
  });
  await third.sync.refresh();
  cookiePortal.expireSessions();
  third.clock.now = new Date('2026-10-13T10:00:00');
  await third.gladys.fake.action('test_connection', {});

  assert.ok(lines.length > 5, 'the scenario logs something');
  assertNoSecret(lines.join('\n'), 'the logs');

  // Nor in what Gladys receives and shows (connection status, action results).
  for (const fake of [gladys.fake, second.gladys.fake, third.gladys.fake]) {
    assertNoSecret(JSON.stringify(fake.wsMessages), 'a WebSocket message');
    assertNoSecret(JSON.stringify(fake.connectionStatuses), 'a connection status');
    assertNoSecret(JSON.stringify(fake.discoveredDevices), 'the discovered devices');
  }
});

test('/data holds the session, never the password or the e-mail', async (t) => {
  const { gladys, dir } = await setup(t);
  await gladys.fake.action('test_connection', {});
  const files = readdirSync(dir);
  assert.deepEqual(files.sort(), ['session.json', 'state.json']);
  const state = readFileSync(join(dir, 'state.json'), 'utf8');
  assert.ok(!state.includes(ACCOUNT.email) && !state.includes(ACCOUNT.password));
  const session = readFileSync(join(dir, 'session.json'), 'utf8');
  assert.ok(!session.includes(ACCOUNT.email) && !session.includes(ACCOUNT.password));
  assert.ok(session.includes('JSESSIONID'));
});

test('new credentials drop the session of the previous ones', async (t) => {
  const { gladys, store } = await setup(t);
  await gladys.fake.action('test_connection', {});
  assert.ok(store.session.load().length > 0);
  await gladys.fake.configUpdated({ ...ACCOUNT, email: 'other@example.org' });
  assert.deepEqual(store.session.load(), []);
});
