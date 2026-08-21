import {
  troopSeeds,
  type AttackAction,
  type ContinuousEffect,
  type LegacyActionView,
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
  control?: number;
  baseHealth: number;
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  magicDamageBonus?: number;
  magicRangeBonus?: number;
  continuousEffects?: readonly ContinuousEffect[];
  staticAuras?: Array<{ ability: 'move' | 'attack' | 'magic'; left: number; right: number; sourceCardId: string }>;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number; sourceUnitId?: string }>;
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
  return (attack.usesHealth ? healthOf(troop) : attack.damage) + (troop.rangedDamageBonus ?? 0);
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

export function staticAuraBonus(troop: Troop, ability: 'move' | 'attack' | 'magic'): { left: number; right: number } {
  return (troop.staticAuras ?? []).filter(aura => aura.ability === ability).reduce((total, aura) => ({
    left: total.left + aura.left,
    right: total.right + aura.right
  }), { left: 0, right: 0 });
}

/** Permanent event-resolved upgrades use the same magenta presentation as live auras. */
export function permanentUpgradeBonus(troop: Troop, ability: 'attack' | 'magic'): { left: number; right: number } {
  return ability === 'attack'
    ? { left: troop.rangedDamageBonus ?? 0, right: troop.rangedRangeBonus ?? 0 }
    : { left: troop.magicDamageBonus ?? 0, right: troop.magicRangeBonus ?? 0 };
}

function cardActionType(action: TroopAction): UpgradableAbility {
  if (action.kind === 'fly') return 'fly';
  if (action.kind === 'ranged') return 'attack';
  if (action.kind === 'cannon') return 'cannon';
  if (action.kind === 'fire') return 'magic';
  return action.kind as UpgradableAbility;
}

export function actionOfType(troop: Troop, type: UpgradableAbility): LegacyActionView | undefined {
  const action = troop.actions.find(candidate => cardActionType(candidate) === type);
  if (!action) return undefined;
  const values = Array.isArray(action.amount) ? action.amount : [action.amount ?? 0];
  const first = values[0] ?? 0; const second = values[1] ?? 0;
  return { type, range: action.range, amount: first, maxDistance: type === 'move' || type === 'fly' ? action.range : first, damage: first, block: first, left: first, right: second, usesHealth: type === 'attack' && action.amount === undefined };
}

export function serverCardDetails(troop: Troop): string[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const defense = actionOfType(troop, 'defense');
  const magic = actionOfType(troop, 'magic');
  const cannon = actionOfType(troop, 'cannon');
  const bomb = actionOfType(troop, 'bomb');
  const push = actionOfType(troop, 'push');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const detail = (ability: UpgradableAbility, text: string): string => {
    const bonus = upgradeBonus(troop, ability);
    return bonus.left || bonus.right ? `🔮 ${text}` : text;
  };
  return [
    move && move.maxDistance + upgradeBonus(troop, 'move').right + staticAuraBonus(troop, 'move').right > 1 ? detail('move', `🥾 ${move.maxDistance + upgradeBonus(troop, 'move').right + staticAuraBonus(troop, 'move').right}`) : '',
    fly ? detail('fly', `🪽 ${fly.maxDistance + upgradeBonus(troop, 'fly').right}`) : '',
    attack ? detail('attack', `${rangedDamage(troop, attack) + upgradeBonus(troop, 'attack').left + staticAuraBonus(troop, 'attack').left} 🏹 ${rangedRange(troop, attack) + upgradeBonus(troop, 'attack').right + staticAuraBonus(troop, 'attack').right}`) : '',
    defense ? detail('defense', `${defense.block + upgradeBonus(troop, 'defense').left} 🛡️ ${defense.range + upgradeBonus(troop, 'defense').right}`) : '',
    magic ? detail('magic', `${magic.damage + (troop.magicDamageBonus ?? 0) + upgradeBonus(troop, 'magic').left + staticAuraBonus(troop, 'magic').left} 🔥 ${magic.range + (troop.magicRangeBonus ?? 0) + upgradeBonus(troop, 'magic').right + staticAuraBonus(troop, 'magic').right}`) : '',
    cannon ? detail('cannon', `${cannon.damage + upgradeBonus(troop, 'cannon').left} 🧨 ${cannon.range + upgradeBonus(troop, 'cannon').right}`) : '',
    bomb ? detail('bomb', `${bomb.damage + upgradeBonus(troop, 'bomb').left} 💣 ${bomb.range + upgradeBonus(troop, 'bomb').right}`) : '',
    push ? detail('push', `${push.maxDistance + upgradeBonus(troop, 'push').left}${pushIcon}${push.range + upgradeBonus(troop, 'push').right}`) : '',
    mending ? detail('mending', `${mending.amount + upgradeBonus(troop, 'mending').left} ❤️ ${mending.range + upgradeBonus(troop, 'mending').right}`) : '',
    upgrade ? detail('upgrade', `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`) : '',
    troop.control ? `Control ${troop.control}` : '',
    ...(troop.passiveDescription?.split('\n') ?? [])
  ].filter(Boolean);
}

export interface BoardDescriptionLine {
  text: string;
  action?: GameActionType;
  upgraded?: boolean;
  staticLeft?: boolean;
  staticRight?: boolean;
}

export function boardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false): BoardDescriptionLine[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const magic = actionOfType(troop, 'magic');
  const defense = actionOfType(troop, 'defense');
  const cannon = actionOfType(troop, 'cannon');
  const bomb = actionOfType(troop, 'bomb');
  const push = actionOfType(troop, 'push');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const abilities: BoardDescriptionLine[] = [];
  const bonus = (ability: UpgradableAbility) => upgradeBonus(troop, ability);
  const selfBonus = bonus('self-defense');

  if (includeSelfBlock || (troop.selfDefense ?? 1) + selfBonus.left > 1) abilities.push({ text: `${(troop.selfDefense ?? 1) + selfBonus.left} 🛡️`, action: 'self-defense', upgraded: Boolean(selfBonus.left) });
  if (move) { const value = bonus('move'); const aura = staticAuraBonus(troop, 'move'); if (move.maxDistance + value.right + aura.right > 1 || revealMoveOne) abilities.push({ text: `🥾 ${move.maxDistance + value.right + aura.right}`, action: 'move', upgraded: Boolean(value.right), staticRight: Boolean(aura.right) }); }
  if (fly) { const value = bonus('fly'); abilities.push({ text: `🪽 ${fly.maxDistance + value.right}`, action: 'fly', upgraded: Boolean(value.right) }); }
  if (attack) { const value = bonus('attack'); const aura = staticAuraBonus(troop, 'attack'); const permanent = permanentUpgradeBonus(troop, 'attack'); abilities.push({ text: `${rangedDamage(troop, attack) + value.left + aura.left} 🏹 ${rangedRange(troop, attack) + value.right + aura.right}`, action: 'attack', upgraded: Boolean(value.left || value.right), staticLeft: Boolean(aura.left || permanent.left), staticRight: Boolean(aura.right || permanent.right) }); }
  if (defense) { const value = bonus('defense'); abilities.push({ text: `${defense.block + value.left} 🛡️ ${defense.range + value.right}`, action: 'defense', upgraded: Boolean(value.left || value.right) }); }
  if (magic) { const value = bonus('magic'); const aura = staticAuraBonus(troop, 'magic'); const permanent = permanentUpgradeBonus(troop, 'magic'); abilities.push({ text: `${magic.damage + permanent.left + value.left + aura.left} 🔥 ${magic.range + permanent.right + value.right + aura.right}`, action: 'magic', upgraded: Boolean(value.left || value.right), staticLeft: Boolean(aura.left || permanent.left), staticRight: Boolean(aura.right || permanent.right) }); }
  if (cannon) { const value = bonus('cannon'); abilities.push({ text: `${cannon.damage + value.left} 🧨 ${cannon.range + value.right}`, action: 'cannon', upgraded: Boolean(value.left || value.right) }); }
  if (bomb) { const value = bonus('bomb'); abilities.push({ text: `${bomb.damage + value.left} 💣 ${bomb.range + value.right}`, action: 'bomb', upgraded: Boolean(value.left || value.right) }); }
  if (push) { const value = bonus('push'); abilities.push({ text: `${push.maxDistance + value.left}${pushIcon}${push.range + value.right}`, action: 'push', upgraded: Boolean(value.left || value.right) }); }
  if (mending) { const value = bonus('mending'); abilities.push({ text: `${mending.amount + value.left} ❤️ ${mending.range + value.right}`, action: 'mending', upgraded: Boolean(value.left || value.right) }); }
  if (upgrade) abilities.push({ text: `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`, action: 'upgrade' });
  if (troop.control) abilities.push({ text: `Control ${troop.control}` });

  // Health plus two content lines form the stable board summary. A passive
  // gets one of those lines whenever there is room; dots mean actual overflow.
  const visibleAbilities = abilities.slice(0, 2);
  const hiddenAbilities = abilities.length > 2;
  const passiveLines = troop.passiveDescription?.split('\n').filter(Boolean) ?? [];
  visibleAbilities.push(...passiveLines.slice(0, Math.max(0, 2 - visibleAbilities.length)).map(text => ({ text })));
  while (visibleAbilities.length < 2) visibleAbilities.push({ text: '' });
  const shownPassiveLines = Math.max(0, 2 - Math.min(2, abilities.length));
  const overflow = hiddenAbilities || passiveLines.length > shownPassiveLines ? [{ text: '...' }] : [];
  return [{ text: healthDescription(troop) }, ...visibleAbilities, ...overflow];
}

export function actionDetails(troop: Troop): string[] {
  return troop.actions.map(source => {
    const action = actionOfType(troop, cardActionType(source))!;
    const bonus = upgradeBonus(troop, action.type);
    if (action.type === 'move') {
      const distance = action.maxDistance + bonus.right + staticAuraBonus(troop, 'move').right;
      return `🥾${distance} (move): up to ${distance} hex${distance === 1 ? '' : 'es'} through a clear path; entering an enemy starts a bash.`;
    }
    if (action.type === 'fly') {
      const distance = action.maxDistance + bonus.right;
      return `🪽${distance} (fly): land up to ${distance} hex${distance === 1 ? '' : 'es'} away, ignoring intervening units.`;
    }
    if (action.type === 'attack') {
      const aura = staticAuraBonus(troop, 'attack');
      const damage = rangedDamage(troop, action) + bonus.left + aura.left;
      const distance = rangedRange(troop, action) + bonus.right + aura.right;
      return `${damage}🏹${distance} (ranged attack): ${damage} physical damage at distance ${distance}; resolves after the opponent acts and shields can block it.`;
    }
    if (action.type === 'defense') {
      const block = action.block + bonus.left; const distance = action.range + bonus.right;
      return `${block}🛡️${distance} (block): add ${block} shield at distance ${distance} when physically threatened.`;
    }
    if (action.type === 'cannon') {
      const damage = action.damage + bonus.left; const distance = action.range + bonus.right;
      return `${damage}🧨${distance} (cannon): ${damage} black-magic damage along a straight line up to distance ${distance}; resolves after the opponent acts, always damages, and ignores modifiers.`;
    }
    if (action.type === 'bomb') {
      const damage = action.damage + bonus.left; const distance = action.range + bonus.right;
      return `${damage}💣${distance} (bomb): throw an inert ${damage}-damage bomb at distance ${distance}; a hex that already contains a bomb cannot receive another. Fire magic lights it, then its black-magic damage resolves after the next action on its hex and all adjacent hexes, affecting both players and ignoring modifiers.`;
    }
    if (action.type === 'push') {
      const pushDistance = action.maxDistance + bonus.left; const targetDistance = action.range + bonus.right;
      return `${pushDistance}${pushIcon}${targetDistance} (push): choose a unit at distance ${targetDistance}, then push it up to ${pushDistance} hexes in a straight line.`;
    }
    if (action.type === 'mending') {
      const amount = action.amount + bonus.left; const distance = action.range + bonus.right;
      return `${amount}❤️${distance} (mend): restore ${amount} permanent health damage at distance ${distance}.`;
    }
    if (action.type === 'upgrade') {
      const left = action.left ?? 0; const right = action.right ?? 0;
      return `${left || ''}🔮${right || ''} ${action.range} (upgrade): add ${left} to an ability's left value and ${right} to its right value at distance ${action.range}.`;
    }
    const aura = staticAuraBonus(troop, 'magic');
    const damage = action.damage + (troop.magicDamageBonus ?? 0) + bonus.left + aura.left;
    const distance = action.range + (troop.magicRangeBonus ?? 0) + bonus.right + aura.right;
    return `${damage}🔥${distance} (magic): ${damage} damage at distance ${distance}; resolves after the opponent acts, ignores shields, and kills only if lethal.`;
  });
}

/** Complete plain-language rules shown by every in-game card preview. */
export function cardRuleDetails(troop: Troop): string[] {
  const rules = [deploymentDescription(troop), ...actionDetails(troop)];
  if (!troop.actions.some(action => cardActionType(action) === 'move' || cardActionType(action) === 'fly')) {
    rules.push('Movement: this unit cannot move.');
  }
  if (troop.selfDefense !== undefined) {
    const block = troop.selfDefense + upgradeBonus(troop, 'self-defense').left;
    rules.push(`${block}🛡️ (self block): add ${block} shield to itself when physically threatened.`);
  }
  if (troop.control) rules.push(`Control ${troop.control}: this unit contributes ${troop.control} additional control to its current region.`);
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
  const bomb = actionOfType(troop, 'bomb');
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
  if (bomb) effects.push(`${bomb.damage} 💣 ${bomb.range}`);
  if (push) effects.push(`${push.maxDistance}${pushIcon}${push.range}`);
  if (mending) effects.push(`${mending.amount} ❤️ ${mending.range}`);
  if (upgrade) effects.push(`${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`);
  if (troop.control) effects.push(`Control ${troop.control}`);
  if (troop.passiveDescription) effects.push(...troop.passiveDescription.split('\n').filter(Boolean));
  return effects;
}

/** Keep compact board and card summaries readable without overflowing them. */
export function threeLineSummary(lines: readonly string[]): string[] {
  return lines.length > 3 ? [...lines.slice(0, 2), '...'] : [...lines];
}
