import type { Coordinate } from '../game/board.js';
import { hexDistance } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';

export interface ServerProjectile {
  key: string;
  kind: 'attack' | 'magic' | 'bomb' | 'cannon' | 'gore' | 'upgrade';
  source: Coordinate;
  target: Coordinate;
  damage: number;
  headMode?: 'repeat' | 'once' | 'none';
  trailMode?: 'repeat' | 'once';
  presentation?: 'ignition';
}

export function serverProjectileKey(owner: Player, sourceId: string, kind: ServerProjectile['kind'], target: Coordinate): string {
  return `${owner}:${sourceId}:${kind}:${target}`;
}

interface ConfirmedProjectileOptions {
  replayingLastTurn: boolean;
  localPlayer?: Player;
  damageForSource: (source: ServerUnitState, kind: 'attack' | 'magic') => number | undefined;
}

/** Project authoritative pending effects into stable projectile identities. */
export function confirmedServerProjectiles(match: ServerMatchState, options: ConfirmedProjectileOptions): ServerProjectile[] {
  const projectiles: ServerProjectile[] = [];
  for (const effect of match.effects) {
    if (effect.kind === 'gore' && effect.sourceUnitId && effect.origin) {
      const source = match.units.find(unit => unit.id === effect.sourceUnitId);
      const destination = effect.goreDestination ?? effect.target;
      if (source) projectiles.push({
        key: serverProjectileKey(effect.owner, source.id, 'gore', destination),
        kind: 'gore',
        source: effect.origin,
        target: destination,
        damage: 1,
        ...(options.replayingLastTurn ? { headMode: 'once', trailMode: 'once' } as const : {}),
      });
      continue;
    }
    if ((effect.kind !== 'attack' && effect.kind !== 'magic') || !effect.sourceUnitId) continue;
    const source = match.units.find(unit => unit.id === effect.sourceUnitId);
    const sourceCoordinate = source?.coordinate ?? effect.origin;
    if (sourceCoordinate) projectiles.push({
      key: serverProjectileKey(effect.owner, source?.id ?? effect.sourceUnitId, effect.kind, effect.target),
      kind: effect.kind,
      source: sourceCoordinate,
      target: effect.target,
      damage: effect.value,
    });
  }

  const cannonEffects = match.effects.filter(effect => effect.kind === 'cannon' && effect.sourceUnitId);
  const cannonGroups = new Map<string, typeof cannonEffects>();
  for (const effect of cannonEffects) {
    const key = `${effect.owner}:${effect.sourceUnitId}`;
    cannonGroups.set(key, [...(cannonGroups.get(key) ?? []), effect]);
  }
  for (const effects of cannonGroups.values()) {
    const first = effects[0];
    const source = first?.sourceUnitId ? match.units.find(unit => unit.id === first.sourceUnitId) : undefined;
    if (!first || !source) continue;
    const target = effects.reduce((farthest, effect) =>
      hexDistance(source.coordinate, effect.target) > hexDistance(source.coordinate, farthest.target) ? effect : farthest
    ).target;
    projectiles.push({
      key: serverProjectileKey(first.owner, source.id, 'cannon', target),
      kind: 'cannon', source: source.coordinate, target, damage: 1,
    });
  }

  // Fire Magic ignition replaces its direct effect with pending bomb effects.
  const latest = match.events?.at(-1);
  if (latest?.action.type === 'magic' && latest.action.coordinate
    && match.effects.some(effect => effect.owner === latest.player && effect.kind === 'bomb' && effect.target === latest.action.coordinate)) {
    const target = latest.action.coordinate;
    const source = match.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
    const damage = source ? options.damageForSource(source, 'magic') : undefined;
    if (source) projectiles.push({
      key: serverProjectileKey(latest.player, source.id, 'magic', target),
      kind: 'magic', source: source.coordinate, target, damage: 1, headMode: 'none',
    });
    if ((options.replayingLastTurn || latest.player !== options.localPlayer) && source && damage !== undefined) projectiles.push({
      key: `ignition:${match.id}:${match.revision}:${serverProjectileKey(latest.player, source.id, 'magic', target)}`,
      kind: 'magic', source: source.coordinate, target, damage,
      headMode: 'once', trailMode: 'once', presentation: 'ignition',
    });
  }
  return [...new Map(projectiles.map(projectile => [projectile.key, projectile])).values()];
}

/** Project the acting client's staged action before authoritative confirmation. */
export function stagedServerProjectile(
  match: ServerMatchState,
  pending: ServerLegalAction | undefined,
  owner: Player | undefined,
  damageForSource: (source: ServerUnitState, kind: 'attack' | 'magic') => number | undefined,
): ServerProjectile | undefined {
  if (!pending?.coordinate || !owner) return undefined;
  const kind = pending.type === 'resolve-death-attack' || pending.type === 'resolve-instant-ranged' ? 'attack'
    : pending.type === 'resolve-instant-magic' ? 'magic'
      : pending.type;
  if (kind !== 'attack' && kind !== 'magic' && kind !== 'bomb' && kind !== 'cannon' && kind !== 'gore' && kind !== 'upgrade') return undefined;
  const triggered = pending.type.startsWith('resolve-') ? match.pendingResolution : undefined;
  const source = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
  const damage = triggered && 'damage' in triggered ? triggered.damage
    : kind === 'bomb' || kind === 'cannon' || kind === 'gore' || kind === 'upgrade'
    ? 1
    : source ? damageForSource(source, kind) : undefined;
  const sourceCoordinate = triggered && 'origin' in triggered ? triggered.origin : source?.coordinate;
  if (!sourceCoordinate || damage === undefined) return undefined;
  return {
    key: serverProjectileKey(owner, source?.id ?? pending.troopId, kind, pending.coordinate),
    kind, source: sourceCoordinate, target: pending.coordinate,
    damage: Math.max(1, damage), headMode: 'repeat',
  };
}
