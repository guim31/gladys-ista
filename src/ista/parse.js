// -----------------------------------------------------------------------------
// Parsing of the portal's "index à la demande" page (index on demand).
//
// The resident portal has no API: it renders HTML pages. The page
// `occupant/ficheIndexDemande.do` holds one form (`ficheIndexDemandeOccupantForm`)
// whose hidden fields say what the dwelling has (water, heating, the range of
// dates with readings). Posting that same form back with
// `dispatch=voirIndexDemande`, a reading date and a period start answers the
// same page with one block per meter:
//
//   <div class="le-compteur">
//     <div class="top-compteur"> EAU FROIDE <br/> 01/01/2026 au 02/01/2026 …
//       <div id="indexCompteur_0">123.456</div> </div>
//     <div class="content-compteur">
//       <div class="une-ligne"><div class="key">Numéro du compteur</div>
//                              <div class="value">…</div></div>  …
//
// Everything here is defensive: the portal is undocumented and may change
// without notice, so an unexpected page becomes a clear error, never a crash
// or an invented value (a missing index stays null, never 0).
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
    // Structure only (field names, labels, counts), never a value of the
    // account: safe to log and to paste in a bug report.
    this.shape = shape;
  }
}

// The accented letters of French labels and addresses, as the portal may
// write them (&amp; is decoded last, so "&amp;eacute;" stays text).
const NAMED_ENTITIES = {
  lt: '<',
  gt: '>',
  apos: "'",
  laquo: '«',
  raquo: '»',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  icirc: 'î',
  iuml: 'ï',
  ocirc: 'ô',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  Eacute: 'É',
  Egrave: 'È',
  Agrave: 'À',
  Ccedil: 'Ç',
  deg: '°',
};

export function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&sup3;/g, '³')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name] ?? entity)
    .replace(/&amp;/g, '&');
}

export function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeHtml(match[2] ?? match[3] ?? '') : undefined;
}

/** Visible text of an HTML fragment, on one line. */
export function textOf(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower case, no accents, single spaces: for matching portal labels. */
export function normalizeLabel(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A number from the portal: `123.456`, `0,440`, `1 234,5`. */
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

// --- Dates ----------------------------------------------------------------------

/** `YYYYMMDD` (the form's `dateMaxIndex`) to `YYYY-MM-DD`, or null. */
export function compactToDay(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec((value ?? '').trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** `DD/MM/YYYY` (what the portal shows and expects) to `YYYY-MM-DD`, or null. */
export function frenchToDay(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** `count` calendar days after `day` (`YYYY-MM-DD`, no time zone involved). */
export function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` to `DD/MM/YYYY`. */
export function dayToFrench(day) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/**
 * A date in any of the shapes the portal uses (`YYYYMMDD`, `DD/MM/YYYY`,
 * `YYYY-MM-DD`, `YYYY/MM/DD`), as `YYYY-MM-DD`, or null.
 */
export function looseDay(value) {
  const text = (value ?? '').trim();
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(text);
  return compactToDay(text) ?? frenchToDay(text) ?? (iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null);
}

// --- The form -------------------------------------------------------------------

export const INDEX_FORM_NAME = 'ficheIndexDemandeOccupantForm';

const UNSENT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'file']);

/**
 * The index form of a page: its action, every field a browser would send
 * (name and value, in page order), and the inputs that have an id (some date
 * inputs are found by id, their name is what gets sent). Null when the page
 * has no such form.
 */
export function parseIndexForm(html, pageUrl) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const form =
    forms.find(
      (candidate) => attribute(candidate.match(/<form\b[^>]*>/i)[0], 'name') === INDEX_FORM_NAME,
    ) ?? forms.find((candidate) => /\sname\s*=\s*["']dateMaxIndex["']/i.test(candidate));
  if (!form) {
    return null;
  }
  const openingTag = form.match(/<form\b[^>]*>/i)[0];
  const fields = [];
  const byId = {};
  for (const tag of form.match(/<input\b[^>]*>/gi) ?? []) {
    const name = attribute(tag, 'name');
    const id = attribute(tag, 'id');
    const type = (attribute(tag, 'type') ?? 'text').toLowerCase();
    const value = attribute(tag, 'value') ?? '';
    if (id) {
      byId[id] = { name, value };
    }
    if (!name || UNSENT_INPUT_TYPES.has(type)) {
      continue;
    }
    if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(tag)) {
      continue;
    }
    fields.push([name, value]);
  }
  for (const select of form.match(/<select\b[\s\S]*?<\/select>/gi) ?? []) {
    const name = attribute(select.match(/<select\b[^>]*>/i)[0], 'name');
    if (!name) {
      continue;
    }
    const options = select.match(/<option\b[^>]*>/gi) ?? [];
    const chosen = options.find((option) => /\sselected\b/i.test(option)) ?? options[0];
    fields.push([name, chosen ? (attribute(chosen, 'value') ?? '') : '']);
  }
  const action = attribute(openingTag, 'action') || pageUrl;
  return { action: new URL(action, pageUrl).toString(), fields, byId };
}

/** Value of the first field of that name, or undefined. */
export function fieldValue(form, name) {
  return form.fields.find(([field]) => field === name)?.[1];
}

// `"false"` says no; a missing field says nothing either way.
const says = (form, name) => {
  const value = fieldValue(form, name);
  return value === undefined ? null : value.trim().toLowerCase() === 'true';
};

/**
 * What the index page offers, from its form's hidden fields.
 * @returns {{ water: boolean, heatingInstalled: boolean, heatingIndex: boolean,
 *   minDay: string|null, maxDay: string|null, declaredMeters: number|null }}
 */
export function describeIndexForm(form) {
  const waterInstalled = says(form, 'logement.eauDisponible');
  const waterIndex = says(form, 'indexDemandeEauDisponible');
  const heatingInstalled = says(form, 'logement.chauffageDisponible');
  const heatingIndex = says(form, 'indexDemandeChauffageRfcDisponible');
  const declared = Number.parseInt(fieldValue(form, 'nombreDeCompteur') ?? '', 10);
  return {
    water: waterInstalled !== false && waterIndex !== false,
    heatingInstalled: heatingInstalled === true,
    heatingIndex: heatingInstalled !== false && heatingIndex === true,
    minDay: compactToDay(fieldValue(form, 'dateMinIndex')),
    maxDay: compactToDay(fieldValue(form, 'dateMaxIndex')),
    declaredMeters: Number.isFinite(declared) ? declared : null,
  };
}

// --- The meters -----------------------------------------------------------------

/**
 * Which fluid a meter measures, from the heading of its block ("EAU FROIDE",
 * "EAU CHAUDE"); `fallback` when the heading says neither.
 */
export function classifyMeter(heading, fallback) {
  const label = normalizeLabel(heading);
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

const BLOCK_START = /<div\b[^>]*\sclass\s*=\s*["'][^"']*\ble-compteur\b[^"']*["'][^>]*>/gi;
const KEY_VALUE =
  /<div\b[^>]*\sclass\s*=\s*["']key["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*\sclass\s*=\s*["']value["'][^>]*>([\s\S]*?)<\/div>/gi;
const PERIOD = /(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i;

/** The `key` / `value` lines of a meter block, keyed by normalized label. */
function lines(block) {
  const result = new Map();
  for (const [, key, value] of block.matchAll(KEY_VALUE)) {
    const label = normalizeLabel(textOf(key));
    if (label && !result.has(label)) {
      result.set(label, textOf(value));
    }
  }
  return result;
}

function find(map, test) {
  for (const [label, value] of map) {
    if (test(label)) {
      return value;
    }
  }
  return undefined;
}

/** Labels only (never values): what a bug report may show of an answer. */
function shapeOf(blocks, declaredMeters) {
  return {
    declaredMeters,
    blocks: blocks.length,
    labels: [...new Set(blocks.flatMap((block) => [...lines(block).keys()]))],
  };
}

/**
 * The meters of an answer to an index search.
 * @param {string} html the answer page
 * @param {string} fallbackKind fluid of a block whose heading says none
 * @returns {Array<{ id, serial, room, kind, index, consumption, estimated,
 *   day, from }>} `index` and `consumption` are null when unreadable; `day` is
 *   the reading date (`YYYY-MM-DD`), `from` the period start, null if absent.
 */
export function parseMeters(html, fallbackKind) {
  const form = parseIndexForm(html, 'https://localhost/');
  const declaredMeters = form ? describeIndexForm(form).declaredMeters : null;
  const starts = [...html.matchAll(BLOCK_START)].map((match) => match.index);
  const blocks = starts.map((start, i) => html.slice(start, starts[i + 1] ?? html.length));
  if (blocks.length === 0) {
    if (declaredMeters) {
      throw new UnexpectedAnswerError(
        `the portal announces ${declaredMeters} meter(s) but none could be read`,
        shapeOf(blocks, declaredMeters),
      );
    }
    return [];
  }
  return blocks.map((block) => {
    const split = block.search(/\sclass\s*=\s*["'][^"']*\bcontent-compteur\b/i);
    const top = split > 0 ? block.slice(0, split) : block;
    const heading = textOf(
      top.replace(/<div\b[^>]*\sid\s*=\s*["']indexCompteur_[\s\S]*?<\/div>/i, ''),
    );
    const values = lines(block);
    const id = (find(values, (label) => label.startsWith('numero')) ?? '').replace(/\s+/g, '');
    if (!id) {
      throw new UnexpectedAnswerError('a meter has no number', shapeOf(blocks, declaredMeters));
    }
    const shownIndex = top.match(/\sid\s*=\s*["']indexCompteur_\d+["'][^>]*>([\s\S]*?)<\/div>/i);
    const index =
      toNumber(find(values, (label) => label === 'index releve')) ??
      (shownIndex ? toNumber(textOf(shownIndex[1])) : null);
    const consumption =
      toNumber(
        find(values, (label) => label.startsWith('consommation') && label.includes('litre')),
      ) ?? toNumber(find(values, (label) => label.startsWith('consommation')));
    const realOrEstimated = normalizeLabel(
      find(values, (label) => label.startsWith('index reel')) ?? '',
    );
    const period = PERIOD.exec(heading);
    return {
      id,
      serial: id,
      room: find(values, (label) => label === 'emplacement') ?? '',
      kind: classifyMeter(heading, fallbackKind),
      index,
      consumption,
      estimated: realOrEstimated.startsWith('estim'),
      day: period ? frenchToDay(period[2]) : null,
      from: period ? frenchToDay(period[1]) : null,
    };
  });
}
