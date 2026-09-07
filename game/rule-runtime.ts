import { unitId, type GameState, type UnitId, type UnitState } from './engine.js';
import { evaluateObservableCondition, matchRuleAnchor, selectRuleHexes, selectRuleUnits, type NormalizedEventRecord, type RuleBinding, type RuleEvaluationContext, type RuleEvaluationResult } from './rule-evaluator.js';
import { cleanupStoredContributions, createStoredContributions, selectStateTargetUnitIds } from './rule-state.js';
import type { ParsedRule, ParsedTriggerRule, RuleEntity, RulePhrase, RuleTriggeredConsequence } from './rule-parser.js';
import type { TroopSeed } from './cards.js';
import type { Player } from './types.js';
import { applyResourceEvent, implicitActionCosts, validateActionCosts } from './action-costs.js';
import { applyNamedValue, type NamedValue } from './named-values.js';
import { scheduleRuleWork, takeScheduledRules } from './rule-scheduler.js';
import { ruleWord } from './rule-vocabulary.js';
import { consequenceIsMandatory } from './consequence-policy.js';

export interface RuntimeRuleSource {
  id: string;
  sourceUnitId: UnitId;
  /** Last known source state lets leave-play triggers resolve after removal. */
  sourceSnapshot?: UnitState;
  rule: ParsedRule;
}

export interface NormalizedActionIntent {
  named?: NamedValue;
  costsPaid?: boolean;
  resumeBundle?: boolean;
  confirmed?: boolean;
  name: string;
  subject?: RuleBinding;
  object?: RuleBinding;
  origin?: string;
  target?: string;
  parameters: Array<number | undefined>;
  qualifiers: RulePhrase['action']['qualifiers'];
  controller: Player;
  causedByRuleId?: string;
  /** Parent occurrence retained internally while a triggered action executes. */
  triggeringEvent?: NormalizedEventRecord;
  mandatory?: true;
}

export interface NormalizedApplyResult {
  success: boolean;
  canceled?: boolean;
  reason?: string;
}

export interface RuleRuntimeHooks {
  choose?(intents: NormalizedActionIntent[], source: RuntimeRuleSource, event: NormalizedEventRecord, allTargets?: boolean): void;
  /** Engine adapters opt into implicit payment; generic mutation hooks may manage their own costs. */
  actionCosts?: boolean;
  prepare?(intent: NormalizedActionIntent): 'waiting' | 'skip' | undefined;
  bundle?(events: readonly NormalizedActionIntent[], kind: 'cost' | 'effect'): void;
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

export type RuleRuntimeWork =
  | { kind: 'intent'; intent: NormalizedActionIntent }
  | { kind: 'triggers'; event: NormalizedEventRecord; sources: RuntimeRuleSource[] }
  | { kind: 'resolved'; intent: NormalizedActionIntent }
  | { kind: 'consequences'; source: RuntimeRuleSource; event: NormalizedEventRecord; index: number; paid?: boolean; deferred?: RuleRuntimeWork[] };

const bundles = new WeakMap<GameState, RuleRuntimeWork[]>();

function dispatchWork(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], hooks: RuleRuntimeHooks, presentation: NormalizedEventRecord[], work: RuleRuntimeWork[]): RuleRuntimeResult | undefined {
  for (let index = 0; index < work.length; index++) {
    if (state.pendingResolution) {
      state.ruleWork = [...(state.ruleWork ?? []), ...work.slice(index)];
      return undefined;
    }
    const item = work[index];
    let result: RuleRuntimeResult | undefined;
    if (item.kind === 'intent') result = executeNormalizedIntent(state, cards, rules, item.intent, hooks, presentation);
    else if (item.kind === 'triggers') result = executeTriggers(state, cards, rules, item.event, hooks, presentation, item.sources.map(source => ({ source, context: {} as RuleEvaluationContext })));
    else if (item.kind === 'consequences') result = executeConsequenceBundle(state, cards, rules, item.source, item.event, hooks, presentation, item.index, item.paid, item.deferred);
    else {
      const resolved = eventFromIntent(state, item.intent, 'resolved', true);
      record(state, resolved); presentation.push(resolved);
      result = executeTriggers(state, cards, rules, resolved, hooks, presentation);
    }
    if (result?.canceled || result?.pendingChoice) return result;
  }
  return undefined;
}

export function resumeRuleRuntime(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], hooks: RuleRuntimeHooks): void {
  while (!state.pendingResolution && state.ruleWork?.length) {
    const work = state.ruleWork;
    state.ruleWork = [];
    const result = dispatchWork(state, cards, rules, hooks, [], work);
    if (result?.canceled) throw new Error(result.reason ?? 'Rule continuation failed.');
  }
}

/** Mutate every member before releasing its captured triggers. */
export function executeNormalizedBundle(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], intents: readonly NormalizedActionIntent[], hooks: RuleRuntimeHooks, presentation: NormalizedEventRecord[] = [], kind: 'cost' | 'effect' = 'effect'): RuleRuntimeResult {
  if (kind === 'cost' && !validateActionCosts(state, intents)) return { presentationEvents: presentation, canceled: true, reason: 'The complete cost bundle cannot be paid.' };
  const parent = bundles.get(state);
  const work: RuleRuntimeWork[] = [];
  bundles.set(state, work);
  hooks.bundle?.(intents, kind);
  try {
    for (const intent of intents) {
      const result = executeNormalizedIntent(state, cards, rules, intent, hooks, presentation);
      if (result.canceled || result.pendingChoice) return result;
    }
  } finally {
    if (parent) bundles.set(state, parent); else bundles.delete(state);
  }
  // Costs are a boundary: their triggers finish before the effect bundle.
  const result = dispatchWork(state, cards, rules, hooks, presentation, work);
  return result ?? { presentationEvents: presentation };
}

export interface PendingRuleChoice {
  ruleId: string;
  consequenceIndex: number;
  operand: 'subject' | 'object';
  legalHexes: string[];
  confirmationOnly?: boolean;
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
  if (entity.kind === 'player') return { ok: true, value: [{ kind: 'player', player: entity.player === 'you' ? context.controller : context.controller === 1 ? 2 : 1 }] };
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
  if (binding.kind === 'player') return undefined;
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
  const targetContext = { ...context, phraseSubject: fixedCoordinate(subjects.value[0], context.state, source, event) as never };
  let objects = phrase.object ? bindingForEntity(phrase.object, targetContext) : { ok: true as const, value: [] };
  if (phrase.action.name.startsWith('up-unit-') && phrase.object && phrase.object.kind !== 'reference') {
    const units = selectRuleUnits(phrase.object, targetContext);
    objects = units.ok ? { ok: true, value: units.value.map(unit => ({ kind: 'unit' as const, unitId: unitId(unit) })) } : units;
  }
  if (!objects.ok) return objects;
  if (subjects.value.length !== 1) return { ok: true, value: { pendingChoice: { ruleId: source.id, consequenceIndex, operand: 'subject', legalHexes: subjects.value.map(item => fixedCoordinate(item, context.state, source, event)).filter((item): item is string => Boolean(item)) } } };
  if (phrase.object && phrase.targetPolicy !== 'all' && objects.value.length === 0) return { ok: true, value: { intents: [] } };
  const chooseTarget = phrase.targetPolicy !== 'all' && objects.value.length > 1;
  const mandatory = consequenceIsMandatory(phrase.action, phrase.mandatory, source.rule.kind === 'trigger' && Boolean(source.rule.costs?.length));
  const optionalAction = !mandatory && ruleWord(phrase.action.name)?.eventClass === 'action';
  const pendingChoice: PendingRuleChoice | undefined = phrase.object && objects.value.length > 0 && (chooseTarget || optionalAction) ? { ruleId: source.id, consequenceIndex, operand: 'object', confirmationOnly: !chooseTarget, legalHexes: objects.value.map(item => fixedCoordinate(item, context.state, source, event)).filter((item): item is string => Boolean(item)) } : undefined;
  const subject = subjects.value[0];
  const selectedObjects = (phrase.object ? objects.value : [undefined]).flatMap(object => {
    if (phrase.action.name.startsWith('up-hex-')) {
      const coordinate = fixedCoordinate(object, context.state, source, event);
      return coordinate ? [{ kind: 'hex' as const, coordinate: coordinate as never }] : [];
    }
    if (phrase.action.name.startsWith('up-unit-') && object?.kind !== 'unit') return [];
    return [object];
  });
  return { ok: true, value: { ...(pendingChoice ? { pendingChoice } : {}), intents: selectedObjects.map(object => ({
    name: phrase.action.name, ...(phrase.action.named ? { named: phrase.action.named } : {}), subject, ...(object ? { object } : {}),
    origin: fixedCoordinate(subject, context.state, source, event), target: fixedCoordinate(object, context.state, source, event),
    parameters: [...phrase.action.parameters], qualifiers: [...phrase.action.qualifiers], controller: context.controller,
    causedByRuleId: source.id,
    ...(phrase.costsPaid ? { costsPaid: true } : {}),
    triggeringEvent: event,
    ...(mandatory ? { mandatory: true as const } : {})
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
    id: nextEventId(state), name: intent.name, ...(intent.named ? { named: intent.named } : {}), stage,
    ...(intent.subject ? { subject: intent.subject } : {}),
    ...(intent.object ? { object: intent.object } : {}),
    ...(intent.origin ? { origin: intent.origin as NormalizedEventRecord['origin'] } : {}),
    ...(intent.target ? { destination: intent.target as NormalizedEventRecord['destination'] } : {}),
    parameters: [...intent.parameters], qualifiers: [...intent.qualifiers], controller: intent.controller,
    turn: state.turnNumber ?? 0, success, ...(canceled ? { canceled: true } : {})
  };
}

function applyConsequence(
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
  if (materialized.value.pendingChoice) {
    if (hooks.choose && materialized.value.intents) { hooks.choose(materialized.value.intents, source, event, consequence.event.targetPolicy === 'all'); return; }
    return { presentationEvents: presentation, pendingChoice: materialized.value.pendingChoice };
  }
  for (const intent of materialized.value.intents ?? []) {
    const result = executeNormalizedIntent(state, cards, rules, intent, hooks, presentation);
    if (result.pendingChoice) return result;
  }
  return undefined;
}

function executeConsequence(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], source: RuntimeRuleSource, consequence: RuleTriggeredConsequence, index: number, event: NormalizedEventRecord, hooks: RuleRuntimeHooks, presentation: NormalizedEventRecord[]): RuleRuntimeResult | undefined {
  const owner = state.units.find(unit => unitId(unit) === source.sourceUnitId) ?? source.sourceSnapshot;
  if (!owner) return;
  const context = contextFor(state, cards, owner.owner, { kind: 'unit', unitId: source.sourceUnitId }, event);
  if (consequence.at) {
    const { at, ...immediate } = consequence;
    if (immediate.kind === 'event') {
      const materialized = materializeEvent(immediate.event, context, source, index, event);
      if (!materialized.ok) return { canceled: true, reason: materialized.message, presentationEvents: presentation };
      if (materialized.value.pendingChoice && !materialized.value.pendingChoice.confirmationOnly) return { pendingChoice: materialized.value.pendingChoice, presentationEvents: presentation };
      for (const intent of materialized.value.intents ?? []) scheduleRuleWork(state, at, owner.owner, nextEventId(state) - 1, { kind: 'intent', intent });
    } else {
      const targets = immediate.kind === 'distributed-state' ? selectRuleUnits(immediate.selector, context) : selectRuleUnits(immediate.state.subject, context);
      if (!targets.ok) return { canceled: true, reason: targets.message, presentationEvents: presentation };
      for (const target of targets.value) {
        const frozen = { ...event, object: { kind: 'unit' as const, unitId: unitId(target) } };
        const stored: RuleTriggeredConsequence = { kind: 'stored-state', state: { ...immediate.state, subject: { kind: 'reference', reference: 'obj' } }, lifetime: immediate.lifetime };
        const scheduledSource: RuntimeRuleSource = { ...source, sourceSnapshot: owner, rule: { kind: 'trigger', anchor: { kind: 'phase', phase: 'start' }, consequences: [stored] } };
        scheduleRuleWork(state, at, owner.owner, nextEventId(state) - 1, { kind: 'consequences', source: scheduledSource, event: frozen, index: 0 });
      }
    }
    return;
  }
  if (consequence.kind === 'distributed-state' && consequence.state.property.name.startsWith('up-')) {
    const targets = selectRuleUnits(consequence.selector, context);
    if (!targets.ok) return { canceled: true, reason: targets.message, presentationEvents: presentation };
    for (const target of targets.value) {
      const result = executeConsequence(state, cards, rules, source, { kind: 'stored-state', state: { ...consequence.state, subject: { kind: 'reference', reference: 'obj' } }, lifetime: consequence.lifetime }, index, { ...event, object: { kind: 'unit', unitId: unitId(target) } }, hooks, presentation);
      if (result?.canceled || result?.pendingChoice) return result;
    }
    return;
  }
  if (consequence.kind === 'stored-state' && consequence.state.property.name.startsWith('up-')) {
    const targets = selectStateTargetUnitIds(consequence.state, context);
    if (!targets.ok) return { canceled: true, reason: targets.message, presentationEvents: presentation };
    for (const targetUnitId of targets.value) {
      const object: RuleBinding = { kind: 'unit', unitId: targetUnitId };
      const intent: NormalizedActionIntent = { name: consequence.state.property.name, subject: context.self, object, parameters: consequence.state.property.parameters.map(value => typeof value === 'number' ? value : undefined), qualifiers: [], controller: owner.owner, causedByRuleId: source.id };
      const result = executeNormalizedIntent(state, cards, rules, intent, { ...hooks, actionCosts: false, prepare: undefined, mode: () => 'immediate', apply: () => {
        const applied = applyConsequence(state, cards, rules, source, { ...consequence, state: { ...consequence.state, subject: { kind: 'reference', reference: 'obj' } } }, index, { ...event, object }, hooks, presentation);
        return { success: !applied?.canceled, reason: applied?.reason };
      } }, presentation);
      if (result.canceled || result.pendingChoice) return result;
    }
    return;
  }
  return applyConsequence(state, cards, rules, source, consequence, index, event, hooks, presentation);
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
  for (const [index, { source }] of matched.entries()) {
    if (state.pendingResolution) {
      (state.ruleWork ??= []).push({ kind: 'triggers', event, sources: matched.slice(index).map(item => item.source) });
      return;
    }
    const result = executeConsequenceBundle(state, cards, rules, source, event, hooks, presentation);
    if (result?.pendingChoice || result?.canceled) return result;
  }
  return undefined;
}

function executeConsequenceBundle(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], source: RuntimeRuleSource, event: NormalizedEventRecord, hooks: RuleRuntimeHooks, presentation: NormalizedEventRecord[], start = 0, paid = false, deferred: RuleRuntimeWork[] = []): RuleRuntimeResult | undefined {
  const trigger = source.rule as ParsedTriggerRule;
  if (start === 0) {
    const controller = source.sourceSnapshot?.owner ?? Number(source.sourceUnitId.slice(0, 1)) as Player;
    hooks.bundle?.(trigger.consequences.flatMap(item => item.kind === 'event' ? [{ name: item.event.action.name, subject: { kind: 'unit' as const, unitId: source.sourceUnitId }, controller, parameters: [...item.event.action.parameters], qualifiers: [...item.event.action.qualifiers], causedByRuleId: source.id }] : []), 'effect');
  }
  if (!trigger.costs && !paid && hooks.actionCosts) {
    const unit = state.units.find(candidate => unitId(candidate) === source.sourceUnitId) ?? source.sourceSnapshot;
    if (!unit) return;
    const context = contextFor(state, cards, unit.owner, { kind: 'unit', unitId: source.sourceUnitId }, event);
    const costs: NormalizedActionIntent[] = [];
    const seen = new Set<string>();
    for (const consequence of trigger.consequences) {
      if (consequence.kind !== 'event' || consequence.at) continue;
      const materialized = materializeEvent(consequence.event, context, source, 0, event);
      if (!materialized.ok || !materialized.value.intents) continue;
      for (const intent of materialized.value.intents) for (const cost of implicitActionCosts(intent, false)) {
        const key = JSON.stringify([cost.name, cost.object]);
        if (!seen.has(key)) { seen.add(key); costs.push(cost); }
      }
    }
    if (!validateActionCosts(state, costs)) return;
    const first = trigger.consequences[0];
    if (first?.kind === 'event' && !first.at && first.event.object && hooks.choose) {
      const selected = materializeEvent(first.event, context, source, 0, event);
      if (selected.ok && selected.value.pendingChoice && selected.value.intents) {
        hooks.choose(selected.value.intents, source, event, first.event.targetPolicy === 'all');
        if (state.pendingResolution) {
          state.pendingResolution.costs = costs;
          (state.ruleWork ??= []).push({ kind: 'consequences', source, event, index: 1, paid: true, deferred });
        }
        return;
      }
    }
    if (first?.kind === 'event' && !first.event.object) {
      const materialized = materializeEvent(first.event, context, source, 0, event);
      const intent = materialized.ok ? materialized.value.intents?.[0] : undefined;
      const prepared = intent && hooks.prepare?.(intent);
      if (prepared === 'skip') return;
      if (prepared === 'waiting' && state.pendingResolution) {
        state.pendingResolution.costs = costs;
        (state.ruleWork ??= []).push({ kind: 'consequences', source, event, index: 1, paid: true, deferred });
        return;
      }
    }
    if (costs.length) executeNormalizedBundle(state, cards, rules, costs, hooks, presentation, 'cost');
    paid = true;
  }
  if (trigger.costs && !paid) {
    const unit = state.units.find(candidate => unitId(candidate) === source.sourceUnitId) ?? source.sourceSnapshot;
    if (!unit) return;
    const context = contextFor(state, cards, unit.owner, { kind: 'unit', unitId: source.sourceUnitId }, event);
    const costs: NormalizedActionIntent[] = [];
    for (const phrase of trigger.costs) {
      const materialized = materializeEvent(phrase, context, source, 0, event);
      if (!materialized.ok || !materialized.value.intents) return;
      costs.push(...materialized.value.intents);
    }
    if (!validateActionCosts(state, costs)) return;
    const first = trigger.consequences[0];
    if (first?.kind === 'event' && !first.at && first.event.object && hooks.choose) {
      const selected = materializeEvent(first.event, context, source, 0, event);
      if (selected.ok && selected.value.pendingChoice && selected.value.intents) {
        hooks.choose(selected.value.intents, source, event, first.event.targetPolicy === 'all');
        if (state.pendingResolution) {
          state.pendingResolution.costs = costs;
          (state.ruleWork ??= []).push({ kind: 'consequences', source, event, index: 1, paid: true, deferred });
        }
        return;
      }
    }
    if (first?.kind === 'event' && !first.event.object) {
      const materialized = materializeEvent(first.event, context, source, 0, event);
      const intent = materialized.ok ? materialized.value.intents?.[0] : undefined;
      if (intent && hooks.prepare?.(intent) === 'waiting' && state.pendingResolution) {
        state.pendingResolution.costs = costs;
        (state.ruleWork ??= []).push({ kind: 'consequences', source, event, index: 1, paid: true, deferred });
        return;
      }
    }
    executeNormalizedBundle(state, cards, rules, costs, hooks, presentation, 'cost');
    paid = true;
  }
  const parent = bundles.get(state);
  const work: RuleRuntimeWork[] = [...deferred];
  bundles.set(state, work);
  try {
    for (let index = start; index < trigger.consequences.length; index++) {
      if (state.pendingResolution) {
        state.ruleWork = [...(state.ruleWork ?? []), { kind: 'consequences', source, event, index, paid, deferred: work }];
        return;
      }
      const consequence = trigger.consequences[index];
      const result = executeConsequence(state, cards, rules, source, paid && consequence.kind === 'event' && !consequence.at ? { ...consequence, event: { ...consequence.event, costsPaid: true } } : consequence, index, event, hooks, presentation);
      if (result?.pendingChoice || result?.canceled) return result;
    }
  } finally {
    if (parent) bundles.set(state, parent); else bundles.delete(state);
  }
  if (state.pendingResolution) {
    (state.ruleWork ??= []).push({ kind: 'consequences', source, event, index: trigger.consequences.length, paid, deferred: work });
    return;
  }
  return dispatchWork(state, cards, rules, hooks, presentation, work);
}

export function executeNormalizedCommand(state: GameState, cards: ReadonlyMap<string, TroopSeed>, rules: readonly RuntimeRuleSource[], intent: NormalizedActionIntent, hooks: RuleRuntimeHooks, followups?: RuleTriggeredConsequence[]): RuleRuntimeResult {
  if (!followups?.length || intent.subject?.kind !== 'unit') return executeNormalizedIntent(state, cards, rules, intent, hooks);
  const source: RuntimeRuleSource = {
    id: `${intent.subject.unitId}:action-bundle`, sourceUnitId: intent.subject.unitId,
    sourceSnapshot: structuredClone(state.units.find(unit => unitId(unit) === (intent.subject as Extract<RuleBinding, { kind: 'unit' }>).unitId)),
    rule: { kind: 'trigger', anchor: { kind: 'phase', phase: 'action-resolve' }, consequences: followups }
  };
  const work: RuleRuntimeWork[] = [];
  const parent = bundles.get(state);
  bundles.set(state, work);
  let result: RuleRuntimeResult;
  try { result = executeNormalizedIntent(state, cards, rules, intent, hooks); }
  finally { if (parent) bundles.set(state, parent); else bundles.delete(state); }
  if (!result.event) return result;
  const continued = executeConsequenceBundle(state, cards, rules, source, result.event, hooks, result.presentationEvents, 0, true, work);
  return continued ?? result;
}

export function executeNormalizedIntent(
  state: GameState,
  cards: ReadonlyMap<string, TroopSeed>,
  rules: readonly RuntimeRuleSource[],
  intent: NormalizedActionIntent,
  hooks: RuleRuntimeHooks,
  presentation: NormalizedEventRecord[] = []
): RuleRuntimeResult {
  const prepared = hooks.prepare?.(intent);
  if (prepared) return { presentationEvents: presentation };
  if (hooks.actionCosts && !intent.costsPaid) {
    const costs = implicitActionCosts(intent, false);
    if (!validateActionCosts(state, costs)) return { presentationEvents: presentation };
    if (costs.length) {
      const payment = executeNormalizedBundle(state, cards, rules, costs, hooks, presentation, 'cost');
      if (payment.canceled || payment.pendingChoice) return payment;
      intent.costsPaid = true;
      if (state.pendingResolution) {
        (state.ruleWork ??= []).push({ kind: 'intent', intent });
        return { presentationEvents: presentation };
      }
    }
  }
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
    const work: RuleRuntimeWork = { kind: 'triggers', event: announced, sources: matched.map(item => item.source) };
    const bundle = bundles.get(appliedState);
    if (bundle) bundle.push(work);
    else {
      const continuation = appliedState.ruleWork?.[0];
      if (intent.resumeBundle && continuation?.kind === 'consequences') (continuation.deferred ??= []).push(work);
      else post = dispatchWork(appliedState, cards, rules, hooks, presentation, [work]);
    }
  };
  const resource = applyNamedValue(state, intent.name, intent.object, intent.named) ?? applyResourceEvent(state, intent);
  const applied = resource === undefined ? hooks.apply(intent, state, afterApply) : { success: resource };
  if (!applied.success || applied.canceled) {
    announced.success = false;
    announced.canceled = true;
    return { event: announced, presentationEvents: presentation, canceled: true, reason: applied.reason };
  }
  if (!boundaryCalled) afterApply(state);
  if (post?.pendingChoice || post?.canceled) return { ...post, event: announced };
  if (hooks.mode?.(intent) === 'deferred') return { event: announced, presentationEvents: presentation };
  const bundle = bundles.get(state);
  if (bundle) {
    bundle.push({ kind: 'resolved', intent });
    return { event: announced, presentationEvents: presentation };
  }
  const continuation = state.ruleWork?.[0];
  if (intent.resumeBundle && continuation?.kind === 'consequences') {
    (continuation.deferred ??= []).push({ kind: 'resolved', intent });
    return { event: announced, presentationEvents: presentation };
  }
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
  const bundle = bundles.get(state);
  if (bundle) { bundle.push({ kind: 'triggers', event, sources: matched.map(item => item.source) }); return { resolved: event, presentationEvents: presentation }; }
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
  {
    const context = contextFor(state, cards, event.controller, self ?? { kind: 'player', player: event.controller }, event);
    cleanupStoredContributions(state, event, 'before', context);
    cleanupStoredContributions(state, event, 'after', context);
  }
  const presentation = [event];
  const scheduled = takeScheduledRules(state, event);
  const bundle = bundles.get(state);
  const work: RuleRuntimeWork[] = [{ kind: 'triggers', event, sources: matched.map(item => item.source) }, ...scheduled];
  if (bundle) { bundle.push(...work); return { event, presentationEvents: presentation }; }
  const triggered = dispatchWork(state, cards, rules, hooks, presentation, work);
  return triggered ? { ...triggered, event } : { event, presentationEvents: presentation };
}
