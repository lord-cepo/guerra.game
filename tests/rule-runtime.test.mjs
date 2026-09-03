import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRule } from '../dist/game/rule-parser.js';
import { executeNormalizedIntent } from '../dist/game/rule-runtime.js';
import { createEngineCards } from './helpers/engine-fixture.mjs';

const { cards } = createEngineCards();

function scenario(fast = false) {
  const state = {
    activePlayer: 2, turnNumber: 3, rulesVersion: 2,
    units: [
      { id: '1:queen-bee', troopId: 'queen-bee', owner: 1, coordinate: '2,2', permanentDamage: 0 },
      { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '2,1', permanentDamage: 0 },
      { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,1', permanentDamage: 0 }
    ],
    effects: [], bashes: [], bombs: [], normalizedEvents: [], ruleContributions: []
  };
  const rule = parseRule(`o:opp move-from c:you : self ${fast ? 'F.' : ''}fire(2,_) subj`);
  const rules = [{ id: 'fixed-fire', sourceUnitId: '1:queen-bee', rule }];
  const pending = [];
  const hits = [];
  const hooks = { mode: intent => intent.name === 'fire' && !intent.qualifiers.includes('fast') ? 'deferred' : 'immediate', apply(intent) {
    if (intent.name === 'fire') {
      if (intent.qualifiers.includes('fast')) hits.push(state.units.find(unit => unit.coordinate === intent.target)?.id);
      else pending.push(intent.target);
      return { success: true };
    }
    if (intent.name === 'move') {
      state.units.find(unit => unit.id === intent.subject.unitId).coordinate = intent.target;
      return { success: true };
    }
    return { success: false };
  } };
  const move = {
    name: 'move', subject: { kind: 'unit', unitId: '2:squirrel-king' }, object: { kind: 'hex', coordinate: '0,1' },
    origin: '1,1', target: '0,1', parameters: [1], qualifiers: [], controller: 2
  };
  return { state, rules, hooks, pending, hits, move };
}

test('a triggered delayed action fixes its target after the triggering move resolves', () => {
  const fixture = scenario(false);
  const result = executeNormalizedIntent(fixture.state, cards, fixture.rules, fixture.move, fixture.hooks);
  assert.equal(result.canceled, undefined);
  assert.deepEqual(fixture.pending, ['0,1']);
  assert.equal(fixture.state.units.find(unit => unit.id === '2:squirrel-king').coordinate, '0,1');
  assert.equal(fixture.state.units.some(unit => unit.coordinate === fixture.pending[0]), true, 'the post-event trigger observes the resolved destination');
});

test('Fast triggered action resolves after movement at the resolved destination', () => {
  const fixture = scenario(true);
  executeNormalizedIntent(fixture.state, cards, fixture.rules, fixture.move, fixture.hooks);
  assert.deepEqual(fixture.hits, ['2:squirrel-king']);
  assert.equal(fixture.state.units.find(unit => unit.id === '2:squirrel-king').coordinate, '0,1');
  assert.deepEqual(fixture.state.normalizedEvents.map(event => `${event.name}:${event.stage}`), [
    'move:target', 'fire:target', 'fire:resolved', 'move:resolved'
  ]);
});

test('all target policy freezes and emits one singular action per matching target', () => {
  const state = {
    activePlayer: 1, turnNumber: 1, rulesVersion: 2,
    units: [
      { id: '1:queen-bee', troopId: 'queen-bee', owner: 1, coordinate: '2,2', permanentDamage: 0 },
      { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,1', permanentDamage: 0 },
      { id: '2:coastal-heron', troopId: 'coastal-heron', owner: 2, coordinate: '0,1', permanentDamage: 0 }
    ], effects: [], bashes: [], bombs: [], normalizedEvents: [], ruleContributions: []
  };
  const rule = parseRule('self move _ : self F.fire(2,_) all o:opp');
  const targets = [];
  const result = executeNormalizedIntent(state, cards, [{ id: 'fanout', sourceUnitId: '1:queen-bee', rule }], {
    name: 'move', subject: { kind: 'unit', unitId: '1:queen-bee' }, object: { kind: 'hex', coordinate: '2,1' },
    origin: '2,2', target: '2,1', parameters: [], qualifiers: [], controller: 1
  }, {
    apply(intent) {
      if (intent.name === 'fire') targets.push(intent.target);
      return { success: true };
    }
  });
  assert.equal(result.canceled, undefined);
  assert.deepEqual(targets.sort(), ['0,1', '1,1']);
  assert.equal(state.normalizedEvents.filter(event => event.name === 'fire' && event.stage === 'target').length, 2);
  assert.ok(state.normalizedEvents.every(event => event.object?.kind !== 'unit' || typeof event.object.unitId === 'string'));
});
