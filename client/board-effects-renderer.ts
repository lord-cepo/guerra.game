import { hexDistance, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import { curvedTrajectory, unwrappedTrajectoryAngles, type Point, type QuadraticTrajectory } from './board-animation-geometry.js';
import { bombExplosionSize, damageResolutionDuration, deathAnimationDuration, projectileCycleDuration, projectileImpactDuration, projectileMaterializationOpacity, projectileTravelDuration, stunAnimationDuration } from './board-animation-timing.js';
import { appendFlyingShield as appendFlyingShieldView, appendMendingFlight as appendMendingFlightView, appendProjectileTrail as appendProjectileTrailView, appendShieldFrameSequence as appendShieldFrameSequenceView, appendStunImage as appendStunImageView } from './board-animation-view.js';
import { boardDescriptionLineHeight, boardDescriptionLineY, signedModifier } from './board-descriptions.js';
import { hexGap, hexPoints, hexSize as size, horizontalScale, svgNamespace as ns } from './board-geometry.js';
import { confirmedServerProjectiles as deriveConfirmedServerProjectiles, serverProjectileKey, stagedServerProjectile as deriveStagedServerProjectile, type ServerProjectile } from './board-projectiles.js';
import type { HexGridState } from './hex-grid-state.js';
import type { ServerBashState, ServerEffectState, ServerMatchState, ServerUnitState } from './protocol.js';
import { actionOfType, permanentUpgradeBonus, rangedDamage, staticAuraBonus, upgradeBonus, type Troop } from './troop-view.js';

interface EffectsRendererContext {
  board: SVGSVGElement;
  state: HexGridState;
  serverTroop(cardId: string, owner: Player, unit?: ServerUnitState): Troop | undefined;
  serverBashIsDodged(bash: ServerBashState, match?: ServerMatchState): boolean;
  serverBashScreenSide(unit: ServerUnitState): 'left' | 'right';
  serverModifier(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): number;
  boardCardMarker(troop: Troop, position: Point, clipId?: string): SVGGElement;
  beginLastMovementInspection(coordinate: Coordinate): boolean;
  beginLastDeploymentInspection(coordinate: Coordinate): boolean;
}

export function createBoardEffectsRenderer(context: EffectsRendererContext) {
  const state = context.state;

function appendServerHexBorderOverlays(): void {
  for (const { cell, position } of state.cellsByCoordinate.values()) {
    const overlay = document.createElementNS(ns, 'polygon');
    overlay.dataset.serverRender = 'border-overlay';
    overlay.classList.add('hex', 'hex-border-overlay');
    overlay.setAttribute('points', hexPoints(position.x, position.y));
    cell.append(overlay);
  }
}

const bombIconSize = 36;
const bombDamageLabelGap = 1;
const bombIgnitionCrossfadeDuration = 350;

function positionBombIcon(image: SVGImageElement, centre: Point): void {
  const radius = bombIconSize / 2;
  image.setAttribute('x', String(centre.x - radius));
  image.setAttribute('y', String(centre.y - radius));
  image.setAttribute('width', String(bombIconSize));
  image.setAttribute('height', String(bombIconSize));
}

function bombIconCentre(position: Point): Point {
  return { x: position.x + (size - hexGap) * horizontalScale * .68, y: position.y };
}

function switchBombIconOnArrival(marker: SVGImageElement, key: string, lit: boolean): SVGImageElement | undefined {
  if (!lit) {
    marker.setAttribute('href', './assets/bomb-unlight.png');
    return undefined;
  }
  let arrivalTime = state.bombIgnitionArrivalTimes.get(key);
  if (arrivalTime === undefined) {
    arrivalTime = performance.now() + projectileTravelDuration;
    state.bombIgnitionArrivalTimes.set(key, arrivalTime);
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const remaining = reducedMotion ? 0 : Math.max(0, arrivalTime - performance.now());
  if (remaining <= 0) {
    marker.setAttribute('href', './assets/bomb-light.png');
    return undefined;
  }
  marker.setAttribute('href', './assets/bomb-unlight.png');
  const litMarker = marker.cloneNode(false) as SVGImageElement;
  litMarker.setAttribute('href', './assets/bomb-light.png');
  litMarker.style.opacity = '0';
  window.setTimeout(() => {
    marker.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: bombIgnitionCrossfadeDuration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    litMarker.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: bombIgnitionCrossfadeDuration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
  }, remaining);
  return litMarker;
}

function appendBombDamageLabel(parent: SVGElement, centre: Point, damage: number, pierce = false): SVGTextElement {
  const label = document.createElementNS(ns, 'text');
  label.dataset.serverRender = 'bomb';
  label.classList.add('bomb-damage-label');
  label.setAttribute('x', String(centre.x - bombIconSize / 2 - bombDamageLabelGap));
  label.setAttribute('y', String(centre.y + 4));
  label.textContent = pierce ? `${damage}P` : String(damage);
  parent.append(label);
  return label;
}

function projectileDamage(troop: Troop, kind: ServerProjectile['kind']): number | undefined {
  if (kind === 'bomb' || kind === 'cannon' || kind === 'gore' || kind === 'upgrade') return undefined;
  const action = actionOfType(troop, kind);
  if (!action || (action.type !== 'attack' && action.type !== 'magic')) return undefined;
  return action.type === 'attack'
    ? rangedDamage(troop, action) + upgradeBonus(troop, 'attack').left + staticAuraBonus(troop, 'attack').left
    : action.damage + permanentUpgradeBonus(troop, 'magic').left + upgradeBonus(troop, 'magic').left + staticAuraBonus(troop, 'magic').left;
}

function confirmedServerProjectiles(match: ServerMatchState): ServerProjectile[] {
  return deriveConfirmedServerProjectiles(match, {
    replayingLastTurn: state.replayingLastTurn,
    localPlayer: state.localMatchPlayer,
    damageForSource: (source, kind) => {
      const troop = context.serverTroop(source.troopId, source.owner, source);
      return troop ? projectileDamage(troop, kind) : undefined;
    },
  });
}

function stagedServerProjectile(match: ServerMatchState): ServerProjectile | undefined {
  return deriveStagedServerProjectile(match, state.serverPendingAction, state.localMatchPlayer, (source, kind) => {
    const troop = context.serverTroop(source.troopId, source.owner, source);
    return troop ? projectileDamage(troop, kind) : undefined;
  });
}

function appendShieldFrameSequence(target: Point, delay = 0, magic = false): void { appendShieldFrameSequenceView(context.board, target, delay, magic); }

function appendServerTriggeredShieldAnimations(match: ServerMatchState, previous: ServerMatchState | undefined): void {
  if (!previous || previous.id !== match.id || previous.revision === match.revision) return;
  const latestType = match.events?.at(-1)?.action.type;
  // Explicit Defense uses the staged/confirmed dispatcher. Snapshot
  // differences here are reserved for triggered physical shield grants.
  if (latestType === 'defense' || latestType === 'self-defense') return;
  for (const unit of match.units) {
    const oldUnit = previous.units.find(candidate => candidate.id === unit.id);
    const oldShield = oldUnit?.shields?.reduce((sum, shield) => sum + shield.value, 0) ?? 0;
    const newShield = unit.shields?.reduce((sum, shield) => sum + shield.value, 0) ?? 0;
    if (!oldUnit || newShield <= oldShield) continue;
    const target = state.cellsByCoordinate.get(unit.coordinate)?.position;
    if (target) appendShieldFrameSequence(target);
  }
}

function appendFlyingShield(source: Point, target: Point, magic = false): void { appendFlyingShieldView(context.board, source, target, magic); }

function appendServerDefenseAnimations(match: ServerMatchState): void {
  const staged = state.serverPendingAction;
  let action: { owner: Player; troopId: string; type: 'defense' | 'self-defense' | 'magic-defense' | 'self-magic-defense'; coordinate?: Coordinate } | undefined;
  if (state.localMatchPlayer && staged && (staged.type === 'defense' || staged.type === 'self-defense' || staged.type === 'magic-defense' || staged.type === 'self-magic-defense')) {
    action = { owner: state.localMatchPlayer, troopId: staged.troopId, type: staged.type, coordinate: staged.coordinate };
  } else {
    const latest = match.events?.at(-1);
    if (state.confirmedDefenseAnimationRevision === match.revision
      && latest
      && (state.replayingLastTurn || latest.player !== state.localMatchPlayer)
      && (latest.action.type === 'defense' || latest.action.type === 'self-defense' || latest.action.type === 'magic-defense' || latest.action.type === 'self-magic-defense')) {
      action = { owner: latest.player, troopId: latest.action.troopId, type: latest.action.type, coordinate: latest.action.coordinate };
    }
  }
  if (!action) return;
  const source = match.units.find(unit => unit.owner === action.owner && unit.troopId === action.troopId);
  const sourcePoint = source ? state.cellsByCoordinate.get(source.coordinate)?.position : undefined;
  const targetCoordinate = action.coordinate ?? source?.coordinate;
  const targetPoint = targetCoordinate ? state.cellsByCoordinate.get(targetCoordinate)?.position : undefined;
  if (!sourcePoint || !targetPoint) return;
  const magic = action.type === 'magic-defense' || action.type === 'self-magic-defense';
  if (action.type === 'self-defense' || action.type === 'self-magic-defense' || targetCoordinate === source?.coordinate) appendShieldFrameSequence(targetPoint, 0, magic);
  else appendFlyingShield(sourcePoint, targetPoint, magic);
}

function appendStunImage(target: Point, elapsed = 0): void { appendStunImageView(context.board, target, elapsed); }

function replayStunAt(coordinate: Coordinate): boolean {
  const unit = state.serverMatch?.units.find(candidate => candidate.coordinate === coordinate);
  if (!unit || (unit.stunnedTurns ?? 0) <= 0) return false;
  const target = state.cellsByCoordinate.get(coordinate)?.position;
  if (!target) return false;
  appendStunImage(target);
  return true;
}

function replayInspectionAt(coordinate: Coordinate): boolean {
  const movement = context.beginLastMovementInspection(coordinate);
  const deployment = context.beginLastDeploymentInspection(coordinate);
  const stun = replayStunAt(coordinate);
  return movement || deployment || stun;
}

function appendServerStunAnimations(match: ServerMatchState): void {
  const activeKeys = new Set<string>();
  for (const effect of match.effects.filter(item => item.kind === 'stun')) {
    const key = `${match.id}:${effect.owner}:${effect.sourceUnitId ?? effect.sourceTroopId}:${effect.targetUnitId ?? ''}:${effect.target}:${effect.value}`;
    activeKeys.add(key);
    let startedAt = state.stunAnimationStartTimes.get(key);
    if (startedAt === undefined) {
      startedAt = performance.now();
      state.stunAnimationStartTimes.set(key, startedAt);
    }
    const elapsed = performance.now() - startedAt;
    if (elapsed >= stunAnimationDuration) continue;
    const target = state.cellsByCoordinate.get(effect.target)?.position;
    if (!target) continue;
    appendStunImage(target, elapsed);
  }
  for (const key of state.stunAnimationStartTimes.keys()) if (!activeKeys.has(key)) state.stunAnimationStartTimes.delete(key);
}

function appendProjectileTrail(trajectory: QuadraticTrajectory, iterations = Infinity, phaseDelay = 0): void { appendProjectileTrailView(context.board, trajectory, iterations, phaseDelay); }

function createProjectileHead(kind: ServerProjectile['kind'], trajectory: QuadraticTrajectory): { moving: SVGGElement; orientation: SVGGElement } {
  const moving = document.createElementNS(ns, 'g');
  moving.dataset.serverRender = 'projectile';
  moving.classList.add('projectile-flight', `projectile-${kind}`);
  moving.setAttribute('transform', `translate(${trajectory.end.x} ${trajectory.end.y})`);
  const orientation = document.createElementNS(ns, 'g');
  orientation.classList.add('projectile-orientation');
  const image = document.createElementNS(ns, 'image');
  const width = kind === 'bomb' ? bombIconSize : kind === 'upgrade' ? 34 : kind === 'cannon' || kind === 'gore' ? 36 : kind === 'magic' ? 38 : 42;
  const height = kind === 'bomb' ? bombIconSize : kind === 'upgrade' ? 34 : kind === 'cannon' || kind === 'gore' ? 35 : kind === 'magic' ? 11 : 6;
  image.setAttribute('href', kind === 'bomb' ? './assets/bomb-unlight.png' : kind === 'upgrade' ? './assets/upgrade.png' : kind === 'cannon' ? './assets/cannon-purple.png' : kind === 'gore' ? './assets/horns.png' : kind === 'magic' ? './assets/fire.png' : './assets/arrow.png');
  image.setAttribute('x', String(-width / 2)); image.setAttribute('y', String(-height / 2));
  image.setAttribute('width', String(width)); image.setAttribute('height', String(height));
  orientation.append(image);
  moving.append(orientation);
  return { moving, orientation };
}

function appendServerProjectile(projectile: ServerProjectile, phaseDelay = 0): void {
  const sourceCell = state.cellsByCoordinate.get(projectile.source)?.position;
  const targetCell = state.cellsByCoordinate.get(projectile.target)?.position;
  if (!sourceCell || !targetCell) return;
  const bombOffset = (size - hexGap) * horizontalScale * .68;
  const source = projectile.kind === 'bomb' ? { x: sourceCell.x - bombOffset, y: sourceCell.y } : sourceCell;
  const latest = state.serverMatch?.events?.at(-1);
  const targetsBomb = projectile.kind === 'magic' && (state.serverMatch?.bombs?.some(bomb => bomb.coordinate === projectile.target)
    || (latest?.action.type === 'magic'
      && latest.action.coordinate === projectile.target
      && state.serverMatch?.effects.some(effect => effect.kind === 'bomb' && effect.target === projectile.target)));
  const target = projectile.kind === 'bomb' || targetsBomb ? bombIconCentre(targetCell) : targetCell;
  const count = projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade' ? 1 : Math.max(1, Math.round(projectile.damage));
  const laneSpacing = projectile.kind === 'magic' ? 7 : 5;
  const arcHeight = Math.max(projectile.kind === 'bomb' ? 42 : 36, hexDistance(projectile.source, projectile.target) * (projectile.kind === 'bomb' ? 20 : 15));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heads: Array<{ element: SVGGElement; movementFrames?: Keyframe[]; orientation?: SVGGElement; rotationFrames?: Keyframe[] }> = [];
  for (let lane = 0; lane < count; lane += 1) {
    const offset = (lane - (count - 1) / 2) * laneSpacing;
    const trajectory = curvedTrajectory(source, target, projectile.kind === 'cannon' || projectile.kind === 'gore' ? 0 : arcHeight, offset);
    const headMode = projectile.headMode ?? 'repeat';
    if (reducedMotion) {
      if (headMode === 'none') continue;
      const { moving, orientation } = createProjectileHead(projectile.kind, trajectory);
      orientation.setAttribute('transform', `rotate(${projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade' ? 0 : trajectory.angleAt(1)})`);
      moving.style.opacity = '.65';
      heads.push({ element: moving });
      continue;
    }
    // Paint the arrow/fireball head after its texture segments so each damage
    // lane reads as one projectile followed by its own fading trail.
    if (projectile.kind !== 'cannon' && projectile.kind !== 'gore') appendProjectileTrail(trajectory, projectile.trailMode === 'once' ? 1 : Infinity, phaseDelay);
    if (headMode === 'none') continue;
    const { moving, orientation } = createProjectileHead(projectile.kind, trajectory);
    const travelFraction = projectileTravelDuration / projectileCycleDuration;
    const impactFraction = (projectileTravelDuration + projectileImpactDuration) / projectileCycleDuration;
    const movementFrames: Keyframe[] = Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24;
      const point = trajectory.pointAt(progress);
      return {
        translate: `${point.x - trajectory.end.x}px ${point.y - trajectory.end.y}px`,
        opacity: projectileMaterializationOpacity(progress),
        offset: progress * travelFraction,
      };
    });
    movementFrames.push({ translate: '0px 0px', opacity: 0, offset: impactFraction });
    movementFrames.push({ translate: '0px 0px', opacity: 0, offset: 1 });
    const trajectoryAngles = projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade'
      ? Array.from({ length: 25 }, () => 0)
      : unwrappedTrajectoryAngles(trajectory, 25);
    const rotationFrames: Keyframe[] = trajectoryAngles.map((angle, index) => {
      const progress = index / 24;
      return { rotate: `${angle}deg`, offset: progress * travelFraction };
    });
    const finalAngle = trajectoryAngles.at(-1) ?? 0;
    rotationFrames.push({ rotate: `${finalAngle}deg`, offset: impactFraction });
    rotationFrames.push({ rotate: `${finalAngle}deg`, offset: 1 });
    heads.push({ element: moving, movementFrames, orientation, rotationFrames });
  }
  // SVG uses document order for paint order. Append all heads only after all
  // lanes' segments so a later lane can never cover an earlier projectile.
  for (const head of heads) {
    context.board.append(head.element);
    const iterations = projectile.headMode === 'once' ? 1 : Infinity;
    const fill = projectile.headMode === 'once' ? 'forwards' : 'none';
    if (head.movementFrames) head.element.animate(head.movementFrames, { duration: projectileCycleDuration, delay: phaseDelay, iterations, easing: 'linear', fill });
    if (head.orientation && head.rotationFrames) head.orientation.animate(head.rotationFrames, { duration: projectileCycleDuration, delay: phaseDelay, iterations, easing: 'linear', fill });
  }
  if (projectile.kind === 'bomb' && projectile.headMode === 'once') state.playedConfirmedBombHeads.add(projectile.key);
  if (projectile.kind === 'upgrade' && projectile.headMode === 'once') state.playedConfirmedUpgradeHeads.add(projectile.key);
  if (projectile.presentation === 'ignition' && projectile.headMode === 'once') state.playedConfirmedBombIgnitions.add(projectile.key);
}

function confirmedBombProjectiles(match: ServerMatchState): ServerProjectile[] {
  const activeKeys = new Set<string>();
  const projectiles = (match.bombs ?? []).flatMap(bomb => {
    const key = serverProjectileKey(bomb.owner, bomb.sourceTroopId, 'bomb', bomb.coordinate);
    activeKeys.add(key);
    let source = state.confirmedBombTrajectorySources.get(key);
    if (!source) {
      source = match.units.find(unit => unit.owner === bomb.owner && unit.troopId === bomb.sourceTroopId)?.coordinate;
      if (source) state.confirmedBombTrajectorySources.set(key, source);
    }
    // The throw remains legible for as long as its source troop is inactive.
    // Once another troop acts for that owner, the bomber becomes available
    // again and the fixed bomb no longer needs its historical trajectory.
    return source && match.lastActingTroopId?.[bomb.owner] === bomb.sourceTroopId ? [{
      key,
      kind: 'bomb' as const,
      source,
      target: bomb.coordinate,
      damage: 1,
      headMode: state.playedConfirmedBombHeads.has(key) ? 'none' as const : 'once' as const,
    }] : [];
  });
  for (const key of state.confirmedBombTrajectorySources.keys()) if (!activeKeys.has(key)) {
    state.confirmedBombTrajectorySources.delete(key);
    state.playedConfirmedBombHeads.delete(key);
    state.confirmedBombArrivalTimes.delete(key);
  }
  return projectiles;
}

/** Keep a confirmed Upgrade throw visible through the opponent's response and
 * until the upgrading player's next action ends. */
function confirmedUpgradeProjectiles(match: ServerMatchState): ServerProjectile[] {
  const activeKeys = new Set<string>();
  const projectiles: ServerProjectile[] = [];
  for (const owner of [1, 2] as const) {
    const sourceTroopId = match.lastActingTroopId?.[owner];
    if (!sourceTroopId) continue;
    const event = [...(match.events ?? [])].reverse().find(candidate =>
      candidate.player === owner && candidate.action.type === 'upgrade'
      && candidate.action.troopId === sourceTroopId && candidate.action.coordinate);
    if (!event?.action.coordinate) continue;
    const source = match.units.find(unit => unit.owner === owner && unit.troopId === sourceTroopId);
    if (!source) continue;
    const key = serverProjectileKey(owner, source.id, 'upgrade', event.action.coordinate);
    activeKeys.add(key);
    let sourceCoordinate = state.confirmedUpgradeTrajectorySources.get(key);
    if (!sourceCoordinate) {
      sourceCoordinate = source.coordinate;
      state.confirmedUpgradeTrajectorySources.set(key, sourceCoordinate);
    }
    projectiles.push({
      key,
      kind: 'upgrade',
      source: sourceCoordinate,
      target: event.action.coordinate,
      damage: 1,
      headMode: state.playedConfirmedUpgradeHeads.has(key) ? 'none' : 'once',
    });
  }
  for (const key of state.confirmedUpgradeTrajectorySources.keys()) if (!activeKeys.has(key)) {
    state.confirmedUpgradeTrajectorySources.delete(key);
    state.playedConfirmedUpgradeHeads.delete(key);
  }
  return projectiles;
}

function appendServerProjectiles(match: ServerMatchState): void {
  const staged = stagedServerProjectile(match);
  const active = [...confirmedServerProjectiles(match), ...confirmedBombProjectiles(match), ...confirmedUpgradeProjectiles(match), ...(staged ? [staged] : [])];
  const unique = [...new Map(active.map(projectile => [projectile.key, projectile])).values()];
  const activeKeys = new Set(unique.map(projectile => projectile.key));
  for (const key of state.projectileAnimationStartTimes.keys()) if (!activeKeys.has(key)) state.projectileAnimationStartTimes.delete(key);
  for (const projectile of unique) {
    if (projectile.presentation === 'ignition' && state.playedConfirmedBombIgnitions.has(projectile.key)) continue;
    let startedAt = state.projectileAnimationStartTimes.get(projectile.key);
    if (startedAt === undefined) {
      startedAt = performance.now();
      state.projectileAnimationStartTimes.set(projectile.key, startedAt);
    }
    // Staged and authoritative delayed projectiles share a stable key. A
    // negative delay lets a confirmation render resume the same cycle instead
    // of visibly launching a duplicate volley from the source.
    const phaseDelay = projectile.headMode === 'once' ? 0 : -(performance.now() - startedAt) % projectileCycleDuration;
    appendServerProjectile(projectile, phaseDelay);
  }
}

function appendMendingFlight(source: Point, target: Point, mode: 'repeat' | 'once', playSweep: boolean): void { appendMendingFlightView(context.board, source, target, mode, playSweep); }

function appendServerMendingAnimations(match: ServerMatchState): void {
  const staged = state.serverPendingAction?.type === 'mending' ? state.serverPendingAction : undefined;
  if (staged?.coordinate && state.localMatchPlayer) {
    const source = match.units.find(unit => unit.owner === state.localMatchPlayer && unit.troopId === staged.troopId);
    const sourcePoint = source ? state.cellsByCoordinate.get(source.coordinate)?.position : undefined;
    const targetPoint = state.cellsByCoordinate.get(staged.coordinate)?.position;
    if (!sourcePoint || !targetPoint) return;
    const key = `${match.id}:${state.localMatchPlayer}:${staged.troopId}:${staged.coordinate}`;
    const playSweep = state.playedPreviewMendingSweepKey !== key;
    state.playedPreviewMendingSweepKey = key;
    appendMendingFlight(sourcePoint, targetPoint, 'repeat', playSweep);
    return;
  }
  state.playedPreviewMendingSweepKey = undefined;
  const latest = match.events?.at(-1);
  if (state.confirmedMendingAnimationRevision !== match.revision
    || (!state.replayingLastTurn && latest?.player === state.localMatchPlayer)
    || latest?.action.type !== 'mending'
    || !latest.action.coordinate) return;
  const source = match.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
  const sourcePoint = source ? state.cellsByCoordinate.get(source.coordinate)?.position : undefined;
  const targetPoint = state.cellsByCoordinate.get(latest.action.coordinate)?.position;
  if (sourcePoint && targetPoint) appendMendingFlight(sourcePoint, targetPoint, 'once', true);
}

/** Reveal the modifier used by physical ranged damage after first impact. */
function appendPhysicalDamageModifiers(match: ServerMatchState): void {
  const targets: Array<{ key: string; coordinate: Coordinate; target: ServerUnitState }> = [];
  if (state.serverPendingAction?.type === 'attack' && state.serverPendingAction.coordinate && state.localMatchPlayer) {
    const source = match.units.find(unit => unit.owner === state.localMatchPlayer && unit.troopId === state.serverPendingAction?.troopId);
    const target = state.serverPendingAction.targetUnitId
      ? match.units.find(unit => unit.id === state.serverPendingAction?.targetUnitId)
      : match.units.find(unit => unit.coordinate === state.serverPendingAction?.coordinate && unit.owner !== state.localMatchPlayer);
    const sourceTroop = source ? context.serverTroop(source.troopId, source.owner) : undefined;
    if (source && target && !actionOfType(sourceTroop!, 'attack')?.qualifiers?.includes('pierce')) targets.push({
      key: serverProjectileKey(state.localMatchPlayer, source.id, 'attack', state.serverPendingAction.coordinate),
      coordinate: state.serverPendingAction.coordinate,
      target,
    });
  }
  for (const effect of match.effects) {
    if (effect.kind !== 'attack' && effect.kind !== 'gore') continue;
    if (effect.pierce) continue;
    const sourceId = effect.sourceUnitId ?? `${effect.owner}:${effect.sourceTroopId}`;
    const target = effect.targetUnitId
      ? match.units.find(unit => unit.id === effect.targetUnitId)
      : match.units.find(unit => unit.coordinate === effect.target && unit.owner !== effect.owner);
    if (target) targets.push({
      key: serverProjectileKey(effect.owner, sourceId, 'attack', effect.target),
      coordinate: effect.target,
      target,
    });
  }
  const activeKeys = new Set(targets.map(target => target.key));
  for (const key of state.physicalModifierArrivalTimes.keys()) if (!activeKeys.has(key)) state.physicalModifierArrivalTimes.delete(key);
  for (const { key, coordinate, target } of [...new Map(targets.map(item => [item.key, item])).values()]) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    let arrivalTime = state.physicalModifierArrivalTimes.get(key);
    if (arrivalTime === undefined) {
      arrivalTime = performance.now() + projectileTravelDuration;
      state.physicalModifierArrivalTimes.set(key, arrivalTime);
    }
    const bash = match.bashes.find(candidate => candidate.target === coordinate && !context.serverBashIsDodged(candidate, match));
    const x = cell.position.x + (bash ? (context.serverBashScreenSide(target) === 'left' ? -18 : 18) : 0);
    const label = document.createElementNS(ns, 'text');
    label.dataset.serverRender = 'physical-modifier';
    label.classList.add('bash-stat', 'bash-modifier', target.owner === 1 ? 'player-one-bash' : 'player-two-bash');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
    const modifier = context.serverModifier(target, coordinate, bash);
    label.textContent = `${modifier >= 0 ? '+' : ''}${modifier}`;
    const remaining = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.max(0, arrivalTime - performance.now());
    if (remaining > 0) {
      label.classList.add('physical-modifier-awaiting-impact');
      window.setTimeout(() => label.classList.remove('physical-modifier-awaiting-impact'), remaining);
    }
    context.board.append(label);
  }
}

function appendDamageResolutionAnimations(): void {
  for (const animation of state.damageResolutionAnimations) {
    const cell = state.cellsByCoordinate.get(animation.coordinate);
    if (!cell) continue;
    let deathCard: SVGGElement | undefined;
    let skull: SVGImageElement | undefined;
    if (animation.killed) {
      const troop = context.serverTroop(animation.troopId, animation.owner);
      if (troop) {
        deathCard = context.boardCardMarker(troop, cell.position, cell.cell.dataset.clipId);
        deathCard.dataset.serverRender = 'death-animation';
        deathCard.classList.add('board-troop', 'death-resolution-card');
        cell.cell.append(deathCard);
        const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
        if (artwork) cell.cell.append(artwork);
      }
      skull = document.createElementNS(ns, 'image');
      skull.dataset.serverRender = 'death-animation';
      skull.classList.add('death-resolution-skull');
      skull.setAttribute('href', './assets/skull.png');
      skull.setAttribute('x', String(cell.position.x - 34));
      skull.setAttribute('y', String(cell.position.y - 34));
      skull.setAttribute('width', '68');
      skull.setAttribute('height', '68');
      skull.style.animationDelay = `${animation.delay + damageResolutionDuration}ms`;
      // Death belongs to the impacted hex, not to the authoritative unit node
      // that disappears in the same revision. Ordinary selection/hover
      // rerenders therefore leave the retained card and skull intact.
      cell.cell.append(skull);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        deathCard?.animate([
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: .55 },
          { opacity: 0, offset: 1 },
        ], {
          duration: deathAnimationDuration,
          delay: animation.delay + damageResolutionDuration,
          easing: 'ease-in-out',
          fill: 'forwards',
        });
      }
    }
    // Hide the already-updated authoritative row immediately. Delayed
    // presentations (Bomb explosion or replayed projectile flight) keep the
    // old value visible until their slash actually begins.
    cell.cell.classList.add('damage-resolving');
    const slash = document.createElementNS(ns, 'image');
    slash.dataset.serverRender = 'damage-resolution';
    slash.classList.add('damage-resolution-slash');
    slash.style.animationDelay = `${animation.delay}ms`;
    slash.setAttribute('href', './assets/slash.png');
    slash.setAttribute('x', String(cell.position.x - 34));
    slash.setAttribute('y', String(cell.position.y - 43));
    slash.setAttribute('width', '68');
    slash.setAttribute('height', '68');
    context.board.append(slash);

    const health = document.createElementNS(ns, 'text');
    health.dataset.serverRender = 'damage-resolution';
    health.classList.add('bash-stat', 'damage-resolution-health', animation.owner === 1 ? 'player-one-health' : 'player-two-health');
    const healthX = cell.position.x + (animation.bashSide === 'left' ? -18 : animation.bashSide === 'right' ? 18 : 0);
    health.setAttribute('x', String(healthX));
    health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
    const healthText = (actual: number): string => animation.bashSide
      ? `♥ ${actual}`
      : `${actual} ♥ ${animation.totalHealth}`;
    health.textContent = healthText(animation.oldHealth);
    const bashHealth = [...cell.cell.querySelectorAll<SVGTextElement>('.bash-health')]
      .find(label => label.dataset.unitId === animation.targetId);
    if (bashHealth) bashHealth.style.opacity = '0';
    context.board.append(health);

    let modifier: SVGTextElement | undefined;
    if (animation.includesPhysical && !animation.ignoresModifier) {
      modifier = document.createElementNS(ns, 'text');
      modifier.dataset.serverRender = 'damage-resolution';
      modifier.classList.add('bash-stat', 'bash-modifier', animation.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(healthX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(animation.oldModifier);
      context.board.append(modifier);
      const absorbed = Math.min(Math.max(0, animation.oldModifier), animation.physicalDamage);
      for (let step = 1; step <= 4; step += 1) window.setTimeout(() => {
        if (modifier) modifier.textContent = signedModifier(Math.round(animation.oldModifier - absorbed * step / 4));
      }, animation.delay + step * 120);
    }
    const healthLoss = Math.max(0, animation.oldHealth - animation.newHealth);
    const healthCountdownStart = animation.includesPhysical ? 600 : 120;
    for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
      const actual = Math.round(animation.oldHealth - healthLoss * step / 5);
      health.textContent = healthText(actual);
    }, animation.delay + healthCountdownStart + step * 150);
    window.setTimeout(() => {
      slash.remove();
      modifier?.remove();
      if (animation.killed) {
        cell.cell.classList.remove('damage-resolving');
        health.remove();
      } else {
        // Keep the final authoritative value mounted until the next ordinary
        // board render. Relying on the underlying row alone can leave a blank
        // stat area after replay/resolution until hover causes another render.
        health.textContent = healthText(animation.newHealth);
        health.style.opacity = '1';
      }
    }, animation.delay + damageResolutionDuration);
    if (animation.killed) window.setTimeout(() => {
      deathCard?.remove();
      skull?.remove();
    }, animation.delay + damageResolutionDuration + deathAnimationDuration);
  }
}

function appendBombExplosionAnimations(): void {
  for (const coordinate of state.explosionAffectedCoordinates) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const highlight = document.createElementNS(ns, 'polygon');
    highlight.dataset.serverRender = 'bomb-explosion';
    highlight.classList.add('bomb-explosion', 'bomb-explosion-highlight');
    highlight.style.animationDelay = `${state.explosionResolutionDelay}ms`;
    highlight.setAttribute('points', hexPoints(cell.position.x, cell.position.y));
    context.board.append(highlight);
  }
  for (const coordinate of state.explosionResolutionCoordinates) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const explosion = document.createElementNS(ns, 'image');
    explosion.dataset.serverRender = 'bomb-explosion';
    explosion.classList.add('bomb-explosion');
    explosion.style.animationDelay = `${state.explosionResolutionDelay}ms`;
    explosion.setAttribute('href', './assets/explosion-purple.png');
    explosion.setAttribute('x', String(cell.position.x - bombExplosionSize / 2));
    explosion.setAttribute('y', String(cell.position.y - bombExplosionSize / 2 - 20));
    explosion.setAttribute('width', String(bombExplosionSize));
    explosion.setAttribute('height', String(bombExplosionSize));
    context.board.append(explosion);
  }
}

function appendBashResolutionAnimations(match: ServerMatchState): void {
  for (const animation of state.bashResolutionAnimations) {
    const cell = state.cellsByCoordinate.get(animation.bash.target);
    if (!cell) continue;
    cell.cell.classList.add('bash-resolving');
    const units = [animation.attacker, animation.defender].sort((left, right) => right.owner - left.owner);
    const firstStrike = animation.firstStrike;
    const firstStrikeTarget = firstStrike ? [animation.attacker, animation.defender].find(unit => unit.id === firstStrike.targetId) : undefined;
    const firstStrikeTargetSurvives = Boolean(firstStrike?.targetSurvived && firstStrikeTarget);
    const combatDuration = firstStrike
      ? damageResolutionDuration * (firstStrikeTargetSurvives ? 2 : 1)
      : damageResolutionDuration;
    const sliderStart = animation.delay + combatDuration;
    const sideOf = (unit: ServerUnitState): 'left' | 'right' => unit.owner === 2 ? 'left' : 'right';
    const appendSlash = (unit: ServerUnitState | undefined, delay: number): void => {
      const slash = document.createElementNS(ns, 'image');
      slash.dataset.serverRender = 'bash-resolution';
      slash.classList.add('damage-resolution-slash');
      slash.style.animationDelay = `${delay}ms`;
      slash.setAttribute('href', './assets/slash.png');
      const side = unit ? sideOf(unit) : undefined;
      slash.setAttribute('x', String(cell.position.x + (side === 'left' ? -18 : side === 'right' ? 18 : 0) - 34));
      slash.setAttribute('y', String(cell.position.y - 43));
      slash.setAttribute('width', '68');
      slash.setAttribute('height', '68');
      context.board.append(slash);
    };
    if (firstStrike) {
      appendSlash(firstStrikeTarget, animation.delay);
      if (firstStrikeTargetSurvives) {
        const firstStrikeUnit = units.find(unit => unit.id === firstStrike.unitId);
        appendSlash(firstStrikeUnit, animation.delay + damageResolutionDuration);
      }
    } else appendSlash(undefined, animation.delay);
    for (const [index, unit] of units.entries()) {
      const side = index === 0 ? 'left' : 'right';
      const troop = context.serverTroop(unit.troopId, unit.owner, unit);
      if (!troop) continue;
      const picture = context.boardCardMarker(troop, cell.position);
      picture.dataset.serverRender = 'bash-resolution';
      picture.classList.add('board-troop', 'bash-troop-picture', side === 'left' ? 'bash-left-picture' : 'bash-right-picture');
      cell.cell.append(picture);
      const statX = cell.position.x + (side === 'left' ? -18 : 18);
      const ui = document.createElementNS(ns, 'g');
      ui.dataset.serverRender = 'bash-resolution';
      const health = document.createElementNS(ns, 'text');
      health.classList.add('bash-stat', 'bash-health', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      health.setAttribute('x', String(statX));
      health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
      health.textContent = `♥ ${unit.currentHealth}`;
      const modifier = document.createElementNS(ns, 'text');
      modifier.classList.add('bash-stat', 'bash-modifier', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(statX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(unit.combat.modifier);
      ui.append(health, modifier);
      cell.cell.append(ui);
      const won = unit.id === animation.winnerId;
      const finalClip = won ? 'inset(0)' : side === 'left' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
      picture.animate([{ clipPath: getComputedStyle(picture).clipPath }, { clipPath: finalClip, opacity: won ? 1 : 0 }], {
        duration: 420,
        delay: sliderStart,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      ui.animate([
        { opacity: 1, translate: '0 0' },
        { opacity: won ? 1 : 0, translate: won ? `${side === 'left' ? 18 : -18}px 0` : '0 0' },
      ], { duration: 420, delay: sliderStart, easing: 'ease-in-out', fill: 'forwards' });
      const nextUnit = match.units.find(candidate => candidate.id === unit.id);
      const finalHealth = nextUnit?.currentHealth ?? 0;
      const isFirstStrikeTarget = firstStrike?.targetId === unit.id;
      const isFirstStrikeUnit = firstStrike?.unitId === unit.id;
      const firstStrikeTargetHealth = firstStrikeTarget && isFirstStrikeTarget
        ? Math.max(0, unit.currentHealth - firstStrike.firstDamage)
        : undefined;
      const healthStart = isFirstStrikeUnit && firstStrikeTargetSurvives
        ? animation.delay + damageResolutionDuration
        : animation.delay;
      const healthEnd = isFirstStrikeTarget && firstStrikeTargetHealth !== undefined && firstStrikeTargetSurvives
        ? firstStrikeTargetHealth
        : finalHealth;
      for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
        const actual = Math.round(unit.currentHealth - (unit.currentHealth - healthEnd) * step / 5);
        health.textContent = `♥ ${actual}`;
      }, healthStart + 600 + step * 150);
      if (isFirstStrikeTarget && firstStrikeTargetSurvives) {
        for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
          const actual = Math.round((firstStrikeTargetHealth ?? unit.currentHealth) - ((firstStrikeTargetHealth ?? unit.currentHealth) - finalHealth) * step / 5);
          health.textContent = `♥ ${actual}`;
        }, animation.delay + damageResolutionDuration + 600 + step * 150);
      }
      window.setTimeout(() => modifier.remove(), sliderStart);
      window.setTimeout(() => {
        cell.cell.classList.remove('bash-resolving');
        picture.remove();
        ui.remove();
      }, sliderStart + 430);
    }
    const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
    if (artwork) cell.cell.append(artwork);
  }
}

/** Unlit bombs coexist with units beside the same vertex used by the preview. */
function appendServerBombs(match: ServerMatchState): void {
  const preview = state.serverPendingAction?.type === 'magic' ? state.serverPendingAction : undefined;
  const latest = match.events?.at(-1);
  const pendingPush = (state.serverPendingAction?.type === 'push' || state.serverPendingAction?.type === 'pull') && state.serverPendingAction.targetBomb ? state.serverPendingAction : undefined;
  const confirmedPush = state.confirmedMovementAnimationRevision === match.revision
    && (latest?.action.type === 'push' || latest?.action.type === 'pull') && latest.action.targetBomb ? latest.action : undefined;
  const bombPush = pendingPush ?? confirmedPush;
  const pushOrigin = pendingPush?.coordinate ?? (confirmedPush ? latest?.origin : undefined);
  const pushDestination = bombPush?.destination;
  const sourceBomb = pendingPush && pushOrigin ? match.bombs?.find(bomb => bomb.coordinate === pushOrigin) : undefined;
  const landingBomb = pendingPush && pushDestination ? match.bombs?.find(bomb => bomb.coordinate === pushDestination) : undefined;
  const displayedBombs = sourceBomb && pushDestination
    ? [
        ...(match.bombs ?? []).filter(bomb => bomb !== sourceBomb && bomb !== landingBomb),
        { ...(landingBomb ?? sourceBomb), coordinate: pushDestination, damage: sourceBomb.damage + (landingBomb?.damage ?? 0), pierce: (sourceBomb.pierce ?? false) || (landingBomb?.pierce ?? false) },
      ]
    : [...(match.bombs ?? [])];
  const activePreviewKeys = new Set<string>();
  for (const bomb of displayedBombs) {
    const target = state.cellsByCoordinate.get(bomb.coordinate); if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    // Match the endpoint used by the shared Bomb projectile trajectory.
    const centre = bombIconCentre(target.position);
    const ignitionKey = `preview-ignition:${match.id}:${preview?.troopId ?? ''}:${bomb.coordinate}`;
    const previewIgnitesBomb = preview?.coordinate === bomb.coordinate;
    if (previewIgnitesBomb) activePreviewKeys.add(ignitionKey);
    positionBombIcon(marker, centre);
    const litMarker = switchBombIconOnArrival(marker, ignitionKey, previewIgnitesBomb);
    const label = appendBombDamageLabel(target.cell, centre, bomb.damage, bomb.pierce);
    if (pushOrigin && pushDestination === bomb.coordinate) {
      const origin = state.cellsByCoordinate.get(pushOrigin)?.position;
      if (origin) for (const element of [marker, label]) {
        element.classList.add('bomb-push-animation');
        element.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
        element.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
      }
    }
    const key = serverProjectileKey(bomb.owner, bomb.sourceTroopId, 'bomb', bomb.coordinate);
    const arrivalTime = state.confirmedBombArrivalTimes.get(key);
    const remainingTravel = arrivalTime === undefined || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : Math.max(0, arrivalTime - performance.now());
    if (remainingTravel > 0) {
      marker.classList.add('bomb-awaiting-arrival');
      label.classList.add('bomb-awaiting-arrival');
      window.setTimeout(() => {
        marker.classList.remove('bomb-awaiting-arrival');
        label.classList.remove('bomb-awaiting-arrival');
      }, remainingTravel);
    }
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
  for (const key of state.bombIgnitionArrivalTimes.keys()) {
    if (key.startsWith('preview-ignition:') && !activePreviewKeys.has(key)) state.bombIgnitionArrivalTimes.delete(key);
  }
}

function appendConfirmedIgnitedBomb(match: ServerMatchState): void {
  const latest = match.events?.at(-1);
  const centerEffects = new Map<Coordinate, ServerEffectState>();
  for (const effect of match.effects) {
    if (effect.kind !== 'bomb' || !effect.origin || effect.target !== effect.origin) continue;
    centerEffects.set(effect.origin, effect);
  }
  // Persisted matches created before bomb origins were recorded can still
  // identify a direct Fire Magic ignition from the latest action.
  if (latest?.action.type === 'magic' && latest.action.coordinate && !centerEffects.has(latest.action.coordinate)) {
    const legacyCenter = match.effects.find(effect => effect.kind === 'bomb' && effect.target === latest.action.coordinate);
    if (legacyCenter) centerEffects.set(latest.action.coordinate, legacyCenter);
  }
  for (const [coordinate, effect] of centerEffects) {
    const target = state.cellsByCoordinate.get(coordinate);
    if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    const centre = bombIconCentre(target.position);
    positionBombIcon(marker, centre);
    const key = `confirmed-ignition:${match.id}:${match.revision}:${coordinate}`;
    const isConfirmedFireIgnition = latest?.action.type === 'magic' && latest.action.coordinate === coordinate;
    const waitsForOpponentPlayback = isConfirmedFireIgnition
      && (state.replayingLastTurn || latest.player !== state.localMatchPlayer)
      && state.bombIgnitionArrivalTimes.has(key);
    let litMarker: SVGImageElement | undefined;
    if (waitsForOpponentPlayback) litMarker = switchBombIconOnArrival(marker, key, true);
    else marker.setAttribute('href', './assets/bomb-light.png');
    appendBombDamageLabel(target.cell, centre, effect.value, effect.pierce);
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
}

  return {
    appendServerHexBorderOverlays, appendServerTriggeredShieldAnimations, appendServerDefenseAnimations, appendServerProjectile,
    replayInspectionAt, appendServerStunAnimations, appendServerProjectiles, appendServerMendingAnimations,
    appendPhysicalDamageModifiers, appendDamageResolutionAnimations, appendBombExplosionAnimations,
    appendBashResolutionAnimations, appendServerBombs, appendConfirmedIgnitedBomb, confirmedServerProjectiles,
  };
}
