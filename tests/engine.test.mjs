import assert from 'node:assert/strict';
import test from 'node:test';
import { troopSeeds } from '../game/cards.js';
import { applyGameAction, combatBreakdown, controlSummary, createGameState, dispatchTrigger, registerPassive, registerTimedPassive, runTimedPassives } from '../game/engine.js';

// The original tests predate the named card catalogue. Keep their scenario
// labels while resolving each one to the equivalent current card.
const legacyCardNames = {
  'p1-hero': 'tiger-queen', 'p1-1': 'ember-salamander', 'p1-2': 'desert-fox',
  'p1-3': 'queen-bee', 'p1-4': 'canyon-ibex', 'p1-5': 'marsh-badger',
  'p1-6': 'dune-scorpion', 'p1-7': 'snowy-owl', 'p2-hero': 'squirrel-king',
  'p2-1': 'cave-viper', 'p2-2': 'river-otter', 'p2-3': 'coastal-heron',
  'p2-4': 'desert-fox', 'p2-5': 'iron-armadillo', 'p2-7': 'highland-hawk'
};
const cards = new Map(troopSeeds.map(card => [card.id, card]));
for (const [legacyId, currentId] of Object.entries(legacyCardNames)) cards.set(legacyId, { ...cards.get(currentId), id: legacyId });
// Queen Bee supplies the legacy three-damage ranged profile, but this test
// fixture needs it to remain a non-hero deployment card.
cards.set('p1-3', { ...cards.get('p1-3'), role: 'troop', baseHealth: 3 });

test('a non-hero cannot be deployed before that player deploys a hero', () => {
  const state = createGameState();
  assert.throws(
    () => applyGameAction(state, 1, { type: 'deploy', troopId: 'p1-3', coordinate: '0,1' }, cards),
    /hero first/
  );
});

test('a hero can deploy into its controlled starting region and passes the turn', () => {
  const next = applyGameAction(createGameState(), 1, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' }, cards);
  assert.deepEqual(next.units, [{ id: '1:p1-hero', troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 }]);
  assert.equal(next.activePlayer, 2);
});

test('deployment works in each player’s controlled starting and intermediate regions', () => {
  const p1State = { activePlayer: 1, units: [{ troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
  const p1Next = applyGameAction(p1State, 1, { type: 'deploy', troopId: 'p1-1', coordinate: '0,1' }, cards);
  assert.equal(p1Next.units.some(unit => unit.troopId === 'p1-1'), true);

  const p2State = { activePlayer: 2, units: [{ troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
  const p2Next = applyGameAction(p2State, 2, { type: 'deploy', troopId: 'p2-3', coordinate: '0,-1' }, cards);
  assert.equal(p2Next.units.some(unit => unit.troopId === 'p2-3'), true);
});

test('middle and side intermediate regions calculate control independently', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 1, { type: 'deploy', troopId: 'p1-1', coordinate: '0,1' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'p1-1'), true);
});

test('a tied front line grants control to neither player and blocks front deployment', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 },
    { troopId: 'p1-7', owner: 1, coordinate: '-1,0', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 2, { type: 'deploy', troopId: 'p2-1', coordinate: '1,0' }, cards), /do not control/);
});

test('front deployment becomes legal after that player gains control', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'deploy', troopId: 'p2-1', coordinate: '1,0' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'p2-1'), true);
});

test('player 1 troop 6 deploys only into a controlled enemy intermediate region', () => {
  const controlledEnemyIntermediate = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'p1-3', owner: 1, coordinate: '0,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(controlledEnemyIntermediate, 1, { type: 'deploy', troopId: 'p1-6', coordinate: '0,-1' }, cards);
  assert.equal(next.units.some(unit => unit.troopId === 'p1-6'), true);

  const homeIntermediate = { ...controlledEnemyIntermediate, units: [{ troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 }] };
  assert.throws(() => applyGameAction(homeIntermediate, 1, { type: 'deploy', troopId: 'p1-6', coordinate: '0,1' }, cards), /do not control/);
});

test('Ironscale Rhino deploys only into a controlled enemy starting region', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '-1,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const deployed = applyGameAction(state, 1, { type: 'deploy', troopId: 'ironscale-rhino', coordinate: '-1,-3' }, cards);
  assert.equal(deployed.units.some(unit => unit.troopId === 'ironscale-rhino'), true);
});

test('Sahel Porcupine gains permanent ranged damage and range when it starts a bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bashed = applyGameAction(state, 1, { type: 'move', troopId: 'sahel-porcupine', coordinate: '1,0' }, cards);
  const porcupine = bashed.units.find(unit => unit.troopId === 'sahel-porcupine');
  assert.equal(porcupine?.rangedDamageBonus, 1);
  assert.equal(porcupine?.rangedRangeBonus, 1);

  const ranged = applyGameAction({ activePlayer: 1, units: [
    { troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0, rangedDamageBonus: 1, rangedRangeBonus: 1 },
    { troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} }, 1, { type: 'attack', troopId: 'sahel-porcupine', coordinate: '1,-1' }, cards);
  assert.equal(ranged.effects[0].value, 2);
});

test('Alps Lone Wolf gains +2 combat modifier while injured', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'alps-lone-wolf', owner: 1, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.equal(combatBreakdown(state, 'alps-lone-wolf', cards).modifier, 3);
});

test('ranged sword damage resolves after the defending player acts and becomes permanent', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [],
    bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards);
  assert.equal(attacked.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 0);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '-1,0' }, cards);
  // The magic-used trigger runs immediately after casting. The delayed
  // physical attack then resolves, with the front control modifier absorbing
  // one of its three damage.
  assert.equal(resolved.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 2);
});

test('magic does not cause permanent damage when it fails to kill', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-1', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
    ],
    effects: [],
    bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'p1-1', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '-1,-1' }, cards);
  const hero = resolved.units.find(unit => unit.troopId === 'p2-hero');
  assert.ok(hero);
  assert.equal(hero.permanentDamage, 0);
});

test('a troop that moves out of a magic target hex is not killed', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-1', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'p2-4', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const targeted = applyGameAction(state, 1, { type: 'magic', troopId: 'p1-1', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(targeted, 2, { type: 'move', troopId: 'p2-4', coordinate: '2,0' }, cards);
  const troop = resolved.units.find(unit => unit.troopId === 'p2-4');
  assert.equal(troop?.coordinate, '2,0');
  assert.ok(troop, 'moving out of the target hex dodges magic');
});

test('physical attack permanently injures and kills a troop when damage is sufficient', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-1', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'p2-1'), false);
});

test('a shield blocks physical attack damage before it resolves', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 0);
});

test('magic ignores shields and kills when current health is at or below its damage', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'p1-1', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '0,-1', permanentDamage: 2 },
      { troopId: 'p2-5', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'p1-1', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'defense', troopId: 'p2-5', coordinate: '0,-1' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'p2-hero'), false);
  assert.equal(resolved.winner, 1);
});

test('movement cannot enter the center hex or exceed the troop movement range', () => {
  const state = { activePlayer: 1, units: [{ troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 }], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '0,0' }, cards), /Invalid hex/);
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '-2,1' }, cards), /free path/);
});

test('movement cannot enter a hex occupied by a friendly troop', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p1-3', owner: 1, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards), /friendly troop/);
});

test('moving into an enemy hex creates a pending bash instead of overlapping units', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const next = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  assert.equal(next.units.filter(unit => unit.coordinate === '1,0').length, 1);
  assert.equal(next.bashes.length, 1);
});

test('move 2 requires a free complete path, not merely a target in range', () => {
  const blocked = { activePlayer: 1, units: [
    { troopId: 'p1-2', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p1-4', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(blocked, 1, { type: 'move', troopId: 'p1-2', coordinate: '1,0' }, cards), /free path/);
  const clear = { ...blocked, units: [blocked.units[0]] };
  const moved = applyGameAction(clear, 1, { type: 'move', troopId: 'p1-2', coordinate: '1,0' }, cards);
  assert.equal(moved.units[0].coordinate, '1,0');
});

test('every legal adjacent hex is reachable by a free move', () => {
  const legal = [];
  for (let x = -3; x <= 3; x += 1) for (let y = -4; y <= 4; y += 1) {
    if (x - y >= -3 && x - y <= 3 && !(x === 0 && y === 0)) legal.push(`${x},${y}`);
  }
  for (const source of legal) for (const target of legal) {
    const [sx, sy] = source.split(',').map(Number); const [tx, ty] = target.split(',').map(Number);
    const distance = Math.max(Math.abs(sx - tx), Math.abs(sy - ty), Math.abs((sx - sy) - (tx - ty)));
    if (distance !== 1) continue;
    const state = { activePlayer: 1, units: [{ troopId: 'p1-hero', owner: 1, coordinate: source, permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
    const moved = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: target }, cards);
    assert.equal(moved.units[0].coordinate, target, `${source} → ${target}`);
  }
});

test('enemy troops cannot be used as intermediate hexes for move 3', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-4', owner: 1, coordinate: '1,3', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'p2-1', owner: 2, coordinate: '0,3', permanentDamage: 0 },
    { troopId: 'p2-2', owner: 2, coordinate: '2,3', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,4', permanentDamage: 0 },
    { troopId: 'p2-4', owner: 2, coordinate: '2,4', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-4', coordinate: '1,0' }, cards), /free path/);
});
test('a defender can dodge a bash by moving away', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 1 },
    { troopId: 'p2-4', owner: 2, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  const dodged = applyGameAction(bash, 2, { type: 'move', troopId: 'p2-4', coordinate: '2,0' }, cards);
  const attacker = dodged.units.find(unit => unit.troopId === 'p1-hero');
  const defender = dodged.units.find(unit => unit.troopId === 'p2-4');
  assert.equal(attacker?.coordinate, '1,0');
  assert.equal(defender?.coordinate, '2,0');
  assert.equal(attacker?.permanentDamage, 1, 'a dodged bash does not injure the attacker');
  assert.equal(defender?.permanentDamage, 1, 'a dodged bash does not injure the defender');
  assert.equal(dodged.bashes.length, 0);
});

test('equal bash combat health removes both units', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-7', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-7', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'p2-3', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.length, 0);
});

test('a complete front-line bash state has tied control and no combat modifiers', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'p1-7', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [],
    bashes: [{ attackerId: 'p1-7', defenderId: 'p2-3', target: '1,0' }],
    lastActingTroopId: { 1: 'p1-7' }
  };
  const attacker = combatBreakdown(state, 'p1-7', cards, '1,0');
  const defender = combatBreakdown(state, 'p2-3', cards, '1,0');
  assert.deepEqual(attacker, { health: 1, modifier: 0, total: 1, controller: undefined });
  assert.deepEqual(defender, { health: 1, modifier: 0, total: 1, controller: undefined });
});

test('control is recalculated from the board after the defender adds a troop during a bash', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      // This represents Player 2's response before the bash resolves.
      { troopId: 'p2-2', owner: 2, coordinate: '2,0', permanentDamage: 0 }
    ], effects: [], bashes: [{ attackerId: 'p1-hero', defenderId: 'p2-hero', target: '1,0' }], lastActingTroopId: { 1: 'p1-hero' }
  };
  const attacker = combatBreakdown(state, 'p1-hero', cards, '1,0');
  const defender = combatBreakdown(state, 'p2-hero', cards, '1,0');
  assert.equal(attacker.controller, 2);
  assert.equal(defender.controller, 2);
  assert.equal(attacker.modifier, 0);
  assert.equal(defender.modifier, 1);
});

test('pending bash control includes the attacker at the contested hex', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [{ attackerId: '1:p1-hero', defenderId: '2:p2-hero', target: '1,0' }], lastActingTroopId: { 1: 'p1-hero' }
  };
  assert.equal(controlSummary(state, cards).front.controller, 1);
  assert.equal(combatBreakdown(state, 'p1-hero', cards, '1,0').modifier, 1);
});

test('control summary includes a pending bash away from the region representative hex', () => {
  const state = {
    activePlayer: 2,
    units: [
      { id: '1:p1-hero', troopId: 'p1-hero', owner: 1, coordinate: '-1,1', permanentDamage: 0 },
      { id: '2:p2-hero', troopId: 'p2-hero', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [{ attackerId: '1:p1-hero', defenderId: '2:p2-hero', target: '-1,0' }], lastActingTroopId: { 1: 'p1-hero' }
  };
  assert.equal(controlSummary(state, cards).front.controller, 1);
});

test('a shield changes bash combat and absorbs the winner injury', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-7', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-7', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'p1-7'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'p2-3')?.permanentDamage, 0);
});

test('a defender can block the hex of an ongoing bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  assert.doesNotThrow(() => applyGameAction(bash, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards));
});

test('a ranged attack can target the hex of an ongoing bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-7', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  assert.doesNotThrow(() => applyGameAction(bash, 2, { type: 'attack', troopId: 'p2-7', coordinate: '1,0' }, cards));
});

test('a second troop cannot start another bash on a contested hex', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:p1-hero', troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:p1-3', troopId: 'p1-3', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { id: '2:p2-hero', troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:p1-hero', defenderId: '2:p2-hero', target: '1,0' }], lastActingTroopId: { 1: 'p1-hero' } };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-3', coordinate: '1,0' }, cards), /bash is already happening/);
});

test('a bash winner takes permanent injury from the loser combat value after modifiers', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'p2-3', coordinate: '-1,0' }, cards);
  const hero = resolved.units.find(unit => unit.troopId === 'p1-hero');
  assert.equal(hero?.coordinate, '1,0');
  // Player 1 controls the contested hex (+1), which absorbs the loser's 1 combat value.
  assert.equal(hero?.permanentDamage, 0);
});
test('a shield expires after it resolves the opposing physical attack', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards);
  assert.equal(resolved.effects.length, 0);
});

test('self block creates exactly 1 shield on the acting troop hex', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'p1-3', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { troopId: 'p2-2', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'self-defense', troopId: 'p2-2' }, cards);
  assert.deepEqual(next.effects, [{ owner: 2, sourceTroopId: 'p2-2', sourceUnitId: '2:p2-2', kind: 'defense', target: '1,0', value: 1 }]);
  assert.equal(combatBreakdown(next, 'p2-2', cards).modifier, 1);
});

test('player 2 troop 2 receives +1 only when another troop shields it', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'p1-3', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { troopId: 'p2-2', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards);
  assert.equal(combatBreakdown(next, 'p2-2', cards).modifier, 4);
});

test('a shield expires after the opposing magic action resolves', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-1', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '0,-1', permanentDamage: 0 },
    { troopId: 'p2-5', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'p1-1', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'defense', troopId: 'p2-5', coordinate: '0,-1' }, cards);
  assert.equal(resolved.effects.length, 0);
});
test('player 1 troop 4 gains its +2 modifier when bashing', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-4', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-3', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'p1-4', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'p2-3', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'p2-3'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'p1-4')?.coordinate, '1,0');
});

test('player 1 troop 5 loses one shield modifier when shielded', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-5', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = applyGameAction(state, 1, { type: 'self-defense', troopId: 'p1-5' }, cards);
  assert.equal(combatBreakdown(shielded, 'p1-5', cards).modifier, 0);
});

test('Squirrel King does not heal when another troop acts', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 2 },
    { troopId: 'p2-5', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'defense', troopId: 'p2-5', coordinate: '1,0' }, cards);
  assert.equal(next.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 2);
});

test('Squirrel King heals after it personally uses magic and records the magic trigger', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '-1,-1', permanentDamage: 2 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const afterP1 = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  assert.equal(afterP1.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 2);
  const afterP2 = applyGameAction(afterP1, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '-1,0' }, cards);
  assert.equal(afterP2.units.find(unit => unit.troopId === 'p2-hero')?.permanentDamage, 1);
  assert.deepEqual(afterP2.triggerEvents?.slice(-5).map(event => event.trigger), ['magicUsed', 'end', 'opponentEnd', 'start', 'opponentStart']);
});

test('bash triggers expose attacker, defender, hex, and an exact retreating attacker', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-hero', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const observed = [];
  const removeAttack = registerPassive('bashAttack', 'p1-hero', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  const removeDefense = registerPassive('bashDefense', 'p2-hero', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  const removeBash = registerPassive('bash', 'p1-hero', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  let attackBonus = 0;
  const removeRetreat = registerPassive('bashRetreat', 'p1-hero', (_state, unit, event) => {
    if (event.attackerId === `${unit.owner}:${unit.troopId}`) attackBonus += 1;
  });
  const pending = applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(pending, 2, { type: 'move', troopId: 'p2-hero', coordinate: '2,0' }, cards);
  removeAttack(); removeDefense(); removeBash(); removeRetreat();
  assert.deepEqual(observed, [
    ['bashAttack', 'p1-hero', '1,0', '1:p1-hero', '2:p2-hero'],
    ['bashDefense', 'p2-hero', '1,0', '1:p1-hero', '2:p2-hero'],
    ['bash', 'p1-hero', '1,0', '1:p1-hero', '2:p2-hero']
  ]);
  assert.equal(attackBonus, 1, 'a retreat trigger applies only to the exact attacking troop');
  assert.deepEqual(resolved.triggerEvents?.filter(event => event.trigger === 'bashRetreat')[0], {
    trigger: 'bashRetreat', player: 1, hex: '1,0', troopIds: ['1:p1-hero', '2:p2-hero'], attackerId: '1:p1-hero', defenderId: '2:p2-hero'
  });
});

test('future passives can be registered through the start/end dispatcher', () => {
  const state = createGameState();
  state.units.push({ troopId: 'p1-7', owner: 1, coordinate: '1,0', permanentDamage: 1 });
  const unregister = registerTimedPassive('start', 'p1-7', (_state, unit) => { unit.permanentDamage = 0; });
  runTimedPassives(state, 1, 'start', cards);
  unregister();
  assert.equal(state.units[0].permanentDamage, 0);
});

test('timed passives resolve hero first, then troop order, for the active player', () => {
  const state = createGameState();
  state.units.push(
    { troopId: 'p2-5', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  );
  const order = [];
  const removeHero = registerTimedPassive('end', 'p2-hero', () => { order.push('hero'); });
  const removeTroop = registerTimedPassive('end', 'p2-5', () => { order.push('troop'); });
  runTimedPassives(state, 2, 'end', cards, 'p2-3');
  removeHero(); removeTroop();
  assert.deepEqual(order, ['hero', 'troop']);
});
test('a troop cannot act on two consecutive turns', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'p1-3', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'p2-hero', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const p1Turn = applyGameAction(state, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards);
  const p2Turn = applyGameAction(p1Turn, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '-1,0' }, cards);
  assert.throws(() => applyGameAction(p2Turn, 1, { type: 'attack', troopId: 'p1-3', coordinate: '1,0' }, cards), /previous turn/);
});
test('defeated troops cannot be redeployed', () => {
  const state = createGameState();
  state.defeatedTroopIds.push('2:p2-1');
  state.activePlayer = 2;
  state.units.push({ troopId: 'p2-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 });
  assert.throws(() => applyGameAction(state, 2, { type: 'deploy', troopId: 'p2-1', coordinate: '1,0' }, cards), /unavailable/);
});

test('invalid actions leave the authoritative state unchanged', () => {
  const state = createGameState();
  const before = structuredClone(state);
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'p1-hero', coordinate: '1,0' }, cards), /not deployed/);
  assert.deepEqual(state, before);
});

test('accepted actions append revisioned events suitable for reconnecting clients', () => {
  const next = applyGameAction(createGameState(), 1, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' }, cards);
  assert.equal(next.revision, 1);
  assert.deepEqual(next.events, [{ revision: 1, player: 1, action: { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' } }]);
  assert.deepEqual(next.defeatedTroopIds, []);
});

test('flight ignores intervening troops but cannot land in the central hex', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'cinder-heron', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '0,2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const flown = applyGameAction(state, 1, { type: 'fly', troopId: 'cinder-heron', coordinate: '-1,1' }, cards);
  assert.equal(flown.units.find(unit => unit.troopId === 'cinder-heron')?.coordinate, '-1,1');
  assert.throws(() => applyGameAction(state, 1, { type: 'fly', troopId: 'cinder-heron', coordinate: '0,0' }, cards), /Invalid hex/);
});

test('cannon applies physical damage to every hex in its selected straight line', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'walnut-crab', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'p1-3', owner: 1, coordinate: '0,2', permanentDamage: 0 },
      { troopId: 'p1-hero', owner: 1, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'p2-1', owner: 2, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'p2-7', owner: 2, coordinate: '-1,0', permanentDamage: 0 },
      { troopId: 'p2-hero', owner: 2, coordinate: '-2,-2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '-1,0' }, cards);
  assert.deepEqual(fired.effects.filter(effect => effect.kind === 'cannon').map(effect => effect.target), ['0,1', '-1,0']);
  const resolved = applyGameAction(fired, 2, { type: 'magic', troopId: 'p2-hero', coordinate: '1,1' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'p2-1')?.permanentDamage, 1);
  assert.equal(resolved.units.find(unit => unit.troopId === 'p2-7')?.permanentDamage, 1);
  assert.throws(() => applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '0,0' }, cards), /Invalid hex/);
});

test('cannon can fire across the central gap to a legal hex beyond it', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'coconut-crab', owner: 1, coordinate: '0,-2', permanentDamage: 0 },
    { troopId: 'cinder-heron', owner: 2, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'coconut-crab', coordinate: '0,1' }, cards);
  assert.deepEqual(fired.effects.filter(effect => effect.kind === 'cannon').map(effect => effect.target), ['0,-1', '0,0', '0,1']);
});

test('temples are immobile, Spring Temple mends allies, and it cannot mend an enemy', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'spring-temple', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'canyon-ibex', owner: 1, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'spring-temple', coordinate: '1,0' }, cards), /free path/);
  const mended = applyGameAction(state, 1, { type: 'mending', troopId: 'spring-temple', coordinate: '1,0' }, cards);
  assert.equal(mended.units.find(unit => unit.troopId === 'canyon-ibex')?.permanentDamage, 0);

  const enemyTarget = { ...state, units: [
    state.units[0], { troopId: 'canyon-ibex', owner: 2, coordinate: '1,0', permanentDamage: 1 }
  ] };
  assert.throws(() => applyGameAction(enemyTarget, 1, { type: 'mending', troopId: 'spring-temple', coordinate: '1,0' }, cards), /friendly troop/);
});

test('Oracle Temple upgrades the chosen ability once, but never another temple', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'oracle-temple', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'steppe-lynx', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'cave-viper', owner: 2, coordinate: '1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const upgraded = applyGameAction(state, 1, { type: 'upgrade', troopId: 'oracle-temple', coordinate: '1,0', ability: 'attack' }, cards);
  assert.deepEqual(upgraded.units.find(unit => unit.troopId === 'steppe-lynx')?.upgrades, [{ ability: 'attack', left: 1, right: 0, sourceUnitId: '1:oracle-temple' }]);
  const afterPass = applyGameAction(upgraded, 2, { type: 'pass' }, cards);
  const attack = applyGameAction(afterPass, 1, { type: 'attack', troopId: 'steppe-lynx', coordinate: '1,-1' }, cards);
  assert.equal(attack.effects[0]?.value, 4, 'the +1 affects the selected attack value');
  const resolved = applyGameAction(attack, 2, { type: 'pass' }, cards);
  assert.deepEqual(resolved.units.find(unit => unit.troopId === 'steppe-lynx')?.upgrades, [], 'a delayed attack spends its upgrade after resolution');
  assert.throws(() => applyGameAction(state, 1, { type: 'upgrade', troopId: 'oracle-temple', coordinate: '1,1', ability: 'mending' }, cards), /temple cannot be upgraded/);
});

test('“bonus if condition” effects are calculated live and disappear with the condition', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:canyon-ibex', troopId: 'canyon-ibex', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:war-temple', troopId: 'war-temple', owner: 1, coordinate: '3,0', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:canyon-ibex', defenderId: '2:marsh-badger', target: '1,0' }], lastActingTroopId: { 1: 'canyon-ibex' } };
  assert.equal(combatBreakdown(state, '1:canyon-ibex', cards, '1,0').modifier, 3, 'Ibex +2 and War Temple +1 apply only during its bash');
  const noBash = { ...state, bashes: [] };
  assert.equal(combatBreakdown(noBash, '1:canyon-ibex', cards).modifier, 1, 'neither bash-only bonus is stored after the condition ends');
});

test('event triggers fire once per event and their bonuses accumulate', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:sahel-porcupine', troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const event = { trigger: 'bashAttack', player: 1, hex: '1,0', troopIds: ['1:sahel-porcupine', '2:squirrel-king'], attackerId: '1:sahel-porcupine', defenderId: '2:squirrel-king' };
  dispatchTrigger(state, event, cards, [1]);
  dispatchTrigger(state, event, cards, [1]);
  const porcupine = state.units[0];
  assert.equal(porcupine.rangedDamageBonus, 2);
  assert.equal(porcupine.rangedRangeBonus, 2);
  const attack = applyGameAction(state, 1, { type: 'attack', troopId: 'sahel-porcupine', coordinate: '1,-1' }, cards);
  assert.equal(attack.effects[0]?.value, 3, 'both fired triggers permanently improve this match’s ranged attack');
});

test('Canyon Hawk steady reduces only its bash opponent’s modifier to zero on attack and defense', () => {
  const hawkAttacking = { activePlayer: 2, units: [
    { id: '1:canyon-hawk', troopId: 'canyon-hawk', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:alps-lone-wolf', troopId: 'alps-lone-wolf', owner: 2, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [{ attackerId: '1:canyon-hawk', defenderId: '2:alps-lone-wolf', target: '1,0' }], lastActingTroopId: { 1: 'canyon-hawk' } };
  assert.equal(combatBreakdown(hawkAttacking, '1:canyon-hawk', cards, '1,0').modifier, 1, 'Steady leaves the Hawk’s own control modifier intact');
  assert.equal(combatBreakdown(hawkAttacking, '2:alps-lone-wolf', cards, '1,0').modifier, 0, 'Steady suppresses the defender’s injured bonus');
  const shieldedHawkAttack = { ...hawkAttacking, effects: [{ owner: 2, sourceTroopId: 'iron-armadillo', kind: 'defense', target: '1,0', value: 3 }] };
  assert.equal(combatBreakdown(shieldedHawkAttack, '2:alps-lone-wolf', cards, '1,0').modifier, 0, 'Steady also suppresses a confirmed shield');

  const hawkDefending = { activePlayer: 1, units: [
    { id: '1:canyon-hawk', troopId: 'canyon-hawk', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:canyon-ibex', troopId: 'canyon-ibex', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '2:canyon-ibex', defenderId: '1:canyon-hawk', target: '1,0' }], lastActingTroopId: { 2: 'canyon-ibex' } };
  assert.equal(combatBreakdown(hawkDefending, '2:canyon-ibex', cards, '1,0').modifier, 0, 'Steady also suppresses the attacking Ibex bash bonus');
});
