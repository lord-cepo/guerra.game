import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCard, parseAction } from '../dist/game/card-parser.js';
import { parseRule, parseRuleEffect } from '../dist/game/rule-parser.js';
import { emitNormalizedEvent } from '../dist/game/rule-runtime.js';
import { evaluateObservableCondition, matchRuleAnchor, selectRuleHexes } from '../dist/game/rule-evaluator.js';
import { effectiveUnitState } from '../dist/game/rule-state.js';
import { readNamedValue } from '../dist/game/named-values.js';
import { PLAYABLE_COORDINATES } from '../dist/game/board.js';
import { applyGameAction, createGameState, availableActionsFor } from '../dist/game/engine.js';

function fixture(texts = []) {
  const card = parseCard({ id: 'tester', baseHealth: 4, deploymentRegions: 'starting', rules: ['move(2)', ...texts] });
  const cards = new Map([[card.id, card]]);
  const state = { ...createGameState(), actions: { 1: 2, 2: 1 }, units: [{ id: '1:tester', troopId: 'tester', owner: 1, coordinate: '1,1', permanentDamage: 0 }] };
  const rules = (card.rules ?? []).map((rule, index) => ({ id: `rule-${index}`, sourceUnitId: '1:tester', rule }));
  const context = { state, cards, controller: 1, self: { kind: 'unit', unitId: '1:tester' } };
  return { state, cards, rules, context };
}
function emit(f, name, controller = 1, extra = {}) {
  return emitNormalizedEvent(f.state, f.cards, f.rules, { id: (f.state.normalizedEvents?.at(-1)?.id ?? 0) + 1, name, stage: 'target', parameters: [], qualifiers: [], controller, turn: f.state.turnNumber, success: true, ...extra }, { actionCosts: true, apply: () => ({ success: true }) });
}

test('named counters and flags keep attachment types, allow signed deltas, and survive JSON', () => {
  const f = fixture(['start : up-hex-flag(g,on) self & up-unit-counter(cherry, -2) self & up-player-counter(cherry, 3) you', '_ up-hex-flag(g,on) self : up-actions(1) you']);
  emit(f, 'start');
  const state = JSON.parse(JSON.stringify(f.state));
  assert.equal(readNamedValue(state, { kind: 'hex', coordinate: '1,1' }, 'g', true), true);
  assert.equal(readNamedValue(state, { kind: 'unit', unitId: '1:tester' }, 'cherry', false), -2);
  assert.equal(readNamedValue(state, { kind: 'player', player: 1 }, 'cherry', false), 3);
  assert.equal(state.actions[1], 3);
  assert.equal(evaluateObservableCondition(parseRule('start if you player-counter(cherry,3) : up-actions(1) you').guard, { ...f.context, state }).value, true);
  assert.throws(() => parseRule('start : up-hex-flag(g,2) self'));
  assert.throws(() => parseRule('start : up-player-counter(g,1) o:you 2-from self'));
});

test('selector complements include empty board hexes, compose with filters, and clear global flags', () => {
  const f = fixture(['start : up-hex-flag(g,on) self', 'end : up-hex-flag(g,off) all _']);
  emit(f, 'start');
  const selector = parseRuleEffect('T.move !hex-flag(g,on)').object;
  assert.equal(selectRuleHexes(selector, f.context).value.length, PLAYABLE_COORDINATES.length - 1);
  const onlyMarked = parseRuleEffect('T.move o:you !hex-flag(g,off)').object;
  assert.deepEqual(selectRuleHexes(onlyMarked, f.context).value, ['1,1']);
  const outside = parseRuleEffect('T.move !(o:you adj self)').object;
  assert.equal(selectRuleHexes(outside, f.context).ok, true);
  emit(f, 'end');
  assert.equal(selectRuleHexes(selector, f.context).value.length, PLAYABLE_COORDINATES.length);
});

test('attack families bind concrete events and exclude bomb explosions', () => {
  const f = fixture();
  const event = { id: 1, name: 'fire', stage: 'target', subject: f.context.self, object: f.context.self, parameters: [], qualifiers: [], controller: 1, turn: 0, success: true };
  for (const [family, names] of [['atk', ['fire', 'cannon', 'gore-attack', 'bash', 'bow']], ['patk', ['gore-attack', 'bash', 'bow']], ['ratk', ['fire', 'cannon']]]) {
    const anchor = parseRule(`${family} self : up-actions(1) you`).anchor;
    for (const name of ['fire', 'cannon', 'gore-attack', 'bash', 'bow', 'bomb-explode']) assert.equal(matchRuleAnchor(anchor, { ...event, name }, f.context).value, names.includes(name), `${family}: ${name}`);
  }
});

test('scheduled token events stack, wait for the owner Start, and survive source removal and JSON', () => {
  const f = fixture(['move-from c:opp : up-actions(1) you at next-start']);
  f.rules = [{ id: 'schedule', sourceUnitId: '1:tester', rule: parseRule('end : up-actions(1) you at next-start') }];
  emit(f, 'end'); emit(f, 'end');
  assert.equal(f.state.actions[1], 2);
  assert.equal(f.state.scheduledRules.length, 2);
  f.state = JSON.parse(JSON.stringify(f.state)); f.state.units = []; f.rules = [];
  emit(f, 'start', 2);
  assert.equal(f.state.actions[1], 2);
  emit(f, 'start', 1);
  assert.equal(f.state.actions[1], 4);
  assert.equal(f.state.scheduledRules.length, 0);
  emit(f, 'start', 1);
  assert.equal(f.state.actions[1], 4);
});

test('triggered modifier grants emit events; continuous modifiers do not', () => {
  const f = fixture(['while wounded : up-mod(1,1)', '_ up-mod self : up-actions(1) you', 'end : up-mod(1,1)']);
  f.state.units[0].permanentDamage = 1;
  const derived = f.rules.filter(source => source.rule.kind === 'continuous');
  assert.equal(effectiveUnitState(f.state, f.state.units[0], f.cards, derived).physicalModifier, 1);
  assert.equal(f.state.actions[1], 2);
  emit(f, 'end');
  assert.equal(f.state.actions[1], 3);
  assert.equal(effectiveUnitState(f.state, f.state.units[0], f.cards, derived).physicalModifier, 2);
  assert.equal(f.state.normalizedEvents.filter(event => event.name === 'up-mod' && event.stage === 'target').length, 1);
});

test('scheduled state contributions apply and expire at separate owner-relative boundaries', () => {
  const f = fixture(['end : up-mod(1,1) at next-start until next-end']);
  emit(f, 'end');
  assert.equal(f.state.ruleContributions?.length ?? 0, 0);
  emit(f, 'start', 1);
  assert.equal(f.state.ruleContributions.length, 1);
  f.rules = [];
  emit(f, 'end', 2, { subject: f.context.self });
  assert.equal(f.state.ruleContributions.length, 1);
  emit(f, 'end', 1, { subject: f.context.self });
  assert.equal(f.state.ruleContributions.length, 0);
});

test('unified rules compile actions into selectors; A movement requires its enemy target and keeps tokens', () => {
  const f = fixture();
  f.cards.set('tester', parseCard({ id: 'tester', baseHealth: 4, deploymentRegions: 'starting', rules: ['A.move o:opp adj self', 'while !active : up-mod(1,1)'] }));
  f.state.units.push({ id: '2:tester', troopId: 'tester', owner: 2, coordinate: '1,0', permanentDamage: 0 });
  const action = f.cards.get('tester').actions[0];
  assert.equal(action.range, undefined);
  assert.equal(action.selector.kind, 'directed');
  assert.throws(() => applyGameAction(f.state, 1, { type: 'move', troopId: 'tester', coordinate: '0,1' }, f.cards), /selector/);
  const next = applyGameAction(f.state, 1, { type: 'move', troopId: 'tester', coordinate: '1,0' }, f.cards);
  assert.equal(next.actions[1], 2);
  assert.equal(next.units[0].inactiveOnTurn, 0);
  assert.equal(next.bashes.length, 1);
  assert.ok(availableActionsFor(f.state, 1, 'tester', f.cards).some(action => action.type === 'move' && action.coordinate === '1,0'));
  assert.equal(parseAction('bow(2,3)').selector.within, true);
});

test('explicit triggered selectors pause for a legal target and resume after JSON reload', () => {
  const f = fixture(['end : T.move 1-from self & up-actions(1) opp']);
  f.state.actions[1] = 1;
  const waiting = applyGameAction(f.state, 1, { type: 'pass' }, f.cards);
  assert.equal(waiting.pendingResolution?.kind, 'rule-choice');
  const choices = availableActionsFor(waiting, 1, 'tester', f.cards).filter(action => action.type === 'resolve-rule');
  assert.ok(choices.length > 1);
  const next = applyGameAction(JSON.parse(JSON.stringify(waiting)), 1, choices[0], f.cards);
  assert.equal(next.pendingResolution, undefined);
  assert.equal(next.units[0].coordinate, choices[0].coordinate);
  assert.ok(next.normalizedEvents.some(event => event.name === 'move' && event.destination === choices[0].coordinate));
});
