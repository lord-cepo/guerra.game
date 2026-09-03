import type { UpgradableAbility } from '../game/cards.js';
import { adjacentCoordinates, hexDistance, straightLine, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import { appendHoverRules, createHoverCard } from './card-presentation.js';
import type { HexGridState } from './hex-grid-state.js';
import type { GameActionType, ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';
import { catalogueById, type Troop } from './troop-view.js';

interface MatchBoardActionsContext {
  state: HexGridState;
  hoverDetailsPanel: HTMLElement;
  send(message: object): void;
  renderServerMatchState(match: ServerMatchState): void;
  renderServerActionBar(match: ServerMatchState, player: Player): void;
  serverPendingMovementPreview(): { unit: ServerUnitState; coordinate: Coordinate } | undefined;
  serverPendingUnitPreviews(): ServerUnitState[];
  serverPendingBash(): ServerBashState | undefined;
  queueCurrentMovementPreviewReturn(): void;
  serverBashIsDodged(bash: ServerBashState, match?: ServerMatchState): boolean;
  serverTroop(cardId: string, owner: Player, unit?: ServerUnitState): Troop | undefined;
  serverModifier(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): number;
  serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): Array<{ label: string; value: number }>;
}

export function createMatchBoardActions(context: MatchBoardActionsContext) {
  const {
    state, hoverDetailsPanel, renderServerMatchState, renderServerActionBar,
    serverPendingMovementPreview, serverPendingUnitPreviews, serverPendingBash,
    queueCurrentMovementPreviewReturn, serverBashIsDodged, serverTroop,
    serverModifier, serverModifierEntries,
  } = context;
function selectedServerUnit(): ServerUnitState | undefined {
  return state.serverMatch?.units.find(unit => unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId);
}

function selectedServerLegalActions(): ServerLegalAction[] {
  if (!state.serverMatch || !state.localMatchPlayer || state.serverMatch.selections?.[state.localMatchPlayer] !== state.serverSelectedTroopId) return [];
  return state.serverMatch.legalActions?.[state.localMatchPlayer] ?? [];
}

function clearServerSelection(): void {
  if (!state.serverMatch) return;
  queueCurrentMovementPreviewReturn();
  state.serverSelectedTroopId = undefined;
  state.serverSelectedAction = undefined;
  state.serverPendingAction = undefined;
  state.queuedMovementPreviewOrigin = undefined;
  state.serverPushTargetChoices = [];
  state.serverInspectedUnitId = undefined;
  clearServerPreviewPath();
  sendServerSelection(undefined);
  renderServerMatchState(state.serverMatch);
}

function sendServerSelection(troopId: string | undefined, target?: { type: GameActionType; coordinate: Coordinate }): void {
  if (!state.serverMatch) return;
  context.send({ type: 'select', matchId: state.serverMatch.id, troopId, target });
  const authoritative = state.serverAuthoritativeMatch ?? state.serverMatch;
  const pending = state.serverPendingAction;
  const complete = pending && (pending.type !== 'upgrade' || Boolean(pending.ability))
    && (pending.type !== 'push' && pending.type !== 'pull' && pending.type !== 'resolve-pull' || Boolean(pending.destination));
  if (target && pending && complete && authoritative) {
    const requestId = ++state.serverPreviewRequestId;
    context.send({ type: 'preview', requestId, matchId: authoritative.id, revision: authoritative.revision, action: pending });
  }
}

function sendServerAction(action: { type: GameActionType; troopId?: string; coordinate?: Coordinate; destination?: Coordinate; targetUnitId?: string; targetBomb?: boolean; ability?: UpgradableAbility }): void {
  if (state.serverMatch?.winner) return;
  if (!state.serverMatch) {
    state.serverActionError = 'Connection to the match server is unavailable.';
    if (state.serverMatch && state.localMatchPlayer) renderServerActionBar(state.serverMatch, state.localMatchPlayer);
    return;
  }
  state.serverActionError = undefined;
  context.send({ type: 'action', matchId: state.serverMatch.id, action });
}

function confirmServerPendingAction(): void {
  const action = state.serverPendingAction;
  if (!action) return;
  if (action.type === 'upgrade' && !action.ability) { state.serverActionError = 'Choose which ability to upgrade.'; if (state.serverMatch && state.localMatchPlayer) renderServerActionBar(state.serverMatch, state.localMatchPlayer); return; }
  state.serverPendingAction = undefined;
  state.queuedMovementPreviewOrigin = undefined;
  state.queuedMovementPreviewReturn = undefined;
  renderServerActionTargets();
  sendServerAction(action);
}

function stageServerDeployment(troopId: string, coordinate: Coordinate, action?: ServerLegalAction): void {
  if (!state.serverMatch || !state.localMatchPlayer || state.serverMatch.winner || state.serverMatch.activePlayer !== state.localMatchPlayer) return;
  state.serverSelectedTroopId = troopId;
  state.serverSelectedAction = 'deploy';
  state.serverPendingAction = action ? { ...action } : { type: 'deploy', troopId, coordinate };
  state.serverPushTargetChoices = [];
  state.serverActionError = undefined;
  sendServerSelection(troopId, { type: 'deploy', coordinate });
  renderServerMatchState(state.serverMatch);
}

function performServerActionAt(coordinate: Coordinate): void {
  if (!state.serverMatch || state.serverMatch.winner || !state.localMatchPlayer || !state.serverSelectedTroopId || !state.serverSelectedAction || (state.serverMatch.pendingResolution?.owner ?? state.serverMatch.activePlayer) !== state.localMatchPlayer) return;
  if (state.serverSelectedAction === 'self-defense' || state.serverSelectedAction === 'self-magic-defense') return;
  const candidates = selectedServerLegalActions().filter(action => action.type === state.serverSelectedAction && action.coordinate === coordinate);
  if ((state.serverSelectedAction === 'push' || state.serverSelectedAction === 'pull' || state.serverSelectedAction === 'resolve-pull') && candidates.length > 1) {
    state.serverPushTargetChoices = candidates;
    state.serverPendingAction = undefined;
    renderServerActionBar(state.serverMatch, state.localMatchPlayer);
    return;
  }
  const action = candidates[0];
  if (!action) return;
  if (action.type === 'deploy') {
    stageServerDeployment(action.troopId, coordinate, action);
    return;
  }
  const previousMovement = serverPendingMovementPreview();
  const previousBash = serverPendingBash();
  const nextMovementDestination = action.type === 'push' || action.type === 'pull' ? action.destination : action.coordinate;
  state.queuedMovementPreviewOrigin = previousMovement && nextMovementDestination
    ? {
      unitId: previousMovement.unit.id,
      coordinate: previousMovement.coordinate,
      wasBash: previousBash?.attackerId === previousMovement.unit.id,
      destination: nextMovementDestination,
    }
    : undefined;
  state.queuedMovementPreviewReturn = undefined;
  state.serverPendingAction = action.type === 'upgrade'
    ? { type: action.type, troopId: action.troopId, coordinate: action.coordinate }
    : { ...action };
  state.serverPushTargetChoices = [];
  sendServerSelection(state.serverSelectedTroopId, { type: state.serverSelectedAction, coordinate });
  // Movement previews are rendered once from the server's target-selection
  // echo. Rendering optimistically here would build the same animated group a
  // second time a few milliseconds later and visibly restart the motion.
  if (action.type !== 'move' && action.type !== 'fly' && action.type !== 'gore' && action.type !== 'push' && action.type !== 'pull' && action.type !== 'bomb' && action.type !== 'defense' && action.type !== 'magic-defense') renderServerMatchState(state.serverMatch);
}

function clearServerPreviewPath(): void {
  for (const coordinate of state.serverPreviewPath) state.cellsByCoordinate.get(coordinate)?.cell.classList.remove('movement-path');
  state.serverPreviewPath = [];
}

/** A UI-only free-path preview. The server still validates the submitted move. */
function serverMovePath(from: Coordinate, destination: Coordinate, maxDistance: number): Coordinate[] | undefined {
  if (!state.serverMatch || destination === from || destination === '0,0') return undefined;
  const occupied = new Map(state.serverMatch.units.map(unit => [unit.coordinate, unit]));
  const seen = new Set<Coordinate>([from]);
  const queue: Array<{ coordinate: Coordinate; path: Coordinate[] }> = [{ coordinate: from, path: [] }];
  while (queue.length > 0) {
    const current = queue.shift(); if (!current || current.path.length === maxDistance) continue;
    for (const next of adjacentCoordinates(current.coordinate)) {
      if (!state.cellsByCoordinate.has(next) || next === '0,0' || seen.has(next)) continue;
      const path = [...current.path, next];
      if (next === destination) return path;
      if (occupied.has(next)) continue;
      seen.add(next); queue.push({ coordinate: next, path });
    }
  }
  return undefined;
}

function previewServerPath(coordinate: Coordinate): void {
  clearServerPreviewPath();
  const unit = selectedServerUnit();
  const isLegalMove = selectedServerLegalActions().some(action => action.type === 'move' && action.coordinate === coordinate);
  if (!unit || state.serverSelectedAction !== 'move' || !isLegalMove) return;
  const path = serverMovePath(unit.coordinate, coordinate, state.cellsByCoordinate.size);
  if (!path) return;
  state.serverPreviewPath = path;
  for (const item of path) state.cellsByCoordinate.get(item)?.cell.classList.add('movement-path');
}

function showServerHoverDetailsForCoordinate(coordinate: Coordinate): void {
  if (!state.serverMatch) return;
  const bomb = state.serverMatch.bombs?.find(item => item.coordinate === coordinate);
  const bash = state.serverMatch.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, state.serverMatch));
  const unitPreview = serverPendingUnitPreviews().find(unit => unit.coordinate === coordinate);
  const unitAtCoordinate = state.serverMatch.units.find(unit => unit.coordinate === coordinate)
    ?? unitPreview;
  const units = bash
    ? [state.serverMatch.units.find(unit => unit.id === (state.serverBashReveal === 'attacker' ? bash.attackerId : bash.defenderId))]
    : [unitAtCoordinate];
  const displayed = units.filter((unit): unit is ServerUnitState => unit !== undefined);
  if (displayed.length === 0 && !bomb) return;
  hoverDetailsPanel.replaceChildren();
  // Match the fixed board layout: Red is described first, then Blue.
  for (const unit of displayed.sort((left, right) => left.owner - right.owner)) {
    const troop = serverTroop(unit.troopId, unit.owner, unit); if (!troop) continue;
    const { card, copy } = createHoverCard(troop);
    if (bash) {
      const modifier = serverModifier(unit, bash.target, bash);
      const combat = document.createElement('div'); combat.classList.add('hover-detail-line'); combat.textContent = `Bash strength: ${unit.combat.health} + ${modifier} = ${unit.combat.health + modifier}`; copy.append(combat);
      for (const entry of serverModifierEntries(unit, bash.target, bash)) {
        const source = document.createElement('div'); source.classList.add('hover-detail-line'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; copy.append(source);
      }
    }
    appendHoverRules(copy, troop);
    hoverDetailsPanel.append(card);
  }
  if (bomb) {
    const detail = document.createElement('div');
    detail.classList.add('hover-card', bomb.owner === 1 ? 'server-owner-one' : 'server-owner-two');
    const sourceName = catalogueById.get(bomb.sourceTroopId)?.name ?? bomb.sourceTroopId;
    detail.textContent = `💣 Bomb — ${bomb.damage}${bomb.pierce ? 'P' : ''} black-magic damage on this hex and all 6 adjacent hexes when lit by fire magic. It affects both players, ignores physical modifiers but is reduced by magic shields, resolves after the next action, then is removed. Another bomb thrown onto this hex merges its damage${bomb.pierce ? '; P means the blast pierces Obsidian magic immunity' : ''}. Thrown by ${sourceName}.`;
    hoverDetailsPanel.append(detail);
  }
  hoverDetailsPanel.hidden = false;
}

function renderServerActionTargets(): void {
  for (const { cell } of state.cellsByCoordinate.values()) cell.classList.remove('action-target', 'push-target', 'deployment-target', 'region-target', 'server-pending-target', 'server-pending-deployment', 'server-reachable');
  if (!state.serverSelectedAction) return;
  for (const action of selectedServerLegalActions()) {
    if (action.type !== state.serverSelectedAction || !action.coordinate) continue;
    const cell = state.cellsByCoordinate.get(action.coordinate)?.cell;
    if (!cell) continue;
    if (state.serverPendingAction?.coordinate !== action.coordinate) cell.classList.add('action-target');
    cell.classList.add('region-target', 'server-reachable');
    if (action.type === 'deploy') cell.classList.add('deployment-target');
    if (action.type === 'push' || action.type === 'pull') cell.classList.add('push-target');
  }
  if (state.serverPendingAction?.coordinate) {
    const pendingCell = state.cellsByCoordinate.get(state.serverPendingAction.coordinate)?.cell;
    pendingCell?.classList.add('server-pending-target', 'server-reachable');
    if (state.serverPendingAction.type === 'deploy') pendingCell?.classList.add('server-pending-deployment');
  }
  if ((state.serverPendingAction?.type === 'push' || state.serverPendingAction?.type === 'pull') && state.serverPendingAction.destination) {
    state.cellsByCoordinate.get(state.serverPendingAction.destination)?.cell.classList.add('server-pending-target', 'server-reachable');
  }
  // True-action Pull previews its complete displacement. Use the existing
  // soft pending fill rather than an SVG border; resolve-pull keeps the
  // triggered choice's compact endpoint-only presentation.
  if (state.serverPendingAction?.type === 'pull' && state.serverPendingAction.coordinate && state.serverPendingAction.destination) {
    const distance = hexDistance(state.serverPendingAction.coordinate, state.serverPendingAction.destination);
    for (const coordinate of straightLine(state.serverPendingAction.coordinate, state.serverPendingAction.destination, distance) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
  const unit = selectedServerUnit();
  if (unit && state.serverPendingAction?.type === 'cannon' && state.serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, state.serverPendingAction.coordinate, hexDistance(unit.coordinate, state.serverPendingAction.coordinate)) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
  if (unit && state.serverPendingAction?.type === 'gore' && state.serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, state.serverPendingAction.coordinate, hexDistance(unit.coordinate, state.serverPendingAction.coordinate)) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
}

  return {
    selectedServerUnit,
    selectedServerLegalActions,
    clearServerSelection,
    sendServerSelection,
    sendServerAction,
    confirmServerPendingAction,
    stageServerDeployment,
    performServerActionAt,
    clearServerPreviewPath,
    previewServerPath,
    showServerHoverDetailsForCoordinate,
    renderServerActionTargets,
  };
}
