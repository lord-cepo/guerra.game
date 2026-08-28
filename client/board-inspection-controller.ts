import type { Coordinate } from '../game/board.js';
import { deploymentAnimationDuration, movementAnimationDuration, pushAnimationDuration } from './board-animation-timing.js';
import type { HexGridState } from './hex-grid-state.js';
import type { ServerMatchState } from './protocol.js';

interface BoardInspectionContext {
  state: HexGridState;
  isServerInactive(owner: 1 | 2, troopId: string): boolean;
  coordinateHasVisibleBash(coordinate: Coordinate): boolean;
  renderServerMatchState(match: ServerMatchState): void;
}

export function createBoardInspectionController(context: BoardInspectionContext) {
  const { state, isServerInactive, coordinateHasVisibleBash, renderServerMatchState } = context;
function latestMovementInspectionAt(coordinate: Coordinate): typeof state.lastMovementInspection {
  const match = state.serverMatch;
  if (!match) return undefined;
  const actingUnit = match.units.find(candidate => candidate.coordinate === coordinate
    && isServerInactive(candidate.owner, candidate.troopId));
  if (!actingUnit) return undefined;
  let eventIndex = -1;
  for (let index = (match.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = match.events?.[index];
    if (event?.player === actingUnit.owner && event.action.troopId === actingUnit.troopId) { eventIndex = index; break; }
  }
  const latest = eventIndex >= 0 ? match.events?.[eventIndex] : undefined;
  if (!latest?.origin || (latest.action.type !== 'move' && latest.action.type !== 'fly' && latest.action.type !== 'push' && latest.action.type !== 'pull')) return undefined;
  const movementAction = latest.action as typeof latest.action & { targetUnitId?: string; targetBomb?: boolean; destination?: Coordinate };
  if ((movementAction.type === 'push' || movementAction.type === 'pull') && movementAction.targetBomb) return undefined;
  const unit = latest.action.type === 'push' || latest.action.type === 'pull'
    ? movementAction.targetUnitId
      ? match.units.find(candidate => candidate.id === movementAction.targetUnitId)
      : match.units.find(candidate => candidate.coordinate === movementAction.destination)
    : match.units.find(candidate => candidate.owner === latest.player && candidate.troopId === latest.action.troopId);
  if (!unit || ((latest.action.type !== 'push' && latest.action.type !== 'pull') && unit.coordinate !== coordinate)) return undefined;
  const key = `movement:${unit.id}:${eventIndex}`;
  return { key, eventIndex, actor: latest.player, unitId: unit.id, hoverCoordinate: coordinate, origin: latest.origin, destination: unit.coordinate, type: latest.action.type, progress: 1, direction: -1, changedAt: performance.now() };
}

function movementInspectionProgress(inspection: NonNullable<typeof state.lastMovementInspection>): number {
  const duration = inspection.type === 'push' || inspection.type === 'pull' ? pushAnimationDuration : movementAnimationDuration;
  const target = inspection.direction === 1 ? 1 : 0;
  const distance = Math.abs(target - inspection.progress);
  if (distance === 0) return target;
  const elapsed = (performance.now() - inspection.changedAt) / (duration * distance);
  const eased = inspection.type === 'push' || inspection.type === 'pull'
    ? cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .06, .78, .18, 1)
    : cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .2, .72, .3, 1);
  return inspection.progress + (target - inspection.progress) * eased;
}

function redirectMovementInspection(direction: -1 | 1): void {
  if (!state.lastMovementInspection || state.lastMovementInspection.direction === direction || !state.serverMatch) return;
  state.lastMovementInspection = {
    ...state.lastMovementInspection,
    progress: movementInspectionProgress(state.lastMovementInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(state.serverMatch);
}

function beginLastMovementInspection(coordinate: Coordinate): boolean {
  if (state.serverSelectionRequestPending || state.serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return false;
  if (state.lastMovementInspection?.hoverCoordinate === coordinate) {
    redirectMovementInspection(-1);
    return true;
  }
  // A completed or returning inspection must not monopolize the hover state;
  // entering another inactive troop switches the single visible inspector.
  if (state.lastMovementInspection) state.lastMovementInspection = undefined;
  const inspection = latestMovementInspectionAt(coordinate);
  if (!inspection || !state.serverMatch) return false;
  state.armedRewindInspections.add(inspection.key);
  state.lastMovementInspection = inspection;
  renderServerMatchState(state.serverMatch);
  return true;
}

function endLastMovementInspection(coordinate: Coordinate): void {
  if (!state.lastMovementInspection) {
    const inspection = latestMovementInspectionAt(coordinate);
    if (inspection) state.armedRewindInspections.add(inspection.key);
    return;
  }
  if (state.lastMovementInspection.hoverCoordinate !== coordinate || !state.serverMatch) return;
  redirectMovementInspection(1);
}

function latestDeploymentInspectionAt(coordinate: Coordinate): typeof state.lastDeploymentInspection {
  const match = state.serverMatch;
  if (!match) return undefined;
  const unit = match.units.find(candidate => candidate.coordinate === coordinate
    && isServerInactive(candidate.owner, candidate.troopId));
  if (!unit) return undefined;
  let eventIndex = -1;
  for (let index = (match.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = match.events?.[index];
    if (event?.player === unit.owner && event.action.troopId === unit.troopId) { eventIndex = index; break; }
  }
  const latest = eventIndex >= 0 ? match.events?.[eventIndex] : undefined;
  if (latest?.action.type !== 'deploy' || latest.action.coordinate !== coordinate) return undefined;
  const key = `deployment:${unit.id}:${eventIndex}`;
  return { key, eventIndex, actor: latest.player, unitId: unit.id, coordinate, progress: 1, direction: -1, changedAt: performance.now() };
}

function deploymentInspectionProgress(inspection: NonNullable<typeof state.lastDeploymentInspection>): number {
  const target = inspection.direction === 1 ? 1 : 0;
  const distance = Math.abs(target - inspection.progress);
  if (distance === 0) return target;
  const elapsed = (performance.now() - inspection.changedAt) / (deploymentAnimationDuration * distance);
  const eased = cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .2, .72, .3, 1);
  return inspection.progress + (target - inspection.progress) * eased;
}

function deploymentInspectionOpacity(progress: number): number {
  if (progress <= .35) return .28 * progress / .35;
  if (progress <= .72) return .28 + (.82 - .28) * (progress - .35) / (.72 - .35);
  return .82 + (1 - .82) * (progress - .72) / (1 - .72);
}

function cubicBezierProgress(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const sample = (t: number, first: number, second: number): number => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
  };
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middle = (low + high) / 2;
    if (sample(middle, x1, x2) < x) low = middle;
    else high = middle;
  }
  return sample((low + high) / 2, y1, y2);
}

function redirectDeploymentInspection(direction: -1 | 1): void {
  if (!state.lastDeploymentInspection || state.lastDeploymentInspection.direction === direction || !state.serverMatch) return;
  state.lastDeploymentInspection = {
    ...state.lastDeploymentInspection,
    progress: deploymentInspectionProgress(state.lastDeploymentInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(state.serverMatch);
}

function beginLastDeploymentInspection(coordinate: Coordinate): boolean {
  if (state.serverSelectionRequestPending || state.serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return false;
  if (state.lastDeploymentInspection?.coordinate === coordinate) {
    redirectDeploymentInspection(-1);
    return true;
  }
  if (state.lastDeploymentInspection) state.lastDeploymentInspection = undefined;
  const inspection = latestDeploymentInspectionAt(coordinate);
  if (!inspection || !state.serverMatch) return false;
  state.armedRewindInspections.add(inspection.key);
  state.lastDeploymentInspection = inspection;
  renderServerMatchState(state.serverMatch);
  return true;
}

function endLastDeploymentInspection(coordinate: Coordinate): void {
  if (!state.lastDeploymentInspection) {
    const inspection = latestDeploymentInspectionAt(coordinate);
    if (inspection) state.armedRewindInspections.add(inspection.key);
    return;
  }
  if (state.lastDeploymentInspection.coordinate !== coordinate || !state.serverMatch) return;
  redirectDeploymentInspection(1);
}

  return {
    movementInspectionProgress,
    deploymentInspectionProgress,
    deploymentInspectionOpacity,
    redirectMovementInspection,
    beginLastMovementInspection,
    endLastMovementInspection,
    redirectDeploymentInspection,
    beginLastDeploymentInspection,
    endLastDeploymentInspection,
  };
}
