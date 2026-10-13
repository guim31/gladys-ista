// -----------------------------------------------------------------------------
// The dwelling device: one Gladys device for the resident account, with one
// feature per counting point the portal lists.
//
//   - heat cost allocator (one per radiator): `counter-sensor`/`integer`, no
//     unit. Its units have no physical dimension (they only share the heating
//     bill out between dwellings), so no energy unit is claimed for them. The
//     state is the index shown on the allocator.
//   - heating units of the day: `counter-sensor`/`integer`, the sum of the
//     day's units of all the radiators, weighted by each radiator's
//     coefficient (what the bill uses). A bar per day in the charts.
//   - water meter: `volume-sensor`/`decimal` in m³, the cumulative index, and
//     a total per fluid when the dwelling has several meters of it.
//
// External ids are forever: the device id is fixed (one dwelling per account,
// see the README), the feature ids derive from the counting point number the
// portal gives, which follows the radiator or the meter slot, not a label.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { KINDS } from '../ista/parse.js';
import { t } from '../i18n.js';

export const DEVICE_TYPE = 'dwelling';
export const DEVICE_PLATFORM_ID = 'main';

export const FEATURE_KEYS = {
  HEATING_DAILY: 'heating-daily',
  COLD_WATER_TOTAL: 'cold-water-total',
  HOT_WATER_TOTAL: 'hot-water-total',
  point: (id) => `point-${id}`,
};

// Display bounds only: the core never enforces them on states, they place the
// needle of a gauge. NOT NULL in the database.
const COUNTER_MAX = 10_000_000;
const DAILY_UNITS_MAX = 10_000;
const WATER_MAX = 100_000;

// The core constants give `counter-sensor` no type group of its own: the
// front labels the `counter-sensor`/`integer` couple ("Counter").
const COUNTER_TYPE = 'integer';

const WATER_TOTAL_KEYS = {
  [KINDS.COLD_WATER]: FEATURE_KEYS.COLD_WATER_TOTAL,
  [KINDS.HOT_WATER]: FEATURE_KEYS.HOT_WATER_TOTAL,
};

export function deviceIds(gladys) {
  return gladys.externalIds(DEVICE_TYPE, DEVICE_PLATFORM_ID);
}

function sensor(ids, key, name, extra) {
  return {
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    ...extra,
  };
}

function pointLabel(point, language) {
  const parts = [point.room, point.serial ? `${t('serial_short', language)} ${point.serial}` : '']
    .filter(Boolean)
    .join(' — ');
  return parts || `${t('serial_short', language)} ${point.id}`;
}

function sortedPoints(model, kind) {
  return model.points
    .filter((point) => point.kind === kind)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** Water fluids that get a total feature: those with several meters. */
export function waterKindsWithTotal(model) {
  return [KINDS.COLD_WATER, KINDS.HOT_WATER].filter((kind) => sortedPoints(model, kind).length > 1);
}

/**
 * The discovery payload of the dwelling, from the counting points the portal
 * listed so far (`model.points`). Null when there is nothing to show yet.
 */
export function buildDevice(gladys, model, config) {
  if (!model || model.points.length === 0) {
    return null;
  }
  const ids = deviceIds(gladys);
  const { language } = config;
  const features = [];

  const heatingPoints = sortedPoints(model, KINDS.HEATING);
  if (heatingPoints.length > 0) {
    features.push(
      sensor(ids, FEATURE_KEYS.HEATING_DAILY, t('heating_daily', language), {
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: COUNTER_TYPE,
        max: DAILY_UNITS_MAX,
      }),
    );
  }
  for (const point of heatingPoints) {
    features.push(
      sensor(
        ids,
        FEATURE_KEYS.point(point.id),
        `${t('radiator', language)} ${pointLabel(point, language)}`,
        {
          category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
          type: COUNTER_TYPE,
          max: COUNTER_MAX,
        },
      ),
    );
  }

  for (const kind of [KINDS.COLD_WATER, KINDS.HOT_WATER]) {
    const points = sortedPoints(model, kind);
    const water = {
      category: DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR,
      type: DEVICE_FEATURE_TYPES.VOLUME_SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CUBIC_METER,
      max: WATER_MAX,
    };
    if (points.length > 1) {
      features.push(
        sensor(
          ids,
          WATER_TOTAL_KEYS[kind],
          `${t(kind, language)} — ${t('total', language)}`,
          water,
        ),
      );
    }
    for (const point of points) {
      features.push(
        sensor(
          ids,
          FEATURE_KEYS.point(point.id),
          `${t(kind, language)} ${pointLabel(point, language)}`,
          water,
        ),
      );
    }
  }

  return {
    name: t('device_name', language),
    external_id: ids.device,
    // Readings change a few times a day at most: the container drives its
    // own timer (src/sync.js), Gladys never polls this device.
    should_poll: false,
    features,
  };
}

/**
 * The dated states of one day of readings, keyed by feature key.
 * @param {string} kind the fluid the readings belong to
 * @param {Array} points parsed counting points of that day
 * @returns {Array<{ key, state }>}
 */
export function statesOfDay(kind, points) {
  const states = points
    .filter((point) => point.kind === kind && point.index !== null)
    .map((point) => ({ key: FEATURE_KEYS.point(point.id), state: point.index }));
  if (kind === KINDS.HEATING) {
    const consumptions = points
      .filter((point) => point.kind === KINDS.HEATING)
      .map((point) => point.consumption);
    if (consumptions.length > 0 && consumptions.every((value) => value !== null)) {
      const total = consumptions.reduce((sum, value) => sum + value, 0);
      states.push({ key: FEATURE_KEYS.HEATING_DAILY, state: Math.round(total * 100) / 100 });
    }
  } else {
    const indexes = points.filter((point) => point.kind === kind).map((point) => point.index);
    if (indexes.length > 1 && indexes.every((value) => value !== null)) {
      const total = indexes.reduce((sum, value) => sum + value, 0);
      states.push({ key: WATER_TOTAL_KEYS[kind], state: Math.round(total * 1000) / 1000 });
    }
  }
  return states;
}
