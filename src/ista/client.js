// -----------------------------------------------------------------------------
// Client of the ista Web'conso resident portal (France).
//
// There is no public API: this client does what the resident's browser does.
//   1. Sign-in. The portal sends the browser to ista's identity server
//      (login.ista.com, a Keycloak realm). The client follows the same
//      redirects, fills the same login form, and comes back to the portal with
//      its session cookie (JSESSIONID). Or, when that does not work, it uses a
//      session cookie the user copied from their own browser.
//   2. Readings. The portal's consumption page answers JSON for one day at a
//      time (see parse.js).
// When the session expires, the client signs in again once and retries.
//
// Nothing here logs a URL query string, a cookie, an e-mail or a password: the
// login redirects carry one-time codes, and the logs end up in bug reports.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CookieJar, cookiesFromPastedText } from './cookies.js';
import { KINDS, UnexpectedAnswerError, describeShape, parseConsumptionAnswer } from './parse.js';

export const PORTAL_DOMAIN = 'ista-webconso.fr';
export const PORTAL_ORIGIN = `https://${PORTAL_DOMAIN}`;
// A protected page of the resident space: opening it without a session sends
// the browser to the login form, with the right redirect back.
export const ENTRY_URL = `${PORTAL_ORIGIN}/espace-client-v2/`;
export const CONSUMPTION_URL = `${PORTAL_ORIGIN}/espace-client-v2/occupant/ficheLogement.do`;

// The `dispatch` parameter of the consumption page, per fluid. Heating is the
// one a public project used against the live portal in 2025. The two water
// ones are UNVERIFIED guesses on the same naming pattern: when the portal
// refuses them, the integration simply publishes no water feature (see
// readings.js) until someone with an account tells us the real names.
export const DISPATCHES = {
  [KINDS.HEATING]: 'calculeConsommationChauffageRfcPourLogement',
  [KINDS.COLD_WATER]: 'calculeConsommationEauFroidePourLogement',
  [KINDS.HOT_WATER]: 'calculeConsommationEauChaudePourLogement',
};

const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

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

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeHtml(match[2] ?? match[3] ?? '') : undefined;
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

/** Calendar day after `day` (`YYYY-MM-DD`, no time zone involved). */
export function nextDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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
  constructor({ config, fetch = globalThis.fetch, sessionStore, logger } = {}) {
    this.config = config;
    this.fetch = fetch;
    this.sessionStore = sessionStore;
    this.logger = logger ?? createLogger({ name: 'ista' });
    this.jar = new CookieJar(this.initialCookies());
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
   * @returns {Promise<{ status, url, contentType, body }>}
   */
  async request(url, { method = 'GET', form, accept } = {}) {
    let currentUrl = url;
    let currentMethod = method;
    let body = form ? new URLSearchParams(form).toString() : undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = {
        'User-Agent': USER_AGENT,
        Accept: accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      };
      const cookie = this.jar.headerFor(currentUrl);
      if (cookie) {
        headers.Cookie = cookie;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      const response = await this.fetch(currentUrl, {
        method: currentMethod,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.jar.storeFrom(response, currentUrl);
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
    this.jar.clear();
    const page = await this.request(ENTRY_URL);
    if (CAPTCHA_MARKERS.test(page.body)) {
      throw new AuthError(AUTH_ERRORS.CAPTCHA, 'the login page asks for a captcha');
    }
    const form = findLoginForm(page.body, page.url);
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
    this.saveSession();
    this.logger.info('Signed in to the ista portal');
  }

  /**
   * Readings of one fluid for one day.
   * @param {string} kind one of KINDS
   * @param {string} day `YYYY-MM-DD`
   */
  async fetchDay(kind, day) {
    const url = new URL(CONSUMPTION_URL);
    url.searchParams.set('dispatch', DISPATCHES[kind]);
    url.searchParams.set('start', day);
    url.searchParams.set('end', nextDay(day));
    let answer = await this.requestJson(url.toString());
    if (answer.sessionExpired) {
      await this.login();
      answer = await this.requestJson(url.toString());
      if (answer.sessionExpired) {
        throw new AuthError(
          AUTH_ERRORS.SESSION_EXPIRED,
          'the portal still asks to sign in after a successful login',
        );
      }
    }
    return parseConsumptionAnswer(answer.json, kind);
  }

  async requestJson(url) {
    const result = await this.request(url, { accept: 'application/json, text/javascript, */*' });
    const onPortal = new URL(result.url).hostname.replace(/^www\./, '') === PORTAL_DOMAIN;
    if (!onPortal || findLoginForm(result.body, result.url) || result.status === 401) {
      return { sessionExpired: true };
    }
    if (result.status >= 400) {
      throw new PortalError(`HTTP ${result.status} from ${safeUrl(result.url)}`, result.status);
    }
    try {
      const json = JSON.parse(result.body);
      this.saveSession();
      return { json };
    } catch {
      // An HTML page where JSON was expected: an unknown page, or the session
      // landing page of a portal that changed. Never log the body itself.
      throw new UnexpectedAnswerError(
        `no JSON from ${safeUrl(result.url)} (HTTP ${result.status}, ${result.contentType || 'no content type'})`,
        describeShape(null),
      );
    }
  }
}
