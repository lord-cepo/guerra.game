import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState, dispatchTrigger, registerPassive } from "../dist/game/engine.js";
import { createEngineCards } from "./helpers/engine-fixture.mjs";

const { cards, catalogueCards, troopSeeds } = createEngineCards();

test('a troop cannot act on two consecutive turns', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const p1Turn = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const p2Turn = applyGameAction(p1Turn, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,0' }, cards);
  assert.throws(() => applyGameAction(p2Turn, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards), /previous turn/);
});
test('defeated troops cannot be redeployed', () => {
  const state = createGameState();
  state.defeatedTroopIds.push('2:cave-viper');
  state.activePlayer = 2;
  state.units.push({ troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 });
  assert.throws(() => applyGameAction(state, 2, { type: 'deploy', troopId: 'cave-viper', coordinate: '1,0' }, cards), /unavailable/);
});

test('invalid actions leave the authoritative state unchanged', () => {
  const state = createGameState();
  const before = structuredClone(state);
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards), /not deployed/);
  assert.deepEqual(state, before);
});

test('available actions are exactly engine-accepted targets and never mutate state', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'queen-bee', owner: 1, coordinate: '0,2', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const before = structuredClone(state);
  const available = availableActionsFor(state, 1, 'tiger-queen', cards);
  assert.equal(available.every(action => action.type === 'move' || action.type === 'self-defense'), true);
  assert.equal(available.some(action => action.coordinate === '1,1'), true);
  assert.equal(available.some(action => action.coordinate === '1,0'), true, 'an enemy destination starts a legal bash');
  assert.equal(available.some(action => action.coordinate === '0,2'), false, 'friendly occupied destinations are excluded');
  assert.equal(available.some(action => action.coordinate === '0,0'), false, 'the central gap is excluded');
  for (const action of available) assert.doesNotThrow(() => applyGameAction(state, 1, action, cards));
  assert.deepEqual(state, before);
});

test('available deployment targets preserve the hero prerequisite', () => {
  const state = createGameState();
  assert.equal(availableActionsFor(state, 1, 'ember-salamander', cards).length, 0);
  const heroDeployments = availableActionsFor(state, 1, 'tiger-queen', cards);
  assert.equal(heroDeployments.some(action => action.type === 'deploy' && action.coordinate === '1,2'), true);
});

test('accepted actions append revisioned events suitable for reconnecting clients', () => {
  const next = applyGameAction(createGameState(), 1, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' }, cards);
  assert.equal(next.revision, 1);
  assert.deepEqual(next.events, [{ revision: 1, player: 1, action: { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' } }]);
  assert.deepEqual(next.defeatedTroopIds, []);
});

test('flight ignores intervening troops but cannot land in the central hex', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'cinder-heron', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '0,2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const flown = applyGameAction(state, 1, { type: 'fly', troopId: 'cinder-heron', coordinate: '-1,1' }, cards);
  assert.equal(flown.units.find(unit => unit.troopId === 'cinder-heron')?.coordinate, '-1,1');
  assert.throws(() => applyGameAction(state, 1, { type: 'fly', troopId: 'cinder-heron', coordinate: '0,0' }, cards), /Invalid hex/);
});

test('push moves the selected troop along the legal straight line and records its origin', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'reed-warden', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, revision: 0, events: [] };
  const pushed = applyGameAction(state, 1, {
    type: 'push', troopId: 'reed-warden', coordinate: '1,0', destination: '1,-2'
  }, cards);
  assert.equal(pushed.units.find(unit => unit.troopId === 'coastal-heron')?.coordinate, '1,-2');
  assert.equal(pushed.events.at(-1)?.origin, '1,0');
  assert.throws(() => applyGameAction(state, 1, {
    type: 'push', troopId: 'reed-warden', coordinate: '1,0', destination: '1,-1'
  }, cards), /Invalid push destination/);
});

test('pull moves the selected troop toward the acting troop', () => {
  cards.set('pull-tester', {
    id: 'pull-tester', name: 'Pull Tester', role: 'troop', baseHealth: 2,
    deploymentRegions: ['starting'], actions: [{ kind: 'pull', amount: 1, range: 2 }]
  });
  const state = { activePlayer: 1, units: [
    { troopId: 'pull-tester', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const pulled = applyGameAction(state, 1, { type: 'pull', troopId: 'pull-tester', coordinate: '1,0', destination: '1,1', targetUnitId: '2:coastal-heron' }, cards);
  assert.equal(pulled.units.find(unit => unit.troopId === 'coastal-heron')?.coordinate, '1,1');
  assert.equal(pulled.events.at(-1)?.origin, '1,0');
});

test('Deep Ocean Octopus pulls the saved-playground targets three full hexes through its own hex', () => {
  const base = { activePlayer: 2, units: [
    { id: '2:deep-ocean-octopus', troopId: 'deep-ocean-octopus', owner: 2, coordinate: '-2,-1', permanentDamage: 0 },
    { id: '1:stag-guardian', troopId: 'stag-guardian', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:arcane-viper', troopId: 'arcane-viper', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const choices = availableActionsFor(base, 2, 'deep-ocean-octopus', cards).filter(action => action.type === 'pull');
  const stagPull = choices.find(action => action.targetUnitId === '1:stag-guardian');
  const viperPull = choices.find(action => action.targetUnitId === '1:arcane-viper');
  assert.equal(stagPull?.destination, '-2,-1');
  assert.equal(viperPull?.destination, '-3,-2');

  const stagResult = applyGameAction(base, 2, stagPull, cards);
  assert.equal(stagResult.units.find(unit => unit.id === '1:stag-guardian')?.coordinate, '-2,-1');
  assert.deepEqual(stagResult.bashes.map(bash => [bash.attackerId, bash.defenderId, bash.target]), [
    ['1:stag-guardian', '2:deep-ocean-octopus', '-2,-1']
  ]);

  const viperResult = applyGameAction(base, 2, viperPull, cards);
  assert.equal(viperResult.units.find(unit => unit.id === '1:arcane-viper')?.coordinate, '-3,-2');
  assert.equal(viperResult.bashes.length, 0);
});

test('stun clears both modifiers and skips the target troop for one turn', () => {
  cards.set('stun-tester', {
    id: 'stun-tester', name: 'Stun Tester', role: 'troop', baseHealth: 2,
    deploymentRegions: ['starting'], actions: [{ kind: 'stun', amount: 1, range: 2 }]
  });
  const state = { activePlayer: 1, units: [
    { troopId: 'stun-tester', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '0,-1', permanentDamage: 0, shields: [{ value: 2 }], magicModifierBonus: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const stunned = applyGameAction(state, 1, { type: 'stun', troopId: 'stun-tester', coordinate: '0,-1' }, cards);
  const target = stunned.units.find(unit => unit.troopId === 'squirrel-king');
  assert.equal(target?.stunnedTurns, 1);
  assert.equal(target?.shields, undefined);
  assert.equal(target?.magicModifierBonus, undefined);
  assert.equal(availableActionsFor(stunned, 2, 'squirrel-king', cards).length, 0);
  const afterTurn = applyGameAction(stunned, 2, { type: 'pass' }, cards);
  assert.equal(afterTurn.units.find(unit => unit.troopId === 'squirrel-king')?.stunnedTurns, undefined);
});

test('a push-created bash resolves in the first combat phase after an End phase', () => {
  const state = { activePlayer: 2, units: [
    { id: '2:bramble-scout', troopId: 'bramble-scout', owner: 2, coordinate: '1,-2', permanentDamage: 0 },
    { id: '1:raven-prince', troopId: 'raven-prince', owner: 1, coordinate: '1,-1', permanentDamage: 0 },
    { id: '2:walnut-crab', troopId: 'walnut-crab', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };

  const pushed = applyGameAction(state, 2, {
    type: 'push', troopId: 'bramble-scout', coordinate: '1,-1', destination: '1,0', targetUnitId: '1:raven-prince'
  }, cards);
  assert.equal(pushed.bashes.length, 1, 'the Push action does not count as a response to the bash it creates');
  assert.equal(pushed.activePlayer, 1);

  const attackerResponded = applyGameAction(pushed, 1, { type: 'pass' }, cards);
  assert.equal(attackerResponded.bashes.length, 0, 'the first combat-resolve after the intervening End resolves the bash');
});

test('a pusher can choose either participant sharing a bash hex', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:canyon-ibex', troopId: 'canyon-ibex', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:reed-warden', troopId: 'reed-warden', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:canyon-ibex', defenderId: '2:squirrel-king', target: '1,0' }], lastActingTroopId: {} };
  const choices = availableActionsFor(state, 2, 'reed-warden', cards).filter(action => action.type === 'push' && action.coordinate === '1,0');
  assert.deepEqual(choices.map(action => action.targetUnitId).sort(), ['1:canyon-ibex', '2:squirrel-king']);
  const pushAttacker = choices.find(action => action.targetUnitId === '1:canyon-ibex');
  const pushed = applyGameAction(state, 2, pushAttacker, cards);
  assert.equal(pushed.units.find(unit => unit.id === '1:canyon-ibex')?.coordinate, '1,-2');
  assert.equal(pushed.units.find(unit => unit.id === '2:squirrel-king')?.coordinate, '1,0');
  assert.equal(pushed.bashes.length, 0, 'moving either participant out of the contested hex ends that bash');
});

test('push can move a bomb and merges its damage into a bomb at the destination', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'wandering-monarch', owner: 1, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,0', damage: 2 },
    { owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 1 }
  ], lastActingTroopId: {}, revision: 0, events: [] };
  const choice = availableActionsFor(state, 1, 'wandering-monarch', cards)
    .find(action => action.type === 'push' && action.targetBomb && action.coordinate === '1,0');
  assert.deepEqual(choice, {
    type: 'push', troopId: 'wandering-monarch', coordinate: '1,0', destination: '1,-1', targetBomb: true
  });

  const pushed = applyGameAction(state, 1, choice, cards);
  assert.deepEqual(pushed.bombs, [
    { owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 3 }
  ]);
  assert.equal(pushed.events.at(-1)?.origin, '1,0');
  assert.equal(pushed.events.at(-1)?.action.targetBomb, true);
});

test('pull can move a bomb and merges its damage into a bomb at the destination', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'deep-ocean-octopus', owner: 1, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,2', damage: 2 },
    { owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 1 }
  ], lastActingTroopId: {}, revision: 0, events: [] };
  const choice = availableActionsFor(state, 1, 'deep-ocean-octopus', cards)
    .find(action => action.type === 'pull' && action.targetBomb && action.coordinate === '1,2');
  assert.deepEqual(choice, {
    type: 'pull', troopId: 'deep-ocean-octopus', coordinate: '1,2', destination: '1,-1', targetBomb: true
  });

  const pulled = applyGameAction(state, 1, choice, cards);
  assert.deepEqual(pulled.bombs, [
    { owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 3 }
  ]);
  assert.equal(pulled.events.at(-1)?.action.targetBomb, true);
});

test('passing resolves the turn and creates the same revisioned history as active troop actions', () => {
  const passed = applyGameAction(createGameState(), 1, { type: 'pass' }, cards);
  assert.equal(passed.activePlayer, 2);
  assert.equal(passed.phase, 'action');
  assert.equal(passed.revision, 1);
  assert.deepEqual(passed.events, [{ revision: 1, player: 1, action: { type: 'pass' } }]);
});

test('the turn remains in End while an End card effect awaits its choice', () => {
  const state = { activePlayer: 1, phase: 'action', units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const ending = applyGameAction(state, 1, { type: 'pass' }, cards);
  assert.equal(ending.phase, 'end');
  const nextTurn = applyGameAction(ending, 1, { type: 'resolve-pass', troopId: 'wandering-monarch' }, cards);
  assert.equal(nextTurn.phase, 'action');
  assert.equal(nextTurn.activePlayer, 2);
});

test('cannon applies friendly-fire black magic along its line', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'walnut-crab', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'queen-bee', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'tiger-queen', owner: 1, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'highland-hawk', owner: 2, coordinate: '-1,0', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '-2,-2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '-1,0' }, cards);
  assert.deepEqual(fired.effects.filter(effect => effect.kind === 'cannon').map(effect => effect.target), ['0,1', '-1,0']);
  const resolved = applyGameAction(fired, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '1,1' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'queen-bee')?.permanentDamage, 2, 'a friendly troop in the line is damaged');
  assert.equal(resolved.units.some(unit => unit.troopId === 'highland-hawk'), false);
  assert.throws(() => applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '0,0' }, cards), /Invalid hex/);
});

test('cannon damage is reduced by the magic modifier', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'walnut-crab', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'highland-hawk', owner: 2, coordinate: '-1,0', permanentDamage: 0, magicModifierBonus: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '-1,0' }, cards);
  const resolved = applyGameAction(fired, 2, { type: 'pass' }, cards);
  const hawk = resolved.units.find(unit => unit.troopId === 'highland-hawk');
  assert.equal(hawk.permanentDamage, 1, 'the magic modifier absorbs 1 of the 2-damage cannonball');
  assert.equal(hawk.magicModifierBonus, undefined, 'the magic modifier is consumed');
});

test('cannon applies visible nonlethal permanent damage when the opponent responds', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'walnut-crab', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'marsh-badger', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '-1,0' }, cards);
  assert.equal(fired.units.find(unit => unit.troopId === 'marsh-badger')?.permanentDamage, 0, 'cannon damage remains delayed');
  const resolved = applyGameAction(fired, 2, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'marsh-badger')?.permanentDamage, 2);
  assert.equal(resolved.effects.some(effect => effect.kind === 'cannon'), false);
});

test('cannon can fire across the central gap to a legal hex beyond it', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'coconut-crab', owner: 1, coordinate: '0,-2', permanentDamage: 0 },
    { troopId: 'cinder-heron', owner: 2, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'coconut-crab', coordinate: '0,1' }, cards);
  assert.deepEqual(fired.effects.filter(effect => effect.kind === 'cannon').map(effect => effect.target), ['0,-1', '0,0', '0,1']);
});

test('gore moves to a valid line destination and delays enemy physical damage', () => {
  cards.set('gore-tester', {
    id: 'gore-tester', name: 'Gore Tester', role: 'troop', baseHealth: 10,
    deploymentRegions: ['starting'], actions: [{ kind: 'gore', amount: 2, range: 3 }]
  });
  const state = { activePlayer: 1, units: [
    { troopId: 'gore-tester', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'tiger-queen', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 1, { type: 'gore', troopId: 'gore-tester', coordinate: '1,0' }, cards);
  const gore = fired.effects.find(effect => effect.kind === 'gore' && effect.targetUnitId);
  assert.equal(fired.units.find(unit => unit.troopId === 'gore-tester')?.coordinate, '1,0', 'Gore moves immediately when confirmed');
  assert.deepEqual(gore, {
    owner: 1, sourceTroopId: 'gore-tester', sourceUnitId: '1:gore-tester', targetUnitId: '2:tiger-queen',
    kind: 'gore', target: '1,1', value: 2, origin: '1,2', goreDestination: '1,0'
  });
  assert.equal(fired.units.find(unit => unit.troopId === 'tiger-queen')?.permanentDamage, 0);
  assert.equal(fired.bashes.length, 0, 'an empty destination does not start a bash');

  const resolved = applyGameAction(fired, 2, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'gore-tester')?.coordinate, '1,0');
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen')?.permanentDamage, 1, 'physical gore damage is reduced by the target modifier');
  assert.equal(resolved.effects.some(effect => effect.kind === 'gore'), false);
  assert.equal(resolved.bashes.length, 0);
});

test('Merino Ram can Gore the saved-playground enemy at full range three', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'merino-ram', owner: 2, coordinate: '-3,-1', permanentDamage: 0 },
      { troopId: 'deep-ocean-octopus', owner: 1, coordinate: '0,2', permanentDamage: 0 }
    ], effects: [], bashes: [], lastActingTroopId: { 1: 'deep-ocean-octopus' }
  };
  const legal = availableActionsFor(state, 2, 'merino-ram', cards);
  assert.ok(legal.some(action => action.type === 'gore' && action.coordinate === '0,2'));
  const gored = applyGameAction(state, 2, { type: 'gore', troopId: 'merino-ram', coordinate: '0,2' }, cards);
  assert.equal(gored.units.find(unit => unit.troopId === 'merino-ram')?.coordinate, '0,2');
  assert.equal(gored.bashes.length, 1, 'Gore starts its destination bash on confirmation');
  assert.ok(gored.effects.some(effect => effect.kind === 'gore' && effect.target === '0,2' && effect.value === 2 && effect.goreDestination === '0,2'));
});

test('Merino Ram can Gore across intervening Yak and Crane troops', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'merino-ram', owner: 2, coordinate: '-3,-1', permanentDamage: 0 },
      { troopId: 'frosthorn-yak', owner: 1, coordinate: '-3,-2', permanentDamage: 0, combatModifierBonus: -1 },
      { troopId: 'bellwing-crane', owner: 1, coordinate: '-3,-3', permanentDamage: 0, combatModifierBonus: -1 },
    ], effects: [], bashes: [], lastActingTroopId: {}
  };
  const legal = availableActionsFor(state, 2, 'merino-ram', cards);
  assert.ok(legal.some(action => action.type === 'gore' && action.coordinate === '-3,-4'));
  const gored = applyGameAction(state, 2, { type: 'gore', troopId: 'merino-ram', coordinate: '-3,-4' }, cards);
  assert.equal(gored.units.find(unit => unit.troopId === 'merino-ram')?.coordinate, '-3,-4');
  assert.deepEqual(gored.effects.filter(effect => effect.kind === 'gore' && effect.targetUnitId).map(effect => effect.targetUnitId), ['1:frosthorn-yak', '1:bellwing-crane']);
  let ready = gored;
  while (ready.pendingResolution) ready = applyGameAction(ready, 1, { type: 'resolve-pass', troopId: ready.pendingResolution.sourceTroopId }, cards);
  const resolved = applyGameAction(ready, 1, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'merino-ram')?.coordinate, '-3,-4');
  assert.equal(resolved.effects.some(effect => effect.kind === 'gore'), false);
});

test('Ironhide Boar Pup gains both permanent modifiers once per troop damaged by Gore', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'ironhide-boar-pup', owner: 2, coordinate: '-3,-1', permanentDamage: 0 },
      { troopId: 'frosthorn-yak', owner: 1, coordinate: '-3,-2', permanentDamage: 0, combatModifierBonus: -1 },
      { troopId: 'bellwing-crane', owner: 1, coordinate: '-3,-3', permanentDamage: 0, combatModifierBonus: -1 },
    ], effects: [], bashes: [], lastActingTroopId: {}
  };
  const charged = applyGameAction(state, 2, { type: 'gore', troopId: 'ironhide-boar-pup', coordinate: '-3,-4' }, cards);
  let ready = charged;
  while (ready.pendingResolution) ready = applyGameAction(ready, 1, { type: 'resolve-pass', troopId: ready.pendingResolution.sourceTroopId }, cards);
  const resolved = applyGameAction(ready, 1, { type: 'pass' }, cards);
  const boar = resolved.units.find(unit => unit.troopId === 'ironhide-boar-pup');
  assert.equal(boar?.combatModifierBonus, 2);
  assert.equal(boar?.magicModifierBonus, 2);
  assert.equal(resolved.triggerEvents.filter(event => event.trigger === 'successfulAttack' && event.actionKind === 'gore').length, 2);
});

test('gore rejects friendly destinations and moves to empty valid destinations', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'gore-tester', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 1, { type: 'gore', troopId: 'gore-tester', coordinate: '1,0' }, cards), /friendly troop/);
  const empty = applyGameAction(state, 1, { type: 'gore', troopId: 'gore-tester', coordinate: '1,1' }, cards);
  assert.equal(empty.units.find(unit => unit.troopId === 'gore-tester')?.coordinate, '1,1');
  assert.ok(empty.effects.some(effect => effect.kind === 'gore' && effect.value === 0 && effect.goreDestination === '1,1'));
});
