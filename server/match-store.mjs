import { randomUUID } from 'node:crypto';
import { isBoardCoordinate } from '../dist/game/board.js';
import { applyGameAction, availableActionsFor, combatSummary, controlSummary, createGameState, unitId } from '../dist/game/engine.js';

export class MatchStore {
  constructor(cardsById) {
    this.cardsById = cardsById;
    this.matches = new Map();
  }

  #matchAndPlayer(matchId, nickname) {
    const match = this.matches.get(matchId);
    const player = this.playerFor(matchId, nickname);
    if (!match || !player) throw new Error('Match or player not found.');
    return { match, player };
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
      status: 'active',
      players: { 1: playerOne, 2: playerTwo },
      format,
      ready: { 1: false, 2: false },
      decks: { 1: [...deckOne], 2: [...deckTwo] },
      deckChoices: { 1: undefined, 2: undefined },
      selections: { 1: undefined, 2: undefined },
      targetSelections: { 1: undefined, 2: undefined },
      game: createGameState({ 1: deckOne, 2: deckTwo }),
      diagnostics: { createdAt: new Date().toISOString(), snapshots: [] }
    };
    this.matches.set(id, match);
    return this.recordDiagnostic(match, { kind: 'created' });
  }

  recordDiagnostic(match, entry) {
    match.diagnostics ??= { createdAt: new Date().toISOString(), snapshots: [] };
    match.diagnostics.snapshots ??= [];
    const state = this.publicState(match);
    match.diagnostics.snapshots.push({
      at: new Date().toISOString(),
      ...structuredClone(entry),
      state: structuredClone(state)
    });
    return state;
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
    this.removeSandboxFor(nickname);
    const id = randomUUID();
    const game = {
      activePlayer: state.activePlayer,
      phase: state.phase ?? (state.pendingResolution ? 'end' : 'action'),
      winner: state.winner,
      units: state.units.map(({ currentHealth: _currentHealth, combat: _combat, ...unit }) => unit),
      effects: structuredClone(state.effects ?? []), bashes: structuredClone(state.bashes ?? []), bombs: structuredClone(state.bombs ?? []),
      pendingResolution: structuredClone(state.pendingResolution),
      pendingResolutionQueue: structuredClone(state.pendingResolutionQueue ?? []),
      lastActingTroopId: structuredClone(state.lastActingTroopId ?? {}),
      defeatedTroopIds: [...(state.defeatedTroopIds ?? [])], revision: state.revision ?? 0,
      events: structuredClone(state.events ?? []), triggerEvents: [],
      dashboard: structuredClone(state.dashboard ?? []), resolutionStack: [...(state.resolutionStack ?? [])], currentEventId: state.currentEventId, nextDashboardId: state.nextDashboardId ?? 1,
      deckOrder: { 1: [...state.decks[1]], 2: [...state.decks[2]] }
    };
    for (const bash of game.bashes) {
      const attacker = game.units.find(unit => unit.id === bash.attackerId || `${unit.owner}:${unit.troopId}` === bash.attackerId);
      if (attacker) attacker.coordinate = bash.target;
    }
    // A saved sandbox resumes on the side whose turn it is. New playgrounds
    // start with Blue, while saved checkpoints retain their exact turn.
    const match = {
      id,
      status: 'active',
      sandboxOwner: nickname,
      sandboxSide: game.activePlayer,
      sandboxFreePlacement: false,
      players: { 1: nickname, 2: nickname },
      format: state.format,
      ready: { 1: true, 2: true },
      decks: structuredClone(state.decks),
      deckChoices: { 1: 0, 2: 0 },
      selections: { 1: undefined, 2: undefined },
      targetSelections: { 1: undefined, 2: undefined },
      game,
      diagnostics: { createdAt: new Date().toISOString(), snapshots: [] }
    };
    this.matches.set(id, match);
    return this.recordDiagnostic(match, { kind: 'sandbox-created', player: game.activePlayer, nickname });
  }

  setSandboxSide(matchId, nickname, side) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname || (side !== 1 && side !== 2)) throw new Error('Playground is unavailable.');
    match.sandboxSide = side;
    return this.publicState(match);
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
    if (!match || match.sandboxOwner !== nickname || typeof enabled !== 'boolean') throw new Error('Playground is unavailable.');
    match.sandboxFreePlacement = enabled;
    return this.recordDiagnostic(match, { kind: 'sandbox-free-placement', enabled, nickname });
  }

  placeSandboxTroop(matchId, nickname, owner, troopId, coordinate) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname || !match.sandboxFreePlacement) throw new Error('Free placement is not enabled.');
    if ((owner !== 1 && owner !== 2) || !match.decks[owner].includes(troopId) || !isBoardCoordinate(coordinate)) throw new Error('Invalid sandbox placement.');
    this.#rememberSandbox(match);
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
    match.selections = { 1: undefined, 2: undefined };
    match.targetSelections = { 1: undefined, 2: undefined };
    return this.recordDiagnostic(match, { kind: 'sandbox-placement', nickname, owner, troopId, coordinate });
  }

  undoSandbox(matchId, nickname) {
    const match = this.matches.get(matchId);
    if (!match || match.sandboxOwner !== nickname) throw new Error('Playground not found.');
    if (!match.sandboxUndo) throw new Error('There is no playground action to undo.');
    const previous = match.sandboxUndo;
    match.game = previous.game;
    match.sandboxSide = previous.sandboxSide;
    match.selections = previous.selections;
    match.targetSelections = previous.targetSelections;
    match.sandboxUndo = undefined;
    return this.recordDiagnostic(match, { kind: 'sandbox-undo', nickname });
  }

  publicState(match) {
    const legalActions = {};
    for (const player of [1, 2]) {
      const troopId = match.selections?.[player];
      if (troopId) legalActions[player] = availableActionsFor(match.game, player, troopId, this.cardsById);
    }
    return {
      id: match.id,
      revision: match.game.revision,
      status: match.game.winner ? 'finished' : match.status,
      activePlayer: match.game.activePlayer,
      phase: match.game.phase ?? (match.game.pendingResolution ? 'end' : 'action'),
      players: { ...match.players },
      sandbox: Boolean(match.sandboxOwner), sandboxSide: match.sandboxSide, sandboxFreePlacement: Boolean(match.sandboxFreePlacement), sandboxUndoAvailable: Boolean(match.sandboxOwner && match.sandboxUndo),
      format: match.format,
      ready: { ...match.ready },
      deckChoices: { ...match.deckChoices },
      selections: { ...match.selections },
      targetSelections: structuredClone(match.targetSelections ?? { 1: undefined, 2: undefined }),
      legalActions,
      // Decks and all board state are deliberately included: a reconnecting
      // client can redraw a match without retaining any local game state.
      decks: { 1: [...match.decks[1]], 2: [...match.decks[2]] },
      units: match.game.units.map(unit => {
        const id = unitId(unit);
        const bash = match.game.bashes.find(item => item.attackerId === id || item.defenderId === id);
        const combat = combatSummary(match.game, id, this.cardsById, bash?.target);
        return { ...unit, id, currentHealth: combat.health, combat };
      }),
      defeatedTroopIds: [...(match.game.defeatedTroopIds ?? [])],
      effects: structuredClone(match.game.effects),
      bashes: structuredClone(match.game.bashes),
      bombs: structuredClone(match.game.bombs ?? []),
      pendingResolution: structuredClone(match.game.pendingResolution),
      triggerEvents: structuredClone(match.game.triggerEvents?.slice(-100) ?? []),
      dashboard: structuredClone(match.game.dashboard ?? []),
      resolutionStack: [...(match.game.resolutionStack ?? [])],
      currentEventId: match.game.currentEventId,
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
    const { match, player } = this.#matchAndPlayer(matchId, nickname);
    if (match.decks[player].length !== match.format) throw new Error(`Choose a completed ${match.format}-card deck first.`);
    match.ready[player] = true;
    return this.recordDiagnostic(match, { kind: 'ready', player, nickname });
  }

  setDeck(matchId, nickname, deck, deckIndex) {
    const { match, player } = this.#matchAndPlayer(matchId, nickname);
    if (match.ready[player]) throw new Error('Your deck is already locked in.');
    if (!Array.isArray(deck) || deck.length !== match.format) throw new Error(`Choose a completed ${match.format}-card deck.`);
    match.decks[player] = [...deck];
    match.deckChoices[player] = deckIndex;
    return this.recordDiagnostic(match, { kind: 'deck-selected', player, nickname, deckIndex });
  }

  matchForNickname(nickname) {
    // A real game always takes precedence over a sandbox left open in another
    // tab. This prevents a sandbox snapshot from being resumed as a match.
    let sandbox;
    for (const match of this.matches.values()) {
      if (!match.sandboxOwner && (match.players[1] === nickname || match.players[2] === nickname)) return this.publicState(match);
      if (match.sandboxOwner === nickname) sandbox = match;
    }
    return sandbox ? this.publicState(sandbox) : undefined;
  }

  snapshot() { return [...this.matches.entries()]; }
  restore(entries) {
    this.matches = new Map(Array.isArray(entries) ? entries : []);
    for (const match of this.matches.values()) {
      match.deckChoices ??= { 1: undefined, 2: undefined };
      match.selections ??= { 1: undefined, 2: undefined };
      match.targetSelections ??= { 1: undefined, 2: undefined };
      match.sandboxFreePlacement ??= false;
      match.game.bombs ??= [];
      match.game.phase ??= match.game.pendingResolution ? 'end' : 'action';
      match.game.dashboard ??= [];
      match.game.resolutionStack ??= [];
      match.game.nextDashboardId ??= (match.game.dashboard.at(-1)?.id ?? 0) + 1;
      match.game.deckOrder ??= { 1: [...match.decks[1]], 2: [...match.decks[2]] };
      match.diagnostics ??= { createdAt: new Date().toISOString(), snapshots: [] };
      for (const bash of match.game?.bashes ?? []) {
        const attacker = match.game.units.find(unit => unit.id === bash.attackerId || `${unit.owner}:${unit.troopId}` === bash.attackerId);
        if (attacker) attacker.coordinate = bash.target;
      }
    }
  }

  applyAction(matchId, nickname, action) {
    const { match, player } = this.#matchAndPlayer(matchId, nickname);
    if (match.status !== 'active' || !match.ready[1] || !match.ready[2]) throw new Error('Both players must be ready.');
    if ((match.game.pendingResolution?.owner ?? match.game.activePlayer) !== player) throw new Error('It is not your turn.');
    if (!action || typeof action.type !== 'string') throw new Error('Invalid action.');

    if (action.type !== 'pass' && !match.decks[player].includes(action.troopId)) throw new Error('Troop is not in your deck.');
    if (match.sandboxOwner) this.#rememberSandbox(match);
    match.game = applyGameAction(match.game, player, action, this.cardsById);
    if (match.game.pendingResolution) {
      const resolutionOwner = match.game.pendingResolution.owner;
      match.selections[player] = undefined;
      match.selections[resolutionOwner] = match.game.pendingResolution.sourceTroopId;
      match.targetSelections[player] = undefined;
      match.targetSelections[resolutionOwner] = undefined;
      if (match.sandboxOwner) match.sandboxSide = resolutionOwner;
      return this.recordDiagnostic(match, { kind: 'action', player, nickname, action: structuredClone(action) });
    }
    // A player cannot repeat the troop that acted on their preceding turn.
    // If that was their final living card, they have no legal action when the
    // turn passes and immediately lose the match.
    const nextPlayer = match.game.activePlayer;
    // A sandbox has one browser controlling both sides. Follow the turn so
    // the next side is immediately interactive without a manual side swap.
    if (match.sandboxOwner) match.sandboxSide = nextPlayer;
    const lastActor = match.game.lastActingTroopId?.[nextPlayer];
    const hasNonStunnedCard = match.decks[nextPlayer].some(troopId =>
      !match.game.defeatedTroopIds?.includes(`${nextPlayer}:${troopId}`)
      && !(match.game.units.find(unit => unit.owner === nextPlayer && unit.troopId === troopId)?.stunnedTurns ?? 0)
    );
    const hasAvailableCard = match.decks[nextPlayer].some(troopId =>
      troopId !== lastActor
      && !match.game.defeatedTroopIds?.includes(`${nextPlayer}:${troopId}`)
      && !(match.game.units.find(unit => unit.owner === nextPlayer && unit.troopId === troopId)?.stunnedTurns ?? 0)
    );
    if (hasNonStunnedCard && !hasAvailableCard) match.game.winner = nextPlayer === 1 ? 2 : 1;
    // A completed action is no longer a selection. The acting troop is shown
    // by its authoritative unavailable/grey state instead.
    match.selections[player] = undefined;
    match.targetSelections[player] = undefined;
    return this.recordDiagnostic(match, { kind: 'action', player, nickname, action: structuredClone(action) });
  }

  #rememberSandbox(match) {
    match.sandboxUndo = {
      game: structuredClone(match.game),
      sandboxSide: match.sandboxSide,
      selections: structuredClone(match.selections ?? { 1: undefined, 2: undefined }),
      targetSelections: structuredClone(match.targetSelections ?? { 1: undefined, 2: undefined })
    };
  }

  setSelection(matchId, nickname, troopId, target) {
    const { match, player } = this.#matchAndPlayer(matchId, nickname);
    if (match.game.pendingResolution) {
      if (match.game.pendingResolution.owner !== player || troopId !== match.game.pendingResolution.sourceTroopId) throw new Error('Resolve the pending event action first.');
    }
    if (troopId !== undefined && (!match.decks[player].includes(troopId) || match.game.defeatedTroopIds?.includes(`${player}:${troopId}`))) {
      throw new Error('Troop cannot be selected.');
    }
    if (target !== undefined && (typeof target !== 'object' || target === null || !troopId || !isBoardCoordinate(target.coordinate) || typeof target.type !== 'string')) throw new Error('Invalid action target.');
    if (target !== undefined) {
      const available = availableActionsFor(match.game, player, troopId, this.cardsById);
      const targetIsAvailable = available.some(action =>
        action.type === target.type
        && (action.type === 'self-defense' || ('coordinate' in action && action.coordinate === target.coordinate))
      );
      if (!targetIsAvailable) throw new Error('Destination is out of range.');
    }
    match.selections[player] = troopId;
    match.targetSelections[player] = target && troopId ? { troopId, type: target.type, coordinate: target.coordinate } : undefined;
    return this.recordDiagnostic(match, { kind: 'selection', player, nickname, troopId, target: structuredClone(match.targetSelections[player]) });
  }
}
