// -----------------------------------------------------------------------------
// Client of the ista Web'conso resident portal (France).
//
// There is no public API: this client does what the resident's browser does.
//   1. Sign-in. The portal sends the browser to ista's identity server
//      (login.ista.com, a Keycloak realm). The client follows the same
//      redirects, fills the same login form, and comes back to the portal with
//      its session cookie (JSESSIONID). Or, when that does not work, it uses a
//      session cookie the user copied from their own browser.
//   2. Readings. The "index à la demande" page (index on demand) holds a form;
//      posting it back with a reading date answers the same page with one
//      block per meter (see parse.js). The page's own hidden fields (CSRF
//      token included) are sent back as the browser would.
// When the session expires, the client signs in again once and retries.
//
// Nothing here logs a URL query string, a cookie, an e-mail or a password: the
// login redirects carry one-time codes, and the logs end up in bug reports.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CookieJar, cookiesFromPastedText } from './cookies.js';
import { browserFetch } from './http.js';
import {
  KINDS,
  UnexpectedAnswerError,
  addDays,
  attribute,
  dayToFrench,
  textOf,
  describeIndexForm,
  fieldValue,
  looseDay,
  parseIndexForm,
  parseMeters,
} from './parse.js';

export const PORTAL_DOMAIN = 'ista-webconso.fr';
export const PORTAL_ORIGIN = `https://${PORTAL_DOMAIN}`;
// The resident space, where a browser starts: it redirects to the public home page
// (`public/home.do?dispatch=init`), whose "Résident" link (`?dispatch=authenticate`) redirects
// to ista's Keycloak login form. The same steps as a resident's browser (2026-11-10).
export const ENTRY_URL = `${PORTAL_ORIGIN}/espace-client-v2`;
// The site's root, where a typed `ista-webconso.fr` starts: it sets a second JSESSIONID, on the
// path `/` (checked live, 2026-11-19), then redirects to ENTRY_URL. A resident's browser sent two
// JSESSIONID of different values on the sign-in callback (Chrome, 2026-11-19): this one and the
// resident space's (path `/espace-client-v2`) are the only pair a browser can hold for that URL.
export const ROOT_URL = `${PORTAL_ORIGIN}/`;
// The two ways the sign-in is tried, at most once each per sign-in (never a loop: the account
// must not be locked). The log says which one worked, or what each one sent.
export const SIGN_IN_VARIANTS = [
  { name: 'space-session', entry: ENTRY_URL },
  { name: 'root-and-space-sessions', entry: ROOT_URL },
];
// Hops through pages that only link to the login (the public home page)
// before giving up on finding the form.
const MAX_LOGIN_LINK_HOPS = 2;
export const INDEX_URL = `${PORTAL_ORIGIN}/espace-client-v2/occupant/ficheIndexDemande.do`;
// The menu entry "Index à la demande": the portal prepares the index page in
// the session, then redirects to INDEX_URL. Opened directly, INDEX_URL answers
// a page without the form (seen on a live account, 2026-11-08).
export const INDEX_MENU_URL = `${PORTAL_ORIGIN}/espace-client-v2/menu.do?id=lgtOcc_index`;
// The resident's dashboard, where the browser lands after choosing "Résident". Even signed in,
// menu.do pasted in a browser sends back to the public home page (role choice, 2026-11-09):
// the menu entry is followed from the dashboard, with it as Referer, like a click.
export const DASHBOARD_URL = `${PORTAL_ORIGIN}/espace-client-v2/occupant/tableauBordLogement.do?dispatch=init`;
// Where the identity server sends back: the redirect_uri of the Keycloak client (`client_data`
// of the live login page, 2026-11-10), `ista-webconso.fr/…/public/loginIpmp.do?dispatch=loginTenant`
// whatever host the sign-in started on. In a resident's browser it answers a redirect (302 to
// monCompte.do, then ficheLogement.do, then the dashboard); an answer there (HTTP 200) is its
// "Une erreur interne est survenue" page (checked live with a made-up code): a failed sign-in.
export const CALLBACK_PATH = '/espace-client-v2/public/loginIpmp.do';

// The `dispatch` values of the index form (ficheIndexDemandeOccupant.js on the
// portal). Water: seen on a live account (2026-11-08). Heating (heat cost
// allocators): read in the page script only, never seen answering.
export const DISPATCHES = {
  WATER: 'voirIndexDemande',
  HEATING: 'voirIndexDemandeChauffageRfc',
};
// The ids of the heating tab's date inputs and of its range of readings
// (page script): their `name` is what the form sends.
const HEATING_INPUT_IDS = {
  day: 'choixDateIndexDemandeChauffageRfc',
  from: 'choixDateDebutPeriodeIndexChauffageRfc',
  lastDay: 'finPeriodeAvecDonneesChauffageRfc',
  firstDay: 'debutPeriodeAvecDonneesChauffageRfc',
};

const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 30000;
// One real browser, and the headers it sends on a page navigation (Firefox 128 ESR). Until 1.1.8
// the client sent a made-up Chrome agent through Node's fetch, which adds `Sec-Fetch-Mode: cors`
// and no other fetch metadata: the sign-in callback answered its error page (see src/ista/http.js).
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const NAVIGATION_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const siteOf = (address) => new URL(address).hostname.split('.').slice(-2).join('.');
const SITE_ORDER = ['same-origin', 'same-site', 'cross-site'];
/** `Sec-Fetch-Site` of a request to `url` started by a page of `origin` (Fetch Metadata). */
export function fetchSite(origin, url) {
  const target = new URL(url);
  if (target.origin === origin) return 'same-origin';
  return siteOf(origin) === siteOf(url) ? 'same-site' : 'cross-site';
}

export const AUTH_ERRORS = {
  NO_CREDENTIALS: 'no_credentials',
  INVALID_CREDENTIALS: 'invalid_credentials',
  CAPTCHA: 'captcha',
  TWO_FACTOR: 'two_factor',
  ACTION_REQUIRED: 'action_required',
  LOGIN_FORM_NOT_FOUND: 'login_form_not_found',
  SESSION_EXPIRED: 'session_expired',
};

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export class PortalError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
  }
}

// Host and path only: the query of a login redirect carries one-time codes.
export function safeUrl(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

/**
 * One hop of an exchange, for the sign-in diagnostics: method, host and path, the NAMES of the
 * query parameters, the status, the NAMES of the cookies sent and set. Never a value, except an
 * OAuth `error` code (a fixed word), reduced to safe characters.
 */
export function describeHop(method, url, status, { sent = [], set = [] } = {}) {
  const { host, pathname, searchParams } = new URL(url);
  const params = [...new Set(searchParams.keys())];
  let hop = `${method} ${host}${pathname}${params.length ? `?${params.join(',')}` : ''} ${status}`;
  if (sent.length) hop += ` sent[${sent.join(',')}]`;
  if (set.length) hop += ` set[${set.join(',')}]`;
  for (const name of ['error', 'error_description']) {
    const value = searchParams.get(name);
    if (value) hop += ` ${name}=${value.replace(/[^\w.-]/g, '_').slice(0, 60)}`;
  }
  return hop;
}

const cookieNames = (header) =>
  header
    ? header
        .split(';')
        .map((pair) => pair.split('=')[0].trim())
        .filter(Boolean)
    : [];

/** The portal's error page ("Une erreur interne est survenue", block `#middleError`). */
export function isPortalErrorPage(html) {
  return /id\s*=\s*["']middleError["']|Une erreur interne est survenue/i.test(html);
}

/**
 * The message of the portal's error page (its headings: the same fixed text for everyone,
 * never account data), or null.
 */
export function portalErrorMessage(html) {
  const block = html.match(/id\s*=\s*["']middleError["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const headings = [...block.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map(([, text]) => textOf(text))
    .filter(Boolean);
  return headings.length ? headings.join(' ').slice(0, 160) : null;
}

const CAPTCHA_MARKERS = /g-recaptcha|grecaptcha|h-captcha|hcaptcha|frc-captcha|cf-turnstile/i;
const OTP_MARKERS = /name\s*=\s*["']otp["']|name\s*=\s*["']totp["']|id\s*=\s*["']kc-otp/i;
const REQUIRED_ACTION_MARKERS =
  /required-action|kc-update-password|kc-terms|login-update-password|login-update-profile/i;

/**
 * Find the login form of a page: its action URL and the names of its user and
 * password inputs (Keycloak names them `username` and `password`; the older
 * portal form used `login` and `pwd`), plus its hidden inputs.
 */
export function findLoginForm(html, pageUrl) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const form of forms) {
    const inputs = form.match(/<input\b[^>]*>/gi) ?? [];
    const named = inputs.map((tag) => ({
      tag,
      name: attribute(tag, 'name'),
      type: (attribute(tag, 'type') ?? 'text').toLowerCase(),
    }));
    const password = named.find((input) => input.type === 'password');
    if (!password?.name) {
      continue;
    }
    const user = named.find(
      (input) =>
        input.name &&
        input.name !== password.name &&
        ['text', 'email'].includes(input.type) &&
        /user|mail|login/i.test(input.name),
    );
    if (!user) {
      continue;
    }
    const openingTag = form.match(/<form\b[^>]*>/i)[0];
    const action = attribute(openingTag, 'action') || pageUrl;
    const hidden = Object.fromEntries(
      named
        .filter((input) => input.type === 'hidden' && input.name)
        .map((input) => [input.name, attribute(input.tag, 'value') ?? '']),
    );
    return {
      action: new URL(action, pageUrl).toString(),
      userField: user.name,
      passwordField: password.name,
      hidden,
    };
  }
  return null;
}

/**
 * The sign-in link of a portal page (`…home.do?dispatch=authenticate`), as an
 * absolute URL on the portal, or null.
 */
export function findAuthenticateLink(html, pageUrl) {
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, 'href');
    if (!href || !/[?&]dispatch=authenticate\b/.test(href)) {
      continue;
    }
    const url = new URL(href, pageUrl);
    if (url.hostname.replace(/^www\./, '') === PORTAL_DOMAIN) {
      return url.toString();
    }
  }
  return null;
}

export class IstaClient {
  /**
   * @param {object} options
   * @param {object} options.config normalized configuration (src/config.js)
   * @param {Function} [options.fetch] fetch implementation (tests)
   * @param {{ load: Function, save: Function }} [options.sessionStore] where
   *   the session cookies survive a restart (/data)
   * @param {object} [options.logger]
   */
  constructor({ config, fetch = browserFetch, sessionStore, logger } = {}) {
    this.config = config;
    this.fetch = fetch;
    this.sessionStore = sessionStore;
    this.logger = logger ?? createLogger({ name: 'ista' });
    // The portal answers on ista-webconso.fr and www.ista-webconso.fr: one session for both.
    this.jar = new CookieJar(this.initialCookies(), { sharedDomain: PORTAL_DOMAIN });
    this.signedIn = false;
  }

  usesPastedCookie() {
    return this.config.auth_mode === 'cookie';
  }

  initialCookies() {
    if (this.usesPastedCookie()) {
      return cookiesFromPastedText(this.config.session_cookie, PORTAL_DOMAIN);
    }
    return this.sessionStore?.load() ?? [];
  }

  saveSession() {
    if (!this.usesPastedCookie()) {
      this.sessionStore?.save(this.jar.toJSON());
    }
  }

  /**
   * One HTTP exchange, following the redirects by hand so every hop stores
   * and replays its cookies. A POST answered by a redirect continues as a GET.
   * The `referer` is sent on every hop, as a browser does under the sites'
   * `strict-origin-when-cross-origin` policy: whole on the same origin, its
   * origin alone elsewhere. A POST also carries its `Origin`. Every hop carries the fetch
   * metadata of a navigation (`Sec-Fetch-*`): `Sec-Fetch-Site` is `none` without a referer (a
   * typed address), otherwise the furthest relation between the referring page and every URL
   * of the chain so far, as the Fetch standard computes it (`cross-site` on the sign-in callback).
   * @param {string[]} [options.trace] receives one describeHop() line per hop
   * @returns {Promise<{ status, url, contentType, body }>}
   */
  async request(url, { method = 'GET', form, accept, referer, trace } = {}) {
    let currentUrl = url;
    let currentMethod = method;
    let body = form ? new URLSearchParams(form).toString() : undefined;
    // Every cookie of the jar that matches goes, the pre-login SameSite=Strict session included
    // (1.1.10): a resident's browser sends it back on the sign-in callback (Chrome, 2026-11-19),
    // which the 1.1.6-1.1.9 withholding (the SameSite theory) contradicted.
    let site = 'none';
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (referer) {
        const relation = fetchSite(new URL(referer).origin, currentUrl);
        if (site === 'none' || SITE_ORDER.indexOf(relation) > SITE_ORDER.indexOf(site)) {
          site = relation;
        }
      }
      const headers = {
        'User-Agent': USER_AGENT,
        Accept: accept ?? NAVIGATION_ACCEPT,
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': site,
        'Sec-Fetch-User': '?1',
      };
      const cookie = this.jar.headerFor(currentUrl);
      if (cookie) {
        headers.Cookie = cookie;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      if (referer) {
        const from = new URL(referer);
        const sameOrigin = from.origin === new URL(currentUrl).origin;
        headers.Referer = sameOrigin ? from.href.replace(/#.*$/, '') : `${from.origin}/`;
        if (currentMethod === 'POST') {
          headers.Origin = from.origin;
        }
      }
      const response = await this.fetch(currentUrl, {
        method: currentMethod,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.jar.storeFrom(response, currentUrl);
      trace?.push(
        describeHop(currentMethod, currentUrl, response.status, {
          sent: cookieNames(cookie),
          set: (response.headers.getSetCookie?.() ?? []).flatMap((c) => cookieNames(c).slice(0, 1)),
        }),
      );
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel(); // free the connection, the body is unused
        currentUrl = new URL(location, currentUrl).toString();
        if (response.status !== 307 && response.status !== 308) {
          currentMethod = 'GET';
          body = undefined;
        }
        continue;
      }
      return {
        status: response.status,
        url: currentUrl,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
      };
    }
    throw new PortalError(`too many redirects from ${safeUrl(url)}`);
  }

  /**
   * Sign in with the e-mail and password of the resident space, the way the
   * browser does it. Throws an AuthError whose `code` says what went wrong.
   */
  async login() {
    if (this.usesPastedCookie()) {
      throw new AuthError(
        AUTH_ERRORS.SESSION_EXPIRED,
        'the pasted session cookie is missing or expired',
      );
    }
    if (!this.config.email || !this.config.password) {
      throw new AuthError(AUTH_ERRORS.NO_CREDENTIALS, 'e-mail or password missing');
    }
    // Start with the variant that worked last; the other one only when the callback fails.
    const first = this.variantIndex ?? 0;
    const order = [first, 1 - first];
    const failures = [];
    for (const index of order) {
      const variant = SIGN_IN_VARIANTS[index];
      try {
        await this.signInWith(variant);
      } catch (err) {
        if (!err.callbackFailed) {
          // Keep what the first try told: the reason the second one ran.
          if (failures.length)
            err.message = `${failures[0]} | variant ${variant.name}: ${err.message}`;
          throw err;
        }
        failures.push(`variant ${variant.name}: ${err.message}`);
        if (failures.length < order.length) continue;
        throw new AuthError(AUTH_ERRORS.SESSION_EXPIRED, failures.join(' | '));
      }
      this.variantIndex = index;
      this.saveSession();
      // The session is renewed whenever the portal drops it, possibly at every reading: only
      // the first sign-in of this account is worth an info line, and the variant that worked.
      this.logger[this.signedIn && !failures.length ? 'debug' : 'info'](
        `Signed in to the ista portal (variant ${variant.name}${failures.length ? `, after ${failures.length} failed` : ''})`,
      );
      this.signedIn = true;
      return;
    }
  }

  /**
   * One sign-in from `variant.entry`. Throws an AuthError; `callbackFailed` is set when the
   * sign-in callback answered its error page (the case the other variant may get through).
   */
  async signInWith(variant) {
    this.jar.clear();
    // Every hop of this sign-in, told when the portal does not keep the session.
    const trace = [];
    let page = await this.request(variant.entry, { trace });
    let form = findLoginForm(page.body, page.url);
    // Should the portal show its public home page again, follow its sign-in
    // link like a user would.
    for (let hop = 0; !form && hop < MAX_LOGIN_LINK_HOPS; hop += 1) {
      const link = findAuthenticateLink(page.body, page.url);
      if (!link) {
        break;
      }
      page = await this.request(link, { trace });
      form = findLoginForm(page.body, page.url);
    }
    if (CAPTCHA_MARKERS.test(page.body)) {
      throw new AuthError(AUTH_ERRORS.CAPTCHA, 'the login page asks for a captcha');
    }
    if (!form) {
      throw new AuthError(
        AUTH_ERRORS.LOGIN_FORM_NOT_FOUND,
        `no login form found at ${safeUrl(page.url)} (HTTP ${page.status})`,
      );
    }
    this.logger.debug(`Signing in through ${safeUrl(form.action)}`);
    const result = await this.request(form.action, {
      method: 'POST',
      form: {
        ...form.hidden,
        [form.userField]: this.config.email,
        [form.passwordField]: this.config.password,
      },
      referer: page.url,
      trace,
    });
    if (OTP_MARKERS.test(result.body)) {
      throw new AuthError(AUTH_ERRORS.TWO_FACTOR, 'the account asks for a second factor');
    }
    if (CAPTCHA_MARKERS.test(result.body)) {
      throw new AuthError(AUTH_ERRORS.CAPTCHA, 'the login page asks for a captcha');
    }
    if (REQUIRED_ACTION_MARKERS.test(result.url) || REQUIRED_ACTION_MARKERS.test(result.body)) {
      throw new AuthError(
        AUTH_ERRORS.ACTION_REQUIRED,
        'the portal asks for an action in the browser (new password, terms of use…)',
      );
    }
    if (findLoginForm(result.body, result.url)) {
      throw new AuthError(AUTH_ERRORS.INVALID_CREDENTIALS, 'the portal refused the credentials');
    }
    if (new URL(result.url).hostname.replace(/^www\./, '') !== PORTAL_DOMAIN) {
      throw new AuthError(
        AUTH_ERRORS.LOGIN_FORM_NOT_FOUND,
        `the login ended at ${safeUrl(result.url)} instead of the portal`,
      );
    }
    // An error page anywhere on the way (monCompte.do without a session answers one, HTTP 200).
    const reason =
      this.signedOutReason(result) ?? (isPortalErrorPage(result.body) ? 'error page' : null);
    if (reason) {
      // In a browser the sign-in ends on the resident's dashboard, through redirects only.
      const message = isPortalErrorPage(result.body) ? portalErrorMessage(result.body) : null;
      const where =
        new URL(result.url).pathname === CALLBACK_PATH ? 'the sign-in callback' : 'the portal';
      const error = new AuthError(
        AUTH_ERRORS.SESSION_EXPIRED,
        `${where} answered at ${safeUrl(result.url)} (HTTP ${result.status}, ${reason}${message ? `: "${message}"` : ''}) instead of the resident's pages: no session kept; sign-in steps: ${trace.join(' > ')}`,
      );
      error.callbackFailed = where === 'the sign-in callback';
      throw error;
    }
  }

  /** True when a portal answer is the sign-in, not the page asked for. */
  isSignedOut(result) {
    return this.signedOutReason(result) !== null;
  }

  /**
   * Why a portal answer looks signed out (`null` when it does not): told in
   * the error, so that a resident's log says where the portal sent us.
   */
  signedOutReason(result) {
    const url = new URL(result.url);
    // Without a valid session the portal answers with its login form, or with
    // its public home page (sign-in link, no form).
    if (url.hostname.replace(/^www\./, '') !== PORTAL_DOMAIN) return 'another site';
    if (result.status === 401) return 'HTTP 401';
    if (url.pathname.includes('/public/')) {
      return isPortalErrorPage(result.body) ? 'error page' : 'public page';
    }
    if (findLoginForm(result.body, result.url) !== null) return 'login form';
    if (findAuthenticateLink(result.body, result.url) !== null) return 'sign-in link';
    return null;
  }

  /**
   * One request to a page of the signed-in space. A lost session is renewed
   * once (sign-in, then `retry()` builds the request again: a new form, a new
   * CSRF token). Returns the answer page.
   */
  async signedInRequest(build, retry = build) {
    let [url, options] = await build();
    let result = await this.request(url, options);
    if (this.isSignedOut(result)) {
      await this.login();
      [url, options] = await retry();
      result = await this.request(url, options);
      const reason = this.signedOutReason(result);
      if (reason) {
        throw new AuthError(
          AUTH_ERRORS.SESSION_EXPIRED,
          `the portal still asks to sign in after a successful login (${reason} at ${safeUrl(result.url)}, HTTP ${result.status})`,
        );
      }
    }
    if (result.status >= 400) {
      throw new PortalError(`HTTP ${result.status} from ${safeUrl(result.url)}`, result.status);
    }
    this.saveSession();
    return result;
  }

  /**
   * Open the index page: its form and what it offers (src/ista/parse.js
   * `describeIndexForm`).
   */
  async openIndexPage() {
    // Dashboard first, then its menu entry (see DASHBOARD_URL); both again after a new sign-in.
    const open = async () => {
      const dashboard = await this.request(DASHBOARD_URL);
      return [INDEX_MENU_URL, { referer: dashboard.url }];
    };
    const result = await this.signedInRequest(open);
    return this.indexPageOf(result);
  }

  indexPageOf(result) {
    const form = parseIndexForm(result.body, result.url);
    if (!form) {
      // An unknown page: say what it is, never what it holds.
      throw new UnexpectedAnswerError(
        `no index form at ${safeUrl(result.url)} (HTTP ${result.status}, ${result.contentType || 'no content type'})`,
        {
          forms: (result.body.match(/<form\b[^>]*>/gi) ?? []).map(
            (tag) => attribute(tag, 'name') ?? '',
          ),
        },
      );
    }
    return {
      form,
      ...describeIndexForm(form),
      // The heating tab has its own range of readings, when it has a tab.
      heatingMaxDay: looseDay(form.byId[HEATING_INPUT_IDS.lastDay]?.value),
    };
  }

  /**
   * Search the indexes of one fluid family at the most recent date the page
   * allows, over a one-day period.
   * @param {object} page what openIndexPage() returned
   * @param {'water'|'heating'} family
   * @returns {Promise<{ meters: Array, page: object }>} the meters
   *   (parse.js `parseMeters`), and the answer page: its form carries the
   *   CSRF token of the next search (the portal renews it on every page).
   */
  async searchIndexes(page, family) {
    const kind = family === 'heating' ? KINDS.HEATING : KINDS.COLD_WATER;
    const post = (current) => [
      current.form.action,
      { method: 'POST', form: this.searchFields(current, family) },
    ];
    const result = await this.signedInRequest(
      () => post(page),
      async () => post(await this.openIndexPage()),
    );
    if (!parseIndexForm(result.body, result.url)) {
      throw new UnexpectedAnswerError(
        `the index search answered another page (${safeUrl(result.url)}, HTTP ${result.status})`,
        {},
      );
    }
    return { meters: parseMeters(result.body, kind), page: this.indexPageOf(result) };
  }

  /** The form a browser sends for the search: every field, a few set. */
  searchFields(page, family) {
    // A browser sends the line breaks of a value (the postal address) as CRLF.
    const fields = new URLSearchParams(
      page.form.fields.map(([name, value]) => [name, value.replace(/\r?\n/g, '\r\n')]),
    );
    const set = (name, value) => fields.set(name, value);
    if (family === 'heating') {
      const ids = page.form.byId;
      const dayName = ids[HEATING_INPUT_IDS.day]?.name;
      const fromName = ids[HEATING_INPUT_IDS.from]?.name;
      if (!dayName || !fromName) {
        throw new UnexpectedAnswerError('the heating index form has no date fields', {
          inputs: Object.keys(ids),
        });
      }
      const day = page.heatingMaxDay ?? page.maxDay;
      const first = looseDay(ids[HEATING_INPUT_IDS.firstDay]?.value) ?? page.minDay;
      if (!day) {
        throw new UnexpectedAnswerError('the heating index form has no date range', {});
      }
      set('dispatch', DISPATCHES.HEATING);
      set(dayName, dayToFrench(day));
      set(fromName, dayToFrench(periodStart(day, first)));
      return fields;
    }
    if (!page.maxDay) {
      throw new UnexpectedAnswerError('the index form has no date range', {});
    }
    set('dispatch', DISPATCHES.WATER);
    set('choixOnglet', fieldValue(page.form, 'choixOnglet') || 'EAU');
    set('indexChoisi', 'true');
    set('dateIndexDemande', dayToFrench(page.maxDay));
    set('dateDebutPeriodeIndex', dayToFrench(periodStart(page.maxDay, page.minDay)));
    return fields;
  }
}

/** The day before `day`, but never before the first day the portal allows. */
export function periodStart(day, firstDay) {
  const before = addDays(day, -1);
  return firstDay && before < firstDay ? (firstDay < day ? firstDay : day) : before;
}
