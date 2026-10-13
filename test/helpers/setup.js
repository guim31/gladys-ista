import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { createStore } from '../../src/store.js';
import { ACCOUNT, createFakePortal } from './fakePortal.js';

/**
 * A fake Gladys with the integration registered, a fake portal, a temporary
 * /data and a settable clock. The timer is not started: the tests drive the
 * readings through the action or `sync.refresh()`.
 */
export async function setup(t, { config = ACCOUNT, portal = createFakePortal(), now } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-ista-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { now: now ?? new Date('2026-10-12T10:00:00') };
  const gladys = createFakeGladys({ config });
  const store = createStore(dir);
  const sync = registerHandlers(gladys, {
    store,
    fetch: portal.fetch,
    now: () => clock.now,
    requestGapMs: 0,
    autoStart: false,
  });
  t.after(() => sync.stop());
  await gladys.connect();
  return { gladys, portal, sync, store, clock, dir };
}
