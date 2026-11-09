// -----------------------------------------------------------------------------
// Reading the portal and feeding Gladys.
//
// The portal gives the meters' indexes on its "index à la demande" page, for
// any day up to its latest reading (often a few days old). So the container,
// not Gladys, drives the pace: a timer opens that page every few hours (12 by
// default, 3 to 24) and, when its latest date is newer than the last reading
// published, asks for the indexes of that date, over a one-day period. Each
// index is published DATED with its reading date, so the Gladys charts show
// it on the right day, not on the day it was fetched.
//
// That is two small requests per run (three with heating), and only one when
// the portal has nothing new.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { AuthError, AUTH_ERRORS, IstaClient } from './ista/client.js';
import { KINDS, UnexpectedAnswerError, addDays } from './ista/parse.js';
import { FEATURE_KEYS, buildDevice, deviceIds, statesOfDay } from './devices/dwelling.js';
import { hasCredentials } from './config.js';
import { allLanguages } from './i18n.js';

// Key of the dashboard widget (manifest `widgets`), nudged after each reading.
export const DWELLING_WIDGET = 'dwelling';

export const REQUEST_GAP_MS = 2000;
export const FIRST_RUN_DELAY_MS = 10_000;
export const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;
// Recent readings kept to re-send to a device created (or updated) later.
// Bounded to stay under the core's 300 states per minute.
export const MAX_RECENT_STATES = 250;
const DAILY_HISTORY_DAYS = 31;
const STATES_PER_REQUEST = 100;

export { addDays };

const WATER_KINDS = [KINDS.COLD_WATER, KINDS.HOT_WATER];
// Features that add up several meters.
const TOTAL_KEYS = new Set([
  FEATURE_KEYS.HEATING_DAILY,
  FEATURE_KEYS.COLD_WATER_TOTAL,
  FEATURE_KEYS.HOT_WATER_TOTAL,
]);

const AUTH_STATUS_TEXTS = {
  [AUTH_ERRORS.NO_CREDENTIALS]: 'status_not_configured',
  [AUTH_ERRORS.INVALID_CREDENTIALS]: 'status_invalid_credentials',
  [AUTH_ERRORS.CAPTCHA]: 'status_captcha',
  [AUTH_ERRORS.TWO_FACTOR]: 'status_two_factor',
  [AUTH_ERRORS.ACTION_REQUIRED]: 'status_action_required',
  [AUTH_ERRORS.LOGIN_FORM_NOT_FOUND]: 'status_login_form_not_found',
  [AUTH_ERRORS.SESSION_EXPIRED]: 'status_session_expired',
};

/** `YYYY-MM-DD` of a date in the container's time zone (TZ, set by Gladys). */
export function localDay(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The instant a day's reading is stamped with: the end of that local day. */
export function stateInstant(day) {
  return new Date(`${day}T23:59:00`).toISOString();
}

export function emptyState() {
  return {
    points: [],
    lastDay: {},
    recent: [],
    daily: [],
    status: null,
    lastAttemptAt: null,
    // A hash of the e-mail, to notice another account without storing it.
    account: null,
  };
}

function accountHash(email) {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class IstaSync {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK client
   * @param {object} options.store files under /data (src/store.js)
   * @param {Function} [options.fetch] fetch implementation (tests)
   * @param {Function} [options.now] clock (tests)
   * @param {number} [options.requestGapMs] pause between two portal requests
   */
  constructor({ gladys, store, fetch, now, requestGapMs = REQUEST_GAP_MS, logger }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.now = now ?? (() => new Date());
    this.requestGapMs = requestGapMs;
    this.logger = logger ?? createLogger({ name: 'sync' });
    this.state = { ...emptyState(), ...(store.loadState() ?? {}) };
    this.timer = null;
    this.nextRunAt = null;
    this.running = null;
    this.config = null;
    this.client = null;
    // What was last logged as failing (status text key), to write one line
    // when a failure starts and one when it ends, not one per attempt. In
    // memory only: a restart logs a lasting failure again, once.
    this.failure = null;
    // Whether the heating failure (unverified page) was already logged, and
    // the heating notice (installed, not offered by the index page).
    this.heatingFailure = false;
    this.heatingNoticeLogged = false;
  }

  /**
   * Apply a (new) configuration. Returns true when the account changed, so
   * the caller knows a fresh reading is worth it.
   */
  setConfig(config) {
    const previous = this.config;
    this.config = config;
    const accountChanged =
      !previous ||
      previous.auth_mode !== config.auth_mode ||
      previous.email !== config.email ||
      previous.password !== config.password ||
      previous.session_cookie !== config.session_cookie;
    if (accountChanged) {
      // The saved session belongs to the previous credentials: drop it (not at
      // startup, where the previous config is the empty default).
      if (previous && hasCredentials(previous)) {
        this.store.session.save([]);
      }
      this.client = new IstaClient({
        config,
        fetch: this.fetch,
        sessionStore: this.store.session,
      });
      // Another account: forget what the previous one listed.
      const account = config.email ? accountHash(config.email) : null;
      if (account && this.state.account && account !== this.state.account) {
        this.state = emptyState();
      }
      this.state.account = account ?? this.state.account;
    }
    return accountChanged;
  }

  intervalMs() {
    return this.config.poll_interval_hours * 60 * 60 * 1000;
  }

  buildDevice() {
    return buildDevice(this.gladys, { points: this.state.points }, this.config);
  }

  async publishDevice() {
    const device = this.buildDevice();
    await this.gladys.publishDiscoveredDevices(device ? [device] : []);
  }

  isOwnDevice(device) {
    return device?.external_id === deviceIds(this.gladys).device;
  }

  /** Re-send the recent readings: Gladys dropped them while the device did not exist. */
  async republishRecentStates() {
    await this.publishStates(this.state.recent);
  }

  // No periodic re-publication of an unchanged value: every state is dated
  // with its day, and the core moves `last_value` only for a more recent
  // instant. Re-sending the last index stamped "now" would make the next
  // reading (stamped with its own, earlier day) invisible as last value, and
  // drop the history curve back between two days; re-sending it with its own
  // date changes nothing. The freshness Gladys shows is the portal's.
  async publishStates(states) {
    for (let i = 0; i < states.length; i += STATES_PER_REQUEST) {
      await this.gladys.publishStates(
        states.slice(i, i + STATES_PER_REQUEST).map(({ key, state, created_at }) => ({
          device_feature_external_id: deviceIds(this.gladys).feature(key),
          state,
          created_at,
        })),
      );
    }
  }

  async setStatus(connected, textKey) {
    this.state.status = { connected, text: textKey ?? null };
    await this.sendStatus();
  }

  async sendStatus() {
    const { status } = this.state;
    if (!status) {
      return;
    }
    await this.gladys
      .setConnectionStatus(status.connected, status.text ? allLanguages(status.text) : undefined)
      .catch((err) => this.logger.warn(`Could not report the connection status: ${err.message}`));
  }

  /** What the widget shows. */
  summary() {
    return {
      connected: this.state.status?.connected ?? false,
      daily: this.state.daily,
      points: this.state.points,
      nextRunAt: this.nextRunAt,
    };
  }

  // --- Timer ------------------------------------------------------------------

  start() {
    this.stop();
    const last = this.state.lastAttemptAt ? Date.parse(this.state.lastAttemptAt) : null;
    const due = last === null ? 0 : last + this.intervalMs() - this.now().getTime();
    this.schedule(Math.max(FIRST_RUN_DELAY_MS, due));
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  schedule(delayMs) {
    clearTimeout(this.timer);
    this.nextRunAt = new Date(this.now().getTime() + delayMs);
    const handle = setTimeout(async () => {
      const result = await this.refresh();
      if (this.timer !== handle) {
        return; // stopped (disconnected, shutdown) or rescheduled meanwhile
      }
      // A refused sign-in waits for the normal interval (retrying sooner could
      // lock the account); a network or portal error is retried within the hour.
      const retrySooner = !result.ok && !result.authError;
      this.schedule(
        retrySooner ? Math.min(this.intervalMs(), RETRY_AFTER_ERROR_MS) : this.intervalMs(),
      );
    }, delayMs);
    this.timer = handle;
  }

  // --- Reading ----------------------------------------------------------------

  /** Read the portal if the interval has elapsed since the last attempt. */
  async refreshIfDue() {
    const last = this.state.lastAttemptAt ? Date.parse(this.state.lastAttemptAt) : null;
    if (last === null || this.now().getTime() - last >= this.intervalMs()) {
      return this.refresh();
    }
    return { ok: true, skipped: true };
  }

  /** Read the portal now (one run at a time: a second call joins the first). */
  refresh() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async run() {
    this.state.lastAttemptAt = this.now().toISOString();
    try {
      if (!hasCredentials(this.config)) {
        await this.setStatus(false, 'status_not_configured');
        return { ok: false, authError: true };
      }
      await this.readLatest();
      if (this.failure) {
        this.logger.info('The ista portal answers again');
        this.failure = null;
      }
      await this.setStatus(true);
      this.gladys.requestWidgetRefresh(DWELLING_WIDGET);
      return { ok: true };
    } catch (err) {
      return this.handleError(err);
    } finally {
      this.store.saveState(this.state);
    }
  }

  /** Log a failure when it starts or changes, at debug level while it lasts. */
  logFailure(textKey, level, message) {
    const repeated = this.failure === textKey;
    this.failure = textKey;
    this.logger[repeated ? 'debug' : level](message);
  }

  async handleError(err) {
    if (err instanceof AuthError) {
      // In password mode a lost session is not an expired pasted cookie (Jluc, t/11109/35).
      const textKey =
        err.code === AUTH_ERRORS.SESSION_EXPIRED && this.config.auth_mode !== 'cookie'
          ? 'status_session_not_kept'
          : (AUTH_STATUS_TEXTS[err.code] ?? 'status_invalid_credentials');
      this.logFailure(
        textKey,
        'warn',
        `Sign-in to the ista portal failed (${err.code}): ${err.message}`,
      );
      await this.setStatus(false, textKey);
      return { ok: false, authError: true, error: err };
    }
    if (err instanceof UnexpectedAnswerError) {
      this.logFailure(
        'status_unexpected_answer',
        'error',
        `Unexpected answer from the ista portal: ${err.message}. Structure (no values): ${JSON.stringify(err.shape)}`,
      );
      await this.setStatus(false, 'status_unexpected_answer');
      return { ok: false, error: err };
    }
    this.logFailure(
      'status_unreachable',
      'error',
      `Reading the ista portal failed: ${err.message}`,
    );
    await this.setStatus(false, 'status_unreachable');
    return { ok: false, error: err };
  }

  async readLatest() {
    let requests = 1;
    // Each search answers the page again, with a new CSRF token: the next
    // search starts from the latest page.
    let page = await this.client.openIndexPage();
    const meters = [];

    if (!page.water) {
      this.logger.debug('The index page offers no water meter');
    } else if (!page.maxDay) {
      this.logger.debug('The index page offers no reading date yet');
    } else if (this.hasReadings(WATER_KINDS, page.maxDay)) {
      this.logger.debug(`No water reading newer than ${page.maxDay} on the portal`);
    } else {
      await this.pause();
      requests += 1;
      const water = await this.client.searchIndexes(page, 'water');
      meters.push(...water.meters);
      page = water.page;
    }

    if (page.heatingIndex) {
      if (!this.hasReadings([KINDS.HEATING], page.heatingMaxDay ?? page.maxDay)) {
        await this.pause();
        requests += 1;
        meters.push(...(await this.readHeating(page, meters.length > 0 || page.water)));
      }
    } else if (page.heatingInstalled && !this.heatingNoticeLogged) {
      this.heatingNoticeLogged = true;
      this.logger.info(
        'The portal lists heating for this dwelling, but its index page does not offer it: the heating features stay hidden. Please report it (see the documentation).',
      );
    }

    const newStates = this.collectStates(meters);
    const pointsChanged = this.mergePoints(meters.filter((meter) => meter.index !== null));
    if (pointsChanged) {
      await this.publishDevice();
    }
    if (newStates.length > 0) {
      await this.publishStates(newStates);
      this.state.recent = [...this.state.recent, ...newStates].slice(-MAX_RECENT_STATES);
    }
    this.logger.debug(
      `Portal read: ${requests} request(s), ${meters.length} meter(s) (${meters.filter((m) => m.estimated).length} estimated), ${newStates.length} new reading(s), latest day ${this.latestDay() ?? 'none'}`,
    );
  }

  /** True when every known meter of these fluids has a reading of `day` or later. */
  hasReadings(kinds, day) {
    const known = kinds.filter((kind) => this.state.points.some((point) => point.kind === kind));
    return (
      Boolean(day) &&
      known.length > 0 &&
      known.every((kind) => (this.state.lastDay[kind] ?? '') >= day)
    );
  }

  pause() {
    return this.requestGapMs > 0 ? sleep(this.requestGapMs) : Promise.resolve();
  }

  /**
   * The heating search was read in the portal's script, never seen answering:
   * its failure does not stop the water readings (logged once), unless there
   * is nothing else to read.
   */
  async readHeating(page, hasWater) {
    try {
      const { meters } = await this.client.searchIndexes(page, 'heating');
      if (this.heatingFailure) {
        this.logger.info('The heating readings answer again');
        this.heatingFailure = false;
      }
      return meters.filter((meter) => meter.kind === KINDS.HEATING);
    } catch (err) {
      if (!hasWater || err instanceof AuthError) {
        throw err;
      }
      const shape =
        err instanceof UnexpectedAnswerError
          ? ` Structure (no values): ${JSON.stringify(err.shape)}`
          : '';
      this.logger[this.heatingFailure ? 'debug' : 'warn'](
        `Reading the heating indexes failed: ${err.message}.${shape} Please report it (see the documentation).`,
      );
      this.heatingFailure = true;
      return [];
    }
  }

  /**
   * The dated states of the meters read, for the days not published yet. A
   * meter without a readable index or date publishes nothing (never a 0).
   */
  collectStates(meters) {
    const states = [];
    const readable = meters.filter((meter) => meter.index !== null && meter.day);
    const groups = new Map();
    // Meters of each fluid the portal listed in this answer.
    const listed = (kind) => meters.filter((meter) => meter.kind === kind).length;
    for (const meter of readable) {
      const key = `${meter.day}|${meter.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), meter]);
    }
    for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const [day, kind] = key.split('|');
      if ((this.state.lastDay[kind] ?? '') >= day) {
        continue;
      }
      // Heating units of the day: only a one-day period is a day's units.
      const points = group.map((meter) => ({
        ...meter,
        consumption:
          kind === KINDS.HEATING && meter.from !== addDays(day, -1) ? null : meter.consumption,
      }));
      // A total needs every meter of the fluid the portal listed: one without
      // an index (or another date) keeps the total out. Counted on the answer,
      // not on the meters ever seen: a replaced meter leaves the portal's list.
      const complete = points.length === listed(kind);
      const created_at = stateInstant(day);
      for (const state of statesOfDay(kind, points)) {
        if (complete || !TOTAL_KEYS.has(state.key)) {
          states.push({ ...state, created_at });
        }
      }
      if (complete) {
        this.recordDaily(day, kind, points);
      }
      this.state.lastDay[kind] = day;
    }
    return states;
  }

  mergePoints(points) {
    let changed = false;
    for (const point of points) {
      const known = this.state.points.find((p) => p.id === point.id);
      const entry = { id: point.id, serial: point.serial, room: point.room, kind: point.kind };
      if (!known) {
        this.state.points.push(entry);
        changed = true;
      } else if (known.kind !== entry.kind) {
        Object.assign(known, entry);
        changed = true;
      }
    }
    return changed;
  }

  recordDaily(day, kind, points) {
    let entry = this.state.daily.find((d) => d.day === day);
    if (!entry) {
      entry = { day };
      this.state.daily.push(entry);
      this.state.daily.sort((a, b) => a.day.localeCompare(b.day));
    }
    const ofKind = points.filter((point) => point.kind === kind);
    if (kind === KINDS.HEATING) {
      if (ofKind.every((point) => point.consumption !== null)) {
        const units = ofKind.reduce((sum, point) => sum + point.consumption, 0);
        entry[kind] = Math.round(units * 100) / 100;
      }
    } else if (ofKind.every((point) => point.index !== null)) {
      entry[kind] = Math.round(ofKind.reduce((sum, point) => sum + point.index, 0) * 1000) / 1000;
    }
    this.state.daily = this.state.daily.slice(-DAILY_HISTORY_DAYS);
  }

  latestDay() {
    const days = Object.values(this.state.lastDay).filter(Boolean).sort();
    return days.at(-1) ?? null;
  }
}
