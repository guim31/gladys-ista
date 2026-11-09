import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, localDay, stateInstant } from '../src/sync.js';
import { KINDS } from '../src/ista/parse.js';
import { ACCOUNT, createFakePortal, fixture, meterBlocks } from './helpers/fakePortal.js';
import { setup } from './helpers/setup.js';

// The index page is opened through its menu entry (menu.do, redirected to the page).
const pageReads = (portal) =>
  portal.requests.filter((r) => r.method === 'GET' && r.url.includes('menu.do?id=lgtOcc_index'));
const searchDays = (portal, dispatch = 'voirIndexDemande') =>
  portal.searches
    .filter((form) => form.get('dispatch') === dispatch)
    .map((form) =>
      form.get(
        dispatch === 'voirIndexDemande' ? 'dateIndexDemande' : 'dateIndexDemandeChauffageRfc',
      ),
    );
const DEVICE = 'ext:test-integration:dwelling:main';

test('the first reading publishes the water meters, dated with their reading date', async (t) => {
  const { gladys, portal } = await setup(t);
  assert.deepEqual(gladys.fake.discoveredDevices, [], 'nothing to show before the portal answers');

  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.fr,
    /Répartiteurs : 0, compteurs d’eau : 2\. Dernier relevé : 2026-10-10/,
  );
  assert.match(ack.data.message.de, /Wasserzähler: 2/);
  // The latest date the page allows, over one day.
  assert.deepEqual(searchDays(portal), ['10/10/2026']);
  assert.equal(portal.searches[0].get('dateDebutPeriodeIndex'), '09/10/2026');

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'Logement ista');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => [f.external_id.split(':').at(-1), f.unit, f.name]),
    [
      ['point-900000101', 'cubicmeter', 'Eau froide CUISINE — n° 900000101'],
      ['point-900000202', 'cubicmeter', 'Eau chaude SALLE DE BAINS — n° 900000202'],
    ],
  );
  // One meter per fluid: no total. An estimated index is the portal's index too.
  assert.deepEqual(
    gladys.fake.states.map((s) => [
      s.device_feature_external_id.split(':').at(-1),
      s.state,
      s.created_at,
    ]),
    [
      ['point-900000101', 123.456, stateInstant('2026-10-10')],
      ['point-900000202', 45.678, stateInstant('2026-10-10')],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('later runs search again only when the portal has a newer date', async (t) => {
  const { gladys, portal, sync } = await setup(t);
  await sync.refresh();
  await sync.refresh();
  assert.equal(portal.searches.length, 1, 'same latest date: the page only, no search');
  assert.equal(pageReads(portal).length, 3); // first GET before the sign-in, then one per run

  portal.index.dateMax = '20261012';
  await sync.refresh();
  assert.deepEqual(searchDays(portal), ['10/10/2026', '12/10/2026']);
  assert.equal(portal.searches[1].get('dateDebutPeriodeIndex'), '11/10/2026');
  assert.equal(sync.state.lastDay[KINDS.COLD_WATER], '2026-10-12');
  assert.equal(gladys.fake.states.length, 4);
  assert.equal(gladys.fake.states.at(-1).created_at, stateInstant('2026-10-12'));
});

test('a meter without a readable index publishes nothing, never a 0', async (t) => {
  const portal = createFakePortal({
    answer: (dispatch, form) =>
      meterBlocks(
        'index-water-meters.html',
        form.get('dateDebutPeriodeIndex'),
        form.get('dateIndexDemande'),
      )
        .replace(/(Index relevé<\/div>\s*<div class="value">)\s*45\.678/, '$1 ')
        .replace(/(id="indexCompteur_1"[^>]*>)\s*45\.678/, '$1 '),
  });
  const { gladys, sync } = await setup(t, { portal });
  await gladys.fake.action('test_connection', {});
  assert.deepEqual(
    gladys.fake.states.map((s) => s.device_feature_external_id.split(':').at(-1)),
    ['point-900000101'],
  );
  // Nor a hot water index in the widget.
  assert.deepEqual(sync.state.daily, [{ day: '2026-10-10', cold_water: 123.456 }]);
  assert.deepEqual(
    gladys.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').at(-1)),
    ['point-900000101'],
  );
});

test('several meters of a fluid get a total, left out when one is missing', async (t) => {
  const twoCold = (from, day) =>
    meterBlocks('index-water-meters.html', from, day)
      .replace('EAU CHAUDE', 'EAU FROIDE')
      .replace('ESTIME', 'REEL');
  let blocks = twoCold;
  const portal = createFakePortal({
    answer: (dispatch, form) =>
      blocks(form.get('dateDebutPeriodeIndex'), form.get('dateIndexDemande')),
  });
  const { gladys, sync } = await setup(t, { portal });
  await sync.refresh();
  assert.equal(gladys.fake.lastState(`${DEVICE}:cold-water-total`), 169.134);

  // Next date, one meter missing from the answer: its own index only.
  blocks = (from, day) =>
    twoCold(from, day).replace(
      /<div class="le-compteur">[\s\S]*?(?=<div class="le-compteur">)/,
      '',
    );
  portal.index.dateMax = '20261011';
  await sync.refresh();
  const lastDay = gladys.fake.states.filter((s) => s.created_at === stateInstant('2026-10-11'));
  assert.deepEqual(
    lastDay.map((s) => s.device_feature_external_id.split(':').at(-1)),
    ['point-900000202'],
  );
});

test('a dwelling the index page offers no water for: nothing asked, nothing invented', async (t) => {
  const portal = createFakePortal({ index: { water: false } });
  const { gladys, sync } = await setup(t, { portal });
  const result = await sync.refresh();
  assert.equal(result.ok, true);
  assert.equal(portal.searches.length, 0);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(gladys.fake.states.length, 0);
});

test('heating, when the page offers it, adds the radiators and the units of the day (hypothetical page)', async (t) => {
  const portal = createFakePortal({
    index: { heating: true, heatingIndex: true, heatingMax: '2026/10/10' },
  });
  const { gladys, sync } = await setup(t, { portal });
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Heat cost allocators: 2, water meters: 2/);
  assert.deepEqual(searchDays(portal, 'voirIndexDemandeChauffageRfc'), ['10/10/2026']);
  const [device] = gladys.fake.discoveredDevices;
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    ['heating-daily', 'point-800000301', 'point-800000302', 'point-900000101', 'point-900000202'],
  );
  assert.equal(gladys.fake.lastState(`${DEVICE}:heating-daily`), 16.5);
  // The heating search starts from the page the water search answered (the
  // portal renews the CSRF token on every page; the fake one only accepts the
  // latest).
  assert.deepEqual(
    portal.searches.map((form) => form.get('_csrf')),
    ['csrf-1', 'csrf-2'],
  );
  assert.equal(gladys.fake.lastState(`${DEVICE}:point-800000301`), 1520);
  assert.equal(sync.state.lastDay[KINDS.HEATING], '2026-10-10');
});

test('heating follows its own range of dates', async (t) => {
  const portal = createFakePortal({
    index: { heating: true, heatingIndex: true, heatingMax: '2026/10/08' },
  });
  const { sync } = await setup(t, { portal });
  await sync.refresh();
  await sync.refresh();
  // Water at 10/10, heating at 08/10, then nothing newer for either.
  assert.deepEqual(searchDays(portal, 'voirIndexDemandeChauffageRfc'), ['08/10/2026']);
  assert.equal(portal.searches.length, 2);
  portal.index.heatingMax = '2026/10/09';
  await sync.refresh();
  assert.deepEqual(searchDays(portal, 'voirIndexDemandeChauffageRfc'), [
    '08/10/2026',
    '09/10/2026',
  ]);
  assert.equal(searchDays(portal).length, 1);
});

test('a heating search that fails does not stop the water readings', async (t) => {
  const portal = createFakePortal({
    index: { heating: true, heatingIndex: true, heatingMax: '2026/10/10' },
    answer: (dispatch, form) =>
      dispatch === 'voirIndexDemandeChauffageRfc'
        ? new Response('<html>Erreur</html>', { status: 500 })
        : meterBlocks(
            'index-water-meters.html',
            form.get('dateDebutPeriodeIndex'),
            form.get('dateIndexDemande'),
          ),
  });
  const { gladys, sync } = await setup(t, { portal });
  const result = await sync.refresh();
  assert.equal(result.ok, true);
  assert.equal(gladys.fake.states.length, 2);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('heating alone: a failing heating search is reported', async (t) => {
  const portal = createFakePortal({
    index: { water: false, heating: true, heatingIndex: true, heatingMax: '2026/10/10' },
    answer: () => new Response('<html>Erreur</html>', { status: 500 }),
  });
  const { gladys, sync } = await setup(t, { portal });
  assert.equal((await sync.refresh()).ok, false);
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('the init page fixture keeps the structure of the live page', () => {
  // Guard against an edit of the fixture that would break the client's view.
  const page = fixture('index-page.html');
  assert.match(page, /name="ficheIndexDemandeOccupantForm"/);
  assert.match(page, /name="dateMaxIndex"/);
  assert.match(page, /id="choixDateDebutPeriodeIndex"/);
});

test('a device created after the readings receives them again', async (t) => {
  const { gladys, sync } = await setup(t);
  await sync.refresh();
  const published = gladys.fake.states.length;
  const [device] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(device);
  assert.equal(gladys.fake.states.length, published * 2);
  // Another integration's device is none of our business.
  await gladys.fake.deviceCreated({ ...device, external_id: 'ext:test-integration:other' });
  assert.equal(gladys.fake.states.length, published * 2);
});

test('a restart shows the device again without asking the portal', async (t) => {
  const { gladys, portal, store } = await setup(t);
  await gladys.fake.action('test_connection', {});
  const count = portal.requests.length;
  const state = store.loadState();
  assert.equal(state.points.length, 2);
  assert.equal(state.lastDay[KINDS.COLD_WATER], '2026-10-10');
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(portal.requests.length, count);
  assert.equal(gladys.fake.discoveredDevices[0].features.length, 2);
});

test('a refused password is shown in the Configuration screen, in every language', async (t) => {
  const { gladys } = await setup(t, { config: { ...ACCOUNT, password: 'wrong' } });
  const ack = await gladys.fake.action('test_connection', {});
  // A failure is an error (shown in red), still in every language.
  assert.equal(ack.success, false);
  assert.equal(ack.error.fr, 'Le portail a refusé l’e-mail ou le mot de passe.');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.deepEqual(Object.keys(status.message), ['en', 'fr', 'de', 'es']);
});

test('in password mode, a session the portal does not keep is not called an expired cookie', async (t) => {
  const { gladys } = await setup(t, { portal: createFakePortal({ menuToHome: true }) });
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /sans garder la session/);
  assert.doesNotMatch(ack.error.fr, /cookie/);
});

test('without credentials, nothing is asked to the portal', async (t) => {
  const { gladys, portal } = await setup(t, { config: {} });
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.match(ack.error.en, /Enter your Web’conso e-mail/);
  assert.equal(portal.requests.length, 0);
});

test('an unreachable portal is retried, and reported', async (t) => {
  const portal = createFakePortal();
  const failing = {
    ...portal,
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  };
  const { gladys, sync } = await setup(t, { portal: failing });
  const result = await sync.refresh();
  assert.equal(result.ok, false);
  assert.equal(result.authError, undefined);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached/);
});

test('the timer waits for the interval after the last attempt', async (t) => {
  const { sync, clock } = await setup(t);
  sync.state.lastAttemptAt = new Date(clock.now.getTime() - 2 * 3600 * 1000).toISOString();
  sync.start();
  assert.equal(sync.nextRunAt.getTime() - clock.now.getTime(), 10 * 3600 * 1000);
  sync.stop();
  assert.equal(sync.nextRunAt, null);
});

test('the session file is readable by its owner only', async (t) => {
  const { sync, dir } = await setup(t);
  await sync.refresh();
  assert.equal(statSync(join(dir, 'session.json')).mode & 0o077, 0);
});

test('day helpers', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(localDay(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('the timer reads the portal, then waits for the interval', async (t) => {
  const { portal, sync, clock } = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  sync.start();
  assert.equal(sync.nextRunAt.getTime() - clock.now.getTime(), 10_000, 'first run soon');
  t.mock.timers.tick(10_000);
  await sync.running;
  assert.equal(portal.searches.length, 1);
  // Rescheduled after the run settles.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sync.nextRunAt.getTime() - clock.now.getTime(), 12 * 3600 * 1000);
  sync.stop();
});

// Gladys never polls the device (`should_poll: false`; and Gladys#3198 is not
// fixed in 5.2.1): the container's own timer must keep the readings coming,
// without any call to onPoll.
test('the integration reads the portal on its own, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gladys, portal, sync, clock } = await setup(t, { autoStart: true });
  const settle = async () => {
    await sync.running;
    await new Promise((resolve) => setImmediate(resolve));
  };

  // Started by the connection, first reading shortly after.
  assert.equal(sync.nextRunAt.getTime() - clock.now.getTime(), 10_000);
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(gladys.fake.discoveredDevices[0].should_poll, false);
  assert.equal(sync.state.lastDay[KINDS.COLD_WATER], '2026-10-10');

  // Twelve hours later, the portal's next date is read, and the one after.
  for (const [now, dateMax, day] of [
    ['2026-10-13T08:00:00', '20261011', '2026-10-11'],
    ['2026-10-13T20:00:00', '20261011', '2026-10-11'],
    ['2026-10-14T08:00:00', '20261012', '2026-10-12'],
  ]) {
    clock.now = new Date(now);
    portal.index.dateMax = dateMax;
    t.mock.timers.tick(12 * 3600 * 1000);
    await settle();
    assert.equal(sync.state.lastDay[KINDS.COLD_WATER], day);
  }
  assert.deepEqual(searchDays(portal), ['10/10/2026', '11/10/2026', '12/10/2026']);
});
