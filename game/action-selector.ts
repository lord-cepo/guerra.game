import type { RuleEntity } from './rule-parser.js';
import { hexDistance, PLAYABLE_COORDINATES } from './board.js';

export const radiusSelector = (distance: number): RuleEntity => ({ kind: 'directed', direction: 'range-from', within: true, distance, reference: { kind: 'reference', reference: 'self' } });
const boardDiameter = Math.max(...PLAYABLE_COORDINATES.flatMap(a => PLAYABLE_COORDINATES.map(b => hexDistance(a, b))));

/** A geometry bound derived from the selector, never an additional target restriction. */
export function selectorReach(selector: RuleEntity | undefined): number {
  if (!selector) return 0;
  if (selector.kind === 'reference' && selector.reference === 'self') return 0;
  if (selector.kind === 'directed' && selector.direction === 'range-from') return selector.distance ?? boardDiameter;
  if (selector.kind === 'intersection') return Math.min(...selector.operands.map(selectorReach));
  return boardDiameter;
}

export function actionReach(action: { selector?: RuleEntity; range?: number } | undefined): number {
  return action?.selector ? selectorReach(action.selector) : action?.range ?? 0;
}

export function expandSelector(selector: RuleEntity, amount: number): RuleEntity {
  if (selector.kind === 'directed' && selector.distance !== undefined) return { ...selector, distance: Math.max(0, selector.distance + amount) };
  if (selector.kind === 'intersection') return { ...selector, operands: selector.operands.map(operand => expandSelector(operand, amount) as never) };
  return selector;
}

export function withActionReach<T extends { selector?: RuleEntity; range?: number }>(action: T, reach: number): T {
  const { range, ...rest } = action;
  return { ...rest, selector: action.selector ? expandSelector(action.selector, reach - actionReach(action)) : radiusSelector(reach) } as T;
}
