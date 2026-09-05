import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState } from "../dist/game/engine.js";
import { createEngineCards } from "./helpers/engine-fixture.mjs";

const { cards, catalogueCards, troopSeeds } = createEngineCards();

test('a non-hero cannot be deployed before that player deploys a hero', () => {
  const state = createGameState();
  assert.throws(
    () => applyGameAction(state, 1, { type: 'deploy', troopId: 'queen-bee', coordinate: '0,1' }, cards),
    /hero first/
  );
});

test('a hero can deploy into its controlled starting region and passes the turn', () => {
  const next = applyGameAction(createGameState(), 1, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' }, cards);
  assert.deepEqual(next.units, [{ id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0, inactiveOnTurn: 0 }]);
  assert.equal(next.activePlayer, 2);
});

test('deployment works in each player’s controlled starting and intermediate regions', () => {
  const p1State = { activePlayer: 1, units: [{ troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
  const p1Next = applyGameAction(p1State, 1, { type: 'deploy', troopId: 'ember-salamander', coordinate: '0,1' }, cards);
  assert.equal(p1Next.units.some(unit => unit.troopId === 'ember-salamander'), true);

  const p2State = { activePlayer: 2, units: [{ troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
  const p2Next = applyGameAction(p2State, 2, { type: 'deploy', troopId: 'coastal-heron', coordinate: '0,-1' }, cards);
  assert.equal(p2Next.units.some(unit => unit.troopId === 'coastal-heron'), true);
});

test('Moss Tortoise deploys into a controlled intermediate region after its hero', () => {
  const state = {
    activePlayer: 1,
    units: [{ troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const next = applyGameAction(state, 1, { type: 'deploy', troopId: 'moss-tortoise', coordinate: '0,1' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'moss-tortoise' && unit.coordinate === '0,1'), true);
});

test('middle and side intermediate regions calculate control independently', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 1, { type: 'deploy', troopId: 'ember-salamander', coordinate: '0,1' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'ember-salamander'), true);
});

test('Control X adds a fixed regional contribution independently of current health', () => {
  const controlCards = new Map(cards);
  controlCards.set('control-standard', {
    id: 'control-standard', name: 'Control Standard', role: 'troop', baseHealth: 3,
    deploymentRegions: ['front'], actions: [], control: 2
  });
  const state = { activePlayer: 1, units: [
    { id: '1:control-standard', troopId: 'control-standard', owner: 1, coordinate: '1,0', permanentDamage: 2 },
    { id: '2:phoenix-moth', troopId: 'phoenix-moth', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const front = controlSummary(state, controlCards).front;
  assert.equal(front.playerOne, 3, '1 current health plus Control 2 contributes 3');
  assert.equal(front.playerTwo, 2);
  assert.equal(front.controller, 1);
});

test('a tied front line grants control to neither player and blocks front deployment', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 },
    { troopId: 'snowy-owl', owner: 1, coordinate: '-1,0', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 2, { type: 'deploy', troopId: 'cave-viper', coordinate: '1,0' }, cards), /do not control/);
});

test('front deployment becomes legal after that player gains control', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'deploy', troopId: 'cave-viper', coordinate: '1,0' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'cave-viper'), true);
});

test('Dune Scorpion deploys only into a controlled enemy intermediate region', () => {
  const controlledEnemyIntermediate = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'queen-bee', owner: 1, coordinate: '0,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(controlledEnemyIntermediate, 1, { type: 'deploy', troopId: 'dune-scorpion', coordinate: '0,-1' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'dune-scorpion'), true);

  const homeIntermediate = { ...controlledEnemyIntermediate, units: [{ troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }] };
  assert.throws(() => applyGameAction(homeIntermediate, 1, { type: 'deploy', troopId: 'dune-scorpion', coordinate: '0,1' }, cards), /do not control/);
});

test('Duelist Scorpion resolves its enemy-side deploy trigger after entering the destination hex', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'queen-bee', owner: 1, coordinate: '0,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 1, { type: 'deploy', troopId: 'duelist-scorpion', coordinate: '0,-1' }, cards);
  const duelist = next.units.find(unit => unit.troopId === 'duelist-scorpion');

  assert.deepEqual(duelist?.shields?.map(shield => shield.value), [3]);
  assert.equal(duelist?.magicModifierBonus, 3);
  assert.deepEqual(next.normalizedEvents?.at(-1)?.object, { kind: 'hex', coordinate: '0,-1' });
});

test('Ironscale Rhino deploys only into a controlled enemy starting region', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '-1,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const deployed = applyGameAction(state, 1, { type: 'deploy', troopId: 'ironscale-rhino', coordinate: '-1,-3' }, cards);
  assert.equal(deployed.units.some(unit => unit.troopId === 'ironscale-rhino'), true);
});

test('every catalogue card has at least one rule-compliant deployment state', () => {
  for (const troop of troopSeeds) {
    let coordinate;
    let supportingHeroCoordinate;
    if (troop.deploymentRule === 'enemy-region' && troop.deploymentRegions.includes('starting')) {
      coordinate = '-1,-3';
      supportingHeroCoordinate = '-1,-2';
    } else if (troop.deploymentRule === 'enemy-region') {
      coordinate = '0,-1';
      supportingHeroCoordinate = '0,-2';
    } else if (troop.deploymentRegions.includes('front')) {
      coordinate = '1,0';
      supportingHeroCoordinate = '2,0';
    } else if (troop.deploymentRegions.includes('starting')) {
      coordinate = '1,2';
      supportingHeroCoordinate = '1,3';
    } else {
      coordinate = '0,1';
      supportingHeroCoordinate = '1,2';
    }
    const state = {
      activePlayer: 1,
      units: troop.role === 'hero' ? [] : [
        { troopId: 'tiger-queen', owner: 1, coordinate: supportingHeroCoordinate, permanentDamage: 0 }
      ],
      effects: [],
      bashes: [],
      lastActingTroopId: {}
    };
    const legalDeployments = availableActionsFor(state, 1, troop.id, catalogueCards);
    assert.ok(
      legalDeployments.some(action => action.type === 'deploy' && action.coordinate === coordinate),
      `${troop.name ?? troop.id} should be deployable at ${coordinate}`
    );
    const deployed = applyGameAction(state, 1, { type: 'deploy', troopId: troop.id, coordinate }, catalogueCards);
    assert.ok(deployed.units.some(unit => unit.troopId === troop.id && unit.coordinate === coordinate));
  }
});
