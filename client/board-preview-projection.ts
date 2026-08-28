import type { Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';
import { actionOfType, healthOf, upgradeBonus, type Troop } from './troop-view.js';

export interface ServerMovementPreview { unit: ServerUnitState; coordinate: Coordinate }

function isMovePreview(type: ServerLegalAction['type']): boolean {
  return type === 'move' || type === 'fly' || type === 'gore' || type === 'resolve-move';
}

function isDisplacementPreview(type: ServerLegalAction['type']): boolean {
  return type === 'push' || type === 'pull' || type === 'resolve-pull';
}

export function pendingActionForPreview(match: ServerMatchState | undefined, pending: ServerLegalAction | undefined): ServerLegalAction | undefined {
  if (!match) return undefined;
  if (pending) return pending;
  const remote = match.targetSelections?.[match.activePlayer];
  return remote ? { troopId: remote.troopId, type: remote.type, coordinate: remote.coordinate } : undefined;
}

export function pendingMovementPreview(match: ServerMatchState | undefined, pending: ServerLegalAction | undefined, owner: Player | undefined): ServerMovementPreview | undefined {
  if (!match || !pending?.coordinate || (!isMovePreview(pending.type) && !isDisplacementPreview(pending.type))) return undefined;
  let unit: ServerUnitState | undefined;
  let coordinate = pending.coordinate;
  if (isDisplacementPreview(pending.type)) {
    if (!pending.destination) return undefined;
    unit = match.units.find(candidate => candidate.coordinate === pending.coordinate); coordinate = pending.destination;
  } else if (owner) unit = match.units.find(candidate => candidate.owner === owner && candidate.troopId === pending.troopId);
  if (!unit) return undefined;
  if (match.units.find(candidate => candidate.coordinate === coordinate && candidate.id !== unit.id)?.owner === unit.owner) return undefined;
  return { unit, coordinate };
}

export function pendingUnitPreviews(
  match: ServerMatchState | undefined,
  pending: ServerLegalAction | undefined,
  owner: Player | undefined,
  troopFor: (cardId: string, owner: Player, unit?: ServerUnitState) => Troop | undefined,
): ServerUnitState[] {
  if (!match || !pending?.coordinate || !owner) return [];
  if (pending.type === 'deploy') {
    const troop = troopFor(pending.troopId, owner);
    if (!troop || match.units.some(unit => unit.coordinate === pending.coordinate)) return [];
    const health = healthOf(troop);
    return [{ id: `deployment-preview:${owner}:${pending.troopId}`, troopId: pending.troopId, owner, coordinate: pending.coordinate,
      permanentDamage: 0, currentHealth: health, combat: { health, modifier: 0, magicModifier: 0, modifiers: [], total: health } }];
  }
  const source = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
  if (!source) return [];
  if (isMovePreview(pending.type) || isDisplacementPreview(pending.type)) {
    const movement = pendingMovementPreview(match, pending, owner);
    return movement ? [{ ...movement.unit, coordinate: movement.coordinate }] : [];
  }
  const target = match.units.find(unit => unit.owner === owner && unit.coordinate === pending.coordinate);
  if (!target) return [];
  const sourceTroop = troopFor(source.troopId, owner, source);
  if (!sourceTroop) return [];
  if (pending.type === 'mending') {
    const mending = actionOfType(sourceTroop, 'mending'); if (!mending) return [];
    const targetTroop = troopFor(target.troopId, target.owner, target); if (!targetTroop) return [];
    const health = Math.min(healthOf(targetTroop) + mending.amount + upgradeBonus(sourceTroop, 'mending').left, targetTroop.baseHealth);
    return [{ ...target, permanentDamage: target.permanentDamage - (health - healthOf(targetTroop)), currentHealth: health, combat: { ...target.combat, health, total: health + target.combat.modifier } }];
  }
  if (pending.type === 'upgrade' && pending.ability) {
    const upgrade = actionOfType(sourceTroop, 'upgrade');
    return upgrade ? [{ ...target, upgrades: [...(target.upgrades ?? []), { ability: pending.ability, left: upgrade.left, right: upgrade.right }] }] : [];
  }
  return [];
}

export function pendingBash(match: ServerMatchState | undefined, pending: ServerLegalAction | undefined, owner: Player | undefined): ServerBashState | undefined {
  if (!match || !pending || !owner) return undefined;
  if (isMovePreview(pending.type) && pending.coordinate) {
    const attacker = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
    const defender = match.units.find(unit => unit.coordinate === pending.coordinate && unit.owner !== owner);
    return attacker && defender ? { attackerId: attacker.id, defenderId: defender.id, target: pending.coordinate } : undefined;
  }
  if (isDisplacementPreview(pending.type) && pending.coordinate && pending.destination) {
    const attacker = match.units.find(unit => unit.coordinate === pending.coordinate);
    const defender = match.units.find(unit => unit.coordinate === pending.destination);
    return attacker && defender && attacker.owner !== defender.owner ? { attackerId: attacker.id, defenderId: defender.id, target: pending.destination } : undefined;
  }
  return undefined;
}
