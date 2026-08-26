import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Persistence } from '../server/persistence.mjs';

function fixture(dataDirectory) {
  const state = { matches: [] };
  const restored = [];
  const persistence = new Persistence(dataDirectory, {
    snapshot: () => state.matches,
    restore: matches => restored.push(matches),
  }, new Map(), new Map());
  return { persistence, state, restored };
}

test('runtime saves are serialized and leave the latest complete snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guerra-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { persistence, state } = fixture(directory);

  const writes = [];
  for (let revision = 1; revision <= 20; revision += 1) {
    state.matches = [[`match-${revision}`, { revision, history: 'x'.repeat(100_000) }]];
    writes.push(persistence.saveRuntime());
  }
  await Promise.all(writes);

  const current = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
  const backup = JSON.parse(await readFile(join(directory, 'runtime.backup.json'), 'utf8'));
  assert.equal(current.matches[0][1].revision, 20);
  assert.equal(backup.matches[0][1].revision, 19);
});

test('runtime loading falls back to the last valid backup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guerra-runtime-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'runtime.json'), '{"matches":[broken', 'utf8');
  await writeFile(join(directory, 'runtime.backup.json'), JSON.stringify({
    matches: [['recovered', { revision: 7 }]],
    waitingPlayers: [[10, 'Blue']],
    queuedMatches: [['Blue', 'recovered']],
  }), 'utf8');
  const { persistence, restored } = fixture(directory);

  await persistence.loadRuntime();

  assert.deepEqual(restored, [[['recovered', { revision: 7 }]]]);
});

test('runtime saves from separate persistence instances never publish partial JSON', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guerra-runtime-concurrent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = fixture(directory);
  const second = fixture(directory);
  const writes = [];
  for (let revision = 1; revision <= 12; revision += 1) {
    first.state.matches = [[`first-${revision}`, { revision, history: 'a'.repeat(50_000) }]];
    second.state.matches = [[`second-${revision}`, { revision, history: 'b'.repeat(50_000) }]];
    writes.push(first.persistence.saveRuntime(), second.persistence.saveRuntime());
  }
  await Promise.all(writes);

  JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
  JSON.parse(await readFile(join(directory, 'runtime.backup.json'), 'utf8'));
});
