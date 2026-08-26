import assert from 'node:assert/strict';
import test from 'node:test';
import { addDeckCard, clearDeckSlots, completedDeckFormats, createDeckSlots, isCompleteDeck, moveDeckCard, removeDeckCard, selectedDeckCards, swapDeckCards } from '../dist/client/deck-state.js';
import { boardDescriptionEntries, cardRuleDetails, compareTroopsForTray, createTroopView, deploymentDescription, hasDeploymentTarget, permanentUpgradeBonus, trayRoleLabel } from '../dist/client/troop-view.js';
import { troopSeeds } from '../dist/game/cards.js';

const catalogue = new Map(troopSeeds.map(card => [card.id, card]));
const eightCardDeck = [
  'tiger-queen', 'ember-salamander', 'desert-fox', 'snowy-owl',
  'canyon-ibex', 'marsh-badger', 'dune-scorpion', 'steppe-lynx'
];

test('clicking a database card adds its catalogue ID to the first visible deck slot', () => {
  const card = createTroopView('queen-bee', 1);
  assert.ok(card);
  assert.equal(card.cardId, 'queen-bee');
  assert.equal(card.id, '1:queen-bee', 'runtime identity remains owner-scoped');

  const slots = addDeckCard(createDeckSlots(), card.cardId, 8, catalogue);
  assert.deepEqual(selectedDeckCards(slots, 8), ['queen-bee']);
});

test('Control X is shown in compact and hover card rules', () => {
  const troop = { ...createTroopView('ember-salamander', 1), control: 2 };
  assert.ok(boardDescriptionEntries(troop).some(line => line.text === 'Control 2'));
  assert.ok(cardRuleDetails(troop).includes('Control 2: this unit contributes 2 additional control to its current region.'));
});

test('board hex information always uses three rows and marks overflow on the third', () => {
  const short = boardDescriptionEntries(createTroopView('ember-salamander', 1));
  assert.equal(short.length, 3);

  const overflowing = boardDescriptionEntries(createTroopView('wandering-monarch', 1));
  assert.equal(overflowing.length, 3);
  assert.match(overflowing[2].text, / \.\.\.$/u);
  assert.notEqual(overflowing[2].text, '...');
});

test('adding cards rejects duplicates, unknown cards, and a second hero', () => {
  const initial = createDeckSlots(['queen-bee', 'ember-salamander']);
  assert.equal(addDeckCard(initial, 'queen-bee', 8, catalogue), initial);
  assert.equal(addDeckCard(initial, 'not-a-card', 8, catalogue), initial);
  assert.equal(addDeckCard(initial, 'tiger-queen', 8, catalogue), initial);
});

test('an 8-card deck never adds cards to hidden 10-card slots', () => {
  const fullEight = createDeckSlots(eightCardDeck);
  assert.equal(addDeckCard(fullEight, 'cave-viper', 8, catalogue), fullEight);

  const tenCardDeck = addDeckCard(fullEight, 'cave-viper', 10, catalogue);
  assert.equal(tenCardDeck[8], 'cave-viper');
});

test('clicking a deck card removes only that visible slot', () => {
  const initial = createDeckSlots(['tiger-queen', 'ember-salamander']);
  const removed = removeDeckCard(initial, 1, 8);
  assert.deepEqual(removed.slice(0, 3), ['tiger-queen', undefined, undefined]);
  assert.equal(removeDeckCard(initial, 8, 8), initial, 'hidden slots cannot be edited in 8-card mode');
});

test('clearing a deck empties the draft without mutating the previous slots', () => {
  const previous = createDeckSlots(eightCardDeck);
  const cleared = clearDeckSlots();
  assert.deepEqual(selectedDeckCards(cleared, 10), []);
  assert.deepEqual(selectedDeckCards(previous, 8), eightCardDeck);
});

test('dropping a database card replaces a slot while preserving the one-hero rule', () => {
  const initial = createDeckSlots(['tiger-queen', 'ember-salamander']);
  const replaced = moveDeckCard(initial, 'desert-fox', 1, 8, catalogue);
  assert.deepEqual(replaced.slice(0, 2), ['tiger-queen', 'desert-fox']);
  assert.equal(moveDeckCard(initial, 'queen-bee', 1, 8, catalogue), initial);
});

test('dragging deck cards swaps visible slots and ignores invalid destinations', () => {
  const initial = createDeckSlots(['tiger-queen', 'ember-salamander', 'desert-fox']);
  const swapped = swapDeckCards(initial, 0, 2, 8);
  assert.deepEqual(swapped.slice(0, 3), ['desert-fox', 'ember-salamander', 'tiger-queen']);
  assert.equal(swapDeckCards(initial, 0, 8, 8), initial);
  assert.equal(swapDeckCards(initial, 1, 1, 8), initial);
});

test('Play unlocks only for a full, unique catalogue deck with exactly one hero', () => {
  assert.equal(isCompleteDeck([], 8, catalogue), false);
  assert.equal(isCompleteDeck(eightCardDeck.slice(0, 7), 8, catalogue), false);
  assert.equal(isCompleteDeck(eightCardDeck, 8, catalogue), true);
  assert.equal(isCompleteDeck([...eightCardDeck.slice(0, 7), 'not-a-card'], 8, catalogue), false);
  assert.equal(isCompleteDeck([...eightCardDeck.slice(0, 7), 'tiger-queen'], 8, catalogue), false);
  assert.equal(isCompleteDeck(['tiger-queen', 'queen-bee', ...eightCardDeck.slice(1, 7)], 8, catalogue), false);
});

test('saved deck readiness reports only formats containing a completed deck', () => {
  const tenCardDeck = [...eightCardDeck, 'cave-viper', 'river-otter'];
  assert.deepEqual(completedDeckFormats({
    8: [eightCardDeck.slice(0, 7), eightCardDeck],
    10: [tenCardDeck.slice(0, 9)]
  }, catalogue), [8]);
  assert.deepEqual(completedDeckFormats({ 8: [eightCardDeck], 10: [tenCardDeck] }, catalogue), [8, 10]);
  assert.deepEqual(completedDeckFormats(null, catalogue), []);
});

test('special deployment rules are explained in plain language', () => {
  const duneScorpion = createTroopView('dune-scorpion', 1);
  const caveViper = createTroopView('cave-viper', 1);
  assert.equal(deploymentDescription(duneScorpion), 'Enemy intermediate regions you control.');
  assert.equal(deploymentDescription(caveViper), 'Front line once you control it.');
  assert.deepEqual(cardRuleDetails(duneScorpion), [
    'Enemy intermediate regions you control.',
    '🥾1 (move): up to 1 hex through a clear path; entering an enemy starts a bash.',
    '1🏹3 (ranged attack): 1 physical damage at distance 3; resolves after the opponent acts and shields can block it.'
  ]);
  assert.deepEqual(cardRuleDetails(caveViper), [
    'Front line once you control it.',
    '2🔥3 (magic): 2 damage at distance 3; resolves after the opponent acts, ignores shields, and kills only if lethal.',
    'Movement: this unit cannot move.'
  ]);
});

test('undeployed cards are enabled only when they have a rules-valid board target', () => {
  const control = {
    'p1-start': { controller: 1 },
    'p2-start': { controller: 2 },
    'p1-middle': { controller: 1 },
    'p1-side': { controller: 1 },
    'p2-middle': { controller: 2 },
    'p2-side': { controller: 2 },
    front: {}
  };
  const match = {
    activePlayer: 1,
    units: [],
    defeatedTroopIds: [],
    lastActingTroopId: {},
    control
  };
  const tigerQueen = createTroopView('tiger-queen', 1);
  const steppeLynx = createTroopView('steppe-lynx', 1);
  const duneScorpion = createTroopView('dune-scorpion', 1);
  const caveViper = createTroopView('cave-viper', 1);

  assert.equal(hasDeploymentTarget(match, 1, tigerQueen), true, 'a hero can use its controlled home region');
  assert.equal(hasDeploymentTarget(match, 1, steppeLynx), false, 'troops stay disabled until a hero is present');

  const afterHero = { ...match, units: [{ owner: 1, troopId: 'tiger-queen', coordinate: '1,2' }] };
  assert.equal(hasDeploymentTarget(afterHero, 1, steppeLynx), true);
  assert.equal(hasDeploymentTarget(afterHero, 1, duneScorpion), false, 'enemy-region cards wait for enemy-region control');
  assert.equal(hasDeploymentTarget(afterHero, 1, caveViper), false, 'front cards wait for front-line control');
  assert.equal(hasDeploymentTarget({
    ...afterHero,
    control: { ...control, 'p2-middle': { controller: 1 }, front: { controller: 1 } }
  }, 1, duneScorpion), true);
  assert.equal(hasDeploymentTarget({
    ...afterHero,
    control: { ...control, front: { controller: 1 } }
  }, 1, caveViper), true);
});

test('grouped card lists put important card types first and sort names within each type', () => {
  const shuffled = ['war-temple', 'dune-scorpion', 'tiger-queen', 'cave-viper', 'queen-bee', 'oracle-temple']
    .map(cardId => createTroopView(cardId, 1));
  shuffled.sort(compareTroopsForTray);

  assert.deepEqual(shuffled.map(card => card.cardId), [
    'queen-bee',
    'tiger-queen',
    'cave-viper',
    'dune-scorpion',
    'oracle-temple',
    'war-temple'
  ]);
  assert.deepEqual([...new Set(shuffled.map(card => trayRoleLabel(card.role)))], ['Heroes', 'Troops', 'Temples']);
});

test('every catalogue card exposes complete readable hover rules', () => {
  for (const seed of troopSeeds) {
    const troop = createTroopView(seed.id, 1);
    const rules = cardRuleDetails(troop);
    assert.doesNotMatch(rules[0], /^Deploy/);
    assert.ok(rules.length >= seed.actions.length + 1, `${seed.name} should describe every action`);
    if (!seed.actions.some(action => action.kind === 'move' || action.kind === 'fly')) {
      assert.ok(rules.includes('Movement: this unit cannot move.'), `${seed.name} should explain that it is immobile`);
    }
    if (seed.ruleDescription) assert.ok(rules.includes(seed.ruleDescription), `${seed.name} should explain its passive`);
  }
});

test('hover rules pair every action notation with a plain-language explanation', () => {
  assert.ok(cardRuleDetails(createTroopView('queen-bee', 1)).includes(
    '3🏹4 (ranged attack): 3 physical damage at distance 4; resolves after the opponent acts and shields can block it.'
  ));
  assert.ok(cardRuleDetails(createTroopView('ember-salamander', 1)).includes(
    '3🔥2 (magic): 3 damage at distance 2; resolves after the opponent acts, ignores shields, and kills only if lethal.'
  ));
});

test('Sahel Porcupine exposes accumulated event bonuses as magenta board and hover upgrades', () => {
  const porcupine = createTroopView('sahel-porcupine', 1, {
    id: '1:sahel-porcupine', troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1',
    permanentDamage: 0, currentHealth: 2, rangedDamageBonus: 2, rangedRangeBonus: 2
  });
  assert.deepEqual(permanentUpgradeBonus(porcupine, 'attack'), { left: 2, right: 2 });
  const rangedLine = boardDescriptionEntries(porcupine).find(line => line.action === 'attack');
  assert.deepEqual(rangedLine, { text: '3 🏹 3 ...', action: 'attack', upgraded: false, staticLeft: true, staticRight: true });
  assert.ok(cardRuleDetails(porcupine).some(rule => rule.startsWith('3🏹3 (ranged attack):')));
});
