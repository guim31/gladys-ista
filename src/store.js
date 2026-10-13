// -----------------------------------------------------------------------------
// Files under /data, the container's only writable volume.
//
//   - session.json: the portal session cookies, so a restart does not sign in
//     again (written with owner-only permissions; it is a credential).
//   - state.json: the counting points seen so far, the last day read per
//     fluid and the recent readings, so a restart neither re-reads the portal
//     nor loses what a device created later must receive.
// A missing or unreadable file means "start from scratch", never a crash.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.ISTA_DATA_DIR || '/data';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  // Write then rename: a container stopped mid-write leaves the old file.
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

export function createStore(dir = DATA_DIR) {
  const sessionPath = join(dir, 'session.json');
  const statePath = join(dir, 'state.json');
  return {
    session: {
      load: () => {
        const cookies = readJson(sessionPath);
        return Array.isArray(cookies) ? cookies : [];
      },
      save: (cookies) => writeJson(sessionPath, cookies),
    },
    loadState: () => readJson(statePath),
    saveState: (state) => writeJson(statePath, state),
  };
}
