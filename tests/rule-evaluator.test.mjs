import assert from 'node:assert/strict';
import test from 'node:test';
import { parseObservableCondition, parseRule, parseRuleCondition, parseRuleState } from '../dist/game/rule-parser.js';
import { evaluateHistoricalCondition, evaluateObservableCondition, evaluateRuleState, matchRuleAnchor, selectRuleHexes } from '../dist/game/rule-evaluator.js';
import { createEngineCards } from './helpers/engine-fixture.mjs';

const { cards } = createEngineCards();

function context(overrides = {}) {
  return {
    state: {
      activePlayer: 1,
      units: [
        { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 1 },
        { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '0,1', permanentDamage: 0 }
      ],
      effects: [], bashes: [], bombs: [], turnNumber: 4
    },
    cards, controller: 1,
    self: { kind: 'unit', unitId: '1:tiger-queen' },
    subj: { kind: 'unit', unitId: '2:squirrel-king' },
    obj: { kind: 'hex', coordinate: '0,1' },
    currentTurn: 4,
    ...overrides
  };
}

test('normalized field queries and directions evaluate without mutating state', () => {
  const before = context();
  const snapshot = structuredClone(before.state);
  const enemies = selectRuleHexes(parseRuleCondition('o:opp bow self').subject, before);
  assert.deepEqual(enemies, { ok: true, value: ['0,1'] });
  const adjacent = selectRuleHexes(parseRuleCondition('self bow adj self').object, before);
  assert.equal(adjacent.ok, true);
  assert.equal(adjacent.value.every(hex => hex !== '1,2'), true);
  assert.deepEqual(before.state, snapshot);
});

test('snapshot quantifiers are existential, non-vacuous all, and not-any none', () => {
  assert.deepEqual(evaluateRuleState(parseRuleState('self wounded'), context()), { ok: true, value: true });
  assert.deepEqual(evaluateRuleState(parseRuleState('all o:opp active'), context()), { ok: true, value: true });
  assert.deepEqual(evaluateRuleState(parseRuleState('none o:opp wounded'), context()), { ok: true, value: true });
  assert.deepEqual(evaluateRuleState(parseRuleState('all t:temple active'), context()), { ok: true, value: false });
});

test('Boolean observable conditions evaluate with explicit grouping and negation', () => {
  const condition = parseObservableCondition('self wounded & (!self shielded | self mshielded)');
  assert.deepEqual(evaluateRuleState(parseRuleState('self wounded'), context()), { ok: true, value: true });
  // Exercise the public recursive evaluator through a continuous-rule condition.
  const rule = parseRule(`self up-mod(1,0) while self wounded & (!self shielded | self mshielded)`);
  assert.equal(rule.condition.kind, 'boolean');
  assert.equal(condition.operator, 'and');
  assert.deepEqual(evaluateObservableCondition(condition, context()), { ok: true, value: true });
});

test('history matches explicit target and resolved stages at chosen turn boundaries', () => {
  const history = [{
    id: 1, name: 'bow', stage: 'resolved',
    subject: { kind: 'unit', unitId: '2:squirrel-king' },
    object: { kind: 'hex', coordinate: '1,2' },
    parameters: [2, 3], qualifiers: [], controller: 2, turn: 4, success: true
  }];
  const resolved = parseObservableCondition('subj bow-resolved self during-this-turn');
  assert.deepEqual(evaluateHistoricalCondition(resolved, context({ history })), { ok: true, value: true });
  const target = parseObservableCondition('subj bow self during-this-turn');
  assert.deepEqual(evaluateHistoricalCondition(target, context({ history })), { ok: true, value: false });
  assert.deepEqual(matchRuleAnchor(parseRuleCondition('subj bow-resolved self'), history[0], context({ history })), { ok: true, value: true });
});
