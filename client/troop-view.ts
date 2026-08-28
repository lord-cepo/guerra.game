import {
  troopSeeds,
  type AttackAction,
  type ActionQualifier,
  type ContinuousEffect,
  type LegacyActionView,
  type PassiveKind,
  type RegionType,
  type TroopAction,
  type TroopRole,
  type TriggerDefinition,
  type UpgradableAbility
} from '../game/cards.js';
import { PLAYABLE_COORDINATES, regionAt, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { GameActionType, ServerMatchState, ServerUnitState } from './protocol.js';

export const pushIcon = '\u{1FAF8}';
export const pullIcon = '\u{1FAF7}';
export const stunIcon = '\u{1F6AB}';
export const goreIcon = '\u{1F40F}';
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
  passives?: readonly PassiveKind[];
  triggers?: readonly TriggerDefinition[];
  deploymentRegions: readonly RegionType[];
  passiveDescription?: string;
  ruleDescription?: string;
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
  selfMagicDefense?: number;
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

interface PassivePresentation {
  compact: string;
  rule: string;
}

const passivePresentations: Record<PassiveKind, PassivePresentation> = {
  'first-strike': {
    compact: 'First Strike',
    rule: 'First Strike: deals bash damage before the opponent can retaliate; a defeated opponent does not retaliate.'
  },
  obsidian: {
    compact: 'Obsidian',
    rule: 'Obsidian: immune to magic damage sources.'
  },
  titanium: {
    compact: 'Titanium',
    rule: 'Titanium: immune to physical Attack and Gore damage.'
  },
  steady: {
    compact: 'Steady',
    rule: 'Steady: its opponent has 0 combat modifier while this unit is in a bash.'
  }
};

export function passiveCompactDescriptions(troop: Troop): string[] {
  return (troop.passives ?? []).map(passive => passivePresentations[passive].compact);
}

export function passiveRuleDescriptions(troop: Troop): string[] {
  return (troop.passives ?? []).map(passive => passivePresentations[passive].rule);
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
  return `${health} ♥ ${troop.baseHealth}`;
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
  if (action.kind === 'defense' && action.type?.includes('magic')) return 'magic-defense';
  if (action.kind === 'fly') return 'fly';
  if (action.kind === 'ranged') return 'attack';
  if (action.kind === 'cannon') return 'cannon';
  if (action.kind === 'gore') return 'gore';
  if (action.kind === 'fire') return 'magic';
  return action.kind as UpgradableAbility;
}

export function actionOfType(troop: Troop, type: UpgradableAbility): LegacyActionView | undefined {
  const action = troop.actions.find(candidate => cardActionType(candidate) === type);
  if (!action) return undefined;
  const values = Array.isArray(action.amount) ? action.amount : [action.amount ?? 0];
  const first = values[0] ?? 0; const second = values[1] ?? 0;
  return { type, range: action.range, amount: first, maxDistance: type === 'move' || type === 'fly' ? action.range : first, damage: first, block: first, left: first, right: second, usesHealth: type === 'attack' && action.amount === undefined, qualifiers: action.type };
}

function attackPrefix(action: LegacyActionView): string {
  const qualifiers: readonly ActionQualifier[] = action.qualifiers ?? [];
  return `${qualifiers.includes('pierce') ? 'P' : ''}${qualifiers.includes('instant') ? 'F' : ''}`;
}

function magicPrefix(action: LegacyActionView): string {
  const qualifiers: readonly ActionQualifier[] = action.qualifiers ?? [];
  return `${qualifiers.includes('pierce') ? 'P' : ''}${qualifiers.includes('instant') ? 'F' : ''}`;
}

/** A compact summary line is a magic shield only when explicitly marked with
 * the magic `~...~` marker and matching the card's magic-defense capability,
 * so an equal-valued physical self-defense line stays a normal shield. */
export function isMagicShieldSummaryText(troop: Troop, text: string): boolean {
  const withoutUpgrade = text.replace(/^🔮\s*/u, '');
  if (!withoutUpgrade.startsWith('~') || !withoutUpgrade.endsWith('~')) return false;
  const normalized = withoutUpgrade.replace(/^~|~$/g, '');
  const ranged = actionOfType(troop, 'magic-defense');
  const rangedText = ranged ? `${ranged.block + upgradeBonus(troop, 'magic-defense').left} 🛡️ ${ranged.range + upgradeBonus(troop, 'magic-defense').right}` : undefined;
  const selfText = troop.selfMagicDefense !== undefined ? `${troop.selfMagicDefense + upgradeBonus(troop, 'self-magic-defense').left} 🛡️` : undefined;
  return normalized === rangedText || normalized === selfText;
}

export function serverCardDetails(troop: Troop): string[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const defense = actionOfType(troop, 'defense');
  const magicDefense = actionOfType(troop, 'magic-defense');
  const magic = actionOfType(troop, 'magic');
  const cannon = actionOfType(troop, 'cannon');
  const gore = actionOfType(troop, 'gore');
  const bomb = actionOfType(troop, 'bomb');
  const push = actionOfType(troop, 'push');
  const pull = actionOfType(troop, 'pull');
  const stun = actionOfType(troop, 'stun');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const detail = (ability: UpgradableAbility, text: string): string => {
    const bonus = upgradeBonus(troop, ability);
    return bonus.left || bonus.right ? `🔮 ${text}` : text;
  };
  const selfDefense = troop.selfDefense !== undefined
    ? detail('self-defense', `${troop.selfDefense + upgradeBonus(troop, 'self-defense').left} 🛡️`)
    : '';
  const selfMagicDefense = troop.selfMagicDefense !== undefined
    ? `~${detail('self-magic-defense', `${troop.selfMagicDefense + upgradeBonus(troop, 'self-magic-defense').left} 🛡️`)}~`
    : '';
  return [...new Set([
    move && move.maxDistance + upgradeBonus(troop, 'move').right + staticAuraBonus(troop, 'move').right > 1 ? detail('move', `🥾 ${move.maxDistance + upgradeBonus(troop, 'move').right + staticAuraBonus(troop, 'move').right}`) : move || fly || troop.role === 'temple' ? '' : '🥾 0',
    fly ? detail('fly', `🪽 ${fly.maxDistance + upgradeBonus(troop, 'fly').right}`) : '',
    attack ? detail('attack', `${rangedDamage(troop, attack) + upgradeBonus(troop, 'attack').left + staticAuraBonus(troop, 'attack').left} ${attackPrefix(attack)}🏹 ${rangedRange(troop, attack) + upgradeBonus(troop, 'attack').right + staticAuraBonus(troop, 'attack').right}`) : '',
    defense ? detail('defense', `${defense.block + upgradeBonus(troop, 'defense').left} 🛡️ ${defense.range + upgradeBonus(troop, 'defense').right}`) : '',
    magicDefense ? `~${detail('magic-defense', `${magicDefense.block + upgradeBonus(troop, 'magic-defense').left} 🛡️ ${magicDefense.range + upgradeBonus(troop, 'magic-defense').right}`)}~` : '',
    selfDefense,
    selfMagicDefense,
    magic ? detail('magic', `${magic.damage + (troop.magicDamageBonus ?? 0) + upgradeBonus(troop, 'magic').left + staticAuraBonus(troop, 'magic').left} ${magicPrefix(magic)}🔥 ${magic.range + (troop.magicRangeBonus ?? 0) + upgradeBonus(troop, 'magic').right + staticAuraBonus(troop, 'magic').right}`) : '',
    cannon ? detail('cannon', `${cannon.damage + upgradeBonus(troop, 'cannon').left} 🧨 ${cannon.range + upgradeBonus(troop, 'cannon').right}`) : '',
    gore ? detail('gore', `${gore.damage + upgradeBonus(troop, 'gore').left} ${goreIcon} ${gore.range + upgradeBonus(troop, 'gore').right}`) : '',
    bomb ? detail('bomb', `${bomb.damage + upgradeBonus(troop, 'bomb').left} 💣 ${bomb.range + upgradeBonus(troop, 'bomb').right}`) : '',
    push ? detail('push', `${push.maxDistance + upgradeBonus(troop, 'push').left}${pushIcon}${push.range + upgradeBonus(troop, 'push').right}`) : '',
    pull ? detail('pull', `${pull.maxDistance + upgradeBonus(troop, 'pull').left}${pullIcon}${pull.range + upgradeBonus(troop, 'pull').right}`) : '',
    stun ? detail('stun', `${stun.amount + upgradeBonus(troop, 'stun').left}${stunIcon}${stun.range + upgradeBonus(troop, 'stun').right}`) : '',
    mending ? detail('mending', `${mending.amount + upgradeBonus(troop, 'mending').left} ❤️ ${mending.range + upgradeBonus(troop, 'mending').right}`) : '',
    upgrade ? detail('upgrade', `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`) : '',
    troop.control ? `Control ${troop.control}` : '',
    ...passiveCompactDescriptions(troop),
    ...(troop.passiveDescription?.split('\n') ?? [])
  ].filter(Boolean))];
}

export interface BoardDescriptionLine {
  text: string;
  action?: GameActionType;
  upgraded?: boolean;
  staticLeft?: boolean;
  staticRight?: boolean;
  magicModifier?: boolean;
}

export function boardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false): BoardDescriptionLine[] {
  void revealMoveOne;
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const magic = actionOfType(troop, 'magic');
  const defense = actionOfType(troop, 'defense');
  const magicDefense = actionOfType(troop, 'magic-defense');
  const cannon = actionOfType(troop, 'cannon');
  const gore = actionOfType(troop, 'gore');
  const bomb = actionOfType(troop, 'bomb');
  const push = actionOfType(troop, 'push');
  const pull = actionOfType(troop, 'pull');
  const stun = actionOfType(troop, 'stun');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const abilities: BoardDescriptionLine[] = [];
  const bonus = (ability: UpgradableAbility) => upgradeBonus(troop, ability);
  const selfBonus = bonus('self-defense');

  if (includeSelfBlock || (troop.selfDefense ?? 1) + selfBonus.left > 1) abilities.push({ text: `${(troop.selfDefense ?? 1) + selfBonus.left} 🛡️`, action: 'self-defense', upgraded: Boolean(selfBonus.left) });
  if (move) { const value = bonus('move'); const aura = staticAuraBonus(troop, 'move'); if (move.maxDistance + value.right + aura.right > 1 || revealMoveOne) abilities.push({ text: `🥾 ${move.maxDistance + value.right + aura.right}`, action: 'move', upgraded: Boolean(value.right), staticRight: Boolean(aura.right) }); }
  else if (!fly && troop.role !== 'temple') abilities.push({ text: '🥾 0', action: 'move' });
  if (fly) { const value = bonus('fly'); abilities.push({ text: `🪽 ${fly.maxDistance + value.right}`, action: 'fly', upgraded: Boolean(value.right) }); }
  if (attack) { const value = bonus('attack'); const aura = staticAuraBonus(troop, 'attack'); const permanent = permanentUpgradeBonus(troop, 'attack'); abilities.push({ text: `${rangedDamage(troop, attack) + value.left + aura.left} ${attackPrefix(attack)}🏹 ${rangedRange(troop, attack) + value.right + aura.right}`, action: 'attack', upgraded: Boolean(value.left || value.right), staticLeft: Boolean(aura.left || permanent.left), staticRight: Boolean(aura.right || permanent.right) }); }
  if (defense) { const value = bonus('defense'); abilities.push({ text: `${defense.block + value.left} 🛡️ ${defense.range + value.right}`, action: 'defense', upgraded: Boolean(value.left || value.right) }); }
  if (magicDefense) { const value = bonus('magic-defense'); abilities.push({ text: `${magicDefense.block + value.left} 🛡️ ${magicDefense.range + value.right}`, action: 'magic-defense', upgraded: Boolean(value.left || value.right) }); }
  if ((troop.selfMagicDefense ?? 0) + bonus('self-magic-defense').left > 0) abilities.push({ text: `${(troop.selfMagicDefense ?? 0) + bonus('self-magic-defense').left} 🛡️`, action: 'self-magic-defense', upgraded: Boolean(bonus('self-magic-defense').left) });
  if (magic) { const value = bonus('magic'); const aura = staticAuraBonus(troop, 'magic'); const permanent = permanentUpgradeBonus(troop, 'magic'); abilities.push({ text: `${magic.damage + permanent.left + value.left + aura.left} ${magicPrefix(magic)}🔥 ${magic.range + permanent.right + value.right + aura.right}`, action: 'magic', upgraded: Boolean(value.left || value.right), staticLeft: Boolean(aura.left || permanent.left), staticRight: Boolean(aura.right || permanent.right) }); }
  if (cannon) { const value = bonus('cannon'); abilities.push({ text: `${cannon.damage + value.left} 🧨 ${cannon.range + value.right}`, action: 'cannon', upgraded: Boolean(value.left || value.right) }); }
  if (gore) { const value = bonus('gore'); abilities.push({ text: `${gore.damage + value.left} ${goreIcon} ${gore.range + value.right}`, action: 'gore', upgraded: Boolean(value.left || value.right) }); }
  if (bomb) { const value = bonus('bomb'); abilities.push({ text: `${bomb.damage + value.left} 💣 ${bomb.range + value.right}`, action: 'bomb', upgraded: Boolean(value.left || value.right) }); }
  if (push) { const value = bonus('push'); abilities.push({ text: `${push.maxDistance + value.left}${pushIcon}${push.range + value.right}`, action: 'push', upgraded: Boolean(value.left || value.right) }); }
  if (pull) { const value = bonus('pull'); abilities.push({ text: `${pull.maxDistance + value.left}${pullIcon}${pull.range + value.right}`, action: 'pull', upgraded: Boolean(value.left || value.right) }); }
  if (stun) { const value = bonus('stun'); abilities.push({ text: `${stun.amount + value.left}${stunIcon}${stun.range + value.right}`, action: 'stun', upgraded: Boolean(value.left || value.right) }); }
  if (mending) { const value = bonus('mending'); abilities.push({ text: `${mending.amount + value.left} ❤️ ${mending.range + value.right}`, action: 'mending', upgraded: Boolean(value.left || value.right) }); }
  if (upgrade) abilities.push({ text: `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`, action: 'upgrade' });
  if (troop.control) abilities.push({ text: `Control ${troop.control}` });

  const passiveLines = troop.passiveDescription?.split('\n').filter(Boolean) ?? [];
  const contentLines: BoardDescriptionLine[] = [
    ...abilities,
    ...passiveCompactDescriptions(troop).map(text => ({ text })),
    ...passiveLines.map(text => ({ text, magicModifier: /~[^~]+~/u.test(text) }))
  ];
  // A board hex always owns health plus exactly three information rows.
  // Preserve the final row's action metadata when marking overflow so
  // selection highlights still point at the displayed ability.
  const visibleLines = contentLines.slice(0, 3);
  if (contentLines.length > 3 && visibleLines[2]) {
    visibleLines[2] = { ...visibleLines[2], text: `${visibleLines[2].text} ...` };
  }
  while (visibleLines.length < 3) visibleLines.push({ text: '' });
  return [{ text: healthDescription(troop) }, ...visibleLines];
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
      return `${damage}${attackPrefix(action)}🏹${distance} (ranged attack): ${damage} physical damage at distance ${distance}; resolves after the opponent acts and ${attackPrefix(action).includes('P') ? 'ignores physical modifiers' : 'shields can block it'}.`;
    }
    if (action.type === 'defense') {
      const block = action.block + bonus.left; const distance = action.range + bonus.right;
      return `${block}🛡️${distance} (block): add ${block} shield at distance ${distance} when physically threatened.`;
    }
    if (action.type === 'magic-defense') {
      const block = action.block + bonus.left; const distance = action.range + bonus.right;
      return `${block}🛡️${distance} (magic defense): add ${block} magic shield at distance ${distance} to a friendly troop.`;
    }
    if (action.type === 'cannon') {
      const damage = action.damage + bonus.left; const distance = action.range + bonus.right;
      return `${damage}🧨${distance} (cannon): ${damage} black-magic damage to every troop along a straight line up to distance ${distance}; resolves after the opponent acts, allows friendly fire, ignores physical modifiers but is reduced by magic shields.`;
    }
    if (action.type === 'gore') {
      const damage = action.damage + bonus.left; const distance = action.range + bonus.right;
      return `${damage}${goreIcon}${distance} (gore): immediately move to a valid straight-line hex within ${distance}; after the opponent acts, deal ${damage} physical damage to every enemy crossed. Entering an enemy hex starts a bash, and friendly destinations are forbidden.`;
    }
    if (action.type === 'bomb') {
      const damage = action.damage + bonus.left; const distance = action.range + bonus.right;
      return `${damage}💣${distance} (bomb): throw an inert ${damage}-damage bomb at distance ${distance}; a hex that already contains a bomb merges the new damage into it. Fire magic lights it, then its black-magic damage resolves after the next action on its hex and all adjacent hexes, affecting both players, ignoring physical modifiers but reduced by magic shields.`;
    }
    if (action.type === 'push' || action.type === 'pull') {
      const displacementDistance = action.maxDistance + bonus.left; const targetDistance = action.range + bonus.right;
      const icon = action.type === 'push' ? pushIcon : pullIcon;
      const verb = action.type === 'push' ? 'push' : 'pull';
      return `${displacementDistance}${icon}${targetDistance} (${verb}): choose a unit at distance ${targetDistance}, then ${verb} it up to ${displacementDistance} hexes in a straight line.`;
    }
    if (action.type === 'stun') {
      const turns = action.amount + bonus.left; const distance = action.range + bonus.right;
      return `${turns}${stunIcon}${distance} (stun): make an enemy troop at distance ${distance} inactive for ${turns} turn${turns === 1 ? '' : 's'}, clearing its shields and modifiers.`;
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
    const instant = action.qualifiers?.includes('instant'); const pierce = action.qualifiers?.includes('pierce');
    return `${damage}${magicPrefix(action)}🔥${distance} (magic): ${damage} damage at distance ${distance}; ${instant ? 'resolves immediately' : 'resolves after the opponent acts'}, ignores shields, and kills only if lethal. Fire magic lights inert bombs; instant fire detonates them immediately${pierce ? '; pierce fire ignores the magic shield, makes bombs it lights pierce Obsidian magic immunity, and is marked with P' : ''}.`;
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
  if (troop.selfMagicDefense !== undefined) {
    const block = troop.selfMagicDefense + upgradeBonus(troop, 'self-magic-defense').left;
    rules.push(`${block}🛡️ (self magic defense): add ${block} magic shield to itself.`);
  }
  if (troop.control) rules.push(`Control ${troop.control}: this unit contributes ${troop.control} additional control to its current region.`);
  rules.push(...passiveRuleDescriptions(troop));
  if (troop.ruleDescription) rules.push(troop.ruleDescription);
  return rules;
}

export function fullEffectLines(troop: Troop): string[] {
  const move = actionOfType(troop, 'move');
  const fly = actionOfType(troop, 'fly');
  const attack = actionOfType(troop, 'attack');
  const defense = actionOfType(troop, 'defense');
  const magicDefense = actionOfType(troop, 'magic-defense');
  const magic = actionOfType(troop, 'magic');
  const cannon = actionOfType(troop, 'cannon');
  const gore = actionOfType(troop, 'gore');
  const bomb = actionOfType(troop, 'bomb');
  const push = actionOfType(troop, 'push');
  const pull = actionOfType(troop, 'pull');
  const stun = actionOfType(troop, 'stun');
  const mending = actionOfType(troop, 'mending');
  const upgrade = actionOfType(troop, 'upgrade');
  const effects: string[] = [];
  if (move && move.maxDistance + upgradeBonus(troop, 'move').right > 1) effects.push(`${move.maxDistance} 🥾`);
  else if (!move && !fly && troop.role !== 'temple') effects.push('0 🥾');
  if (fly) effects.push(`${fly.maxDistance} 🪽`);
  if ((troop.selfDefense ?? 1) + upgradeBonus(troop, 'self-defense').left > 1) effects.push(`${troop.selfDefense ?? 1} 🛡️`);
  if ((troop.selfMagicDefense ?? 0) + upgradeBonus(troop, 'self-magic-defense').left > 0) effects.push(`~${troop.selfMagicDefense ?? 0} 🛡️~`);
  if (attack) effects.push(`${rangedDamage(troop, attack)} ${attackPrefix(attack)}🏹 ${rangedRange(troop, attack)}`);
  if (defense) effects.push(`${defense.block} 🛡️ ${defense.range}`);
  if (magicDefense) effects.push(`~${magicDefense.block} 🛡️ ${magicDefense.range}~`);
  if (magic) effects.push(`${magic.damage} ${magicPrefix(magic)}🔥 ${magic.range}`);
  if (cannon) effects.push(`${cannon.damage} 🧨 ${cannon.range}`);
  if (gore) effects.push(`${gore.damage}${goreIcon}${gore.range}`);
  if (bomb) effects.push(`${bomb.damage} 💣 ${bomb.range}`);
  if (push) effects.push(`${push.maxDistance}${pushIcon}${push.range}`);
  if (pull) effects.push(`${pull.maxDistance}${pullIcon}${pull.range}`);
  if (stun) effects.push(`${stun.amount}${stunIcon}${stun.range}`);
  if (mending) effects.push(`${mending.amount} ❤️ ${mending.range}`);
  if (upgrade) effects.push(`${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`);
  if (troop.control) effects.push(`Control ${troop.control}`);
  effects.push(...passiveCompactDescriptions(troop));
  if (troop.passiveDescription) effects.push(...troop.passiveDescription.split('\n').filter(Boolean));
  return [...new Set(effects)];
}

/** Keep compact board and card summaries readable without overflowing them. */
export function threeLineSummary(lines: readonly string[]): string[] {
  return lines.length > 3 ? [...lines.slice(0, 2), '...'] : [...lines];
}
