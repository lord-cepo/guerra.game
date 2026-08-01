import assert from 'node:assert/strict';
import test from 'node:test';
import { troopSeeds } from '../dist/game/cards.js';
import { applyGameAction, availableActionsFor, combatBreakdown, combatSummary, controlSummary, createGameState, dispatchTrigger, registerPassive } from '../dist/game/engine.js';

const catalogueCards = new Map(troopSeeds.map(card => [card.id, card]));
const cards = new Map(catalogueCards);
// Several generic engine scenarios need Queen Bee's ranged profile on a
// non-hero fixture so deployment prerequisites can be tested independently.
cards.set('queen-bee', { ...cards.get('queen-bee'), role: 'troop', baseHealth: 3 });

test('card definitions distinguish continuous conditions from one-shot event resolutions', () => {
  assert.deepEqual(cards.get('canyon-ibex').continuousEffects, [
    { condition: 'bash-attacker', kind: 'combat-modifier', value: 2, label: 'Canyon Ibex' }
  ]);
  assert.deepEqual(cards.get('sahel-porcupine').eventEffects, [
    { condition: 'bashAttack', resolution: { kind: 'magenta-upgrade', ability: 'attack', left: 1, right: 1 } }
  ]);
  assert.equal(cards.get('canyon-ibex').eventEffects, undefined);
  assert.equal(cards.get('sahel-porcupine').continuousEffects, undefined);
});

test('Wandering Monarch End event pauses the turn for an optional one-hex move', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '1:steppe-lynx', troopId: 'steppe-lynx', owner: 1, coordinate: '0,1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const ended = applyGameAction(state, 1, { type: 'move', troopId: 'steppe-lynx', coordinate: '1,1' }, cards);
  assert.equal(ended.activePlayer, 1, 'the opponent turn does not start before End resolves');
  assert.deepEqual(ended.pendingResolution, { owner: 1, turnPlayer: 1, sourceUnitId: '1:wandering-monarch', sourceTroopId: 'wandering-monarch', kind: 'optional-move', distance: 1 });
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

test('block and self block remain available without an existing threat', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const actions = availableActionsFor(state, 1, 'wandering-monarch', cards);
  assert.ok(actions.some(action => action.type === 'defense' && action.coordinate === '2,2'), 'an enemy-occupied reachable hex can be shielded');
  assert.ok(actions.some(action => action.type === 'defense' && action.coordinate === '0,2'), 'an empty reachable hex can be shielded');
  assert.ok(actions.some(action => action.type === 'self-defense'), 'self block is available before an attack exists');
});

test('Wandering Monarch carries its owner’s destination-hex shield into its End bash', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 1 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = applyGameAction(state, 1, { type: 'defense', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.equal(shielded.pendingResolution?.kind, 'optional-move');
  const bashed = applyGameAction(shielded, 1, { type: 'resolve-move', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.equal(combatSummary(bashed, '1:wandering-monarch', cards, '2,2').modifiers.some(entry => entry.label === 'Shield' && entry.value === 2), true);
  assert.equal(combatSummary(bashed, '2:marsh-badger', cards, '2,2').modifiers.some(entry => entry.label === 'Shield'), false, 'the shield belongs to its caster, not the enemy already on the hex');
  const resolved = applyGameAction(bashed, 2, { type: 'pass' }, cards);
  assert.ok(resolved.units.some(unit => unit.id === '1:wandering-monarch'), 'the shield changes the bash outcome and saves the Monarch');
  assert.equal(resolved.units.some(unit => unit.id === '2:marsh-badger'), false);
  assert.equal(resolved.effects.some(effect => effect.kind === 'defense'), false, 'the shield expires when the opponent finishes responding');
});

test('Wandering Monarch self block stays on its origin when its End move starts a bash', () => {
  const state = { activePlayer: 1, units: [
    { id: '1:wandering-monarch', troopId: 'wandering-monarch', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '2,2', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = applyGameAction(state, 1, { type: 'self-defense', troopId: 'wandering-monarch' }, cards);
  assert.deepEqual(shielded.effects.filter(effect => effect.kind === 'defense').map(effect => effect.target), ['1,2']);
  assert.equal(shielded.pendingResolution?.kind, 'optional-move');

  const bashed = applyGameAction(shielded, 1, { type: 'resolve-move', troopId: 'wandering-monarch', coordinate: '2,2' }, cards);
  assert.deepEqual(bashed.effects.filter(effect => effect.kind === 'defense').map(effect => effect.target), ['1,2'], 'the shield does not follow the Monarch');
  assert.equal(combatSummary(bashed, '1:wandering-monarch', cards, '2,2').modifiers.some(entry => entry.label === 'Shield'), false, 'the origin shield gives no modifier in the destination bash');
});

test('a non-hero cannot be deployed before that player deploys a hero', () => {
  const state = createGameState();
  assert.throws(
    () => applyGameAction(state, 1, { type: 'deploy', troopId: 'queen-bee', coordinate: '0,1' }, cards),
    /hero first/
  );
});

test('a hero can deploy into its controlled starting region and passes the turn', () => {
  const next = applyGameAction(createGameState(), 1, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' }, cards);
  assert.deepEqual(next.units, [{ id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }]);
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
  assert.throws(() => applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '-2,1' }, cards), /free path/);
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

test('self block creates exactly 1 shield on the acting troop hex', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'queen-bee', owner: 1, coordinate: '2,0', permanentDamage: 0 },
    { troopId: 'river-otter', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'self-defense', troopId: 'river-otter' }, cards);
  assert.deepEqual(next.effects, [{ owner: 2, sourceTroopId: 'river-otter', sourceUnitId: '2:river-otter', kind: 'defense', target: '1,0', value: 1 }]);
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

test('Marsh Badger loses one shield modifier when shielded', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'marsh-badger', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const shielded = applyGameAction(state, 1, { type: 'self-defense', troopId: 'marsh-badger' }, cards);
  assert.equal(combatBreakdown(shielded, 'marsh-badger', cards).modifier, 0);
});

test('Squirrel King does not heal when another troop acts', () => {
  const state = { activePlayer: 2, units: [
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 2 },
    { troopId: 'iron-armadillo', owner: 2, coordinate: '0,-1', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const next = applyGameAction(state, 2, { type: 'defense', troopId: 'iron-armadillo', coordinate: '1,0' }, cards);
  assert.equal(next.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 2);
});

test('Squirrel King heals after it personally uses magic and records the magic trigger', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '-1,-1', permanentDamage: 2 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const afterP1 = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  assert.equal(afterP1.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 2);
  const afterP2 = applyGameAction(afterP1, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '-1,0' }, cards);
  assert.equal(afterP2.units.find(unit => unit.troopId === 'squirrel-king')?.permanentDamage, 1);
  assert.deepEqual(afterP2.triggerEvents?.slice(-5).map(event => event.trigger), ['magicUsed', 'end', 'opponentEnd', 'start', 'opponentStart']);
});

test('bash triggers expose attacker, defender, hex, and an exact retreating attacker', () => {
  const state = { activePlayer: 1, units: [
    { troopId: 'tiger-queen', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {} };
  const observed = [];
  const removeAttack = registerPassive('bashAttack', 'tiger-queen', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  const removeDefense = registerPassive('bashDefense', 'squirrel-king', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  const removeBash = registerPassive('bash', 'tiger-queen', (_state, unit, event) => observed.push([event.trigger, unit.troopId, event.hex, event.attackerId, event.defenderId]));
  let attackBonus = 0;
  const removeRetreat = registerPassive('bashRetreat', 'tiger-queen', (_state, unit, event) => {
    if (event.attackerId === `${unit.owner}:${unit.troopId}`) attackBonus += 1;
  });
  const pending = applyGameAction(state, 1, { type: 'move', troopId: 'tiger-queen', coordinate: '1,0' }, cards);
  const resolved = applyGameAction(pending, 2, { type: 'move', troopId: 'squirrel-king', coordinate: '2,0' }, cards);
  removeAttack(); removeDefense(); removeBash(); removeRetreat();
  assert.deepEqual(observed, [
    ['bashAttack', 'tiger-queen', '1,0', '1:tiger-queen', '2:squirrel-king'],
    ['bashDefense', 'squirrel-king', '1,0', '1:tiger-queen', '2:squirrel-king'],
    ['bash', 'tiger-queen', '1,0', '1:tiger-queen', '2:squirrel-king']
  ]);
  assert.equal(attackBonus, 1, 'a retreat trigger applies only to the exact attacking troop');
  assert.deepEqual(resolved.triggerEvents?.filter(event => event.trigger === 'bashRetreat')[0], {
    trigger: 'bashRetreat', player: 1, hex: '1,0', troopIds: ['1:tiger-queen', '2:squirrel-king'], attackerId: '1:tiger-queen', defenderId: '2:squirrel-king'
  });
});

test('future passives can be registered through the start/end dispatcher', () => {
  const state = createGameState();
  state.units.push({ troopId: 'snowy-owl', owner: 1, coordinate: '1,0', permanentDamage: 1 });
  const unregister = registerPassive('start', 'snowy-owl', (_state, unit) => { unit.permanentDamage = 0; });
  dispatchTrigger(state, { trigger: 'start', player: 1, troopIds: [] }, cards, [1]);
  unregister();
  assert.equal(state.units[0].permanentDamage, 0);
});

test('timed passives resolve hero first, then troop order, for the active player', () => {
  const state = createGameState();
  state.units.push(
    { troopId: 'iron-armadillo', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { troopId: 'squirrel-king', owner: 2, coordinate: '2,0', permanentDamage: 0 }
  );
  const order = [];
  const removeHero = registerPassive('end', 'squirrel-king', () => { order.push('hero'); });
  const removeTroop = registerPassive('end', 'iron-armadillo', () => { order.push('troop'); });
  dispatchTrigger(state, { trigger: 'end', player: 2, troopIds: [], actingTroopId: 'coastal-heron' }, cards, [2]);
  removeHero(); removeTroop();
  assert.deepEqual(order, ['hero', 'troop']);
});
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
    { troopId: 'push-warden', owner: 1, coordinate: '1,1', permanentDamage: 0 },
    { troopId: 'coastal-heron', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ], effects: [], bashes: [], lastActingTroopId: {}, revision: 0, events: [] };
  const pushed = applyGameAction(state, 1, {
    type: 'push', troopId: 'push-warden', coordinate: '1,0', destination: '1,-2'
  }, cards);
  assert.equal(pushed.units.find(unit => unit.troopId === 'coastal-heron')?.coordinate, '1,-2');
  assert.equal(pushed.events.at(-1)?.origin, '1,0');
  assert.throws(() => applyGameAction(state, 1, {
    type: 'push', troopId: 'push-warden', coordinate: '1,0', destination: '1,-1'
  }, cards), /Invalid push destination/);
});

test('a pusher can choose either participant sharing a bash hex', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:canyon-ibex', troopId: 'canyon-ibex', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:squirrel-king', troopId: 'squirrel-king', owner: 2, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:push-warden', troopId: 'push-warden', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [], bashes: [{ attackerId: '1:canyon-ibex', defenderId: '2:squirrel-king', target: '1,0' }], lastActingTroopId: {} };
  const choices = availableActionsFor(state, 2, 'push-warden', cards).filter(action => action.type === 'push' && action.coordinate === '1,0');
  assert.deepEqual(choices.map(action => action.targetUnitId).sort(), ['1:canyon-ibex', '2:squirrel-king']);
  const pushAttacker = choices.find(action => action.targetUnitId === '1:canyon-ibex');
  const pushed = applyGameAction(state, 2, pushAttacker, cards);
  assert.equal(pushed.units.find(unit => unit.id === '1:canyon-ibex')?.coordinate, '1,-2');
  assert.equal(pushed.units.find(unit => unit.id === '2:squirrel-king')?.coordinate, '1,0');
  assert.equal(pushed.bashes.length, 0, 'moving either participant out of the contested hex ends that bash');
});

test('passing resolves the turn and creates the same revisioned history as active troop actions', () => {
  const passed = applyGameAction(createGameState(), 1, { type: 'pass' }, cards);
  assert.equal(passed.activePlayer, 2);
  assert.equal(passed.revision, 1);
  assert.deepEqual(passed.events, [{ revision: 1, player: 1, action: { type: 'pass' } }]);
});

test('cannon applies black magic along its line and ignores shields', () => {
  const state = {
    activePlayer: 1,
    units: [
      { troopId: 'walnut-crab', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { troopId: 'queen-bee', owner: 1, coordinate: '0,2', permanentDamage: 0 },
      { troopId: 'tiger-queen', owner: 1, coordinate: '1,0', permanentDamage: 0 },
      { troopId: 'cave-viper', owner: 2, coordinate: '0,1', permanentDamage: 0 },
      { troopId: 'highland-hawk', owner: 2, coordinate: '-1,0', permanentDamage: 0 },
      { troopId: 'squirrel-king', owner: 2, coordinate: '-2,-2', permanentDamage: 0 }
    ], effects: [{ owner: 2, sourceTroopId: 'iron-armadillo', kind: 'defense', target: '0,1', value: 99 }], bashes: []
  };
  const fired = applyGameAction(state, 1, { type: 'cannon', troopId: 'walnut-crab', coordinate: '-1,0' }, cards);
  assert.deepEqual(fired.effects.filter(effect => effect.kind === 'cannon').map(effect => effect.target), ['0,1', '-1,0']);
  const resolved = applyGameAction(fired, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '1,1' }, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'cave-viper'), false);
  assert.equal(resolved.units.some(unit => unit.troopId === 'highland-hawk'), false);
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
  assert.deepEqual(death.pendingResolution, { owner: 2, turnPlayer: 2, sourceTroopId: 'phoenix-moth', kind: 'death-attack', origin: '1,1', damage: 3, range: 2 });
  const shieldedDeath = { ...death, effects: [...death.effects, { owner: 1, sourceTroopId: 'snowy-owl', sourceUnitId: '1:snowy-owl', kind: 'defense', target: '1,0', value: 1 }] };
  const choice = availableActionsFor(shieldedDeath, 2, 'phoenix-moth', cards).find(action => action.type === 'resolve-death-attack' && action.targetUnitId === '1:snowy-owl');
  const resolved = applyGameAction(shieldedDeath, 2, choice, cards);
  assert.equal(resolved.units.some(unit => unit.troopId === 'snowy-owl'), true, 'the shield reduces the death attack and saves its troop');
  assert.equal(resolved.effects.some(effect => effect.kind === 'defense'), false, 'a shield is consumed when the death attack resolves');
  assert.equal(resolved.activePlayer, 1);
});

test('Cherub Sprout death revives one previously defeated non-hero card', () => {
  const state = { activePlayer: 2, units: [
    { id: '1:steppe-lynx', troopId: 'steppe-lynx', owner: 1, coordinate: '1,0', permanentDamage: 0 },
    { id: '2:cherub-sprout', troopId: 'cherub-sprout', owner: 2, coordinate: '1,1', permanentDamage: 0 }
  ], effects: [{ owner: 1, sourceTroopId: 'steppe-lynx', sourceUnitId: '1:steppe-lynx', targetUnitId: '2:cherub-sprout', kind: 'attack', target: '1,1', value: 9 }], bashes: [], defeatedTroopIds: ['2:marsh-badger'], lastActingTroopId: {} };
  const death = applyGameAction(state, 2, { type: 'pass' }, cards);
  assert.equal(death.pendingResolution?.kind, 'revive');
  const choices = availableActionsFor(death, 2, 'cherub-sprout', cards);
  assert.deepEqual(choices.filter(action => action.type === 'resolve-revive').map(action => action.targetTroopId), ['marsh-badger']);
  const revived = applyGameAction(death, 2, { type: 'resolve-revive', troopId: 'cherub-sprout', targetTroopId: 'marsh-badger' }, cards);
  assert.equal(revived.defeatedTroopIds.includes('2:marsh-badger'), false);
  assert.equal(revived.defeatedTroopIds.includes('2:cherub-sprout'), true);

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
  const shieldedHawkAttack = { ...hawkAttacking, effects: [{ owner: 2, sourceTroopId: 'iron-armadillo', kind: 'defense', target: '1,0', value: 3 }] };
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
  assert.throws(() => applyGameAction(repeatedThrow, 1, { type: 'bomb', troopId: 'bombardier-beetle', coordinate: '1,-1' }, cards), /already occupies/);

  const lit = applyGameAction(thrown, 2, { type: 'magic', troopId: 'squirrel-king', coordinate: '1,-1' }, cards);
  assert.deepEqual(lit.bombs, [], 'the lit bomb is removed immediately');
  assert.equal(lit.effects.filter(effect => effect.kind === 'bomb').length, 7);
  assert.equal(lit.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 0, 'ignition itself causes no damage');

  const exploded = applyGameAction(lit, 1, { type: 'pass' }, cards);
  assert.equal(exploded.units.find(unit => unit.id === '1:marsh-badger').permanentDamage, 2, 'the thrower’s ally is damaged');
  assert.equal(exploded.units.find(unit => unit.id === '2:tiger-queen').permanentDamage, 2, 'the lighter’s ally is damaged');
  assert.equal(exploded.units.find(unit => unit.id === '2:squirrel-king').permanentDamage, 0, 'troops outside the blast are safe');
});
