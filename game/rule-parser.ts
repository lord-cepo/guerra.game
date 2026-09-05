import { ambiguousRuleWords, canonicalRuleWord, ruleWord } from './rule-vocabulary.js';

/** A parsed descriptor denotes a set of board hexes. */
export type RuleSelector = 'any' | 'all' | 'none';
export type RuleReference = 'self' | 'subj' | 'obj';
export type RulePositionRelation = 'awayfrom' | 'towards' | 'parallel';

export type RuleUnitAttribute =
  | 'enemy' | 'friend' | 'active' | 'wounded' | 'shielded' | 'mshielded'
  | 'bashing' | 'bashed' | 'deployed'
  | 'first-strike' | 'obsidian' | 'titanium' | 'steady';

export type RuleRegionAttribute =
  | 'adj' | 'str' | 'int' | 'front'
  | 'econtrol' | 'fcontrol' | 'ncontrol' | 'empty'
  | 'eside' | 'fside';

export type RuleEntityType = 'bomboff' | 'bombon' | 'temple' | 'troop' | 'hero';

export interface RulePredicate<T extends string> {
  attribute: T;
  negated: boolean;
}

export interface RuleDescriptor {
  kind: 'descriptor';
  selector: RuleSelector;
  position?: RulePositionConstraint;
  units: RulePredicate<RuleUnitAttribute>[];
  regions: RulePredicate<RuleRegionAttribute>[];
  types: RulePredicate<RuleEntityType>[];
}

export interface RulePositionConstraint {
  relation: RulePositionRelation;
  reference: RuleReference;
}

export interface RuleBoundReference {
  kind: 'reference';
  reference: RuleReference;
}

/** `_` accepts every concrete event operand or every otherwise legal action target. */
export interface RuleWildcard {
  kind: 'wildcard';
}

export interface RuleFieldQuery {
  kind: 'query';
  selector: RuleSelector;
  owner?: 'you' | 'opp' | 'none' | 'both';
  /** Negated owner filters are canonical spellings such as `!o:you`. */
  excludedOwner?: 'you' | 'opp';
  bomb?: 'bomb-off' | 'bomb-on' | 'none' | 'bomb';
  region?: 'str' | 'int' | 'front';
  control?: 'you' | 'opp' | 'none';
  side?: 'you' | 'opp';
  entityType?: 'hero' | 'troop' | 'temple';
}

export interface RuleDirectedSelection {
  kind: 'directed';
  direction: 'away-from' | 'towards' | 'parallel-to' | 'range-from';
  distance?: number;
  reference: RuleBoundReference;
  /** Optional candidate filter in canonical query-first forms such as `o:you adj self`. */
  filter?: RuleFieldQuery;
}

/** A reference or descriptor resolves to a board hex, never a unit/hex tuple. */
export type RuleHex = RuleDescriptor | RuleBoundReference | RuleFieldQuery | RuleDirectedSelection | RuleWildcard;
/** Compatibility name for the phrase grammar's hex operand. */
export type RuleEntity = RuleHex;

export type RulePhase = 'start' | 'action' | 'action-resolve' | 'combat-resolve' | 'end' | 'opponent-start' | 'opponent-end';
export type RuleEndpoint = 'origin' | 'destination';

export interface RulePhaseCondition {
  kind: 'phase';
  phase: RulePhase;
}

export interface RulePhrase {
  kind: 'relation';
  subject: RuleEntity;
  action: PackedRuleAction;
  /** `resolved` is the successful post-mutation notification for the event. */
  stage?: 'resolved';
  endpoint?: RuleEndpoint;
  object?: RuleEntity;
  /** Omitted means choose exactly one target, pausing when several are legal. */
  targetPolicy?: 'all';
  /** Triggered actions are optional by default; `must` makes one compulsory. */
  mandatory?: true;
}

export type RuleRelationCondition = RulePhrase;
export type RuleCondition = RulePhaseCondition | RulePhrase;

export type PackedActionQualifier = 'pierce' | 'fast' | 'tireless';

export interface PackedRuleAction {
  name: string;
  /** Packed one-character parameters; `x` becomes undefined. */
  parameters: Array<number | undefined>;
  qualifiers: PackedActionQualifier[];
}

/** Effects and event conditions share the same subject/action/object phrase. */
export type RuleEffect = RulePhrase;

export interface RuleStateProperty {
  name: string;
  parameters: Array<number | undefined | 'tireless' | 'pierce' | 'fast'>;
  action?: string;
}

export interface RuleState {
  kind: 'state';
  subject: RuleEntity;
  property: RuleStateProperty;
  object?: RuleEntity;
}

export type RuleHistoryInterval = 'during-this-turn' | 'during-last-turn' | 'since-beginning';
export interface RuleHistoricalCondition {
  kind: 'history';
  event: RulePhrase;
  interval: RuleHistoryInterval;
}

export interface RuleBooleanCondition {
  kind: 'boolean';
  operator: 'and' | 'or' | 'not';
  conditions: RuleObservableCondition[];
}

export type RuleObservableCondition = RuleState | RuleHistoricalCondition | RuleBooleanCondition;

export type RuleLifetime =
  | { kind: 'permanent' }
  | { kind: 'until'; event: RuleCondition }
  | { kind: 'removed-after'; event: RuleCondition };

export type RuleTriggeredConsequence =
  | { kind: 'event'; event: RulePhrase }
  | { kind: 'stored-state'; state: RuleState; lifetime: RuleLifetime }
  | { kind: 'distributed-state'; selector: RuleSetSelector; state: RuleState; lifetime: RuleLifetime };

export interface ParsedTriggerRule {
  kind: 'trigger';
  anchor: RuleCondition;
  guard?: RuleObservableCondition;
  consequences: RuleTriggeredConsequence[];
}

export interface ParsedContinuousRule {
  kind: 'continuous';
  contribution: RuleState;
  condition: RuleObservableCondition;
}

export type RuleSetSelector = RuleEntity | RuleState;
export interface ParsedHaveRule {
  kind: 'have';
  selector: RuleSetSelector;
  attachment: RuleState | ParsedHaveRule;
}

export type ParsedRule = ParsedTriggerRule | ParsedContinuousRule | ParsedHaveRule;

const selectors = new Set<RuleSelector>(['any', 'all', 'none']);
const references = new Set<RuleReference>(['self', 'subj', 'obj']);
const positionRelations = new Set<RulePositionRelation>(['awayfrom', 'towards', 'parallel']);
const unitAttributes = new Set<RuleUnitAttribute>([
  'enemy', 'friend', 'active', 'wounded', 'shielded', 'mshielded', 'bashing', 'bashed', 'deployed',
  'first-strike', 'obsidian', 'titanium', 'steady'
]);
const unitAliases: Readonly<Record<string, RuleUnitAttribute>> = { firststrike: 'first-strike' };
const regionAttributes = new Set<RuleRegionAttribute>([
  'adj', 'str', 'int', 'front', 'econtrol', 'fcontrol', 'ncontrol', 'empty', 'eside', 'fside'
]);
const entityTypes = new Set<RuleEntityType>(['bomboff', 'bombon', 'temple', 'troop', 'hero']);
const phases = new Set<RulePhase>([
  'start', 'action', 'action-resolve', 'combat-resolve', 'end', 'opponent-start', 'opponent-end'
]);
const noObjectVerbs = new Set(['revive']);
const rangeOnlyActions = new Set(['light', 'bomb-defuse']);
const movementVerbs = new Set(['move', 'fly', 'gore']);
function parsePredicate<T extends string>(token: string, values: ReadonlySet<T>, context: string): RulePredicate<T> | undefined {
  const negated = token.startsWith('!');
  const attribute = (negated ? token.slice(1) : token) as T;
  if (!attribute) throw new Error(`${context}: "!" needs an attribute`);
  return values.has(attribute) ? { attribute, negated } : undefined;
}

function parseUnitPredicate(token: string, context: string): RulePredicate<RuleUnitAttribute> | undefined {
  const negated = token.startsWith('!');
  const raw = negated ? token.slice(1) : token;
  const attribute = unitAliases[raw] ?? raw as RuleUnitAttribute;
  if (!raw) throw new Error(`${context}: "!" needs an attribute`);
  return unitAttributes.has(attribute) ? { attribute, negated } : undefined;
}

function descriptorGroup(token: string, context: string): Pick<RuleDescriptor, 'units' | 'regions' | 'types'> {
  const entries = token.split('&');
  if (entries.some(entry => !entry)) throw new Error(`${context}: invalid empty attribute in "${token}"`);

  const unit = entries.map(entry => parseUnitPredicate(entry, context));
  if (unit.every(Boolean)) return { units: unit as RulePredicate<RuleUnitAttribute>[], regions: [], types: [] };
  const region = entries.map(entry => parsePredicate(entry, regionAttributes, context));
  if (region.every(Boolean)) return { units: [], regions: region as RulePredicate<RuleRegionAttribute>[], types: [] };
  const type = entries.map(entry => parsePredicate(entry, entityTypes, context));
  if (type.every(Boolean)) return { units: [], regions: [], types: type as RulePredicate<RuleEntityType>[] };

  throw new Error(`${context}: "${token}" mixes attribute groups or contains an unknown attribute`);
}

export function parseRuleEntity(text: string, context = 'rule entity'): RuleEntity {
  const source = text.trim();
  if (!source || /\s/.test(source)) throw new Error(`${context}: expected one entity token, received "${text}"`);
  if (references.has(source as RuleReference)) return { kind: 'reference', reference: source as RuleReference };

  const fields = source.split('-');
  let selector: RuleSelector = 'any';
  if (selectors.has(fields[0] as RuleSelector)) selector = fields.shift() as RuleSelector;
  if (!fields.length) return { kind: 'descriptor', selector, units: [], regions: [], types: [] };

  let position: RulePositionConstraint | undefined;
  if (positionRelations.has(fields[0] as RulePositionRelation)) {
    const relation = fields.shift() as RulePositionRelation;
    const reference = fields.shift();
    if (!reference || !references.has(reference as RuleReference)) {
      throw new Error(`${context}: positional descriptor "${relation}" needs self, subj, or obj`);
    }
    position = { relation, reference: reference as RuleReference };
  }
  if (!fields.length && position) return { kind: 'descriptor', selector, position, units: [], regions: [], types: [] };

  const descriptor: RuleDescriptor = {
    kind: 'descriptor', selector,
    ...(position ? { position } : {}),
    units: [], regions: [], types: []
  };
  let previousGroup = -1;
  for (const field of fields) {
    const parsed = descriptorGroup(field, context);
    const group = parsed.units.length ? 0 : parsed.regions.length ? 1 : 2;
    if (group < previousGroup) throw new Error(`${context}: attributes must be ordered unit-region-type in "${source}"`);
    if ((group === 0 && descriptor.units.length) || (group === 1 && descriptor.regions.length) || (group === 2 && descriptor.types.length)) {
      throw new Error(`${context}: attributes from one group must be joined with "&" in "${source}"`);
    }
    descriptor.units.push(...parsed.units);
    descriptor.regions.push(...parsed.regions);
    descriptor.types.push(...parsed.types);
    previousGroup = group;
  }
  return descriptor;
}

const querySelectors = new Set<RuleSelector>(['any', 'all', 'none']);
const queryFieldOrder = ['o', 'p', 'r', 'c', 's', 't'] as const;
const queryFieldValues: Readonly<Record<typeof queryFieldOrder[number], ReadonlySet<string>>> = {
  o: new Set(['you', 'opp', 'none', 'both']),
  p: new Set(['bomb-off', 'bomb-on', 'none', 'bomb']),
  r: new Set(['str', 'int', 'front']),
  c: new Set(['you', 'opp', 'none']),
  s: new Set(['you', 'opp']),
  t: new Set(['hero', 'troop', 'temple'])
};

function parseFieldQuery(words: readonly string[], start: number, context: string): { entity: RuleFieldQuery; next: number } | undefined {
  let index = start;
  let selector: RuleSelector = 'any';
  if (querySelectors.has(words[index] as RuleSelector)) selector = words[index++] as RuleSelector;
  const fields: Partial<Record<typeof queryFieldOrder[number], string>> = {};
  while (index < words.length) {
    const match = words[index].match(/^(!?)([oprcst]):([a-z-]+)$/);
    if (!match) break;
    const negated = match[1] === '!';
    const key = match[2] as typeof queryFieldOrder[number];
    const value = match[3];
    if (negated && (key !== 'o' || (value !== 'you' && value !== 'opp'))) {
      throw new Error(`${context}: only o:you and o:opp currently support query negation`);
    }
    if (fields[key]) throw new Error(`${context}: duplicate ${key}: query field`);
    if (!queryFieldValues[key].has(value)) throw new Error(`${context}: invalid ${key}: value "${value}"`);
    fields[key] = value;
    index += 1;
  }
  if (index === start || index === start + 1 && querySelectors.has(words[start] as RuleSelector)) {
    if (!querySelectors.has(words[start] as RuleSelector)) return undefined;
  }
  if (index === start) return undefined;
  return {
    entity: {
      kind: 'query', selector,
      ...(fields.o && !words.slice(start, index).some(word => word === `!o:${fields.o}`) ? { owner: fields.o as RuleFieldQuery['owner'] } : {}),
      ...(fields.o && words.slice(start, index).some(word => word === `!o:${fields.o}`) ? { excludedOwner: fields.o as RuleFieldQuery['excludedOwner'] } : {}),
      ...(fields.p ? { bomb: fields.p as RuleFieldQuery['bomb'] } : {}),
      ...(fields.r ? { region: fields.r as RuleFieldQuery['region'] } : {}),
      ...(fields.c ? { control: fields.c as RuleFieldQuery['control'] } : {}),
      ...(fields.s ? { side: fields.s as RuleFieldQuery['side'] } : {}),
      ...(fields.t ? { entityType: fields.t as RuleFieldQuery['entityType'] } : {})
    },
    next: index
  };
}

function parseSubsetWords(words: readonly string[], start: number, context: string): { entity: RuleEntity; next: number } {
  const token = words[start];
  if (!token) throw new Error(`${context}: missing subset`);
  if (token === '_') return { entity: { kind: 'wildcard' }, next: start + 1 };
  const leadingQuery = parseFieldQuery(words, start, context);
  if (leadingQuery) {
    const positionToken = words[leadingQuery.next];
    const positionMatch = positionToken?.match(/^(?:(\d+)-(away-from|towards|parallel-to|from)|away-from|towards|parallel-to|adj|range(\d+)-from)$/);
    if (positionMatch) {
      const reference = words[leadingQuery.next + 1];
      if (!references.has(reference as RuleReference)) {
        throw new Error(`${context}: positional selector "${positionToken}" needs singular self, subj, or obj on its right`);
      }
      const namedDirection = positionMatch[2] ?? positionMatch[0];
      const direction = namedDirection === 'adj' || namedDirection === 'from' || namedDirection.startsWith('range') ? 'range-from' : namedDirection;
      const distance = positionMatch[1] ? Number(positionMatch[1]) : positionMatch[3] ? Number(positionMatch[3]) : namedDirection === 'adj' ? 1 : undefined;
      return { entity: {
        kind: 'directed', direction: direction as RuleDirectedSelection['direction'],
        ...(distance !== undefined ? { distance } : {}),
        reference: { kind: 'reference', reference: reference as RuleReference },
        filter: leadingQuery.entity
      }, next: leadingQuery.next + 2 };
    }
    return leadingQuery;
  }
  const directionMatch = token.match(/^(?:(\d+)-(away-from|towards|parallel-to|from)|away-from|towards|parallel-to|adj|range(\d+)-from)$/);
  if (directionMatch) {
    const target = parseSubsetWords(words, start + 1, `${context} direction reference`);
    if (target.entity.kind !== 'reference') throw new Error(`${context}: a positional selector needs singular self, subj, or obj on its right`);
    const namedDirection = directionMatch[2] ?? directionMatch[0];
    const direction = namedDirection === 'adj' || namedDirection === 'from' || namedDirection.startsWith('range') ? 'range-from' : namedDirection;
    const distance = directionMatch[1] ? Number(directionMatch[1])
      : directionMatch[3] ? Number(directionMatch[3])
      : namedDirection === 'adj' ? 1 : undefined;
    return {
      entity: {
        kind: 'directed', direction: direction as RuleDirectedSelection['direction'],
        ...(distance !== undefined ? { distance } : {}),
        reference: target.entity
      },
      next: target.next
    };
  }
  if (token === 'this') return parseSubsetWords(words, start + 1, context);
  if (references.has(token as RuleReference)) return { entity: { kind: 'reference', reference: token as RuleReference }, next: start + 1 };
  return { entity: parseRuleEntity(token, context), next: start + 1 };
}

export function parsePackedRuleAction(text: string, context = 'rule action'): PackedRuleAction {
  const source = text.trim();
  const parts = source.split('.');
  const body = parts.pop() ?? '';
  const qualifiers = parts.map<PackedActionQualifier>(qualifier => {
    if (qualifier === 'P') return 'pierce';
    if (qualifier === 'F') return 'fast';
    if (qualifier === 'T') return 'tireless';
    throw new Error(`${context}: unknown qualifier "${qualifier}"`);
  });
  const match = body.match(/^([a-z][a-z-]*?)([0-9xX]{0,3})$/);
  if (!match) throw new Error(`${context}: invalid packed action "${source}"`);
  const name = canonicalRuleWord(match[1]);
  return {
    name,
    parameters: [...match[2]].map(value => value.toLowerCase() === 'x' ? undefined : Number(value)),
    qualifiers
  };
}

function parseRuleActionToken(text: string, context: string): PackedRuleAction {
  const functionMatch = text.match(/^((?:[PFT]\.)*)([a-z][a-z-]*)(?:\.([a-z][a-z-]*))?\(([^)]*)\)$/);
  if (!functionMatch) return parsePackedRuleAction(text, context);
  const qualifiers = functionMatch[1].split('.').filter(Boolean).map<PackedActionQualifier>(qualifier =>
    qualifier === 'P' ? 'pierce' : qualifier === 'F' ? 'fast' : 'tireless');
  const rawName = functionMatch[2];
  const action = functionMatch[3];
  const parameters = functionMatch[4].trim() ? functionMatch[4].split(',').map(value => {
    const token = value.trim();
    if (token === '_' || token.toLowerCase() === 'x' || token.toLowerCase() === 'u') return undefined;
    if (!/^-?\d+$/.test(token)) throw new Error(`${context}: invalid parameter "${token}"`);
    return Number(token);
  }) : [];
  return { name: action ? `${rawName}.${action}` : canonicalRuleWord(rawName), parameters, qualifiers };
}

function validateRuleAction(action: PackedRuleAction, context: string): void {
  const movement = action.name.match(/^(move|fly|gore)-(from|to)$/);
  const verb = movement?.[1] ?? action.name;
  if ((action.name.endsWith('-from') || action.name.endsWith('-to')) && (!movement || !movementVerbs.has(verb))) {
    throw new Error(`${context}: only move, fly, and gore support -from/-to`);
  }
  const definition = ruleWord(verb);
  if (definition?.kind !== 'verb') {
    const ambiguity = ambiguousRuleWords[verb];
    throw new Error(ambiguity ? `${context}: ambiguous verb "${verb}": ${ambiguity}` : `${context}: unknown verb "${action.name}"`);
  }
  if (rangeOnlyActions.has(verb) && action.parameters.length > 1) {
    throw new Error(`${context}: action "${verb}" accepts only its range parameter`);
  }
  if (new Set(action.qualifiers).size !== action.qualifiers.length) {
    throw new Error(`${context}: action "${verb}" repeats a qualifier`);
  }
  for (const qualifier of action.qualifiers) {
    if (qualifier === 'pierce' && definition.damageKind !== 'physical' && definition.damageKind !== 'red-magic' && definition.damageKind !== 'black-magic') {
      throw new Error(`${context}: action "${verb}" cannot acquire Pierce`);
    }
    // Fast is meaningful on delayed actions and harmlessly explicit on an
    // already-instant action; both spellings occur in the transition catalogue.
    if (qualifier === 'tireless' && definition.eventClass !== 'action') {
      throw new Error(`${context}: action "${verb}" cannot acquire Tireless`);
    }
  }
}

function parseRulePhrase(text: string, context: string, consequence: boolean, allowBooleanQuantifiers = false): RulePhrase {
  const source = text.trim();
  const words = source ? source.split(/\s+/) : [];
  if (!words.length) throw new Error(`${context}: expected "[subject] action [object]"`);
  const mustIndexes = words.flatMap((word, index) => word === 'must' ? [index] : []);
  if (mustIndexes.length) {
    if (!consequence) throw new Error(`${context}: must is valid only on a triggered action consequence`);
    if (mustIndexes.length > 1) throw new Error(`${context}: repeats must`);
    words.splice(mustIndexes[0], 1);
  }
  const misplacedNone = words.findIndex((word, index) => index > 0 && (word === 'none' || word.startsWith('none-')));
  if (misplacedNone >= 0) throw new Error(`${context}: pronoun none is valid only at the beginning of a phrase`);
  let actionIndex = -1;
  let rawAction: PackedRuleAction | undefined;
  for (let candidate = 0; candidate < words.length; candidate += 1) {
    try {
      const parsed = parseRuleActionToken(words[candidate], `${context} action`);
      const resolved = parsed.name.match(/^([a-z][a-z-]*)-resolved$/);
      const movement = parsed.name.match(/^(move|fly|gore)-(from|to)$/);
      if (ruleWord(movement?.[1] ?? resolved?.[1] ?? parsed.name)?.kind === 'verb') {
        actionIndex = candidate; rawAction = parsed; break;
      }
    } catch { /* entity/query word, not the verb */ }
  }
  if (actionIndex < 0 || !rawAction) throw new Error(`${context}: missing or unknown verb in "${text}"`);
  if (!allowBooleanQuantifiers && actionIndex > 0 && /^(any|none|all)(?:-|$)/.test(words[0])) {
    throw new Error(`${context}: event operands cannot start with Boolean any, none, or all`);
  }
  let subject: RuleEntity = { kind: 'reference', reference: 'self' };
  if (actionIndex > 0) {
    const parsedSubject = parseSubsetWords(words, 0, `${context} subject`);
    if (parsedSubject.next !== actionIndex) throw new Error(`${context}: invalid subject before "${words[actionIndex]}"`);
    subject = parsedSubject.entity;
  }
  const movement = rawAction.name.match(/^(move|fly|gore)-(from|to)$/);
  const resolved = rawAction.name.match(/^([a-z][a-z-]*)-resolved$/);
  const actionName = movement?.[1] ?? resolved?.[1] ?? rawAction.name;
  const action = movement ? { ...rawAction, name: actionName } : rawAction;
  if (resolved) action.name = actionName;
  validateRuleAction(action, `${context} action`);
  const endpoint: RuleEndpoint | undefined = movement?.[2] === 'from' ? 'origin' : movement?.[2] === 'to' ? 'destination' : undefined;
  const verb = actionName;

  let object: RuleEntity | undefined;
  let targetPolicy: 'all' | undefined;
  let objectStart = actionIndex + 1;
  if (words[objectStart] === 'all') {
    if (!consequence) throw new Error(`${context}: all is an action-consequence target policy, not an event operand`);
    targetPolicy = 'all';
    objectStart += 1;
  }
  if (!allowBooleanQuantifiers && /^(any|none)(?:-|$)/.test(words[objectStart] ?? '')) {
    throw new Error(`${context}: event operands cannot start with Boolean any or none; use _ for an unconstrained operand`);
  }
  if (words[objectStart]) {
    const parsedObject = parseSubsetWords(words, objectStart, `${context} object`);
    if (parsedObject.next !== words.length) throw new Error(`${context}: invalid object after "${words[actionIndex]}"`);
    object = parsedObject.entity;
  }
  if (noObjectVerbs.has(verb) && object) {
    throw new Error(`${context}: unary verb "${verb}" cannot have an object`);
  }
  if (!consequence && !noObjectVerbs.has(verb) && !object) {
    throw new Error(`${context}: verb "${verb}" needs an object`);
  }
  if (!consequence) {
    const parameterCount = ruleWord(verb)?.userParameters;
    // An event pattern may omit its complete value vector to match any
    // printed values, but a written vector must be complete.
    if (parameterCount !== undefined && action.parameters.length !== 0 && action.parameters.length !== parameterCount) {
      throw new Error(`${context}: action "${verb}" needs exactly ${parameterCount} parameter${parameterCount === 1 ? '' : 's'}`);
    }
  }
  if (consequence) {
    const definition = ruleWord(verb);
    const parameterCount = definition?.userParameters;
    if (parameterCount !== undefined) {
      const explicitTargetCount = Math.max(0, parameterCount - 1);
      const valid = object
        ? action.parameters.length === explicitTargetCount || action.parameters.length === parameterCount
        : action.parameters.length === parameterCount;
      if (!valid) {
        throw new Error(`${context}: action "${verb}" needs ${parameterCount} parameters with its default target or ${explicitTargetCount} with an explicit target`);
      }
    }
  }
  return {
    kind: 'relation',
    subject,
    action,
    ...(resolved ? { stage: 'resolved' as const } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(object ? { object } : {}),
    ...(targetPolicy ? { targetPolicy } : {}),
    ...(mustIndexes.length ? { mandatory: true as const } : {})
  };
}

export function parseRuleCondition(text: string, context = 'rule condition'): RuleCondition {
  const source = text.trim();
  if (phases.has(source as RulePhase)) return { kind: 'phase', phase: source as RulePhase };
  return parseRulePhrase(source, context, false);
}

export function parseRuleEffect(text: string, context = 'rule effect'): RuleEffect {
  return parseRulePhrase(text, context, true);
}

function splitConjunction(text: string): string[] {
  return text.split(/\s+&\s+/).map(part => part.trim()).filter(Boolean);
}

function parseStateProperty(text: string, context: string): RuleStateProperty {
  const match = text.match(/^([a-z][a-z-]*)\(([^)]*)\)$/);
  const rawName = match?.[1] ?? text;
  const name = canonicalRuleWord(rawName);
  const rawParameters = match?.[2].trim() ? match[2].split(',').map(value => value.trim()) : [];
  const upgradeAction = name.startsWith('up-') && name !== 'up-mod' && name !== 'up-life' ? name.slice(3) : undefined;
  const definition = upgradeAction ? ruleWord('up-action') : ruleWord(name);
  if (definition?.kind !== 'property') {
    const ambiguity = ambiguousRuleWords[name];
    throw new Error(ambiguity ? `${context}: ambiguous property "${name}": ${ambiguity}` : `${context}: unknown property "${name}"`);
  }
  const parameters: RuleStateProperty['parameters'] = rawParameters.map((token, index) => {
    if (upgradeAction && index === rawParameters.length - 1 && ['T', 'P', 'F'].includes(token)) {
      return token === 'T' ? 'tireless' : token === 'P' ? 'pierce' : 'fast';
    }
    if (token === '_' || token.toLowerCase() === 'x' || token.toLowerCase() === 'u') return undefined;
    if (!/^-?\d+$/.test(token)) throw new Error(`${context}: invalid state parameter "${token}"`);
    return Number(token);
  });
  if (upgradeAction) {
    const actionDefinition = ruleWord(upgradeAction);
    if (actionDefinition?.kind !== 'verb' || actionDefinition.eventClass !== 'action') {
      throw new Error(`${context}: "${name}" does not name a known action`);
    }
    const numericArity = actionDefinition.userParameters ?? 0;
    const hasQualifier = typeof parameters[parameters.length - 1] === 'string';
    if (parameters.length !== numericArity + (hasQualifier ? 1 : 0)) {
      throw new Error(`${context}: "${name}" needs ${numericArity} numeric parameter${numericArity === 1 ? '' : 's'} and may have one final T, P, or F`);
    }
    const qualifier = hasQualifier ? parameters.at(-1) : undefined;
    if (qualifier === 'pierce' && actionDefinition.damageKind === 'none') {
      throw new Error(`${context}: "${name}" cannot acquire Pierce`);
    }
    if (qualifier === 'tireless' && actionDefinition.eventClass !== 'action') {
      throw new Error(`${context}: "${name}" cannot acquire Tireless`);
    }
  } else if ((name === 'up-mod' || name === 'up-life') && parameters.length !== 2) {
    throw new Error(`${context}: "${name}" needs exactly two numeric parameters`);
  }
  return { name, parameters, ...(upgradeAction ? { action: upgradeAction } : {}) };
}

export function parseRuleState(text: string, context = 'rule state'): RuleState {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error(`${context}: expected "[subject] property [object]"`);
  const misplacedNone = words.findIndex((word, index) => index > 0 && (word === 'none' || word.startsWith('none-')));
  if (misplacedNone >= 0) throw new Error(`${context}: pronoun none is valid only at the beginning of a phrase`);
  let propertyIndex = -1;
  let property: RuleStateProperty | undefined;
  for (let candidate = 0; candidate < words.length; candidate += 1) {
    try {
      property = parseStateProperty(words[candidate], `${context} property`);
      propertyIndex = candidate; break;
    } catch (error) {
      if (words[candidate].startsWith('up-')) throw error;
      /* subset/query word, not the property */
    }
  }
  if (propertyIndex < 0 || !property) throw new Error(`${context}: missing or unknown property`);
  let subject: RuleEntity = { kind: 'reference', reference: 'self' };
  if (propertyIndex > 0) {
    const parsedSubject = parseSubsetWords(words, 0, `${context} subject`);
    if (parsedSubject.next !== propertyIndex) throw new Error(`${context}: invalid subject before "${words[propertyIndex]}"`);
    subject = parsedSubject.entity;
  }
  let object: RuleEntity | undefined;
  if (words[propertyIndex + 1]) {
    const parsedObject = parseSubsetWords(words, propertyIndex + 1, `${context} object`);
    if (parsedObject.next !== words.length) throw new Error(`${context}: invalid object after "${words[propertyIndex]}"`);
    object = parsedObject.entity;
  }
  const arity = ruleWord(property.name)?.arity ?? 1;
  if (arity === 2 && !object && property.name !== 'bashing') throw new Error(`${context}: relational property "${property.name}" needs an object`);
  if (arity === 1 && object) throw new Error(`${context}: unary property "${property.name}" cannot have an object`);
  return { kind: 'state', subject, property, ...(object ? { object } : {}) };
}

function stripOuterGrouping(text: string): string {
  let source = text.trim();
  while (source.startsWith('(') && source.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') depth -= 1;
      if (depth === 0 && index < source.length - 1) { wraps = false; break; }
      if (depth < 0) throw new Error('rule condition: unmatched closing parenthesis');
    }
    if (depth !== 0) throw new Error('rule condition: unmatched opening parenthesis');
    if (!wraps) break;
    source = source.slice(1, -1).trim();
  }
  return source;
}

function splitBoolean(text: string, operator: '&' | '|'): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    if (depth < 0) throw new Error('rule condition: unmatched closing parenthesis');
    if (depth === 0 && text.slice(index, index + 3) === ` ${operator} `) {
      parts.push(text.slice(start, index).trim());
      start = index + 3;
      index += 2;
    }
  }
  if (depth !== 0) throw new Error('rule condition: unmatched opening parenthesis');
  if (!parts.length) return undefined;
  parts.push(text.slice(start).trim());
  if (parts.some(part => !part)) throw new Error(`rule condition: ${operator} needs conditions on both sides`);
  return parts;
}

export function parseObservableCondition(text: string, context = 'rule condition'): RuleObservableCondition {
  const grouped = stripOuterGrouping(text);
  if (/(?:^|\s)[&|]$/.test(grouped) || /^[&|](?:\s|$)/.test(grouped)) {
    throw new Error(`${context}: Boolean operator needs conditions on both sides`);
  }
  const alternatives = splitBoolean(grouped, '|');
  if (alternatives) return { kind: 'boolean', operator: 'or', conditions: alternatives.map((part, index) => parseObservableCondition(part, `${context} alternative ${index + 1}`)) };
  const conjunctions = splitBoolean(grouped, '&');
  if (conjunctions) return { kind: 'boolean', operator: 'and', conditions: conjunctions.map((part, index) => parseObservableCondition(part, `${context} conjunction ${index + 1}`)) };
  if (grouped.startsWith('!')) {
    const operand = grouped.slice(1).trim();
    if (!operand) throw new Error(`${context}: ! needs a condition`);
    return { kind: 'boolean', operator: 'not', conditions: [parseObservableCondition(operand, `${context} negation`)] };
  }
  const source = grouped;
  const intervalMatch = source.match(/\s+(during-this-turn|during-last-turn|since-beginning)$/);
  if (intervalMatch) {
    const eventText = source.slice(0, -intervalMatch[0].length).trim();
    const event = parseRulePhrase(eventText, `${context} historical event`, false, true);
    if (phraseHasSelector(event, 'all')) throw new Error(`${context}: all is invalid in a historical condition`);
    return { kind: 'history', event, interval: intervalMatch[1] as RuleHistoryInterval };
  }
  const state = parseRuleState(source, context);
  const definition = ruleWord(state.property.name);
  if (!definition?.observable) throw new Error(`${context}: property "${state.property.name}" is not observable`);
  return state;
}

function entityHasSelector(entity: RuleEntity | undefined, selector: RuleSelector): boolean {
  if (!entity) return false;
  if (entity.kind === 'descriptor' || entity.kind === 'query') return entity.selector === selector;
  if (entity.kind === 'directed') return entityHasSelector(entity.reference, selector);
  return false;
}

function phraseHasSelector(phrase: RulePhrase, selector: RuleSelector): boolean {
  return entityHasSelector(phrase.subject, selector) || entityHasSelector(phrase.object, selector);
}

function validateContribution(state: RuleState, context: string): void {
  const definition = state.property.action ? ruleWord('up-action') : ruleWord(state.property.name);
  if (!definition?.contributable) {
    throw new Error(`${context}: property "${state.property.name}" is observable but not contributable`);
  }
}

function parseLifetime(text: string, context: string): { stateText: string; lifetime: RuleLifetime } | undefined {
  if (text.endsWith(' permanent')) return { stateText: text.slice(0, -' permanent'.length).trim(), lifetime: { kind: 'permanent' } };
  for (const operator of [' removed-after ', ' until '] as const) {
    const index = text.indexOf(operator);
    if (index >= 0) {
      const eventText = text.slice(index + operator.length).trim();
      if (!eventText) throw new Error(`${context}: ${operator.trim()} needs an event`);
      return {
        stateText: text.slice(0, index).trim(),
        lifetime: { kind: operator.includes('removed') ? 'removed-after' : 'until', event: parseRuleCondition(eventText, `${context} lifetime`) }
      };
    }
  }
  return undefined;
}

function parseTriggeredConsequence(text: string, context: string): RuleTriggeredConsequence {
  const lifetime = parseLifetime(text, context);
  if (lifetime) {
    if (lifetime.stateText.includes(' have ')) {
      const distributed = parseHaveRule(lifetime.stateText, `${context} distribution`);
      if (distributed.attachment.kind !== 'state') throw new Error(`${context}: a triggered have consequence cannot be nested`);
      return { kind: 'distributed-state', selector: distributed.selector, state: distributed.attachment, lifetime: lifetime.lifetime };
    }
    const state = parseRuleState(lifetime.stateText, `${context} state`);
    validateContribution(state, context);
    return { kind: 'stored-state', state, lifetime: lifetime.lifetime };
  }
  try {
    const bareState = parseRuleState(text, `${context} state`);
    if ((bareState.property.action ? ruleWord('up-action') : ruleWord(bareState.property.name))?.contributable) {
      return { kind: 'stored-state', state: bareState, lifetime: { kind: 'permanent' } };
    }
  } catch { /* It may instead be an action consequence. */ }
  try {
    return { kind: 'event', event: parseRulePhrase(text, `${context} event`, true) };
  } catch (eventError) {
    try {
      const state = parseRuleState(text, `${context} state`);
      if (ruleWord(state.property.name)?.contributable) return { kind: 'stored-state', state, lifetime: { kind: 'permanent' } };
    } catch { /* Preserve the more useful action parse failure below. */ }
    throw eventError;
  }
}

function ruleSeparator(text: string): number {
  const match = /\s:\s/.exec(text);
  return match?.index ?? -1;
}

function containsEventBinding(value: RuleEntity | RuleState): boolean {
  const entityContains = (entity: RuleEntity | undefined): boolean => {
    if (!entity) return false;
    if (entity.kind === 'reference') return entity.reference === 'subj' || entity.reference === 'obj';
    if (entity.kind === 'directed') return entityContains(entity.reference) || entityContains(entity.filter);
    return false;
  };
  return value.kind === 'state' ? entityContains(value.subject) || entityContains(value.object) : entityContains(value);
}

function eventReferencesInEntity(entity: RuleEntity | undefined, found = new Set<'subj' | 'obj'>()): Set<'subj' | 'obj'> {
  if (!entity) return found;
  if (entity.kind === 'reference' && entity.reference !== 'self') found.add(entity.reference);
  if (entity.kind === 'directed') {
    eventReferencesInEntity(entity.reference, found);
    if (entity.filter) eventReferencesInEntity(entity.filter, found);
  }
  return found;
}

function eventReferencesInCondition(condition: RuleCondition, found = new Set<'subj' | 'obj'>()): Set<'subj' | 'obj'> {
  if (condition.kind === 'phase') return found;
  eventReferencesInEntity(condition.subject, found);
  eventReferencesInEntity(condition.object, found);
  return found;
}

function validateConsequenceBindings(rule: ParsedTriggerRule, context: string): void {
  const available = new Set<'subj' | 'obj'>();
  if (rule.anchor.kind === 'relation') {
    available.add('subj');
    if (rule.anchor.object) available.add('obj');
  }
  const requireAvailable = (references: ReadonlySet<'subj' | 'obj'>): void => {
    for (const reference of references) {
      if (!available.has(reference)) throw new Error(`${context}: ${reference} is not bound by this trigger anchor`);
    }
  };
  for (const consequence of rule.consequences) {
    if (consequence.kind === 'event') {
      requireAvailable(eventReferencesInCondition(consequence.event));
      continue;
    }
    requireAvailable(eventReferencesInEntity(consequence.state.subject));
    requireAvailable(eventReferencesInEntity(consequence.state.object));
    if (consequence.lifetime.kind !== 'permanent') requireAvailable(eventReferencesInCondition(consequence.lifetime.event));
  }
}

function parseSetSelector(text: string, context: string): RuleSetSelector {
  try {
    const state = parseRuleState(text, context);
    const definition = ruleWord(state.property.name);
    if (!definition?.observable) throw new Error(`${context}: selector property "${state.property.name}" is not observable`);
    return state;
  } catch (stateError) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const parsed = parseSubsetWords(words, 0, context);
    if (parsed.next !== words.length) throw stateError;
    if (parsed.entity.kind === 'wildcard') throw new Error(`${context}: _ is not a standalone or have selector`);
    return parsed.entity;
  }
}

function parseHaveRule(text: string, context: string): ParsedHaveRule {
  const index = text.indexOf(' have ');
  if (index < 0) throw new Error(`${context}: expected " have "`);
  const selectorText = text.slice(0, index).trim();
  const attachmentText = text.slice(index + ' have '.length).trim();
  if (!selectorText || !attachmentText) throw new Error(`${context}: have needs a selector and an attached phrase`);
  const selector = parseSetSelector(selectorText, `${context} selector`);
  if (containsEventBinding(selector)) throw new Error(`${context}: subj and obj are forbidden inside have rules`);
  const attachment = attachmentText.includes(' have ')
    ? parseHaveRule(attachmentText, `${context} attachment`)
    : parseRuleState(attachmentText, `${context} attachment`);
  if (attachment.kind === 'state') {
    validateContribution(attachment, `${context} attachment`);
    if (containsEventBinding(attachment)) throw new Error(`${context}: subj and obj are forbidden inside have rules`);
    if (attachment.subject.kind !== 'reference' || attachment.subject.reference !== 'self') {
      throw new Error(`${context}: an attached state must target the selected self`);
    }
  }
  return { kind: 'have', selector, attachment };
}

export function parseRule(text: string, context = 'rule'): ParsedRule {
  const source = text.trim();
  const separator = ruleSeparator(source);
  const whileIndex = source.indexOf(' while ');
  if (separator < 0 && source.includes(' have ')) return parseHaveRule(source, context);
  if (separator < 0 && whileIndex >= 0) {
    const contribution = parseRuleState(source.slice(0, whileIndex), `${context} contribution`);
    validateContribution(contribution, `${context} contribution`);
    return {
      kind: 'continuous', contribution,
      condition: parseObservableCondition(source.slice(whileIndex + ' while '.length), `${context} while condition`)
    };
  }
  if (separator < 0) throw new Error(`${context}: expected " : " for a trigger or " while " for a continuous rule`);
  const left = source.slice(0, separator).trim();
  const right = source.slice(separator + 3).trim();
  const ifIndex = left.indexOf(' if ');
  const anchorText = ifIndex < 0 ? left : left.slice(0, ifIndex).trim();
  const guardText = ifIndex < 0 ? undefined : left.slice(ifIndex + ' if '.length).trim();
  if (!anchorText || !right) throw new Error(`${context}: trigger needs an anchor and a consequence`);
  if (/^(any|none|all)(?:\s|-)/.test(anchorText)) {
    throw new Error(`${context}: event anchors match singular operands and cannot start with Boolean any, none, or all`);
  }
  const anchor = parseRuleCondition(anchorText, `${context} anchor`);
  if (anchor.kind === 'relation' && (phraseHasSelector(anchor, 'none') || phraseHasSelector(anchor, 'all'))) {
    throw new Error(`${context}: all/none quantified events are conditions, not concrete anchors`);
  }
  const rule: ParsedTriggerRule = {
    kind: 'trigger', anchor,
    ...(guardText ? { guard: parseObservableCondition(guardText, `${context} guard`) } : {}),
    consequences: splitConjunction(right).map((effect, index) => parseTriggeredConsequence(effect, `${context} consequence ${index + 1}`))
  };
  validateConsequenceBindings(rule, context);
  return rule;
}
