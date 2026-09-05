export type RuleWordKind = 'verb' | 'property' | 'phase' | 'interval' | 'operator' | 'qualifier';

export interface RuleWordDefinition {
  kind: RuleWordKind;
  /** A condition may inspect this word. */
  observable?: boolean;
  /** A rule may contribute this state without performing an event. */
  contributable?: boolean;
  /** Number of entity operands: one is subject-only, two is subject/object. */
  arity?: 1 | 2;
  /** Number of numeric card parameters accepted by an action/up-action word. */
  userParameters?: number;
  eventClass?: 'action' | 'result' | 'state-change';
  timing?: 'instant' | 'delayed';
  damageKind?: 'physical' | 'red-magic' | 'black-magic' | 'none';
  turnAction?: boolean;
  triggeredExecution?: 'optional' | 'forced';
  triggeredDeactivates?: boolean;
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

  bash: { kind: 'verb', arity: 2, eventClass: 'result', timing: 'delayed', damageKind: 'physical', note: 'A combat consequence, not a turn-consuming or upgradable action.' },
  bow: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'delayed', damageKind: 'physical' },
  fire: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'delayed', damageKind: 'red-magic', aliases: ['fires'] },
  cannon: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'delayed', damageKind: 'black-magic' },
  'gore-attack': { kind: 'verb', arity: 2, userParameters: 0, eventClass: 'action', timing: 'delayed', damageKind: 'physical' },
  'bomb-explode': { kind: 'verb', arity: 2, eventClass: 'result', timing: 'delayed', damageKind: 'black-magic', triggeredExecution: 'forced', triggeredDeactivates: false, note: 'Engine consequence caused by Fire, another explosion, or an explicit trigger.' },
  shield: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  mshield: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  move: { kind: 'verb', arity: 2, userParameters: 1, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  fly: { kind: 'verb', arity: 2, userParameters: 1, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  'gore-move': { kind: 'verb', arity: 2, userParameters: 1, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  push: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  pull: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  mend: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  stun: { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  'bomb-throw': { kind: 'verb', arity: 2, userParameters: 2, eventClass: 'action', timing: 'instant', damageKind: 'none', turnAction: true, aliases: ['throw-bomb'], note: 'The proper bomb-icon turn action.' },
  upgrade: { kind: 'verb', arity: 2, userParameters: 3, eventClass: 'action', timing: 'instant', damageKind: 'none' },
  'bomb-defuse': { kind: 'verb', arity: 2, userParameters: 1, eventClass: 'action', timing: 'instant', damageKind: 'none', turnAction: true, triggeredExecution: 'forced', triggeredDeactivates: false, aliases: ['defuse'], note: 'A normal action when chosen; a forced, non-deactivating action when caused by a trigger.' },
  light: { kind: 'verb', arity: 2, userParameters: 1, eventClass: 'action', timing: 'instant', damageKind: 'red-magic' },
  target: { kind: 'verb', arity: 2, eventClass: 'result' },
  hit: { kind: 'verb', arity: 2, eventClass: 'result', note: 'Damage resolution reached the target, including zero damage.' },
  wound: { kind: 'verb', arity: 2, eventClass: 'result', note: 'The target lost positive life.' },
  die: { kind: 'verb', arity: 2, eventClass: 'state-change', aliases: ['dies'], note: 'The subject is the defeated unit and the object is its last occupied hex.' },
  deploy: { kind: 'verb', arity: 2, eventClass: 'state-change', aliases: ['deploys'], note: 'The subject is the deployed unit and the object is its destination hex.' },
  revive: { kind: 'verb', arity: 1, eventClass: 'state-change' },
  activate: { kind: 'verb', arity: 2, eventClass: 'state-change', aliases: ['act'], note: 'The subject is the activated unit and the object is its current hex.' },

  wounded: { kind: 'property', observable: true, contributable: false },
  deployed: { kind: 'property', observable: true, contributable: false },
  defeated: { kind: 'property', observable: true, contributable: false },
  undeployed: { kind: 'property', observable: true, contributable: false },
  active: { kind: 'property', observable: true, contributable: false },
  shielded: { kind: 'property', observable: true, contributable: false },
  mshielded: { kind: 'property', observable: true, contributable: false },
  'shielded-by-ally': { kind: 'property', observable: true, contributable: false },
  'bomb-off': { kind: 'property', observable: true, contributable: false, note: 'An inert bomb; changed only by authoritative bomb actions.' },
  'bomb-on': { kind: 'property', observable: true, contributable: false, note: 'A lit bomb awaiting explosion; changed only by authoritative bomb actions.' },
  bashing: { kind: 'property', observable: true, contributable: false, arity: 2 },
  'bashed-by': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-firing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bowing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-gore-attacking': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-cannoning': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bomb-exploding': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-shielding': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-mshielding': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-moving': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-flying': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-gore-moving': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-pushing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-pulling': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-mending': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-stunning': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bomb-throwing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-upgrading': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-bomb-defusing': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'is-lighting': { kind: 'property', observable: true, contributable: false, arity: 2 },
  'first-strike': { kind: 'property', observable: true, contributable: true, aliases: ['firststrike'] },
  steady: { kind: 'property', observable: true, contributable: true },
  fast: { kind: 'property', observable: true, contributable: true, note: 'A Bash resolves immediately when at least one participant has Fast.' },
  titanium: { kind: 'property', observable: true, contributable: true },
  obsidian: { kind: 'property', observable: true, contributable: true },
  'up-mod': { kind: 'property', observable: false, contributable: true, note: 'Updates physical and magic modifier contributions.' },
  'up-life': { kind: 'property', observable: false, contributable: true, note: 'Updates actual and starting life.' },
  'up-action': { kind: 'property', observable: false, contributable: true, note: 'Family template: up-fire, up-bow, etc.; accepts the action numeric arity plus optional final T/P/F.' },
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
