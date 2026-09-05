import { hexDistance, PLAYABLE_COORDINATES, regionAt, type Coordinate } from './board.js';
import { controlSummary, isUnitInactive, maximumHealth, unitId, type GameState, type UnitId, type UnitState } from './engine.js';
import { hasPassive, type TroopSeed } from './cards.js';
import type { Player } from './types.js';
import type {
  PackedRuleAction, RuleBoundReference, RuleCondition, RuleDescriptor,
  RuleDirectedSelection, RuleEntity, RuleFieldQuery, RuleHistoricalCondition,
  RuleObservableCondition, RulePhrase, RuleSetSelector, RuleState
} from './rule-parser.js';

export type RuleBinding =
  | { kind: 'unit'; unitId: UnitId }
  | { kind: 'hex'; coordinate: Coordinate };

export interface NormalizedEventRecord {
  id: number;
  name: string;
  stage: 'target' | 'resolved';
  subject?: RuleBinding;
  object?: RuleBinding;
  origin?: Coordinate;
  destination?: Coordinate;
  parameters: Array<number | undefined>;
  qualifiers: PackedRuleAction['qualifiers'];
  controller: Player;
  turn: number;
  success: boolean;
  canceled?: boolean;
  firstStrike?: {
    unitId: UnitId;
    targetId: UnitId;
    firstDamage: number;
    retaliationDamage: number;
    targetSurvived: boolean;
  };
}

export interface RuleEvaluationContext {
  state: GameState;
  cards: ReadonlyMap<string, TroopSeed>;
  controller: Player;
  self: RuleBinding;
  subj?: RuleBinding;
  obj?: RuleBinding;
  /** Current phrase subject, used by relative directions. */
  phraseSubject?: Coordinate;
  history?: readonly NormalizedEventRecord[];
  currentTurn?: number;
  previousTurn?: number;
  pendingActions?: ReadonlyArray<{ name: string; subject: RuleBinding; object?: RuleBinding }>;
  legalActions?: ReadonlyArray<{ name: string; subject: RuleBinding; object?: RuleBinding }>;
}

export type RuleEvaluationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'missing-binding' | 'nonsingular' | 'invalid-reference' | 'invalid-query'; message: string };

const ok = <T>(value: T): RuleEvaluationResult<T> => ({ ok: true, value });
const fail = <T>(code: Exclude<RuleEvaluationResult<T>, { ok: true }>['code'], message: string): RuleEvaluationResult<T> => ({ ok: false, code, message });
const opponent = (player: Player): Player => player === 1 ? 2 : 1;

function findUnit(state: GameState, id: UnitId): UnitState | undefined {
  return state.units.find(unit => unitId(unit) === id);
}

function coordinateOf(binding: RuleBinding, context: RuleEvaluationContext): Coordinate | undefined {
  return binding.kind === 'hex' ? binding.coordinate : findUnit(context.state, binding.unitId)?.coordinate;
}

function binding(context: RuleEvaluationContext, reference: RuleBoundReference['reference']): RuleBinding | undefined {
  return reference === 'self' ? context.self : reference === 'subj' ? context.subj : context.obj;
}

/** Pending Bash attackers are projected at the contested hex for semantic queries. */
function occupantsAt(context: RuleEvaluationContext, coordinate: Coordinate): UnitState[] {
  const bash = context.state.bashes.find(item => item.target === coordinate);
  const bashIds = new Set(bash ? [bash.attackerId, bash.defenderId] : []);
  return context.state.units.filter(unit => bashIds.has(unitId(unit)) || (!context.state.bashes.some(item => item.attackerId === unitId(unit)) && unit.coordinate === coordinate));
}

function descriptorMatches(descriptor: RuleDescriptor, coordinate: Coordinate, context: RuleEvaluationContext): boolean {
  const occupants = occupantsAt(context, coordinate);
  const unitMatches = descriptor.units.every(predicate => {
    const matches = occupants.some(unit => {
      const card = context.cards.get(unit.troopId);
      const bash = context.state.bashes.find(item => item.target === coordinate && (item.attackerId === unitId(unit) || item.defenderId === unitId(unit)));
      switch (predicate.attribute) {
        case 'enemy': return unit.owner === opponent(context.controller);
        case 'friend': return unit.owner === context.controller;
        case 'active': return !isUnitInactive(context.state, unit);
        case 'wounded': return unit.permanentDamage > 0;
        case 'shielded': return (unit.shields?.length ?? 0) > 0;
        case 'mshielded': return (unit.magicModifierBonus ?? 0) > 0;
        case 'bashing': return Boolean(bash);
        case 'bashed': return Boolean(bash && bash.defenderId === unitId(unit));
        case 'deployed': return true;
        case 'first-strike': case 'obsidian': case 'titanium': case 'steady': return hasPassive(card, predicate.attribute);
      }
    });
    return predicate.negated ? !matches : matches;
  });
  if (!unitMatches) return false;
  const region = regionAt(coordinate);
  const needsControl = descriptor.regions.some(predicate => ['econtrol', 'fcontrol', 'ncontrol'].includes(predicate.attribute));
  const control = needsControl && region ? controlSummary(context.state, context.cards)[region.id]?.controller : undefined;
  const regionMatches = descriptor.regions.every(predicate => {
    const matches = predicate.attribute === 'adj' ? Boolean(context.phraseSubject && hexDistance(context.phraseSubject, coordinate) === 1)
      : predicate.attribute === 'str' ? region?.type === 'starting'
      : predicate.attribute === 'int' ? region?.type === 'intermediate'
      : predicate.attribute === 'front' ? region?.type === 'front'
      : predicate.attribute === 'econtrol' ? control === opponent(context.controller)
      : predicate.attribute === 'fcontrol' ? control === context.controller
      : predicate.attribute === 'ncontrol' ? control === undefined
      : predicate.attribute === 'empty' ? occupants.length === 0
      : predicate.attribute === 'eside' ? region?.home === opponent(context.controller)
      : region?.home === context.controller;
    return predicate.negated ? !matches : matches;
  });
  if (!regionMatches) return false;
  return descriptor.types.every(predicate => {
    const matches = predicate.attribute === 'bomboff' ? Boolean(context.state.bombs?.some(bomb => bomb.coordinate === coordinate))
      : predicate.attribute === 'bombon' ? Boolean(context.state.effects.some(effect => effect.kind === 'bomb' && effect.origin === coordinate))
      : occupants.some(unit => context.cards.get(unit.troopId)?.role === predicate.attribute);
    return predicate.negated ? !matches : matches;
  });
}

function queryMatches(query: RuleFieldQuery, coordinate: Coordinate, context: RuleEvaluationContext): boolean {
  const occupants = occupantsAt(context, coordinate);
  const owners = new Set(occupants.map(unit => unit.owner));
  const inertBomb = context.state.bombs?.some(bomb => bomb.coordinate === coordinate) ?? false;
  const litBomb = context.state.effects.some(effect => effect.kind === 'bomb' && effect.origin === coordinate);
  const region = regionAt(coordinate);
  const control = query.control && region ? controlSummary(context.state, context.cards)[region.id]?.controller : undefined;
  if (query.owner === 'you' && !owners.has(context.controller)) return false;
  if (query.owner === 'opp' && !owners.has(opponent(context.controller))) return false;
  if (query.owner === 'none' && owners.size) return false;
  if (query.owner === 'both' && !(owners.has(1) && owners.has(2))) return false;
  if (query.excludedOwner === 'you' && owners.has(context.controller)) return false;
  if (query.excludedOwner === 'opp' && owners.has(opponent(context.controller))) return false;
  if (query.bomb === 'bomb-off' && !inertBomb || query.bomb === 'bomb-on' && !litBomb || query.bomb === 'none' && (inertBomb || litBomb) || query.bomb === 'bomb' && !(inertBomb || litBomb)) return false;
  if (query.region && region?.type !== ({ str: 'starting', int: 'intermediate', front: 'front' } as const)[query.region]) return false;
  if (query.control === 'you' && control !== context.controller || query.control === 'opp' && control !== opponent(context.controller) || query.control === 'none' && control !== undefined) return false;
  if (query.side === 'you' && region?.home !== context.controller || query.side === 'opp' && region?.home !== opponent(context.controller)) return false;
  if (query.entityType && !occupants.some(unit => context.cards.get(unit.troopId)?.role === query.entityType)) return false;
  return true;
}

function directedMatches(selection: RuleDirectedSelection, coordinate: Coordinate, reference: Coordinate, subject: Coordinate): boolean {
  if (selection.direction === 'range-from') return hexDistance(coordinate, reference) === selection.distance;
  if (selection.distance !== undefined && hexDistance(coordinate, subject) !== selection.distance) return false;
  const candidateDistance = hexDistance(coordinate, reference);
  const subjectDistance = hexDistance(subject, reference);
  return selection.direction === 'away-from' ? candidateDistance > subjectDistance
    : selection.direction === 'towards' ? candidateDistance < subjectDistance
    : candidateDistance === subjectDistance;
}

export function selectRuleHexes(entity: RuleEntity, context: RuleEvaluationContext): RuleEvaluationResult<Coordinate[]> {
  if (entity.kind === 'wildcard') return ok([...PLAYABLE_COORDINATES]);
  if (entity.kind === 'reference') {
    const found = binding(context, entity.reference);
    if (!found) return fail('missing-binding', `Missing ${entity.reference} binding.`);
    const coordinate = coordinateOf(found, context);
    return coordinate ? ok([coordinate]) : fail('invalid-reference', `${entity.reference} no longer resolves to a board hex.`);
  }
  if (entity.kind === 'directed') {
    const references = selectRuleHexes(entity.reference, context);
    if (!references.ok) return references;
    if (references.value.length !== 1) return fail('nonsingular', 'A directed reference must resolve to exactly one hex.');
    const subject = context.phraseSubject ?? coordinateOf(context.self, context);
    if (!subject) return fail('missing-binding', 'A directed selection needs a phrase subject.');
    return ok(PLAYABLE_COORDINATES.filter(coordinate => directedMatches(entity, coordinate, references.value[0], subject)
      && (!entity.filter || queryMatches(entity.filter, coordinate, context))));
  }
  const selected = PLAYABLE_COORDINATES.filter(coordinate => entity.kind === 'query' ? queryMatches(entity, coordinate, context) : descriptorMatches(entity, coordinate, context));
  if (entity.selector === 'any') return ok(selected);
  return ok(selected);
}

function selectedUnits(entity: RuleEntity, context: RuleEvaluationContext): RuleEvaluationResult<UnitState[]> {
  if (entity.kind === 'reference') {
    const found = binding(context, entity.reference);
    if (!found) return fail('missing-binding', `Missing ${entity.reference} binding.`);
    if (found.kind !== 'unit') return fail('invalid-reference', `${entity.reference} is a hex, not a unit.`);
    const unit = findUnit(context.state, found.unitId);
    return unit ? ok([unit]) : ok([]);
  }
  const hexes = selectRuleHexes(entity, context);
  return hexes.ok ? ok(hexes.value.flatMap(hex => occupantsAt(context, hex))) : hexes;
}

/** Enumerate the concrete unit bindings produced by a canonical selector. */
export function selectRuleUnits(selector: RuleSetSelector, context: RuleEvaluationContext): RuleEvaluationResult<UnitState[]> {
  if (selector.kind !== 'state') return selectedUnits(selector, context);
  const units = selectedUnits(selector.subject, context);
  if (!units.ok) return units;
  const objectHexes = selector.object ? selectRuleHexes(selector.object, context) : ok<Coordinate[]>([]);
  if (!objectHexes.ok) return objectHexes;
  return ok(units.value.filter(unit => stateMatchesUnit(selector, unit, objectHexes.value, context)));
}

function stateMatchesUnit(state: RuleState, unit: UnitState, objectHexes: readonly Coordinate[], context: RuleEvaluationContext): boolean {
  const card = context.cards.get(unit.troopId);
  const bash = context.state.bashes.find(item => item.attackerId === unitId(unit) || item.defenderId === unitId(unit));
  const relationMatches = (entries: RuleEvaluationContext['pendingActions'] | RuleEvaluationContext['legalActions'], name?: string): boolean => (entries ?? []).some(entry =>
    (!name || entry.name === name) && entry.subject.kind === 'unit' && entry.subject.unitId === unitId(unit)
    && (!state.object || entry.object && coordinateOf(entry.object, context) !== undefined && objectHexes.includes(coordinateOf(entry.object, context) as Coordinate)));
  switch (state.property.name) {
    case 'wounded': return unit.permanentDamage > 0;
    case 'deployed': return true;
    case 'defeated': return context.state.defeatedTroopIds?.includes(unit.troopId) ?? false;
    case 'undeployed': return !context.state.units.some(candidate => unitId(candidate) === unitId(unit));
    case 'active': return !isUnitInactive(context.state, unit);
    case 'shielded': return (unit.shields?.length ?? 0) > 0;
    case 'mshielded': return (unit.magicModifierBonus ?? 0) > 0;
    case 'shielded-by-ally': return (unit.shields ?? []).some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unitId(unit));
    case 'bashing': return Boolean(bash && (!state.object || objectHexes.includes(bash.target)));
    case 'bashed-by': return Boolean(bash && bash.defenderId === unitId(unit) && (!state.object || objectHexes.includes(bash.target)));
    case 'first-strike': case 'obsidian': case 'titanium': case 'steady': return hasPassive(card, state.property.name);
    case 'action-reachable': return relationMatches(context.legalActions);
    case 'action-reaches': return relationMatches(context.legalActions);
    default:
      if (state.property.name.startsWith('is-')) {
        const action = state.property.name.slice(3).replace(/-ing$/, '').replace('bow', 'bow').replace('fir', 'fire')
          .replace('mov', 'move').replace('fli', 'fly').replace('cannon', 'cannon').replace('pull', 'pull')
          .replace('push', 'push').replace('stunn', 'stun').replace('mend', 'mend').replace('shield', 'shield')
          .replace('mshield', 'mshield').replace('upgrad', 'upgrade').replace('light', 'light')
          .replace('bomb-throw', 'bomb-throw').replace('bomb-defus', 'bomb-defuse').replace('bomb-explod', 'bomb-explode')
          .replace('gore-mov', 'gore-move').replace('gore-attack', 'gore-attack');
        return relationMatches(context.pendingActions, action);
      }
      return false;
  }
}

export function evaluateRuleState(state: RuleState, context: RuleEvaluationContext): RuleEvaluationResult<boolean> {
  if (state.property.name === 'bomb-off' || state.property.name === 'bomb-on') {
    const selected = selectRuleHexes(state.subject, context);
    if (!selected.ok) return selected;
    const matches = selected.value.map(hex => state.property.name === 'bomb-off'
      ? context.state.bombs?.some(bomb => bomb.coordinate === hex) ?? false
      : context.state.effects.some(effect => effect.kind === 'bomb' && effect.origin === hex));
    const selector = state.subject.kind === 'descriptor' || state.subject.kind === 'query' ? state.subject.selector : 'any';
    return ok(selector === 'none' ? !matches.some(Boolean) : selector === 'all' ? matches.length > 0 && matches.every(Boolean) : matches.some(Boolean));
  }
  if ((state.property.name === 'defeated' || state.property.name === 'undeployed') && state.subject.kind === 'reference') {
    const selected = binding(context, state.subject.reference);
    if (!selected || selected.kind !== 'unit') return ok(false);
    const onBoard = Boolean(findUnit(context.state, selected.unitId));
    return ok(state.property.name === 'defeated' ? context.state.defeatedTroopIds?.includes(selected.unitId) ?? false : !onBoard);
  }
  const units = selectedUnits(state.subject, context);
  if (!units.ok) return units;
  const objectHexes = state.object ? selectRuleHexes(state.object, context) : ok<Coordinate[]>([]);
  if (!objectHexes.ok) return objectHexes;
  const matches = units.value.map(unit => stateMatchesUnit(state, unit, objectHexes.value, context));
  const selector = state.subject.kind === 'descriptor' || state.subject.kind === 'query' ? state.subject.selector : 'any';
  return ok(selector === 'none' ? !matches.some(Boolean) : selector === 'all' ? matches.length > 0 && matches.every(Boolean) : matches.some(Boolean));
}

function bindingMatches(pattern: RuleEntity | undefined, actual: RuleBinding | undefined, context: RuleEvaluationContext): boolean {
  if (!pattern) return actual === undefined;
  if (!actual) return false;
  if (pattern.kind === 'reference') {
    const expected = pattern.reference === 'self' ? context.self : pattern.reference === 'subj' ? context.subj : context.obj;
    if (!expected) return false;
    if (expected.kind === 'unit' && actual.kind === 'unit') return expected.unitId === actual.unitId;
    if (expected.kind === 'hex' && actual.kind === 'hex') return expected.coordinate === actual.coordinate;
    const expectedCoordinate = coordinateOf(expected, context);
    const actualCoordinate = coordinateOf(actual, context);
    return Boolean(expectedCoordinate && expectedCoordinate === actualCoordinate);
  }
  const actualCoordinate = coordinateOf(actual, context);
  if (!actualCoordinate) return false;
  const selected = selectRuleHexes(pattern, context);
  return selected.ok && selected.value.includes(actualCoordinate);
}

function eventMatches(pattern: RulePhrase, event: NormalizedEventRecord, context: RuleEvaluationContext): boolean {
  if (!event.success || event.canceled || event.name !== pattern.action.name) return false;
  if ((pattern.stage ?? 'target') !== event.stage) return false;
  if (pattern.action.parameters.length && pattern.action.parameters.some((value, index) => value !== undefined && value !== event.parameters[index])) return false;
  if (pattern.action.qualifiers.some(qualifier => !event.qualifiers.includes(qualifier))) return false;
  const endpointBinding: RuleBinding | undefined = pattern.endpoint === 'origin' && event.origin
    ? { kind: 'hex', coordinate: event.origin }
    : pattern.endpoint === 'destination' && event.destination
      ? { kind: 'hex', coordinate: event.destination }
      : event.object;
  return bindingMatches(pattern.subject, event.subject, context) && bindingMatches(pattern.object, endpointBinding, context);
}

export function evaluateHistoricalCondition(condition: RuleHistoricalCondition, context: RuleEvaluationContext): RuleEvaluationResult<boolean> {
  const currentTurn = context.currentTurn ?? context.state.turnNumber ?? 0;
  const previousTurn = context.previousTurn ?? currentTurn - 1;
  const events = (context.history ?? []).filter(event => condition.interval === 'since-beginning' || event.turn === (condition.interval === 'during-this-turn' ? currentTurn : previousTurn));
  const matched = events.some(event => eventMatches(condition.event, event, context));
  const none = condition.event.subject.kind === 'descriptor' || condition.event.subject.kind === 'query' ? condition.event.subject.selector === 'none' : false;
  return ok(none ? !matched : matched);
}

export function evaluateObservableCondition(condition: RuleObservableCondition, context: RuleEvaluationContext): RuleEvaluationResult<boolean> {
  if (condition.kind === 'history') return evaluateHistoricalCondition(condition, context);
  if (condition.kind === 'state') return evaluateRuleState(condition, context);
  const values: boolean[] = [];
  for (const child of condition.conditions) {
    const evaluated = evaluateObservableCondition(child, context);
    if (!evaluated.ok) return evaluated;
    values.push(evaluated.value);
  }
  return ok(condition.operator === 'not' ? !values[0] : condition.operator === 'and' ? values.every(Boolean) : values.some(Boolean));
}

export function matchRuleAnchor(anchor: RuleCondition, event: NormalizedEventRecord, context: RuleEvaluationContext): RuleEvaluationResult<boolean> {
  if (anchor.kind === 'phase') return ok(event.name === anchor.phase && event.stage === 'target' && event.success && !event.canceled);
  return ok(eventMatches(anchor, event, context));
}

export function unitCurrentLife(unit: UnitState, context: Pick<RuleEvaluationContext, 'cards'>): number {
  return Math.max(0, maximumHealth(unit, context.cards) - unit.permanentDamage);
}
