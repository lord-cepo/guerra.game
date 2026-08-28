import { adjacentCoordinates, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import {
  bombExplosionDuration,
  deploymentAnimationDuration,
  movementAnimationDuration,
  projectileImpactDuration,
  projectileTravelDuration,
  pushAnimationDuration,
  shieldFrameDuration,
} from './board-animation-timing.js';
import type { ServerProjectile } from './board-projectiles.js';
import type { ServerBashState, ServerEffectState, ServerMatchState, ServerTriggerEvent, ServerUnitState } from './protocol.js';

export interface DamageResolutionAnimation {
  targetId: string;
  troopId: string;
  coordinate: Coordinate;
  owner: Player;
  oldHealth: number;
  newHealth: number;
  totalHealth: number;
  oldModifier: number;
  physicalDamage: number;
  includesPhysical: boolean;
  ignoresModifier: boolean;
  delay: number;
  killed: boolean;
  bashSide?: 'left' | 'right';
}

export interface BashResolutionAnimation {
  bash: ServerBashState;
  attacker: ServerUnitState;
  defender: ServerUnitState;
  winnerId?: string;
  delay: number;
  firstStrike?: NonNullable<ServerTriggerEvent['firstStrike']>;
}

export interface GoreMovementResolution {
  unit: ServerUnitState;
  origin: Coordinate;
  destination: Coordinate;
}

export interface ResolutionProjectionOptions {
  replayingLastTurn: boolean;
  localPlayer?: Player;
  reducedMotion: boolean;
  shieldFrameCount: number;
  baseHealthForTroop: (troopId: string) => number | undefined;
  passivesForTroop: (troopId: string) => readonly string[];
  confirmedProjectiles: (match: ServerMatchState) => ServerProjectile[];
}

export function effectIdentity(effect: ServerEffectState): string {
  return `${effect.owner}:${effect.sourceUnitId ?? effect.sourceTroopId}:${effect.kind}:${effect.pierce ? 'pierce' : ''}:${effect.origin ?? ''}:${effect.target}:${effect.targetUnitId ?? ''}:${effect.goreDestination ?? ''}`;
}

function removedEffectsBetween(
  previous: ServerMatchState | undefined,
  next: ServerMatchState,
  included: ReadonlySet<ServerEffectState['kind']>,
): ServerEffectState[] {
  if (!previous || previous.id !== next.id) return [];
  const nextEffectCounts = new Map<string, number>();
  for (const effect of next.effects) {
    const key = effectIdentity(effect);
    nextEffectCounts.set(key, (nextEffectCounts.get(key) ?? 0) + 1);
  }
  return previous.effects.filter(effect => {
    if (!included.has(effect.kind)) return false;
    const key = effectIdentity(effect);
    const remaining = nextEffectCounts.get(key) ?? 0;
    if (remaining <= 0) return true;
    nextEffectCounts.set(key, remaining - 1);
    return false;
  });
}

export function resolvedGoreMovementBetween(previous: ServerMatchState | undefined, next: ServerMatchState): GoreMovementResolution | undefined {
  if (!previous || previous.id !== next.id) return undefined;
  const marker = previous.effects.find(effect => effect.kind === 'gore' && effect.value === 0
    && effect.sourceUnitId && effect.origin && effect.goreDestination
    && !next.effects.some(candidate => effectIdentity(candidate) === effectIdentity(effect)));
  if (!marker?.sourceUnitId || !marker.origin || !marker.goreDestination) return undefined;
  const previousUnit = previous.units.find(candidate => candidate.id === marker.sourceUnitId);
  // Current Gore moves on confirmation. Only legacy snapshots whose attacker
  // was still parked at the origin need a movement animation at resolution.
  if (previousUnit?.coordinate !== marker.origin) return undefined;
  const unit = next.units.find(candidate => candidate.id === marker.sourceUnitId);
  return unit ? { unit, origin: marker.origin, destination: marker.goreDestination } : undefined;
}

export function confirmedOneTimeActionDuration(match: ServerMatchState, options: ResolutionProjectionOptions): number {
  if (options.reducedMotion) return 0;
  const latest = match.events?.at(-1);
  if (!latest || (!options.replayingLastTurn && latest.player === options.localPlayer)) return 0;
  if (latest.action.type === 'deploy') return deploymentAnimationDuration;
  if (latest.action.type === 'push' || latest.action.type === 'pull') return pushAnimationDuration;
  if (latest.action.type === 'move' || latest.action.type === 'fly') return movementAnimationDuration;
  return 0;
}

function goreResolutionDelay(match: ServerMatchState, options: ResolutionProjectionOptions): number {
  if (options.reducedMotion) return 0;
  const latest = match.events?.at(-1);
  if (!latest) return 0;
  if (latest.action.type === 'attack' || latest.action.type === 'magic') return projectileTravelDuration + projectileImpactDuration;
  return confirmedOneTimeActionDuration(match, options);
}

const damagingEffectKinds = new Set<ServerEffectState['kind']>(['attack', 'gore', 'magic', 'cannon', 'bomb']);

export function resolvedDamageAnimations(previous: ServerMatchState | undefined, next: ServerMatchState, explosionDelay: number, options: ResolutionProjectionOptions): DamageResolutionAnimation[] {
  if (!previous || previous.id !== next.id) return [];
  const removed = removedEffectsBetween(previous, next, damagingEffectKinds);
  const grouped = new Map<string, { target: ServerUnitState; effects: ServerEffectState[] }>();
  const latest = next.events?.at(-1);
  for (const effect of removed) {
    if (effect.kind === 'gore' && effect.value <= 0) continue;
    const resolvesAgainstHex = effect.kind === 'bomb' || effect.kind === 'cannon';
    const defeatedArrival = resolvesAgainstHex && latest?.action.coordinate === effect.target
      && (latest.action.type === 'move' || latest.action.type === 'fly' || latest.action.type === 'resolve-move')
      ? previous.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId
        && !next.units.some(candidate => candidate.id === unit.id))
      : resolvesAgainstHex && (latest?.action.type === 'push' || latest?.action.type === 'pull')
        && latest.action.destination === effect.target && latest.action.targetUnitId
        ? previous.units.find(unit => unit.id === latest.action.targetUnitId && !next.units.some(candidate => candidate.id === unit.id))
        : undefined;
    const deploymentHealth = resolvesAgainstHex && latest?.action.type === 'deploy'
      && latest.action.coordinate === effect.target
      && !next.units.some(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId)
      ? options.baseHealthForTroop(latest.action.troopId)
      : undefined;
    const defeatedDeploymentUnit: ServerUnitState | undefined = deploymentHealth === undefined ? undefined : {
      id: `${latest!.player}:${latest!.action.troopId}`,
      troopId: latest!.action.troopId,
      owner: latest!.player,
      coordinate: effect.target,
      permanentDamage: 0,
      currentHealth: deploymentHealth,
      combat: { health: deploymentHealth, modifier: 0, magicModifier: 0, modifiers: [], total: deploymentHealth },
    };
    const targets = resolvesAgainstHex
      ? [
          ...next.units.filter(unit => unit.coordinate === effect.target)
            .map(unit => previous.units.find(candidate => candidate.id === unit.id) ?? unit),
          ...previous.units.filter(unit => unit.coordinate === effect.target && !next.units.some(candidate => candidate.id === unit.id)),
          ...(defeatedArrival ? [defeatedArrival] : []),
          ...(defeatedDeploymentUnit ? [defeatedDeploymentUnit] : []),
        ]
      : [effect.targetUnitId
          ? previous.units.find(unit => unit.id === effect.targetUnitId)
          : previous.units.find(unit => unit.coordinate === effect.target && unit.owner !== effect.owner)]
        .filter((target): target is ServerUnitState => Boolean(target));
    for (const target of [...new Map(targets.map(candidate => [candidate.id, candidate])).values()]) {
      const nextTarget = next.units.find(unit => unit.id === target.id);
      if (effect.kind !== 'bomb' && nextTarget && nextTarget.coordinate !== effect.target) continue;
      const entry = grouped.get(target.id) ?? { target, effects: [] };
      entry.effects.push(effect);
      grouped.set(target.id, entry);
    }
  }
  return [...grouped.values()].map(({ target, effects }) => {
    const nextTarget = next.units.find(unit => unit.id === target.id);
    const physicalEffects = effects.filter(effect => effect.kind === 'attack' || effect.kind === 'gore');
    const bash = [...previous.bashes, ...next.bashes].find(candidate => candidate.target === (effects[0]?.target ?? target.coordinate)
      && (candidate.attackerId === target.id || candidate.defenderId === target.id));
    return {
      targetId: target.id,
      troopId: target.troopId,
      coordinate: effects[0]?.target ?? target.coordinate,
      owner: target.owner,
      oldHealth: target.currentHealth,
      newHealth: nextTarget?.currentHealth ?? 0,
      totalHealth: options.baseHealthForTroop(target.troopId) ?? target.currentHealth,
      oldModifier: target.combat.modifier,
      physicalDamage: physicalEffects.filter(effect => !effect.pierce).reduce((sum, effect) => sum + effect.value, 0),
      includesPhysical: physicalEffects.length > 0,
      ignoresModifier: physicalEffects.length > 0 && physicalEffects.every(effect => effect.pierce),
      delay: effects.some(effect => effect.kind === 'bomb')
        ? explosionDelay + bombExplosionDuration
        : effects.some(effect => effect.kind === 'gore')
          ? goreResolutionDelay(next, options)
          : options.replayingLastTurn && effects.some(effect => effect.kind === 'attack' || effect.kind === 'magic' || effect.kind === 'cannon')
            ? projectileTravelDuration + projectileImpactDuration
            : 0,
      killed: nextTarget === undefined,
      bashSide: bash ? (target.owner === 2 ? 'left' as const : 'right' as const) : undefined,
    };
  });
}

export function instantResolutionPresentation(previous: ServerMatchState | undefined, next: ServerMatchState, options: ResolutionProjectionOptions): { projectiles: ServerProjectile[]; damage: DamageResolutionAnimation[] } {
  if (!previous || previous.id !== next.id) return { projectiles: [], damage: [] };
  const pending = previous.pendingResolution;
  const latest = next.events?.at(-1);
  const action = latest?.action;
  if (!pending || !latest || !action?.coordinate) return { projectiles: [], damage: [] };
  const ranged = (pending.kind === 'instant-ranged' && action.type === 'resolve-instant-ranged')
    || (pending.kind === 'death-attack' && action.type === 'resolve-death-attack');
  const magic = pending.kind === 'instant-magic' && action.type === 'resolve-instant-magic';
  if (!ranged && !magic) return { projectiles: [], damage: [] };
  const kind = ranged ? 'attack' as const : 'magic' as const;
  const projectile: ServerProjectile = {
    key: `instant:${next.id}:${next.revision}:${latest.player}:${pending.sourceTroopId}:${kind}:${action.coordinate}`,
    kind, source: pending.origin, target: action.coordinate, damage: Math.max(1, pending.damage), headMode: 'once', trailMode: 'once',
  };
  const target = action.targetUnitId
    ? previous.units.find(unit => unit.id === action.targetUnitId)
    : previous.units.find(unit => unit.coordinate === action.coordinate && unit.owner !== latest.player);
  if (!target) return { projectiles: [projectile], damage: [] };
  const passives = options.passivesForTroop(target.troopId);
  if ((ranged && passives.includes('titanium')) || (magic && passives.includes('obsidian'))) return { projectiles: [projectile], damage: [] };
  const survivingTarget = next.units.find(unit => unit.id === target.id);
  return { projectiles: [projectile], damage: [{
    targetId: target.id, troopId: target.troopId, coordinate: action.coordinate, owner: target.owner,
    oldHealth: target.currentHealth, newHealth: survivingTarget?.currentHealth ?? 0,
    totalHealth: options.baseHealthForTroop(target.troopId) ?? target.currentHealth,
    oldModifier: target.combat.modifier, physicalDamage: ranged ? pending.damage : 0,
    includesPhysical: ranged, ignoresModifier: false,
    delay: projectileTravelDuration + projectileImpactDuration, killed: survivingTarget === undefined,
  }] };
}

export function resolvedProjectilesForReplay(previous: ServerMatchState | undefined, next: ServerMatchState, options: ResolutionProjectionOptions): ServerProjectile[] {
  const removed = removedEffectsBetween(previous, next, new Set(['attack', 'gore', 'magic', 'cannon']));
  if (!previous || removed.length === 0) return [];
  return options.confirmedProjectiles({ ...previous, effects: removed, events: [] }).map(projectile => ({
    ...projectile, key: `replay-resolved:${next.revision}:${projectile.key}`, headMode: 'once', trailMode: 'once',
  }));
}

export function resolvedBombExplosion(previous: ServerMatchState | undefined, next: ServerMatchState): { origins: Coordinate[]; affected: Coordinate[] } {
  const removed = removedEffectsBetween(previous, next, new Set(['bomb']));
  const origins = [...new Set(removed.map(effect => effect.origin ?? effect.target))];
  return { origins, affected: [...new Set(origins.flatMap(origin => [origin, ...adjacentCoordinates(origin)]))] };
}

export function resolvedBashAnimations(previous: ServerMatchState | undefined, next: ServerMatchState, options: ResolutionProjectionOptions): BashResolutionAnimation[] {
  if (!previous || previous.id !== next.id) return [];
  const previousTriggerCounts = new Map<string, number>();
  for (const event of previous.triggerEvents ?? []) {
    const key = JSON.stringify(event);
    previousTriggerCounts.set(key, (previousTriggerCounts.get(key) ?? 0) + 1);
  }
  const newBashResolutions = (next.triggerEvents ?? []).filter(event => {
    const key = JSON.stringify(event);
    const previousCount = previousTriggerCounts.get(key) ?? 0;
    if (previousCount > 0) {
      previousTriggerCounts.set(key, previousCount - 1);
      return false;
    }
    return event.trigger === 'bashResolved';
  });
  const latest = next.events?.at(-1);
  const playsConfirmedShield = options.replayingLastTurn || latest?.player !== options.localPlayer;
  const shieldDelay = playsConfirmedShield && latest?.action.type === 'self-defense'
    ? shieldFrameDuration * options.shieldFrameCount
    : playsConfirmedShield && latest?.action.type === 'defense'
      ? projectileTravelDuration + shieldFrameDuration * options.shieldFrameCount
      : 0;
  return previous.bashes
    .filter(bash => !next.bashes.some(candidate => candidate.attackerId === bash.attackerId && candidate.defenderId === bash.defenderId && candidate.target === bash.target))
    .filter(bash => newBashResolutions.some(event => event.hex === bash.target && event.attackerId === bash.attackerId && event.defenderId === bash.defenderId))
    .flatMap(bash => {
      const attacker = previous.units.find(unit => unit.id === bash.attackerId);
      const defender = previous.units.find(unit => unit.id === bash.defenderId);
      if (!attacker || !defender) return [];
      const survivors = [attacker, defender].filter(unit => next.units.some(candidate => candidate.id === unit.id));
      const resolution = newBashResolutions.find(event => event.hex === bash.target && event.attackerId === bash.attackerId && event.defenderId === bash.defenderId);
      const resolvesPendingGore = previous.effects.some(effect => effect.kind === 'gore' && effect.target === bash.target
        && effect.sourceUnitId === bash.attackerId && effect.targetUnitId === bash.defenderId);
      return [{
        bash, attacker, defender, winnerId: survivors.length === 1 ? survivors[0]?.id : undefined,
        delay: Math.max(shieldDelay, resolvesPendingGore ? goreResolutionDelay(next, options) : 0),
        firstStrike: resolution?.firstStrike,
      }];
    });
}
