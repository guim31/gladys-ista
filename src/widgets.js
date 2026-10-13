// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): the dwelling at a glance.
//
//   - tiles: heating units of the latest day read, and the water indexes;
//   - a bar chart of the heating units per day (the last 31 days read);
//   - a status list: latest reading day, next check, portal connection.
//
// The values come from the container's own record (src/sync.js), not from
// device features: the widget works before the user creates the device, and
// the chart shows each day on its own date. The content is pre-localized from
// the `language` Gladys sends (the core caches it per language).
// Budget: 3 tiles + 1 chart + 1 status, or 1 text + 1 status when empty.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { KINDS } from './ista/parse.js';
import { DWELLING_WIDGET } from './sync.js';
import { LANGUAGES } from './config.js';
import { t } from './i18n.js';

// The data changes a few times a day: the content is re-pulled hourly at
// most, and nudged after each reading (requestWidgetRefresh).
const TTL_SECONDS = 3600;

function formatDay(day, language) {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

function formatDateTime(date, language) {
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function latestWith(daily, kind) {
  return daily.filter((entry) => entry[kind] !== undefined).at(-1);
}

/**
 * Build the widget content.
 * @param {object} summary IstaSync#summary()
 * @param {string} requestedLanguage language Gladys asks for
 */
export function buildDwellingContent(summary, requestedLanguage) {
  const language = LANGUAGES.includes(requestedLanguage) ? requestedLanguage : 'en';
  const status = {
    type: 'status',
    items: [
      {
        label: t('widget_connection', language),
        value: t(summary.connected ? 'widget_connected' : 'widget_disconnected', language),
        icon: summary.connected ? 'check-circle' : 'alert-circle',
        color: summary.connected ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      },
    ],
  };
  if (summary.nextRunAt) {
    status.items.unshift({
      label: t('widget_next_check', language),
      value: formatDateTime(summary.nextRunAt, language),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }

  const { daily } = summary;
  if (daily.length === 0) {
    return {
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', variant: 'body', text: t('widget_empty', language) }, status],
    };
  }

  const components = [];
  const heating = latestWith(daily, KINDS.HEATING);
  if (heating) {
    components.push({
      type: 'value',
      label: t('widget_heating_day', language),
      value: heating[KINDS.HEATING],
      unit: t('units', language),
      icon: 'thermometer',
    });
  }
  for (const kind of [KINDS.COLD_WATER, KINDS.HOT_WATER]) {
    const water = latestWith(daily, kind);
    if (water) {
      components.push({
        type: 'value',
        label: t(`widget_${kind}_index`, language),
        value: water[kind],
        unit: 'm³',
        icon: 'droplet',
        color: kind === KINDS.HOT_WATER ? WIDGET_COLORS.DANGER : WIDGET_COLORS.INFO,
      });
    }
  }
  const heatingDays = daily.filter((entry) => entry[KINDS.HEATING] !== undefined);
  if (heatingDays.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: t('widget_heating_chart', language),
      unit: t('units', language),
      series: [
        {
          name: t('heating', language),
          points: heatingDays.map((entry) => ({
            t: `${entry.day}T12:00:00.000Z`,
            v: entry[KINDS.HEATING],
          })),
        },
      ],
    });
  }
  status.items.unshift({
    label: t('widget_latest_reading', language),
    value: formatDay(daily.at(-1).day, language),
    icon: 'calendar',
    color: WIDGET_COLORS.NEUTRAL,
  });
  components.push(status);
  return { ttl_seconds: TTL_SECONDS, components };
}

/** Widget handlers, keyed by the manifest widget key (registered by index.js). */
export function createWidgets(sync) {
  return {
    [DWELLING_WIDGET]: {
      get: ({ language }) => buildDwellingContent(sync.summary(), language),
    },
  };
}
