// -----------------------------------------------------------------------------
// Wiring of the integration on the SDK client: every handler, registered
// before connect(). Kept out of index.js so the tests run it against the
// SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { LANGUAGES, normalizeConfig } from './config.js';
import { IstaSync } from './sync.js';
import { createWidgets } from './widgets.js';
import { KINDS } from './ista/parse.js';
import { allLanguages, t } from './i18n.js';
import { createStore } from './store.js';

const logger = createLogger({ name: 'ista' });

export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

/**
 * Result of the "Test the connection" action: what the portal listed.
 */
export function describeConnection(sync, result) {
  if (!result.ok) {
    const textKey = sync.state.status?.text ?? 'status_unreachable';
    return allLanguages(textKey);
  }
  const count = (kinds) => sync.state.points.filter((point) => kinds.includes(point.kind)).length;
  const day = sync.latestDay();
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t('test_success', language, {
        heating: count([KINDS.HEATING]),
        water: count([KINDS.COLD_WATER, KINDS.HOT_WATER]),
        day: day ?? t('no_reading_yet', language),
      }),
    ]),
  );
}

/**
 * Register every handler.
 * @param {object} gladys the SDK client (or the fake one in tests)
 * @param {object} [options] `store`, `fetch`, `now`, `requestGapMs`, `autoStart`
 * @returns {IstaSync}
 */
export function registerHandlers(gladys, options = {}) {
  const { autoStart = true } = options;
  const sync = new IstaSync({
    gladys,
    store: options.store ?? createStore(),
    fetch: options.fetch,
    now: options.now,
    requestGapMs: options.requestGapMs,
  });
  sync.setConfig(normalizeConfig());

  gladys.onScanRequest(async () => {
    await sync.publishDevice();
  });

  // Fallback only: the device is published with `should_poll: false`, the
  // container's timer drives the readings. Should Gladys poll it anyway, the
  // poll reads nothing more than what is already due.
  gladys.onPoll(async () => {
    await sync.refreshIfDue();
  });

  // Gladys dropped every state published before the device existed: send
  // the recent readings again once it does, and after an "Update" from the
  // Discovery tab (new meters).
  const resendStates = async (device) => {
    if (sync.isOwnDevice(device)) {
      await sync.republishRecentStates();
    }
  };
  gladys.onDeviceCreated(resendStates);
  gladys.onDeviceUpdated(resendStates);

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    const result = await sync.refresh();
    // One line per user action, whatever the failure logging already said.
    logger.info(
      `Connection test: ${result.ok ? 'OK' : `failed (${sync.state.status?.text ?? 'unknown'})`}`,
    );
    return describeConnection(sync, result);
  });

  for (const [key, widget] of Object.entries(createWidgets(sync))) {
    gladys.onWidgetGet(key, (request) => widget.get(request));
  }

  gladys.onConfigUpdated(async (newConfig) => {
    const accountChanged = sync.setConfig(normalizeConfig(newConfig));
    await sync.publishDevice();
    if (autoStart) {
      if (accountChanged) {
        sync.stop();
        sync.schedule(0);
      } else {
        sync.start();
      }
    }
  });

  gladys.on('connected', async () => {
    try {
      sync.setConfig(normalizeConfig(await gladys.getConfig()));
      // What the previous runs listed is in /data: no portal request needed
      // to show the device again.
      await sync.publishDevice();
      await sync.sendStatus();
      if (autoStart) {
        sync.start();
      }
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
    }
  });

  gladys.on('disconnected', () => {
    sync.stop();
  });

  gladys.handleShutdown(() => {
    sync.stop();
  });

  return sync;
}
