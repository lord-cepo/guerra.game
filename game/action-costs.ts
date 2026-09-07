import { isUnitInactive, unitId, type GameState, type UnitId } from './engine.js';
import type { NormalizedActionIntent } from './rule-runtime.js';
import type { Player } from './types.js';
import type { RulePhrase } from './rule-parser.js';
import { hasTriggeredActionCost } from './consequence-policy.js';

export function explicitActionCosts(phrases: readonly RulePhrase[], intent: NormalizedActionIntent): NormalizedActionIntent[] {
  return phrases.map(phrase => {
    if (phrase.subject.kind !== 'reference' || phrase.subject.reference !== 'self') throw new Error('An active action cost subject must be self.');
    const object = phrase.object?.kind === 'player'
      ? { kind: 'player' as const, player: phrase.object.player === 'you' ? intent.controller : intent.controller === 1 ? 2 as const : 1 as const }
      : phrase.object?.kind === 'reference' && phrase.object.reference === 'self' ? intent.subject : undefined;
    if (!object) throw new Error('An active action cost needs self or a player target.');
    return { name: phrase.action.name, subject: intent.subject, object, parameters: [...phrase.action.parameters], qualifiers: [], controller: intent.controller };
  });
}

export const deactivatingActions = new Set(['bow', 'fire', 'gore', 'gore-move', 'cannon', 'fly', 'move', 'shield', 'mshield', 'bomb-throw', 'pull', 'push', 'upgrade', 'deploy', 'mend', 'stun', 'light']);

export function playerActions(state: GameState, player: Player): number {
  return state.actions?.[player] ?? (state.activePlayer === player && (state.phase === 'start' || state.pendingResolution?.resumeTurn || (!state.pendingResolution && (state.phase ?? 'action') === 'action')) ? 1 : 0);
}

export function implicitActionCosts(intent: NormalizedActionIntent, standalone: boolean): NormalizedActionIntent[] {
  const base: NormalizedActionIntent = { name: '', subject: intent.subject, controller: intent.controller, qualifiers: [], parameters: [] };
  return [
    ...((standalone ? deactivatingActions.has(intent.name) && !intent.qualifiers.includes('tireless') : hasTriggeredActionCost(intent))
      ? [{ ...base, name: 'deactivate', object: intent.subject }] : []),
    ...(standalone && !intent.qualifiers.includes('action-free') ? [{ ...base, name: 'up-actions', parameters: [-1], object: { kind: 'player' as const, player: intent.controller } }] : [])
  ];
}

/** Simulate the whole payment before committing any part of it. */
export function validateActionCosts(state: GameState, costs: readonly NormalizedActionIntent[]): boolean {
  const remaining = { 1: playerActions(state, 1), 2: playerActions(state, 2) };
  const deactivated = new Set<UnitId>();
  for (const cost of costs) {
    if (cost.name === 'up-actions') {
      if (cost.object?.kind !== 'player' || !Number.isInteger(cost.parameters[0]) || Number(cost.parameters[0]) >= 0) return false;
      remaining[cost.object.player] += Number(cost.parameters[0]);
      if (remaining[cost.object.player] < 0) return false;
    } else if (cost.name === 'deactivate') {
      if (cost.object?.kind !== 'unit') return false;
      const id = cost.object.unitId;
      const unit = state.units.find(candidate => unitId(candidate) === id);
      if (deactivated.has(id) || (unit ? isUnitInactive(state, unit) : state.offboardInactive?.[id] !== undefined)) return false;
      deactivated.add(id);
    } else return false;
  }
  return true;
}

/** These state-change verbs are mutations, never derived contributions. */
export function applyResourceEvent(state: GameState, intent: NormalizedActionIntent): boolean | undefined {
  if (intent.name === 'up-actions') {
    if (intent.object?.kind !== 'player' || !Number.isInteger(intent.parameters[0])) return false;
    const player = intent.object.player;
    const value = playerActions(state, player) + Number(intent.parameters[0]);
    if (value < 0) return false;
    state.actions ??= { 1: playerActions(state, 1), 2: playerActions(state, 2) };
    state.actions[player] = value;
    return true;
  }
  if (intent.name !== 'activate' && intent.name !== 'deactivate') return undefined;
  const binding = intent.object?.kind === 'unit' ? intent.object : intent.subject;
  if (binding?.kind !== 'unit') return false;
  const unit = state.units.find(candidate => unitId(candidate) === binding.unitId);
  const owner = Number(binding.unitId.split(':')[0]) as Player;
  const troopId = binding.unitId.slice(2);
  if (intent.name === 'deactivate') {
    if (unit) {
      if (isUnitInactive(state, unit)) return false;
      unit.inactiveOnTurn = state.turnNumber ?? 0;
      delete unit.inactiveUntilTurn;
    } else {
      if (state.offboardInactive?.[binding.unitId] !== undefined) return false;
      (state.offboardInactive ??= {})[binding.unitId] = state.turnNumber ?? 0;
    }
    (state.lastActingTroopId ??= {})[owner] = troopId;
  } else {
    if (unit) { delete unit.inactiveOnTurn; delete unit.inactiveUntilTurn; }
    if (state.offboardInactive) delete state.offboardInactive[binding.unitId];
    if (state.lastActingTroopId?.[owner] === troopId) delete state.lastActingTroopId[owner];
  }
  return true;
}
