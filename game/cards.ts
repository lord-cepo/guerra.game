export type RegionType = 'starting' | 'intermediate' | 'front';
/** Temples occupy and control a hex like troops, but have no movement action. */
export type TroopRole = 'hero' | 'troop' | 'temple';
export type PassiveKind = 'first-strike' | 'obsidian' | 'titanium' | 'steady';

export type ActionKind = 'phase' | 'deploy' | 'pass' | 'move' | 'fly' | 'ranged' | 'cannon' | 'gore' | 'fire' | 'defense' | 'bomb' | 'push' | 'pull' | 'stun' | 'mending' | 'upgrade' | 'heal' | 'damage' | 'modifier' | 'life' | 'maxlife' | 'revive';
export type ActionAmount = number | readonly number[];
export type ActionQualifier = 'start' | 'action' | 'action-resolve' | 'combat-resolve' | 'end' | 'instant' | 'optional' | 'adjacent' | 'permanent' | 'attack' | 'magic' | 'bash' | 'pierce' | 'tireless';

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
  qualifiers?: readonly ActionQualifier[];
}
export type AttackAction = LegacyActionView;

export type UpgradableAbility = 'move' | 'fly' | 'attack' | 'cannon' | 'gore' | 'bomb' | 'push' | 'pull' | 'stun' | 'magic' | 'defense' | 'magic-defense' | 'self-defense' | 'self-magic-defense' | 'mending' | 'upgrade';

/** A condition whose effect exists only while the condition remains true. */
export type ContinuousCondition = 'bash-attacker' | 'bash-attacker-vs-hero' | 'in-bash' | 'injured' | 'shielded' | 'shielded-by-ally' | 'deployed';
export type ContinuousEffect =
  | { condition: ContinuousCondition; kind: 'combat-modifier'; value: number; label: string; scope?: 'self' | 'allies' }
  | { condition: 'deployed'; kind: 'ability-bonus'; ability: 'move' | 'attack' | 'magic'; left?: number; right?: number; label: string };

/** A one-shot event and the state change resolved each time it occurs. */
export type EventCondition = 'start' | 'end' | 'opponentStart' | 'opponentEnd' | 'deploy' | 'bashAttack' | 'bashDefense' | 'bashRetreat' | 'bashResolved' | 'bash' | 'magicUsed' | 'stunUsed' | 'attackResolved' | 'successfulAttack' | 'movementUsed' | 'death';
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
  /** Static keyword mechanics. Display text is derived from the keyword. */
  passives?: readonly PassiveKind[];
  passiveDescription?: string;
  ruleDescription?: string;
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
  /** Troops with this property may defend themselves against magic directly. */
  selfMagicDefense?: number;
  /** Control X — contribute X additional control while deployed. */
  control?: number;
  continuousEffects?: readonly ContinuousEffect[];
  triggers?: readonly TriggerDefinition[];
}

export function hasPassive(card: Pick<TroopSeed, 'passives'> | undefined, passive: PassiveKind): boolean {
  return card?.passives?.includes(passive) ?? false;
}

/*
 * Declarative catalogue draft.
 *
 * This deliberately uses the proposed human-readable card language before the
 * parser and engine adapter exist. The catalogue is therefore documentation of
 * the target format for now, rather than executable engine data.
 */
const cardSources: readonly CardSource[] = [
  // Catalogue cards are side-neutral and may be chosen by either player.
  // Queen Bee is a fragile ranged hero.
  {
    id: 'queen-bee',
    role: 'hero',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 3 bow 4'
  },
  {
    id: 'squirrel-king',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: '1 fire 3',
    triggers: 'fire : +1 life',

  },
  {
    id: 'tiger-queen',
    role: 'hero',
    baseHealth: 5,
    deploymentRegions: 'starting',
    actions: 'move 3'
  },
  {
    id: 'wandering-monarch',
    role: 'hero',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: '1 push 2, 2 shield 1',
    triggers: 'end : move 1'
  },
  {
    id: 'mole-artificer',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: '3 bomb 2, 1 P.fire 2',

  },
  {
    id: 'stag-guardian',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: '2 shield 2',
    triggers: 'start : +1 life',

  },
  {
    id: 'raven-prince',
    role: 'hero',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: 'fly 3',
    triggers: 'end : 1 stun 1'
  },
  {
    id: 'boar-warlord',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    triggers: 'start : move 1, bash : 1 mod 1'
  },
  {
    id: 'tortoise-emperor',
    role: 'hero',
    baseHealth: 7,
    deploymentRegions: 'starting',
    actions: 'move 0',
    triggers: 'end : 1 mod 0 all-adj-friend'
  },
  {
    id: 'thunder-toad',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: '1 stun 1',
    triggers: 'stun : 1 mod 0'
  },
  {
    id: 'bellwing-crane',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: 'fly 2, 1 stun 2',
    triggers: 'start : 1 stun 1'
  },
  {
    id: 'frosthorn-yak',
    baseHealth: 4,
    deploymentRegions: 'starting intermediate',
    actions: 'move 0, 2 stun 1',
    triggers: 'start : 2 pull 3'
  },
  {
    id: 'duelist-scorpion',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 1 stun 1',
    triggers: 'deploy any-hex-enemy : 3 mod 3'
  },
  {
    id: 'needle-peacock',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'fly 2, 1 P.bow 3',
    triggers: 'wounds : 1 stun 0'
  },
  {
    id: 'iron-bell-golem',
    baseHealth: 4,
    deploymentRegions: 'intermediate',
    passives: 'titanium',
    triggers: 'deploy : 0 mod -3'
  },
  {
    id: 'merino-ram',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'move 0, 3 gore 3'
  },
  {
    id: 'prism-moth',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'fly 2, 1 F.bow 2',
    triggers: 'is-bash-by : 0 mod 1'
  },
  {
    id: 'warding-bat',
    baseHealth: 1,
    deploymentRegions: 'front',
    actions: 'fly 2',
    triggers: 'start : 1 F.fire 1'
  },
  {
    id: 'arcane-viper',
    baseHealth: 2,
    deploymentRegions: 'starting intermediate',
    actions: '2 fire 2',
    triggers: 'fire : 0 mod 1'
  },
  {
    id: 'komodo-dragon',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: '3 shield 0, 3 mshield 0'
  },
  {
    id: 'ironhide-boar-pup',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: '1 gore 3',
    triggers: 'hit : 1 mod 1'
  },
  {
    id: 'needle-mantis',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly 2, 1 P.bow 3'
  },
  {
    id: 'deep-ocean-octopus',
    baseHealth: 5,
    deploymentRegions: 'starting intermediate',
    actions: 'move 0, 3 pull 3',
    triggers: 'is-bash-by : 1 mod 0'
  },
  {
    id: 'thornback-archer',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: '2 P.bow 2'
  },
  {
    id: 'spellshield-beetle',
    baseHealth: 2,
    deploymentRegions: 'starting',
    passives: 'obsidian',
    triggers: 'bash : 1 mod 0'
  },
  {
    id: 'obsidian-lizard',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: '2 shield 0',
    passives: 'obsidian'
  },
  {
    id: 'battle-magpie',
    baseHealth: 1,
    deploymentRegions: 'front',
    actions: 'fly 2, 1 P.bow 2',
    triggers: 'wound : 1 mod 0'
  },
  {
    id: 'bramble-empress',
    baseHealth: 1,
    deploymentRegions: 'starting intermediate',
    actions: '3 push 1, 1 pull 3'
  },
  {
    id: 'ember-salamander',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '3 fire 2'
  },
  {
    id: 'bombardier-beetle',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '2 bomb 2'
  },
  {
    id: 'powder-newt',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 1 bomb 3'
  },
  {
    id: 'firefly-sapper',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly 2, 1 bomb 2, 1 fire 2'
  },
  {
    id: 'moss-tortoise',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: '2 shield 2'
  },
  {
    id: 'steppe-lynx',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: '3 bow 1'
  },
  {
    id: 'reed-archer',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: '1 bow 4',
    triggers: 'wound : +1 bow +1'
  },
  {
    id: 'crown-breaker',
    baseHealth: 3,
    deploymentRegions: 'starting intermediate',
    actions: 'move 2',
    continuous: 'bash hero :: 2 mod 0'
  },
  {
    id: 'marching-giant',
    baseHealth: 5,
    deploymentRegions: 'starting',
    triggers: 'move : -1 mend 0'
  },
  {
    id: 'phoenix-moth',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly 2',
    triggers: 'die : 3 bow 2'
  },
  {
    id: 'pine-processionary',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'move 2',
    triggers: 'die : revive'
  },
  {
    id: 'canyon-ibex',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'move 3',
    continuous: 'bash :: +2'
  },
  {
    id: 'marsh-badger',
    baseHealth: 5,
    actions: 'move 2',
    deploymentRegions: 'starting intermediate',
    continuous: 'shielded :: -1 mod 0'
  },
  {
    id: 'dune-scorpion',
    baseHealth: 1,
    deploymentRegions: 'intermediate enemy',
    actions: '1 bow 3'
  },
  {
    id: 'snowy-owl',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'move 2, 1 bow 3'
  },
  {
    id: 'cave-viper',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: 'move 0, 2 fire 3'
  },
  {
    id: 'river-otter',
    baseHealth: 3,
    deploymentRegions: 'starting',
    continuous: 'deployed :: +1'

  },
  {
    id: 'coastal-heron',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: '2 fire 3'
  },
  {
    id: 'desert-fox',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 3 fire 1'
  },
  {
    id: 'iron-armadillo',
    baseHealth: 1,
    deploymentRegions: 'starting intermediate',
    actions: '3 shield 1'
  },
  {
    id: 'volcanic-gecko',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: '4 fire 1'
  },
  {
    id: 'highland-hawk',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: '1 bow 2'
  },
  {
    id: 'ironscale-rhino',
    baseHealth: 6,
    deploymentRegions: 'starting enemy',
    actions: '3 shield 2'
  },
  {
    id: 'sahel-porcupine',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 1 bow 1',
    triggers: 'self bash any : +1 bow +1'
  },
  {
    id: 'alps-lone-wolf',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'move 2',
    continuous: 'wounded :: +2'
  },
  {
    id: 'canyon-hawk',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: 'fly 2',
    passives: 'steady'
  },
  {
    id: 'cinder-heron',
    name: 'Cinder Heron, Rice Farmer',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'fly 3'
  },
  {
    id: 'walnut-crab',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '2 cannon 3, 2 shield 0'
  },
  {
    id: 'coconut-crab',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: '3 cannon 3'
  },
  {
    id: 'seaweed-crab',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '2 cannon 4'
  },
  {
    id: 'reed-warden',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '2 push 1, 2 shield 0'
  },
  {
    id: 'bramble-scout',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move 2, 1 push 2'
  },
  {
    id: 'spring-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'starting intermediate',
    actions: 'move 0, 1 mend 3'
  },
  {
    id: 'oracle-temple',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: '1 upgrade 0 1'
  },
  {
    id: 'water-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: '1 upgrade 1 2'
  },
  {
    id: 'war-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    continuous: 'any-friend bash any-enemy :: +1 mod 0 subject',
  },
  {
    id: 'ranged-power-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    continuous:'deployed :: +1 bow +0 all-friend'
  },
  {
    id: 'magic-power-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    continuous: 'deployed :: +1 fire +0 all-friend'
  },
  {
    id: 'magic-range-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    continuous: 'deployed :: +0 fire +1 all-friend'
  },
  {
    id: 'ranged-range-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    continuous: 'deployed :: +0 bow +1 all-friend'
  },
  {
    id: 'temple-last-bell',
    name: 'Temple of the Last Bell',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'starting intermediate',
    triggers: 'dies : 3 F.bow 3 & 3 F.bow 3'
  },
  {
    id: 'temple-marches',
    name: 'Temple of Marches',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'front',
    continuous: 'deployed :: move +1 all-friend'
  },

];

export const troopSeeds: readonly TroopSeed[] = cardSources.map(parseCard);
import { parseCard, type CardSource } from './card-parser.js';
