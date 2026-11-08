import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS,
  UnexpectedAnswerError,
  addDays,
  classifyMeter,
  dayToFrench,
  describeIndexForm,
  fieldValue,
  looseDay,
  parseIndexForm,
  parseMeters,
  toNumber,
} from '../src/ista/parse.js';
import { meterBlocks, renderIndexPage } from './helpers/fakePortal.js';

const PAGE_URL = 'https://ista-webconso.fr/espace-client-v2/occupant/ficheIndexDemande.do';

const waterAnswer = () =>
  renderIndexPage({
    csrf: 'csrf-1',
    dispatch: 'voirIndexDemande',
    dateMax: '20261010',
    from: '09/10/2026',
    day: '10/10/2026',
    waterResult: meterBlocks('index-water-meters.html', '09/10/2026', '10/10/2026'),
  });

test('the index form: every field a browser sends, and what the page offers', () => {
  const form = parseIndexForm(renderIndexPage({ csrf: 'csrf-1', dateMax: '20261010' }), PAGE_URL);
  assert.equal(form.action, PAGE_URL);
  assert.equal(fieldValue(form, '_csrf'), 'csrf-1');
  assert.equal(fieldValue(form, 'dispatch'), 'init');
  assert.equal(fieldValue(form, 'choixOnglet'), 'EAU');
  // A multi-line value is sent back as is (entities decoded).
  assert.match(fieldValue(form, 'uex.adressePostale'), /RUE DE L'EXEMPLE\s+00000/);
  // The search button is never sent; the period input has no name.
  const names = form.fields.map(([name]) => name);
  assert.ok(!names.includes(''));
  assert.ok(names.includes('dateIndexDemande'));
  assert.equal(form.byId.choixDateDebutPeriodeIndex.name, undefined);
  assert.deepEqual(describeIndexForm(form), {
    water: true,
    heatingInstalled: false,
    heatingIndex: false,
    minDay: '2026-01-01',
    maxDay: '2026-10-10',
    declaredMeters: 0,
  });
});

test('heating is offered only when the page says so', () => {
  const offered = describeIndexForm(
    parseIndexForm(
      renderIndexPage({ csrf: 'c', dateMax: '20261010', heating: true, heatingIndex: true }),
      PAGE_URL,
    ),
  );
  assert.equal(offered.heatingInstalled, true);
  assert.equal(offered.heatingIndex, true);
  const noWater = describeIndexForm(
    parseIndexForm(renderIndexPage({ csrf: 'c', dateMax: '', water: false }), PAGE_URL),
  );
  assert.equal(noWater.water, false);
  assert.equal(noWater.maxDay, null);
  assert.equal(parseIndexForm('<html><form name="other"></form></html>', PAGE_URL), null);
});

test('a water search gives one meter per block, fluid, index, date, real or estimated', () => {
  assert.deepEqual(parseMeters(waterAnswer(), KINDS.COLD_WATER), [
    {
      id: '900000101',
      serial: '900000101',
      room: 'CUISINE',
      kind: KINDS.COLD_WATER,
      index: 123.456,
      consumption: 0.44,
      estimated: false,
      day: '2026-10-10',
      from: '2026-10-09',
    },
    {
      id: '900000202',
      serial: '900000202',
      room: 'SALLE DE BAINS',
      kind: KINDS.HOT_WATER,
      index: 45.678,
      consumption: 0.125,
      estimated: true,
      day: '2026-10-10',
      from: '2026-10-09',
    },
  ]);
});

test('an unreadable index stays null, never 0', () => {
  const html = waterAnswer().replace(
    /<div class="key">Index relevé<\/div>\s*<div class="value">\s*123\.456\s*<\/div>/,
    '<div class="key">Index relevé</div><div class="value"> - </div>',
  );
  // The shown counter is the fallback…
  assert.equal(parseMeters(html, KINDS.COLD_WATER)[0].index, 123.456);
  // …and without it, nothing.
  const none = html.replace(/(id="indexCompteur_0"[^>]*>)\s*123\.456/, '$1 ');
  assert.equal(parseMeters(none, KINDS.COLD_WATER)[0].index, null);
});

test('the init page has no meter; announced meters that cannot be read are a portal change', () => {
  assert.deepEqual(parseMeters(renderIndexPage({ csrf: 'c' }), KINDS.COLD_WATER), []);
  const announced = waterAnswer().replace(/class="le-compteur"/g, 'class="autre-chose"');
  assert.throws(
    () => parseMeters(announced, KINDS.COLD_WATER),
    (err) => err instanceof UnexpectedAnswerError && err.shape.declaredMeters === 2,
  );
  const noNumber = waterAnswer().replace(/Numéro du compteur/g, 'Autre');
  assert.throws(
    () => parseMeters(noNumber, KINDS.COLD_WATER),
    (err) => {
      // Labels only in the shape, never a value of the account.
      const shape = JSON.stringify(err.shape);
      return err instanceof UnexpectedAnswerError && !/900000|123\.456|CUISINE/.test(shape);
    },
  );
});

test('the hypothetical heating answer reads like the water one', () => {
  const html = renderIndexPage({
    csrf: 'c',
    heating: true,
    heatingIndex: true,
    heatingResult: meterBlocks('index-heating-meters.html', '09/10/2026', '10/10/2026'),
  });
  const meters = parseMeters(html, KINDS.HEATING);
  assert.deepEqual(
    meters.map((m) => [m.id, m.kind, m.room, m.index, m.consumption, m.day]),
    [
      ['800000301', KINDS.HEATING, 'SEJOUR', 1520, 12, '2026-10-10'],
      ['800000302', KINDS.HEATING, 'CHAMBRE', 640, 4.5, '2026-10-10'],
    ],
  );
});

test('helpers', () => {
  assert.equal(classifyMeter('EAU CHAUDE 01/01/2026 au 02/01/2026'), KINDS.HOT_WATER);
  assert.equal(classifyMeter('Eau froide'), KINDS.COLD_WATER);
  assert.equal(classifyMeter('Répartiteur'), KINDS.HEATING);
  assert.equal(classifyMeter('', KINDS.COLD_WATER), KINDS.COLD_WATER);
  assert.equal(looseDay('20260307'), '2026-03-07');
  assert.equal(looseDay('07/03/2026'), '2026-03-07');
  assert.equal(looseDay('2026/03/07'), '2026-03-07');
  assert.equal(looseDay('2026-03-07T00:00:00'), '2026-03-07');
  assert.equal(looseDay('n/a'), null);
  assert.equal(dayToFrench('2026-03-07'), '07/03/2026');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(toNumber('1 234,5'), 1234.5);
  assert.equal(toNumber('123.456'), 123.456);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toNumber(Number.NaN), null);
  assert.equal(toNumber(null), null);
});
