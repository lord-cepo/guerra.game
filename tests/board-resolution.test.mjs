import assert from 'node:assert/strict';
import test from 'node:test';
import { instantResolutionPresentation, resolvedBashAnimations, resolvedBombExplosion, resolvedGoreMovementBetween } from '../dist/client/board-resolution.js';

const unit = (id, troopId, owner, coordinate, health = 4) => ({
  id, troopId, owner, coordinate, permanentDamage: 0, currentHealth: health,
  combat: { health, modifier: 0, magicModifier: 0, modifiers: [], total: health },
});
const match = overrides => ({ id: 'resolution-test', revision: 1, units: [], effects: [], bashes: [], events: [], triggerEvents: [], ...overrides });
const options = overrides => ({
  replayingLastTurn: false, reducedMotion: false, shieldFrameCount: 7,
  baseHealthForTroop: () => 4, passivesForTroop: () => [], confirmedProjectiles: () => [], ...overrides,
});

test('a removed Gore marker projects the authoritative delayed movement', () => {
  const gore = { owner: 1, sourceTroopId: 'ram', sourceUnitId: '1:ram', kind: 'gore', target: '0,0', value: 0, origin: '0,2', goreDestination: '0,-1' };
  const destinationUnit = unit('1:ram', 'ram', 1, '0,-1');
  assert.deepEqual(resolvedGoreMovementBetween(match({ effects: [gore] }), match({ revision: 2, units: [destinationUnit] })),
    { unit: destinationUnit, origin: '0,2', destination: '0,-1' });
});

test('effect differences use multiplicity and bomb origins produce one seven-hex footprint', () => {
  const bomb = { owner: 1, sourceTroopId: 'mole', kind: 'bomb', target: '0,0', origin: '0,0', value: 2 };
  const result = resolvedBombExplosion(match({ effects: [bomb, { ...bomb }] }), match({ revision: 2, effects: [{ ...bomb }] }));
  assert.deepEqual(result.origins, ['0,0']);
  assert.equal(result.affected.length, 7);
  assert.equal(new Set(result.affected).size, 7);
});

test('instant ranged presentation keeps the projectile but suppresses Titanium damage', () => {
  const target = unit('2:yak', 'yak', 2, '0,0');
  const previous = match({ units: [target], pendingResolution: { kind: 'instant-ranged', sourceTroopId: 'archer', origin: '0,2', damage: 3 } });
  const next = match({ revision: 2, units: [target], events: [{
    player: 1, action: { type: 'resolve-instant-ranged', troopId: 'archer', coordinate: '0,0', targetUnitId: target.id },
  }] });
  const result = instantResolutionPresentation(previous, next, options({ passivesForTroop: () => ['titanium'] }));
  assert.equal(result.projectiles.length, 1);
  assert.deepEqual(result.damage, []);
});

test('a removed bash animates only when a new matching bashResolved event exists', () => {
  const attacker = unit('1:ram', 'ram', 1, '0,0');
  const defender = unit('2:yak', 'yak', 2, '0,0');
  const bash = { attackerId: attacker.id, defenderId: defender.id, target: '0,0' };
  const previous = match({ units: [attacker, defender], bashes: [bash] });
  assert.deepEqual(resolvedBashAnimations(previous, match({ revision: 2, units: [attacker, defender] }), options()), []);
  const resolved = match({ revision: 2, units: [attacker], triggerEvents: [{
    trigger: 'bashResolved', player: 1, hex: '0,0', troopIds: ['ram', 'yak'], attackerId: attacker.id, defenderId: defender.id,
  }] });
  const [animation] = resolvedBashAnimations(previous, resolved, options());
  assert.equal(animation.winnerId, attacker.id);
  assert.deepEqual(animation.bash, bash);
});
