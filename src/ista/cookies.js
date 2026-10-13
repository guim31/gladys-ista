// -----------------------------------------------------------------------------
// Minimal cookie jar for the portal session.
//
// The login hops between two hosts (the portal and ista's identity server,
// login.ista.com) and each one sets its own cookies: the jar keeps them per
// domain and replays the matching ones on every request, like a browser would.
// Only what this flow needs: Domain/host-only matching, Path prefix, deletion
// through Max-Age/Expires. No third-party dependency.
// -----------------------------------------------------------------------------

function parseSetCookie(header, requestUrl) {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) {
    return null;
  }
  const cookie = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: requestUrl.hostname.toLowerCase(),
    hostOnly: true,
    path: '/',
    expired: false,
  };
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'domain' && value) {
      cookie.domain = value.replace(/^\./, '').toLowerCase();
      cookie.hostOnly = false;
    } else if (key === 'path' && value.startsWith('/')) {
      cookie.path = value;
    } else if (key === 'max-age' && Number(value) <= 0) {
      cookie.expired = true;
    } else if (key === 'expires' && Date.parse(value) < Date.now()) {
      cookie.expired = true;
    }
  }
  return cookie;
}

function domainMatches(cookie, hostname) {
  const host = hostname.toLowerCase();
  if (cookie.hostOnly) {
    return host === cookie.domain;
  }
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

export class CookieJar {
  constructor(cookies = []) {
    this.cookies = [];
    for (const cookie of cookies) {
      this.set(cookie);
    }
  }

  set(cookie) {
    this.cookies = this.cookies.filter(
      (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
    );
    if (!cookie.expired) {
      const { expired: _expired, ...kept } = cookie;
      this.cookies.push(kept);
    }
  }

  /**
   * Store the cookies of a response.
   * @param {Response} response fetch response
   * @param {string} requestUrl the URL the response answers
   */
  storeFrom(response, requestUrl) {
    const url = new URL(requestUrl);
    const headers =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const header of headers) {
      const cookie = parseSetCookie(header, url);
      if (cookie) {
        this.set(cookie);
      }
    }
  }

  /** The `Cookie` header for a request to `requestUrl` ('' when none matches). */
  headerFor(requestUrl) {
    const url = new URL(requestUrl);
    return this.cookies
      .filter((c) => domainMatches(c, url.hostname) && url.pathname.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  has(name, hostname) {
    return this.cookies.some((c) => c.name === name && domainMatches(c, hostname));
  }

  clear() {
    this.cookies = [];
  }

  toJSON() {
    return this.cookies;
  }
}

/**
 * Parse the session cookie a user pasted from their browser: either the bare
 * JSESSIONID value, or a `name=value; name2=value2` list (the `Cookie` header
 * of a request, copied from the developer tools). The cookies are valid for
 * the portal domain and its sub-domains (www or not).
 * @param {string} raw pasted text
 * @param {string} domain portal domain, e.g. `ista-webconso.fr`
 */
export function cookiesFromPastedText(raw, domain) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^cookie:\s*/i, '');
  if (!text) {
    return [];
  }
  const pairs = text.includes('=') ? text.split(';') : [`JSESSIONID=${text}`];
  return pairs
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator <= 0) {
        return null;
      }
      return {
        name: pair.slice(0, separator).trim(),
        value: pair.slice(separator + 1).trim(),
        domain,
        hostOnly: false,
        path: '/',
      };
    })
    .filter((cookie) => cookie && cookie.name && cookie.value);
}
