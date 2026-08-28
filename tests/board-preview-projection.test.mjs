import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingBash, pendingMovementPreview, pendingUnitPreviews } from '../dist/client/board-preview-projection.js';

const attacker = {
  id: '1:ram', troopId: 'ram', owner: 1, coordinate: '0,2', permanentDamage: 0,
  currentHealth: 3, combat: { health: 3, modifier: 0, magicModifier: 0, modifiers: [], total: 3 },
};
const defender = {
  id: '2:yak', troopId: 'yak', owner: 2, coordinate: '0,-1', permanentDamage: 0,
  currentHealth: 4, combat: { health: 4, modifier: 0, magicModifier: 0, modifiers: [], total: 4 },
};
const match = { units: [attacker, defender] };
const gore = { type: 'gore', troopId: 'ram', coordinate: '0,-1' };

test('staged Gore previews the attacker at its destination and projects a destination bash', () => {
  assert.deepEqual(pendingMovementPreview(match, gore, 1), { unit: attacker, coordinate: '0,-1' });
  assert.deepEqual(pendingUnitPreviews(match, gore, 1, () => undefined), [{ ...attacker, coordinate: '0,-1' }]);
  assert.deepEqual(pendingBash(match, gore, 1), { attackerId: attacker.id, defenderId: defender.id, target: '0,-1' });
});

test('triggered Move and Pull use the ordinary animated movement projections', () => {
  const triggeredMove = { type: 'resolve-move', troopId: 'ram', coordinate: '0,1' };
  assert.deepEqual(pendingMovementPreview(match, triggeredMove, 1), { unit: attacker, coordinate: '0,1' });
  assert.deepEqual(pendingUnitPreviews(match, triggeredMove, 1, () => undefined), [{ ...attacker, coordinate: '0,1' }]);

  const triggeredPull = { type: 'resolve-pull', troopId: 'yak', coordinate: '0,2', destination: '0,0', targetUnitId: attacker.id };
  assert.deepEqual(pendingMovementPreview(match, triggeredPull, 2), { unit: attacker, coordinate: '0,0' });
  assert.deepEqual(pendingUnitPreviews(match, triggeredPull, 2, () => undefined), [{ ...attacker, coordinate: '0,0' }]);
});
