export type RegionType = 'starting' | 'intermediate' | 'front';
/** Temples occupy and control a hex like troops, but have no movement action. */
export type TroopRole = 'hero' | 'troop' | 'temple';

export interface MoveAction {
  type: 'move';
  maxDistance: number;
}

export interface FlyAction {
  type: 'fly';
  maxDistance: number;
}

export interface AttackAction {
  type: 'attack';
  range: number;
  /** Omit to use the troop's current health as physical damage. */
  damage?: number;
}

export interface MagicAction {
  type: 'magic';
  damage: number;
  range: number;
}

export interface DefenseAction {
  type: 'defense';
  block: number;
  range: number;
}

export interface CannonAction {
  type: 'cannon';
  damage: number;
  range: number;
}

export interface PushAction {
  /** Maximum number of hexes that troop may be pushed away. */
  maxDistance: number;
  /** Maximum distance to the troop selected for the push. */
  range: number;
  type: 'push';
}

/** M❤️N — restore M health to a friendly troop at most N hexes away. */
export interface MendingAction {
  type: 'mending';
  amount: number;
  range: number;
}

/**
 * M🔮N — temporarily add M to an ability's left number and N to its right
 * number.  Either side may be omitted (MU / UN).  The recipient spends its
 * accumulated upgrade the next time it uses an active ability.
 */
export interface UpgradeAction {
  type: 'upgrade';
  left?: number;
  right?: number;
  range: number;
}

export type UpgradableAbility = 'move' | 'fly' | 'attack' | 'cannon' | 'push' | 'magic' | 'defense' | 'self-defense' | 'mending' | 'upgrade';

export type TroopAction = MoveAction | FlyAction | AttackAction | MagicAction | DefenseAction | CannonAction | PushAction | MendingAction | UpgradeAction;

export interface TroopSeed {
  id: string;
  name?: string;
  role: TroopRole;
  baseHealth: number;
  deploymentRegions: readonly RegionType[];
  actions: readonly TroopAction[];
  passiveDescription?: string;
  ruleDescription?: string;
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
}

interface ActionOptions {
  fly?: number;
  attack?: readonly [range: number, damage?: number];
  defense?: readonly [block: number, range: number];
  magic?: readonly [damage: number, range: number];
  cannon?: readonly [damage: number, range: number];
  /** M🫸N: push M hexes, select a target up to N hexes away. */
  push?: readonly [distance: number, range: number];
  /** M❤️N: mend M health at distance N. */
  mending?: readonly [amount: number, range: number];
  /** M🔮N: temporarily raise an active's left/right numbers. */
  upgrade?: { left?: number; right?: number; range: number };
}

function actions(move = 1, options: ActionOptions = {}): readonly TroopAction[] {
  const result: TroopAction[] = move > 0 ? [{ type: 'move', maxDistance: move }] : [];
  if (options.fly) result.push({ type: 'fly', maxDistance: options.fly });
  if (options.attack) result.push({ type: 'attack', range: options.attack[0], ...(options.attack[1] === undefined ? {} : { damage: options.attack[1] }) });
  if (options.defense) result.push({ type: 'defense', block: options.defense[0], range: options.defense[1] });
  if (options.magic) result.push({ type: 'magic', damage: options.magic[0], range: options.magic[1] });
  if (options.cannon) result.push({ type: 'cannon', damage: options.cannon[0], range: options.cannon[1] });
  if (options.push) result.push({ type: 'push', maxDistance: options.push[0], range: options.push[1] });
  if (options.mending) result.push({ type: 'mending', amount: options.mending[0], range: options.mending[1] });
  if (options.upgrade) result.push({ type: 'upgrade', ...options.upgrade });
  return result;
}

export const troopSeeds: readonly TroopSeed[] = [
  // Catalogue cards are side-neutral and may be chosen by either player.
  // Queen Bee is a fragile ranged hero.
  { id: 'queen-bee', name: 'Queen Bee', role: 'hero', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [3, 3] }) },
  { id: 'bramble-empress', name: 'Bramble Empress', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { push: [3, 1] }) },
  { id: 'tiger-queen', name: 'Tiger Queen', role: 'hero', baseHealth: 6, deploymentRegions: ['starting'], actions: actions(2) },
  { id: 'ember-salamander', name: 'Ember Salamander', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [3, 2] }) },
  { id: 'moss-tortoise', name: 'Moss Tortoise', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { defense: [2, 2] }) },
  { id: 'steppe-lynx', name: 'Steppe Lynx', role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(1, { attack: [1] }) },
  { id: 'canyon-ibex', name: 'Canyon Ibex', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(3), passiveDescription: '+2 if ⚔️', ruleDescription: 'Charge: gains +2 combat modifier when it starts a bash.' },
  { id: 'marsh-badger', name: 'Marsh Badger', role: 'troop', baseHealth: 4, deploymentRegions: ['starting', 'intermediate'], actions: actions(), passiveDescription: '-1 if 🛡️', ruleDescription: 'Encumbered: loses 1 combat modifier while shielded.' },
  { id: 'dune-scorpion', name: 'Dune Scorpion', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { attack: [3] }), deploymentRule: 'enemy-region' },
  { id: 'snowy-owl', name: 'Snowy Owl', role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(1, { attack: [3] }) },
  { id: 'squirrel-king', name: 'Squirrel King', role: 'hero', baseHealth: 4, deploymentRegions: ['starting'], actions: actions(1, { magic: [1, 3] }), passiveDescription: '🔥: +1❤️', ruleDescription: 'Kindle: heals 1 permanent damage after it uses Magic.' },
  { id: 'cave-viper', name: 'Cave Viper', role: 'troop', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { magic: [2, 3] }), passiveDescription: '🥾0' },
  { id: 'river-otter', name: 'River Otter', role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(), passiveDescription: '+1 if 🛡️', ruleDescription: 'Support: gains +1 combat modifier when another unit shields it.' },
  { id: 'coastal-heron', name: 'Coastal Heron', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [2, 3] }) },
  { id: 'desert-fox', name: 'Desert Fox', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { magic: [3, 1] }) },
  { id: 'iron-armadillo', name: 'Iron Armadillo', role: 'troop', baseHealth: 1, deploymentRegions: ['starting', 'intermediate'], actions: actions(1, { defense: [3, 1] }) },
  { id: 'volcanic-gecko', name: 'Volcanic Gecko', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { magic: [4, 1] }) },
  { id: 'highland-hawk', name: 'Highland Hawk', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { attack: [2] }) },
  { id: 'ironscale-rhino', name: 'Ironscale Rhino', role: 'troop', baseHealth: 5, deploymentRegions: ['starting'], actions: actions(1, { defense: [3, 2] }), deploymentRule: 'enemy-region' },
  { id: 'sahel-porcupine', name: 'Sahel Porcupine', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [1, 1] }), passiveDescription: '⚔️: +1🏹+1', ruleDescription: 'Momentum: permanently gains +1 ranged damage and +1 range whenever it starts a bash.' },
  { id: 'alps-lone-wolf', name: 'Alps Lone Wolf', role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(2), passiveDescription: '🩸: +2', ruleDescription: 'Tenacity: gains +2 combat modifier while injured.' },
  { id: 'canyon-hawk', name: 'Canyon Hawk', role: 'troop', baseHealth: 3, deploymentRegions: ['front'], actions: actions(0, { fly: 2 }), passiveDescription: 'Steady', ruleDescription: 'Steady: its opponent has 0 combat modifier while this unit is in a bash.' },
  { id: 'cinder-heron', name: 'Cinder Heron, Rice Farmer', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(0, { fly: 3 }) },
  { id: 'walnut-crab', name: 'Walnut Crab', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { cannon: [1, 3], defense: [2, 0] }) },
  { id: 'coconut-crab', name: 'Coconut Crab', role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(1, { cannon: [2, 3] }) },
  { id: 'push-warden', name: 'Reed Warden', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { push: [2, 1] }), selfDefense: 2 },
  { id: 'push-scout', name: 'Bramble Scout', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { push: [1, 2] }) },
  { id: 'spring-temple', name: 'Spring Temple', role: 'temple', baseHealth: 3, deploymentRegions: ['starting', 'intermediate'], actions: actions(0, { mending: [1, 3] }) },
  { id: 'oracle-temple', name: 'Oracle Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { upgrade: { left: 1, right: 0, range: 1 } }) },
  { id: 'water-temple', name: 'Water Temple', role: 'temple', baseHealth: 3, deploymentRegions: ['intermediate'], actions: actions(0, { upgrade: { left: 1, right: 1, range: 2 } }), deploymentRule: 'enemy-region' },
  { id: 'war-temple', name: 'War Temple', role: 'temple', baseHealth: 1, deploymentRegions: ['front'], actions: actions(0), passiveDescription: '+1 if ⚔️', ruleDescription: 'War aura: your units gain +1 combat modifier while in a bash.' },
];
