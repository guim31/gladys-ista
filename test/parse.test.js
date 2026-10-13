import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS,
  UnexpectedAnswerError,
  classifyPoint,
  describeShape,
  parseConsumptionAnswer,
  toNumber,
} from '../src/ista/parse.js';
import { jsonFixture } from './helpers/fakePortal.js';

test('a heating answer gives one point per heat cost allocator', () => {
  const points = parseConsumptionAnswer(jsonFixture('heating-day.json'), KINDS.HEATING);
  assert.deepEqual(points, [
    {
      id: '100001',
      serial: '90000001',
      room: 'SEJOUR',
      kind: KINDS.HEATING,
      index: 1520,
      consumption: 12,
    },
    {
      id: '100002',
      serial: '90000002',
      room: 'CHAMBRE 1',
      kind: KINDS.HEATING,
      index: 640,
      consumption: 3,
    },
    // Numbers sent as strings with a decimal comma are read too.
    {
      id: '100003',
      serial: '90000003',
      room: 'SALLE DE BAINS',
      kind: KINDS.HEATING,
      index: 212,
      consumption: 1.5,
    },
  ]);
});

test('a day the portal has not filled in yet gives null readings, not zeros', () => {
  const points = parseConsumptionAnswer(jsonFixture('heating-day-pending.json'), KINDS.HEATING);
  assert.equal(points.length, 3);
  for (const point of points) {
    assert.equal(point.index, null);
    assert.equal(point.consumption, null);
  }
});

test('water meters are recognized from their labels', () => {
  const points = parseConsumptionAnswer(jsonFixture('cold-water-day.json'), KINDS.HOT_WATER);
  assert.deepEqual(
    points.map(({ kind, index }) => ({ kind, index })),
    [
      { kind: KINDS.COLD_WATER, index: 123.456 },
      { kind: KINDS.COLD_WATER, index: 45.5 },
    ],
  );
  assert.equal(classifyPoint({ libelleTypeCompteur: 'Compteur Eau Chaude' }), KINDS.HOT_WATER);
  assert.equal(classifyPoint({ libelleFluide: 'ECS' }), KINDS.HOT_WATER);
  assert.equal(classifyPoint({ libelleTypeRepartiteur: 'Répartiteur' }), KINDS.HEATING);
  assert.equal(classifyPoint({}, KINDS.COLD_WATER), KINDS.COLD_WATER);
});

test('an unexpected answer is an error carrying its structure, never its values', () => {
  const answer = { erreur: { message: 'Session expirée', utilisateur: 'resident@example.org' } };
  assert.throws(
    () => parseConsumptionAnswer(answer, KINDS.HEATING),
    (err) => {
      assert.ok(err instanceof UnexpectedAnswerError);
      assert.deepEqual(err.shape, { erreur: { message: 'string', utilisateur: 'string' } });
      assert.ok(!JSON.stringify(err.shape).includes('example.org'));
      return true;
    },
  );
  assert.throws(
    () => parseConsumptionAnswer({ response: [{ pointsComptage: [{ metadata: {} }] }] }, 'x'),
    UnexpectedAnswerError,
  );
});

test('describeShape and toNumber', () => {
  assert.deepEqual(describeShape({ a: [1, 2], b: null, c: { d: 'x' } }), {
    a: ['number'],
    b: 'null',
    c: { d: 'string' },
  });
  assert.equal(toNumber('1 234,5'), 1234.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toNumber(Number.NaN), null);
  assert.equal(toNumber(null), null);
});
