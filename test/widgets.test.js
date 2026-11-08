import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildDwellingContent } from '../src/widgets.js';
import { LANGUAGES } from '../src/config.js';
import { createFakePortal } from './helpers/fakePortal.js';
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
    index: { heating: true, heatingIndex: true, heatingMax: '2026/10/10' },
  });
  const { gladys, sync } = await setup(t, { portal });
  await sync.refresh();
  assert.ok(gladys.fake.widgetRefreshes.length > 0, 'a reading nudges open dashboards');
  for (const language of LANGUAGES) {
    const { content } = (await gladys.fake.widgetGet('dwelling', { language })).data;
    assert.deepEqual(validateWidgetContent(content), [], language);
    assert.deepEqual(typesOf(content), ['value', 'value', 'value', 'chart', 'status']);
    const [heating, cold, hot, chart, status] = content.components;
    assert.equal(heating.value, 16.5);
    assert.equal(cold.value, 123.456);
    assert.equal(cold.unit, 'm³');
    assert.equal(hot.value, 45.678);
    assert.equal(chart.series[0].points.length, 1);
    assert.equal(chart.series[0].points[0].t, '2026-10-10T12:00:00.000Z');
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
