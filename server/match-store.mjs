import { randomUUID } from 'node:crypto';
import { applyGameAction, controlSummary, createGameState, unitId } from '../game/engine.js';

function isBoardCoordinate(coordinate) {
  if (typeof coordinate !== 'string') return false;
  const match = coordinate.match(/^(-?\d+),(-?\d+)$/);
  if (!match) return false;
  const [x, y] = match.slice(1).map(Number);
  return x >= -3 && x <= 3 && y >= -4 && y <= 4 && x - y >= -3 && x - y <= 3 && coordinate !== '0,0';
}

function distance(from, to) {
  const [fromX, fromY] = from.split(',').map(Number);
  const [toX, toY] = to.split(',').map(Number);
  return Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), Math.abs((toX - toY) - (fromX - fromY)));
}

function selectionTargetIsOutOfRange(match, player, troopId, target, cardsById) {
  const unit = match.game.units.find(candidate => candidate.owner === player && candidate.troopId === troopId);
  if (!unit || target.type === 'deploy' || target.type === 'self-defense') return false;
  const card = cardsById.get(troopId);
  const action = card?.actions.find(candidate => candidate.type === target.type);
  const rightUpgrade = ability => (unit.upgrades ?? []).filter(upgrade => upgrade.ability === ability || upgrade.ability === undefined).reduce((sum, upgrade) => sum + (upgrade.right ?? 0), 0);
  const maxDistance = action && (target.type === 'push' && 'range' in action
    ? action.range + rightUpgrade('push')
    : 'maxDistance' in action ? action.maxDistance + rightUpgrade(target.type)
    : 'range' in action ? action.range + rightUpgrade(target.type) + (target.type === 'attack' ? unit.rangedRangeBonus ?? 0 : 0) : undefined);
  return typeof maxDistance === 'number' && distance(unit.coordinate, target.coordinate) > maxDistance;
}

export class MatchStore {
  constructor(cardsById) {
    this.cardsById = cardsById;
    this.matches = new Map();
  }

  createMatch(firstNickname, secondNickname, firstDeck, secondDeck, format = 10) {
    const id = randomUUID();
    // Player 1 is always red and takes the first turn.  The server, rather
    // than queue order or either client, chooses who receives that side.
    const firstStarts = Math.random() < 0.5;
    const playerOne = firstStarts ? firstNickname : secondNickname;
    const playerTwo = firstStarts ? secondNickname : firstNickname;
    const deckOne = firstStarts ? firstDeck : secondDeck;
    const deckTwo = firstStarts ? secondDeck : firstDeck;
    const match = {
      id,
      revision: 0,
      status: 'active',
      players: { 1: playerOne, 2: playerTwo },
      format,
      ready: { 1: false, 2: false },
      decks: { 1: [...deckOne], 2: [...deckTwo] },
      deckChoices: { 1: undefined, 2: undefined },
      selections: { 1: undefined, 2: undefined },
      targetSelections: { 1: undefined, 2: undefined },
      game: createGameState(),
      events: [],
      diagnostics: { createdAt: new Date().toISOString(), snapshots: [] }
    };
    this.matches.set(id, match);
    this.recordDiagnostic(match, { kind: 'created' });
    return this.publicState(match);
  }

  recordDiagnostic(match, entry) {
    match.diagnostics ??= { createdAt: new Date().toISOString(), snapshots: [] };
    match.diagnostics.snapshots ??= [];
    match.diagnostics.snapshots.push({
      at: new Date().toISOString(),
      ...structuredClone(entry),
      state: this.publicState(match)
    });
  }

  diagnosticLog(matchId) {
    const match = this.matches.get(matchId);
    if (!match) return undefined;
    match.diagnostics ??= { createdAt: new Date().toISOString(), snapshots: [] };
    return structuredClone({
      matchId: match.id,
      createdAt: match.diagnostics.createdAt,
      snapshots: match.diagnostics.snapshots,
      finalState: this.publicState(match)
    });
  }

  playerFor(matchId, nickname) {
    const match = this.matches.get(matchId);
    if (!match) return undefined;
    if (match.sandboxOwner === nickname) return match.sandboxSide ?? 1;
    if (match.players[1] === nickname) return 1;
    if (match.players[2] === nickname) return 2;
    return undefined;
  }

  createSandbox(nickname, state) {
    // A nickname has one active sandbox. Replacing the transient match keeps
    // browser reload/resume deterministic while the explicit save file keeps
    // any checkpoint the player wants to return to.
    for (const [matchId, existing] of this.matches) {
      if (existing.sandboxOwner === nickname) this.matches.delete(matchId);
    }
    const id = randomUUID();
    const game = {
      activePlayer: state.activePlayer,
      winner: state.winner,
      units: state.units.map(({ currentHealth, ...unit }) => unit),
      effects: structuredClone(state.effects ?? []), bashes: structuredClone(state.bashes ?? []),
      lastActingTroopId: structuredClone(state.lastActingTroopId ?? {}),
      defeatedTroopIds: [...(state.defeatedTroopIds ?? [])], revision: state.revision ?? 0,
      events: structuredClone(state.events ?? []), triggerEvents: []
    };
    // A saved sandbox resumes on the side whose turn it is. Starting a new
    // sandbox already supplies activePlayer 1, while a saved Blue turn must
    // not reopen as a non-interactive Red view.
    const match = { id, revision: game.revision, status: 'active', sandboxOwner: nickname, sandboxSide: game.activePlayer, sandboxFreePlacement: false,
      players: { 1: nickname, 2: nickname }, format: state.format, ready: { 1: true, 2: true },
      decks: structuredClone(state.decks), deckChoices: { 1: 0, 2: 0 }, selections: { 1: undefined, 2: undefined }, targetSelections: { 1: undefined, 2: undefined },
      game, diagnostics: { createdAt: new Date().toISOString(), snapshots: [] } };
    this.matches.set(id, match); this.recordDiagnostic(match, { kind: 'sandbox-created', player: 1, nickname });
    return this.publicState(match);
  }

  setSandboxSide(matchId, nickname, side) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname || (side !== 1 && side !== 2)) throw new Error('Sandbox is unavailable.');
    match.sandboxSide = side; return this.publicState(match);
  }

  removeSandboxFor(nickname) {
    let removed = false;
    for (const [matchId, match] of this.matches) {
      if (match.sandboxOwner === nickname) { this.matches.delete(matchId); removed = true; }
    }
    return removed;
  }

  setSandboxFreePlacement(matchId, nickname, enabled) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname || typeof enabled !== 'boolean') throw new Error('Sandbox is unavailable.');
    match.sandboxFreePlacement = enabled;
    this.recordDiagnostic(match, { kind: 'sandbox-free-placement', enabled, nickname });
    return this.publicState(match);
  }

  placeSandboxTroop(matchId, nickname, owner, troopId, coordinate) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname || !match.sandboxFreePlacement) throw new Error('Free placement is not enabled.');
    if ((owner !== 1 && owner !== 2) || !match.decks[owner].includes(troopId) || !isBoardCoordinate(coordinate)) throw new Error('Invalid sandbox placement.');
    const unit = match.game.units.find(candidate => candidate.owner === owner && candidate.troopId === troopId);
    const occupant = match.game.units.find(candidate => candidate.coordinate === coordinate && candidate !== unit);
    if (occupant) {
      if (unit) occupant.coordinate = unit.coordinate;
      else match.game.units = match.game.units.filter(candidate => candidate !== occupant);
    }
    if (unit) unit.coordinate = coordinate;
    else match.game.units.push({ troopId, owner, coordinate, permanentDamage: 0 });
    match.game.defeatedTroopIds = (match.game.defeatedTroopIds ?? []).filter(id => id !== `${owner}:${troopId}`);
    match.game.winner = undefined;
    match.game.revision = (match.game.revision ?? 0) + 1;
    match.selections = { 1: undefined, 2: undefined }; match.targetSelections = { 1: undefined, 2: undefined };
    this.recordDiagnostic(match, { kind: 'sandbox-placement', nickname, owner, troopId, coordinate });
    return this.publicState(match);
  }

  publicState(match) {
    return {
      id: match.id,
      revision: match.game.revision,
      status: match.game.winner ? 'finished' : match.status,
      activePlayer: match.game.activePlayer,
      players: { ...match.players },
      sandbox: Boolean(match.sandboxOwner), sandboxSide: match.sandboxSide, sandboxFreePlacement: Boolean(match.sandboxFreePlacement),
      format: match.format,
      ready: { ...match.ready },
      deckChoices: { ...match.deckChoices },
      selections: { ...match.selections },
      targetSelections: structuredClone(match.targetSelections ?? { 1: undefined, 2: undefined }),
      // Decks and all board state are deliberately included: a reconnecting
      // client can redraw a match without retaining any local game state.
      decks: { 1: [...match.decks[1]], 2: [...match.decks[2]] },
      units: match.game.units.map(unit => ({ ...unit, id: unitId(unit), currentHealth: Math.max(0, (this.cardsById.get(unit.troopId)?.baseHealth ?? 0) - unit.permanentDamage) })),
      defeatedTroopIds: [...(match.game.defeatedTroopIds ?? [])],
      effects: structuredClone(match.game.effects),
      bashes: structuredClone(match.game.bashes),
      triggerEvents: structuredClone(match.game.triggerEvents?.slice(-100) ?? []),
      lastActingTroopId: { ...(match.game.lastActingTroopId ?? {}) },
      winner: match.game.winner,
      control: controlSummary(match.game, this.cardsById),
      events: structuredClone(match.game.events?.slice(-100) ?? [])
    };
  }

  getState(matchId) {
    const match = this.matches.get(matchId);
    return match ? this.publicState(match) : undefined;
  }

  setReady(matchId, nickname) {
    const match = this.matches.get(matchId); const player = this.playerFor(matchId, nickname);
    if (!match || !player) throw new Error('Match or player not found.');
    if (match.decks[player].length !== match.format) throw new Error(`Choose a completed ${match.format}-card deck first.`);
    match.ready[player] = true;
    this.recordDiagnostic(match, { kind: 'ready', player, nickname });
    return this.publicState(match);
  }

  setDeck(matchId, nickname, deck, deckIndex) {
    const match = this.matches.get(matchId); const player = this.playerFor(matchId, nickname);
    if (!match || !player) throw new Error('Match or player not found.');
    if (match.ready[player]) throw new Error('Your deck is already locked in.');
    if (!Array.isArray(deck) || deck.length !== match.format) throw new Error(`Choose a completed ${match.format}-card deck.`);
    match.decks[player] = [...deck];
    match.deckChoices[player] = deckIndex;
    this.recordDiagnostic(match, { kind: 'deck-selected', player, nickname, deckIndex });
    return this.publicState(match);
  }

  matchForNickname(nickname) {
    // A real game always takes precedence over a sandbox left open in another
    // tab. This prevents a sandbox snapshot from being resumed as a match.
    for (const match of this.matches.values()) if (!match.sandboxOwner && (match.players[1] === nickname || match.players[2] === nickname)) return this.publicState(match);
    for (const match of this.matches.values()) if (match.sandboxOwner === nickname) return this.publicState(match);
    return undefined;
  }

  snapshot() { return [...this.matches.entries()]; }
  restore(entries) {
    this.matches = new Map(Array.isArray(entries) ? entries : []);
    for (const match of this.matches.values()) {
      match.deckChoices ??= { 1: undefined, 2: undefined };
      match.selections ??= { 1: undefined, 2: undefined };
      match.targetSelections ??= { 1: undefined, 2: undefined };
      match.sandboxFreePlacement ??= false;
      match.diagnostics ??= { createdAt: new Date().toISOString(), snapshots: [] };
    }
  }

  applyAction(matchId, nickname, action) {
    const match = this.matches.get(matchId);
    const player = this.playerFor(matchId, nickname);
    if (!match || !player) throw new Error('Match or player not found.');
    if (match.status !== 'active' || !match.ready[1] || !match.ready[2]) throw new Error('Both players must be ready.');
    if (match.game.activePlayer !== player) throw new Error('It is not your turn.');
    if (!action || typeof action.type !== 'string') throw new Error('Invalid action.');

    if (action.type !== 'pass' && !match.decks[player].includes(action.troopId)) throw new Error('Troop is not in your deck.');
    match.game = applyGameAction(match.game, player, action, this.cardsById);
    // A player cannot repeat the troop that acted on their preceding turn.
    // If that was their final living card, they have no legal action when the
    // turn passes and immediately lose the match.
    const nextPlayer = match.game.activePlayer;
    // A sandbox has one browser controlling both sides. Follow the turn so
    // the next side is immediately interactive without a manual side swap.
    if (match.sandboxOwner) match.sandboxSide = nextPlayer;
    const lastActor = match.game.lastActingTroopId?.[nextPlayer];
    const hasAvailableCard = match.decks[nextPlayer].some(troopId =>
      troopId !== lastActor && !match.game.defeatedTroopIds?.includes(`${nextPlayer}:${troopId}`)
    );
    if (!hasAvailableCard) match.game.winner = nextPlayer === 1 ? 2 : 1;
    // A completed action is no longer a selection. The acting troop is shown
    // by its authoritative unavailable/grey state instead.
    match.selections[player] = undefined;
    match.targetSelections[player] = undefined;
    this.recordDiagnostic(match, { kind: 'action', player, nickname, action: structuredClone(action) });
    return this.publicState(match);
  }

  setSelection(matchId, nickname, troopId, target) {
    const match = this.matches.get(matchId); const player = this.playerFor(matchId, nickname);
    if (!match || !player) throw new Error('Match or player not found.');
    if (troopId !== undefined && (!match.decks[player].includes(troopId) || match.game.defeatedTroopIds?.includes(`${player}:${troopId}`))) {
      throw new Error('Troop cannot be selected.');
    }
    match.selections[player] = troopId;
    if (target !== undefined && (typeof target !== 'object' || target === null || !troopId || !isBoardCoordinate(target.coordinate) || typeof target.type !== 'string')) throw new Error('Invalid action target.');
    if (target !== undefined && selectionTargetIsOutOfRange(match, player, troopId, target, this.cardsById)) throw new Error('Destination is out of range.');
    match.targetSelections[player] = target && troopId ? { troopId, type: target.type, coordinate: target.coordinate } : undefined;
    this.recordDiagnostic(match, { kind: 'selection', player, nickname, troopId, target: structuredClone(match.targetSelections[player]) });
    return this.publicState(match);
  }

  deploy(match, player, action) {
    const card = this.cardsById.get(action.troopId);
    if (!card || !match.decks[player].includes(action.troopId)) throw new Error('Troop is not in your deck.');
    if (!isBoardCoordinate(action.coordinate)) throw new Error('Invalid board coordinate.');
    if (match.units.some(unit => unit.coordinate === action.coordinate)) throw new Error('Hex is occupied.');
    if (match.units.some(unit => unit.owner === player && unit.troopId === action.troopId)) throw new Error('Troop is already deployed.');
    const heroDeployed = match.units.some(unit => unit.owner === player && this.cardsById.get(unit.troopId)?.role === 'hero');
    if (card.role !== 'hero' && !heroDeployed) throw new Error('Deploy your hero first.');
    match.units.push({ troopId: action.troopId, owner: player, coordinate: action.coordinate, permanentDamage: 0 });
  }

  move(match, player, action) {
    const unit = match.units.find(candidate => candidate.owner === player && candidate.troopId === action.troopId);
    if (!unit) throw new Error('Your troop is not deployed.');
    if (!isBoardCoordinate(action.coordinate) || match.units.some(candidate => candidate.coordinate === action.coordinate)) throw new Error('Destination is unavailable.');
    const card = this.cardsById.get(unit.troopId);
    const move = card?.actions.find(candidate => candidate.type === 'move');
    if (!move || distance(unit.coordinate, action.coordinate) > move.maxDistance) throw new Error('Destination is out of range.');
    unit.coordinate = action.coordinate;
  }
}
