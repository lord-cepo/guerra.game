import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState } from "../dist/game/engine.js";
import { createEngineCards } from "./helpers/engine-fixture.mjs";

const { cards, catalogueCards, troopSeeds } = createEngineCards();

test('Sahel Porcupine gains permanent ranged damage and range when it starts a bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bashed = applyGameAction(state, 1, { type: 'move', troopId: 'sahel-porcupine', coordinate: '1,0' }, cards);
  const porcupine = bashed.units.find(unit => unit.troopId === 'sahel-porcupine');
  assert.equal(porcupine?.rangedDamageBonus, 1);
  assert.equal(porcupine?.rangedRangeBonus, 1);

  const ranged = applyGameAction({ activePlayer: 1, units: [
    { troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0, rangedDamageBonus: 1, rangedRangeBonus: 1 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
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
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [],
    bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  assert.equal(attacked.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 0);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,0' }, cards);
  // The magic-used trigger runs immediately after casting. The delayed
  // physical attack then resolves, with the front control modifier absorbing
  // one of its three damage.
  assert.equal(resolved.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 2);
});

test('a defender moving away dodges a delayed ranged attack', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'desert-fox', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'move', troopId: 'desert-fox', coordinate: '2,0' }, cards);
  const defender = resolved.units.find(unit => unit.troopId === 'desert-fox');
  assert.equal(defender?.coordinate, '2,0');
  assert.equal(defender?.permanentDamage, 0);
});

test('a delayed ranged attack does not hit a replacement troop on the target hex', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'desert-fox', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'river-otter', owner: 2, coordinate: '2,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  // Model a legal response sequence that vacates the original target and
  // leaves a different unit on that hex before delayed effects resolve.
  attacked.units.find(unit => unit.troopId === 'desert-fox').coordinate = '2,0';
  attacked.units.find(unit => unit.troopId === 'river-otter').coordinate = '1,0';
  const resolved = applyGameAction(attacked, 2, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'desert-fox')?.permanentDamage, 0);
  assert.equal(resolved.units.find(unit => unit.troopId === 'river-otter')?.permanentDamage, 0);
});

test('magic does not cause permanent damage when it fails to kill', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
    ],
    effects: [],
    bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,-1' }, cards);
  const hero = resolved.units.find(unit => unit.troopId === 'squirrel-king');
  assert.ok(hero);
  assert.equal(hero.permanentDamage, 0);
});

test('magic modifier prevents a lethal magic attack and is consumed by that attack', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '0,-1', permanentDamage: 1, magicModifierBonus: 1 }
    ],
    effects: [],
    bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,-1' }, cards);
  const hero = resolved.units.find(unit => unit.troopId === 'squirrel-king');
  assert.ok(hero);
  assert.equal(hero.magicModifierBonus, undefined);
  assert.equal(hero.permanentDamage, 0, 'the modifier prevents the hit and Squirrel King then heals its existing damage after using Magic');
});

test('a troop that moves out of a magic target hex is not killed', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'desert-fox', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const targeted = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(targeted, 2, { type: 'move', troopId: 'desert-fox', coordinate: '2,0' }, cards);
  const troop = resolved.units.find(unit => unit.troopId === 'desert-fox');
  assert.equal(troop?.coordinate, '2,0');
  assert.ok(troop, 'moving out of the target hex dodges magic');
});

test('a troop that starts a bash dodges magic aimed at the hex it left', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'canyon-ibex', owner: 2, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 1, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: {}
  };
  const targeted = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,1' }, cards);
  const bashStarted = applyGameAction(targeted, 2, { type: 'move', troopId: 'canyon-ibex', coordinate: '1,0' }, cards);
  assert.ok(bashStarted.units.some(unit => unit.troopId === 'canyon-ibex'), 'the Ibex dodges magic by entering the bash');
  assert.equal(bashStarted.bashes.length, 1, 'the bash remains for Squirrel King’s response');

  const resolved = applyGameAction(bashStarted, 1, { type: 'pass' }, cards);
  const squirrel = resolved.units.find(unit => unit.troopId === 'squirrel-king');
  assert.ok(squirrel, 'the bash resolves instead of being cancelled by the dodged magic');
  assert.equal(squirrel.permanentDamage, 2, 'the Ibex bash applies its combat damage before being removed');
  assert.equal(resolved.units.some(unit => unit.troopId === 'canyon-ibex'), false);
});

test('physical attack permanently injures and kills a troop when damage is sufficient', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'cave-viper', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'cave-viper'), false);
});

test('a shield blocks physical attack damage before it resolves', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 0);
});

test('Titanium rejects delayed physical attacks without consuming shields', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'iron-bell-golem', owner: 2, coordinate: '1,0', permanentDamage: 0, shields: [{ value: 2 }] },
      { troopId: 'ember-salamander', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'ember-salamander', coordinate: '-1,1' }, cards);
  const titanium = resolved.units.find(unit => unit.troopId === 'iron-bell-golem');
  assert.equal(titanium?.permanentDamage, 0);
  assert.deepEqual(titanium?.shields, [{ value: 2 }]);
});

test('a normalized stored Titanium contribution is authoritative for damage', () => {
  const state = {
    activePlayer: 1,
    units: [
      { id: '1:queen-bee', troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { id: '2:ember-salamander', troopId: 'ember-salamander', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
    ], effects: [], bashes: [], ruleContributions: [{
      id: 1, sourceRuleId: 'test', sourceUnitId: '2:squirrel-king', targetUnitId: '2:squirrel-king',
      property: { name: 'titanium', parameters: [] }, lifetime: { kind: 'permanent' }, createdByEventId: 1
    }]
  };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'magic', troopId: 'ember-salamander', coordinate: '-1,1' }, cards);
  assert.equal(resolved.units.find(unit => unit.id === '2:squirrel-king')?.permanentDamage, 0);
});

test('Titanium deals bash damage without receiving it and keeps the bash pending when both survive', () => {
  cards.set('titanium-test', { id: 'titanium-test', name: 'Titanium Test', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: [{ kind: 'move', range: 1 }], passives: ['titanium'] });
  const state = {
    activePlayer: 1,
    units: [
      { id: '1:titanium-test', troopId: 'titanium-test', owner: 1, coordinate: '1,1', permanentDamage: 0, shields: [{ value: 1, sourceUnitId: '1:titanium-test' }] },
      { id: '2:queen-bee', troopId: 'queen-bee', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ], effects: [], bashes: [], lastActingTroopId: {}
  };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'titanium-test', coordinate: '1,0' }, cards);
  const afterEnd = applyGameAction(bash, 2, { type: 'pass' }, cards);
  const resolved = applyGameAction(afterEnd, 1, { type: 'pass' }, cards);
  const titanium = resolved.units.find(unit => unit.troopId === 'titanium-test');
  const defender = resolved.units.find(unit => unit.troopId === 'queen-bee');
  assert.equal(titanium?.permanentDamage, 0);
  assert.deepEqual(titanium?.shields, [{ value: 1, sourceUnitId: '1:titanium-test' }]);
  assert.ok((defender?.permanentDamage ?? 0) > 0);
  assert.equal(resolved.bashes.length, 1);
  assert.equal(resolved.bashes[0].awaitingEnd, undefined, 'the retained bash is ready again after the resolving turn End');
});

test('two Titanium troops exchange no bash damage and remain pending', () => {
  cards.set('titanium-test', { id: 'titanium-test', name: 'Titanium Test', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: [{ kind: 'move', range: 1 }], passives: ['titanium'] });
  const state = { activePlayer: 1, units: [
    { id: '1:titanium-test', troopId: 'titanium-test', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:iron-bell-golem', troopId: 'iron-bell-golem', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'titanium-test', coordinate: '1,0' }, cards);
  const afterEnd = applyGameAction(bash, 2, { type: 'pass' }, cards);
  const resolved = applyGameAction(afterEnd, 1, { type: 'pass' }, cards);
  assert.deepEqual(resolved.units.map(unit => unit.permanentDamage), [0, 0]);
  assert.equal(resolved.bashes.length, 1);
});

test('Obsidian rejects delayed magic without consuming its magic modifier', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'obsidian-lizard', owner: 2, coordinate: '0,-1', permanentDamage: 0, magicModifierBonus: 2 },
      { troopId: 'queen-bee', owner: 2, coordinate: '2,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'attack', troopId: 'queen-bee', coordinate: '-1,-1' }, cards);
  const obsidian = resolved.units.find(unit => unit.troopId === 'obsidian-lizard');
  assert.equal(obsidian?.permanentDamage, 0);
  assert.equal(obsidian?.magicModifierBonus, 2);
});

test('magic ignores shields and kills when current health is at or below its damage', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '0,-1', permanentDamage: 2 },
      { troopId: 'iron-armadillo', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
    ], effects: [], bashes: []
  };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '0,-1' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'squirrel-king'), false);
  assert.equal(resolved.winner, 1);
});

test('movement cannot enter the center hex or exceed the troop movement range', () => {
  const state = { activePlayer: 1, units: [{ troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 }], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '0,0' }, cards), /Invalid hex/);
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '-3,0' }, cards), /free path/);
});

test('movement cannot enter a hex occupied by a friendly troop', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'queen-bee', owner: 1, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards), /friendly troop/);
});

test('moving into an enemy hex stores both bash participants on the contested hex', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const next = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.equal(next.units.filter(unit => unit.coordinate === '1,0').length, 2);
  assert.equal(next.units.some(unit => unit.coordinate === '1,1'), false, 'the attacker vacates its origin immediately');
  assert.equal(next.bashes.length, 1);
});

test('Fast resolves a newly announced Bash in the creating action combat window', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'fast-test', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'canyon-ibex', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const resolved = applyGameAction(state, 1, { type: 'move', troopId: 'fast-test', coordinate: '1,0' }, cards);
  assert.equal(resolved.bashes.length, 0);
  assert.equal(resolved.units.some(unit => unit.troopId === 'canyon-ibex'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'fast-test')?.coordinate, '1,0');
});

test('another troop can enter a bash attacker’s vacated origin without starting a false bash', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:sahel-porcupine', troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '2,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const pending = applyGameAction(state, 1, { type: 'move', troopId: 'sahel-porcupine', coordinate: '1,0' }, cards);
  assert.equal(pending.units.find(unit => unit.troopId === 'sahel-porcupine')?.coordinate, '1,0');
  const response = applyGameAction(pending, 2, { type: 'move', troopId: 'squirrel-king', coordinate: '1,1' }, cards);
  assert.equal(response.units.find(unit => unit.troopId === 'squirrel-king')?.coordinate, '1,1');
  assert.equal(response.bashes.length, 0, 'only the original bash resolves; no bash is created at the vacated origin');
});

test('move 2 requires a free complete path, not merely a target in range', () => {
  const blocked = { activePlayer: 1, units: [
    { troopId: 'desert-fox', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'canyon-ibex', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  assert.throws(() => applyGameAction(blocked, 1, { type: 'move', troopId: 'desert-fox', coordinate: '1,0' }, cards), /free path/);
  const clear = { ...blocked, units: [blocked.units[0]] };
  const moved = applyGameAction(clear, 1, { type: 'move', troopId: 'desert-fox', coordinate: '1,0' }, cards);
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
    const state = { activePlayer: 1, units: [{ troopId: 'tiger-queen', owner: 1, coordinate: source, permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
    const moved = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: target }, cards);
    assert.equal(moved.units[0].coordinate, target, `${source} → ${target}`);
  }
});

test('enemy troops cannot be used as intermediate hexes for move 3', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'canyon-ibex', owner: 1, coordinate: '1,3', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,2', permanentDamage: 0 },
    { troopId: 'cave-viper', owner: 2, coordinate: '0,3', permanentDamage: 0 },
    { troopId: 'river-otter', owner: 2, coordinate: '2,3', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,4', permanentDamage: 0 },
    { troopId: 'desert-fox', owner: 2, coordinate: '2,4', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'canyon-ibex', coordinate: '1,0' }, cards), /free path/);
});
test('a defender can dodge a bash by moving away', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 1 },
    { troopId: 'desert-fox', owner: 2, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  const dodged = applyGameAction(bash, 2, { type: 'move', troopId: 'desert-fox', coordinate: '2,0' }, cards);
  const attacker = dodged.units.find(unit => unit.troopId === 'tiger-queen');
  const defender = dodged.units.find(unit => unit.troopId === 'desert-fox');
  assert.equal(attacker?.coordinate, '1,0');
  assert.equal(defender?.coordinate, '2,0');
  assert.equal(attacker?.permanentDamage, 1, 'a dodged bash does not injure the attacker');
  assert.equal(defender?.permanentDamage, 1, 'a dodged bash does not injure the defender');
  assert.equal(dodged.bashes.length, 0);
});

test('equal bash combat health removes both units', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'dune-scorpion', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'dune-scorpion', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'coastal-heron', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.length, 0);
});

test('First Strike damages the enemy before it can retaliate', () => {
  const firstStrikeCards = new Map(cards);
  firstStrikeCards.set('tiger-queen', { ...cards.get('tiger-queen'), passives: ['first-strike'] });
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'desert-fox', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, firstStrikeCards);
  const resolved = applyGameAction(bash, 2, { type: 'pass' }, firstStrikeCards);

  assert.ok(resolved.units.some(unit => unit.troopId === 'tiger-queen'));
  assert.equal(resolved.units.some(unit => unit.troopId === 'desert-fox'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen')?.permanentDamage, 0);
  assert.deepEqual(resolved.normalizedEvents?.find(event => event.name === 'bash' && event.stage === 'resolved')?.firstStrike, {
    unitId: '1:tiger-queen', targetId: '2:desert-fox', firstDamage: 6, retaliationDamage: 0, targetSurvived: false
  });
});

test('First Strike allows retaliation when the enemy survives the first hit', () => {
  const firstStrikeCards = new Map(cards);
  firstStrikeCards.set('steppe-lynx', { ...cards.get('steppe-lynx'), passives: ['first-strike'] });
  const state = { activePlayer: 1, units: [
    { troopId: 'steppe-lynx', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'tiger-queen', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [] };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'steppe-lynx', coordinate: '1,0' }, firstStrikeCards);
  const resolved = applyGameAction(bash, 2, { type: 'pass' }, firstStrikeCards);

  assert.equal(resolved.units.some(unit => unit.troopId === 'steppe-lynx'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen')?.permanentDamage, 2);
  assert.deepEqual(resolved.normalizedEvents?.find(event => event.name === 'bash' && event.stage === 'resolved')?.firstStrike, {
    unitId: '1:steppe-lynx', targetId: '2:tiger-queen', firstDamage: 2, retaliationDamage: 3, targetSurvived: true
  });
});

test('a complete front-line bash state has tied control and no combat modifiers', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'dune-scorpion', owner: 1, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [],
    bashes: [{ attackerId: 'dune-scorpion', defenderId: 'coastal-heron', target: '1,0' }],
    lastActingTroopId: { 1: 'dune-scorpion' }
  };
  const attacker = combatBreakdown(state, 'dune-scorpion', cards, '1,0');
  const defender = combatBreakdown(state, 'coastal-heron', cards, '1,0');
  assert.deepEqual(attacker, { health: 1, modifier: 0, total: 1, controller: undefined });
  assert.deepEqual(defender, { health: 1, modifier: 0, total: 1, controller: undefined });
});

test('control is recalculated from the board after the defender adds a troop during a bash', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      // This represents Player 2's response before the bash resolves.
      { troopId: 'river-otter', owner: 2, coordinate: '2,0', permanentDamage: 0 }
    ], effects: [], bashes: [{ attackerId: 'tiger-queen', defenderId: 'squirrel-king', target: '1,0' }], lastActingTroopId: { 1: 'tiger-queen' }
  };
  const attacker = combatBreakdown(state, 'tiger-queen', cards, '1,0');
  const defender = combatBreakdown(state, 'squirrel-king', cards, '1,0');
  assert.equal(attacker.controller, 2);
  assert.equal(defender.controller, 2);
  assert.equal(attacker.modifier, 0);
  assert.equal(defender.modifier, 1);
});

test('defender control is applied when a bash resolves after a reinforcement enters', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'dune-scorpion', owner: 1, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'river-otter', owner: 2, coordinate: '2,0', permanentDamage: 0 }
    ],
    effects: [],
    bashes: [{ attackerId: 'dune-scorpion', defenderId: 'coastal-heron', target: '1,0' }],
    lastActingTroopId: { 1: 'dune-scorpion' }
  };
  const resolved = applyGameAction(state, 2, { type: 'magic', troopId: 'coastal-heron', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'dune-scorpion'), false);
  assert.equal(resolved.units.some(unit => unit.troopId === 'coastal-heron'), true);
});

test('pending bash control includes the attacker at the contested hex', () => {
  const state = {
    activePlayer: 2,
    units: [
      { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [{ attackerId: '1:tiger-queen', defenderId: '2:squirrel-king', target: '1,0' }], lastActingTroopId: { 1: 'tiger-queen' }
  };
  assert.equal(controlSummary(state, cards).front.controller, 1);
  assert.equal(combatBreakdown(state, 'tiger-queen', cards, '1,0').modifier, 1);
});

test('control summary includes a pending bash away from the region representative hex', () => {
  const state = {
    activePlayer: 2,
    units: [
      { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '-1,1', permanentDamage: 0 },
      { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
    ],
    effects: [], bashes: [{ attackerId: '1:tiger-queen', defenderId: '2:squirrel-king', target: '-1,0' }], lastActingTroopId: { 1: 'tiger-queen' }
  };
  assert.equal(controlSummary(state, cards).front.controller, 1);
});

test('a shield changes bash combat and absorbs the winner injury', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'snowy-owl', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'snowy-owl', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'snowy-owl'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'coastal-heron')?.permanentDamage, 0);
});

test('a defender can block the hex of an ongoing bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.doesNotThrow(() => applyGameAction(bash, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards));
});

test('a ranged attack can target the hex of an ongoing bash', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'highland-hawk', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.doesNotThrow(() => applyGameAction(bash, 2, { type: 'attack', troopId: 'highland-hawk', coordinate: '1,0' }, cards));
});

test('an attack aimed at a bash hex follows the opposing bash survivor', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'canyon-ibex', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'canyon-ibex', coordinate: '1,0' }, cards);
  const counterattack = applyGameAction(bash, 2, { type: 'magic', troopId: 'coastal-heron', coordinate: '1,0' }, cards);
  const spell = counterattack.effects.find(effect => effect.kind === 'magic');
  assert.equal(spell?.targetUnitId, '1:canyon-ibex');
  assert.equal(counterattack.units.find(unit => unit.troopId === 'canyon-ibex')?.coordinate, '1,0');

  const resolved = applyGameAction(counterattack, 1, { type: 'pass' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'canyon-ibex'), false);
});

test('a second troop cannot start another bash on a contested hex', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:queen-bee', troopId: 'queen-bee', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:tiger-queen', defenderId: '2:squirrel-king', target: '1,0' }], lastActingTroopId: { 1: 'tiger-queen' } };
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'queen-bee', coordinate: '1,0' }, cards), /bash is already happening/);
});

test('a bash winner takes permanent injury from the loser combat value after modifiers', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'coastal-heron', coordinate: '-1,0' }, cards);
  const hero = resolved.units.find(unit => unit.troopId === 'tiger-queen');
  assert.equal(hero?.coordinate, '1,0');
  // Player 1 controls the contested hex (+1), which absorbs the loser's 1 combat value.
  assert.equal(hero?.permanentDamage, 0);
});
test('a shield expires after it resolves the opposing physical attack', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'queen-bee', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const attacked = applyGameAction(state, 1, { type: 'attack', troopId: 'queen-bee', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(attacked, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(resolved.effects.length, 0);
});

test('self block creates exactly 1 shield on the acting troop', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'queen-bee', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { troopId: 'river-otter', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'self-defense', troopId: 'river-otter' }, cards);
  assert.deepEqual(next.units.find(unit => unit.troopId === 'river-otter')?.shields, [{ value: 1, sourceUnitId: '2:river-otter' }]);
  assert.equal(combatBreakdown(next, 'river-otter', cards).modifier, 1);
});

test('River Otter receives +1 only when another troop shields it', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'queen-bee', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { troopId: 'river-otter', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(combatBreakdown(next, 'river-otter', cards).modifier, 4);
});

test('a shield expires after the opposing magic action resolves', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'ember-salamander', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '0,-1', permanentDamage: 0 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const cast = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '0,-1' }, cards);
  const resolved = applyGameAction(cast, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '0,-1' }, cards);
  assert.equal(resolved.effects.length, 0);
});
test('Canyon Ibex gains its +2 modifier when bashing', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'canyon-ibex', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const bash = applyGameAction(state, 1, { type: 'move', troopId: 'canyon-ibex', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(bash, 2, { type: 'magic', troopId: 'coastal-heron', coordinate: '-1,0' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'coastal-heron'), false);
  assert.equal(resolved.units.find(unit => unit.troopId === 'canyon-ibex')?.coordinate, '1,0');
});

test('War Temple have rule grants its modifier only to each friendly bashing unit', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:war-temple', troopId: 'war-temple', owner: 1, coordinate: '2,2', permanentDamage: 0 },
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:iron-armadillo', troopId: 'iron-armadillo', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [
    { attackerId: '1:tiger-queen', defenderId: '2:squirrel-king', target: '1,0', awaitingEnd: true }
  ], lastActingTroopId: {} };
  const basherRules = combatSummary(state, '1:tiger-queen', cards, '1,0').modifiers.filter(entry => entry.label === 'Rules');
  const idleRules = combatSummary(state, '1:iron-armadillo', cards).modifiers.filter(entry => entry.label === 'Rules');
  assert.deepEqual(basherRules.map(entry => entry.value), [1]);
  assert.deepEqual(idleRules, []);
});

test('Marsh Badger loses one shield modifier when shielded', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'marsh-badger', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = applyGameAction(state, 1, { type: 'self-defense', troopId: 'marsh-badger' }, cards);
  const breakdown = combatSummary(shielded, 'marsh-badger', cards);
  assert.equal(breakdown.modifiers.find(entry => entry.label === 'Rules')?.value, -1);
  assert.equal(breakdown.modifier, 1, 'the shield and penalty cancel while friendly control still adds one');
});

test('Squirrel King does not heal when another troop acts', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 2 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(next.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 2);
});

test('Squirrel King heals after it personally uses magic and records normalized lifecycle events', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-1', permanentDamage: 2 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const afterP1 = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.equal(afterP1.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 2);
  const afterP2 = applyGameAction(afterP1, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,0' }, cards);
  assert.equal(afterP2.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 1);
  assert.ok(afterP2.normalizedEvents?.some(event => event.name === 'fire' && event.stage === 'target'));
  assert.deepEqual(afterP2.normalizedEvents?.slice(-4).map(event => event.name), ['end', 'opponent-end', 'start', 'opponent-start']);
});

test('normalized bash events bind the exact attacker, defender, and fixed hex on retreat', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const pending = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(pending, 2, { type: 'move', troopId: 'squirrel-king', coordinate: '2,0' }, cards);
  const events = resolved.normalizedEvents.filter(event => event.name === 'bash');
  assert.deepEqual(events.at(-2), { ...events.at(-2), name: 'bash', stage: 'target', destination: '1,0', subject: { kind: 'unit', unitId: '1:tiger-queen' }, object: { kind: 'unit', unitId: '2:squirrel-king' }, success: true });
  assert.equal(events.at(-1).stage, 'resolved');
  assert.equal(events.at(-1).canceled, true);
  assert.equal(events.at(-1).destination, '1,0');
});
