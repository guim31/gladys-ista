import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AUTH_ERRORS,
  AuthError,
  IstaClient,
  PortalError,
  describeHop,
  findAuthenticateLink,
  findLoginForm,
  findPageRedirect,
  periodStart,
  safeUrl,
} from '../src/ista/client.js';
import { CookieJar, cookiesFromPastedText } from '../src/ista/cookies.js';
import { KINDS, UnexpectedAnswerError } from '../src/ista/parse.js';
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

// Opening the page goes through its menu entry (GET menu.do, redirected to the page);
// a search is a POST of the page's form.
const indexRequests = (portal) =>
  portal.requests.filter(
    (r) =>
      r.url.includes('menu.do?id=lgtOcc_index') ||
      (r.method === 'POST' && r.url.includes('ficheIndexDemande.do')),
  );

/** Open the index page and search the water indexes, as a run does. */
async function readWater(ista) {
  const page = await ista.openIndexPage();
  return (await ista.searchIndexes(page, 'water')).meters;
}

function client(portal, config = {}, sessionStore = memorySessionStore()) {
  return new IstaClient({
    config: normalizeConfig({ ...ACCOUNT, ...config }),
    fetch: portal.fetch,
    sessionStore,
    logger,
  });
}

test('signs in, opens the index page and searches the latest water indexes', async () => {
  const portal = createFakePortal();
  const sessionStore = memorySessionStore();
  const ista = client(portal, {}, sessionStore);
  const meters = await readWater(ista);
  assert.deepEqual(
    meters.map((m) => [m.kind, m.index, m.day]),
    [
      [KINDS.COLD_WATER, 123.456, '2026-10-10'],
      [KINDS.HOT_WATER, 45.678, '2026-10-10'],
    ],
  );
  assert.equal(portal.logins, 1);
  // The first GET had no session: it was sent to the login, signed in, retried.
  assert.deepEqual(
    indexRequests(portal).map((r) => r.method),
    ['GET', 'GET', 'POST'],
  );
  // The search is the page's own form, with the browser's fields set.
  const [search] = portal.searches;
  assert.equal(search.get('_csrf'), 'csrf-1');
  assert.equal(search.get('dispatch'), 'voirIndexDemande');
  assert.equal(search.get('choixOnglet'), 'EAU');
  assert.equal(search.get('indexChoisi'), 'true');
  assert.equal(search.get('dateIndexDemande'), '10/10/2026');
  assert.equal(search.get('dateDebutPeriodeIndex'), '09/10/2026');
  assert.equal(search.get('dateMaxIndex'), '20261010');
  // Line breaks sent as CRLF, entities decoded, as a browser does.
  assert.match(search.get('uex.adressePostale'), /RUE DE L'EXEMPLE\r\n\s+00000 VILLE-FICTIVE/);
  assert.match(indexRequests(portal)[2].cookie, /JSESSIONID=session-1/);
  // The session survives a restart.
  assert.ok(sessionStore.saved.some((c) => c.name === 'JSESSIONID'));
});

test('reuses the saved session instead of signing in again', async () => {
  const portal = createFakePortal();
  const sessionStore = memorySessionStore();
  await readWater(client(portal, {}, sessionStore));
  await readWater(client(portal, {}, sessionStore));
  assert.equal(portal.logins, 1);
});

test('a session lost between the page and the search: one sign-in, a fresh form', async () => {
  const portal = createFakePortal();
  const ista = client(portal);
  await readWater(ista);
  const page = await ista.openIndexPage();
  portal.expireSessions();
  const { meters } = await ista.searchIndexes(page, 'water');
  assert.equal(meters.length, 2);
  assert.equal(portal.logins, 2);
  // The search after the sign-in carries the token of the page opened again.
  const tokens = portal.searches.map((form) => form.get('_csrf'));
  assert.equal(tokens.at(-1), 'csrf-4');
});

test('the heating search uses the heating tab fields (hypothetical page)', async () => {
  const portal = createFakePortal({
    index: { heating: true, heatingIndex: true, heatingMax: '2026/10/08' },
  });
  const ista = client(portal);
  const page = await ista.openIndexPage();
  assert.equal(page.heatingIndex, true);
  const { meters } = await ista.searchIndexes(page, 'heating');
  assert.deepEqual(
    meters.map((m) => [m.id, m.kind, m.index, m.day]),
    [
      ['800000301', KINDS.HEATING, 1520, '2026-10-08'],
      ['800000302', KINDS.HEATING, 640, '2026-10-08'],
    ],
  );
  const [search] = portal.searches;
  assert.equal(search.get('dispatch'), 'voirIndexDemandeChauffageRfc');
  // The tab is only shown by the page script: the field is sent as it is.
  assert.equal(search.get('choixOnglet'), 'EAU');
  assert.equal(search.get('dateIndexDemandeChauffageRfc'), '08/10/2026');
  assert.equal(search.get('dateDebutPeriodeIndexChauffageRfc'), '07/10/2026');
});

test('a page without the index form is a portal change, described without values', async () => {
  const portal = createFakePortal();
  const fetch = async (url, init) =>
    url.includes('ficheIndexDemande.do') && portal.sessions.size > 0
      ? new Response('<html><form name="autre"><input name="x" value="secret"></form></html>')
      : portal.fetch(url, init);
  const ista = new IstaClient({ config: normalizeConfig(ACCOUNT), fetch, logger });
  await assert.rejects(
    ista.openIndexPage(),
    (err) =>
      err instanceof UnexpectedAnswerError &&
      JSON.stringify(err.shape) === '{"forms":["autre"]}' &&
      !err.message.includes('secret'),
  );
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
    readWater(client(portal, { password: 'wrong' })),
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

test('the sign-in callback goes without the pre-login SameSite=Strict session, like a browser', async () => {
  const portal = createFakePortal({ strictCallback: true });
  const ista = client(portal);
  const meters = await readWater(ista);
  assert.equal(meters.length, 2);
  assert.equal(portal.logins, 1);
});

test('the callback page (public/loginIpmp.do, HTTP 200) is not a lost session: the dashboard decides', async () => {
  // 1.1.5 to 1.1.7 stopped on this page because of its /public/ address ("no session kept").
  const portal = createFakePortal({ callback: 'page', strictCallback: true });
  const meters = await readWater(client(portal));
  assert.equal(meters.length, 2);
  assert.equal(portal.logins, 1);
  const paths = portal.requests.map((r) => new URL(r.url).pathname);
  const callback = paths.indexOf('/espace-client-v2/public/loginIpmp.do');
  assert.equal(paths[callback + 1], '/espace-client-v2/occupant/tableauBordLogement.do');
});

test('the script of the callback page is followed like a browser, never its logout button', async () => {
  const portal = createFakePortal({ strictCallback: true });
  await client(portal).login();
  const callback = portal.requests.findIndex((r) => r.url.includes('/public/loginIpmp.do'));
  const next = portal.requests[callback + 1];
  assert.match(next.url, /\/occupant\/tableauBordLogement\.do\?dispatch=init$/);
  // Same-site navigation from the callback page: the new SameSite=Strict session goes along.
  assert.match(next.cookie, /JSESSIONID=session-1/);
  assert.match(
    next.referer,
    /^https:\/\/ista-webconso\.fr\/espace-client-v2\/public\/loginIpmp\.do/,
  );
  assert.ok(!portal.requests.some((r) => r.url.includes('logout')));
});

test('the sign-in sends Referer and Origin as a browser does', async () => {
  const portal = createFakePortal({ strictCallback: true });
  await client(portal).login();
  const post = portal.requests.find((r) => r.method === 'POST');
  assert.equal(post.origin, 'https://login.ista.com');
  assert.match(post.referer, /^https:\/\/login\.ista\.com\/realms\/dsp-webconso-fr\/protocol\//);
  // Back on the portal, another origin: the identity server's origin only.
  const callback = portal.requests.find((r) => r.url.includes('/public/loginIpmp.do'));
  assert.equal(callback.referer, 'https://login.ista.com/');
  assert.equal(callback.origin, undefined);
  assert.ok(!callback.cookie.includes('pre-login'));
});

test('a session the portal does not keep: the log lists the sign-in hops, names only', async () => {
  const portal = createFakePortal({ callback: 'lost', strictCallback: true });
  await assert.rejects(client(portal).login(), (err) => {
    assert.equal(err.code, AUTH_ERRORS.SESSION_EXPIRED);
    assert.match(
      err.message,
      /the resident dashboard answered a public page at ista-webconso\.fr\/espace-client-v2\/public\/home\.do/,
    );
    assert.match(
      err.message,
      /sign-in steps: GET ista-webconso\.fr\/espace-client-v2\/public\/home\.do\?dispatch 302 set\[JSESSIONID\]/,
    );
    assert.match(
      err.message,
      /POST login\.ista\.com\/realms\/dsp-webconso-fr\/login-actions\/authenticate\?session_code,execution,client_id,tab_id,client_data 302 sent\[AUTH_SESSION_ID\]/,
    );
    assert.match(
      err.message,
      /GET ista-webconso\.fr\/espace-client-v2\/public\/loginIpmp\.do\?dispatch,session_state,iss,code 200 set\[JSESSIONID\]/,
    );
    for (const value of [
      'ONE-TIME-CODE',
      'SESSION-STATE',
      'session-1',
      'pre-login',
      'auth-1',
      ACCOUNT.email,
      ACCOUNT.password,
    ]) {
      assert.ok(!err.message.includes(value), `no ${value}`);
    }
    return true;
  });
});

test('the portal error page after the identity server is told as such', async () => {
  const portal = createFakePortal({ callback: 'error' });
  await assert.rejects(client(portal).login(), (err) => {
    assert.equal(err.code, AUTH_ERRORS.SESSION_EXPIRED);
    assert.match(
      err.message,
      /error page at ista-webconso\.fr\/espace-client-v2\/public\/loginIpmp\.do \(HTTP 200\)/,
    );
    assert.match(err.message, /sign-in steps: /);
    return true;
  });
  // Nothing after the error page: neither its logout button nor the dashboard.
  assert.match(portal.requests.at(-1).url, /\/public\/loginIpmp\.do\?/);
});

test('describeHop keeps names, never values, except an OAuth error code', () => {
  assert.equal(
    describeHop(
      'GET',
      'https://ista-webconso.fr/espace-client-v2/public/loginIpmp.do?dispatch=loginTenant&code=SECRET',
      200,
      {
        sent: ['ApplicationGatewayAffinity'],
        set: ['JSESSIONID'],
      },
    ),
    'GET ista-webconso.fr/espace-client-v2/public/loginIpmp.do?dispatch,code 200 sent[ApplicationGatewayAffinity] set[JSESSIONID]',
  );
  assert.equal(
    describeHop(
      'GET',
      'https://ista-webconso.fr/x?error=temporarily_unavailable&error_description=authentication expired <b>',
      200,
    ),
    'GET ista-webconso.fr/x?error,error_description 200 error=temporarily_unavailable error_description=authentication_expired__b_',
  );
});

test('findPageRedirect follows a meta refresh or a script, on the portal only', () => {
  const page =
    'https://ista-webconso.fr/espace-client-v2/public/loginIpmp.do?dispatch=loginTenant&code=X';
  assert.equal(
    findPageRedirect(fixture('callback-bounce.html'), page),
    'https://ista-webconso.fr/espace-client-v2/occupant/tableauBordLogement.do?dispatch=init',
  );
  assert.equal(
    findPageRedirect(
      '<meta http-equiv="refresh" content="0; url=/espace-client-v2/occupant/a.do">',
      page,
    ),
    'https://ista-webconso.fr/espace-client-v2/occupant/a.do',
  );
  assert.equal(
    findPageRedirect(
      '<script>window.location.replace("https://www.ista-webconso.fr/espace-client-v2/b.do")</script>',
      page,
    ),
    'https://www.ista-webconso.fr/espace-client-v2/b.do',
  );
  // Never: a button, a logout, a new sign-in, another site, a script file.
  assert.equal(findPageRedirect(fixture('callback-error.html'), page), null);
  assert.equal(
    findPageRedirect("<script>location.href='../public/login.do?dispatch=logout'</script>", page),
    null,
  );
  assert.equal(
    findPageRedirect("<script>location.href='home.do?dispatch=authenticate'</script>", page),
    null,
  );
  assert.equal(
    findPageRedirect("<script>location.href='https://evil.example/'</script>", page),
    null,
  );
  assert.equal(
    findPageRedirect('<script src="/x.js">location.href="/espace-client-v2/c.do"</script>', page),
    null,
  );
});

test('a sign-in that comes back on www.ista-webconso.fr keeps its session on the portal', async () => {
  const portal = createFakePortal({ wwwCallback: true });
  const ista = client(portal);
  const meters = await readWater(ista);
  assert.equal(meters.length, 2);
  assert.equal(portal.logins, 1);
});

test('a sign-in that does not hold says where the portal sent us, never what it holds', async () => {
  const portal = createFakePortal({ menuToHome: true });
  const ista = client(portal);
  await assert.rejects(ista.openIndexPage(), (err) => {
    assert.equal(err.code, AUTH_ERRORS.SESSION_EXPIRED);
    assert.match(
      err.message,
      /public page at ista-webconso\.fr\/espace-client-v2\/public\/home\.do/,
    );
    assert.ok(!err.message.includes('?'), 'no query string');
    return true;
  });
  assert.equal(portal.logins, 1);
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
  const meters = await readWater(ista);
  assert.equal(meters.length, 2);
  portal.expireSessions();
  await assert.rejects(ista.openIndexPage(), (err) => err.code === AUTH_ERRORS.SESSION_EXPIRED);
  assert.equal(portal.logins, 0);
  // Only the searches: never a sign-in form.
  assert.ok(
    portal.requests.every((r) => r.method === 'GET' || r.url.includes('ficheIndexDemande.do')),
  );
});

test('a refused search (expired CSRF token, server error) is a PortalError', async () => {
  const portal = createFakePortal({
    answer: () => new Response('<html>Erreur</html>', { status: 500 }),
  });
  await assert.rejects(readWater(client(portal)), PortalError);
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
  // A one-day period, never before the first day the portal allows.
  assert.equal(periodStart('2026-03-07', '2026-02-01'), '2026-03-06');
  assert.equal(periodStart('2026-02-01', '2026-02-01'), '2026-02-01');
  assert.equal(periodStart('2026-01-01', null), '2025-12-31');
  assert.equal(
    safeUrl('https://ista-webconso.fr/espace-client-v2/callback?code=ONE-TIME-CODE'),
    'ista-webconso.fr/espace-client-v2/callback',
  );
});
