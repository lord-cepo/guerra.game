import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRule, parseRuleEffectBundle } from '../dist/game/rule-parser.js';
import { parseCard } from '../dist/game/card-parser.js';
import { emitNormalizedEvent } from '../dist/game/rule-runtime.js';
import { applyGameAction, createGameState, availableActionsFor } from '../dist/game/engine.js';
import { createEngineCards } from './helpers/engine-fixture.mjs';

function fixture(rules = []) {
  const { cards } = createEngineCards();
  cards.set('cost-troop', parseCard({ id: 'cost-troop', baseHealth: 4, deploymentRegions: 'starting', actions: 'move(2), bow(3,2)', rules }));
  const state = { ...createGameState(), actions: { 1: 1, 2: 0 }, units: [
    { id: '1:cost-troop', troopId: 'cost-troop', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
  ] };
  return { cards, state };
}

test('optional all-target shields confirm or skip the whole group before paying', () => {
  const { state, cards } = fixture(['start : shield(1) all o:you']);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  state.units.push({ id: '1:coastal-heron', troopId: 'coastal-heron', owner: 1, coordinate: '1,2', permanentDamage: 0 });
  const pending = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(pending.pendingResolution?.allTargets, true);
  assert.equal(pending.units[0].inactiveOnTurn, undefined);
  const skipped = applyGameAction(pending, 1, { type: 'resolve-pass', troopId: 'cost-troop' }, cards);
  assert.equal(skipped.units.some(unit => unit.shields?.length), false);
  assert.equal(skipped.units[0].inactiveOnTurn, undefined);
  const choice = availableActionsFor(pending, 1, 'cost-troop', cards).find(action => action.type === 'resolve-rule');
  const accepted = applyGameAction(JSON.parse(JSON.stringify(pending)), 1, choice, cards);
  assert.equal(accepted.pendingResolution, undefined);
  assert.deepEqual(accepted.units.filter(unit => unit.owner === 1).map(unit => unit.shields?.[0]?.value), [1, 1]);
  assert.equal(accepted.normalizedEvents.filter(event => event.name === 'deactivate' && event.stage === 'target').length, 1);
});

test('tireless all-target shields execute automatically without inactivity', () => {
  const { state, cards } = fixture(['start : T.shield(1) all o:you']);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  const next = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(next.pendingResolution, undefined);
  assert.equal(next.units[0].shields?.[0]?.value, 1);
  assert.equal(next.units[0].inactiveOnTurn, undefined);
});

test('an explicit cost makes a tireless fixed-target consequence optional', () => {
  const { state, cards } = fixture(['start : deactivate self :: T.shield(1) self']);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  const pending = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(pending.pendingResolution?.kind, 'rule-choice');
  assert.equal(pending.units[0].inactiveOnTurn, undefined);
  const skipped = applyGameAction(pending, 1, { type: 'resolve-pass', troopId: 'cost-troop' }, cards);
  assert.equal(skipped.units[0].shields, undefined);
  assert.equal(skipped.units[0].inactiveOnTurn, undefined);
});

test('free bomb-defuse consequences execute without a choice or inactivity', () => {
  const { state, cards } = fixture(['start : bomb-defuse self']);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  state.bombs = [{ owner: 1, sourceTroopId: 'cost-troop', coordinate: '1,1', damage: 2 }];
  const next = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(next.pendingResolution, undefined);
  assert.equal(next.bombs.length, 0);
  assert.equal(next.units[0].inactiveOnTurn, undefined);
});

test('cost syntax separates an ordered payment from an ordered effect bundle', () => {
  const rule = parseRule('start : self deactivate self & self up-actions(-1) you :: self up-actions(2) you & self up-actions(3) opp');
  assert.equal(rule.costs.length, 2);
  assert.equal(rule.consequences.length, 2);
  assert.deepEqual(rule.costs[1].object, { kind: 'player', player: 'you' });
  assert.equal(rule.consequences[1].event.action.name, 'up-actions');
  for (const source of ['start : up-actions(1)', 'start : up-actions you', 'start : up-actions(1) self', 'start : up-actions(1) all you', 'start : up-actions(1,2) opp', 'start : up-actions(1) you permanent']) assert.throws(() => parseRule(source), source);
  assert.throws(() => parseRuleEffectBundle('self up-actions(1) you :: move(1)'));
});

test('bundles execute A B A1 B1 C D C1 D1, including player event bindings', () => {
  const { state, cards } = fixture();
  const rules = [
    'start : self deactivate self & self up-actions(-1) you :: self up-actions(3) opp & self up-actions(4) opp',
    'self deactivate self : self activate self',
    'self up-actions(-1) you : self up-actions(2) you',
    'self up-actions(3) opp : self up-actions(5) you',
    'self up-actions(4) opp : self up-actions(6) you'
  ].map((text, index) => ({ id: `test-${index}`, sourceUnitId: '1:cost-troop', rule: parseRule(text) }));
  const result = emitNormalizedEvent(state, cards, rules, { id: 1, name: 'start', stage: 'target', parameters: [], qualifiers: [], controller: 1, turn: 0, success: true }, { actionCosts: true, apply: () => ({ success: false }) });
  assert.equal(result.canceled, undefined);
  assert.deepEqual(state.normalizedEvents.filter(event => event.stage === 'target').map(event => [event.name, event.parameters[0]]), [
    ['start', undefined], ['deactivate', undefined], ['up-actions', -1], ['activate', undefined], ['up-actions', 2], ['up-actions', 3], ['up-actions', 4], ['up-actions', 5], ['up-actions', 6]
  ]);
  assert.deepEqual(state.actions, { 1: 13, 2: 7 });
  assert.equal(state.units[0].inactiveOnTurn, undefined);
});

test('an unpayable confirmed action leaves every cost and event untouched', () => {
  const { state, cards } = fixture();
  state.actions[1] = 0;
  const before = structuredClone(state);
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards), /cost/);
  assert.deepEqual(state, before);
  assert.deepEqual(availableActionsFor(state, 1, 'cost-troop', cards), []);
});

test('two tokens allow two standalone actions and end the phase only at zero', () => {
  const { state, cards } = fixture();
  state.actions[1] = 2;
  const moved = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(moved.activePlayer, 1);
  assert.equal(moved.phase, 'action');
  assert.equal(moved.actions[1], 1);
  assert.equal(moved.units[0].inactiveOnTurn, 0);
  const ended = applyGameAction(moved, 1, { type: 'pass' }, cards);
  assert.equal(ended.activePlayer, 2);
  assert.equal(ended.actions[1], 0);
  assert.equal(ended.actions[2], 1);
});

test('deactivation triggers resolve before the action and may reactivate its source', () => {
  const { state, cards } = fixture(['self deactivate self : self activate self', 'self up-actions(-1) you : self up-actions(1) you']);
  const moved = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(moved.activePlayer, 1);
  assert.equal(moved.actions[1], 1);
  assert.equal(moved.units[0].inactiveOnTurn, undefined);
  assert.deepEqual(moved.normalizedEvents.filter(event => event.stage === 'target').map(event => event.name), ['deactivate', 'up-actions', 'activate', 'up-actions', 'move']);
  assert.deepEqual(moved.dashboard.find(row => row.bundle?.kind === 'cost').bundle.events.map(event => event.name), ['deactivate', 'up-actions']);
});

test('deployment pays while the troop is off board and enters inactive', () => {
  const { cards } = fixture();
  const state = createGameState({ 1: ['tiger-queen'], 2: ['squirrel-king'] });
  const deployed = applyGameAction(state, 1, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' }, cards);
  const events = deployed.normalizedEvents.filter(event => event.stage === 'target');
  assert.deepEqual(events.slice(0, 3).map(event => event.name), ['deactivate', 'up-actions', 'deploy']);
  assert.equal(events[0].destination, undefined);
  assert.equal(deployed.units[0].inactiveOnTurn, 0);
  assert.equal(events.find(event => event.name === 'up-actions' && event.parameters[0] === 1).subject.unitId, '2:squirrel-king');
});

test('explicit active-action costs replace implicit costs', () => {
  const { state, cards } = fixture();
  cards.set('cost-troop', parseCard({ id: 'cost-troop', baseHealth: 4, deploymentRegions: 'starting', actions: 'self up-actions(-1) you :: move(2)' }));
  const moved = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(moved.units[0].inactiveOnTurn, undefined);
  assert.equal(moved.normalizedEvents.some(event => event.name === 'deactivate'), false);
});

test('a cost trigger that kills the acting troop fizzles the action without a refund', () => {
  const { state, cards } = fixture(['self deactivate self : self die self']);
  state.actions[1] = 2;
  const next = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(next.units.some(unit => unit.id === '1:cost-troop'), false);
  assert.equal(next.actions[1], 1);
  assert.equal(next.normalizedEvents.find(event => event.name === 'move').canceled, true);
  assert.equal(next.normalizedEvents.some(event => event.name === 'move' && event.stage === 'resolved'), false);
});

test('two explicit chained actions resolve before either action trigger', () => {
  const { state, cards } = fixture([
    'start : self shield(2) self & self mshield(3) self',
    'self shield _ : self up-actions(4) you',
    'self mshield _ : self up-actions(5) you'
  ]);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  let next = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(next.pendingResolution?.kind, 'rule-choice');
  assert.equal(next.units[0].inactiveOnTurn, undefined);
  for (let index = 0; index < 2; index++) {
    const pending = next.pendingResolution;
    const choice = availableActionsFor(next, pending.owner, pending.sourceTroopId, cards).find(action => action.type === 'resolve-rule');
    next = applyGameAction(next, pending.owner, choice, cards);
  }
  const events = next.normalizedEvents.filter(event => event.controller === 1 && event.stage === 'target' && ['deactivate', 'shield', 'mshield', 'up-actions'].includes(event.name));
  assert.deepEqual(events.map(event => [event.name, event.parameters[0]]), [['up-actions', 1], ['deactivate', undefined], ['shield', 2], ['mshield', 3], ['up-actions', 4], ['up-actions', 5]]);
  assert.equal(next.units[0].shields[0].value, 2);
  assert.equal(next.units[0].magicModifierBonus, 3);
});

test('an explicit-cost choice pays only on confirmation and survives serialization', () => {
  const { state, cards } = fixture(['start : self deactivate self :: move(1) & self up-actions(2) you', 'self move _ : self up-actions(3) you']);
  state.activePlayer = 2;
  state.actions = { 1: 0, 2: 1 };
  const pending = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(pending.units[0].inactiveOnTurn, undefined);
  assert.equal(pending.actions[1], 1);
  assert.equal(pending.pendingResolution.kind, 'optional-move');
  const next = applyGameAction(JSON.parse(JSON.stringify(pending)), 1, { type: 'resolve-move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(next.actions[1], 6);
  const events = next.normalizedEvents.filter(event => event.controller === 1 && event.stage === 'target' && ['deactivate', 'move', 'up-actions'].includes(event.name));
  assert.deepEqual(events.map(event => [event.name, event.parameters[0]]), [['up-actions', 1], ['deactivate', undefined], ['move', undefined], ['up-actions', 2], ['up-actions', 3]]);
});

test('a standalone chained action pays once and releases triggers after both actions', () => {
  const { state, cards } = fixture();
  cards.set('cost-troop', parseCard({ id: 'cost-troop', baseHealth: 4, deploymentRegions: 'starting', actions: 'move(2) & self up-actions(2) you', rules: ['self move _ : self up-actions(3) you'] }));
  const next = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(next.actions[1], 5);
  assert.deepEqual(next.normalizedEvents.filter(event => event.stage === 'target').map(event => [event.name, event.parameters[0]]), [['deactivate', undefined], ['up-actions', -1], ['move', undefined], ['up-actions', 2], ['up-actions', 3]]);
});

test('two chosen actions share payment and keep their triggers behind the entire bundle', () => {
  const { state, cards } = fixture(['start : move(1) & move(1)', 'self move _ : self up-actions(2) you']);
  state.activePlayer = 2; state.actions = { 1: 0, 2: 1 };
  const pending = applyGameAction(state, 2, { type: 'pass' }, cards);
  const first = applyGameAction(pending, 1, { type: 'resolve-move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(first.pendingResolution.kind, 'optional-move');
  assert.equal(first.actions[1], 1, 'the first Move trigger is still deferred');
  const second = applyGameAction(JSON.parse(JSON.stringify(first)), 1, { type: 'resolve-move', troopId: 'cost-troop', coordinate: '1,1' }, cards);
  assert.equal(second.actions[1], 5);
  assert.equal(second.normalizedEvents.filter(event => event.name === 'deactivate' && event.stage === 'target').length, 1);
  assert.deepEqual(second.normalizedEvents.filter(event => event.controller === 1 && event.stage === 'target' && ['move', 'up-actions'].includes(event.name)).map(event => [event.name, event.parameters[0]]), [['up-actions', 1], ['move', undefined], ['move', undefined], ['up-actions', 2], ['up-actions', 2]]);
});

test('a cost-trigger choice resumes the original paid command after reloading', () => {
  const { state, cards } = fixture();
  cards.set('cost-observer', parseCard({ id: 'cost-observer', baseHealth: 4, deploymentRegions: 'starting', rules: ['o:you deactivate o:you : move(1)'] }));
  state.units.push({ id: '1:cost-observer', troopId: 'cost-observer', owner: 1, coordinate: '2,2', permanentDamage: 0 });
  // Avoid observing its own payment recursively.
  cards.get('cost-observer').rules = [parseRule('o:you deactivate o:you if self active : move(1)')];
  const pending = applyGameAction(state, 1, { type: 'move', troopId: 'cost-troop', coordinate: '1,0' }, cards);
  assert.equal(pending.paidCommand.action.troopId, 'cost-troop');
  assert.equal(pending.units[0].coordinate, '1,1');
  assert.equal(pending.actions[1], 0);
  const next = applyGameAction(JSON.parse(JSON.stringify(pending)), 1, { type: 'resolve-pass', troopId: 'cost-observer' }, cards);
  assert.equal(next.units[0].coordinate, '1,0');
  assert.equal(next.activePlayer, 2);
  assert.equal(next.normalizedEvents.filter(event => event.name === 'up-actions' && event.parameters[0] === -1 && event.stage === 'target').length, 1);
});
