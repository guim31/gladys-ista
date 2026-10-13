// -----------------------------------------------------------------------------
// Every text a user sees exists in English, French, German and Spanish: the
// manifest, the texts sent from the container (src/i18n.js) and the widget.
// German uses the informal "du", Spanish the formal "usted" (maintainer's
// decision for all his integrations).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEXTS } from '../src/i18n.js';
import { LANGUAGES } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const TEXT_KEYS = new Set(['label', 'description', 'placeholder']);

// Every multi-language object of the manifest, with its path.
function manifestTexts(node, path = 'manifest', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => manifestTexts(child, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (TEXT_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        found.push({ path: `${path}.${key}`, text: value });
      } else {
        manifestTexts(value, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

const allTexts = [
  ...manifestTexts(manifest),
  ...Object.entries(TEXTS).map(([key, text]) => ({ path: `src/i18n.js ${key}`, text })),
];

// Formal German: "Sie", "Ihr/Ihre/Ihnen…" as a polite form. A capitalized
// "Ihr" at the start of a sentence would be informal plural, which these texts
// never use either.
const GERMAN_FORMAL = /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
// Informal Spanish: the "tú" pronouns and possessives these texts must not use
// (imperatives are not checked: "introduce" is also a third person).
const SPANISH_INFORMAL = /(^|[^\p{L}])(tú|tu|tus|te|ti|contigo)(?=[^\p{L}]|$)/iu;

test('every text exists in en, fr, de and es, and none is empty', () => {
  assert.ok(allTexts.length > 40);
  for (const { path, text } of allTexts) {
    for (const language of LANGUAGES) {
      assert.equal(typeof text[language], 'string', `${path}: missing "${language}"`);
      assert.ok(text[language].trim().length > 0, `${path}: empty "${language}"`);
    }
    for (const language of Object.keys(text)) {
      assert.ok(LANGUAGES.includes(language), `${path}: unexpected language "${language}"`);
    }
  }
});

test('German says "du", never the polite "Sie"', () => {
  for (const { path, text } of allTexts) {
    assert.doesNotMatch(text.de, GERMAN_FORMAL, `${path}: formal German "${text.de}"`);
  }
});

test('Spanish says "usted", never "tú"', () => {
  for (const { path, text } of allTexts) {
    assert.doesNotMatch(text.es, SPANISH_INFORMAL, `${path}: informal Spanish "${text.es}"`);
  }
});

test('texts fit where Gladys shows them', () => {
  const limits = [
    // The store card: 10 to 100 characters.
    { path: /^manifest\.description$/, max: 100, min: 10 },
    // Widget status labels (40), tile labels (24), connection status, toasts.
    { path: /widget_(latest_reading|next_check|connection|connected|disconnected)$/, max: 40 },
    { path: /widget_(heating_day|cold_water_index|hot_water_index)$/, max: 24 },
    { path: /src\/i18n\.js units$/, max: 6 },
    { path: /src\/i18n\.js (heating|cold_water|hot_water)$/, max: 24 },
    { path: /src\/i18n\.js widget_heating_chart$/, max: 60 },
    { path: /src\/i18n\.js status_/, max: 200 },
    { path: /src\/i18n\.js test_success$/, max: 200 },
  ];
  for (const { path, text } of allTexts) {
    for (const limit of limits.filter((l) => l.path.test(path))) {
      for (const language of LANGUAGES) {
        const { length } = text[language];
        assert.ok(length <= limit.max, `${path}.${language}: ${length} > ${limit.max}`);
        assert.ok(length >= (limit.min ?? 1), `${path}.${language}: too short`);
      }
    }
  }
});

test('the manifest name is the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('placeholders keep the same names in every language', () => {
  for (const [key, text] of Object.entries(TEXTS)) {
    const names = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const language of LANGUAGES) {
      assert.equal(names(text[language]), names(text.en), `${key}.${language}: placeholders`);
    }
  }
});
