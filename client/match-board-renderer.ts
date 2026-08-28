import { regionAt, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import { projectileTravelDuration } from './board-animation-timing.js';
import { serverProjectileKey, type ServerProjectile } from './board-projectiles.js';
import {
  confirmedOneTimeActionDuration, instantResolutionPresentation, resolvedBashAnimations,
  resolvedBombExplosion, resolvedDamageAnimations, resolvedGoreMovementBetween,
  resolvedProjectilesForReplay, type ResolutionProjectionOptions,
} from './board-resolution.js';
import { controlledBoardHexArtwork } from './board-geometry.js';
import { shieldFrameCount } from './board-animation-view.js';
import type { BoardUnitTransition } from './board-unit-renderer.js';
import type { HexGridState } from './hex-grid-state.js';
import type { ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';
import { catalogueById } from './troop-view.js';

interface MatchBoardRendererContext {
  state: HexGridState;
  boardAreaPanel: HTMLElement;
  gameLayoutPanel: HTMLElement;
  applyLocalPlayerView(match: ServerMatchState): Player | undefined;
  clearServerPreviewPath(): void;
  serverPendingBash(): ServerBashState | undefined;
  serverRegionController(match: ServerMatchState, coordinate: Coordinate, previewBash?: ServerBashState): Player | undefined;
  serverBashIsDodged(bash: ServerBashState, match?: ServerMatchState): boolean;
  serverBashScreenSide(unit: ServerUnitState): 'left' | 'right';
  serverPendingUnitPreviews(): ServerUnitState[];
  serverPendingMovementPreview(): { unit: ServerUnitState; coordinate: Coordinate } | undefined;
  serverPendingActionForPreview(): ServerLegalAction | undefined;
  clearServerBoardRender(): void;
  appendServerBoardUnit(unit: ServerUnitState, transition?: BoardUnitTransition, transitionOrigin?: Coordinate, transitionHalf?: 'left' | 'right'): void;
  appendServerBash(bash: ServerBashState, showSplitBorder?: boolean, animateEntrance?: boolean): void;
  appendServerPreviewBash(): void;
  renderServerTray(owner: Player, tray: HTMLElement, interactive: boolean): void;
  renderServerActionTargets(): void;
  renderServerActionBar(match: ServerMatchState, player: Player): void;
  playerOneCardsPanel: HTMLElement;
  playerTwoCardsPanel: HTMLElement;
  appendServerHexBorderOverlays(): void;
  appendServerTriggeredShieldAnimations(match: ServerMatchState, previous: ServerMatchState | undefined): void;
  appendServerDefenseAnimations(match: ServerMatchState): void;
  appendServerStunAnimations(match: ServerMatchState): void;
  appendServerProjectile(projectile: ServerProjectile, phaseDelay?: number): void;
  appendServerProjectiles(match: ServerMatchState): void;
  appendServerMendingAnimations(match: ServerMatchState): void;
  appendPhysicalDamageModifiers(match: ServerMatchState): void;
  appendDamageResolutionAnimations(): void;
  appendBombExplosionAnimations(): void;
  appendBashResolutionAnimations(match: ServerMatchState): void;
  appendServerBombs(match: ServerMatchState): void;
  appendConfirmedIgnitedBomb(match: ServerMatchState): void;
  confirmedServerProjectiles(match: ServerMatchState): ServerProjectile[];
}

export function createMatchBoardRenderer(context: MatchBoardRendererContext) {
  const {
    state, boardAreaPanel, gameLayoutPanel, applyLocalPlayerView, clearServerPreviewPath, serverPendingBash,
    serverRegionController, serverBashIsDodged, serverBashScreenSide, serverPendingUnitPreviews, serverPendingMovementPreview,
    serverPendingActionForPreview, clearServerBoardRender, appendServerBoardUnit, appendServerBash,
    appendServerPreviewBash, renderServerTray, renderServerActionTargets, renderServerActionBar,
    playerOneCardsPanel, playerTwoCardsPanel, appendServerHexBorderOverlays,
    appendServerTriggeredShieldAnimations, appendServerDefenseAnimations, appendServerStunAnimations, appendServerProjectile,
    appendServerProjectiles, appendServerMendingAnimations, appendPhysicalDamageModifiers,
    appendDamageResolutionAnimations, appendBombExplosionAnimations, appendBashResolutionAnimations,
    appendServerBombs, appendConfirmedIgnitedBomb, confirmedServerProjectiles,
  } = context;
function resolutionProjectionOptions(): ResolutionProjectionOptions {
  return {
    replayingLastTurn: state.replayingLastTurn,
    localPlayer: state.localMatchPlayer,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    shieldFrameCount,
    baseHealthForTroop: troopId => catalogueById.get(troopId)?.baseHealth,
    passivesForTroop: troopId => catalogueById.get(troopId)?.passives ?? [],
    confirmedProjectiles: confirmedServerProjectiles,
  };
}

function renderServerMatchState(match: ServerMatchState): void {
  if (!state.serverMatch || state.serverMatch.id !== match.id) {
    state.serverHoverPreviewCoordinate = undefined;
  }
  // A new revision is an authoritative action (or sandbox placement), not a
  // local selection echo. Clear the previous side's card/action before control
  // passes; both fixed trays share card IDs across their separate owners.
  const previousMatch = state.serverMatch;
  const stateAdvanced = previousMatch?.id === match.id && previousMatch.revision !== match.revision;
  if (stateAdvanced && !state.replayingLastTurn && previousMatch
    && (match.events?.length ?? 0) > (previousMatch.events?.length ?? 0)) {
    state.lastTurnReplayBefore = structuredClone(previousMatch);
    state.lastTurnReplayAfter = structuredClone(match);
  }
  const latestEvent = match.events?.at(-1);
  const resolutionOptions = resolutionProjectionOptions();
  const resolvedExplosion = stateAdvanced
    ? resolvedBombExplosion(previousMatch, match)
    : { origins: [], affected: [] };
  state.explosionResolutionCoordinates = resolvedExplosion.origins;
  state.explosionAffectedCoordinates = resolvedExplosion.affected;
  state.explosionResolutionDelay = resolvedExplosion.origins.length > 0 ? confirmedOneTimeActionDuration(match, resolutionOptions) : 0;
  const instantPresentation = stateAdvanced
    ? instantResolutionPresentation(previousMatch, match, resolutionOptions)
    : { projectiles: [], damage: [] };
  state.instantResolvedProjectiles = instantPresentation.projectiles;
  state.damageResolutionAnimations = stateAdvanced
    ? [...resolvedDamageAnimations(previousMatch, match, state.explosionResolutionDelay, resolutionOptions), ...instantPresentation.damage]
    : [];
  state.bashResolutionAnimations = stateAdvanced ? resolvedBashAnimations(previousMatch, match, resolutionOptions) : [];
  state.replayResolvedProjectiles = stateAdvanced && state.replayingLastTurn ? resolvedProjectilesForReplay(previousMatch, match, resolutionOptions) : [];
  state.resolvedGoreMovement = stateAdvanced ? resolvedGoreMovementBetween(previousMatch, match) : undefined;
  state.confirmedDeploymentAnimationRevision = stateAdvanced ? match.revision : undefined;
  state.confirmedDefenseAnimationRevision = stateAdvanced
    && (latestEvent?.action.type === 'defense' || latestEvent?.action.type === 'self-defense' || latestEvent?.action.type === 'magic-defense' || latestEvent?.action.type === 'self-magic-defense')
    ? match.revision
    : undefined;
  state.confirmedMendingAnimationRevision = stateAdvanced && latestEvent?.action.type === 'mending'
    ? match.revision
    : undefined;
  if (stateAdvanced && latestEvent?.action.type === 'bomb' && latestEvent.action.coordinate) {
    const key = serverProjectileKey(latestEvent.player, latestEvent.action.troopId, 'bomb', latestEvent.action.coordinate);
    state.confirmedBombArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  if (stateAdvanced
    && latestEvent?.action.type === 'magic'
    && latestEvent.action.coordinate
    && (state.replayingLastTurn || latestEvent.player !== state.localMatchPlayer)
    && previousMatch?.bombs?.some(bomb => bomb.coordinate === latestEvent.action.coordinate)
    && match.effects.some(effect => effect.kind === 'bomb' && effect.target === latestEvent.action.coordinate)) {
    const key = `confirmed-ignition:${match.id}:${match.revision}:${latestEvent.action.coordinate}`;
    state.bombIgnitionArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  state.confirmedBashAnimationRevision = stateAdvanced
    && (state.replayingLastTurn || latestEvent?.player !== state.localMatchPlayer)
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore' || latestEvent?.action.type === 'resolve-move' || latestEvent?.action.type === 'resolve-pull')
    && match.bashes.some(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    ? match.revision
    : undefined;
  state.confirmedMovementAnimationRevision = stateAdvanced
    && (state.replayingLastTurn || latestEvent?.player !== state.localMatchPlayer)
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore' || latestEvent?.action.type === 'push' || latestEvent?.action.type === 'pull' || latestEvent?.action.type === 'resolve-move' || latestEvent?.action.type === 'resolve-pull')
    && latestEvent.origin
    ? match.revision
    : undefined;
  if (stateAdvanced && !state.replayingLastTurn) {
    state.serverSelectedTroopId = undefined;
    state.serverSelectedAction = undefined;
    state.serverPendingAction = undefined;
    state.queuedMovementPreviewOrigin = undefined;
    state.queuedMovementPreviewReturn = undefined;
    state.serverPushTargetChoices = [];
    state.serverInspectedUnitId = undefined;
    state.lastMovementInspection = undefined;
    state.lastDeploymentInspection = undefined;
    clearServerPreviewPath();
  }
  state.serverMatch = match;
  const local = applyLocalPlayerView(match); if (!local) return;
  if (state.serverSelectionRequestPending && match.selections?.[local] === state.serverRequestedTroopId) {
    state.serverSelectedTroopId = state.serverRequestedTroopId;
    state.serverSelectedAction = undefined;
    state.serverPendingAction = undefined;
    state.serverSelectionRequestPending = false;
  }
  const awaitingLocalAction = match.status === 'active' && !match.winner
    && (match.pendingResolution?.owner ?? match.activePlayer) === local;
  boardAreaPanel.classList.toggle('awaiting-local-action', awaitingLocalAction);
  if (match.pendingResolution?.owner === local) {
    const pending = match.pendingResolution;
    const source = 'sourceUnitId' in pending ? match.units.find(unit => unit.id === pending.sourceUnitId) : undefined;
    state.serverSelectedTroopId = match.pendingResolution.sourceTroopId;
    if (source) state.serverInspectedUnitId = source.id;
  }
  gameLayoutPanel.classList.remove('deck-building');
  if (match.winner || (match.pendingResolution?.owner ?? match.activePlayer) !== local) { state.serverSelectedTroopId = undefined; state.serverSelectedAction = undefined; state.serverPendingAction = undefined; clearServerPreviewPath(); }
  const selectedActions = match.selections?.[local] === state.serverSelectedTroopId ? match.legalActions?.[local] ?? [] : [];
  const actionTypes = new Set(selectedActions.map(action => action.type));
  if (state.serverSelectedTroopId && selectedActions.length > 0 && (!state.serverSelectedAction || !actionTypes.has(state.serverSelectedAction))) {
    // Pending choices always include resolve-pass first, but the board should
    // open on the actual target action so legal hexes are visible immediately.
    state.serverSelectedAction = (['deploy', 'resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-instant-magic', 'resolve-stun', 'resolve-pull', 'move', 'fly'] as const)
      .find(type => actionTypes.has(type))
      ?? selectedActions.find(action => action.type !== 'resolve-pass')?.type
      ?? selectedActions[0]?.type;
  }
  renderServerTray(2, playerTwoCardsPanel, local === 2);
  renderServerTray(1, playerOneCardsPanel, local === 1);
  clearServerBoardRender();
  for (const [coordinate, { cell }] of state.cellsByCoordinate) {
    const previewBash = serverPendingBash();
    const controller = serverRegionController(match, coordinate, previewBash);
    cell.classList.add(controller === 1 ? 'server-controlled-one' : controller === 2 ? 'server-controlled-two' : 'server-contested');
    const regionId = regionAt(coordinate)?.id;
    const artwork = cell.querySelector<SVGImageElement>('.board-hex-artwork');
    const filename = controlledBoardHexArtwork(regionId, controller);
    if (artwork && filename) artwork.setAttribute('href', `./assets/${filename}`);
  }
  const visibleBashes = match.bashes.filter(bash => !serverBashIsDodged(bash, match)
    && bash.target !== state.serverHoverPreviewCoordinate);
  const bashingIds = new Set(visibleBashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const revealedBash = match.bashes.find(bash => bash.target === state.serverHoverPreviewCoordinate && !serverBashIsDodged(bash, match));
  const revealedBashingIds = new Set(revealedBash ? [revealedBash.attackerId, revealedBash.defenderId] : []);
  const revealedUnitId = revealedBash ? (state.serverBashReveal === 'attacker' ? revealedBash.attackerId : revealedBash.defenderId) : undefined;
  const pendingBash = serverPendingBash();
  const previewDefenderId = pendingBash?.defenderId;
  const revealPendingBash = pendingBash?.target === state.serverHoverPreviewCoordinate;
  const unitPreviews = serverPendingUnitPreviews();
  const movementPreview = serverPendingMovementPreview();
  const movementPreviewType = serverPendingActionForPreview()?.type;
  const queuedPreviewOrigin = movementPreview
    && state.queuedMovementPreviewOrigin?.unitId === movementPreview.unit.id
    && state.queuedMovementPreviewOrigin.destination === movementPreview.coordinate
    ? state.queuedMovementPreviewOrigin
    : undefined;
  const confirmedIntroBash = state.confirmedBashAnimationRevision === match.revision && latestEvent?.origin
    ? visibleBashes.find(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    : undefined;
  const resolvedGoreIntroBash = state.resolvedGoreMovement
    ? visibleBashes.find(bash => bash.attackerId === state.resolvedGoreMovement?.unit.id && bash.target === state.resolvedGoreMovement.destination)
    : undefined;
  const confirmedMovementAction = state.confirmedMovementAnimationRevision === match.revision && latestEvent?.origin
    ? latestEvent.action as typeof latestEvent.action & { targetUnitId?: string; targetBomb?: boolean; destination?: Coordinate }
    : undefined;
  const confirmedMovementUnit = confirmedMovementAction
      ? confirmedMovementAction.type === 'push' || confirmedMovementAction.type === 'pull' || confirmedMovementAction.type === 'resolve-pull'
      ? confirmedMovementAction.targetBomb
        ? undefined
        : confirmedMovementAction.targetUnitId
        ? match.units.find(unit => unit.id === confirmedMovementAction.targetUnitId)
        : match.units.find(unit => unit.coordinate === confirmedMovementAction.destination)
      : match.units.find(unit => unit.owner === latestEvent?.player && unit.troopId === confirmedMovementAction.troopId)
    : undefined;
  const returningPreviewUnit = state.queuedMovementPreviewReturn
    ? match.units.find(unit => unit.id === state.queuedMovementPreviewReturn?.unitId)
    : undefined;
  const inspectedMovementUnit = state.lastMovementInspection
    ? match.units.find(unit => unit.id === state.lastMovementInspection?.unitId)
    : undefined;
  const inspectedDeploymentUnit = state.lastDeploymentInspection
    ? match.units.find(unit => unit.id === state.lastDeploymentInspection?.unitId)
    : undefined;
  const previewUnitIds = new Set(unitPreviews.map(unit => unit.id));
  for (const unit of match.units) if (!bashingIds.has(unit.id)
    && (!revealedBashingIds.has(unit.id) || unit.id === revealedUnitId)
    && (unit.id !== previewDefenderId || revealPendingBash)
    && !previewUnitIds.has(unit.id)
    && unit.id !== returningPreviewUnit?.id
    && (unit.id !== confirmedMovementUnit?.id || Boolean(confirmedIntroBash))
    && unit.id !== inspectedMovementUnit?.id
    && unit.id !== state.resolvedGoreMovement?.unit.id
    && unit.id !== inspectedDeploymentUnit?.id) appendServerBoardUnit(unit);
  // A pending move has two simultaneous visual halves: retain a temporary
  // source copy that dissolves downward, while its projected destination copy
  // materializes upward into the new hex.
  if (movementPreview && movementPreviewType !== 'push' && movementPreviewType !== 'pull' && movementPreviewType !== 'resolve-pull') {
    const sourceCoordinate = queuedPreviewOrigin?.coordinate ?? movementPreview.unit.coordinate;
    appendServerBoardUnit(
      { ...movementPreview.unit, coordinate: sourceCoordinate },
      'move-out',
      undefined,
      queuedPreviewOrigin?.wasBash ? serverBashScreenSide(movementPreview.unit) : undefined,
    );
  }
  for (const unit of unitPreviews) {
    const isMovementDestination = movementPreview?.unit.id === unit.id && movementPreview.coordinate === unit.coordinate;
    const transition = isMovementDestination ? (movementPreviewType === 'push' || movementPreviewType === 'pull' || movementPreviewType === 'resolve-pull' ? 'push-in' : 'move-in') : undefined;
    // The bash renderer owns the destination attacker: only its clipped half
    // materializes, while the defender remains static throughout.
    if (pendingBash?.attackerId !== unit.id) appendServerBoardUnit(unit, transition, queuedPreviewOrigin?.coordinate ?? movementPreview?.unit.coordinate);
  }
  if (returningPreviewUnit && state.queuedMovementPreviewReturn) {
    appendServerBoardUnit(
      { ...returningPreviewUnit, coordinate: state.queuedMovementPreviewReturn.coordinate },
      'move-out',
      undefined,
      state.queuedMovementPreviewReturn.wasBash ? serverBashScreenSide(returningPreviewUnit) : undefined,
    );
    appendServerBoardUnit(returningPreviewUnit, 'move-in');
  }
  if (inspectedMovementUnit && state.lastMovementInspection) {
    const inspection = state.lastMovementInspection;
    if (inspection.type === 'push' || inspection.type === 'pull') {
      appendServerBoardUnit(inspectedMovementUnit, 'push-inspect', inspection.origin);
    } else {
      appendServerBoardUnit({ ...inspectedMovementUnit, coordinate: inspection.origin }, 'move-inspect-origin');
      appendServerBoardUnit(inspectedMovementUnit, 'move-inspect-destination');
    }
  }
  if (inspectedDeploymentUnit && state.lastDeploymentInspection) {
    appendServerBoardUnit(inspectedDeploymentUnit, state.lastDeploymentInspection.direction === 1 ? 'deploy-in' : 'deploy-out');
  }
  if (confirmedMovementUnit && latestEvent?.origin && !confirmedIntroBash) {
    if (confirmedMovementAction?.type === 'push' || confirmedMovementAction?.type === 'pull' || confirmedMovementAction?.type === 'resolve-pull') appendServerBoardUnit(confirmedMovementUnit, 'push-in', latestEvent.origin);
    else {
      appendServerBoardUnit({ ...confirmedMovementUnit, coordinate: latestEvent.origin }, 'move-out');
      appendServerBoardUnit(confirmedMovementUnit, 'move-in');
    }
  }
  if (state.resolvedGoreMovement && !resolvedGoreIntroBash) {
    appendServerBoardUnit({ ...state.resolvedGoreMovement.unit, coordinate: state.resolvedGoreMovement.origin }, 'move-out');
    appendServerBoardUnit(state.resolvedGoreMovement.unit, 'move-in');
  }
  if (state.resolvedGoreMovement && resolvedGoreIntroBash) {
    appendServerBoardUnit({ ...state.resolvedGoreMovement.unit, coordinate: state.resolvedGoreMovement.origin }, 'move-out');
  }
  if (confirmedIntroBash && latestEvent?.origin) {
    const attacker = match.units.find(unit => unit.id === confirmedIntroBash.attackerId);
    if (attacker) {
      appendServerBoardUnit({ ...attacker, coordinate: latestEvent.origin }, 'move-out');
    }
  }
  for (const bash of visibleBashes) appendServerBash(bash, true, bash === confirmedIntroBash || bash === resolvedGoreIntroBash);
  // A pending bash is independent of bashes already waiting elsewhere on the
  // board. Draw all confirmed bashes and the prospective one together.
  appendServerPreviewBash();
  appendServerBombs(match);
  appendConfirmedIgnitedBomb(match);
  renderServerActionBar(match, local);
  renderServerActionTargets();
  appendServerHexBorderOverlays();
  appendServerProjectiles(match);
  for (const projectile of state.replayResolvedProjectiles) appendServerProjectile(projectile);
  for (const projectile of state.instantResolvedProjectiles) appendServerProjectile(projectile);
  appendServerMendingAnimations(match);
  appendPhysicalDamageModifiers(match);
  appendServerDefenseAnimations(match);
  appendServerTriggeredShieldAnimations(match, previousMatch);
  appendServerStunAnimations(match);
  appendBombExplosionAnimations();
  appendDamageResolutionAnimations();
  appendBashResolutionAnimations(match);
  state.confirmedDeploymentAnimationRevision = undefined;
  state.confirmedBashAnimationRevision = undefined;
  state.confirmedMovementAnimationRevision = undefined;
  state.confirmedDefenseAnimationRevision = undefined;
  state.confirmedMendingAnimationRevision = undefined;
  state.damageResolutionAnimations = [];
  state.explosionResolutionCoordinates = [];
  state.explosionAffectedCoordinates = [];
  state.explosionResolutionDelay = 0;
  state.bashResolutionAnimations = [];
  state.replayResolvedProjectiles = [];
  state.instantResolvedProjectiles = [];
  state.resolvedGoreMovement = undefined;
  if (queuedPreviewOrigin === state.queuedMovementPreviewOrigin) state.queuedMovementPreviewOrigin = undefined;
  state.queuedMovementPreviewReturn = undefined;
}

function replayLastTurnAnimation(): void {
  if (!state.serverMatch || !state.lastTurnReplayBefore || !state.lastTurnReplayAfter
    || state.serverMatch.id !== state.lastTurnReplayAfter.id
    || state.serverMatch.revision !== state.lastTurnReplayAfter.revision) return;
  const latest = state.lastTurnReplayAfter.events?.at(-1);
  if (!latest) return;
  const source = state.lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
  if (source) {
    const prefix = `${latest.player}:${source.id}:`;
    for (const key of state.projectileAnimationStartTimes.keys()) if (key.startsWith(prefix)) state.projectileAnimationStartTimes.delete(key);
  }
  if (latest.action.type === 'deploy') {
    const unit = state.lastTurnReplayAfter.units.find(item => item.owner === latest.player && item.troopId === latest.action.troopId);
    if (unit) {
      const key = `confirmed:${state.lastTurnReplayAfter.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`;
      state.playedDeploymentAnimations.delete(key);
      state.deploymentAnimationStartTimes.delete(key);
    }
  }
  if (latest.action.type === 'bomb' && latest.action.coordinate) {
    const key = serverProjectileKey(latest.player, latest.action.troopId, 'bomb', latest.action.coordinate);
    state.playedConfirmedBombHeads.delete(key);
    state.confirmedBombArrivalTimes.delete(key);
  }
  if (latest.action.type === 'upgrade' && latest.action.coordinate) {
    const source = state.lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
    if (source) state.playedConfirmedUpgradeHeads.delete(serverProjectileKey(latest.player, source.id, 'upgrade', latest.action.coordinate));
  }
  state.replayingLastTurn = true;
  state.serverMatch = structuredClone(state.lastTurnReplayBefore);
  try { renderServerMatchState(structuredClone(state.lastTurnReplayAfter)); }
  finally { state.replayingLastTurn = false; }
}

  return { renderServerMatchState, replayLastTurnAnimation };
}
