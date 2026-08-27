import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState, dispatchTrigger, registerPassive } from "../dist/game/engine.js";
import { createEngineCards } from "./helpers/engine-fixture.mjs";

const { cards, catalogueCards, troopSeeds } = createEngineCards();

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

test('deployed static temples boost their owner’s ranged and magic values', () => {
  const rangedState = { activePlayer: 1, units: [
    { id: '1:sahel-porcupine', troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:ranged-power-temple', troopId: 'ranged-power-temple', owner: 1, coordinate: '2,1', permanentDamage: 0 },
    { id: '1:ranged-range-temple', troopId: 'ranged-range-temple', owner: 1, coordinate: '3,0', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const ranged = applyGameAction(rangedState, 1, { type: 'attack', troopId: 'sahel-porcupine', coordinate: '-1,0' }, cards);
  assert.equal(ranged.effects[0]?.value, 2, 'the ranged damage aura raises the left value');

  const magicState = { activePlayer: 1, units: [
    { id: '1:ember-salamander', troopId: 'ember-salamander', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:magic-power-temple', troopId: 'magic-power-temple', owner: 1, coordinate: '2,1', permanentDamage: 0 },
    { id: '1:magic-range-temple', troopId: 'magic-range-temple', owner: 1, coordinate: '3,0', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const magic = applyGameAction(magicState, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '-1,-1' }, cards);
  assert.equal(magic.effects[0]?.value, 4, 'the magic damage aura raises the left value at the aura-extended range');
});

test('Reed Archer gains a stackable magenta damage upgrade only after a successful ranged attack', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:reed-archer', troopId: 'reed-archer', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '-1,0', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 1, { type: 'attack', troopId: 'reed-archer', coordinate: '1,0' }, cards);
  assert.equal(fired.units[0].rangedDamageBonus, undefined, 'the bonus waits for the delayed attack to hit');
  const resolved = applyGameAction(fired, 2, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'reed-archer')?.rangedDamageBonus, 1);
  assert.equal(resolved.units.find(unit => unit.troopId === 'reed-archer')?.rangedRangeBonus, 0);
});

test('Crown Breaker gains +2 only while it attacks a hero in a bash', () => {
  const heroBash = { activePlayer: 2, units: [
    { id: '1:crown-breaker', troopId: 'crown-breaker', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:crown-breaker', defenderId: '2:squirrel-king', target: '1,0' }], lastActingTroopId: {} };
  assert.equal(combatBreakdown(heroBash, '1:crown-breaker', cards, '1,0').modifier, 2);
  const troopDefender = { ...heroBash, units: [heroBash.units[0], { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '1,0', permanentDamage: 0 }], bashes: [{ attackerId: '1:crown-breaker', defenderId: '2:marsh-badger', target: '1,0' }] };
  assert.equal(combatBreakdown(troopDefender, '1:crown-breaker', cards, '1,0').modifier, 0);
});

test('Marching Giant suffers one permanent damage after each Move action', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:marching-giant', troopId: 'marching-giant', owner: 1, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const moved = applyGameAction(state, 1, { type: 'move', troopId: 'marching-giant', coordinate: '2,2' }, cards);
  assert.equal(moved.units[0].permanentDamage, 1);
});

test('Phoenix Moth death pauses for a 3-damage ranged target within distance 2', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:snowy-owl', troopId: 'snowy-owl', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:phoenix-moth', troopId: 'phoenix-moth', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [{ owner: 1, sourceTroopId: 'snowy-owl', sourceUnitId: '1:snowy-owl', targetUnitId: '2:phoenix-moth', kind: 'attack', target: '1,1', value: 9 }], bashes: [], lastActingTroopId: {} };
  const death = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(death.units.some(unit => unit.troopId === 'phoenix-moth'), false);
  assert.deepEqual({ ...death.pendingResolution, stackActionId: undefined }, { owner: 2, turnPlayer: 2, sourceTroopId: 'phoenix-moth', kind: 'death-attack', origin: '1,1', damage: 3, range: 2, stackActionId: undefined });
  const shieldedDeath = { ...death, units: death.units.map(unit => unit.id === '1:snowy-owl' ? { ...unit, shields: [{ value: 1, sourceUnitId: '1:snowy-owl' }] } : unit) };
  const choice = availableActionsFor(shieldedDeath, 2, 'phoenix-moth', cards).find(action => action.type === 'resolve-death-attack' && action.targetUnitId === '1:snowy-owl');
  const resolved = applyGameAction(shieldedDeath, 2, choice, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'snowy-owl'), true, 'the shield reduces the death attack and saves its troop');
  assert.equal(resolved.units.find(unit => unit.id === '1:snowy-owl')?.shields, undefined, 'a shield is consumed when the death attack resolves');
  assert.equal(resolved.activePlayer, 1);
});

test('Temple of the Last Bell resolves one chosen instant ranged hex', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:powder-newt', troopId: 'powder-newt', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:temple-last-bell', troopId: 'temple-last-bell', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [{ owner: 1, sourceTroopId: 'steppe-lynx', sourceUnitId: '1:steppe-lynx', targetUnitId: '2:temple-last-bell', kind: 'attack', target: '1,1', value: 9 }], bashes: [], lastActingTroopId: {} };
  const death = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.deepEqual({ ...death.pendingResolution, stackActionId: undefined }, { owner: 2, turnPlayer: 2, sourceTroopId: 'temple-last-bell', kind: 'instant-ranged', origin: '1,1', damage: 3, range: 3, remaining: 1, stackActionId: undefined });
  assert.ok(availableActionsFor(death, 2, 'temple-last-bell', cards).some(action => action.type === 'resolve-instant-ranged' && action.coordinate === '1,0'));
  assert.equal(availableActionsFor(death, 2, 'temple-last-bell', cards).some(action => action.type === 'resolve-pass'), true);
  const first = applyGameAction(death, 2, { type: 'resolve-instant-ranged', troopId: 'temple-last-bell', coordinate: '1,0' }, cards);
  assert.equal(first.units.some(unit => unit.troopId === 'powder-newt'), false);
  assert.equal(first.pendingResolution, undefined);
  assert.equal(first.activePlayer, 1);
});

test('Boar Warlord gains +1 physical and +1 magic modifier when it enters a bash', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:boar-warlord', troopId: 'boar-warlord', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:coastal-heron', troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const moved = applyGameAction(state, 1, { type: 'move', troopId: 'boar-warlord', coordinate: '1,0' }, cards);
  assert.equal(moved.bashes.length, 1);
  const boar = moved.units.find(unit => unit.troopId === 'boar-warlord');
  assert.equal(boar?.combatModifierBonus, 1, 'entering a bash grants +1 physical modifier');
  assert.equal(boar?.magicModifierBonus, 1, 'entering a bash grants +1 magic modifier');
});

test('troop shields survive opponent End until their physical attack resolves', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:queen-bee', troopId: 'queen-bee', owner: 2, coordinate: '-1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, };
  state.units[0].shields = [{ value: 2, sourceUnitId: '1:moss-tortoise' }];
  const fired = applyGameAction(state, 2, { type: 'attack', troopId: 'queen-bee', coordinate: '1,1' }, cards);
  assert.deepEqual(fired.units.find(unit => unit.troopId === 'tiger-queen')?.shields?.map(shield => shield.value), [2], 'the troop shield remains until its physical attack resolves');
  const resolved = applyGameAction(fired, 1, { type: 'pass' }, cards);
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen')?.permanentDamage, 0, 'the tile shield and controlled-region modifier block the attack');
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen')?.shields, undefined, 'the attacked troop consumes its shield when the attack resolves');
});

test('Pierce ranged attacks ignore physical modifiers but still consume shields', () => {
  const state = { activePlayer: 2, units: [
    { id: '2:pierce-test', troopId: 'pierce-test', owner: 2, coordinate: '-1,0', permanentDamage: 0 },
    { id: '1:alps-lone-wolf', troopId: 'alps-lone-wolf', owner: 1, coordinate: '1,1', permanentDamage: 1, shields: [{ value: 2, sourceUnitId: '1:alps-lone-wolf' }] }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const fired = applyGameAction(state, 2, { type: 'attack', troopId: 'pierce-test', coordinate: '1,1' }, cards);
  assert.equal(fired.effects[0].pierce, true);
  const resolved = applyGameAction(fired, 1, { type: 'pass' }, cards);
  const target = resolved.units.find(unit => unit.id === '1:alps-lone-wolf');
  assert.equal(target?.permanentDamage, 2, 'the full Pierce value is applied despite the injured modifier');
  assert.equal(target?.shields, undefined, 'Pierce still consumes a physical shield');
});

test('Magic Defense protects friendly troops and self magic defense is card-specific', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:magic-defense-test', troopId: 'magic-defense-test', owner: 1, coordinate: '0,1', permanentDamage: 0 },
    { id: '1:squirrel-king', troopId: 'squirrel-king', owner: 1, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const protectedState = applyGameAction(state, 1, { type: 'magic-defense', troopId: 'magic-defense-test', coordinate: '0,-1' }, cards);
  assert.equal(protectedState.units.find(unit => unit.id === '1:squirrel-king')?.magicModifierBonus, 2);
  assert.equal(availableActionsFor(state, 1, 'magic-defense-test', cards).some(action => action.type === 'self-magic-defense'), false);
  const selfState = { activePlayer: 1, units: [{ id: '1:self-magic-defense-test', troopId: 'self-magic-defense-test', owner: 1, coordinate: '0,1', permanentDamage: 0 }], effects: [], bashes: [], lastActingTroopId: {} };
  assert.ok(availableActionsFor(selfState, 1, 'self-magic-defense-test', cards).some(action => action.type === 'self-magic-defense'));
  const selfProtected = applyGameAction(selfState, 1, { type: 'self-magic-defense', troopId: 'self-magic-defense-test' }, cards);
  assert.equal(selfProtected.units[0].magicModifierBonus, 2);
});

test('Pine Processionary death revives one previously defeated non-hero card', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:steppe-lynx', troopId: 'steppe-lynx', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:pine-processionary', troopId: 'pine-processionary', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [{ owner: 1, sourceTroopId: 'steppe-lynx', sourceUnitId: '1:steppe-lynx', targetUnitId: '2:pine-processionary', kind: 'attack', target: '1,1', value: 9 }], bashes: [], defeatedTroopIds: ['2:marsh-badger'], lastActingTroopId: {} };
  const death = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(death.pendingResolution?.kind, 'revive');
  const choices = availableActionsFor(death, 2, 'pine-processionary', cards);
  assert.deepEqual(choices.filter(action => action.type === 'resolve-revive').map(action => action.targetTroopId), ['marsh-badger']);
  const revived = applyGameAction(death, 2, { type: 'resolve-revive', troopId: 'pine-processionary', targetTroopId: 'marsh-badger' }, cards);
  assert.equal(revived.defeatedTroopIds.includes('2:marsh-badger'), false);
  assert.equal(revived.defeatedTroopIds.includes('2:pine-processionary'), true);

  const noPriorDefeats = { ...state, defeatedTroopIds: [] };
  const noChoice = applyGameAction(noPriorDefeats, 2, { type: 'pass' }, cards);
  assert.equal(noChoice.pendingResolution, undefined, 'the dying Sprout itself is not a revive target');
});

test('Canyon Hawk steady reduces only its bash opponent’s modifier to zero on attack and defense', () => {
  const hawkAttacking = { activePlayer: 2, units: [
    { id: '1:canyon-hawk', troopId: 'canyon-hawk', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:alps-lone-wolf', troopId: 'alps-lone-wolf', owner: 2, coordinate: '1,0', permanentDamage: 1 }
  ], effects: [], bashes: [{ attackerId: '1:canyon-hawk', defenderId: '2:alps-lone-wolf', target: '1,0' }], lastActingTroopId: { 1: 'canyon-hawk' } };
  assert.equal(combatBreakdown(hawkAttacking, '1:canyon-hawk', cards, '1,0').modifier, 1, 'Steady leaves the Hawk’s own control modifier intact');
  assert.equal(combatBreakdown(hawkAttacking, '2:alps-lone-wolf', cards, '1,0').modifier, 0, 'Steady suppresses the defender’s injured bonus');
  const shieldedHawkAttack = { ...hawkAttacking, units: hawkAttacking.units.map(unit => unit.id === '2:alps-lone-wolf' ? { ...unit, shields: [{ value: 3, sourceUnitId: '2:iron-armadillo' }] } : unit) };
  assert.equal(combatBreakdown(shieldedHawkAttack, '2:alps-lone-wolf', cards, '1,0').modifier, 0, 'Steady also suppresses a confirmed shield');

  const hawkDefending = { activePlayer: 1, units: [
    { id: '1:canyon-hawk', troopId: 'canyon-hawk', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:canyon-ibex', troopId: 'canyon-ibex', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '2:canyon-ibex', defenderId: '1:canyon-hawk', target: '1,0' }], lastActingTroopId: { 2: 'canyon-ibex' } };
  assert.equal(combatBreakdown(hawkDefending, '2:canyon-ibex', cards, '1,0').modifier, 0, 'Steady also suppresses the attacking Ibex bash bonus');
});

test('a bomb stays inert until fire magic lights its delayed neutral seven-hex explosion', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:bombardier-beetle', troopId: 'bombardier-beetle', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '1:marsh-badger', troopId: 'marsh-badger', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,-1', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '-1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [], lastActingTroopId: {} };

  const thrown = applyGameAction(state, 1, { type: 'bomb', troopId: 'bombardier-beetle', coordinate: '1,-1' }, cards);
  assert.deepEqual(thrown.bombs, [{ owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,-1', damage: 2 }]);
  assert.deepEqual(thrown.effects, [], 'throwing the bomb causes no damage');
  const repeatedThrow = { ...thrown, activePlayer: 1, lastActingTroopId: {} };
  const merged = applyGameAction(repeatedThrow, 1, { type: 'bomb', troopId: 'bombardier-beetle', coordinate: '1,-1' }, cards);
  assert.deepEqual(merged.bombs, [{ owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,-1', damage: 4 }], 'a bomb thrown onto an occupied bomb hex merges by summing damage');

  const lit = applyGameAction(thrown, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '1,-1' }, cards);
  assert.deepEqual(lit.bombs, [], 'the lit bomb is removed immediately');
  assert.equal(lit.effects.filter(effect => effect.kind === 'bomb').length, 7);
  assert.equal(lit.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 0, 'ignition itself causes no damage');

  const exploded = applyGameAction(lit, 1, { type: 'pass' }, cards);
  assert.equal(exploded.units.find(unit => unit.id === '1:marsh-badger').permanentDamage, 2, 'the thrower’s ally is damaged');
  assert.equal(exploded.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 2, 'the lighter’s ally is damaged');
  assert.equal(exploded.units.find(unit => unit.id === '2:squirrel-king').permanentDamage, 0, 'troops outside the blast are safe');
});

test('fire magic targeting a bomb transforms into bomb damage instead of also damaging the troop on its hex', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:ember-salamander', troopId: 'ember-salamander', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 2, sourceTroopId: 'bombardier-beetle', coordinate: '1,-1', damage: 2 }
  ], lastActingTroopId: {} };

  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,-1' }, cards);
  assert.equal(lit.effects.some(effect => effect.kind === 'magic'), false, 'the 3-damage fire spell is replaced by the explosion');
  assert.equal(lit.effects.filter(effect => effect.kind === 'bomb' && effect.target === '1,-1').length, 1);
  const exploded = applyGameAction(lit, 2, { type: 'pass' }, cards);
  assert.equal(exploded.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 2, 'the troop takes only the bomb’s 2 damage');
});

test('a troop moving into a lit bomb radius before resolution takes the explosion damage', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:ember-salamander', troopId: 'ember-salamander', owner: 1, coordinate: '-1,-1', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,-1', damage: 2 }
  ], lastActingTroopId: {} };

  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,-1' }, cards);
  assert.equal(lit.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 0, 'B begins outside the explosion radius');
  const moved = applyGameAction(lit, 2, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.equal(moved.units.find(unit => unit.id === '2:tiger-queen').coordinate, '1,0');
  assert.equal(moved.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 2, 'B is damaged after moving into an adjacent blast hex');
});

test('bomb explosions ignite a line of inert bombs one turn at a time', () => {
  const state = { activePlayer: 2, units: [], effects: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', kind: 'bomb', target: '1,-1', value: 2, origin: '1,-1' },
    { owner: 1, sourceTroopId: 'bombardier-beetle', kind: 'bomb', target: '1,0', value: 2, origin: '1,-1' }
  ], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,0', damage: 2 },
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,1', damage: 2 }
  ], lastActingTroopId: {} };

  const firstExplosion = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.deepEqual(firstExplosion.bombs?.map(bomb => bomb.coordinate), ['1,1'], 'only the bomb reached by the first blast is lit');
  assert.equal(firstExplosion.effects.filter(effect => effect.kind === 'bomb' && effect.origin === '1,0').length, 6, 'the central gap is excluded from this blast');
  assert.equal(firstExplosion.effects.some(effect => effect.kind === 'bomb' && effect.origin === '1,-1'), false, 'the resolved explosion is consumed');

  const secondExplosion = applyGameAction(firstExplosion, 1, { type: 'pass' }, cards);
  assert.deepEqual(secondExplosion.bombs, [], 'the second blast lights the next bomb in the line');
  assert.equal(secondExplosion.effects.filter(effect => effect.kind === 'bomb' && effect.origin === '1,1').length, 6, 'off-board neighbors are excluded from the final blast');
  assert.equal(secondExplosion.effects.some(effect => effect.kind === 'bomb' && effect.origin === '1,0'), false, 'each chain link resolves on a separate turn');
});

test('instant fire magic detonates a bomb immediately instead of leaving it lit', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:warding-bat', troopId: 'warding-bat', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:snowy-owl', troopId: 'snowy-owl', owner: 2, coordinate: '1,3', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,2', damage: 2 }
  ], lastActingTroopId: {}, pendingResolution: { owner: 1, turnPlayer: 1, sourceTroopId: 'warding-bat', kind: 'instant-magic', origin: '1,1', damage: 1, range: 1 } };

  const resolved = applyGameAction(state, 1, { type: 'resolve-instant-magic', troopId: 'warding-bat', coordinate: '1,2' }, cards);
  assert.deepEqual(resolved.bombs, [], 'the bomb detonates immediately');
  assert.equal(resolved.units.find(unit => unit.troopId === 'tiger-queen').permanentDamage, 2, 'the blast damages the troop on the bomb hex now');
  assert.equal(resolved.units.some(unit => unit.troopId === 'snowy-owl'), false, 'the blast defeats an adjacent fragile troop now');
  assert.ok(resolved.defeatedTroopIds.includes('2:snowy-owl'), 'the adjacent defeat is recorded');
  assert.equal(resolved.pendingResolution, undefined);
});

test('pierce fire lights a bomb whose blast pierces Obsidian immunity', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:pierce-fire-test', troopId: 'pierce-fire-test', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:obsidian-lizard', troopId: 'obsidian-lizard', owner: 2, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,2', damage: 2 }
  ], lastActingTroopId: {}, revision: 0, events: [] };

  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'pierce-fire-test', coordinate: '1,2' }, cards);
  assert.equal(lit.bombs.length, 0, 'the bomb is lit and removed');
  assert.ok(lit.effects.some(effect => effect.kind === 'bomb' && effect.pierce === true), 'the blast effects are marked as piercing');
  const exploded = applyGameAction(lit, 2, { type: 'pass' }, cards);
  assert.equal(exploded.units.some(unit => unit.troopId === 'obsidian-lizard'), false, 'a pierce blast defeats Obsidian troops');
  assert.ok(exploded.defeatedTroopIds.includes('2:obsidian-lizard'), 'the Obsidian defeat is recorded');
});

test('an ordinary lit bomb is still blocked by Obsidian immunity', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:ember-salamander', troopId: 'ember-salamander', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:obsidian-lizard', troopId: 'obsidian-lizard', owner: 2, coordinate: '1,2', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,2', damage: 2 }
  ], lastActingTroopId: {}, revision: 0, events: [] };

  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,2' }, cards);
  const exploded = applyGameAction(lit, 2, { type: 'pass' }, cards);
  assert.equal(exploded.units.find(unit => unit.troopId === 'obsidian-lizard').permanentDamage, 0, 'Obsidian blocks an ordinary bomb blast');
});

test('bomb blasts are reduced by the magic modifier and ignore the physical modifier', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:ember-salamander', troopId: 'ember-salamander', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,2', permanentDamage: 0, magicModifierBonus: 2, combatModifierBonus: 5 }
  ], effects: [], bashes: [], bombs: [
    { owner: 1, sourceTroopId: 'bombardier-beetle', coordinate: '1,2', damage: 3 }
  ], lastActingTroopId: {}, revision: 0, events: [] };
  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'ember-salamander', coordinate: '1,2' }, cards);
  const exploded = applyGameAction(lit, 2, { type: 'pass' }, cards);
  const tiger = exploded.units.find(unit => unit.troopId === 'tiger-queen');
  assert.equal(tiger.permanentDamage, 1, 'the magic modifier absorbs 2 of the 3-damage blast');
  assert.equal(tiger.magicModifierBonus, undefined, 'the magic modifier is consumed');
  assert.equal(tiger.combatModifierBonus, 5, 'the physical modifier is ignored by the blast');
});

test('Mole Artificer fire is piercing and pierces the magic shield', () => {
  const fire = cards.get('mole-artificer').actions.find(action => action.kind === 'fire');
  assert.deepEqual(fire?.type, ['pierce']);
  const state = { activePlayer: 1, units: [
    { id: '1:mole-artificer', troopId: 'mole-artificer', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { id: '2:snowy-owl', troopId: 'snowy-owl', owner: 2, coordinate: '1,2', permanentDamage: 1, magicModifierBonus: 3 }
  ], effects: [], bashes: [], bombs: [], lastActingTroopId: {}, revision: 0, events: [] };
  const lit = applyGameAction(state, 1, { type: 'magic', troopId: 'mole-artificer', coordinate: '1,2' }, cards);
  assert.ok(lit.effects.some(effect => effect.kind === 'magic' && effect.pierce === true), 'the fire effect is marked as piercing');
  const resolved = applyGameAction(lit, 2, { type: 'pass' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'snowy-owl'), false, 'pierce fire kills through the magic shield');
  assert.ok(resolved.defeatedTroopIds.includes('2:snowy-owl'), 'the pierced troop is recorded as defeated');
});

test('merging a bomb onto a pierce bomb keeps the pierce mark', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:bombardier-beetle', troopId: 'bombardier-beetle', owner: 1, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [], bombs: [
    { owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 1, pierce: true }
  ], lastActingTroopId: {}, revision: 0, events: [] };

  const merged = applyGameAction(state, 1, { type: 'bomb', troopId: 'bombardier-beetle', coordinate: '1,-1' }, cards);
  assert.deepEqual(merged.bombs, [{ owner: 2, sourceTroopId: 'powder-newt', coordinate: '1,-1', damage: 3, pierce: true }]);
});
