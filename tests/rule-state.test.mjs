import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRule } from '../dist/game/rule-parser.js';
import { cleanupStoredContributions, createStoredContributions, effectiveUnitState } from '../dist/game/rule-state.js';
import { combatSummary, effectiveMaximumHealth } from '../dist/game/engine.js';
import { createEngineCards } from './helpers/engine-fixture.mjs';

const { cards } = createEngineCards();

function fixture() {
  const state = {
    activePlayer: 1, turnNumber: 2,
    units: [{ id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 1 }],
    effects: [], bashes: [], bombs: []
  };
  return {
    state,
    context: { state, cards, controller: 1, self: { kind: 'unit', unitId: '1:tiger-queen' }, subj: { kind: 'unit', unitId: '1:tiger-queen' } }
  };
}

test('stored state materializes a phrase binding into a concrete unit ID', () => {
  const { state, context } = fixture();
  const rule = parseRule('self deploy : subj up-mod(1,2) removed-after subj bow-resolved _');
  const consequence = rule.consequences[0];
  const created = createStoredContributions(state, 'test-rule', '1:tiger-queen', consequence.state, consequence.lifetime, 7, context);
  assert.equal(created.ok, true);
  assert.equal(created.value[0].targetUnitId, '1:tiger-queen');
  assert.equal('subj' in created.value[0], false);
  state.units[0].coordinate = '0,1';
  const effective = effectiveUnitState(state, state.units[0], cards);
  assert.equal(effective.physicalModifier, 1);
  assert.equal(effective.magicModifier, 2);
});

test('until cleans before an event and removed-after cleans only after success', () => {
  const { state, context } = fixture();
  for (const source of [
    'self deploy : self up-mod(1,0) until self bow _',
    'self deploy : self up-mod(2,0) removed-after self bow-resolved _'
  ]) {
    const consequence = parseRule(source).consequences[0];
    createStoredContributions(state, source, '1:tiger-queen', consequence.state, consequence.lifetime, 1, context);
  }
  const target = { id: 2, name: 'bow', stage: 'target', subject: { kind: 'unit', unitId: '1:tiger-queen' }, object: { kind: 'hex', coordinate: '0,1' }, parameters: [1, 3], qualifiers: [], controller: 1, turn: 2, success: true };
  assert.equal(cleanupStoredContributions(state, target, 'before', context).length, 1);
  assert.equal(state.ruleContributions.length, 1);
  const canceledResolved = { ...target, id: 3, stage: 'resolved', success: false, canceled: true };
  assert.equal(cleanupStoredContributions(state, canceledResolved, 'after', context).length, 0);
  assert.equal(state.ruleContributions.length, 1);
  assert.equal(cleanupStoredContributions(state, { ...canceledResolved, id: 4, success: true, canceled: false }, 'after', context).length, 1);
  assert.equal(state.ruleContributions.length, 0);
});

test('up-life applies starting-life delta before clamping actual life', () => {
  const { state, context } = fixture();
  const consequence = parseRule('self deploy : self up-life(10,-2) permanent').consequences[0];
  createStoredContributions(state, 'life', '1:tiger-queen', consequence.state, consequence.lifetime, 1, context);
  const effective = effectiveUnitState(state, state.units[0], cards);
  assert.equal(effective.startingLife, 3);
  assert.equal(effective.actualLife, 3);
  assert.equal(effectiveMaximumHealth(state, state.units[0], cards), 3);
  assert.equal(combatSummary(state, '1:tiger-queen', cards).health, 3);
});
