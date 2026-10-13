import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('defaults fill an empty configuration', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(DEFAULT_CONFIG.poll_interval_hours, 12);
});

test('the reading interval is a whole number of hours between 3 and 24', () => {
  assert.equal(normalizeConfig({ poll_interval_hours: '6' }).poll_interval_hours, 6);
  assert.equal(normalizeConfig({ poll_interval_hours: 1 }).poll_interval_hours, 3);
  assert.equal(normalizeConfig({ poll_interval_hours: 48 }).poll_interval_hours, 24);
  assert.equal(normalizeConfig({ poll_interval_hours: 'abc' }).poll_interval_hours, 12);
  assert.equal(normalizeConfig({ poll_interval_hours: 7.6 }).poll_interval_hours, 8);
});

test('unknown choices fall back to the defaults, texts are trimmed', () => {
  const config = normalizeConfig({
    auth_mode: 'magic',
    language: 'it',
    email: '  me@example.org ',
    session_cookie: ' JSESSIONID=x ',
  });
  assert.equal(config.auth_mode, 'credentials');
  assert.equal(config.language, 'fr');
  assert.equal(config.email, 'me@example.org');
  assert.equal(config.session_cookie, 'JSESSIONID=x');
});

test('hasCredentials follows the sign-in method', () => {
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c', password: 'p' })), true);
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c' })), false);
  assert.equal(hasCredentials(normalizeConfig({ auth_mode: 'cookie', session_cookie: 'x' })), true);
  assert.equal(
    hasCredentials(normalizeConfig({ auth_mode: 'cookie', email: 'a', password: 'b' })),
    false,
  );
});
