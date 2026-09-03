import { regionAt, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import { signedModifier } from './board-descriptions.js';
import type { ServerMovementPreview } from './board-preview-projection.js';
import type { HexGridState } from './hex-grid-state.js';
import type { GameActionType, ServerBashState, ServerMatchState, ServerUnitState } from './protocol.js';
import { actionOfType, healthOf, upgradeBonus, type Troop } from './troop-view.js';

interface BoardCombatProjectionContext {
  board: SVGSVGElement;
  state: HexGridState;
  clearServerPreviewPath(): void;
  serverTroop(cardId: string, owner: Player, unit?: ServerUnitState): Troop | undefined;
  serverBashIsDodged(bash: ServerBashState, match?: ServerMatchState): boolean;
  serverPendingMovementPreview(): ServerMovementPreview | undefined;
}

export function createBoardCombatProjection(context: BoardCombatProjectionContext) {
  const {
    board: boardPanel, state, clearServerPreviewPath, serverTroop,
    serverBashIsDodged, serverPendingMovementPreview,
  } = context;
function clearServerBoardRender(): void {
  boardPanel.querySelectorAll<SVGElement>('[data-server-render]:not([data-server-render="death-animation"]), .board-troop:not(.death-resolution-card), .board-troop-description, .action-land, .bash-stat, .bash-icon').forEach(element => element.remove());
  clearServerPreviewPath();
  for (const { cell } of state.cellsByCoordinate.values()) {
    cell.classList.remove('server-controlled-one', 'server-controlled-two', 'server-contested', 'server-occupied', 'server-selected', 'server-selected-one', 'server-selected-two', 'server-last-acting', 'server-action-highlight', 'server-action-highlight-one', 'server-action-highlight-two', 'server-pending-target', 'server-pending-target-one', 'server-pending-target-two', 'server-pending-deployment', 'server-remote-pending-target', 'server-reachable', 'server-bash-target', 'bash-entering', 'bash-focus-left', 'bash-focus-right', 'damage-resolving', 'bash-resolving');
    cell.removeAttribute('tabindex');
    cell.removeAttribute('role');
    cell.removeAttribute('aria-label');
  }
}

function serverRegionController(match: ServerMatchState, coordinate: Coordinate, previewBash?: ServerBashState): Player | undefined {
  return serverControllerWithPreview(coordinate, previewBash, match);
}
function serverPreviewTargets(): Array<{ owner: Player; target: { troopId: string; type: GameActionType; coordinate: Coordinate } }> {
  if (!state.serverMatch) return [];
  const targets = Object.entries(state.serverMatch.targetSelections ?? {}).flatMap(([owner, target]) =>
    target ? [{ owner: Number(owner) as Player, target }] : []
  );
  if (!state.localMatchPlayer || !state.serverPendingAction?.coordinate) return targets;
  return [
    ...targets.filter(item => item.owner !== state.localMatchPlayer),
    { owner: state.localMatchPlayer, target: { troopId: state.serverPendingAction.troopId, type: state.serverPendingAction.type, coordinate: state.serverPendingAction.coordinate } }
  ];
}

/** Recalculate control with pending bashes and unconfirmed deployments included. */
function serverControllerWithPreview(coordinate: Coordinate, previewBash?: ServerBashState, match = state.serverMatch): Player | undefined {
  if (!match) return undefined;
  const region = regionAt(coordinate);
  if (!region) return undefined;
  let playerOne = region.home === 1 ? .5 : 0;
  let playerTwo = region.home === 2 ? .5 : 0;
  const bashTargets = new Map(match.bashes.filter(bash => !serverBashIsDodged(bash, match)).map(bash => [bash.attackerId, bash.target]));
  if (previewBash) bashTargets.set(previewBash.attackerId, previewBash.target);
  const movementPreview = serverPendingMovementPreview();
  for (const unit of match.units) {
    const unitCoordinate = movementPreview?.unit.id === unit.id
      ? movementPreview.coordinate
      : bashTargets.get(unit.id) ?? unit.coordinate;
    if (regionAt(unitCoordinate)?.id !== region.id) continue;
    if (unit.owner === 1) playerOne += unit.currentHealth;
    else playerTwo += unit.currentHealth;
  }
  if (match === state.serverMatch) {
    for (const { owner, target } of serverPreviewTargets()) {
      if (target.type !== 'deploy' || regionAt(target.coordinate)?.id !== region.id) continue;
      const troop = serverTroop(target.troopId, owner);
      if (!troop) continue;
      if (owner === 1) playerOne += healthOf(troop);
      else playerTwo += healthOf(troop);
    }
  }
  return playerOne === playerTwo ? undefined : playerOne > playerTwo ? 1 : 2;
}

function serverBashHasSteadyOpponent(unit: ServerUnitState, bash: ServerBashState | undefined): boolean {
  if (!bash || !state.serverMatch) return false;
  const opponentId = bash.attackerId === unit.id ? bash.defenderId : bash.attackerId;
  return state.serverMatch.units.find(candidate => candidate.id === opponentId)?.troopId === 'canyon-hawk';
}

function serverPreviewBlock(unit: ServerUnitState, coordinate: Coordinate): number {
  return serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .reduce((sum, { owner, target }) => {
      const source = state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const defense = troop ? actionOfType(troop, 'defense') : undefined;
      const value = target.type === 'self-defense'
        ? (troop?.selfDefense ?? 1) + (troop ? upgradeBonus(troop, 'self-defense').left : 0)
        : (defense?.block ?? 0) + (troop ? upgradeBonus(troop, 'defense').left : 0);
      return sum + value;
    }, 0);
}

function serverPreviewMagicBlock(unit: ServerUnitState, coordinate: Coordinate): number {
  return serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'magic-defense' || target.type === 'self-magic-defense'))
    .reduce((sum, { owner, target }) => {
      const source = state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const defense = troop ? actionOfType(troop, 'magic-defense') : undefined;
      const value = target.type === 'self-magic-defense'
        ? (troop?.selfMagicDefense ?? 0) + (troop ? upgradeBonus(troop, 'self-magic-defense').left : 0)
        : (defense?.block ?? 0) + (troop ? upgradeBonus(troop, 'magic-defense').left : 0);
      return sum + value;
    }, 0);
}

function serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): Array<{ label: string; value: number }> {
  if (!state.serverMatch) return [];
  if (serverBashHasSteadyOpponent(unit, bash)) return [];
  const entries: Array<{ label: string; value: number }> = unit.combat.modifiers
    .filter(entry => entry.label !== 'Shield' && entry.label !== 'Control')
    .map(entry => ({ ...entry }));
  const confirmedShields = unit.shields ?? [];
  const confirmedBlock = confirmedShields.reduce((sum, shield) => sum + shield.value, 0);
  const previewBlock = serverPreviewBlock(unit, coordinate);
  const block = confirmedBlock + previewBlock;
  if (block) entries.push({ label: 'Shield', value: block });
  if (bash && serverControllerWithPreview(coordinate, bash) === unit.owner) entries.push({ label: 'Control', value: 1 });
  return entries;
}

function serverModifier(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): number {
  if (!bash) {
    const previewBlock = serverPreviewBlock(unit, coordinate);
    if (!previewBlock || !state.serverMatch) return unit.combat.modifier + previewBlock;
    const confirmedShields = unit.shields ?? [];
    const previewAllyShield = serverPreviewTargets()
      .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
      .some(({ owner, target }) => state.serverMatch?.units.some(source => source.owner === owner && source.troopId === target.troopId && source.id !== unit.id));
    const newlyShieldedPenalty = unit.troopId === 'marsh-badger' && confirmedShields.length === 0 ? -1 : 0;
    const alreadyShieldedByAlly = confirmedShields.some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unit.id);
    const newlySupportedBonus = unit.troopId === 'river-otter' && previewAllyShield && !alreadyShieldedByAlly ? 1 : 0;
    return unit.combat.modifier + previewBlock + newlyShieldedPenalty + newlySupportedBonus;
  }
  return serverModifierEntries(unit, coordinate, bash).reduce((total, entry) => total + entry.value, 0);
}

function serverModifierText(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): string {
  const physical = serverModifier(unit, coordinate, bash);
  const magic = unit.combat.magicModifier + serverPreviewMagicBlock(unit, coordinate);
  if (!magic) return signedModifier(physical);
  return `${signedModifier(physical)} ${signedModifier(magic)}`;
}
  return {
    clearServerBoardRender,
    serverRegionController,
    serverControllerWithPreview,
    serverPreviewMagicBlock,
    serverModifierEntries,
    serverModifier,
    serverModifierText,
  };
}
