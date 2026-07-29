import assert from 'node:assert/strict';
import test from 'node:test';
import { troopSeeds } from '../game/cards.js';
import { MatchStore } from '../server/match-store.mjs';

const legacyCardNames = {
  'p1-hero': 'tiger-queen', 'p1-1': 'ember-salamander', 'p1-2': 'desert-fox',
  'p1-3': 'snowy-owl', 'p1-4': 'canyon-ibex', 'p1-5': 'marsh-badger',
  'p1-6': 'dune-scorpion', 'p1-7': 'steppe-lynx'
};
const cards = new Map(troopSeeds.map(card => [card.id, card]));
for (const [legacyId, currentId] of Object.entries(legacyCardNames)) cards.set(legacyId, { ...cards.get(currentId), id: legacyId });
const deck = ['p1-hero', 'p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7'];

test('match state contract includes format, health, revision, effects, bashes, and action log', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  assert.equal(created.format, 8);
  assert.equal(created.activePlayer, 1);
  assert.deepEqual(created.units, []);
  assert.deepEqual(created.effects, []);
  assert.deepEqual(created.bashes, []);
  assert.equal(created.revision, 0);
  assert.deepEqual(created.events, []);
  assert.deepEqual(created.decks, { 1: deck, 2: deck });
  assert.equal(created.winner, undefined);
  assert.equal(created.control['p1-start'].controller, 1);
  assert.equal(created.control.front.controller, undefined);
});

test('the public match state distinguishes identical cards owned by different players', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const red = created.players[1];
  const blue = created.players[2];
  store.applyAction(created.id, red, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
  const state = store.applyAction(created.id, blue, { type: 'deploy', troopId: 'p1-hero', coordinate: '-1,-2' });
  assert.deepEqual(state.units.map(unit => unit.id).sort(), ['1:p1-hero', '2:p1-hero']);
});

test('only a match participant can submit an action', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  assert.throws(() => store.applyAction(created.id, 'mallory', { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' }), /Match or player not found/);
});

test('a sandbox lets one nickname control either side of an authoritative match', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 1,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
  });
  assert.equal(sandbox.sandbox, true);
  assert.equal(store.playerFor(sandbox.id, 'alice'), 1);
  store.applyAction(sandbox.id, 'alice', { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
  store.setSandboxSide(sandbox.id, 'alice', 2);
  assert.equal(store.playerFor(sandbox.id, 'alice'), 2);
  const state = store.applyAction(sandbox.id, 'alice', { type: 'deploy', troopId: 'p1-hero', coordinate: '-1,-2' });
  assert.deepEqual(state.units.map(unit => unit.id).sort(), ['1:p1-hero', '2:p1-hero']);
});

test('a loaded sandbox resumes on its saved active player side', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 2,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 4, events: []
  });
  assert.equal(sandbox.activePlayer, 2);
  assert.equal(sandbox.sandboxSide, 2);
  assert.equal(store.playerFor(sandbox.id, 'alice'), 2);
});

test('sandbox free placement ignores deployment and turn rules while retaining one troop per hex', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 1,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
  });
  store.setSandboxFreePlacement(sandbox.id, 'alice', true);
  store.placeSandboxTroop(sandbox.id, 'alice', 2, 'p1-4', '1,2');
  store.placeSandboxTroop(sandbox.id, 'alice', 1, 'p1-3', '1,2');
  const state = store.getState(sandbox.id);
  assert.equal(state.sandboxFreePlacement, true);
  assert.deepEqual(state.units.map(unit => `${unit.owner}:${unit.troopId}@${unit.coordinate}`), ['1:p1-3@1,2']);
});

test('out-of-range selections are rejected before they can be shared as pending targets', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  const match = store.matches.get(created.id);
  match.game.units = [{ id: '1:p1-hero', troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 }];

  assert.throws(
    () => store.setSelection(created.id, created.players[1], 'p1-hero', { type: 'move', coordinate: '-3,-4' }),
    /Destination is out of range/
  );
  assert.equal(store.getState(created.id).targetSelections[1], undefined);
});

test('accepted actions update the revisioned public state', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const starter = created.players[1];
  const next = store.applyAction(created.id, starter, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
  assert.equal(next.revision, 1);
  assert.equal(next.units[0].currentHealth, 6);
  assert.deepEqual(next.events[0].action, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
});

test('diagnostic logs retain board snapshots alongside each accepted action', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const starter = created.players[1];
  store.applyAction(created.id, starter, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
  const log = store.diagnosticLog(created.id);
  const action = log.snapshots.find(snapshot => snapshot.kind === 'action');
  assert.deepEqual(action.action, { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' });
  assert.equal(action.state.units[0].coordinate, '1,2');
  assert.equal(log.finalState.revision, 1);
});

test('a player loses when their last living card is unavailable after the opponent acts', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const match = store.matches.get(created.id);
  match.game = {
    activePlayer: 1,
    units: [
      { id: '1:p1-hero', troopId: 'p1-hero', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { id: '2:p1-hero', troopId: 'p1-hero', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: { 2: 'p1-hero' },
    defeatedTroopIds: deck.slice(1).map(troopId => `2:${troopId}`)
  };
  const state = store.applyAction(created.id, created.players[1], { type: 'move', troopId: 'p1-hero', coordinate: '1,1' });
  assert.equal(state.winner, 1);
  assert.equal(state.status, 'finished');
});
