import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildDwellingContent } from '../src/widgets.js';
import { LANGUAGES } from '../src/config.js';
import { createFakePortal, jsonFixture } from './helpers/fakePortal.js';
import { setup } from './helpers/setup.js';

const typesOf = (content) => content.components.map((c) => c.type);

test('before any reading, the widget says what to do', async (t) => {
  const { gladys } = await setup(t);
  for (const language of LANGUAGES) {
    const ack = await gladys.fake.widgetGet('dwelling', { language });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), []);
    assert.deepEqual(typesOf(ack.data.content), ['text', 'status']);
  }
});

test('with readings: tiles, the heating chart and the status, within the budget', async (t) => {
  const portal = createFakePortal({
    answer: (dispatch) =>
      dispatch.includes('Chauffage')
        ? jsonFixture('heating-day.json')
        : dispatch.includes('EauFroide')
          ? jsonFixture('cold-water-day.json')
          : new Response('', { status: 404 }),
  });
  const { gladys, sync } = await setup(t, { portal });
  await sync.refresh();
  assert.ok(gladys.fake.widgetRefreshes.length > 0, 'a reading nudges open dashboards');
  for (const language of LANGUAGES) {
    const { content } = (await gladys.fake.widgetGet('dwelling', { language })).data;
    assert.deepEqual(validateWidgetContent(content), [], language);
    assert.deepEqual(typesOf(content), ['value', 'value', 'chart', 'status']);
    const [heating, water, chart, status] = content.components;
    assert.equal(heating.value, 16.5);
    assert.equal(water.value, 168.956);
    assert.equal(water.unit, 'm³');
    assert.equal(chart.series[0].points.length, 7);
    assert.equal(chart.series[0].points[0].t, '2026-10-05T12:00:00.000Z');
    assert.equal(status.items.length, 2);
  }
});

test('an unknown language falls back to English', () => {
  const content = buildDwellingContent(
    { connected: false, daily: [], points: [], nextRunAt: null },
    'it',
  );
  assert.match(content.components[0].text, /^No reading yet/);
  assert.deepEqual(validateWidgetContent(content), []);
});
