// -----------------------------------------------------------------------------
// Reading the portal and feeding Gladys.
//
// The portal publishes one reading per day, often with a delay of several
// days (many buildings are read weekly). So the container, not Gladys, drives
// the pace: a timer reads the portal every few hours (12 by default, 3 to 24),
// asks only for the days it does not have yet (7 days back at most), and
// publishes each reading DATED with its day, so the Gladys charts show the
// consumption on the right day, not on the day it was fetched.
//
// A day the portal has not filled in yet stops the reading of that fluid: it
// is asked again at the next run, and so are the days after it. That keeps the
// load on the portal to a handful of small requests per run.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { AuthError, AUTH_ERRORS, IstaClient, PortalError } from './ista/client.js';
import { KINDS, UnexpectedAnswerError } from './ista/parse.js';
import { buildDevice, deviceIds, statesOfDay } from './devices/dwelling.js';
import { hasCredentials } from './config.js';
import { allLanguages } from './i18n.js';

// Key of the dashboard widget (manifest `widgets`), nudged after each reading.
export const DWELLING_WIDGET = 'dwelling';

export const BACKFILL_DAYS = 7;
export const REQUEST_GAP_MS = 2000;
export const FIRST_RUN_DELAY_MS = 10_000;
export const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;
// Recent readings kept to re-send to a device created (or updated) later.
// Bounded to stay under the core's 300 states per minute.
export const MAX_RECENT_STATES = 250;
const DAILY_HISTORY_DAYS = 31;
const STATES_PER_REQUEST = 100;

export const WATER_STATUS = {
  UNKNOWN: 'unknown',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
};

const FLUIDS = [KINDS.HEATING, KINDS.COLD_WATER, KINDS.HOT_WATER];
const WATER_KINDS = [KINDS.COLD_WATER, KINDS.HOT_WATER];

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

export function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** The instant a day's reading is stamped with: the end of that local day. */
export function stateInstant(day) {
  return new Date(`${day}T23:59:00`).toISOString();
}

export function emptyState() {
  return {
    points: [],
    lastDay: {},
    water: { [KINDS.COLD_WATER]: WATER_STATUS.UNKNOWN, [KINDS.HOT_WATER]: WATER_STATUS.UNKNOWN },
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
      // Another account: forget what the previous one listed. Water is probed
      // again in any case (the portal may answer differently once signed in).
      const account = config.email ? accountHash(config.email) : null;
      if (account && this.state.account && account !== this.state.account) {
        this.state = emptyState();
      }
      this.state.account = account ?? this.state.account;
      for (const kind of WATER_KINDS) {
        if (this.state.water[kind] === WATER_STATUS.UNAVAILABLE) {
          this.state.water[kind] = WATER_STATUS.UNKNOWN;
        }
      }
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
      await this.readNewDays();
      await this.setStatus(true);
      this.gladys.requestWidgetRefresh(DWELLING_WIDGET);
      return { ok: true };
    } catch (err) {
      return this.handleError(err);
    } finally {
      this.store.saveState(this.state);
    }
  }

  async handleError(err) {
    if (err instanceof AuthError) {
      this.logger.warn(`Sign-in to the ista portal failed (${err.code}): ${err.message}`);
      await this.setStatus(false, AUTH_STATUS_TEXTS[err.code] ?? 'status_invalid_credentials');
      return { ok: false, authError: true, error: err };
    }
    if (err instanceof UnexpectedAnswerError) {
      this.logger.error(
        `Unexpected answer from the ista portal: ${err.message}. Structure (no values): ${JSON.stringify(err.shape)}`,
      );
      await this.setStatus(false, 'status_unexpected_answer');
      return { ok: false, error: err };
    }
    this.logger.error(`Reading the ista portal failed: ${err.message}`);
    await this.setStatus(false, 'status_unreachable');
    return { ok: false, error: err };
  }

  firstDayToRead(kind, yesterday) {
    const oldest = addDays(yesterday, -(BACKFILL_DAYS - 1));
    const last = this.state.lastDay[kind];
    if (!last || last < oldest) {
      return oldest;
    }
    return addDays(last, 1);
  }

  async readNewDays() {
    const yesterday = addDays(localDay(this.now()), -1);
    const newStates = [];
    let pointsChanged = false;
    let requests = 0;

    for (const kind of FLUIDS) {
      const isWater = kind !== KINDS.HEATING;
      if (isWater && this.state.water[kind] === WATER_STATUS.UNAVAILABLE) {
        continue;
      }
      for (
        let day = this.firstDayToRead(kind, yesterday);
        day <= yesterday;
        day = addDays(day, 1)
      ) {
        if (requests > 0 && this.requestGapMs > 0) {
          await sleep(this.requestGapMs);
        }
        requests += 1;
        let points;
        try {
          points = await this.client.fetchDay(kind, day);
        } catch (err) {
          if (!isWater || err instanceof AuthError) {
            throw err;
          }
          // Water never fails the run: the heating readings still go out.
          if (this.isUnsupportedPage(err) && this.state.water[kind] !== WATER_STATUS.AVAILABLE) {
            this.markWaterUnavailable(kind, err);
          } else {
            this.logger.warn(`Reading the ${kind} of ${day} failed: ${err.message}`);
          }
          break;
        }
        const ofKind = points.filter((point) => point.kind === kind);
        if (isWater && ofKind.length === 0) {
          this.markWaterUnavailable(kind);
          break;
        }
        if (isWater) {
          this.state.water[kind] = WATER_STATUS.AVAILABLE;
        }
        if (ofKind.some((point) => point.index === null)) {
          this.logger.info(`No ${kind} reading for ${day} on the portal yet`);
          break;
        }
        pointsChanged = this.mergePoints(points) || pointsChanged;
        const created_at = stateInstant(day);
        const kindsInAnswer = [...new Set(points.map((point) => point.kind))];
        for (const answerKind of kindsInAnswer) {
          for (const state of statesOfDay(answerKind, points)) {
            newStates.push({ ...state, created_at });
          }
        }
        this.recordDaily(day, kind, points);
        this.state.lastDay[kind] = day;
      }
    }

    if (pointsChanged) {
      await this.publishDevice();
    }
    if (newStates.length > 0) {
      await this.publishStates(newStates);
      this.state.recent = [...this.state.recent, ...newStates].slice(-MAX_RECENT_STATES);
    }
    this.logger.info(
      `Portal read: ${requests} request(s), ${newStates.length} new reading(s), latest day ${this.latestDay() ?? 'none'}`,
    );
  }

  isUnsupportedPage(err) {
    return err instanceof PortalError || err instanceof UnexpectedAnswerError;
  }

  markWaterUnavailable(kind, err) {
    this.state.water[kind] = WATER_STATUS.UNAVAILABLE;
    this.logger.info(
      `No ${kind} readings on the portal${err ? ` (${err.message})` : ''}: the ${kind} features stay hidden. If your dwelling has such a meter, please report it (see the documentation).`,
    );
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
    } else {
      entry[kind] = Math.round(ofKind.reduce((sum, point) => sum + point.index, 0) * 1000) / 1000;
    }
    this.state.daily = this.state.daily.slice(-DAILY_HISTORY_DAYS);
  }

  latestDay() {
    const days = Object.values(this.state.lastDay).filter(Boolean).sort();
    return days.at(-1) ?? null;
  }
}
