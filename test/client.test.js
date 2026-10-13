import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AUTH_ERRORS,
  AuthError,
  IstaClient,
  PortalError,
  findAuthenticateLink,
  findLoginForm,
  nextDay,
  safeUrl,
} from '../src/ista/client.js';
import { CookieJar, cookiesFromPastedText } from '../src/ista/cookies.js';
import { KINDS } from '../src/ista/parse.js';
import { normalizeConfig } from '../src/config.js';
import { ACCOUNT, createFakePortal, fixture } from './helpers/fakePortal.js';

const logger = createLogger({ level: 'silent' });

function memorySessionStore() {
  const store = { saved: null };
  store.load = () => store.saved ?? [];
  store.save = (cookies) => {
    store.saved = JSON.parse(JSON.stringify(cookies));
  };
  return store;
}

function client(portal, config = {}, sessionStore = memorySessionStore()) {
  return new IstaClient({
    config: normalizeConfig({ ...ACCOUNT, ...config }),
    fetch: portal.fetch,
    sessionStore,
    logger,
  });
}

test('signs in through the identity server and reads a day of heating', async () => {
  const portal = createFakePortal();
  const sessionStore = memorySessionStore();
  const ista = client(portal, {}, sessionStore);
  const points = await ista.fetchDay(KINDS.HEATING, '2026-10-10');
  assert.equal(points.length, 3);
  assert.equal(portal.logins, 1);
  // The first read had no session: it was sent to the login, signed in, retried.
  const reads = portal.requests.filter((r) => r.url.includes('ficheLogement.do'));
  assert.equal(reads.length, 2);
  assert.match(reads[1].url, /dispatch=calculeConsommationChauffageRfcPourLogement/);
  assert.match(reads[1].url, /start=2026-10-10&end=2026-10-11/);
  assert.match(reads[1].cookie, /JSESSIONID=session-1/);
  // The session survives a restart.
  assert.ok(sessionStore.saved.some((c) => c.name === 'JSESSIONID'));
});

test('reuses the saved session instead of signing in again', async () => {
  const portal = createFakePortal();
  const sessionStore = memorySessionStore();
  await client(portal, {}, sessionStore).fetchDay(KINDS.HEATING, '2026-10-10');
  const restarted = client(portal, {}, sessionStore);
  await restarted.fetchDay(KINDS.HEATING, '2026-10-11');
  assert.equal(portal.logins, 1);
});

test('signs in again once when the session expired', async () => {
  const portal = createFakePortal();
  const ista = client(portal);
  await ista.fetchDay(KINDS.HEATING, '2026-10-10');
  portal.expireSessions();
  await ista.fetchDay(KINDS.HEATING, '2026-10-11');
  assert.equal(portal.logins, 2);
});

test('the public home page is followed to Keycloak, and a fake account is refused', async () => {
  // Home -> "Se connecter" link -> Keycloak form -> refused password: the
  // path of the live portal, checked without credentials on 2026-10-13.
  const portal = createFakePortal({ homeFirst: true });
  await assert.rejects(
    client(portal, { email: 'nobody@example.org', password: 'wrong' }).login(),
    (err) => err instanceof AuthError && err.code === AUTH_ERRORS.INVALID_CREDENTIALS,
  );
  const visited = portal.requests.map((r) => new URL(r.url));
  assert.deepEqual(
    visited
      .slice(0, 4)
      .map((u) => `${u.host}${u.pathname}?${u.searchParams.get('dispatch') ?? ''}`),
    [
      'ista-webconso.fr/espace-client-v2/public/home.do?authenticate',
      'ista-webconso.fr/espace-client-v2/public/home.do?init',
      'ista-webconso.fr/espace-client-v2/public/home.do?authenticate',
      'login.ista.com/realms/dsp-webconso-fr/protocol/openid-connect/auth?',
    ],
  );
  assert.equal(visited.at(-1).pathname, '/realms/dsp-webconso-fr/login-actions/authenticate');
});

test('a page with neither form nor sign-in link is a portal change', async () => {
  const fetch = async () => new Response('<html><p>Maintenance</p></html>', { status: 200 });
  const ista = new IstaClient({ config: normalizeConfig(ACCOUNT), fetch, logger });
  await assert.rejects(ista.login(), (err) => err.code === AUTH_ERRORS.LOGIN_FORM_NOT_FOUND);
});

test('a refused password is reported as such', async () => {
  const portal = createFakePortal();
  await assert.rejects(
    client(portal, { password: 'wrong' }).fetchDay(KINDS.HEATING, '2026-10-10'),
    (err) => err instanceof AuthError && err.code === AUTH_ERRORS.INVALID_CREDENTIALS,
  );
});

test('a second factor or a captcha is reported, so the user picks the cookie mode', async () => {
  await assert.rejects(
    client(createFakePortal({ afterLogin: 'login-otp.html' })).login(),
    (err) => err.code === AUTH_ERRORS.TWO_FACTOR,
  );
  await assert.rejects(
    client(createFakePortal({ loginPage: 'login-captcha.html' })).login(),
    (err) => err.code === AUTH_ERRORS.CAPTCHA,
  );
});

test('missing credentials never reach the portal', async () => {
  const portal = createFakePortal();
  await assert.rejects(
    client(portal, { email: '', password: '' }).login(),
    (err) => err.code === AUTH_ERRORS.NO_CREDENTIALS,
  );
  assert.equal(portal.requests.length, 0);
});

test('an unknown login page is reported as a portal change', async () => {
  const portal = createFakePortal();
  const fetch = async (url, init) =>
    url.includes('login.ista.com')
      ? new Response('<html><p>Maintenance</p></html>', { status: 503 })
      : portal.fetch(url, init);
  const ista = new IstaClient({ config: normalizeConfig(ACCOUNT), fetch, logger });
  await assert.rejects(ista.login(), (err) => err.code === AUTH_ERRORS.LOGIN_FORM_NOT_FOUND);
});

test('the cookie mode sends the pasted cookie and never tries to sign in', async () => {
  const portal = createFakePortal();
  portal.sessions.add('pasted-session');
  const ista = client(portal, {
    auth_mode: 'cookie',
    email: '',
    password: '',
    session_cookie: 'JSESSIONID=pasted-session; SRV=web01',
  });
  const points = await ista.fetchDay(KINDS.HEATING, '2026-10-10');
  assert.equal(points.length, 3);
  portal.expireSessions();
  await assert.rejects(
    ista.fetchDay(KINDS.HEATING, '2026-10-11'),
    (err) => err.code === AUTH_ERRORS.SESSION_EXPIRED,
  );
  assert.equal(portal.logins, 0);
  assert.ok(!portal.requests.some((r) => r.method === 'POST'));
});

test('a page the portal does not know is a PortalError', async () => {
  const portal = createFakePortal();
  await assert.rejects(client(portal).fetchDay(KINDS.COLD_WATER, '2026-10-10'), PortalError);
});

test('findLoginForm reads the Keycloak form', () => {
  const form = findLoginForm(fixture('login-page.html'), 'https://login.ista.com/x');
  assert.equal(
    form.action,
    'https://login.ista.com/realms/dsp-webconso-fr/login-actions/authenticate?session_code=SESSIONCODE&execution=EXECUTION&client_id=dsp-webconso-fr&tab_id=TABID&client_data=CLIENTDATA',
  );
  assert.equal(form.userField, 'username');
  assert.equal(form.passwordField, 'password');
  assert.deepEqual(form.hidden, { credentialId: '' });
  assert.equal(findLoginForm(fixture('login-otp.html'), 'https://login.ista.com/'), null);
  // The older portal form (login / pwd) is recognized too.
  const legacy = findLoginForm(
    '<form action="/espace-client-v2/login.do" method="post"><input name="login" type="text"><input name="pwd" type="password"></form>',
    'https://ista-webconso.fr/espace-client-v2/',
  );
  assert.deepEqual(
    [legacy.action, legacy.userField, legacy.passwordField],
    ['https://ista-webconso.fr/espace-client-v2/login.do', 'login', 'pwd'],
  );
});

test('findAuthenticateLink reads the sign-in link of the public home page', () => {
  assert.equal(
    findAuthenticateLink(
      fixture('public-home.html'),
      'https://ista-webconso.fr/espace-client-v2/public/home.do?dispatch=init',
    ),
    'https://ista-webconso.fr/espace-client-v2/public/home.do?dispatch=authenticate',
  );
  assert.equal(findLoginForm(fixture('public-home.html'), 'https://ista-webconso.fr/'), null);
  // A link to another site is never followed.
  assert.equal(
    findAuthenticateLink(
      '<a href="https://evil.example/x?dispatch=authenticate">x</a>',
      'https://ista-webconso.fr/',
    ),
    null,
  );
});

test('the cookie jar follows domains and paths', () => {
  const jar = new CookieJar();
  const response = new Response(null, {
    headers: [
      ['set-cookie', 'A=1; Path=/espace-client-v2'],
      ['set-cookie', 'B=2; Domain=.ista-webconso.fr; Path=/'],
      ['set-cookie', 'C=3; Max-Age=0'],
    ],
  });
  jar.storeFrom(response, 'https://ista-webconso.fr/espace-client-v2/x');
  assert.equal(jar.headerFor('https://ista-webconso.fr/espace-client-v2/y'), 'A=1; B=2');
  assert.equal(jar.headerFor('https://www.ista-webconso.fr/espace-client-v2/y'), 'B=2');
  assert.equal(jar.headerFor('https://ista-webconso.fr/other'), 'B=2');
  assert.equal(jar.headerFor('https://login.ista.com/'), '');
  jar.storeFrom(
    new Response(null, { headers: [['set-cookie', 'A=gone; Path=/espace-client-v2; Max-Age=0']] }),
    'https://ista-webconso.fr/espace-client-v2/x',
  );
  assert.equal(jar.has('A', 'ista-webconso.fr'), false);
});

test('a pasted cookie may be a bare value or a Cookie header', () => {
  assert.deepEqual(
    cookiesFromPastedText('ABC123', 'ista-webconso.fr').map((c) => [c.name, c.value]),
    [['JSESSIONID', 'ABC123']],
  );
  assert.deepEqual(
    cookiesFromPastedText('Cookie: JSESSIONID=ABC; SRV=web01', 'ista-webconso.fr').map((c) => [
      c.name,
      c.value,
    ]),
    [
      ['JSESSIONID', 'ABC'],
      ['SRV', 'web01'],
    ],
  );
  assert.deepEqual(cookiesFromPastedText('  ', 'ista-webconso.fr'), []);
});

test('helpers', () => {
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(
    safeUrl('https://ista-webconso.fr/espace-client-v2/callback?code=ONE-TIME-CODE'),
    'ista-webconso.fr/espace-client-v2/callback',
  );
});
