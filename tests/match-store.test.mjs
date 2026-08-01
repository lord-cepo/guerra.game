import assert from 'node:assert/strict';
import test from 'node:test';
import { troopSeeds } from '../dist/game/cards.js';
import { MatchStore } from '../server/match-store.mjs';

const cards = new Map(troopSeeds.map(card => [card.id, card]));
const deck = ['tiger-queen', 'ember-salamander', 'desert-fox', 'snowy-owl', 'canyon-ibex', 'marsh-badger', 'dune-scorpion', 'steppe-lynx'];

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
  store.applyAction(created.id, red, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
  const state = store.applyAction(created.id, blue, { type: 'deploy', troopId: 'tiger-queen', coordinate: '-1,-2' });
  assert.deepEqual(state.units.map(unit => unit.id).sort(), ['1:tiger-queen', '2:tiger-queen']);
});

test('only a match participant can submit an action', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  assert.throws(() => store.applyAction(created.id, 'mallory', { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' }), /Match or player not found/);
});

test('a sandbox lets one nickname control either side of an authoritative match', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 1,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
  });
  assert.equal(sandbox.sandbox, true);
  assert.equal(store.playerFor(sandbox.id, 'alice'), 1);
  store.applyAction(sandbox.id, 'alice', { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
  store.setSandboxSide(sandbox.id, 'alice', 2);
  assert.equal(store.playerFor(sandbox.id, 'alice'), 2);
  const state = store.applyAction(sandbox.id, 'alice', { type: 'deploy', troopId: 'tiger-queen', coordinate: '-1,-2' });
  assert.deepEqual(state.units.map(unit => unit.id).sort(), ['1:tiger-queen', '2:tiger-queen']);
});

test('sandbox Back restores the previous unit action exactly once', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 1,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
  });
  assert.equal(sandbox.sandboxUndoAvailable, false);

  store.applyAction(sandbox.id, 'alice', { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
  assert.equal(store.getState(sandbox.id).sandboxUndoAvailable, true);

  const restored = store.undoSandbox(sandbox.id, 'alice');
  assert.equal(restored.revision, 0);
  assert.deepEqual(restored.units, []);
  assert.equal(restored.activePlayer, 1);
  assert.equal(restored.sandboxUndoAvailable, false);
  assert.throws(() => store.undoSandbox(sandbox.id, 'alice'), /no playground action to undo/);
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

test('loading an older playground moves a pending bash attacker off its obsolete origin', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 2,
    units: [
      { id: '1:sahel-porcupine', troopId: 'sahel-porcupine', owner: 1, coordinate: '1,1', permanentDamage: 0 },
      { id: '2:marsh-badger', troopId: 'marsh-badger', owner: 2, coordinate: '1,0', permanentDamage: 0 }
    ], effects: [], bashes: [{ attackerId: '1:sahel-porcupine', defenderId: '2:marsh-badger', target: '1,0' }],
    lastActingTroopId: { 1: 'sahel-porcupine' }, defeatedTroopIds: [], revision: 3, events: []
  });
  const unitsAtBash = sandbox.units.filter(unit => unit.coordinate === '1,0');
  assert.deepEqual(unitsAtBash.map(unit => unit.id).sort(), ['1:sahel-porcupine', '2:marsh-badger']);
  assert.equal(sandbox.units.some(unit => unit.coordinate === '1,1'), false);
});

test('sandbox free placement ignores deployment and turn rules while retaining one troop per hex', () => {
  const store = new MatchStore(cards);
  const sandbox = store.createSandbox('alice', {
    format: 8, decks: { 1: deck, 2: deck }, activePlayer: 1,
    units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
  });
  store.setSandboxFreePlacement(sandbox.id, 'alice', true);
  store.placeSandboxTroop(sandbox.id, 'alice', 2, 'canyon-ibex', '1,2');
  store.placeSandboxTroop(sandbox.id, 'alice', 1, 'snowy-owl', '1,2');
  const state = store.getState(sandbox.id);
  assert.equal(state.sandboxFreePlacement, true);
  assert.deepEqual(state.units.map(unit => `${unit.owner}:${unit.troopId}@${unit.coordinate}`), ['1:snowy-owl@1,2']);
});

test('out-of-range selections are rejected before they can be shared as pending targets', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  const match = store.matches.get(created.id);
  match.game.units = [{ id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 }];

  assert.throws(
    () => store.setSelection(created.id, created.players[1], 'tiger-queen', { type: 'move', coordinate: '-3,-4' }),
    /Destination is out of range/
  );
  const state = store.getState(created.id);
  assert.equal(state.selections[1], undefined);
  assert.equal(state.targetSelections[1], undefined);
});

test('public state publishes engine-generated legal actions for the selected troop', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  const match = store.matches.get(created.id);
  match.game.units = [
    { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
    { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '1,0', permanentDamage: 0 }
  ];
  const selected = store.setSelection(created.id, created.players[1], 'tiger-queen');
  assert.equal(selected.legalActions[1].some(action => action.type === 'move' && action.coordinate === '1,1'), true);
  assert.equal(selected.legalActions[1].some(action => action.type === 'move' && action.coordinate === '1,0'), true);
});

test('accepted actions update the revisioned public state', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const starter = created.players[1];
  const next = store.applyAction(created.id, starter, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
  assert.equal(next.revision, 1);
  assert.equal(next.units[0].currentHealth, 6);
  assert.deepEqual(next.events[0].action, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
});

test('diagnostic logs retain board snapshots alongside each accepted action', () => {
  const store = new MatchStore(cards);
  const created = store.createMatch('alice', 'bob', deck, deck, 8);
  store.setReady(created.id, 'alice');
  store.setReady(created.id, 'bob');
  const starter = created.players[1];
  store.applyAction(created.id, starter, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
  const log = store.diagnosticLog(created.id);
  const action = log.snapshots.find(snapshot => snapshot.kind === 'action');
  assert.deepEqual(action.action, { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' });
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
      { id: '1:tiger-queen', troopId: 'tiger-queen', owner: 1, coordinate: '1,2', permanentDamage: 0 },
      { id: '2:tiger-queen', troopId: 'tiger-queen', owner: 2, coordinate: '-1,-2', permanentDamage: 0 }
    ],
    effects: [], bashes: [], lastActingTroopId: { 2: 'tiger-queen' },
    defeatedTroopIds: deck.slice(1).map(troopId => `2:${troopId}`)
  };
  const state = store.applyAction(created.id, created.players[1], { type: 'move', troopId: 'tiger-queen', coordinate: '1,1' });
  assert.equal(state.winner, 1);
  assert.equal(state.status, 'finished');
});
