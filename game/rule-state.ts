import type { PassiveKind, TroopSeed } from './cards.js';
import type { GameState, UnitId, UnitState } from './engine.js';
import { evaluateObservableCondition, selectRuleHexes, selectRuleUnits, type NormalizedEventRecord, type RuleBinding, type RuleEvaluationContext, type RuleEvaluationResult } from './rule-evaluator.js';
import type { ParsedContinuousRule, ParsedHaveRule, RuleLifetime, RuleState, RuleStateProperty } from './rule-parser.js';

export interface StoredRuleContribution {
  id: number;
  sourceRuleId: string;
  sourceUnitId: UnitId;
  targetUnitId: UnitId;
  property: RuleStateProperty;
  lifetime: RuleLifetime;
  createdByEventId: number;
  /** Triggered `have` rebinds lifetime `self` to the selected target. */
  lifetimeSelfUnitId?: UnitId;
}

export interface NormalizedStateExtension {
  ruleContributions?: StoredRuleContribution[];
  nextRuleContributionId?: number;
}

export type StateWithNormalizedRules = GameState & NormalizedStateExtension;

const unitId = (unit: Pick<UnitState, 'owner' | 'troopId' | 'id'>): UnitId => unit.id ?? `${unit.owner}:${unit.troopId}`;
const maximumHealth = (unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number => Math.max(0, (cards.get(unit.troopId)?.baseHealth ?? 0) + (unit.maxLifeBonus ?? 0));

export interface DerivedRuleSource {
  id: string;
  sourceUnitId: UnitId;
  rule: ParsedContinuousRule | ParsedHaveRule;
}

export interface EffectiveUnitState {
  unitId: UnitId;
  physicalModifier: number;
  magicModifier: number;
  actualLife: number;
  startingLife: number;
  passives: ReadonlySet<PassiveKind>;
  actionUpdates: ReadonlyMap<string, { parameters: number[]; qualifiers: Set<string> }>;
  contributions: readonly StoredRuleContribution[];
}

function failed<T>(result: RuleEvaluationResult<T>): result is Extract<RuleEvaluationResult<T>, { ok: false }> {
  return !result.ok;
}

export function selectStateTargetUnitIds(state: RuleState, context: RuleEvaluationContext): RuleEvaluationResult<UnitId[]> {
  if (state.subject.kind === 'reference') {
    const selected = state.subject.reference === 'self' ? context.self : state.subject.reference === 'subj' ? context.subj : context.obj;
    if (!selected) return { ok: false, code: 'missing-binding', message: `Missing ${state.subject.reference} binding.` };
    if (selected.kind !== 'unit') return { ok: false, code: 'invalid-reference', message: `${state.subject.reference} does not identify a unit.` };
    return { ok: true, value: [selected.unitId] };
  }
  const hexes = selectRuleHexes(state.subject, context);
  if (failed(hexes)) return hexes;
  const ids = context.state.units.filter(unit => hexes.value.includes(unit.coordinate)).map(unitId);
  const selector = state.subject.kind === 'descriptor' || state.subject.kind === 'query' ? state.subject.selector
    : state.subject.kind === 'directed' && state.subject.filter ? state.subject.filter.selector
    : 'any';
  return { ok: true, value: selector === 'all' ? ids : ids.slice(0, 1) };
}

/** Materialize a state consequence into concrete, unit-owned contributions. */
export function createStoredContributions(
  state: StateWithNormalizedRules,
  sourceRuleId: string,
  sourceUnitId: UnitId,
  contribution: RuleState,
  lifetime: RuleLifetime,
  eventId: number,
  context: RuleEvaluationContext,
  lifetimeSelf: 'source' | 'target' = 'source'
): RuleEvaluationResult<StoredRuleContribution[]> {
  const targets = selectStateTargetUnitIds(contribution, context);
  if (failed(targets)) return targets;
  const created = targets.value.map(targetUnitId => ({
    id: state.nextRuleContributionId ?? 1,
    sourceRuleId, sourceUnitId, targetUnitId,
    property: structuredClone(contribution.property),
    lifetime: structuredClone(lifetime),
    createdByEventId: eventId,
    ...(lifetimeSelf === 'target' ? { lifetimeSelfUnitId: targetUnitId } : {})
  }));
  for (const item of created) {
    state.nextRuleContributionId = item.id + 1;
    (state.ruleContributions ??= []).push(item);
  }
  return { ok: true, value: created };
}

function eventBindingMatches(binding: RuleBinding | undefined, unit: UnitId): boolean {
  return binding?.kind === 'unit' && binding.unitId === unit;
}

function lifetimeMatches(item: StoredRuleContribution, event: NormalizedEventRecord): boolean {
  if (item.lifetime.kind === 'permanent') return false;
  const pattern = item.lifetime.event;
  if (pattern.kind === 'phase') return event.name === pattern.phase && event.stage === 'target';
  if (event.name !== pattern.action.name || (pattern.stage ?? 'target') !== event.stage || event.canceled || !event.success) return false;
  // A lifetime reference was materialized with the contribution. `self` means
  // its source; `subj`/`obj` mean the target selected by the state phrase.
  const referenceMatches = (reference: string, actual: RuleBinding | undefined): boolean => reference === 'self'
    ? eventBindingMatches(actual, item.lifetimeSelfUnitId ?? item.sourceUnitId)
    : eventBindingMatches(actual, item.targetUnitId);
  if (pattern.subject.kind === 'reference' && !referenceMatches(pattern.subject.reference, event.subject)) return false;
  if (pattern.object?.kind === 'reference' && !referenceMatches(pattern.object.reference, event.object)) return false;
  const parametersMatch = pattern.action.parameters.every((value, index) => value === undefined || value === event.parameters[index]);
  return parametersMatch && pattern.action.qualifiers.every(qualifier => event.qualifiers.includes(qualifier));
}

/** Remove `until` before application and `removed-after` after application. */
export function cleanupStoredContributions(
  state: StateWithNormalizedRules,
  event: NormalizedEventRecord,
  moment: 'before' | 'after',
  _context: RuleEvaluationContext
): StoredRuleContribution[] {
  if (event.canceled || !event.success) return [];
  const removed = (state.ruleContributions ?? []).filter(item => item.lifetime.kind === (moment === 'before' ? 'until' : 'removed-after') && lifetimeMatches(item, event));
  if (removed.length) {
    const ids = new Set(removed.map(item => item.id));
    state.ruleContributions = (state.ruleContributions ?? []).filter(item => !ids.has(item.id));
  }
  return removed;
}

function derivedForUnit(unit: UnitState, sources: readonly DerivedRuleSource[], context: RuleEvaluationContext): StoredRuleContribution[] {
  const result: StoredRuleContribution[] = [];
  for (const source of sources) {
    const sourceBinding: RuleBinding = { kind: 'unit', unitId: source.sourceUnitId };
    const sourceContext = { ...context, self: sourceBinding };
    if (source.rule.kind === 'continuous') {
      if (source.sourceUnitId !== unitId(unit)) continue;
      const active = evaluateObservableCondition(source.rule.condition, sourceContext);
      if (!active.ok || !active.value) continue;
      const targets = selectStateTargetUnitIds(source.rule.contribution, sourceContext);
      if (!targets.ok || !targets.value.includes(unitId(unit))) continue;
      result.push({ id: -result.length - 1, sourceRuleId: source.id, sourceUnitId: source.sourceUnitId, targetUnitId: unitId(unit), property: source.rule.contribution.property, lifetime: { kind: 'permanent' }, createdByEventId: -1 });
      continue;
    }
    const visit = (rule: ParsedHaveRule, scoped: RuleEvaluationContext): void => {
      const selected = selectRuleUnits(rule.selector, scoped);
      if (!selected.ok) return;
      for (const selectedUnit of selected.value) {
        const selectedId = unitId(selectedUnit);
        const nestedContext = { ...scoped, self: { kind: 'unit' as const, unitId: selectedId } };
        if (rule.attachment.kind === 'have') visit(rule.attachment, nestedContext);
        else if (selectedId === unitId(unit)) result.push({
          id: -result.length - 1, sourceRuleId: source.id, sourceUnitId: source.sourceUnitId,
          targetUnitId: selectedId, property: rule.attachment.property,
          lifetime: { kind: 'permanent' }, createdByEventId: -1
        });
      }
    };
    visit(source.rule, sourceContext);
  }
  return result;
}

export function effectiveUnitState(
  state: StateWithNormalizedRules,
  unit: UnitState,
  cards: ReadonlyMap<string, TroopSeed>,
  derived: readonly DerivedRuleSource[] = [],
  context?: RuleEvaluationContext
): EffectiveUnitState {
  const card = cards.get(unit.troopId);
  const baseContext: RuleEvaluationContext = context ?? { state, cards, controller: unit.owner, self: { kind: 'unit', unitId: unitId(unit) } };
  const contributions = [...(state.ruleContributions ?? []).filter(item => item.targetUnitId === unitId(unit)), ...derivedForUnit(unit, derived, baseContext)];
  let physicalModifier = (unit.shields ?? []).reduce((sum, shield) => sum + shield.value, 0) + (unit.combatModifierBonus ?? 0);
  let magicModifier = unit.magicModifierBonus ?? 0;
  let actualDelta = 0;
  let startingDelta = unit.maxLifeBonus ?? 0;
  const passives = new Set<PassiveKind>(card?.passives ?? []);
  const actionUpdates = new Map<string, { parameters: number[]; qualifiers: Set<string> }>();
  for (const contribution of contributions) {
    const { property } = contribution;
    if (property.name === 'up-mod') {
      physicalModifier += Number(property.parameters[0] ?? 0);
      magicModifier += Number(property.parameters[1] ?? 0);
    } else if (property.name === 'up-life') {
      actualDelta += Number(property.parameters[0] ?? 0);
      startingDelta += Number(property.parameters[1] ?? 0);
    } else if (['first-strike', 'obsidian', 'titanium', 'steady', 'fast'].includes(property.name)) {
      passives.add(property.name as PassiveKind);
    } else if (property.action) {
      const existing = actionUpdates.get(property.action) ?? { parameters: [], qualifiers: new Set<string>() };
      for (const [index, value] of property.parameters.entries()) {
        if (typeof value === 'number') existing.parameters[index] = (existing.parameters[index] ?? 0) + value;
        else if (value) existing.qualifiers.add(value);
      }
      actionUpdates.set(property.action, existing);
    }
  }
  // Starting-life changes are applied first; actual life is then clamped to the
  // new legal interval. This keeps healing and maximum reduction deterministic.
  const printedStarting = card?.baseHealth ?? maximumHealth(unit, cards);
  const startingLife = Math.max(0, printedStarting + startingDelta);
  const currentBeforeContribution = Math.max(0, maximumHealth(unit, cards) - unit.permanentDamage);
  const actualLife = Math.min(startingLife, Math.max(0, currentBeforeContribution + actualDelta));
  return { unitId: unitId(unit), physicalModifier, magicModifier, actualLife, startingLife, passives, actionUpdates, contributions };
}
