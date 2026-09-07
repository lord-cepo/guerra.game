import assert from 'node:assert/strict';
import test from 'node:test';
import { troopSeeds } from '../dist/game/cards.js';
import { parseCard } from '../dist/game/card-parser.js';
import { boardDescriptionEntries, cardRuleDetails } from '../dist/client/troop-view.js';
import { effectiveUnitState } from '../dist/game/rule-state.js';

const troop = id => ({ ...troopSeeds.find(card => card.id === id), owner: 1 });

test('White Wolf text is generated from its action and continuous recipient selector', () => {
  const wolf = troop('white-wolf');
  assert.deepEqual(boardDescriptionEntries(wolf).slice(1).map(line => line.text), ['A🥾 [[enemy:any]] 3', 'w unactive: +1🏹+1 [[friend:adj]]', '⚔️: +1 ~-1~']);
  assert.deepEqual(cardRuleDetails(wolf), ['A🥾 to [[enemy:any]] 3 from here', 'while unactive: +1🏹+1 to [[friend:adj]]', '⚔️: +1 ~-1~']);
});

test('Beetle text keeps complex targets in hover and does not confuse explosion with lighting', () => {
  const beetle = troop('pyromaniac-beetle');
  assert.deepEqual(boardDescriptionEntries(beetle).slice(1).map(line => line.text), ['1P🔥X', '🔥: 3💣 here and light 💣 here', '~+2~']);
  assert.deepEqual(cardRuleDetails(beetle), ['1P🔥 to unlit 💣', '🔥: you may 3💣 here and you must light 💣 here', 'while deployed: ~+2~']);
  assert.ok(!cardRuleDetails(beetle).join(' ').includes('damage'));
});

test('short continuous recipient syntax contributes to adjacent allies, not its source', () => {
  const card = parseCard({ id: 'aura', baseHealth: 3, deploymentRegions: 'starting', rules: ['while !active : up-bow(1,1) o:you adj self'] });
  const units = [{ id: '1:aura', owner: 1, troopId: 'aura', coordinate: '1,1', permanentDamage: 0, inactiveOnTurn: 0 }, { id: '1:ally', owner: 1, troopId: 'aura', coordinate: '1,0', permanentDamage: 0 }];
  const state = { units, turnNumber: 0, activePlayer: 1, effects: [], bashes: [] };
  const cards = new Map([['aura', card]]);
  const derived = [{ id: 'aura', sourceUnitId: '1:aura', rule: card.rules[0] }];
  assert.equal(effectiveUnitState(state, units[0], cards, derived).actionUpdates.has('bow'), false);
  assert.deepEqual(effectiveUnitState(state, units[1], cards, derived).actionUpdates.get('bow').parameters, [1, 1]);
});

test('hover explains cost-based defaults and explicit mandatory overrides', () => {
  const card = parseCard({ id: 'cost-copy', baseHealth: 3, deploymentRegions: 'starting', rules: [
    'end : push(1) self', 'end : T.push(1) self', 'end : bomb-defuse self',
    'end : must push(1) self', 'end : deactivate self :: T.push(1) self'
  ] });
  const text = cardRuleDetails({ ...card, owner: 1 });
  assert.ok(text.includes('at the end: you may 1🫸 here'));
  assert.ok(text.includes('at the end: you must 1T🫸 here'));
  assert.ok(text.includes('at the end: you must defuse 💣 here'));
  assert.ok(text.includes('at the end: you must 1🫸 here'));
  assert.ok(text.includes('at the end: deactivate here :: you may 1T🫸 here'));
});
