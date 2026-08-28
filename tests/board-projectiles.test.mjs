import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmedServerProjectiles, stagedServerProjectile } from '../dist/client/board-projectiles.js';

const unit = (id, troopId, owner, coordinate) => ({ id, troopId, owner, coordinate });
const match = overrides => ({ id: 'projectile-test', revision: 4, units: [], effects: [], events: [], ...overrides });

test('pending Gore effects collapse into one origin-to-destination projectile', () => {
  const source = unit('1:ram', 'ram', 1, '1,2');
  const state = match({
    units: [source],
    effects: [
      { owner: 1, sourceTroopId: 'ram', sourceUnitId: source.id, kind: 'gore', target: '1,1', value: 0, origin: '1,2', goreDestination: '1,-1' },
      { owner: 1, sourceTroopId: 'ram', sourceUnitId: source.id, targetUnitId: '2:yak', kind: 'gore', target: '1,0', value: 2, origin: '1,2', goreDestination: '1,-1' },
    ],
  });
  const projectiles = confirmedServerProjectiles(state, { replayingLastTurn: false, localPlayer: 1, damageForSource: () => undefined });
  assert.deepEqual(projectiles, [{ key: '1:1:ram:gore:1,-1', kind: 'gore', source: '1,2', target: '1,-1', damage: 1 }]);
});

test('a pending Magic effect retains its recorded trajectory after its caster leaves play', () => {
  const state = match({ units: [], effects: [{
    owner: 1, sourceTroopId: 'ember-salamander', sourceUnitId: '1:ember-salamander', targetUnitId: '2:thornback-archer',
    kind: 'magic', target: '1,0', value: 2, origin: '0,1',
  }] });
  assert.deepEqual(confirmedServerProjectiles(state, { replayingLastTurn: false, localPlayer: 2, damageForSource: () => undefined }), [{
    key: '1:1:ember-salamander:magic:1,0', kind: 'magic', source: '0,1', target: '1,0', damage: 2,
  }]);
});

test('a Cannon line produces one projectile to its farthest effect', () => {
  const source = unit('1:crab', 'crab', 1, '1,2');
  const state = match({ units: [source], effects: [
    { owner: 1, sourceTroopId: 'crab', sourceUnitId: source.id, kind: 'cannon', target: '1,1', value: 2 },
    { owner: 1, sourceTroopId: 'crab', sourceUnitId: source.id, kind: 'cannon', target: '1,-1', value: 2 },
  ] });
  const [projectile] = confirmedServerProjectiles(state, { replayingLastTurn: false, damageForSource: () => undefined });
  assert.equal(projectile.target, '1,-1');
  assert.equal(projectile.kind, 'cannon');
});

test('staged ranged projection uses the selected source and computed damage', () => {
  const source = unit('2:archer', 'archer', 2, '-1,-2');
  const projectile = stagedServerProjectile(
    match({ units: [source] }),
    { type: 'attack', troopId: 'archer', coordinate: '-1,0' },
    2,
    () => 3,
  );
  assert.deepEqual(projectile, {
    key: '2:2:archer:attack:-1,0', kind: 'attack', source: '-1,-2', target: '-1,0', damage: 3, headMode: 'repeat',
  });
});

test('triggered instant projectiles preview from their authoritative pending origin and damage', () => {
  const projectile = stagedServerProjectile(
    match({
      pendingResolution: { owner: 1, turnPlayer: 1, sourceTroopId: 'last-bell', kind: 'instant-ranged', origin: '1,2', damage: 3, range: 3, remaining: 1 },
    }),
    { type: 'resolve-instant-ranged', troopId: 'last-bell', coordinate: '0,0' },
    1,
    () => undefined,
  );
  assert.deepEqual(projectile, {
    key: '1:last-bell:attack:0,0', kind: 'attack', source: '1,2', target: '0,0', damage: 3, headMode: 'repeat',
  });
});
