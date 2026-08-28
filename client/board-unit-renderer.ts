import type { Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { Point } from './board-animation-geometry.js';
import { deploymentAnimationDuration, movementAnimationDuration, pushAnimationDuration } from './board-animation-timing.js';
import { boardDescriptionLineHeight, boardDescriptionLineY, writeModifierPair } from './board-descriptions.js';
import { hexGap, hexPoints, hexSize as size, horizontalScale, svgNamespace as ns } from './board-geometry.js';
import { pendingActionForPreview, pendingBash, pendingMovementPreview, pendingUnitPreviews, type ServerMovementPreview } from './board-preview-projection.js';
import type { HexGridState } from './hex-grid-state.js';
import { createBoardInspectionController } from './board-inspection-controller.js';
import { createBoardCombatProjection } from './board-combat-projection.js';
import type { GameActionType, ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';
import { troopDisplayName, type Troop } from './troop-view.js';

interface BoardUnitRendererContext {
  board: SVGSVGElement;
  state: HexGridState;
  bashHoverTimers: WeakMap<SVGGElement, number>;
  clearServerPreviewPath(): void;
  serverTroop(cardId: string, owner: Player, unit?: ServerUnitState): Troop | undefined;
  boardCardMarker(troop: Troop, position: Point, clipId?: string): SVGGElement;
  isServerInactive(owner: Player, troopId: string): boolean;
  enablePointerBoardDrag(source: Element, troop: Troop, dragged: { owner: Player; troopId: string; mode: 'deploy' | 'free' }): void;
  appendInactiveTroopWash(parent: SVGGElement, position: Point, clipId?: string): void;
  appendBoardInfoFrame(cell: SVGGElement, troop: Troop, position: Point): void;
  appendServerActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action?: GameActionType, highlightLife?: boolean, includeSelfBlock?: boolean, negativeSelfBlock?: boolean, ignitionDamage?: number, modifier?: number | string): void;
  writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock?: boolean, revealMoveOne?: boolean, ignitionDamage?: number, modifier?: number | string, magicModifier?: number): void;
  showServerHoverDetailsForCoordinate(coordinate: Coordinate): void;
  renderServerMatchState(match: ServerMatchState): void;
}

export type BoardUnitTransition =
  | 'move-out' | 'move-in' | 'move-inspect-origin' | 'move-inspect-destination'
  | 'push-in' | 'push-out' | 'push-inspect' | 'deploy-out' | 'deploy-in';

export function createBoardUnitRenderer(context: BoardUnitRendererContext) {
  const {
    board: boardPanel, state, bashHoverTimers, clearServerPreviewPath, serverTroop, boardCardMarker,
    isServerInactive, enablePointerBoardDrag, appendInactiveTroopWash, appendBoardInfoFrame,
    appendServerActionDescriptionHighlight, writeServerBoardDescription, showServerHoverDetailsForCoordinate,
    renderServerMatchState,
  } = context;
const combatProjection = createBoardCombatProjection({
  board: boardPanel,
  state,
  clearServerPreviewPath,
  serverTroop,
  serverBashIsDodged: (bash, match) => serverBashIsDodged(bash, match),
  serverPendingMovementPreview: () => serverPendingMovementPreview(),
});
const {
  clearServerBoardRender, serverRegionController, serverControllerWithPreview, serverPreviewMagicBlock,
  serverModifierEntries, serverModifier, serverModifierText,
} = combatProjection;

/** The shared horizontal board needs no player-dependent overlay rotation. */
function keepServerOverlayUpright(_element: SVGElement, _centre: Point): void {}

function appendServerBoardUnit(unit: ServerUnitState, transition?: BoardUnitTransition, transitionOrigin?: Coordinate, transitionHalf?: 'left' | 'right'): void {
  const target = state.cellsByCoordinate.get(unit.coordinate); const troop = serverTroop(unit.troopId, unit.owner, unit);
  if (!target || !troop) return;
  target.cell.classList.add('server-occupied');
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.setAttribute('aria-label', `${troopDisplayName(troop)}, Player ${unit.owner}`);
  const visual = document.createElementNS(ns, 'g');
  visual.dataset.serverRender = 'unit-visual';
  visual.dataset.clipId = target.cell.dataset.clipId;
  visual.classList.add('board-unit-visual');
  if (transition
    && transition !== 'deploy-in'
    && transition !== 'deploy-out'
    && transition !== 'push-inspect'
    && transition !== 'move-inspect-origin'
    && transition !== 'move-inspect-destination') visual.classList.add(`troop-${transition}-animation`);
  if (transitionHalf) visual.classList.add('bash-transition-source');
  if ((transition === 'push-in' || transition === 'push-out' || transition === 'push-inspect') && transitionOrigin) {
    const origin = state.cellsByCoordinate.get(transitionOrigin)?.position;
    if (origin) {
      visual.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
      visual.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
    }
  }
  const marker = boardCardMarker(troop, target.position, target.cell.dataset.clipId);
  marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
  if (transitionHalf) marker.classList.add(transitionHalf === 'left' ? 'bash-left-picture' : 'bash-right-picture');
  if (state.serverMatch?.sandboxFreePlacement) {
    marker.classList.add('sandbox-draggable');
    enablePointerBoardDrag(marker, troop, { owner: unit.owner, troopId: unit.troopId, mode: 'free' });
  }
  keepServerOverlayUpright(marker, target.position);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  if (isServerInactive(unit.owner, unit.troopId)) {
    marker.classList.add('last-acting-troop');
    target.cell.classList.add('server-last-acting');
  }
  if ((unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId) || state.serverMatch?.selections?.[unit.owner] === unit.troopId || unit.id === state.serverInspectedUnitId) target.cell.classList.add('server-selected', unit.owner === 1 ? 'server-selected-one' : 'server-selected-two');
  // Every overlay uses the same shared horizontal board orientation.
  const highlightedAction = unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId ? state.serverSelectedAction : undefined;
  const latestAction = state.serverMatch?.events?.at(-1);
  const newlyDeployed = latestAction?.action.type === 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId;
  const deploymentPreview = unit.id.startsWith('deployment-preview:') && unit.owner === state.localMatchPlayer;
  const confirmedForOpponent = newlyDeployed
    && (state.replayingLastTurn || unit.owner !== state.localMatchPlayer)
    && state.serverMatch?.revision === state.confirmedDeploymentAnimationRevision;
  const deploymentAnimationKey = deploymentPreview
    ? `preview:${unit.owner}:${unit.troopId}:${unit.coordinate}`
    : confirmedForOpponent
      ? `confirmed:${state.serverMatch?.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`
      : undefined;
  if (deploymentAnimationKey) {
    let startedAt = state.deploymentAnimationStartTimes.get(deploymentAnimationKey);
    if (startedAt === undefined && !state.playedDeploymentAnimations.has(deploymentAnimationKey)) {
      startedAt = performance.now();
      state.deploymentAnimationStartTimes.set(deploymentAnimationKey, startedAt);
      state.playedDeploymentAnimations.add(deploymentAnimationKey);
      window.setTimeout(() => state.deploymentAnimationStartTimes.delete(deploymentAnimationKey), deploymentAnimationDuration);
    }
    if (startedAt !== undefined) {
      const elapsed = performance.now() - startedAt;
      if (elapsed < deploymentAnimationDuration) {
        visual.classList.add('deploy-fall-animation');
        visual.style.animationDelay = `${-elapsed}ms`;
      }
    }
  }
  const persistedAction = latestAction && state.serverMatch?.activePlayer !== latestAction.player
    && latestAction.action.type !== 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId
    ? latestAction.action.type : undefined;
  const descriptionAction = highlightedAction ?? persistedAction;
  const ignitionDamage = latestAction?.action.type === 'magic'
    && latestAction.player === unit.owner
    && latestAction.action.troopId === unit.troopId
    ? state.serverMatch?.effects.filter(effect => effect.kind === 'bomb' && effect.owner === unit.owner).reduce((damage, effect) => Math.max(damage, effect.value), 0)
    : undefined;
  const showSelfBlock = descriptionAction === 'self-defense' || descriptionAction === 'self-magic-defense';
  const pendingSelfBlock = showSelfBlock && (state.serverPendingAction?.type === 'self-defense' || state.serverPendingAction?.type === 'self-magic-defense');
  const displayedModifier = serverModifierText(unit, unit.coordinate);
  // The unit remains one rigid animated object, but the transparent ornamental
  // PNG is painted after it so the hand-drawn hex edge stays above the card.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  visual.append(marker);
  const pending = state.serverMatch?.pendingResolution;
  const pendingSource = pending
    && (('sourceUnitId' in pending && pending.sourceUnitId === unit.id)
      || (!('sourceUnitId' in pending) && pending.owner === unit.owner && pending.sourceTroopId === unit.troopId));
  if (pendingSource) {
    const wash = document.createElementNS(ns, 'polygon');
    wash.dataset.serverRender = 'pending-action-source';
    wash.classList.add('pending-action-source-wash');
    wash.setAttribute('points', hexPoints(target.position.x, target.position.y));
    wash.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
    visual.append(wash);
  }
  if (isServerInactive(unit.owner, unit.troopId)) appendInactiveTroopWash(visual, target.position, target.cell.dataset.clipId);
  appendBoardInfoFrame(visual, troop, target.position);
  appendServerActionDescriptionHighlight(visual, troop, target.position, descriptionAction, newlyDeployed, showSelfBlock, pendingSelfBlock, ignitionDamage, displayedModifier);
  const description = document.createElementNS(ns, 'text');
  description.dataset.serverRender = 'description';
  description.classList.add('board-troop-description');
  const displayedMagicModifier = unit.combat.magicModifier + serverPreviewMagicBlock(unit, unit.coordinate);
  writeServerBoardDescription(description, troop, target.position, showSelfBlock, descriptionAction === 'move', ignitionDamage, displayedModifier, displayedMagicModifier);
  keepServerOverlayUpright(description, target.position);
  visual.append(description);
  target.cell.append(visual);
  if ((transition === 'move-inspect-origin' || transition === 'move-inspect-destination') && state.lastMovementInspection?.unitId === unit.id) {
    const progress = movementInspectionProgress(state.lastMovementInspection);
    const targetProgress = state.lastMovementInspection.direction === 1 ? 1 : 0;
    const distance = Math.abs(targetProgress - progress);
    const originVisual = transition === 'move-inspect-origin';
    const frame = (value: number): Keyframe => originVisual
      ? { opacity: 1 - value, translate: `0 ${55 * value}px` }
      : { opacity: value, translate: `0 ${55 * (1 - value)}px` };
    const timeline = visual.animate([frame(progress), frame(targetProgress)], {
      duration: Math.max(1, movementAnimationDuration * distance),
      easing: 'cubic-bezier(.2, .72, .3, 1)',
      fill: 'both',
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timeline.finish();
      timeline.pause();
    } else if (distance === 0) timeline.pause();
  }
  if (transition === 'push-inspect' && state.lastMovementInspection?.unitId === unit.id) {
    const origin = state.cellsByCoordinate.get(state.lastMovementInspection.origin)?.position;
    if (origin) {
      const fromX = origin.x - target.position.x;
      const fromY = origin.y - target.position.y;
      const progress = movementInspectionProgress(state.lastMovementInspection);
      const targetProgress = state.lastMovementInspection.direction === 1 ? 1 : 0;
      const distance = Math.abs(targetProgress - progress);
      const timeline = visual.animate([
        { translate: `${fromX * (1 - progress)}px ${fromY * (1 - progress)}px` },
        { translate: `${fromX * (1 - targetProgress)}px ${fromY * (1 - targetProgress)}px` },
      ], { duration: Math.max(1, pushAnimationDuration * distance), easing: 'cubic-bezier(.06, .78, .18, 1)', fill: 'both' });
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timeline.finish();
        timeline.pause();
      } else if (distance === 0) timeline.pause();
      else timeline.play();
    }
  }
  if ((transition === 'deploy-in' || transition === 'deploy-out') && state.lastDeploymentInspection?.unitId === unit.id) {
    visual.classList.add('deployment-inspection-animation');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const deployed = state.lastDeploymentInspection.direction === 1;
      visual.style.opacity = deployed ? '1' : '0';
      visual.style.translate = deployed ? '0 0' : '0 -150px';
      if (hexArtwork) target.cell.append(hexArtwork);
      return;
    }
    const progress = deploymentInspectionProgress(state.lastDeploymentInspection);
    const targetProgress = state.lastDeploymentInspection.direction === 1 ? 1 : 0;
    const distance = Math.abs(targetProgress - progress);
    const timeline = visual.animate([
      { opacity: deploymentInspectionOpacity(progress), translate: `0 ${-150 * (1 - progress)}px` },
      { opacity: deploymentInspectionOpacity(targetProgress), translate: `0 ${-150 * (1 - targetProgress)}px` },
    ], { duration: Math.max(1, deploymentAnimationDuration * distance), easing: 'cubic-bezier(.2, .72, .3, 1)', fill: 'both' });
    if (distance === 0) timeline.pause();
  }
  if (hexArtwork) target.cell.append(hexArtwork);
}

function appendServerBash(bash: ServerBashState, showSplitBorder = true, animateEntrance = false): void {
  if (!state.serverMatch) return;
  const target = state.cellsByCoordinate.get(bash.target); const attacker = state.serverMatch.units.find(unit => unit.id === bash.attackerId); const defender = state.serverMatch.units.find(unit => unit.id === bash.defenderId);
  if (!target || !attacker || !defender) return;
  const attackerTroop = serverTroop(attacker.troopId, attacker.owner, attacker);
  const defenderTroop = serverTroop(defender.troopId, defender.owner, defender);
  // Match the fixed screen trays after removal of the old 180-degree board
  // rotation: Blue (Player 2) is on the left and Red (Player 1) on the right.
  const sideUnits: [ServerUnitState, ServerUnitState] = attacker.owner === 2
    ? [attacker, defender]
    : [defender, attacker];
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.classList.add('server-bash-target');
  if (animateEntrance) target.cell.classList.add('bash-entering');
  enableBashSideHover(target.cell, bash, sideUnits);
  target.cell.setAttribute('aria-label', `${attackerTroop ? troopDisplayName(attackerTroop) : attacker.troopId} versus ${defenderTroop ? troopDisplayName(defenderTroop) : defender.troopId}`);
  if (showSplitBorder) {
    // The normal region-edge overlay is appended last.  Hide it on a bash so
    // it cannot paint a full control-colour outline over the two half-borders.
    const vertex = (index: number): Point => {
      const angle = 60 * index * Math.PI / 180;
      return { x: target.position.x + (size - hexGap) * horizontalScale * Math.cos(angle), y: target.position.y + (size - hexGap) * Math.sin(angle) };
    };
    const middle = (left: number, right: number): Point => {
      const a = vertex(left); const b = vertex(right);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const point = (value: Point): string => `${value.x},${value.y}`;
    // The top and bottom outlines each include half of the two side edges.
    // That makes the colour boundary a real horizontal half-hex rather than
    // leaving the middle edges to the underlying normal border.
    const topPath = `M ${point(middle(3, 4))} L ${point(vertex(4))} L ${point(vertex(5))} L ${point(vertex(0))} L ${point(middle(0, 1))}`;
    const bottomPath = `M ${point(middle(0, 1))} L ${point(vertex(1))} L ${point(vertex(2))} L ${point(vertex(3))} L ${point(middle(3, 4))}`;
    const control = serverRegionController(state.serverMatch, bash.target, bash);
    const isHomeOrMiddle = ['player-one-middle', 'player-one-side', 'player-two-middle', 'player-two-side'].some(name => target.cell.classList.contains(name));
    const controlStroke = control === 1 ? (isHomeOrMiddle ? '#fb7185' : '#ef4444') : control === 2 ? (isHomeOrMiddle ? '#60a5fa' : '#3b82f6') : '#e5e7eb';
    // A bash holds two troops in one hex.  Its two half-borders describe
    // their own availability: the troop that moved (and any defender that
    // already acted) is grey; an available defender retains the region colour.
    for (const [pathData, , stroke] of [
      [topPath, attacker, isServerInactive(attacker.owner, attacker.troopId) ? '#94a3b8' : controlStroke],
      [bottomPath, defender, isServerInactive(defender.owner, defender.troopId) ? '#94a3b8' : controlStroke]
    ] as const) {
      const border = document.createElementNS(ns, 'path');
      border.dataset.serverRender = 'bash'; border.classList.add('bash-border');
      if (animateEntrance) border.classList.add('bash-entrance-border');
      border.style.stroke = stroke;
      border.setAttribute('d', pathData);
      keepServerOverlayUpright(border, target.position);
      target.cell.append(border);
    }
  }
  for (const [index, unit] of sideUnits.entries()) {
    const side = index === 0 ? 'left' : 'right';
    const troop = serverTroop(unit.troopId, unit.owner, unit);
    if (troop) {
      const picture = boardCardMarker(troop, target.position);
      picture.dataset.serverRender = 'bash-picture';
      picture.classList.add('board-troop', 'bash-troop-picture', side === 'left' ? 'bash-left-picture' : 'bash-right-picture');
      if (animateEntrance && unit.id === attacker.id) picture.classList.add('bash-entrance-attacker');
      if (isServerInactive(unit.owner, unit.troopId)) picture.classList.add('last-acting-troop');
      keepServerOverlayUpright(picture, target.position);
      target.cell.append(picture);
    }
  }
  // Preserve the hand-drawn edge above both full-size, half-clipped pictures.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  if (hexArtwork) target.cell.append(hexArtwork);

  for (const [index, unit] of sideUnits.entries()) {
    const statX = target.position.x + (index === 0 ? -18 : 18);
    const ownerClass = unit.owner === 1 ? 'player-one-bash' : 'player-two-bash';
    const side = index === 0 ? 'left' : 'right';
    const ui = document.createElementNS(ns, 'g');
    ui.dataset.serverRender = 'bash-ui';
    ui.classList.add('bash-side-ui', `bash-${side}-ui`);
    keepServerOverlayUpright(ui, target.position);
    const health = document.createElementNS(ns, 'text');
    health.dataset.serverRender = 'bash'; health.dataset.unitId = unit.id; health.classList.add('bash-stat', 'bash-health', ownerClass);
    health.setAttribute('x', String(statX)); health.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0)));
    health.textContent = `♥ ${unit.currentHealth}`;
    ui.append(health);
    const modifier = document.createElementNS(ns, 'text');
    modifier.dataset.serverRender = 'bash'; modifier.classList.add('bash-stat', 'bash-modifier', ownerClass);
    modifier.setAttribute('x', String(statX)); modifier.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0) + boardDescriptionLineHeight));
    writeModifierPair(modifier, serverModifier(unit, bash.target, bash), unit.combat.magicModifier);
    ui.append(modifier);
    const troop = serverTroop(unit.troopId, unit.owner, unit);
    if (troop) {
      const description = document.createElementNS(ns, 'text');
      description.dataset.serverRender = 'bash-description';
      description.classList.add('board-troop-description', 'bash-side-description', `bash-${side}-description`);
      writeServerBoardDescription(description, troop, target.position);
      description.querySelector('.board-health')?.remove();
      keepServerOverlayUpright(description, target.position);
      target.cell.append(description);
    }
    target.cell.append(ui);
  }
}

function enableBashSideHover(cell: SVGGElement, bash: ServerBashState, sideUnits: [ServerUnitState, ServerUnitState]): void {
  if (cell.dataset.bashHoverBound) return;
  cell.dataset.bashHoverBound = 'true';
  const clearTimer = (): void => {
    const timer = bashHoverTimers.get(cell);
    if (timer !== undefined) window.clearTimeout(timer);
    bashHoverTimers.delete(cell);
    delete cell.dataset.bashPendingSide;
  };
  cell.addEventListener('pointermove', event => {
    if (!cell.classList.contains('server-bash-target')) return;
    const bounds = cell.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
    const hoveredUnit = sideUnits[side === 'left' ? 0 : 1];
    state.serverBashReveal = hoveredUnit.id === bash.attackerId ? 'attacker' : 'defender';
    showServerHoverDetailsForCoordinate(bash.target);
    const wantedClass = `bash-focus-${side}`;
    if (cell.classList.contains(wantedClass) || cell.dataset.bashPendingSide === side) return;
    const changingSide = cell.classList.contains(side === 'left' ? 'bash-focus-right' : 'bash-focus-left');
    clearTimer();
    cell.classList.remove('bash-focus-left', 'bash-focus-right');
    if (!changingSide) {
      cell.classList.add(wantedClass);
      return;
    }
    cell.dataset.bashPendingSide = side;
    const timer = window.setTimeout(() => {
      if (cell.matches(':hover') && cell.classList.contains('server-bash-target')) cell.classList.add(wantedClass);
      bashHoverTimers.delete(cell);
      delete cell.dataset.bashPendingSide;
    }, 340);
    bashHoverTimers.set(cell, timer);
  });
  cell.addEventListener('pointerleave', () => {
    clearTimer();
    cell.classList.remove('bash-focus-left', 'bash-focus-right');
  });
}

function serverBashIsDodged(bash: ServerBashState, match = state.serverMatch): boolean {
  if (!match) return false;
  const attacker = match.units.find(unit => unit.id === bash.attackerId);
  const defender = match.units.find(unit => unit.id === bash.defenderId);
  const participants = [attacker, defender].filter((unit): unit is ServerUnitState => Boolean(unit));
  // A confirmed displacement can leave the old Bash record alive until the
  // next combat window. Its split visual must disappear immediately.
  if (participants.some(unit => unit.coordinate !== bash.target)) return true;
  const selectedMoveAway = participants.some(participant => {
    const response = match.targetSelections?.[participant.owner];
    return Boolean(response
      && response.troopId === participant.troopId
      && (response.type === 'move' || response.type === 'fly' || response.type === 'resolve-move')
      && response.coordinate !== bash.target);
  });
  const pending = state.serverPendingAction;
  const pendingParticipant = pending
    ? participants.find(participant => participant.id === pending.targetUnitId
      || (participant.owner === state.localMatchPlayer && participant.troopId === pending.troopId))
    : undefined;
  const localMoveAway = Boolean(state.serverPendingAction
    && pendingParticipant
    && (state.serverPendingAction.type === 'move' || state.serverPendingAction.type === 'fly' || state.serverPendingAction.type === 'resolve-move' || state.serverPendingAction.type === 'resolve-pull')
    && (state.serverPendingAction.destination ?? state.serverPendingAction.coordinate) !== bash.target);
  return selectedMoveAway || localMoveAway;
}

function serverPendingActionForPreview(): ServerLegalAction | undefined {
  return pendingActionForPreview(state.serverMatch, state.serverPendingAction);
}

function serverPendingMovementPreview(): ServerMovementPreview | undefined {
  return pendingMovementPreview(state.serverMatch, state.serverPendingAction, state.localMatchPlayer);
}

function serverPendingUnitPreviews(): ServerUnitState[] {
  return pendingUnitPreviews(state.serverMatch, state.serverPendingAction, state.localMatchPlayer, serverTroop);
}

function serverPendingBash(): ServerBashState | undefined {
  return pendingBash(state.serverMatch, state.serverPendingAction, state.localMatchPlayer);
}

/** Show the same combat structure for a selected, not-yet-confirmed bash. */
function appendServerPreviewBash(): void {
  const bash = serverPendingBash();
  if (bash && state.serverHoverPreviewCoordinate !== bash.target) appendServerBash(bash, false, true);
}

function serverBashScreenSide(unit: ServerUnitState): 'left' | 'right' {
  return unit.owner === 2 ? 'left' : 'right';
}

function queueCurrentMovementPreviewReturn(): void {
  const movement = serverPendingMovementPreview();
  const bash = serverPendingBash();
  state.queuedMovementPreviewReturn = movement
    ? {
      unitId: movement.unit.id,
      coordinate: movement.coordinate,
      wasBash: bash?.attackerId === movement.unit.id,
    }
    : undefined;
}

function serverPreviewAt(coordinate: Coordinate): boolean {
  if (serverPendingBash()?.target === coordinate) return true;
  return Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
}

function coordinateHasVisibleBash(coordinate: Coordinate): boolean {
  return serverPendingBash()?.target === coordinate
    || Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
}

function setServerHoverPreview(coordinate: Coordinate, hovering: boolean, bashReveal: 'defender' | 'attacker' = 'defender'): void {
  const animatedBash = serverPendingBash()?.target === coordinate
    || Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
  // Bash inspection is now an in-place, reversible left/right animation.
  // The legacy hover preview rebuilt the board on pointer entry, destroying
  // the animated nodes before their transitions could begin.
  if (animatedBash) {
    if (!hovering && state.serverHoverPreviewCoordinate === coordinate) {
      state.serverHoverPreviewCoordinate = undefined;
      if (state.serverMatch) renderServerMatchState(state.serverMatch);
    }
    return;
  }
  if (state.serverPendingAction?.type === 'bomb' && state.serverPendingAction.coordinate === coordinate) return;
  const next = hovering && serverPreviewAt(coordinate) ? coordinate : undefined;
  if (state.serverHoverPreviewCoordinate === next && (!next || state.serverBashReveal === bashReveal)) return;
  state.serverHoverPreviewCoordinate = next;
  state.serverBashReveal = bashReveal;
  if (state.serverMatch) renderServerMatchState(state.serverMatch);
}

const inspectionController = createBoardInspectionController({
  state,
  isServerInactive,
  coordinateHasVisibleBash,
  renderServerMatchState,
});
const {
  movementInspectionProgress, deploymentInspectionProgress, deploymentInspectionOpacity,
  redirectMovementInspection, beginLastMovementInspection, endLastMovementInspection,
  redirectDeploymentInspection, beginLastDeploymentInspection, endLastDeploymentInspection,
} = inspectionController;

  return {
    clearServerBoardRender,
    serverRegionController,
    serverControllerWithPreview,
    serverModifierEntries,
    serverModifier,
    appendServerBoardUnit,
    appendServerBash,
    serverBashIsDodged,
    serverPendingActionForPreview,
    serverPendingMovementPreview,
    serverPendingUnitPreviews,
    serverPendingBash,
    appendServerPreviewBash,
    serverBashScreenSide,
    queueCurrentMovementPreviewReturn,
    setServerHoverPreview,
    redirectMovementInspection,
    beginLastMovementInspection,
    endLastMovementInspection,
    redirectDeploymentInspection,
    beginLastDeploymentInspection,
    endLastDeploymentInspection,
  };
}
