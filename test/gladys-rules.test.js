// -----------------------------------------------------------------------------
// Conformity of the published devices with what the Gladys core accepts and
// displays, against test/fixtures/gladys-feature-table.json (generated from
// the core constants and the front translations). Fix the device, never this
// test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice } from '../src/devices/dwelling.js';
import { KINDS } from '../src/ista/parse.js';
import { LANGUAGES, normalizeConfig } from '../src/config.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// Every kind of feature the integration can publish: heat cost allocators,
// several meters of each water fluid (totals included).
const FULL_MODEL = {
  points: [
    { id: '100001', serial: '90000001', room: 'SEJOUR', kind: KINDS.HEATING },
    { id: '100002', serial: '90000002', room: 'CHAMBRE 1', kind: KINDS.HEATING },
    { id: '200001', serial: 'EF-1', room: 'CUISINE', kind: KINDS.COLD_WATER },
    { id: '200002', serial: 'EF-2', room: 'SALLE DE BAINS', kind: KINDS.COLD_WATER },
    { id: '300001', serial: 'EC-1', room: 'CUISINE', kind: KINDS.HOT_WATER },
    { id: '300002', serial: '', room: '', kind: KINDS.HOT_WATER },
  ],
};

const gladys = createFakeGladys();
const devices = LANGUAGES.map((language) =>
  buildDevice(gladys, FULL_MODEL, normalizeConfig({ language })),
);
const features = devices.flatMap((device) => device.features);

test('every category/type couple is one the core knows and the front labels', () => {
  for (const feature of features) {
    const pair = `${feature.category}/${feature.type}`;
    assert.ok(table.categories.includes(feature.category), `unknown category ${feature.category}`);
    assert.ok(table.types.includes(feature.type), `unknown type ${feature.type}`);
    assert.ok(table.pairs[pair], `couple ${pair} missing from the feature table`);
  }
});

test('polling: should_poll is a boolean, and poll_frequency a listed value in ms', () => {
  for (const device of devices) {
    assert.equal(typeof device.should_poll, 'boolean');
    if (device.should_poll) {
      assert.ok(table.poll_frequencies_ms.includes(device.poll_frequency));
    } else {
      assert.ok(
        device.poll_frequency === undefined ||
          table.poll_frequencies_ms.includes(device.poll_frequency),
      );
    }
  }
});

test('min and max are numbers on every feature (NOT NULL in the database)', () => {
  for (const feature of features) {
    assert.equal(typeof feature.min, 'number', `${feature.external_id}: min`);
    assert.equal(typeof feature.max, 'number', `${feature.external_id}: max`);
    assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max));
    assert.ok(feature.min <= feature.max, `${feature.external_id}: min > max`);
  }
});

test('read_only and has_feedback are booleans', () => {
  for (const feature of features) {
    assert.equal(typeof feature.read_only, 'boolean', `${feature.external_id}: read_only`);
    assert.equal(typeof feature.has_feedback, 'boolean', `${feature.external_id}: has_feedback`);
  }
});

test('units are known, and allowed for the category', () => {
  for (const feature of features) {
    if (feature.unit === undefined || feature.unit === null) {
      continue;
    }
    assert.ok(table.units.includes(feature.unit), `unknown unit ${feature.unit}`);
    const allowed = table.units_by_category[feature.category];
    if (allowed) {
      assert.ok(
        allowed.includes(feature.unit),
        `${feature.unit} not allowed in ${feature.category}`,
      );
    }
  }
});

test('external ids are unique, and every name is a non-empty string', () => {
  for (const device of devices) {
    const ids = [device.external_id, ...device.features.map((f) => f.external_id)];
    assert.equal(new Set(ids).size, ids.length, 'duplicate external_id');
    for (const feature of device.features) {
      assert.ok(typeof feature.name === 'string' && feature.name.length > 0);
    }
  }
});

test('the external ids do not depend on the language', () => {
  const ids = devices.map((device) => device.features.map((f) => f.external_id).join());
  assert.equal(new Set(ids).size, 1);
});

test('the fake Gladys of the SDK accepts the publication', async () => {
  const fake = createFakeGladys();
  await fake.connect();
  await fake.publishDiscoveredDevices([buildDevice(fake, FULL_MODEL, normalizeConfig())]);
  assert.equal(fake.fake.discoveredDevices.length, 1);
});
