import type { Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { Point } from './board-animation-geometry.js';
import type { ServerProjectile } from './board-projectiles.js';
import type { BashResolutionAnimation, DamageResolutionAnimation, GoreMovementResolution } from './board-resolution.js';
import type { GameActionType, ServerLegalAction, ServerMatchState } from './protocol.js';

export interface MovementInspection {
  key: string; eventIndex: number; actor: Player; unitId: string; hoverCoordinate: Coordinate; origin: Coordinate; destination: Coordinate;
  type: 'move' | 'fly' | 'push' | 'pull'; progress: number; direction: -1 | 1; changedAt: number;
}

export interface DeploymentInspection {
  key: string; eventIndex: number; actor: Player; unitId: string; coordinate: Coordinate; progress: number; direction: -1 | 1; changedAt: number;
}

export function createHexGridState() {
  return {
    cellsByCoordinate: new Map<Coordinate, { cell: SVGGElement; position: Point }>(),
    currentNickname: undefined as string | undefined,
    activeMatchId: undefined as string | undefined,
    localMatchPlayer: undefined as Player | undefined,
    serverMatch: undefined as ServerMatchState | undefined,
    serverSelectedTroopId: undefined as string | undefined,
    serverRequestedTroopId: undefined as string | undefined,
    serverSelectionRequestPending: false,
    playedDeploymentAnimations: new Set<string>(), deploymentAnimationStartTimes: new Map<string, number>(),
    confirmedDeploymentAnimationRevision: undefined as number | undefined, confirmedBashAnimationRevision: undefined as number | undefined,
    confirmedMovementAnimationRevision: undefined as number | undefined, confirmedDefenseAnimationRevision: undefined as number | undefined,
    confirmedMendingAnimationRevision: undefined as number | undefined,
    replayingLastTurn: false, lastTurnReplayBefore: undefined as ServerMatchState | undefined, lastTurnReplayAfter: undefined as ServerMatchState | undefined,
    confirmedBombTrajectorySources: new Map<string, Coordinate>(), playedConfirmedBombHeads: new Set<string>(),
    confirmedUpgradeTrajectorySources: new Map<string, Coordinate>(), playedConfirmedUpgradeHeads: new Set<string>(),
    confirmedBombArrivalTimes: new Map<string, number>(), bombIgnitionArrivalTimes: new Map<string, number>(), playedConfirmedBombIgnitions: new Set<string>(),
    physicalModifierArrivalTimes: new Map<string, number>(), projectileAnimationStartTimes: new Map<string, number>(), stunAnimationStartTimes: new Map<string, number>(),
    damageResolutionAnimations: [] as DamageResolutionAnimation[], explosionResolutionCoordinates: [] as Coordinate[], explosionAffectedCoordinates: [] as Coordinate[], explosionResolutionDelay: 0,
    bashResolutionAnimations: [] as BashResolutionAnimation[], replayResolvedProjectiles: [] as ServerProjectile[], instantResolvedProjectiles: [] as ServerProjectile[],
    resolvedGoreMovement: undefined as GoreMovementResolution | undefined, playedPreviewMendingSweepKey: undefined as string | undefined,
    lastMovementInspection: undefined as MovementInspection | undefined, lastDeploymentInspection: undefined as DeploymentInspection | undefined,
    armedRewindInspections: new Set<string>(),
    serverInspectedUnitId: undefined as string | undefined, serverSelectedAction: undefined as GameActionType | undefined,
    serverPendingAction: undefined as ServerLegalAction | undefined,
    queuedMovementPreviewOrigin: undefined as { unitId: string; coordinate: Coordinate; wasBash: boolean; destination: Coordinate } | undefined,
    queuedMovementPreviewReturn: undefined as { unitId: string; coordinate: Coordinate; wasBash: boolean } | undefined,
    serverPushTargetChoices: [] as ServerLegalAction[], serverActionError: undefined as string | undefined, serverPreviewPath: [] as Coordinate[],
    serverHoverPreviewCoordinate: undefined as Coordinate | undefined, serverBashReveal: 'defender' as 'defender' | 'attacker',
  };
}

export type HexGridState = ReturnType<typeof createHexGridState>;
