import {
  troopSeeds,
  type AttackAction,
  type RegionType,
  type TroopAction,
  type TroopRole,
  type UpgradableAbility
} from '../game/cards.js';
import { PLAYABLE_COORDINATES, regionAt, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { GameActionType, ServerMatchState, ServerUnitState } from './protocol.js';

export const pushIcon = '\u{1FAF8}';
export const catalogueById = new Map(troopSeeds.map(card => [card.id, card]));
export const catalogueIds = troopSeeds.map(card => card.id);

export interface Troop {
  /** Stable catalogue identity used for deck building and persistence. */
  cardId: string;
  /** Owner-scoped identity used for a deployed unit in a match. */
  id: string;
  name?: string;
  owner: Player;
  role: TroopRole;
  actions: readonly TroopAction[];
  deploymentRegions: readonly RegionType[];
  passiveDescription?: string;
  ruleDescription?: string;
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
  baseHealth: number;
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number }>;
  coordinate?: Coordinate;
  permanentDamage: number;
  defeated: boolean;
}

export function createTroopView(cardId: string, owner: Player, unit?: ServerUnitState, defeated = false): Troop | undefined {
  const seed = catalogueById.get(cardId);
  if (!seed) return undefined;
  return {
    ...seed,
    cardId: seed.id,
    id: unit?.id ?? `${owner}:${cardId}`,
    owner,
    coordinate: unit?.coordinate,
    permanentDamage: unit?.permanentDamage ?? 0,
    rangedDamageBonus: unit?.rangedDamageBonus ?? 0,
    rangedRangeBonus: unit?.rangedRangeBonus ?? 0,
    upgrades: unit?.upgrades,
    defeated
  };
}

/** The card catalogue is the single source for names shown throughout the UI. */
export function troopDisplayName(troop: Troop): string {
  return troop.name ?? (troop.role === 'hero' ? `Player ${troop.owner} hero` : `Player ${troop.owner} troop`);
}

const trayRolePriority: Record<TroopRole, number> = {
  hero: 0,
  troop: 1,
  temple: 2
};

/** Put the required hero first, then ordinary troops, then support temples. */
export function compareTroopsForTray(left: Troop, right: Troop): number {
  return trayRolePriority[left.role] - trayRolePriority[right.role]
    || troopDisplayName(left).localeCompare(troopDisplayName(right), undefined, { sensitivity: 'base' });
}

export function trayRoleLabel(role: TroopRole): string {
  if (role === 'hero') return 'Heroes';
  if (role === 'temple') return 'Temples';
  return 'Troops';
}

export function deploymentDescription(troop: Troop): string {
  if (troop.deploymentRule === 'enemy-region') {
    return `Enemy ${troop.deploymentRegions.join(' or ')} regions you control.`;
  }
  if (troop.deploymentRegions.length === 1 && troop.deploymentRegions[0] === 'front') {
    return 'Front line once you control it.';
  }
  const regions = troop.deploymentRegions.join(' or ');
  return `${regions[0]?.toUpperCase() ?? ''}${regions.slice(1)} regions you control.`;
}

/** Whether an undeployed card has at least one rules-valid empty board hex. */
export function hasDeploymentTarget(match: ServerMatchState, owner: Player, troop: Troop): boolean {
  if (match.activePlayer !== owner
    || match.winner
    || match.lastActingTroopId?.[owner] === troop.cardId
    || match.defeatedTroopIds.includes(`${owner}:${troop.cardId}`)) return false;
  if (troop.role !== 'hero' && !match.units.some(unit =>
    unit.owner === owner && catalogueById.get(unit.troopId)?.role === 'hero'
  )) return false;

  return PLAYABLE_COORDINATES.some(coordinate => {
    if (match.units.some(unit => unit.coordinate === coordinate)) return false;
    const region = regionAt(coordinate);
    if (!region || match.control[region.id]?.controller !== owner) return false;
    return troop.deploymentRule === 'enemy-region'
      ? troop.deploymentRegions.includes(region.type) && region.home !== undefined && region.home !== owner
      : troop.deploymentRegions.includes(region.type);
  });
}

export function healthOf(troop: Troop): number {
  return Math.max(0, troop.baseHealth - troop.permanentDamage);
}

export function healthDescription(troop: Troop): string {
  const health = healthOf(troop);
  return health === troop.baseHealth ? `♥ ${health}` : `${health} ♥ ${troop.baseHealth}`;
}

export function rangedDamage(troop: Troop, attack: AttackAction): number {
  return (attack.damage ?? healthOf(troop)) + (troop.rangedDamageBonus ?? 0);
}

export function rangedRange(troop: Troop, attack: AttackAction): number {
  return attack.range + (troop.rangedRangeBonus ?? 0);
}

export function upgradeBonus(troop: Troop, ability?: UpgradableAbility): { left: number; right: number } {
  return (troop.upgrades ?? [])
    .filter(upgrade => !ability || upgrade.ability === ability || upgrade.ability === undefined)
    .reduce<{ left: number; right: number }>((total, upgrade) => ({
      left: total.left + (upgrade.left ?? 0),
      right: total.right + (upgrade.right ?? 0)
    }), { left: 0, right: 0 });
}

export function actionOfType<Type extends TroopAction['type']>(troop: Troop, type: Type): Extract<TroopAction, { type: Type }> | undefined {
  return troop.actions.find(action => action.type === type) as Extract<TroopAction, { type: Type }> | undefined;
}

export function serverCardDetails(troop: Troop): string[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const defense = actionOfType(troop, 'defense');
  const magic = actionOfType(troop, 'magic');
  const cannon = actionOfType(troop, 'cannon');
  const push = actionOfType(troop, 'push');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const detail = (ability: UpgradableAbility, text: string): string => {
    const bonus = upgradeBonus(troop, ability);
    return bonus.left || bonus.right ? `🔮 ${text}` : text;
  };
  return [
    move && move.maxDistance > 1 ? detail('move', `🥾 ${move.maxDistance + upgradeBonus(troop, 'move').right}`) : '',
    fly ? detail('fly', `🪽 ${fly.maxDistance + upgradeBonus(troop, 'fly').right}`) : '',
    attack ? detail('attack', `${rangedDamage(troop, attack) + upgradeBonus(troop, 'attack').left} 🏹 ${rangedRange(troop, attack) + upgradeBonus(troop, 'attack').right}`) : '',
    defense ? detail('defense', `${defense.block + upgradeBonus(troop, 'defense').left} 🛡️ ${defense.range + upgradeBonus(troop, 'defense').right}`) : '',
    magic ? detail('magic', `${magic.damage + upgradeBonus(troop, 'magic').left} 🔥 ${magic.range + upgradeBonus(troop, 'magic').right}`) : '',
    cannon ? detail('cannon', `${cannon.damage + upgradeBonus(troop, 'cannon').left} 🧨 ${cannon.range + upgradeBonus(troop, 'cannon').right}`) : '',
    push ? detail('push', `${push.maxDistance + upgradeBonus(troop, 'push').left}${pushIcon}${push.range + upgradeBonus(troop, 'push').right}`) : '',
    mending ? detail('mending', `${mending.amount + upgradeBonus(troop, 'mending').left} ❤️ ${mending.range + upgradeBonus(troop, 'mending').right}`) : '',
    upgrade ? detail('upgrade', `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`) : '',
    troop.passiveDescription ?? ''
  ].filter(Boolean);
}

export interface BoardDescriptionLine {
  text: string;
  action?: GameActionType;
  upgraded?: boolean;
}

export function boardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false): BoardDescriptionLine[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const magic = actionOfType(troop, 'magic');
  const defense = actionOfType(troop, 'defense');
  const cannon = actionOfType(troop, 'cannon');
  const push = actionOfType(troop, 'push');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const abilities: BoardDescriptionLine[] = [];
  const bonus = (ability: UpgradableAbility) => upgradeBonus(troop, ability);
  const selfBonus = bonus('self-defense');

  if (includeSelfBlock || (troop.selfDefense ?? 1) + selfBonus.left > 1) abilities.push({ text: `${(troop.selfDefense ?? 1) + selfBonus.left} 🛡️`, action: 'self-defense', upgraded: Boolean(selfBonus.left) });
  if (move) { const value = bonus('move'); if (move.maxDistance + value.right > 1 || revealMoveOne) abilities.push({ text: `🥾 ${move.maxDistance + value.right}`, action: 'move', upgraded: Boolean(value.right) }); }
  if (fly) { const value = bonus('fly'); abilities.push({ text: `🪽 ${fly.maxDistance + value.right}`, action: 'fly', upgraded: Boolean(value.right) }); }
  if (attack) { const value = bonus('attack'); abilities.push({ text: `${rangedDamage(troop, attack) + value.left} 🏹 ${rangedRange(troop, attack) + value.right}`, action: 'attack', upgraded: Boolean(value.left || value.right) }); }
  if (defense) { const value = bonus('defense'); abilities.push({ text: `${defense.block + value.left} 🛡️ ${defense.range + value.right}`, action: 'defense', upgraded: Boolean(value.left || value.right) }); }
  if (magic) { const value = bonus('magic'); abilities.push({ text: `${magic.damage + value.left} 🔥 ${magic.range + value.right}`, action: 'magic', upgraded: Boolean(value.left || value.right) }); }
  if (cannon) { const value = bonus('cannon'); abilities.push({ text: `${cannon.damage + value.left} 🧨 ${cannon.range + value.right}`, action: 'cannon', upgraded: Boolean(value.left || value.right) }); }
  if (push) { const value = bonus('push'); abilities.push({ text: `${push.maxDistance + value.left}${pushIcon}${push.range + value.right}`, action: 'push', upgraded: Boolean(value.left || value.right) }); }
  if (mending) { const value = bonus('mending'); abilities.push({ text: `${mending.amount + value.left} ❤️ ${mending.range + value.right}`, action: 'mending', upgraded: Boolean(value.left || value.right) }); }
  if (upgrade) abilities.push({ text: `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`, action: 'upgrade' });

  // Health plus two content lines form the stable board summary. A passive
  // gets one of those lines whenever there is room; dots mean actual overflow.
  const visibleAbilities = abilities.slice(0, 2);
  const hiddenAbilities = abilities.length > 2;
  if (troop.passiveDescription && visibleAbilities.length < 2) visibleAbilities.push({ text: troop.passiveDescription });
  while (visibleAbilities.length < 2) visibleAbilities.push({ text: '' });
  const overflow = hiddenAbilities || (troop.passiveDescription && abilities.length >= 2) ? [{ text: '...' }] : [];
  return [{ text: healthDescription(troop) }, ...visibleAbilities, ...overflow];
}

export function actionDetails(troop: Troop): string[] {
  return troop.actions.map(action => {
    const bonus = upgradeBonus(troop, action.type);
    if (action.type === 'move') {
      const distance = action.maxDistance + bonus.right;
      return `Move: up to ${distance} hex${distance === 1 ? '' : 'es'} through a clear path; entering an enemy starts a bash.`;
    }
    if (action.type === 'fly') {
      const distance = action.maxDistance + bonus.right;
      return `Fly: land up to ${distance} hex${distance === 1 ? '' : 'es'} away, ignoring intervening units.`;
    }
    if (action.type === 'attack') return `Ranged attack: ${rangedDamage(troop, action) + bonus.left} physical damage at range ${rangedRange(troop, action) + bonus.right}; resolves after the opponent acts and shields can block it.`;
    if (action.type === 'defense') return `Block: add ${action.block + bonus.left} shield at range ${action.range + bonus.right} when physically threatened.`;
    if (action.type === 'cannon') return `Cannon: ${action.damage + bonus.left} physical damage along a straight line up to range ${action.range + bonus.right}; resolves after the opponent acts and shields can block it.`;
    if (action.type === 'push') return `Push: choose a unit at range ${action.range + bonus.right}, then push it up to ${action.maxDistance + bonus.left} hexes in a straight line.`;
    if (action.type === 'mending') return `Mend: restore ${action.amount + bonus.left} permanent health damage at range ${action.range + bonus.right}.`;
    if (action.type === 'upgrade') return `Upgrade: add ${action.left ?? 0} to an ability's left value and ${action.right ?? 0} to its right value at range ${action.range}.`;
    return `Magic: ${action.damage + bonus.left} damage at range ${action.range + bonus.right}; resolves after the opponent acts, ignores shields, and kills only if lethal.`;
  });
}

/** Complete plain-language rules shown by every in-game card preview. */
export function cardRuleDetails(troop: Troop): string[] {
  const rules = [deploymentDescription(troop), ...actionDetails(troop)];
  if (!troop.actions.some(action => action.type === 'move' || action.type === 'fly')) {
    rules.push('Movement: this unit cannot move.');
  }
  if (troop.selfDefense !== undefined) {
    rules.push(`Self block: add ${troop.selfDefense + upgradeBonus(troop, 'self-defense').left} shield to itself when physically threatened.`);
  }
  if (troop.ruleDescription) rules.push(troop.ruleDescription);
  return rules;
}

export function fullEffectLines(troop: Troop): string[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const defense = actionOfType(troop, 'defense');
  const magic = actionOfType(troop, 'magic');
  const cannon = actionOfType(troop, 'cannon');
  const push = actionOfType(troop, 'push');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const effects: string[] = [];
  if (move && move.maxDistance + upgradeBonus(troop, 'move').right > 1) effects.push(`${move.maxDistance} 🥾`);
  if (fly) effects.push(`${fly.maxDistance} 🪽`);
  if ((troop.selfDefense ?? 1) + upgradeBonus(troop, 'self-defense').left > 1) effects.push(`${troop.selfDefense ?? 1} 🛡️`);
  if (attack) effects.push(`${rangedDamage(troop, attack)} 🏹 ${rangedRange(troop, attack)}`);
  if (defense) effects.push(`${defense.block} 🛡️ ${defense.range}`);
  if (magic) effects.push(`${magic.damage} 🔥 ${magic.range}`);
  if (cannon) effects.push(`${cannon.damage} 🧨 ${cannon.range}`);
  if (push) effects.push(`${push.maxDistance}${pushIcon}${push.range}`);
  if (mending) effects.push(`${mending.amount} ❤️ ${mending.range}`);
  if (upgrade) effects.push(`${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`);
  if (troop.passiveDescription) effects.push(troop.passiveDescription);
  return effects;
}

/** Keep compact board and card summaries readable without overflowing them. */
export function threeLineSummary(lines: readonly string[]): string[] {
  return lines.length > 3 ? [...lines.slice(0, 2), '...'] : [...lines];
}
