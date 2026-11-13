// -----------------------------------------------------------------------------
// An in-memory ista portal for the tests: a `fetch` replacement that plays the
// portal (ista-webconso.fr) and its identity server (login.ista.com) the way
// the client expects them, with the anonymized fixtures of test/fixtures/portal.
// No network, ever.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { CALLBACK_PATH } from '../../src/ista/client.js';

export const FIXTURES = new URL('../fixtures/portal/', import.meta.url);

export function fixture(name) {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

/** `DD/MM/YYYY` of a `YYYYMMDD` date. */
/**
 * The index page as the portal renders it, from the fixture templates.
 * @param {object} values placeholders: dispatch, csrf, water, heating,
 *   heatingIndex, dateMax, heatingMax, from, day, waterResult, heatingResult
 */
export function renderIndexPage(values) {
  const heatingTab = values.heatingIndex
    ? fixture('index-heating-tab.html').replace('{{HEATING_MAX}}', values.heatingMax ?? '') +
      (values.heatingResult ?? '')
    : '';
  const meters = (values.waterResult ?? '').match(/class="le-compteur"/g)?.length ?? 0;
  return fixture('index-page.html')
    .replace('{{WATER_RESULT}}', values.waterResult ?? '')
    .replace('{{HEATING_TAB}}', heatingTab)
    .replaceAll('{{CSRF}}', values.csrf)
    .replaceAll('{{DISPATCH}}', values.dispatch ?? 'init')
    .replaceAll('{{WATER}}', String(values.water ?? true))
    .replaceAll('{{HEATING}}', String(values.heating ?? false))
    .replaceAll('{{HEATING_INDEX}}', String(values.heatingIndex ?? false))
    .replaceAll('{{METERS}}', String(meters))
    .replaceAll('{{CHOSEN}}', values.day ? 'true' : 'false')
    .replaceAll('{{FROM}}', values.from ?? '')
    .replaceAll('{{DAY}}', values.day ?? '')
    .replaceAll('{{DATE_MAX}}', values.dateMax ?? '');
}

/** The meter blocks of a search answer, dated with the period asked. */
export function meterBlocks(name, from, day) {
  return fixture(name).replaceAll('{{FROM}}', from).replaceAll('{{DAY}}', day);
}

// Fake secrets: the tests check none of them ever reaches a log line.
export const ACCOUNT = {
  email: 'resident@example.org',
  password: 'S3cret-Passw0rd!',
};

const PORTAL = 'https://ista-webconso.fr';
const WWW_PORTAL = 'https://www.ista-webconso.fr';
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

/**
 * @param {object} [options]
 * @param {string} [options.loginPage] fixture served as the login page
 * @param {string} [options.afterLogin] fixture served after a correct password
 *   (a second factor page, for instance); the portal otherwise
 * @param {boolean} [options.homeFirst] the first sign-in link lands on the
 *   public home page again (the client must follow its link)
 * @param {object} [options.index] what the index page offers: `water`
 *   (true), `heating` and `heatingIndex` (false), `dateMax` (`YYYYMMDD`,
 *   20261010), `heatingMax` (`YYYY/MM/DD`)
 * @param {'redirect'|'lost'|'error'} [options.callback] how the sign-in callback
 *   (public/loginIpmp.do) answers a good code: like a resident's browser saw it, a redirect to
 *   monCompte.do with a new SameSite=Strict session (default); the same without a session behind
 *   the cookie; its error page
 * @param {boolean} [options.strictCallback] a pre-login SameSite=Strict session, which makes the
 *   callback fail when it comes back with it
 * @param {Function} [options.answer] `(dispatch, form) => string | Response`,
 *   the meter blocks of a search (form: the posted URLSearchParams); defaults
 *   to the water fixture for water and the heating one for heating
 */
export function createFakePortal(options = {}) {
  const portal = {
    requests: [],
    searches: [],
    logins: 0,
    authenticateHits: 0,
    sessions: new Set(),
    indexMenuOpened: new Set(),
    dashboardSeen: new Set(),
    index: {
      water: true,
      heating: false,
      heatingIndex: false,
      dateMax: '20261010',
      ...options.index,
    },
    expireSessions() {
      portal.sessions.clear();
      csrfTokens.clear();
    },
  };
  let sessionCounter = 0;
  let csrfCounter = 0;
  const csrfTokens = new Set();
  const loginPage = options.loginPage ?? 'login-page.html';
  const answer =
    options.answer ??
    ((dispatch, form) =>
      dispatch === 'voirIndexDemandeChauffageRfc'
        ? meterBlocks(
            'index-heating-meters.html',
            form.get('dateDebutPeriodeIndexChauffageRfc'),
            form.get('dateIndexDemandeChauffageRfc'),
          )
        : meterBlocks(
            'index-water-meters.html',
            form.get('dateDebutPeriodeIndex'),
            form.get('dateIndexDemande'),
          ));
  const indexPage = (extra = {}) => {
    csrfCounter += 1;
    const csrf = `csrf-${csrfCounter}`;
    // Strict: only the token of the latest page is accepted (the live portal
    // renews it on every page; whether it refuses an older one is unknown).
    csrfTokens.clear();
    csrfTokens.add(csrf);
    return html(renderIndexPage({ ...portal.index, csrf, ...extra }));
  };

  portal.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const cookies = cookiesOf(init.headers);
    portal.requests.push({
      method,
      url: url.toString(),
      cookie: init.headers?.Cookie ?? '',
      referer: init.headers?.Referer,
      origin: init.headers?.Origin,
    });
    const signedIn = portal.sessions.has(cookies.JSESSIONID);
    // Like the live portal: no redirect_uri nor state, the client's own redirect_uri applies.
    const toLogin = () =>
      redirect(
        `${LOGIN}/protocol/openid-connect/auth?client_id=dsp-webconso-fr&response_type=code`,
      );

    const toHome = () => redirect(`${PORTAL}/espace-client-v2/public/home.do?dispatch=init`);
    // Like the live portal: the bare resident space lands on a public home
    // page whose "Se connecter" link (dispatch=authenticate) leads to Keycloak.
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2') {
      return redirect(`${PORTAL}/espace-client-v2/`);
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/') {
      return signedIn ? html('<html>Accueil</html>') : toHome();
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/public/home.do') {
      if (url.searchParams.get('dispatch') === 'authenticate') {
        portal.authenticateHits += 1;
        // `homeFirst`: the first sign-in attempt lands on the home page again.
        if (options.homeFirst && portal.authenticateHits === 1) {
          return toHome();
        }
        if (options.strictCallback) {
          // Like the live portal: a pre-login session, SameSite=Strict.
          const response = toLogin();
          response.headers.append(
            'Set-Cookie',
            'JSESSIONID=pre-login; Path=/espace-client-v2; Secure; HttpOnly; SameSite=Strict',
          );
          return response;
        }
        return toLogin();
      }
      return html(fixture('public-home.html'));
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
        // options.wwwCallback: the identity server sends back to www.ista-webconso.fr, which
        // then sets a host-only session cookie there (the live portal answers on both hosts).
        const callbackOrigin = options.wwwCallback ? WWW_PORTAL : PORTAL;
        // Like the live identity server: back to the redirect_uri of its client, with a code.
        return redirect(
          `${callbackOrigin}${CALLBACK_PATH}?dispatch=loginTenant&session_state=SESSION-STATE&iss=${encodeURIComponent(LOGIN)}&code=ONE-TIME-CODE`,
        );
      }
    }
    if ((url.origin === PORTAL || url.origin === WWW_PORTAL) && url.pathname === CALLBACK_PATH) {
      // Like the live portal (checked with a made-up code, 2026-11-10): a bad callback answers
      // its error page, HTTP 200, at the callback address.
      const callbackFails =
        options.callback === 'error' ||
        !url.searchParams.get('code') ||
        // `strictCallback`: the pre-login session (SameSite=Strict) must not come back with it.
        (options.strictCallback && cookies.JSESSIONID === 'pre-login');
      if (callbackFails) {
        return html(fixture('callback-error.html'));
      }
      sessionCounter += 1;
      const session = `session-${sessionCounter}`;
      if (options.callback !== 'lost') {
        portal.sessions.add(session);
      }
      // Like a resident's browser (2026-11-10): loginIpmp.do 302 → monCompte.do 302 →
      // ficheLogement.do → the dashboard. The new session must reach monCompte.do.
      return redirect(`${PORTAL}/espace-client-v2/monCompte.do?dispatch=init`, [
        `JSESSIONID=${session}; Path=/espace-client-v2; Secure; HttpOnly; SameSite=Strict`,
        'SRV=web01; Path=/',
      ]);
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/monCompte.do') {
      // Without a session the live page answers the error page, HTTP 200 (checked 2026-11-10).
      return signedIn
        ? redirect(`${PORTAL}/espace-client-v2/occupant/ficheLogement.do?dispatch=init`)
        : html(fixture('callback-error.html'));
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/occupant/ficheLogement.do') {
      return signedIn
        ? redirect(`${PORTAL}/espace-client-v2/occupant/tableauBordLogement.do?dispatch=init`)
        : toHome();
    }
    if (
      (url.origin === PORTAL || url.origin === WWW_PORTAL) &&
      url.pathname === '/espace-client-v2/occupant/tableauBordLogement.do'
    ) {
      if (!signedIn) {
        return toHome();
      }
      portal.dashboardSeen.add(cookies.JSESSIONID);
      return html('<html><body>Tableau de bord</body></html>');
    }
    if (url.origin === PORTAL && url.pathname === '/espace-client-v2/menu.do') {
      // Like the live portal: the menu entry only works when followed from the dashboard.
      const fromDashboard =
        portal.dashboardSeen.has(cookies.JSESSIONID) &&
        (init.headers?.Referer ?? '').includes('/occupant/tableauBordLogement.do');
      if (!signedIn || options.menuToHome || !fromDashboard) {
        return toHome();
      }
      if (url.searchParams.get('id') === 'lgtOcc_index') {
        portal.indexMenuOpened.add(cookies.JSESSIONID);
      }
      return redirect(`${PORTAL}/espace-client-v2/occupant/ficheIndexDemande.do`);
    }
    if (
      url.origin === PORTAL &&
      url.pathname === '/espace-client-v2/occupant/ficheIndexDemande.do'
    ) {
      if (!signedIn) {
        return toHome();
      }
      if (method === 'GET') {
        // Like the live portal: opened without its menu entry, the page has no form.
        return portal.indexMenuOpened.has(cookies.JSESSIONID)
          ? indexPage()
          : html('<html><body>Index à la demande</body></html>');
      }
      const form = new URLSearchParams(init.body);
      portal.searches.push(form);
      if (!csrfTokens.has(form.get('_csrf'))) {
        return html('<html>Forbidden</html>', [], 403);
      }
      const dispatch = form.get('dispatch');
      const result = answer(dispatch, form);
      if (result instanceof Response) {
        return result;
      }
      return dispatch === 'voirIndexDemandeChauffageRfc'
        ? indexPage({ dispatch, heatingResult: result })
        : indexPage({
            dispatch,
            waterResult: result,
            from: form.get('dateDebutPeriodeIndex'),
            day: form.get('dateIndexDemande'),
          });
    }
    return html('<html>Not found</html>', [], 404);
  };
  return portal;
}
