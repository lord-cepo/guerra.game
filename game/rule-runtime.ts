import { unitId, type GameState, type UnitId, type UnitState } from './engine.js';
import { evaluateObservableCondition, matchRuleAnchor, selectRuleHexes, selectRuleUnits, type NormalizedEventRecord, type RuleBinding, type RuleEvaluationContext, type RuleEvaluationResult } from './rule-evaluator.js';
import { cleanupStoredContributions, createStoredContributions } from './rule-state.js';
import type { ParsedRule, ParsedTriggerRule, RuleEntity, RulePhrase, RuleTriggeredConsequence } from './rule-parser.js';
import type { TroopSeed } from './cards.js';
import type { Player } from './types.js';

export interface RuntimeRuleSource {
  id: string;
  sourceUnitId: UnitId;
  /** Last known source state lets leave-play triggers resolve after removal. */
  sourceSnapshot?: UnitState;
  rule: ParsedRule;
}

export interface NormalizedActionIntent {
  name: string;
  subject?: RuleBinding;
  object?: RuleBinding;
  origin?: string;
  target?: string;
  parameters: Array<number | undefined>;
  qualifiers: RulePhrase['action']['qualifiers'];
  controller: Player;
  causedByRuleId?: string;
  mandatory?: true;
}

export interface NormalizedApplyResult {
  success: boolean;
  canceled?: boolean;
  reason?: string;
}

export interface RuleRuntimeHooks {
  mode?(intent: NormalizedActionIntent): 'immediate' | 'deferred';
  /** Validate and mutate authoritative state for one already-materialized action. */
  apply(
    intent: NormalizedActionIntent,
    state: GameState,
    /** Call at the mutation boundary when the hook also advances phases/turns. */
    eventResolved?: (state: GameState) => void
  ): NormalizedApplyResult;
  /** Materialize an engine-native state representation when one is required for parity/presentation. */
  materializeState?(
    source: RuntimeRuleSource,
    consequence: Extract<RuleTriggeredConsequence, { kind: 'stored-state' }>,
    event: NormalizedEventRecord,
    state: GameState
  ): NormalizedApplyResult | undefined;
}

export interface PendingRuleChoice {
  ruleId: string;
  consequenceIndex: number;
  operand: 'subject' | 'object';
  legalHexes: string[];
}

export interface RuleRuntimeResult {
  event?: NormalizedEventRecord;
  resolved?: NormalizedEventRecord;
  presentationEvents: NormalizedEventRecord[];
  pendingChoice?: PendingRuleChoice;
  canceled?: boolean;
  reason?: string;
}

function nextEventId(state: GameState): number {
  return (state.normalizedEvents?.at(-1)?.id ?? 0) + 1;
}

function contextFor(state: GameState, cards: ReadonlyMap<string, TroopSeed>, controller: Player, self: RuleBinding, event?: NormalizedEventRecord): RuleEvaluationContext {
  return {
    state, cards, controller, self,
    ...(event?.subject ? { subj: event.subject } : {}),
    ...(event?.object ? { obj: event.object } : {}),
    history: state.normalizedEvents,
    currentTurn: state.turnNumber ?? 0
  };
}

function bindingForEntity(entity: RuleEntity, context: RuleEvaluationContext): RuleEvaluationResult<RuleBinding[]> {
  if (entity.kind === 'reference') {
    const value = entity.reference === 'self' ? context.self : entity.reference === 'subj' ? context.subj : context.obj;
    return value ? { ok: true, value: [value] } : { ok: false, code: 'missing-binding', message: `Missing ${entity.reference} binding.` };
  }
  const selected = selectRuleHexes(entity, context);
  if (!selected.ok) return selected;
  return { ok: true, value: selected.value.map(coordinate => {
    const units = context.state.units.filter(unit => unit.coordinate === coordinate);
    return units.length === 1 ? { kind: 'unit', unitId: unitId(units[0]) } : { kind: 'hex', coordinate };
  }) };
}

function fixedCoordinate(binding: RuleBinding | undefined, state: GameState, source?: RuntimeRuleSource, event?: NormalizedEventRecord): string | undefined {
  if (!binding) return undefined;
  if (binding.kind === 'hex') return binding.coordinate;
  return state.units.find(unit => unitId(unit) === binding.unitId)?.coordinate
    ?? (binding.unitId === source?.sourceUnitId ? source.sourceSnapshot?.coordinate : undefined)
    ?? (event?.subject?.kind === 'unit' && binding.unitId === event.subject.unitId ? event.origin : undefined);
}

function materializeEvent(
  phrase: RulePhrase,
  context: RuleEvaluationContext,
  source: RuntimeRuleSource,
  consequenceIndex: number,
  event: NormalizedEventRecord
): RuleEvaluationResult<{ intents?: NormalizedActionIntent[]; pendingChoice?: PendingRuleChoice }> {
  const subjects = bindingForEntity(phrase.subject, context);
  if (!subjects.ok) return subjects;
  const objects = phrase.object ? bindingForEntity(phrase.object, { ...context, phraseSubject: fixedCoordinate(subjects.value[0], context.state, source, event) as never }) : { ok: true as const, value: [] };
  if (!objects.ok) return objects;
  if (subjects.value.length !== 1) return { ok: true, value: { pendingChoice: { ruleId: source.id, consequenceIndex, operand: 'subject', legalHexes: subjects.value.map(item => fixedCoordinate(item, context.state, source, event)).filter((item): item is string => Boolean(item)) } } };
  if (phrase.object && phrase.targetPolicy !== 'all' && objects.value.length === 0) return { ok: true, value: { intents: [] } };
  if (phrase.object && phrase.targetPolicy !== 'all' && objects.value.length > 1) return { ok: true, value: { pendingChoice: { ruleId: source.id, consequenceIndex, operand: 'object', legalHexes: objects.value.map(item => fixedCoordinate(item, context.state, source, event)).filter((item): item is string => Boolean(item)) } } };
  const subject = subjects.value[0];
  const selectedObjects = phrase.object ? objects.value : [undefined];
  return { ok: true, value: { intents: selectedObjects.map(object => ({
    name: phrase.action.name, subject, ...(object ? { object } : {}),
    origin: fixedCoordinate(subject, context.state, source, event), target: fixedCoordinate(object, context.state, source, event),
    parameters: [...phrase.action.parameters], qualifiers: [...phrase.action.qualifiers], controller: context.controller,
    causedByRuleId: source.id,
    ...(phrase.mandatory ? { mandatory: true as const } : {})
  })) } };
}

function matchingRules(rules: readonly RuntimeRuleSource[], event: NormalizedEventRecord, state: GameState, cards: ReadonlyMap<string, TroopSeed>): Array<{ source: RuntimeRuleSource; context: RuleEvaluationContext }> {
  const matched: Array<{ source: RuntimeRuleSource; context: RuleEvaluationContext }> = [];
  for (const source of rules) {
    if (source.rule.kind !== 'trigger') continue;
    const unit = state.units.find(candidate => unitId(candidate) === source.sourceUnitId) ?? source.sourceSnapshot;
    if (!unit) continue;
    if (source.rule.anchor.kind === 'phase') {
      const opponentPhase = source.rule.anchor.phase === 'opponent-start' || source.rule.anchor.phase === 'opponent-end';
      if (opponentPhase ? unit.owner === event.controller : unit.owner !== event.controller) continue;
    }
    const inactive = unit.inactiveOnTurn !== undefined || unit.inactiveUntilTurn !== undefined
      || state.lastActingTroopId?.[unit.owner] === unit.troopId;
    const deathAnchor = source.rule.anchor.kind === 'relation' && source.rule.anchor.action.name === 'die';
    if (inactive && !deathAnchor && source.rule.consequences.some(consequence => consequence.kind === 'event')) continue;
    const self: RuleBinding = { kind: 'unit', unitId: source.sourceUnitId };
    const context = contextFor(state, cards, unit.owner, self, event);
    const anchor = matchRuleAnchor(source.rule.anchor, event, context);
    if (!anchor.ok || !anchor.value) continue;
    const guard = source.rule.guard ? evaluateObservableCondition(source.rule.guard, context) : { ok: true as const, value: true };
    if (guard.ok && guard.value) matched.push({ source, context });
  }
  return matched;
}

function record(state: GameState, event: NormalizedEventRecord): void {
  (state.normalizedEvents ??= []).push(event);
}

function eventFromIntent(state: GameState, intent: NormalizedActionIntent, stage: 'target' | 'resolved', success: boolean, canceled = false): NormalizedEventRecord {
  return {
    id: nextEventId(state), name: intent.name, stage,
    ...(intent.subject ? { subject: intent.subject } : {}),
    ...(intent.object ? { object: intent.object } : {}),
    ...(intent.origin ? { origin: intent.origin as NormalizedEventRecord['origin'] } : {}),
    ...(intent.target ? { destination: intent.target as NormalizedEventRecord['destination'] } : {}),
    parameters: [...intent.parameters], qualifiers: [...intent.qualifiers], controller: intent.controller,
    turn: state.turnNumber ?? 0, success, ...(canceled ? { canceled: true } : {})
  };
}

function executeConsequence(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  source: RuntimeRuleSource,
  consequence: RuleTriggeredConsequence,
  consequenceIndex: number,
  event: NormalizedEventRecord,
  hooks: RuleRuntimeHooks,
  presentation: NormalizedEventRecord[]
): RuleRuntimeResult | undefined {
  const unit = state.units.find(candidate => unitId(candidate) === source.sourceUnitId) ?? source.sourceSnapshot;
  if (!unit) return undefined;
  const context = contextFor(state, cards, unit.owner, { kind: 'unit', unitId: source.sourceUnitId }, event);
  if (consequence.kind === 'distributed-state') {
    const selected = selectRuleUnits(consequence.selector, context);
    if (!selected.ok) return { presentationEvents: presentation, canceled: true, reason: selected.message };
    for (const target of selected.value) {
      const targetId = unitId(target);
      const targetBinding: RuleBinding = { kind: 'unit', unitId: targetId };
      const individual: Extract<RuleTriggeredConsequence, { kind: 'stored-state' }> = {
        kind: 'stored-state', state: consequence.state, lifetime: consequence.lifetime
      };
      const materialized = hooks.materializeState?.(source, {
        ...individual,
        state: { ...individual.state, subject: { kind: 'reference', reference: 'obj' } }
      }, { ...event, object: targetBinding }, state);
      if (materialized) {
        if (!materialized.success || materialized.canceled) return { presentationEvents: presentation, canceled: true, reason: materialized.reason };
        continue;
      }
      const created = createStoredContributions(
        state, source.id, source.sourceUnitId, individual.state, individual.lifetime, event.id,
        { ...context, self: targetBinding }, 'target'
      );
      if (!created.ok) return { presentationEvents: presentation, canceled: true, reason: created.message };
    }
    return undefined;
  }
  if (consequence.kind === 'stored-state') {
    const materialized = hooks.materializeState?.(source, consequence, event, state);
    if (materialized) return materialized.success && !materialized.canceled
      ? undefined
      : { presentationEvents: presentation, canceled: true, reason: materialized.reason };
    // Permanent scalar state is absorbed by the selected unit, just like
    // damage. The phrase binding has finished its job; no live subj/obj link
    // remains for the engine to follow after this point.
    if (consequence.lifetime.kind === 'permanent' && consequence.state.subject.kind === 'reference') {
      const targets = bindingForEntity(consequence.state.subject, context);
      if (!targets.ok) return { presentationEvents: presentation, canceled: true, reason: targets.message };
      if (['up-life', 'up-mod', 'up-bow'].includes(consequence.state.property.name)) {
        for (const target of targets.value) {
          if (target.kind !== 'unit') continue;
          const targetUnit = state.units.find(candidate => unitId(candidate) === target.unitId);
          if (!targetUnit) continue;
          const left = Number(consequence.state.property.parameters[0] ?? 0);
          const right = Number(consequence.state.property.parameters[1] ?? 0);
          if (consequence.state.property.name === 'up-life') {
            targetUnit.maxLifeBonus = (targetUnit.maxLifeBonus ?? 0) + right;
            targetUnit.permanentDamage = Math.max(0, targetUnit.permanentDamage - left);
          } else if (consequence.state.property.name === 'up-mod') {
            targetUnit.combatModifierBonus = (targetUnit.combatModifierBonus ?? 0) + left;
            targetUnit.magicModifierBonus = (targetUnit.magicModifierBonus ?? 0) + right;
          } else {
            targetUnit.rangedDamageBonus = (targetUnit.rangedDamageBonus ?? 0) + left;
            targetUnit.rangedRangeBonus = (targetUnit.rangedRangeBonus ?? 0) + right;
          }
        }
        return undefined;
      }
    }
    const created = createStoredContributions(state, source.id, source.sourceUnitId, consequence.state, consequence.lifetime, event.id, context);
    return created.ok ? undefined : { presentationEvents: presentation, canceled: true, reason: created.message };
  }
  const materialized = materializeEvent(consequence.event, context, source, consequenceIndex, event);
  if (!materialized.ok) return { presentationEvents: presentation, canceled: true, reason: materialized.message };
  if (materialized.value.pendingChoice) return { presentationEvents: presentation, pendingChoice: materialized.value.pendingChoice };
  for (const intent of materialized.value.intents ?? []) {
    const result = executeNormalizedIntent(state, cards, rules, intent, hooks, presentation);
    if (result.pendingChoice || result.canceled) return result;
  }
  return undefined;
}

function executeTriggers(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  event: NormalizedEventRecord,
  hooks: RuleRuntimeHooks,
  presentation: NormalizedEventRecord[],
  matched = matchingRules(rules, event, state, cards)
): RuleRuntimeResult | undefined {
  // Catalogue/deck order is deterministic. Each rule's consequences execute
  // left-to-right; a choice boundary suspends before later consequences.
  for (const { source } of matched) {
    const trigger = source.rule as ParsedTriggerRule;
    for (const [index, consequence] of trigger.consequences.entries()) {
      const result = executeConsequence(state, cards, rules, source, consequence, index, event, hooks, presentation);
      if (result?.pendingChoice || result?.canceled) return result;
    }
  }
  return undefined;
}

export function executeNormalizedIntent(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  intent: NormalizedActionIntent,
  hooks: RuleRuntimeHooks,
  presentation: NormalizedEventRecord[] = []
): RuleRuntimeResult {
  const announced = eventFromIntent(state, intent, 'target', true);
  record(state, announced);
  presentation.push(announced);
  // Detect triggers as the event occurs, but execute them only after its
  // authoritative mutation has completed. This mirrors Magic's distinction
  // between a trigger condition being observed and its ability resolving.
  const matched = matchingRules(rules, announced, state, cards);
  const self = intent.subject ?? { kind: 'hex' as const, coordinate: intent.origin as never };
  const cleanupContext = contextFor(state, cards, intent.controller, self, announced);
  cleanupStoredContributions(state, announced, 'before', cleanupContext);
  let post: RuleRuntimeResult | undefined;
  let boundaryCalled = false;
  const afterApply = (appliedState: GameState): void => {
    if (boundaryCalled) return;
    boundaryCalled = true;
    cleanupStoredContributions(appliedState, announced, 'after', contextFor(appliedState, cards, intent.controller, self, announced));
    post = executeTriggers(appliedState, cards, rules, announced, hooks, presentation, matched);
  };
  const applied = hooks.apply(intent, state, afterApply);
  if (!applied.success || applied.canceled) {
    announced.success = false;
    announced.canceled = true;
    return { event: announced, presentationEvents: presentation, canceled: true, reason: applied.reason };
  }
  if (!boundaryCalled) afterApply(state);
  if (post?.pendingChoice || post?.canceled) return { ...post, event: announced };
  if (hooks.mode?.(intent) === 'deferred') return { event: announced, presentationEvents: presentation };
  const resolved = eventFromIntent(state, intent, 'resolved', true);
  record(state, resolved);
  presentation.push(resolved);
  const resolvedTriggers = executeTriggers(state, cards, rules, resolved, hooks, presentation);
  return resolvedTriggers ? { ...resolvedTriggers, event: announced, resolved } : { event: announced, resolved, presentationEvents: presentation };
}

/** Emit a successful post-mutation notification for a previously deferred action. */
export function emitNormalizedResolved(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  event: NormalizedEventRecord,
  hooks: RuleRuntimeHooks
): RuleRuntimeResult {
  if (event.stage !== 'resolved') throw new Error('Resolved emission requires a resolved-stage event.');
  record(state, event);
  const presentation = [event];
  const matched = matchingRules(rules, event, state, cards);
  const triggered = executeTriggers(state, cards, rules, event, hooks, presentation, matched);
  return triggered ? { ...triggered, resolved: event } : { resolved: event, presentationEvents: presentation };
}

/**
 * Publish an engine-owned lifecycle event (for example a phase boundary).
 * The engine has already established the event, so only rule matching,
 * contribution cleanup, and consequences run here.
 */
export function emitNormalizedEvent(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  event: NormalizedEventRecord,
  hooks: RuleRuntimeHooks
): RuleRuntimeResult {
  record(state, event);
  const matched = matchingRules(rules, event, state, cards);
  const self = event.subject ?? event.object;
  if (self) {
    const context = contextFor(state, cards, event.controller, self, event);
    cleanupStoredContributions(state, event, 'before', context);
    cleanupStoredContributions(state, event, 'after', context);
  }
  const presentation = [event];
  const triggered = executeTriggers(state, cards, rules, event, hooks, presentation, matched);
  return triggered ? { ...triggered, event } : { event, presentationEvents: presentation };
}
