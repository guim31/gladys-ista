// -----------------------------------------------------------------------------
// Parsing of the portal's consumption answers.
//
// The resident portal answers its consumption pages with JSON:
//   { response: [ { pointsComptage: [ { metadata: {...}, consommation: {...} } ] } ] }
// one "counting point" per heat cost allocator (one per radiator) or water
// meter. The field names come from what the portal sends (they are French,
// like the portal); the shape was learned from the public projects credited in
// the README. Everything here is defensive: the portal is undocumented and may
// change without notice, so an unexpected answer becomes a clear error, never
// a crash or a wrong value.
// -----------------------------------------------------------------------------

export const KINDS = {
  HEATING: 'heating',
  COLD_WATER: 'cold_water',
  HOT_WATER: 'hot_water',
};

export class UnexpectedAnswerError extends Error {
  constructor(message, shape) {
    super(message);
    this.name = 'UnexpectedAnswerError';
    // Keys only, never values: safe to log and to paste in a bug report.
    this.shape = shape;
  }
}

/**
 * Describe the structure of a JSON value without any of its values (keys and
 * types only), so a user can share what the portal answered without exposing
 * their data. Arrays show their first element only.
 */
export function describeShape(value, depth = 0) {
  if (depth > 5) {
    return '…';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [describeShape(value[0], depth + 1)];
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).map((key) => [key, describeShape(value[key], depth + 1)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

/** A number from the portal: a JSON number, or a string with a comma or a dot. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/**
 * Which fluid a counting point measures, from its labels. The heating answer
 * only lists heat cost allocators; a water answer is assumed to say "eau
 * chaude" / "eau froide" in its labels, and otherwise takes the kind of the
 * page it came from (`fallback`).
 */
export function classifyPoint(metadata, fallback) {
  const label = [
    metadata.libelleTypeRepartiteur,
    metadata.libelleTypeCompteur,
    metadata.libelleFluide,
    metadata.typeFluide,
  ]
    .map(text)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (/eau\s*chaude|\becs\b/.test(label)) {
    return KINDS.HOT_WATER;
  }
  if (/eau\s*froide|\bef\b/.test(label)) {
    return KINDS.COLD_WATER;
  }
  if (/repartiteur|radiateur|chauffage|rfc/.test(label)) {
    return KINDS.HEATING;
  }
  return fallback;
}

/**
 * Parse one consumption answer.
 * @param {unknown} json the parsed JSON body
 * @param {string} fallbackKind kind of the page the answer came from
 * @returns {Array<{ id, serial, room, kind, index, consumption }>} one entry per
 *   counting point; `index` and `consumption` are null when the portal has no
 *   reading for the period yet.
 */
export function parseConsumptionAnswer(json, fallbackKind) {
  const blocks = json && Array.isArray(json.response) ? json.response : null;
  if (!blocks) {
    throw new UnexpectedAnswerError('the answer has no "response" list', describeShape(json));
  }
  const points = [];
  for (const block of blocks) {
    if (!block || !Array.isArray(block.pointsComptage)) {
      throw new UnexpectedAnswerError(
        'a "response" entry has no "pointsComptage" list',
        describeShape(json),
      );
    }
    for (const point of block.pointsComptage) {
      const metadata = point?.metadata ?? {};
      const id = text(metadata.numeroPointComptage);
      if (!id) {
        throw new UnexpectedAnswerError(
          'a counting point has no "numeroPointComptage"',
          describeShape(json),
        );
      }
      const consumption = point.consommation ?? {};
      const missing = consumption.is_null === true;
      const corrected = consumption.consommationCorrigee ?? {};
      const raw = consumption.consommationBrute ?? {};
      points.push({
        id,
        serial: text(metadata.numeroSerieRepartiteur ?? metadata.numeroSerieCompteur),
        room: text(metadata.libellePiece ?? metadata.codePiece),
        kind: classifyPoint(metadata, fallbackKind),
        index: missing ? null : toNumber(consumption.indexDernierJourPeriode),
        // Heating: the units of the period weighted by the radiator
        // coefficient (what the bill shares out), without the degree-day
        // weather correction. Falls back to the raw units.
        consumption: missing
          ? null
          : (toNumber(corrected.sansPonderationDju) ?? toNumber(raw.sansPonderationDju)),
      });
    }
  }
  return points;
}
