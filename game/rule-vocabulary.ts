export type RuleWordKind = 'verb' | 'property' | 'phase' | 'interval' | 'operator' | 'qualifier';

export interface RuleWordDefinition {
  kind: RuleWordKind;
  /** A condition may inspect this word. */
  observable?: boolean;
  /** A rule may contribute this state without performing an event. */
  contributable?: boolean;
  /** Number of entity operands: one is subject-only, two is subject/object. */
  arity?: 1 | 2;
  eventClass?: 'action' | 'result' | 'state-change';
  timing?: 'instant' | 'delayed';
  damageKind?: 'physical' | 'red-magic' | 'black-magic' | 'none';
  aliases?: readonly string[];
  note?: string;
}

/**
 * Canonical rule-language dictionary. Parsing accepts aliases but the AST uses
 * the key stored in this table. Engine-only implementation words should not be
 * added until their card-language meaning is settled.
 */
export const ruleWords = {
  start: { kind: 'phase' }, end: { kind: 'phase' },
  'opponent-start': { kind: 'phase' }, 'opponent-end': { kind: 'phase' },
  'action-resolve': { kind: 'phase' }, 'combat-resolve': { kind: 'phase' },

  bash: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'physical' },
  bow: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'physical' },
  fire: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'red-magic', aliases: ['fires'] },
  cannon: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'black-magic' },
  'gore-attack': { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'physical' },
  'bomb-explode': { kind: 'verb', arity: 2, eventClass: 'action', timing: 'delayed', damageKind: 'black-magic' },
  shield: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  mshield: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  move: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  fly: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  'gore-move': { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  push: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  pull: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  mend: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  stun: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  'bomb-throw': { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none', aliases: ['throw-bomb'] },
  upgrade: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  defuse: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  light: { kind: 'verb', arity: 2, eventClass: 'action', timing: 'instant', damageKind: 'red-magic' },
  target: { kind: 'verb', arity: 2, eventClass: 'result' },
  hit: { kind: 'verb', arity: 2, eventClass: 'result', note: 'Damage resolution reached the target, including zero damage.' },
  wound: { kind: 'verb', arity: 2, eventClass: 'result', note: 'The target lost positive life.' },
  die: { kind: 'verb', arity: 1, eventClass: 'state-change', aliases: ['dies'] },
  deploy: { kind: 'verb', arity: 1, eventClass: 'state-change', aliases: ['deploys'] },
  revive: { kind: 'verb', arity: 1, eventClass: 'state-change' },
  activate: { kind: 'verb', arity: 1, eventClass: 'state-change', aliases: ['act'] },

  wounded: { kind: 'property', observable: true, contributable: false },
  deployed: { kind: 'property', observable: true, contributable: false },
  defeated: { kind: 'property', observable: true, contributable: false },
  undeployed: { kind: 'property', observable: true, contributable: false },
  active: { kind: 'property', observable: true, contributable: false },
  bashing: { kind: 'property', observable: true, contributable: false, arity: 2 },
  'bashed-by': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-firing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bowing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-gore-attacking': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-cannoning': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bomb-exploding': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'first-strike': { kind: 'property', observable: true, contributable: true, aliases: ['firststrike'] },
  steady: { kind: 'property', observable: true, contributable: true },
  titanium: { kind: 'property', observable: true, contributable: true },
  obsidian: { kind: 'property', observable: true, contributable: true },
  mod: { kind: 'property', observable: false, contributable: true, note: 'Numeric contribution; query effective modifiers through a dedicated predicate.' },
  up: { kind: 'property', observable: false, contributable: true, note: 'Numeric action upgrade contribution.' },
  'action-reachable': { kind: 'property', observable: true, contributable: false },
  'action-reaches': { kind: 'property', observable: true, contributable: false, arity: 2 },

  'during-this-turn': { kind: 'interval' }, 'during-last-turn': { kind: 'interval' },
  'since-beginning': { kind: 'interval' },
  if: { kind: 'operator' }, while: { kind: 'operator' }, until: { kind: 'operator' },
  'removed-after': { kind: 'operator' }, permanent: { kind: 'operator' },
  P: { kind: 'qualifier' }, F: { kind: 'qualifier' }, T: { kind: 'qualifier' }
} as const satisfies Record<string, RuleWordDefinition>;

export type CanonicalRuleWord = keyof typeof ruleWords;

/** Terms deliberately excluded from the accepted grammar pending a ruling. */
export const ambiguousRuleWords: Readonly<Record<string, string>> = {
  attack: 'Could mean Bash, Bow, Gore attack, or every damaging action.',
  ratk: 'Its membership is unsettled: Fire/Cannon/Bomb are not uniformly ranged attacks.',
  matk: 'Could include every magic action or only attacks that use magic modifiers.',
  patk: 'Could mean a physical action, a physical hit, or a physical damage result.',
  bomb: 'Could mean an inert/lit board object, placing a bomb, throwing one, or exploding one.',
  action: 'Could mean a capability, a declared action, or the turn action phase.',
  resolves: 'Must name the resolved action explicitly; contextual action-resolves is unsafe with multiple effects.',
  now: 'Snapshot state needs no interval; on events this word has no precise boundary.',
  'this-turn': 'Use during-this-turn so the interval cannot attach to only one operand.',
  'last-turn': 'Use during-last-turn and define the player-relative turn boundary.',
  'is-delayed': 'Name the pending action (for example is-firing) and define target/resolution boundaries.',
  unless: 'For derived rules it may alias while !condition, but precedence with an existing while expression is unsettled.',
  both: 'Owner both is impossible for ordinary units and unclear for control; use an explicit Boolean owner query.',
  none: 'As a quantifier it means not-any; as owner/control/property data it needs prefixed neutral/nobomb words.'
};

const aliases = new Map<string, string>();
for (const [canonical, definition] of Object.entries(ruleWords) as Array<[string, RuleWordDefinition]>) {
  aliases.set(canonical, canonical);
  for (const alias of definition.aliases ?? []) aliases.set(alias, canonical);
}

export function canonicalRuleWord(word: string): string {
  return aliases.get(word) ?? word;
}

export function ruleWord(word: string): RuleWordDefinition | undefined {
  return ruleWords[canonicalRuleWord(word) as CanonicalRuleWord];
}
