import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, localDay, stateInstant, BACKFILL_DAYS, WATER_STATUS } from '../src/sync.js';
import { KINDS } from '../src/ista/parse.js';
import { ACCOUNT, createFakePortal, jsonFixture } from './helpers/fakePortal.js';
import { setup } from './helpers/setup.js';

const HEATING = 'calculeConsommationChauffageRfcPourLogement';
const COLD_WATER = 'calculeConsommationEauFroidePourLogement';
const reads = (portal) => portal.requests.filter((r) => r.url.includes('ficheLogement.do'));
const readDays = (portal, dispatch) =>
  reads(portal)
    .filter((r) => r.url.includes(`dispatch=${dispatch}`) && r.cookie.includes('JSESSIONID'))
    .map((r) => new URL(r.url).searchParams.get('start'));

test('the first reading backfills the last days and publishes the dwelling', async (t) => {
  const { gladys, portal } = await setup(t);
  assert.deepEqual(gladys.fake.discoveredDevices, [], 'nothing to show before the portal answers');

  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.fr,
    /Répartiteurs : 3, compteurs d’eau : 0\. Dernier relevé : 2026-10-11/,
  );
  assert.match(ack.data.message.de, /Heizkostenverteiler: 3/);

  assert.deepEqual(readDays(portal, HEATING), [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
  ]);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, 'ext:test-integration:dwelling:main');
  assert.equal(device.name, 'Logement ista');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => [f.external_id.split(':').at(-1), f.name]),
    [
      ['heating-daily', 'Unités de chauffage du jour'],
      ['point-100001', 'Radiateur SEJOUR — n° 90000001'],
      ['point-100002', 'Radiateur CHAMBRE 1 — n° 90000002'],
      ['point-100003', 'Radiateur SALLE DE BAINS — n° 90000003'],
    ],
  );

  // Each day dated with its own day, so the charts put it in the right place.
  const states = gladys.fake.states;
  assert.equal(states.length, BACKFILL_DAYS * 4);
  const daily = states.filter((s) => s.device_feature_external_id.endsWith(':heating-daily'));
  assert.deepEqual(
    daily.map((s) => s.created_at),
    ['05', '06', '07', '08', '09', '10', '11'].map((d) => stateInstant(`2026-10-${d}`)),
  );
  assert.equal(daily[0].state, 16.5); // 12 + 3 + 1.5 weighted units
  assert.equal(gladys.fake.lastState(`${device.external_id}:point-100001`), 1520);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('later readings only ask for the days not read yet', async (t) => {
  const { gladys, portal, sync, clock } = await setup(t);
  await sync.refresh();
  const before = reads(portal).length;

  await sync.refresh();
  assert.equal(reads(portal).length, before, 'same day: nothing new to ask');

  clock.now = new Date('2026-10-13T10:00:00');
  await sync.refresh();
  assert.deepEqual(readDays(portal, HEATING).slice(BACKFILL_DAYS), ['2026-10-12']);
  assert.equal(gladys.fake.states.length, (BACKFILL_DAYS + 1) * 4);
});

test('a day the portal has not filled in is asked again at the next run', async (t) => {
  let pendingFrom = '2026-10-10';
  const portal = createFakePortal({
    answer: (dispatch, day) => {
      if (dispatch !== HEATING) {
        return new Response('', { status: 404 });
      }
      return day >= pendingFrom
        ? jsonFixture('heating-day-pending.json')
        : jsonFixture('heating-day.json');
    },
  });
  const { gladys, sync } = await setup(t, { portal });
  await sync.refresh();
  assert.equal(sync.state.lastDay[KINDS.HEATING], '2026-10-09');
  // Stopped at the first missing day: 10-11 was not asked.
  assert.deepEqual(readDays(portal, HEATING).slice(-1), ['2026-10-10']);
  assert.equal(gladys.fake.states.length, 5 * 4);

  pendingFrom = '2026-10-12';
  await sync.refresh();
  assert.deepEqual(readDays(portal, HEATING).slice(-2), ['2026-10-10', '2026-10-11']);
  assert.equal(sync.state.lastDay[KINDS.HEATING], '2026-10-11');
});

test('water pages the portal does not know hide the water features, and are not asked again', async (t) => {
  const { portal, sync } = await setup(t);
  await sync.refresh();
  assert.equal(sync.state.water[KINDS.COLD_WATER], WATER_STATUS.UNAVAILABLE);
  assert.equal(sync.state.water[KINDS.HOT_WATER], WATER_STATUS.UNAVAILABLE);
  assert.equal(readDays(portal, COLD_WATER).length, 1, 'one probe, not one per day');
  const count = reads(portal).length;
  await sync.refreshIfDue();
  await sync.refresh();
  assert.equal(reads(portal).length, count);
});

test('water meters, when the portal answers, become volume features with a total', async (t) => {
  const portal = createFakePortal({
    answer: (dispatch) =>
      dispatch === HEATING
        ? jsonFixture('heating-day.json')
        : dispatch === COLD_WATER
          ? jsonFixture('cold-water-day.json')
          : new Response('', { status: 404 }),
  });
  const { gladys, sync } = await setup(t, { portal });
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /water meters: 2/);
  assert.equal(sync.state.water[KINDS.COLD_WATER], WATER_STATUS.AVAILABLE);
  const [device] = gladys.fake.discoveredDevices;
  const water = device.features.filter((f) => f.category === 'volume-sensor');
  assert.deepEqual(
    water.map((f) => [f.external_id.split(':').at(-1), f.unit, f.name]),
    [
      ['cold-water-total', 'cubicmeter', 'Eau froide — total'],
      ['point-200001', 'cubicmeter', 'Eau froide CUISINE — n° EF-0000001'],
      ['point-200002', 'cubicmeter', 'Eau froide SALLE DE BAINS — n° EF-0000002'],
    ],
  );
  assert.equal(gladys.fake.lastState(`${device.external_id}:cold-water-total`), 168.956);
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
  assert.equal(state.points.length, 3);
  assert.equal(state.lastDay[KINDS.HEATING], '2026-10-11');
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(portal.requests.length, count);
  assert.equal(gladys.fake.discoveredDevices[0].features.length, 4);
});

test('a refused password is shown in the Configuration screen, in every language', async (t) => {
  const { gladys } = await setup(t, { config: { ...ACCOUNT, password: 'wrong' } });
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.data.message.fr, 'Le portail a refusé l’e-mail ou le mot de passe.');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.deepEqual(Object.keys(status.message), ['en', 'fr', 'de', 'es']);
});

test('without credentials, nothing is asked to the portal', async (t) => {
  const { gladys, portal } = await setup(t, { config: {} });
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Enter your Web’conso e-mail/);
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
  assert.ok(reads(portal).length > 0);
  // Rescheduled after the run settles.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sync.nextRunAt.getTime() - clock.now.getTime(), 12 * 3600 * 1000);
  sync.stop();
});
