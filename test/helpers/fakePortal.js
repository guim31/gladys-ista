// -----------------------------------------------------------------------------
// An in-memory ista portal for the tests: a `fetch` replacement that plays the
// portal (ista-webconso.fr) and its identity server (login.ista.com) the way
// the client expects them, with the anonymized fixtures of test/fixtures/portal.
// No network, ever.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const FIXTURES = new URL('../fixtures/portal/', import.meta.url);

export function fixture(name) {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

export function jsonFixture(name) {
  return JSON.parse(fixture(name));
}

// Fake secrets: the tests check none of them ever reaches a log line.
export const ACCOUNT = {
  email: 'resident@example.org',
  password: 'S3cret-Passw0rd!',
};

const PORTAL = 'https://ista-webconso.fr';
const LOGIN = 'https://login.ista.com/realms/dsp-webconso-fr';

function cookiesOf(headers) {
  const header = headers?.Cookie ?? '';
  return Object.fromEntries(
    header
      .split(';')
      .map((pair) => pair.trim().split('='))
      .filter(([name]) => name),
  );
}

function redirect(location, setCookies = []) {
  const headers = new Headers({ location });
  for (const cookie of setCookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
}

function html(body, setCookies = [], status = 200) {
  const headers = new Headers({ 'content-type': 'text/html;charset=UTF-8' });
  for (const cookie of setCookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(body, { status, headers });
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json;charset=UTF-8' },
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.loginPage] fixture served as the login page
 * @param {string} [options.afterLogin] fixture served after a correct password
 *   (a second factor page, for instance); the portal otherwise
 * @param {Function} [options.answer] `(dispatch, day) => object | Response`,
 *   the consumption answer; defaults to the heating fixture for heating and a
 *   404 for water
 */
export function createFakePortal(options = {}) {
  const portal = {
    requests: [],
    logins: 0,
    sessions: new Set(),
    expireSessions() {
      portal.sessions.clear();
    },
  };
  let sessionCounter = 0;
  const loginPage = options.loginPage ?? 'login-page.html';
  const answer =
    options.answer ??
    ((dispatch) =>
      dispatch === 'calculeConsommationChauffageRfcPourLogement'
        ? jsonFixture('heating-day.json')
        : new Response('<html>Erreur</html>', { status: 404 }));

  portal.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const cookies = cookiesOf(init.headers);
    portal.requests.push({ method, url: url.toString(), cookie: init.headers?.Cookie ?? '' });
    const signedIn = portal.sessions.has(cookies.JSESSIONID);
    const toLogin = () =>
      redirect(
        `${LOGIN}/protocol/openid-connect/auth?client_id=dsp-webconso-fr&response_type=code&redirect_uri=${encodeURIComponent(`${PORTAL}/espace-client-v2/callback`)}&state=STATE`,
      );

    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/') {
      return signedIn ? html('<html>Accueil</html>') : toLogin();
    }
    if (url.origin === LOGIN.replace(/\/realms.*/, '')) {
      if (url.pathname.endsWith('/protocol/openid-connect/auth')) {
        return html(fixture(loginPage), [
          'AUTH_SESSION_ID=auth-1; Path=/realms/dsp-webconso-fr/; Secure; HttpOnly',
        ]);
      }
      if (url.pathname.endsWith('/login-actions/authenticate') && method === 'POST') {
        const form = new URLSearchParams(init.body);
        const valid =
          cookies.AUTH_SESSION_ID === 'auth-1' &&
          form.get('username') === ACCOUNT.email &&
          form.get('password') === ACCOUNT.password;
        if (!valid) {
          return html(fixture('login-error.html'));
        }
        if (options.afterLogin) {
          return html(fixture(options.afterLogin));
        }
        portal.logins += 1;
        return redirect(`${PORTAL}/espace-client-v2/callback?code=ONE-TIME-CODE&state=STATE`);
      }
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/callback') {
      sessionCounter += 1;
      const session = `session-${sessionCounter}`;
      portal.sessions.add(session);
      return redirect(`${PORTAL}/espace-client-v2/`, [
        `JSESSIONID=${session}; Path=/espace-client-v2; HttpOnly`,
        'SRV=web01; Path=/',
      ]);
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/occupant/ficheLogement.do') {
      if (!signedIn) {
        return toLogin();
      }
      const result = answer(url.searchParams.get('dispatch'), url.searchParams.get('start'));
      return result instanceof Response ? result : json(result);
    }
    return html('<html>Not found</html>', [], 404);
  };
  return portal;
}
