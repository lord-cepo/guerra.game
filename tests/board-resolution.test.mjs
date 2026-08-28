import assert from 'node:assert/strict';
import test from 'node:test';
import { instantResolutionPresentation, resolvedBashAnimations, resolvedBombExplosion, resolvedDamageAnimations, resolvedGoreMovementBetween } from '../dist/client/board-resolution.js';

const unit = (id, troopId, owner, coordinate, health = 4) => ({
  id, troopId, owner, coordinate, permanentDamage: 0, currentHealth: health,
  combat: { health, modifier: 0, magicModifier: 0, modifiers: [], total: health },
});
const match = overrides => ({ id: 'resolution-test', revision: 1, units: [], effects: [], bashes: [], events: [], triggerEvents: [], ...overrides });
const options = overrides => ({
  replayingLastTurn: false, reducedMotion: false, shieldFrameCount: 7,
  baseHealthForTroop: () => 4, passivesForTroop: () => [], confirmedProjectiles: () => [], ...overrides,
});

test('a removed legacy Gore marker projects movement only when its source was still at the origin', () => {
  const gore = { owner: 1, sourceTroopId: 'ram', sourceUnitId: '1:ram', kind: 'gore', target: '0,0', value: 0, origin: '0,2', goreDestination: '0,-1' };
  const originUnit = unit('1:ram', 'ram', 1, '0,2');
  const destinationUnit = unit('1:ram', 'ram', 1, '0,-1');
  assert.deepEqual(resolvedGoreMovementBetween(match({ effects: [gore], units: [originUnit] }), match({ revision: 2, units: [destinationUnit] })),
    { unit: destinationUnit, origin: '0,2', destination: '0,-1' });
  assert.equal(resolvedGoreMovementBetween(match({ effects: [gore], units: [destinationUnit] }), match({ revision: 2, units: [destinationUnit] })), undefined);
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

test('lethal delayed Magic creates the target health and death presentation', () => {
  const target = unit('2:thornback-archer', 'thornback-archer', 2, '1,0', 2);
  const magic = { owner: 1, sourceTroopId: 'ember-salamander', sourceUnitId: '1:ember-salamander', targetUnitId: target.id, kind: 'magic', target: '1,0', value: 2, origin: '0,1' };
  const previous = match({ units: [target], effects: [magic] });
  const next = match({ revision: 2, units: [], events: [{ player: 2, action: { type: 'pass', troopId: '' } }] });
  assert.deepEqual(resolvedDamageAnimations(previous, next, 0, options()), [{
    targetId: target.id, troopId: target.troopId, coordinate: '1,0', owner: 2,
    oldHealth: 2, newHealth: 0, totalHealth: 4, oldModifier: 0,
    physicalDamage: 0, includesPhysical: false, ignoresModifier: false, delay: 0, killed: true, bashSide: undefined,
  }]);
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
