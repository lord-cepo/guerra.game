export type RegionType = 'starting' | 'intermediate' | 'front';
/** Temples occupy and control a hex like troops, but have no movement action. */
export type TroopRole = 'hero' | 'troop' | 'temple';
export type PassiveKind = 'first-strike' | 'obsidian' | 'titanium' | 'steady' | 'fast';

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
export interface ActionView {
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
export type AttackAction = ActionView;

export type UpgradableAbility = 'move' | 'fly' | 'attack' | 'cannon' | 'gore' | 'bomb' | 'push' | 'pull' | 'stun' | 'magic' | 'defense' | 'magic-defense' | 'self-defense' | 'self-magic-defense' | 'mending' | 'upgrade';

/** Compatibility signal names retained only for serialized presentation history. */

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
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
  /** Troops with this property may defend themselves against magic directly. */
  selfMagicDefense?: number;
  /** Control X — contribute X additional control while deployed. */
  control?: number;
  /** Parsed normalized rules shared by every match and preview. */
  rules?: readonly import('./rule-parser.js').ParsedRule[];
  ruleSources?: readonly string[];
  ruleIds?: readonly string[];
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
    actions: 'move(2), bow(3,4)'
  },
  {
    id: 'squirrel-king',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: 'fire(1,3)',
    rules: ['self fire _ : up-life(1,0)'],
    ruleIds: ['kindle'],

  },
  {
    id: 'tiger-queen',
    role: 'hero',
    baseHealth: 5,
    deploymentRegions: 'starting',
    actions: 'move(3)'
  },
  {
    id: 'wandering-monarch',
    role: 'hero',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'push(1,2), shield(2,1)',
    rules: ['end : move(1)'], ruleIds: ['end-stride']
  },
  {
    id: 'mole-artificer',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: 'bomb(3,2), P.fire(1,2)',

  },
  {
    id: 'stag-guardian',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    actions: 'shield(2,2)',
    rules: ['start : up-life(1,0)'],
    ruleIds: ['renewal'],

  },
  {
    id: 'raven-prince',
    role: 'hero',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: 'fly(3)',
    rules: ['end : stun(1,1)'], ruleIds: ['dusk-stun']
  },
  {
    id: 'boar-warlord',
    role: 'hero',
    baseHealth: 4,
    deploymentRegions: 'starting',
    rules: [
      'start : move(1)',
      'self bash _ : self up-mod(1,1)'
    ], ruleIds: ['start-stride', 'battle-hardened']
  },
  {
    id: 'tortoise-emperor',
    role: 'hero',
    baseHealth: 7,
    deploymentRegions: 'starting',
    actions: 'move(0)',
    rules: ['end : shield(1) all o:you adj self'], ruleIds: ['imperial-shelter']
  },
  {
    id: 'thunder-toad',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'stun(1,1)',
    rules: ['stun _ : up-life(-1,1)'], ruleIds: ['thunder-charge']
  },
  {
    id: 'bellwing-crane',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: 'fly(2), stun(1,2)',
    rules: ['start : stun(1,1)'], ruleIds: ['bellwing-stun']
  },
  {
    id: 'frosthorn-yak',
    baseHealth: 4,
    deploymentRegions: 'starting intermediate',
    actions: 'move(0), stun(2,1)',
    rules: ['start : pull(2,3)'], ruleIds: ['frosthorn-call']
  },
  {
    id: 'duelist-scorpion',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move(2), stun(1,1)',
    rules: ['deploy s:opp : T.shield(3,0) & T.mshield(3,0)'], ruleIds: ['duelist-deploy']
  },
  {
    id: 'needle-peacock',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'fly(2), P.bow(1,3)',
    rules: ['self wound _ : stun(1) obj'], ruleIds: ['needle-sting']
  },
  {
    id: 'iron-bell-golem',
    baseHealth: 4,
    deploymentRegions: 'intermediate',
    passives: 'titanium',
    rules: ['up-mod(0,-3) when deployed'], ruleIds: ['iron-bell-deploy']
  },
  {
    id: 'merino-ram',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'move(0), gore(3,3)'
  },
  {
    id: 'prism-moth',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'fly(2), F.bow(1,2)',
    rules: ['_ bash self : up-mod(1,1)'], ruleIds: ['prismatic-bash']
  },
  {
    id: 'warding-bat',
    baseHealth: 1,
    deploymentRegions: 'front',
    actions: 'fly(2)',
    rules: ['start : F.fire(1,1)'], ruleIds: ['dawn-fire']
  },
  {
    id: 'arcane-viper',
    baseHealth: 2,
    deploymentRegions: 'starting intermediate',
    actions: 'fire(2,2)',
    rules: ['fire _ : up-mod(0,1)'], ruleIds: ['arcane-resonance']
  },
  {
    id: 'komodo-dragon',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: 'shield(3,0), mshield(3,0)'
  },
  {
    id: 'ironhide-boar-pup',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'gore(1,3)',
    rules: ['hit _ : up-mod(1,1)'], ruleIds: ['gore-hardened']
  },
  {
    id: 'needle-mantis',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly(2), P.bow(1,3)'
  },
  {
    id: 'deep-ocean-octopus',
    baseHealth: 5,
    deploymentRegions: 'starting intermediate',
    actions: 'move(0), pull(3,3)',
    rules: ['_ bash self : up-mod(1,0)'], ruleIds: ['tentacle-grip']
  },
  {
    id: 'thornback-archer',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: 'P.bow(2,2)'
  },
  {
    id: 'spellshield-beetle',
    baseHealth: 2,
    deploymentRegions: 'starting',
    passives: 'obsidian',
    rules: ['bash _ : up-mod(1,0)'], ruleIds: ['carapace']
  },
  {
    id: 'obsidian-lizard',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: 'shield(2,0)',
    passives: 'obsidian'
  },
  {
    id: 'battle-magpie',
    baseHealth: 1,
    deploymentRegions: 'front',
    actions: 'fly(2), P.bow(1,2)',
    rules: ['wound _ : up-mod(1,0)'], ruleIds: ['magpie-strike']
  },
  {
    id: 'bramble-empress',
    baseHealth: 1,
    deploymentRegions: 'starting intermediate',
    actions: 'push(2,1), pull(1,3)'
  },
  {
    id: 'ember-salamander',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fire(3,2)'
  },
  {
    id: 'bombardier-beetle',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'bomb(2,2)'
  },
  {
    id: 'powder-newt',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'move(2), bomb(1,3)'
  },
  {
    id: 'firefly-sapper',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly(2), bomb(1,2), fire(1,2)'
  },
  {
    id: 'moss-tortoise',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'shield(2,2)'
  },
  {
    id: 'steppe-lynx',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    actions: 'bow(3,1)'
  },
  {
    id: 'reed-archer',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'bow(1,4)',
    rules: ['wound _ : up-bow(1,1)'], ruleIds: ['sharpen']
  },
  {
    id: 'crown-breaker',
    baseHealth: 3,
    deploymentRegions: 'starting intermediate',
    actions: 'move(2)',
    rules: ['up-mod(2,0) while bashing t:hero']
  },
  {
    id: 'marching-giant',
    baseHealth: 5,
    deploymentRegions: 'starting',
    rules: ['move _ : up-life(-1,0)'], ruleIds: ['attrition']
  },
  {
    id: 'phoenix-moth',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'fly(2)',
    rules: ['die : bow(3,2)'], ruleIds: ['death-burst']
  },
  {
    id: 'pine-processionary',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'move(2)',
    rules: ['die : revive o:you dead'], ruleIds: ['revive']
  },
  {
    id: 'canyon-ibex',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'move(3)',
    rules: ['up-mod(2,0) while bashing']
  },
  {
    id: 'marsh-badger',
    baseHealth: 4,
    actions: 'move(2)',
    deploymentRegions: 'starting intermediate',
    rules: ['up-mod(-2,0) while shielded']
  },
  {
    id: 'dune-scorpion',
    baseHealth: 1,
    deploymentRegions: 'intermediate enemy',
    actions: 'bow(1,3)'
  },
  {
    id: 'snowy-owl',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'move(2), bow(1,3)'
  },
  {
    id: 'cave-viper',
    baseHealth: 2,
    deploymentRegions: 'front',
    actions: 'move(0), fire(2,3)'
  },
  {
    id: 'river-otter',
    baseHealth: 3,
    deploymentRegions: 'starting',
    rules: ['up-mod(1,0) while deployed']

  },
  {
    id: 'coastal-heron',
    baseHealth: 1,
    deploymentRegions: 'intermediate',
    actions: 'fire(2,3)'
  },
  {
    id: 'desert-fox',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move(2), fire(3,1)'
  },
  {
    id: 'iron-armadillo',
    baseHealth: 1,
    deploymentRegions: 'starting intermediate',
    actions: 'shield(3,1)'
  },
  {
    id: 'volcanic-gecko',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'fire(4,1)'
  },
  {
    id: 'highland-hawk',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'bow(1,2)'
  },
  {
    id: 'ironscale-rhino',
    baseHealth: 6,
    deploymentRegions: 'starting enemy',
    actions: 'shield(3,2)'
  },
  {
    id: 'sahel-porcupine',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move(2), bow(1,1)',
    rules: ['bash _ : up-bow(1,1)'], ruleIds: ['momentum']
  },
  {
    id: 'alps-lone-wolf',
    baseHealth: 3,
    deploymentRegions: 'starting',
    actions: 'move(2)',
    rules: ['up-mod(2,0) while wounded']
  },
  {
    id: 'canyon-hawk',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: 'fly(2)',
    passives: 'steady'
  },
  {
    id: 'cinder-heron',
    name: 'Cinder Heron, Rice Farmer',
    baseHealth: 2,
    deploymentRegions: 'starting',
    actions: 'fly(3)'
  },
  {
    id: 'walnut-crab',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'cannon(2,3), shield(2,0)'
  },
  {
    id: 'coconut-crab',
    baseHealth: 1,
    deploymentRegions: 'starting',
    actions: 'cannon(3,3)'
  },
  {
    id: 'seaweed-crab',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'cannon(2,4)'
  },
  {
    id: 'reed-warden',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'push(2,1), shield(2,0)'
  },
  {
    id: 'bramble-scout',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'move(2), push(1,2)'
  },
  {
    id: 'spring-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'starting intermediate',
    actions: 'move(0), mend(1,3)'
  },
  {
    id: 'oracle-temple',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'intermediate',
    actions: 'upgrade(1,0,1)'
  },
  {
    id: 'water-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'front',
    actions: 'upgrade(1,1,2)'
  },
  {
    id: 'war-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate',
    rules: ['o:you bashing o:opp have up-mod(1,0)'],
  },
  {
    id: 'ranged-power-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    rules: ['o:you have up-bow(1,0)']
  },
  {
    id: 'magic-power-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    rules: ['o:you have up-fire(1,0)']
  },
  {
    id: 'magic-range-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    rules: ['o:you have up-fire(0,1)']
  },
  {
    id: 'ranged-range-temple',
    role: 'temple',
    baseHealth: 3,
    deploymentRegions: 'intermediate enemy',
    rules: ['o:you have up-bow(0,1)']
  },
  {
    id: 'temple-last-bell',
    name: 'Temple of the Last Bell',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'starting intermediate',
    rules: ['self die : F.bow(3,3)'], ruleIds: ['last-bell']
  },
  {
    id: 'temple-marches',
    name: 'Temple of Marches',
    role: 'temple',
    baseHealth: 2,
    deploymentRegions: 'front',
    rules: ['o:you have up-move(1)']
  },

];

export const troopSeeds: readonly TroopSeed[] = cardSources.map(parseCard);
import { parseCard, type CardSource } from './card-parser.js';

// any bomb-throw adj self : T.bomb2x obj -> here x means no matter which distance, obj selects the hex that made the condition fire, not each hex selected by obj
// o:opp ratk self : F.bow1x subj -> same here, to be noted that subj here is not self
// adj o:you mod : mod(-1,1)
// move-from c:opp : act self -> it's a way to say that move is tireless if it's done from enemy regions, in this case the timing is important (explained before)
// o:you push self : self T.move in-line-with subj
// start & p:bombon adj self: defuse adj p:bombon & T.bomb-throw(1,X) self -> is it a valid condition?
// end : mend(1,X) adj
// any bomb-throw self : bomb(3,X) subj & bomb-explode self
