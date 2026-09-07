/** These triggered actions pay inactivity unless tireless. */
export const costlyTriggeredActions = new Set([
  'bow', 'gore', 'gore-move', 'bomb-throw', 'fire', 'cannon', 'fly', 'move',
  'shield', 'mshield', 'pull', 'push', 'stun'
]);

export function hasTriggeredActionCost(action: { name: string; qualifiers: readonly string[] }): boolean {
  return costlyTriggeredActions.has(action.name) && !action.qualifiers.includes('tireless');
}

export function consequenceIsMandatory(action: { name: string; qualifiers: readonly string[] }, explicitMust = false, explicitCosts = false): boolean {
  return explicitMust || !(explicitCosts || hasTriggeredActionCost(action));
}
