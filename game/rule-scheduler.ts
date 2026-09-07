import type { NormalizedEventRecord } from './rule-evaluator.js';
import type { RuleTiming } from './rule-parser.js';
import type { RuleRuntimeWork } from './rule-runtime.js';
import type { Player } from './types.js';

export interface ScheduledRuleWork {
  afterEventId: number;
  phase: 'start' | 'end';
  player: Player;
  work: RuleRuntimeWork;
}
export interface ScheduledRuleState { scheduledRules?: ScheduledRuleWork[] }

export function scheduleRuleWork(state: ScheduledRuleState, at: RuleTiming, player: Player, afterEventId: number, work: RuleRuntimeWork): void {
  (state.scheduledRules ??= []).push({ afterEventId, phase: at.endsWith('start') ? 'start' : 'end', player: at.includes('opponent') ? player === 1 ? 2 : 1 : player, work: structuredClone(work) });
}

export function takeScheduledRules(state: ScheduledRuleState, event: NormalizedEventRecord): RuleRuntimeWork[] {
  if (event.stage !== 'target' || !event.success || event.canceled) return [];
  const due = (item: ScheduledRuleWork): boolean => event.id > item.afterEventId && event.name === item.phase && event.controller === item.player;
  const work = (state.scheduledRules ?? []).filter(due).map(item => item.work);
  state.scheduledRules = (state.scheduledRules ?? []).filter(item => !due(item));
  return work;
}
