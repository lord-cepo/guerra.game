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

/** A reference or descriptor resolves to a board hex, never a unit/hex tuple. */
export type RuleHex = RuleDescriptor | RuleBoundReference;
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
  endpoint?: RuleEndpoint;
  object?: RuleEntity;
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
  parameters: Array<number | undefined>;
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

export type RuleObservableCondition = RuleState | RuleHistoricalCondition;

export type RuleLifetime =
  | { kind: 'permanent' }
  | { kind: 'until'; event: RuleCondition }
  | { kind: 'removed-after'; event: RuleCondition };

export type RuleTriggeredConsequence =
  | { kind: 'event'; event: RulePhrase }
  | { kind: 'stored-state'; state: RuleState; lifetime: RuleLifetime };

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

export type ParsedRule = ParsedTriggerRule | ParsedContinuousRule;

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
const noObjectVerbs = new Set(['die']);
const rangeOnlyActions = new Set(['light', 'defuse']);
const movementVerbs = new Set(['move', 'fly', 'gore']);
const ruleVerbs = new Set([
  'pass', 'move', 'fly', 'atk', 'attack', 'ranged', 'bow', 'cannon', 'gore', 'fire', 'defense', 'shield', 'mshield',
  'bomb', 'push', 'pull', 'stun', 'mend', 'mending', 'upgrade', 'heal', 'damage', 'mod', 'mods', 'life',
  'maxlife', 'revive', 'act', 'wound', 'hit', 'target', 'die', 'deploy', 'light', 'defuse', 'fires'
]);
const verbAliases: Readonly<Record<string, string>> = { fires: 'fire' };

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
  const name = verbAliases[match[1]] ?? match[1];
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

function looksLikeEntity(text: string): boolean {
  try {
    parseRuleEntity(text, 'rule phrase entity');
    return true;
  } catch {
    return false;
  }
}

function validateRuleAction(action: PackedRuleAction, context: string): void {
  const movement = action.name.match(/^(move|fly|gore)-(from|to)$/);
  const verb = movement?.[1] ?? action.name;
  if ((action.name.endsWith('-from') || action.name.endsWith('-to')) && (!movement || !movementVerbs.has(verb))) {
    throw new Error(`${context}: only move, fly, and gore support -from/-to`);
  }
  const definition = ruleWord(verb);
  if (!ruleVerbs.has(verb) && definition?.kind !== 'verb') {
    const ambiguity = ambiguousRuleWords[verb];
    throw new Error(ambiguity ? `${context}: ambiguous verb "${verb}": ${ambiguity}` : `${context}: unknown verb "${action.name}"`);
  }
  if (rangeOnlyActions.has(verb) && action.parameters.length > 1) {
    throw new Error(`${context}: action "${verb}" accepts only its range parameter`);
  }
}

function parseRulePhrase(text: string, context: string, defaultObjectToSelf: boolean): RulePhrase {
  const source = text.trim();
  const words = source ? source.split(/\s+/) : [];
  if (!words.length || words.length > 3) {
    throw new Error(`${context}: expected "[subject] action [object]", received "${text}"`);
  }

  let index = 0;
  let subject: RuleEntity = { kind: 'reference', reference: 'self' };
  if (looksLikeEntity(words[0])) {
    subject = parseRuleEntity(words[0], `${context} subject`);
    index += 1;
  }
  if (!words[index]) throw new Error(`${context}: missing action`);

  const rawAction = parseRuleActionToken(words[index], `${context} action`);
  index += 1;
  const movement = rawAction.name.match(/^(move|fly|gore)-(from|to)$/);
  const actionName = movement?.[1] ?? rawAction.name;
  const action = movement ? { ...rawAction, name: actionName } : rawAction;
  validateRuleAction(rawAction, `${context} action`);
  const endpoint: RuleEndpoint | undefined = movement?.[2] === 'from' ? 'origin' : movement?.[2] === 'to' ? 'destination' : undefined;
  const verb = movement?.[1] ?? rawAction.name;

  let object: RuleEntity | undefined;
  if (words[index]) {
    object = parseRuleEntity(words[index], `${context} object`);
    index += 1;
  } else if (defaultObjectToSelf && !noObjectVerbs.has(verb)) {
    object = { kind: 'reference', reference: 'self' };
  }
  if (words[index]) throw new Error(`${context}: expected "[subject] action [object]", received "${text}"`);
  if (noObjectVerbs.has(verb) && object) {
    throw new Error(`${context}: unary verb "${verb}" cannot have an object`);
  }
  if (!defaultObjectToSelf && !noObjectVerbs.has(verb) && !object) {
    throw new Error(`${context}: verb "${verb}" needs an object`);
  }
  return {
    kind: 'relation',
    subject,
    action,
    ...(endpoint ? { endpoint } : {}),
    ...(object ? { object } : {})
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
  const actionUpgrade = text.match(/^up\.([a-z][a-z-]*)\(([^)]*)\)$/);
  const parsed = parseRuleActionToken(actionUpgrade ? `up(${actionUpgrade[2]})` : text, context);
  const name = actionUpgrade ? 'up' : canonicalRuleWord(parsed.name);
  const definition = ruleWord(name);
  if (definition?.kind !== 'property') {
    const ambiguity = ambiguousRuleWords[name];
    throw new Error(ambiguity ? `${context}: ambiguous property "${name}": ${ambiguity}` : `${context}: unknown property "${name}"`);
  }
  return { name, parameters: parsed.parameters, ...(actionUpgrade ? { action: actionUpgrade[1] } : {}) };
}

export function parseRuleState(text: string, context = 'rule state'): RuleState {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) throw new Error(`${context}: expected "[subject] property [object]"`);
  let subject: RuleEntity = { kind: 'reference', reference: 'self' };
  let propertyIndex = 0;
  if (words.length > 1 && looksLikeEntity(words[0])) {
    subject = parseRuleEntity(words[0], `${context} subject`);
    propertyIndex = 1;
  }
  const property = parseStateProperty(words[propertyIndex], `${context} property`);
  const objectText = words[propertyIndex + 1];
  const object = objectText ? parseRuleEntity(objectText, `${context} object`) : undefined;
  const arity = ruleWord(property.name)?.arity ?? 1;
  if (arity === 2 && !object) throw new Error(`${context}: relational property "${property.name}" needs an object`);
  if (arity === 1 && object) throw new Error(`${context}: unary property "${property.name}" cannot have an object`);
  return { kind: 'state', subject, property, ...(object ? { object } : {}) };
}

export function parseObservableCondition(text: string, context = 'rule condition'): RuleObservableCondition {
  const source = text.trim();
  const intervalMatch = source.match(/\s+(during-this-turn|during-last-turn|since-beginning)$/);
  if (intervalMatch) {
    const eventText = source.slice(0, -intervalMatch[0].length).trim();
    const event = parseRulePhrase(eventText, `${context} historical event`, false);
    return { kind: 'history', event, interval: intervalMatch[1] as RuleHistoryInterval };
  }
  const state = parseRuleState(source, context);
  const definition = ruleWord(state.property.name);
  if (!definition?.observable) throw new Error(`${context}: property "${state.property.name}" is not observable`);
  return state;
}

function validateContribution(state: RuleState, context: string): void {
  if (!ruleWord(state.property.name)?.contributable) {
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
    const state = parseRuleState(lifetime.stateText, `${context} state`);
    validateContribution(state, context);
    return { kind: 'stored-state', state, lifetime: lifetime.lifetime };
  }
  try {
    const bareState = parseRuleState(text, `${context} state`);
    if (ruleWord(bareState.property.name)?.contributable) {
      throw new Error(`${context}: triggered state "${bareState.property.name}" needs permanent, until, or removed-after`);
    }
  } catch (stateError) {
    if (stateError instanceof Error && stateError.message.includes('needs permanent')) throw stateError;
  }
  try {
    return { kind: 'event', event: parseRulePhrase(text, `${context} event`, true) };
  } catch (eventError) {
    try {
      const state = parseRuleState(text, `${context} state`);
      if (ruleWord(state.property.name)?.contributable) throw new Error(`${context}: triggered state "${state.property.name}" needs permanent, until, or removed-after`);
    } catch (stateError) {
      if (stateError instanceof Error && stateError.message.includes('needs permanent')) throw stateError;
    }
    throw eventError;
  }
}

function ruleSeparator(text: string): number {
  const match = /\s:\s/.exec(text);
  return match?.index ?? -1;
}

export function parseRule(text: string, context = 'rule'): ParsedRule {
  const source = text.trim();
  const separator = ruleSeparator(source);
  const whileIndex = source.indexOf(' while ');
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
  const anchor = parseRuleCondition(anchorText, `${context} anchor`);
  if (anchor.kind === 'relation' && anchor.subject.kind === 'descriptor' && anchor.subject.selector === 'none') {
    throw new Error(`${context}: a none-quantified event is historical, not an anchor`);
  }
  return {
    kind: 'trigger', anchor,
    ...(guardText ? { guard: parseObservableCondition(guardText, `${context} guard`) } : {}),
    consequences: splitConjunction(right).map((effect, index) => parseTriggeredConsequence(effect, `${context} consequence ${index + 1}`))
  };
}
