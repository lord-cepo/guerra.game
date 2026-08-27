import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState, dispatchTrigger, registerPassive } from "../dist/game/engine.js";
import { createEngineCards } from "./helpers/engine-fixture.mjs";

const { cards, catalogueCards, troopSeeds } = createEngineCards();

test('card definitions distinguish continuous conditions from action-producing triggers', () => {
  assert.deepEqual(cards.get('canyon-ibex').continuousEffects, [
    { condition: 'bash-attacker', kind: 'combat-modifier', value: 2, label: 'Canyon Ibex' }
  ]);
  assert.deepEqual(cards.get('sahel-porcupine').triggers, [
    { id: 'momentum', condition: { signal: 'bashAttack', subject: 'self' }, action: { kind: 'upgrade', amount: [1, 1], range: 0, type: ['permanent', 'attack'] } }
  ]);
  assert.equal(cards.get('canyon-ibex').triggers, undefined);
  assert.equal(cards.get('sahel-porcupine').continuousEffects, undefined);
});

test('the expansion cards expose their revised health, actions, and compact passives', () => {
  assert.equal(cards.get('stag-guardian').baseHealth, 4);
  assert.deepEqual(cards.get('raven-prince').actions, [{ kind: 'fly', range: 3 }]);
  assert.equal(cards.get('raven-prince').passiveDescription, 'End: 1🚫1');
  assert.equal(cards.get('temple-last-bell').baseHealth, 2);
  assert.equal(cards.get('temple-last-bell').passiveDescription, '💀: 3F🏹3');
  assert.equal(cards.get('temple-marches').baseHealth, 2);
  assert.deepEqual(cards.get('tortoise-emperor').actions, []);
  assert.equal(cards.get('tortoise-emperor').passiveDescription, 'End: adj +1🛡️');
});

test('active and triggered card actions share the normalized action dictionary', () => {
  assert.deepEqual(cards.get('queen-bee').actions[1], { kind: 'ranged', amount: 3, range: 4 });
  assert.deepEqual(cards.get('raven-prince').triggers[0].action, { kind: 'stun', amount: 1, range: 1 });
  for (const troop of troopSeeds) {
    for (const action of [...troop.actions, ...(troop.triggers ?? []).map(trigger => trigger.action)]) {
      assert.deepEqual(Object.keys(action).sort(), Object.keys(action).filter(key => ['kind', 'amount', 'range', 'type'].includes(key)).sort(), `${troop.id} uses only normalized action keys`);
      assert.equal(typeof action.kind, 'string');
      assert.equal(typeof action.range, 'number');
      if (action.type !== undefined) assert.ok(Array.isArray(action.type));
    }
  }
});

test('Tortoise Emperor places troop-owned shields on each adjacent ally at End', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:tortoise-emperor', troopId: 'tortoise-emperor', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:steppe-lynx', troopId: 'steppe-lynx', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:snowy-owl', troopId: 'snowy-owl', owner: 1, coordinate: '2,2', permanentDamage: 0 },
    { id: '2:coastal-heron', troopId: 'coastal-heron', owner: 2, coordinate: '2,3', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const ended = applyGameAction(state, 1, { type: 'pass' }, cards);
  assert.deepEqual(ended.units.filter(unit => unit.shields).map(unit => [unit.coordinate, unit.shields?.[0].value]).sort(), [['1,1', 1], ['2,2', 1]]);
});

test('Spellshield Beetle deploys as an Obsidian troop without gaining a magic modifier', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const deployment = availableActionsFor(state, 1, 'spellshield-beetle', cards).find(action => action.type === 'deploy');
  assert.ok(deployment);
  assert.equal(cards.get('spellshield-beetle').passives.includes('obsidian'), true);
  assert.deepEqual(cards.get('spellshield-beetle').triggers.map(trigger => trigger.id), ['carapace']);
  const deployed = applyGameAction(state, 1, deployment, cards);
  const beetle = deployed.units.find(unit => unit.troopId === 'spellshield-beetle');
  assert.equal(beetle.magicModifierBonus ?? 0, 0);
});

test('Temple of Marches adds one to friendly Move range while deployed', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:temple-marches', troopId: 'temple-marches', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const actions = availableActionsFor(state, 1, 'tiger-queen', cards);
  assert.ok(actions.some(action => action.type === 'move' && action.coordinate === '1,-1'), 'the normal two-hex mover can reach a third hex');
});

test('Wandering Monarch End event pauses the turn for an optional one-hex move', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:steppe-lynx', troopId: 'steppe-lynx', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const ended = applyGameAction(state, 1, { type: 'move', troopId: 'steppe-lynx', coordinate: '1,1' }, cards);
  assert.equal(ended.activePlayer, 1, 'the opponent turn does not start before End resolves');
  assert.deepEqual({ ...ended.pendingResolution, stackActionId: undefined }, { owner: 1, turnPlayer: 1, sourceUnitId: '1:wandering-monarch', sourceTroopId: 'wandering-monarch', kind: 'optional-move', distance: 1, stackActionId: undefined });
  const choices = availableActionsFor(ended, 1, 'wandering-monarch', cards);
  assert.ok(choices.some(action => action.type === 'resolve-pass'));
  assert.ok(choices.some(action => action.type === 'resolve-move' && action.coordinate === '2,2'));
  assert.equal(choices.some(action => action.type === 'resolve-move' && action.coordinate === '1,1'), false, 'a friendly occupied hex is not dashed as an End-move target');
  const moved = applyGameAction(ended, 1, { type: 'resolve-move', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.equal(moved.units.find(unit => unit.troopId === 'wandering-monarch')?.coordinate, '2,2');
  assert.equal(moved.pendingResolution, undefined);
  assert.equal(moved.activePlayer, 2);

  const declinedPending = applyGameAction(state, 1, { type: 'pass' }, cards);
  const declined = applyGameAction(declinedPending, 1, { type: 'resolve-pass', troopId: 'wandering-monarch' }, cards);
  assert.equal(declined.units.find(unit => unit.troopId === 'wandering-monarch')?.coordinate, '1,2');
  assert.equal(declined.activePlayer, 2);
});

test('Raven Prince End stun requires an enemy target within one hex', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:raven-prince', troopId: 'raven-prince', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,1', permanentDamage: 0, shields: [{ value: 1 }], magicModifierBonus: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const pending = applyGameAction(state, 1, { type: 'pass' }, cards);
  assert.equal(pending.pendingResolution?.kind, 'stun');
  const choice = availableActionsFor(pending, 1, 'raven-prince', cards).find(action => action.type === 'resolve-stun');
  assert.ok(choice);
  const stunned = applyGameAction(pending, 1, choice, cards);
  const target = stunned.units.find(unit => unit.troopId === 'squirrel-king');
  assert.equal(target?.stunnedTurns, 1);
  assert.equal(target?.shields, undefined);
  assert.equal(target?.magicModifierBonus, undefined);
  assert.equal(stunned.activePlayer, 2);
});

test('targetless triggered choices are skipped automatically', () => {
  const raven = applyGameAction({ activePlayer: 1, units: [
    { id: '1:raven-prince', troopId: 'raven-prince', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '-2,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} }, 1, { type: 'pass' }, cards);
  assert.equal(raven.pendingResolution, undefined);
  assert.equal(raven.activePlayer, 2);

  const frosthorn = applyGameAction({ activePlayer: 2, phase: 'action', units: [
    { id: '1:frosthorn-yak', troopId: 'frosthorn-yak', owner: 1, coordinate: '-1,1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '3,3', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} }, 2, { type: 'pass' }, cards);
  assert.equal(frosthorn.pendingResolution, undefined);
  assert.equal(frosthorn.activePlayer, 1);
  assert.equal(frosthorn.phase, 'action');
  assert.equal(frosthorn.lastActingTroopId?.[1], undefined);

  const occupied = ['2,2', '0,2', '1,3', '1,1', '2,3', '0,1'];
  const monarch = applyGameAction({ activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    ...occupied.map((coordinate, index) => ({ id: `1:blocker-${index}`, troopId: 'steppe-lynx', owner: 1, coordinate, permanentDamage: 0 }))
  ], effects: [], bashes: [], lastActingTroopId: {} }, 1, { type: 'pass' }, cards);
  assert.equal(monarch.pendingResolution, undefined);
  assert.equal(monarch.activePlayer, 2);
});

test('a skipped Start trigger resumes the same normal turn and does not make its source inactive', () => {
  const state = { activePlayer: 2, phase: 'action', units: [
    { id: '1:frosthorn-yak', troopId: 'frosthorn-yak', owner: 1, coordinate: '-1,1', permanentDamage: 0 },
    { id: '1:raven-prince', troopId: 'raven-prince', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:mole-artificer', troopId: 'mole-artificer', owner: 2, coordinate: '-1,-1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [{ owner: 2, sourceTroopId: 'mole-artificer', kind: 'bomb', target: '1,1', value: 2, origin: '1,1' }], bashes: [], bombs: [], lastActingTroopId: {} };
  const started = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(started.pendingResolution?.kind, 'trigger-pull');
  assert.equal(started.pendingResolution?.resumeTurn, true);
  assert.ok(availableActionsFor(started, 1, 'frosthorn-yak', cards).some(action => action.type === 'resolve-pass'));

  const skipped = applyGameAction(started, 1, { type: 'resolve-pass', troopId: 'frosthorn-yak' }, cards);
  assert.equal(skipped.activePlayer, 1);
  assert.equal(skipped.phase, 'action');
  assert.equal(skipped.lastActingTroopId?.[1], undefined);
  assert.ok(availableActionsFor(skipped, 1, 'frosthorn-yak', cards).some(action => action.type === 'stun'));
  assert.equal(skipped.effects.some(effect => effect.kind === 'bomb'), true, 'the Start choice is not the response action that explodes the bomb');

  const acted = applyGameAction(skipped, 1, { type: 'stun', troopId: 'frosthorn-yak', coordinate: '0,1' }, cards);
  assert.equal(acted.effects.some(effect => effect.kind === 'bomb'), false);
  assert.equal(acted.units.find(unit => unit.id === '1:raven-prince')?.permanentDamage, 2, 'the bomb explodes when the real response action resolves');
  assert.equal(acted.lastActingTroopId?.[1], 'frosthorn-yak', 'only the true action makes the source inactive');
  assert.equal(acted.pendingResolution?.sourceTroopId, 'raven-prince');
  const finished = applyGameAction(acted, 1, { type: 'resolve-pass', troopId: 'raven-prince' }, cards);
  assert.equal(finished.activePlayer, 2);
});

test('Boar Warlord Start stride offers an optional one-hex move', () => {
  const state = { activePlayer: 2, phase: 'action', units: [
    { id: '1:boar-warlord', troopId: 'boar-warlord', owner: 1, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const started = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(started.pendingResolution?.kind, 'optional-move');
  const choices = availableActionsFor(started, 1, 'boar-warlord', cards);
  assert.ok(choices.some(action => action.type === 'resolve-move' && action.coordinate === '1,0'));
  assert.ok(choices.some(action => action.type === 'resolve-pass'));
});

test('dashboard stack instantiates a Squirrel King trigger as a nested action', () => {
  const state = { activePlayer: 1, phase: 'action', units: [
    { id: '1:squirrel-king', troopId: 'squirrel-king', owner: 1, coordinate: '1,2', permanentDamage: 1 },
    { id: '2:coastal-heron', troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, dashboard: [], resolutionStack: [], nextDashboardId: 1 };
  const next = applyGameAction(state, 1, { type: 'magic', troopId: 'squirrel-king', coordinate: '1,0' }, cards);
  const fire = next.dashboard.find(row => row.sourceUnitId === '1:squirrel-king' && row.action.kind === 'fire');
  const heal = next.dashboard.find(row => row.causedByTriggerId === 'squirrel-king:kindle');
  assert.ok(fire);
  assert.deepEqual(fire.targets, [{ hex: '1,0', units: [{ unitId: '2:coastal-heron', troopId: 'coastal-heron', owner: 2, health: 1 }] }]);
  assert.equal(heal.parentId, fire.id);
  assert.deepEqual(heal.action, { kind: 'heal', amount: 1, range: 0 });
  assert.deepEqual(heal.outcome, { healed: [{ unitId: '1:squirrel-king', amount: 1 }] });
  assert.equal(heal.status, 'resolved');
});

test('an optional trigger remains at the LIFO pointer above its End phase and parent action', () => {
  const state = { activePlayer: 1, phase: 'action', units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, dashboard: [], resolutionStack: [], nextDashboardId: 1 };
  const pending = applyGameAction(state, 1, { type: 'pass' }, cards);
  const current = pending.dashboard.find(row => row.id === pending.currentEventId);
  assert.equal(current.causedByTriggerId, 'wandering-monarch:end-stride');
  assert.equal(current.status, 'waiting-input');
  assert.deepEqual(current.action, { kind: 'move', range: 1 });
  const parent = pending.dashboard.find(row => row.id === current.parentId);
  assert.equal(parent.action.kind, 'phase');
  assert.deepEqual(parent.action.type, ['end']);
  assert.equal(pending.resolutionStack.at(-1), current.id);
});

test('simultaneous triggers use the active player deck order before LIFO resolution', () => {
  const state = { activePlayer: 1, phase: 'action', deckOrder: { 1: ['raven-prince', 'wandering-monarch'] }, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:raven-prince', troopId: 'raven-prince', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, dashboard: [], resolutionStack: [], nextDashboardId: 1 };
  const pending = applyGameAction(state, 1, { type: 'pass' }, cards);
  assert.equal(pending.pendingResolution.sourceTroopId, 'raven-prince');
  assert.equal(pending.dashboard.find(row => row.id === pending.currentEventId).causedByTriggerId, 'raven-prince:dusk-stun');
  assert.equal(pending.pendingResolutionQueue[0].sourceTroopId, 'wandering-monarch');
});

test('block and self block remain available without an existing threat', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const actions = availableActionsFor(state, 1, 'wandering-monarch', cards);
  assert.ok(!actions.some(action => action.type === 'defense' && action.coordinate === '2,2'), 'an enemy troop cannot receive a shield');
  assert.ok(!actions.some(action => action.type === 'defense' && action.coordinate === '0,2'), 'an empty hex cannot receive a shield');
  assert.ok(actions.some(action => action.type === 'self-defense'), 'self block is available before an attack exists');
});

test('Wandering Monarch carries its owner’s destination-hex shield into its End bash', () => {
  const state = { activePlayer: 1, phase: 'action', units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0, shields: [{ value: 2, sourceUnitId: '1:iron-armadillo' }] },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = { ...state, phase: 'end', pendingResolution: { owner: 1, turnPlayer: 1, sourceUnitId: '1:wandering-monarch', sourceTroopId: 'wandering-monarch', kind: 'optional-move', distance: 1 } };
  assert.equal(shielded.pendingResolution?.kind, 'optional-move');
  const bashed = applyGameAction(shielded, 1, { type: 'resolve-move', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.equal(combatSummary(bashed, '1:wandering-monarch', cards, '2,2').modifiers.some(entry => entry.label === 'Shield' && entry.value === 2), true);
  assert.equal(combatSummary(bashed, '2:marsh-badger', cards, '2,2').modifiers.some(entry => entry.label === 'Shield'), false, 'the shield belongs to its caster, not the enemy already on the hex');
  const resolved = applyGameAction(bashed, 2, { type: 'pass' }, cards);
  assert.ok(resolved.units.some(unit => unit.id === '1:wandering-monarch'), 'the shield changes the bash outcome and saves the Monarch');
  assert.equal(resolved.units.some(unit => unit.id === '2:marsh-badger'), false);
  assert.equal(resolved.units.find(unit => unit.id === '1:wandering-monarch')?.shields, undefined, 'the bash consumes the troop shields');
});

test('Wandering Monarch self block follows it when its End move starts a bash', () => {
  const state = { activePlayer: 1, phase: 'action', units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0, shields: [{ value: 1, sourceUnitId: '1:wandering-monarch' }] },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = { ...state, phase: 'end', pendingResolution: { owner: 1, turnPlayer: 1, sourceUnitId: '1:wandering-monarch', sourceTroopId: 'wandering-monarch', kind: 'optional-move', distance: 1 } };
  assert.deepEqual(shielded.units.find(unit => unit.id === '1:wandering-monarch')?.shields?.map(shield => shield.value), [1]);
  assert.equal(shielded.pendingResolution?.kind, 'optional-move');

  const bashed = applyGameAction(shielded, 1, { type: 'resolve-move', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.deepEqual(bashed.units.find(unit => unit.id === '1:wandering-monarch')?.shields?.map(shield => shield.value), [1], 'the shield follows the Monarch');
  assert.equal(combatSummary(bashed, '1:wandering-monarch', cards, '2,2').modifiers.some(entry => entry.label === 'Shield'), true, 'the followed shield protects the destination bash');
});
