// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`; this
// module provides the defaults and normalizes the received object, so the
// rest of the code never deals with `undefined` or with numbers typed as
// strings.
// -----------------------------------------------------------------------------

export const AUTH_MODES = { CREDENTIALS: 'credentials', COOKIE: 'cookie' };
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Hours between two readings of the portal. The readings change once or a few
// times a day at most: reading more often would only load ista's portal.
export const POLL_INTERVAL_HOURS = { DEFAULT: 12, MIN: 3, MAX: 24 };

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  auth_mode: AUTH_MODES.CREDENTIALS,
  email: '',
  password: '',
  session_cookie: '',
  poll_interval_hours: POLL_INTERVAL_HOURS.DEFAULT,
  // An integration of type `device` does not receive the user's language:
  // the feature names it creates are written in the one chosen here.
  language: 'fr',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const hours = Math.round(Number(raw.poll_interval_hours ?? DEFAULT_CONFIG.poll_interval_hours));
  return {
    auth_mode: Object.values(AUTH_MODES).includes(raw.auth_mode)
      ? raw.auth_mode
      : DEFAULT_CONFIG.auth_mode,
    email: typeof raw.email === 'string' ? raw.email.trim() : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    session_cookie: typeof raw.session_cookie === 'string' ? raw.session_cookie.trim() : '',
    poll_interval_hours: Number.isFinite(hours)
      ? Math.min(POLL_INTERVAL_HOURS.MAX, Math.max(POLL_INTERVAL_HOURS.MIN, hours))
      : DEFAULT_CONFIG.poll_interval_hours,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
  };
}

/** True when the configuration holds what a sign-in needs. */
export function hasCredentials(config) {
  return config.auth_mode === AUTH_MODES.COOKIE
    ? config.session_cookie !== ''
    : config.email !== '' && config.password !== '';
}
