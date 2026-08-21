export type RegionType = 'starting' | 'intermediate' | 'front';
/** Temples occupy and control a hex like troops, but have no movement action. */
export type TroopRole = 'hero' | 'troop' | 'temple';

export type ActionKind = 'phase' | 'deploy' | 'pass' | 'move' | 'fly' | 'ranged' | 'cannon' | 'fire' | 'defense' | 'bomb' | 'push' | 'mending' | 'upgrade' | 'heal' | 'damage' | 'modifier' | 'revive';
export type ActionAmount = number | readonly number[];
export type ActionQualifier = 'start' | 'action' | 'action-resolve' | 'combat-resolve' | 'end' | 'instant' | 'optional' | 'adjacent' | 'permanent' | 'attack' | 'bash';

/** The common, serializable dictionary used by active and triggered actions. */
export interface CardAction {
  kind: ActionKind;
  amount?: ActionAmount;
  range: number;
  type?: readonly ActionQualifier[];
}

/** Compatibility view used by gameplay code while card data stays normalized. */
export interface LegacyActionView {
  type: UpgradableAbility;
  range: number;
  amount: number;
  maxDistance: number;
  damage: number;
  block: number;
  left?: number;
  right?: number;
  usesHealth?: boolean;
}
export type AttackAction = LegacyActionView;

export type UpgradableAbility = 'move' | 'fly' | 'attack' | 'cannon' | 'bomb' | 'push' | 'magic' | 'defense' | 'self-defense' | 'mending' | 'upgrade';

/** A condition whose effect exists only while the condition remains true. */
export type ContinuousCondition = 'bash-attacker' | 'bash-attacker-vs-hero' | 'in-bash' | 'injured' | 'shielded' | 'shielded-by-ally' | 'deployed';
export type ContinuousEffect =
  | { condition: ContinuousCondition; kind: 'combat-modifier'; value: number; label: string; scope?: 'self' | 'allies' }
  | { condition: 'deployed'; kind: 'ability-bonus'; ability: 'move' | 'attack' | 'magic'; left?: number; right?: number; label: string };

/** A one-shot event and the state change resolved each time it occurs. */
export type EventCondition = 'start' | 'end' | 'opponentStart' | 'opponentEnd' | 'bashAttack' | 'bashDefense' | 'bashRetreat' | 'bashResolved' | 'bash' | 'magicUsed' | 'successfulAttack' | 'movementUsed' | 'death';
export type EventResolution =
  CardAction;
export interface TriggerCondition { kind?: ActionKind; type?: readonly ActionQualifier[]; signal?: EventCondition; subject?: 'self' | 'ally' | 'enemy'; }
export interface TriggerDefinition { id: string; condition: TriggerCondition; action: EventResolution; }

export type TroopAction = CardAction;

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
  /** Control X — contribute X additional control while deployed. */
  control?: number;
  continuousEffects?: readonly ContinuousEffect[];
  triggers?: readonly TriggerDefinition[];
}

interface ActionOptions {
  fly?: number;
  attack?: readonly [range: number, damage?: number];
  defense?: readonly [block: number, range: number];
  magic?: readonly [damage: number, range: number];
  cannon?: readonly [damage: number, range: number];
  bomb?: readonly [damage: number, range: number];
  /** M🫸N: push M hexes, select a target up to N hexes away. */
  push?: readonly [distance: number, range: number];
  /** M❤️N: mend M health at distance N. */
  mending?: readonly [amount: number, range: number];
  /** M🔮N: temporarily raise an active's left/right numbers. */
  upgrade?: { left?: number; right?: number; range: number };
}

function actions(move = 1, options: ActionOptions = {}): readonly TroopAction[] {
  const result: TroopAction[] = move > 0 ? [{ kind: 'move', range: move }] : [];
  if (options.fly) result.push({ kind: 'fly', range: options.fly });
  if (options.attack) result.push({ kind: 'ranged', ...(options.attack[1] === undefined ? {} : { amount: options.attack[1] }), range: options.attack[0] });
  if (options.defense) result.push({ kind: 'defense', amount: options.defense[0], range: options.defense[1] });
  if (options.magic) result.push({ kind: 'fire', amount: options.magic[0], range: options.magic[1] });
  if (options.cannon) result.push({ kind: 'cannon', amount: options.cannon[0], range: options.cannon[1] });
  if (options.bomb) result.push({ kind: 'bomb', amount: options.bomb[0], range: options.bomb[1] });
  if (options.push) result.push({ kind: 'push', amount: options.push[0], range: options.push[1] });
  if (options.mending) result.push({ kind: 'mending', amount: options.mending[0], range: options.mending[1] });
  if (options.upgrade) result.push({ kind: 'upgrade', amount: [options.upgrade.left ?? 0, options.upgrade.right ?? 0], range: options.upgrade.range });
  return result;
}

export const troopSeeds: readonly TroopSeed[] = [
  // Catalogue cards are side-neutral and may be chosen by either player.
  // Queen Bee is a fragile ranged hero.
  { id: 'queen-bee', name: 'Queen Bee', role: 'hero', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [4, 3] }) },
  { id: 'squirrel-king', name: 'Squirrel King', role: 'hero', baseHealth: 4, deploymentRegions: ['starting'], actions: actions(1, { magic: [1, 3] }), triggers: [{ id: 'kindle', condition: { kind: 'fire', subject: 'self' }, action: { kind: 'heal', amount: 1, range: 0 } }], passiveDescription: '🔥: +1❤️', ruleDescription: 'Kindle: heals 1 permanent damage each time it uses Magic.' },
  { id: 'tiger-queen', name: 'Tiger Queen', role: 'hero', baseHealth: 5, deploymentRegions: ['starting'], actions: actions(3) },
  { id: 'wandering-monarch', name: 'Wandering Monarch', role: 'hero', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(1, { push: [1, 2], defense: [2, 1] }), triggers: [{ id: 'end-stride', condition: { kind: 'phase', type: ['end'], subject: 'self' }, action: { kind: 'move', range: 1, type: ['optional'] } }], passiveDescription: 'End: 🥾1', ruleDescription: 'End stride: at the end of your turn, you may move this hero 1 hex or decline and finish the turn.' },
  { id: 'mole-artificer', name: 'Mole Artificer', role: 'hero', baseHealth: 4, deploymentRegions: ['starting'], actions: actions(1, { bomb: [2, 2], magic: [1, 2] }) },
  { id: 'stag-guardian', name: 'Stag Guardian', role: 'hero', baseHealth: 4, deploymentRegions: ['starting'], actions: actions(1, { defense: [2, 2] }), triggers: [{ id: 'renewal', condition: { kind: 'phase', type: ['start'], subject: 'self' }, action: { kind: 'heal', amount: 1, range: 0 } }], passiveDescription: 'Start: +1❤️', ruleDescription: 'Renewal: at the start of your turn, heals 1 permanent damage.' },
  { id: 'raven-prince', name: 'Raven Prince', role: 'hero', baseHealth: 3, deploymentRegions: ['intermediate'], actions: actions(0, { fly: 3 }), triggers: [{ id: 'dusk-strike', condition: { kind: 'phase', type: ['end'], subject: 'self' }, action: { kind: 'ranged', amount: 1, range: 1, type: ['instant', 'optional'] } }], passiveDescription: 'End: 1🏹❗1', ruleDescription: 'Dusk strike: at the end of your turn, you may choose a hex within 1. It immediately receives 1 physical ranged damage.' },
  { id: 'boar-warlord', name: 'Boar Warlord', role: 'hero', baseHealth: 6, deploymentRegions: ['starting'], actions: actions(1), continuousEffects: [{ condition: 'in-bash', kind: 'combat-modifier', value: 1, label: 'Boar Warlord' }], triggers: [{ id: 'battle-hardened', condition: { signal: 'bashResolved', subject: 'self' }, action: { kind: 'modifier', amount: 1, range: 0, type: ['permanent', 'bash'] } }], passiveDescription: '+1 if ⚔️\n⚔️→+1', ruleDescription: 'Battle-hardened: gains +1 in a bash. After each bash, this bonus permanently increases by 1.' },
  { id: 'tortoise-emperor', name: 'Tortoise Emperor', role: 'hero', baseHealth: 7, deploymentRegions: ['starting'], actions: actions(0), triggers: [{ id: 'imperial-shelter', condition: { kind: 'phase', type: ['end'], subject: 'self' }, action: { kind: 'defense', amount: 1, range: 1, type: ['adjacent'] } }], passiveDescription: '🥾0\nEnd: adj +1🛡️', ruleDescription: 'Imperial shelter: at the end of your turn, each adjacent friendly occupied hex gains 1 defense. Defense remains on its hex if that ally moves.' },

  { id: 'bramble-empress', name: 'Bramble Empress', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { push: [3, 1] }) },
  { id: 'ember-salamander', name: 'Ember Salamander', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [3, 2] }) },
  { id: 'bombardier-beetle', name: 'Bombardier Beetle', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { bomb: [2, 2] }) },
  { id: 'powder-newt', name: 'Powder Newt', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(2, { bomb: [1, 3] }) },
  { id: 'firefly-sapper', name: 'Firefly Sapper', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(0, { fly: 2, bomb: [1, 2], magic: [1, 2] }) },
  { id: 'moss-tortoise', name: 'Moss Tortoise', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { defense: [2, 2] }) },
  { id: 'steppe-lynx', name: 'Steppe Lynx', role: 'troop', baseHealth: 3, deploymentRegions: ['intermediate'], actions: actions(1, { attack: [1] }) },
  { id: 'reed-archer', name: 'Reed Archer', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(0, { attack: [4, 1] }), triggers: [{ id: 'sharpen', condition: { signal: 'successfulAttack', subject: 'self' }, action: { kind: 'upgrade', amount: [1, 0], range: 0, type: ['permanent', 'attack'] } }], passiveDescription: '🏹🩸: +1🏹', ruleDescription: 'Sharpen: after its ranged attack successfully inflicts damage, it permanently gains a stackable magenta +1 ranged damage.' },
  { id: 'crown-breaker', name: 'Crown Breaker', role: 'troop', baseHealth: 3, deploymentRegions: ['starting', 'intermediate'], actions: actions(2), continuousEffects: [{ condition: 'bash-attacker-vs-hero', kind: 'combat-modifier', value: 2, label: 'Crown Breaker' }], passiveDescription: '+2 if ⚔️👑', ruleDescription: 'Regicide: gains +2 combat modifier while bashing a hero as the attacker.' },
  { id: 'marching-giant', name: 'Marching Giant', role: 'troop', baseHealth: 5, deploymentRegions: ['starting'], actions: actions(1), triggers: [{ id: 'attrition', condition: { kind: 'move', subject: 'self' }, action: { kind: 'damage', amount: 1, range: 0, type: ['permanent'] } }], passiveDescription: '🥾: -1❤️', ruleDescription: 'Attrition: suffers 1 permanent damage each time it completes a Move action.' },
  { id: 'phoenix-moth', name: 'Phoenix Moth', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(0, { fly: 2 }), triggers: [{ id: 'death-burst', condition: { signal: 'death', subject: 'self' }, action: { kind: 'ranged', amount: 3, range: 2 } }], passiveDescription: '💀: 3🏹2', ruleDescription: 'Death burst: when this troop dies, choose an enemy within 2 hexes of its death hex to receive 3 physical damage.' },
  { id: 'pine-processionary', name: 'Pine Processionary', role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(2), triggers: [{ id: 'revive', condition: { signal: 'death', subject: 'self' }, action: { kind: 'revive', range: 0 } }], passiveDescription: '💀: 👼', ruleDescription: 'Revive: when this troop dies, choose one of your defeated troops and make it available to deploy again. If none are defeated, nothing happens.' },
  { id: 'canyon-ibex', name: 'Canyon Ibex', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(3), continuousEffects: [{ condition: 'bash-attacker', kind: 'combat-modifier', value: 2, label: 'Canyon Ibex' }], passiveDescription: '+2 if ⚔️', ruleDescription: 'Charge: gains +2 combat modifier while it is the attacker in a bash.' },
  { id: 'marsh-badger', name: 'Marsh Badger', role: 'troop', baseHealth: 4, deploymentRegions: ['starting', 'intermediate'], actions: actions(), continuousEffects: [{ condition: 'shielded', kind: 'combat-modifier', value: -1, label: 'Marsh Badger' }], passiveDescription: '-1 if 🛡️', ruleDescription: 'Encumbered: loses 1 combat modifier while shielded.' },
  { id: 'dune-scorpion', name: 'Dune Scorpion', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { attack: [3] }), deploymentRule: 'enemy-region' },
  { id: 'snowy-owl', name: 'Snowy Owl', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(2, { attack: [3] }) },
  { id: 'cave-viper', name: 'Cave Viper', role: 'troop', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { magic: [2, 3] }), passiveDescription: '🥾0' },
  { id: 'river-otter', name: 'River Otter', role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(), continuousEffects: [{ condition: 'shielded-by-ally', kind: 'combat-modifier', value: 1, label: 'River Otter' }], passiveDescription: '+1 if 🛡️', ruleDescription: 'Support: gains +1 combat modifier while another unit shields it.' },
  { id: 'coastal-heron', name: 'Coastal Heron', role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [2, 3] }) },
  { id: 'desert-fox', name: 'Desert Fox', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { magic: [3, 1] }) },
  { id: 'iron-armadillo', name: 'Iron Armadillo', role: 'troop', baseHealth: 1, deploymentRegions: ['starting', 'intermediate'], actions: actions(1, { defense: [3, 1] }) },
  { id: 'volcanic-gecko', name: 'Volcanic Gecko', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { magic: [4, 1] }) },
  { id: 'highland-hawk', name: 'Highland Hawk', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { attack: [2] }) },
  { id: 'ironscale-rhino', name: 'Ironscale Rhino', role: 'troop', baseHealth: 5, deploymentRegions: ['starting'], actions: actions(1, { defense: [3, 2] }), deploymentRule: 'enemy-region' },
  { id: 'sahel-porcupine', name: 'Sahel Porcupine', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [1, 1] }), triggers: [{ id: 'momentum', condition: { signal: 'bashAttack', subject: 'self' }, action: { kind: 'upgrade', amount: [1, 1], range: 0, type: ['permanent', 'attack'] } }], passiveDescription: '⚔️: +1🏹+1', ruleDescription: 'Momentum: when this troop starts a bash, it permanently gains a stackable magenta +1 ranged damage and +1 range upgrade.' },
  { id: 'alps-lone-wolf', name: 'Alps Lone Wolf', role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(2), continuousEffects: [{ condition: 'injured', kind: 'combat-modifier', value: 2, label: 'Alps Lone Wolf' }], passiveDescription: '+2 if 🩸', ruleDescription: 'Tenacity: gains +2 combat modifier while injured.' },
  { id: 'canyon-hawk', name: 'Canyon Hawk', role: 'troop', baseHealth: 3, deploymentRegions: ['front'], actions: actions(0, { fly: 2 }), passiveDescription: 'Steady', ruleDescription: 'Steady: its opponent has 0 combat modifier while this unit is in a bash.' },
  { id: 'cinder-heron', name: 'Cinder Heron, Rice Farmer', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(0, { fly: 3 }) },
  { id: 'walnut-crab', name: 'Walnut Crab', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { cannon: [2, 3], defense: [2, 0] }) },
  { id: 'coconut-crab', name: 'Coconut Crab', role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(1, { cannon: [3, 3] }) },
  { id: 'seaweed-crab', name: 'Seaweed Crab', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { cannon: [2, 4] }) },
  { id: 'reed-warden', name: 'Reed Warden', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { push: [2, 1] }), selfDefense: 2 },
  { id: 'bramble-scout', name: 'Bramble Scout', role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { push: [1, 2] }) },

  { id: 'spring-temple', name: 'Spring Temple', role: 'temple', baseHealth: 3, deploymentRegions: ['starting', 'intermediate'], actions: actions(0, { mending: [1, 3] }) },
  { id: 'oracle-temple', name: 'Oracle Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { upgrade: { left: 1, right: 0, range: 1 } }) },
  { id: 'water-temple', name: 'Water Temple', role: 'temple', baseHealth: 3, deploymentRegions: ['intermediate'], actions: actions(0, { upgrade: { left: 1, right: 1, range: 2 } }), deploymentRule: 'enemy-region' },
  { id: 'war-temple', name: 'War Temple', role: 'temple', baseHealth: 3, deploymentRegions: ['front'], actions: actions(0), continuousEffects: [{ condition: 'in-bash', kind: 'combat-modifier', value: 1, label: 'War Temple', scope: 'allies' }], passiveDescription: '+1 if ⚔️', ruleDescription: 'War aura: your units gain +1 combat modifier while in a bash.' },
  { id: 'ranged-power-temple', name: 'Ranged Power Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['intermediate'], deploymentRule: 'enemy-region', actions: actions(0), continuousEffects: [{ condition: 'deployed', kind: 'ability-bonus', ability: 'attack', left: 1, label: 'Ranged Power Temple' }], passiveDescription: '+1🏹', ruleDescription: 'Ranged power aura: your units gain +1 ranged damage while this temple is deployed.' },
  { id: 'magic-power-temple', name: 'Magic Power Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['intermediate'], deploymentRule: 'enemy-region', actions: actions(0), continuousEffects: [{ condition: 'deployed', kind: 'ability-bonus', ability: 'magic', left: 1, label: 'Magic Power Temple' }], passiveDescription: '+1🔥', ruleDescription: 'Magic power aura: your units gain +1 magic damage while this temple is deployed.' },
  { id: 'magic-range-temple', name: 'Magic Range Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['intermediate'], deploymentRule: 'enemy-region', actions: actions(0), continuousEffects: [{ condition: 'deployed', kind: 'ability-bonus', ability: 'magic', right: 1, label: 'Magic Range Temple' }], passiveDescription: '🔥+1', ruleDescription: 'Magic range aura: your units gain +1 magic range while this temple is deployed.' },
  { id: 'ranged-range-temple', name: 'Ranged Range Temple', role: 'temple', baseHealth: 2, deploymentRegions: ['intermediate'], deploymentRule: 'enemy-region', actions: actions(0), continuousEffects: [{ condition: 'deployed', kind: 'ability-bonus', ability: 'attack', right: 1, label: 'Ranged Range Temple' }], passiveDescription: '🏹+1', ruleDescription: 'Ranged range aura: your units gain +1 ranged range while this temple is deployed.' },
  { id: 'temple-last-bell', name: 'Temple of the Last Bell', role: 'temple', baseHealth: 1, deploymentRegions: ['front'], actions: actions(0), triggers: [{ id: 'last-bell', condition: { signal: 'death', subject: 'self' }, action: { kind: 'ranged', amount: [3, 2], range: 3, type: ['instant'] } }], passiveDescription: '💀: 2×3🏹❗3', ruleDescription: 'Last bell: when this temple dies, choose a hex within 3 twice. Each chosen hex immediately receives 3 physical ranged damage and may be chosen more than once.' },
  { id: 'temple-marches', name: 'Temple of Marches', role: 'temple', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(0), continuousEffects: [{ condition: 'deployed', kind: 'ability-bonus', ability: 'move', right: 1, label: 'Temple of Marches' }], passiveDescription: '🥾+1', ruleDescription: 'March aura: your units gain +1 Move range while this temple is deployed.' },
];
