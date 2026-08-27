import { hasPassive, type CardAction, type EventCondition, type LegacyActionView, type TriggerDefinition, type TroopAction, type TroopSeed, type UpgradableAbility } from './cards.js';
import { adjacentCoordinates, hexDistance, isBoardCoordinate, PLAYABLE_COORDINATES, regionAt, straightLine, type Coordinate } from './board.js';
import type { Player } from './types.js';

export type { Coordinate } from './board.js';
export type GameAction =
  | { type: 'pass' }
  | { type: 'deploy'; troopId: string; coordinate: Coordinate }
  | { type: 'move'; troopId: string; coordinate: Coordinate }
  | { type: 'fly'; troopId: string; coordinate: Coordinate }
  | { type: 'attack'; troopId: string; coordinate: Coordinate }
  | { type: 'cannon'; troopId: string; coordinate: Coordinate }
  | { type: 'gore'; troopId: string; coordinate: Coordinate }
  | { type: 'bomb'; troopId: string; coordinate: Coordinate }
  | { type: 'push'; troopId: string; coordinate: Coordinate; destination: Coordinate; targetUnitId?: UnitId; targetBomb?: boolean }
  | { type: 'pull'; troopId: string; coordinate: Coordinate; destination: Coordinate; targetUnitId?: UnitId; targetBomb?: boolean }
  | { type: 'stun'; troopId: string; coordinate: Coordinate }
  | { type: 'magic'; troopId: string; coordinate: Coordinate }
  | { type: 'mending'; troopId: string; coordinate: Coordinate }
  | { type: 'upgrade'; troopId: string; coordinate: Coordinate; ability: UpgradableAbility }
  | { type: 'defense'; troopId: string; coordinate: Coordinate }
  | { type: 'magic-defense'; troopId: string; coordinate: Coordinate }
  | { type: 'self-defense'; troopId: string }
  | { type: 'self-magic-defense'; troopId: string }
  | { type: 'resolve-move'; troopId: string; coordinate: Coordinate }
  | { type: 'resolve-death-attack'; troopId: string; coordinate: Coordinate; targetUnitId: UnitId }
  | { type: 'resolve-instant-ranged'; troopId: string; coordinate: Coordinate }
  | { type: 'resolve-instant-magic'; troopId: string; coordinate: Coordinate }
  | { type: 'resolve-stun'; troopId: string; coordinate: Coordinate; targetUnitId: UnitId }
  | { type: 'resolve-pull'; troopId: string; coordinate: Coordinate; destination: Coordinate; targetUnitId: UnitId }
  | { type: 'resolve-revive'; troopId: string; targetTroopId: string }
  | { type: 'resolve-pass'; troopId: string };

/** Stable identity for a card in a match. A card can exist once for each owner. */
export type UnitId = `${Player}:${string}`;
/** Ordered timing windows within one player's turn. */
export type TurnPhase = 'start' | 'action' | 'action-resolve' | 'combat-resolve' | 'end';
export interface Upgrade { ability: UpgradableAbility; left?: number; right?: number; sourceUnitId: UnitId; }
export interface Shield { value: number; sourceUnitId?: UnitId; }
export interface UnitState { id?: UnitId; troopId: string; owner: Player; coordinate: Coordinate; permanentDamage: number; rangedDamageBonus?: number; rangedRangeBonus?: number; combatModifierBonus?: number; bashModifierBonus?: number; magicModifierBonus?: number; stunnedTurns?: number; upgrades?: Upgrade[]; shields?: Shield[]; }
export interface Effect { owner: Player; sourceTroopId: string; sourceUnitId?: UnitId; targetUnitId?: UnitId; kind: 'attack' | 'cannon' | 'gore' | 'bomb' | 'magic' | 'stun'; target: Coordinate; value: number; /** Pierce attacks ignore the target's physical modifier. */ pierce?: boolean; /** Source coordinate for a moving delayed action, or center of a bomb area effect. */ origin?: Coordinate; /** Final landing coordinate shared by every effect in a delayed Gore charge. */ goreDestination?: Coordinate; }
export interface Bomb { owner: Player; sourceTroopId: string; coordinate: Coordinate; damage: number; pierce?: boolean; }
interface Bash { attackerId: string; defenderId: string; target: Coordinate; }
export interface GameEvent { revision: number; player: Player; action: GameAction; /** Hex vacated by the completed move, flight, or push. */ origin?: Coordinate; }
export type Trigger = EventCondition;
/** Runtime context supplied to card passives. `troopIds` always identifies every troop involved. */
export interface TriggerEvent {
  trigger: Trigger;
  /** The player whose turn/action caused the event. */
  player: Player;
  hex?: Coordinate;
  troopIds: UnitId[];
  actingTroopId?: string;
  attackerId?: UnitId;
  defenderId?: UnitId;
  targetUnitId?: UnitId;
  /** Action kind that produced a delayed event after another action became current. */
  actionKind?: CardAction['kind'];
  firstStrike?: {
    unitId: UnitId;
    targetId: UnitId;
    firstDamage: number;
    retaliationDamage: number;
    targetSurvived: boolean;
  };
}
export interface DashboardUnitSnapshot { unitId: UnitId; troopId: string; owner: Player; health: number; }
export interface DashboardTarget { hex: Coordinate; units: DashboardUnitSnapshot[]; }
export interface DashboardOutcome { moved?: Array<{ unitId: UnitId; from: Coordinate; to: Coordinate }>; damaged?: Array<{ unitId: UnitId; amount: number }>; healed?: Array<{ unitId: UnitId; amount: number }>; defeated?: UnitId[]; }
export interface StackAction {
  id: number;
  parentId?: number;
  causedByTriggerId?: string;
  status: 'checking-triggers' | 'waiting-input' | 'ready' | 'resolved';
  phase: TurnPhase;
  activePlayer: Player;
  controller: Player;
  sourceUnitId?: UnitId;
  signal?: EventCondition;
  action: CardAction;
  targetHexes: Coordinate[];
  targets: DashboardTarget[];
  outcome?: DashboardOutcome;
}
export type PendingResolution = (
  | { owner: Player; turnPlayer: Player; sourceUnitId: UnitId; sourceTroopId: string; kind: 'optional-move'; distance: number }
  | { owner: Player; turnPlayer: Player; sourceTroopId: string; kind: 'death-attack'; origin: Coordinate; damage: number; range: number }
  | { owner: Player; turnPlayer: Player; sourceTroopId: string; kind: 'instant-ranged'; origin: Coordinate; damage: number; range: number; remaining: number; optional?: boolean }
  | { owner: Player; turnPlayer: Player; sourceTroopId: string; kind: 'instant-magic'; origin: Coordinate; damage: number; range: number; pierce?: boolean }
  | { owner: Player; turnPlayer: Player; sourceTroopId: string; kind: 'stun'; origin: Coordinate; turns: number; range: number }
  | { owner: Player; turnPlayer: Player; sourceUnitId: UnitId; sourceTroopId: string; kind: 'trigger-pull'; distance: number; range: number }
  | { owner: Player; turnPlayer: Player; sourceTroopId: string; kind: 'revive' }
) & { stackActionId?: number; /** Start-trigger choices resume the same player's normal action phase. */ resumeTurn?: boolean };
export interface GameState { activePlayer: Player; phase?: TurnPhase; winner?: Player; units: UnitState[]; effects: Effect[]; bashes: Bash[]; bombs?: Bomb[]; pendingResolution?: PendingResolution; pendingResolutionQueue?: PendingResolution[]; lastActingTroopId?: Partial<Record<Player, string>>; defeatedTroopIds?: string[]; revision?: number; events?: GameEvent[]; triggerEvents?: TriggerEvent[]; dashboard?: StackAction[]; resolutionStack?: number[]; currentEventId?: number; nextDashboardId?: number; deckOrder?: Partial<Record<Player, string[]>>; }

export function createGameState(deckOrder?: Partial<Record<Player, string[]>>): GameState { return { activePlayer: 1, phase: 'action', units: [], effects: [], bashes: [], bombs: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: [], triggerEvents: [], dashboard: [], resolutionStack: [], nextDashboardId: 1, ...(deckOrder ? { deckOrder: structuredClone(deckOrder) } : {}) }; }
export function unitId(unit: Pick<UnitState, 'owner' | 'troopId' | 'id'>): UnitId { return unit.id ?? `${unit.owner}:${unit.troopId}`; }
function findUnit(state: GameState, id: string): UnitState | undefined { return state.units.find(unit => unit.id === id || unitId(unit) === id || (!unit.id && unit.troopId === id)); }
function health(unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number { return Math.max(0, (cards.get(unit.troopId)?.baseHealth ?? 0) - unit.permanentDamage); }
export interface ModifierEntry { label: string; value: number; }
export interface CombatSummary {
  health: number;
  modifier: number;
  magicModifier: number;
  modifiers: ModifierEntry[];
  total: number;
  controller?: Player;
}
function combatUnitAndVirtual(state: GameState, troopId: string, contestedCoordinate?: Coordinate): { unit: UnitState; virtual?: UnitState } {
  const unit = findUnit(state, troopId);
  if (!unit) throw new Error('Troop is not on the board.');
  const bash = contestedCoordinate ? state.bashes.find(item => item.target === contestedCoordinate) : undefined;
  const bashAttacker = bash ? findUnit(state, bash.attackerId) : undefined;
  const virtual = contestedCoordinate
    ? { ...((bashAttacker && unitId(bashAttacker) === unitId(unit)) ? bashAttacker : unit), coordinate: contestedCoordinate }
    : undefined;
  return { unit, virtual };
}
export function combatBreakdown(state: GameState, troopId: string, cards: ReadonlyMap<string, TroopSeed>, contestedCoordinate?: Coordinate): { health: number; modifier: number; total: number; controller?: Player } {
  const { modifiers: _modifiers, magicModifier: _magicModifier, ...breakdown } = combatSummary(state, troopId, cards, contestedCoordinate);
  return breakdown;
}
export function combatSummary(state: GameState, troopId: string, cards: ReadonlyMap<string, TroopSeed>, contestedCoordinate?: Coordinate): CombatSummary {
  const { unit, virtual } = combatUnitAndVirtual(state, troopId, contestedCoordinate);
  const currentHealth = health(unit, cards);
  const modifiers = modifierEntries(state, unit, cards, virtual);
  const currentModifier = modifiers.reduce((sum, entry) => sum + entry.value, 0);
  return { health: currentHealth, modifier: currentModifier, magicModifier: unit.magicModifierBonus ?? 0, modifiers, total: currentHealth + currentModifier, controller: controller(state, contestedCoordinate ?? unit.coordinate, cards, virtual) };
}
function card(cards: ReadonlyMap<string, TroopSeed>, id: string): TroopSeed { const result = cards.get(id); if (!result) throw new Error('Unknown troop.'); return result; }
function at(state: GameState, coordinate: Coordinate): UnitState | undefined { return state.units.find(unit => unit.coordinate === coordinate); }
/** An effect aimed at a bash hex follows the opposing participant after combat. */
function offensiveTargetAt(state: GameState, player: Player, coordinate: Coordinate): UnitState | undefined {
  const bash = state.bashes.find(item => item.target === coordinate);
  if (!bash) return at(state, coordinate);
  return [findUnit(state, bash.attackerId), findUnit(state, bash.defenderId)].find(unit => unit?.owner !== player) ?? at(state, coordinate);
}
function actionType(action: TroopAction): UpgradableAbility {
  if (action.kind === 'defense' && action.type?.includes('magic')) return 'magic-defense';
  if (action.kind === 'fly') return 'fly';
  if (action.kind === 'ranged') return 'attack';
  if (action.kind === 'cannon') return 'cannon';
  if (action.kind === 'gore') return 'gore';
  if (action.kind === 'fire') return 'magic';
  if (action.kind === 'pull') return 'pull';
  if (action.kind === 'stun') return 'stun';
  return action.kind as UpgradableAbility;
}
function actionOfType(troop: TroopSeed, type: UpgradableAbility): LegacyActionView | undefined {
  const action = troop.actions.find(candidate => actionType(candidate) === type);
  if (!action) return undefined;
  const first = amount(action) ?? 0; const second = amount(action, 1) ?? 0;
  return { type, range: action.range, amount: first, maxDistance: type === 'move' || type === 'fly' ? action.range : first, damage: first, block: first, left: first, right: second, usesHealth: type === 'attack' && action.amount === undefined, qualifiers: action.type };
}
function amount(action: TroopAction | undefined, index = 0): number | undefined {
  return Array.isArray(action?.amount) ? action.amount[index] : index === 0 ? action?.amount as number | undefined : undefined;
}
function snapshotTargets(state: GameState, targetHexes: readonly Coordinate[], cards: ReadonlyMap<string, TroopSeed>): DashboardTarget[] {
  return targetHexes.map(hex => ({ hex, units: state.units.filter(unit => unit.coordinate === hex).map(unit => ({ unitId: unitId(unit), troopId: unit.troopId, owner: unit.owner, health: health(unit, cards) })) }));
}
function appendStackAction(state: GameState, cards: ReadonlyMap<string, TroopSeed>, entry: Omit<StackAction, 'id' | 'targets'> & { targets?: DashboardTarget[] }): StackAction {
  state.dashboard ??= []; state.resolutionStack ??= []; state.nextDashboardId ??= 1;
  const row: StackAction = { ...entry, id: state.nextDashboardId++, targets: entry.targets ?? snapshotTargets(state, entry.targetHexes, cards) };
  state.dashboard.push(row); state.resolutionStack.push(row.id); state.currentEventId = row.id;
  return row;
}
function finishStackAction(state: GameState, id: number, outcome?: DashboardOutcome): void {
  const row = state.dashboard?.find(candidate => candidate.id === id);
  if (row) { row.status = 'resolved'; if (outcome) row.outcome = outcome; }
  state.resolutionStack = (state.resolutionStack ?? []).filter(candidate => candidate !== id);
  state.currentEventId = state.resolutionStack.at(-1);
}
function actionForCommand(action: GameAction, cards: ReadonlyMap<string, TroopSeed>): CardAction {
  if ('troopId' in action && !action.type.startsWith('resolve-')) {
    const troop = cards.get(action.troopId);
    const ability = action.type === 'self-defense' || action.type === 'self-magic-defense' ? undefined : action.type as UpgradableAbility;
    const printed = ability && troop?.actions.find(candidate => actionType(candidate) === ability);
    if (printed) return structuredClone(printed);
    if (action.type === 'self-defense') return { kind: 'defense', amount: troop?.selfDefense ?? 1, range: 0 };
    if (action.type === 'self-magic-defense') return { kind: 'defense', amount: troop?.selfMagicDefense ?? 0, range: 0, type: ['magic'] };
  }
  if (action.type === 'pass') return { kind: 'pass', range: 0 };
  if (action.type === 'deploy') return { kind: 'deploy', range: 0 };
  if (action.type === 'move' || action.type === 'resolve-move') return { kind: 'move', range: 0 };
  if (action.type === 'fly') return { kind: 'fly', range: 0 };
  if (action.type === 'attack' || action.type === 'resolve-death-attack' || action.type === 'resolve-instant-ranged') return { kind: 'ranged', range: 0 };
  if (action.type === 'resolve-instant-magic') return { kind: 'fire', range: 0 };
  if (action.type === 'resolve-stun') return { kind: 'stun', range: 0 };
  if (action.type === 'resolve-pull') return { kind: 'pull', range: 0 };
  if (action.type === 'magic-defense') return { kind: 'defense', range: 0, type: ['magic'] };
  if (action.type === 'magic') return { kind: 'fire', range: 0 };
  if (action.type === 'self-defense' || action.type === 'self-magic-defense') return { kind: 'defense', range: 0 };
  if (action.type === 'resolve-pass') return { kind: 'pass', range: 0, type: ['optional'] };
  if (action.type === 'resolve-revive') return { kind: 'revive', range: 0 };
  return { kind: action.type, range: 0 };
}
function beginCommandRow(state: GameState, player: Player, action: GameAction, cards: ReadonlyMap<string, TroopSeed>): StackAction {
  const targetHexes = ['coordinate', 'destination'].flatMap(key => key in action && typeof action[key as keyof typeof action] === 'string' ? [action[key as keyof typeof action] as Coordinate] : []);
  const sourceUnitId = 'troopId' in action ? `${player}:${action.troopId}` as UnitId : undefined;
  return appendStackAction(state, cards, { status: 'checking-triggers', phase: state.phase ?? 'action', activePlayer: state.activePlayer, controller: player, ...(sourceUnitId ? { sourceUnitId } : {}), action: actionForCommand(action, cards), targetHexes });
}
function recordPhase(state: GameState, phase: TurnPhase, cards: ReadonlyMap<string, TroopSeed>): StackAction {
  state.phase = phase;
  return appendStackAction(state, cards, { status: 'checking-triggers', phase, activePlayer: state.activePlayer, controller: state.activePlayer, action: { kind: 'phase', range: 0, type: [phase] }, targetHexes: [] });
}
function completePhase(state: GameState, phase: TurnPhase, cards: ReadonlyMap<string, TroopSeed>): void { const row = recordPhase(state, phase, cards); finishStackAction(state, row.id); }
function finishOpenStack(state: GameState): void { for (const id of [...(state.resolutionStack ?? [])].reverse()) finishStackAction(state, id); }
function upgradeBonus(unit: UnitState, ability: UpgradableAbility): Required<Pick<Upgrade, 'left' | 'right'>> { return (unit.upgrades ?? []).filter(upgrade => upgrade.ability === ability || upgrade.ability === undefined).reduce((total, upgrade) => ({ left: total.left + (upgrade.left ?? 0), right: total.right + (upgrade.right ?? 0) }), { left: 0, right: 0 }); }
function staticBonus(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, ability: 'move' | 'attack' | 'magic'): { left: number; right: number } {
  return state.units.filter(source => source.owner === unit.owner).reduce((total, source) => {
    for (const bonus of cards.get(source.troopId)?.continuousEffects ?? []) {
      if (bonus.kind === 'ability-bonus' && bonus.condition === 'deployed' && bonus.ability === ability) {
        total.left += bonus.left ?? 0; total.right += bonus.right ?? 0;
      }
    }
    return total;
  }, { left: 0, right: 0 });
}
function moveRange(state: GameState, troop: TroopSeed, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number { return (actionOfType(troop, 'move')?.range ?? 0) + upgradeBonus(unit, 'move').right + staticBonus(state, unit, cards, 'move').right; }
function flyRange(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'fly')?.range ?? 0) + upgradeBonus(unit, 'fly').right; }
function actionRange(state: GameState, troop: TroopSeed, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, type: 'attack' | 'cannon' | 'gore' | 'bomb' | 'magic' | 'defense' | 'magic-defense' | 'push' | 'pull' | 'stun' | 'mending' | 'upgrade'): number {
  const action = actionOfType(troop, type);
  const aura = type === 'attack' || type === 'magic' ? staticBonus(state, unit, cards, type) : { right: 0 };
  return action ? action.range + upgradeBonus(unit, type).right + aura.right + (type === 'attack' ? unit.rangedRangeBonus ?? 0 : 0) : -1;
}
function attackDamage(state: GameState, troop: TroopSeed, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number {
  const action = actionOfType(troop, 'attack');
  return (action?.amount || health(unit, cards)) + (unit.rangedDamageBonus ?? 0) + upgradeBonus(unit, 'attack').left + staticBonus(state, unit, cards, 'attack').left;
}
function effectValue(state: GameState, troop: TroopSeed, cards: ReadonlyMap<string, TroopSeed>, unit: UnitState): number {
  return (actionOfType(troop, 'magic')?.amount || health(unit, cards)) + upgradeBonus(unit, 'magic').left + staticBonus(state, unit, cards, 'magic').left;
}
function cannonDamage(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'cannon')?.amount ?? 0) + upgradeBonus(unit, 'cannon').left; }
function goreDamage(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'gore')?.amount ?? 0) + upgradeBonus(unit, 'gore').left; }
function bombDamage(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'bomb')?.amount ?? 0) + upgradeBonus(unit, 'bomb').left; }

function igniteBomb(state: GameState, bomb: Bomb, owner: Player, pierce = false): void {
  state.bombs = state.bombs?.filter(item => item !== bomb);
  for (const target of [bomb.coordinate, ...adjacentCoordinates(bomb.coordinate)].filter(isBoardCoordinate)) {
    state.effects.push({ owner, sourceTroopId: bomb.sourceTroopId, kind: 'bomb', target, value: bomb.damage, origin: bomb.coordinate, ...(pierce ? { pierce: true } : {}) });
  }
}

/** Instant fire magic detonates the bomb immediately instead of leaving it lit. */
function explodeBombNow(state: GameState, bomb: Bomb, owner: Player, pierce: boolean, cards: ReadonlyMap<string, TroopSeed>): void {
  state.bombs = state.bombs?.filter(item => item !== bomb);
  for (const target of [bomb.coordinate, ...adjacentCoordinates(bomb.coordinate)].filter(isBoardCoordinate)) {
    const chainedBomb = state.bombs?.find(item => item.coordinate === target);
    if (chainedBomb) igniteBomb(state, chainedBomb, owner, pierce);
    for (const unit of state.units.filter(item => item.coordinate === target)) {
      if (!pierce && hasPassive(cards.get(unit.troopId), 'obsidian')) continue;
      const damage = pierce ? bomb.damage : Math.max(0, bomb.damage - (unit.magicModifierBonus ?? 0));
      unit.magicModifierBonus = undefined;
      unit.permanentDamage += damage;
      if (health(unit, cards) === 0) remove(state, unit, cards);
    }
  }
}
function shieldValue(unit: UnitState): number { return (unit.shields ?? []).reduce((sum, shield) => sum + shield.value, 0); }
function shieldedByAlly(unit: UnitState): boolean {
  return (unit.shields ?? []).some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unitId(unit));
}
function addShield(unit: UnitState, value: number, sourceUnitId: UnitId): void {
  unit.shields = [...(unit.shields ?? []), { value, sourceUnitId }];
}
function addMagicModifier(unit: UnitState, value: number): void { unit.magicModifierBonus = (unit.magicModifierBonus ?? 0) + value; }
function clearShield(unit: UnitState): void { delete unit.shields; }
function clearStunAtTurnEnd(state: GameState, player: Player): void {
  for (const unit of state.units.filter(candidate => candidate.owner === player && (candidate.stunnedTurns ?? 0) > 0)) {
    unit.stunnedTurns = (unit.stunnedTurns ?? 1) - 1;
    if (unit.stunnedTurns <= 0) delete unit.stunnedTurns;
  }
}
function isTrueAction(action: GameAction): boolean {
  return ['move', 'fly', 'attack', 'cannon', 'gore', 'bomb', 'push', 'pull', 'stun', 'magic', 'mending', 'upgrade', 'defense', 'magic-defense', 'self-defense', 'self-magic-defense'].includes(action.type);
}
/** Immediate abilities spend their upgrade straight away. Delayed attacks keep
 * it visible until their pending effect is actually resolved next turn. */
function spendUpgrade(unit: UnitState, action: GameAction): void { if (['move', 'fly', 'bomb', 'defense', 'magic-defense', 'self-defense', 'self-magic-defense', 'push', 'pull', 'stun', 'gore', 'mending', 'upgrade'].includes(action.type)) unit.upgrades = []; }
function pushLine(from: Coordinate, target: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number); const [targetX, targetY] = target.split(',').map(Number);
  const dx = targetX - fromX; const dy = targetY - fromY; const steps = hexDistance(from, target);
  if (!steps || !(dx === 0 || dy === 0 || dx === dy)) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx); const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: maxDistance }, (_, index) => `${targetX + stepX * (index + 1)},${targetY + stepY * (index + 1)}` as Coordinate);
  // A push displaces a troop in a straight line; unlike movement it may pass
  // over the board's central gap. Only the final landing hex must be playable.
  return isBoardCoordinate(line.at(-1)) ? line : undefined;
}
function pullLine(from: Coordinate, target: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number); const [targetX, targetY] = target.split(',').map(Number);
  const dx = fromX - targetX; const dy = fromY - targetY;
  if (maxDistance < 1 || !(dx === 0 || dy === 0 || dx === dy)) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx); const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: maxDistance }, (_, index) => `${targetX + stepX * (index + 1)},${targetY + stepY * (index + 1)}` as Coordinate);
  return isBoardCoordinate(line.at(-1)) ? line : undefined;
}
function displacementLine(type: 'push' | 'pull', from: Coordinate, target: Coordinate, maxDistance: number): Coordinate[] | undefined {
  return type === 'push' ? pushLine(from, target, maxDistance) : pullLine(from, target, maxDistance);
}
function hasFreePath(state: GameState, from: Coordinate, to: Coordinate, maxDistance: number): boolean {
  const visited = new Set<Coordinate>([from]); const queue: Array<[Coordinate, number]> = [[from, 0]];
  while (queue.length) { const [current, steps] = queue.shift() as [Coordinate, number]; if (steps === maxDistance) continue; for (const next of adjacentCoordinates(current)) { if (!isBoardCoordinate(next) || visited.has(next)) continue; if (next === to) return true; if (at(state, next)) continue; visited.add(next); queue.push([next, steps + 1]); } }
  return false;
}
export interface ControlState { id: string; type: 'starting' | 'intermediate' | 'front'; home?: Player; playerOne: number; playerTwo: number; controller?: Player; }
function controlAt(state: GameState, coordinate: Coordinate, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): ControlState {
  const target = regionAt(coordinate);
  if (!target) throw new Error('Invalid hex.');
  let playerOne = target.home === 1 ? .5 : 0;
  let playerTwo = target.home === 2 ? .5 : 0;
  const units = virtual
    ? [...state.units.filter(unit => unitId(unit) !== unitId(virtual)), virtual]
    : state.units;
  for (const unit of units) {
    if (regionAt(unit.coordinate)?.id !== target.id) continue;
    const contribution = health(unit, cards) + (cards.get(unit.troopId)?.control ?? 0);
    if (unit.owner === 1) playerOne += contribution;
    else playerTwo += contribution;
  }
  return {
    ...target,
    playerOne,
    playerTwo,
    controller: playerOne === playerTwo ? undefined : playerOne > playerTwo ? 1 : 2
  };
}

const REGION_REPRESENTATIVES: readonly Coordinate[] = ['1,2', '-1,-2', '0,1', '0,-1', '1,1', '-1,-1', '1,0'];

export function controlSummary(state: GameState, cards: ReadonlyMap<string, TroopSeed>): Record<string, ControlState> {
  return Object.fromEntries(REGION_REPRESENTATIVES.map(coordinate => {
    // A pending attacker is already contesting the destination.  Use that
    // virtual position everywhere control is shown, just as bash resolution
    // does after the defender has completed their response.
    // The summary uses one representative coordinate per region.  A bash can
    // happen on any hex in that region, so find it by region rather than only
    // by that representative coordinate.
    const bash = state.bashes.find(item => regionAt(item.target)?.id === regionAt(coordinate)?.id);
    const attacker = bash ? findUnit(state, bash.attackerId) : undefined;
    const virtualAttacker = bash && attacker ? { ...attacker, coordinate: bash.target } : undefined;
    const summary = controlAt(state, coordinate, cards, virtualAttacker);
    return [summary.id, summary];
  }));
}
function controller(state: GameState, coordinate: Coordinate, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): Player | undefined { return controlAt(state, coordinate, cards, virtual).controller; }
function modifierEntries(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): ModifierEntry[] {
  const combatCoordinate = virtual?.coordinate ?? unit.coordinate;
  const block = shieldValue(unit);
  const bash = state.bashes.find(item => item.target === combatCoordinate && (item.attackerId === unitId(unit) || item.defenderId === unitId(unit)));
  // Steady is a live opposing-side bash passive. It suppresses the opponent's
  // shield, control, and conditional bonuses, never the Hawk's own modifier
  // or either troop's base health, and applies whether the Hawk attacks or
  // defends.
  if (bash) {
    const opponentId = bash.attackerId === unitId(unit) ? bash.defenderId : bash.attackerId;
    if (hasPassive(cards.get(findUnit(state, opponentId)?.troopId ?? ''), 'steady')) return [];
  }
  const entries: ModifierEntry[] = [];
  if (block) entries.push({ label: 'Shield', value: block });
  if (unit.combatModifierBonus) entries.push({ label: 'Permanent', value: unit.combatModifierBonus });
  for (const source of state.units.filter(candidate => candidate.owner === unit.owner)) {
    for (const effect of cards.get(source.troopId)?.continuousEffects ?? []) {
      if (effect.kind !== 'combat-modifier' || (effect.scope ?? 'self') === 'self' && unitId(source) !== unitId(unit)) continue;
      const active = effect.condition === 'bash-attacker' ? bash?.attackerId === unitId(unit)
        : effect.condition === 'bash-attacker-vs-hero' ? bash?.attackerId === unitId(unit) && Boolean(findUnit(state, bash.defenderId) && card(cards, findUnit(state, bash.defenderId)?.troopId ?? '').role === 'hero')
        : effect.condition === 'in-bash' ? Boolean(bash)
        : effect.condition === 'injured' ? unit.permanentDamage > 0
        : effect.condition === 'shielded' ? block > 0
        : effect.condition === 'shielded-by-ally' ? shieldedByAlly(unit)
        : false;
      if (active) entries.push({ label: effect.label, value: effect.value + ((effect.scope ?? 'self') === 'self' && effect.condition === 'in-bash' ? unit.bashModifierBonus ?? 0 : 0) });
    }
  }
  if (controller(state, combatCoordinate, cards, virtual) === unit.owner) entries.push({ label: 'Control', value: 1 });
  return entries;
}
function modifier(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): number { return modifierEntries(state, unit, cards, virtual).reduce((sum, entry) => sum + entry.value, 0); }
function enqueueResolution(state: GameState, resolution: PendingResolution): void {
  if (state.phase === 'start') resolution.resumeTurn = true;
  if (!state.pendingResolution) state.pendingResolution = resolution;
  else (state.pendingResolutionQueue ??= []).push(resolution);
}

function pendingResumesTurn(state: GameState, pending: PendingResolution): boolean {
  return pending.resumeTurn === true
    || Boolean(pending.stackActionId && state.dashboard?.find(row => row.id === pending.stackActionId)?.phase === 'start');
}

function optionalMoveTargets(state: GameState, source: UnitState, distance: number): Coordinate[] {
  return PLAYABLE_COORDINATES.filter(coordinate => {
    if (hexDistance(source.coordinate, coordinate) > distance || state.bashes.some(bash => bash.target === coordinate)) return false;
    if (at(state, coordinate)?.owner === source.owner) return false;
    return hasFreePath(state, source.coordinate, coordinate, distance);
  });
}

function stunTargets(state: GameState, owner: Player, origin: Coordinate, range: number): UnitState[] {
  return state.units.filter(unit => unit.owner !== owner && hexDistance(origin, unit.coordinate) <= range);
}

function pullTargets(state: GameState, source: UnitState, distance: number, range: number): Array<{ target: UnitState; destination: Coordinate }> {
  const targets: Array<{ target: UnitState; destination: Coordinate }> = [];
  for (const target of stunTargets(state, source.owner, source.coordinate, range)) {
    const line = displacementLine('pull', source.coordinate, target.coordinate, distance);
    const destination = line?.at(-1);
    if (!destination || state.bashes.some(bash => bash.target === destination) || at(state, destination)?.owner === target.owner) continue;
    targets.push({ target, destination });
  }
  return targets;
}

function remove(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): void {
  const deathHex = unit.coordinate;
  const troop = card(cards, unit.troopId);
  state.units = state.units.filter(item => item !== unit);
  state.defeatedTroopIds ??= [];
  state.defeatedTroopIds.push(unitId(unit));
  if (troop.role === 'hero') state.winner = unit.owner === 1 ? 2 : 1;
  for (const trigger of troop.triggers?.filter(item => item.condition.signal === 'death') ?? []) {
    const resolution = trigger.action;
    const row = appendStackAction(state, cards, { parentId: state.currentEventId, causedByTriggerId: `${troop.id}:${trigger.id}`, status: 'ready', phase: state.phase ?? 'combat-resolve', activePlayer: state.activePlayer, controller: unit.owner, sourceUnitId: unitId(unit), signal: 'death', action: structuredClone(resolution), targetHexes: [deathHex], targets: [{ hex: deathHex, units: [{ unitId: unitId(unit), troopId: unit.troopId, owner: unit.owner, health: 0 }] }] });
    if (resolution.kind === 'ranged' && !resolution.type?.includes('instant') && state.units.some(target => target.owner !== unit.owner && hexDistance(deathHex, target.coordinate) <= resolution.range)) {
      row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: state.activePlayer, sourceTroopId: unit.troopId, kind: 'death-attack', origin: deathHex, damage: amount(resolution) ?? 0, range: resolution.range, stackActionId: row.id });
    }
    if (resolution.kind === 'ranged' && resolution.type?.includes('instant')) {
      row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: state.activePlayer, sourceTroopId: unit.troopId, kind: 'instant-ranged', origin: deathHex, damage: amount(resolution) ?? 0, range: resolution.range, remaining: amount(resolution, 1) ?? 1, ...(resolution.type.includes('optional') ? { optional: true } : {}), stackActionId: row.id });
    }
    if (resolution.kind === 'revive' && state.defeatedTroopIds.some(id => id !== unitId(unit) && id.startsWith(`${unit.owner}:`) && cards.get(id.split(':').slice(1).join(':'))?.role !== 'hero')) {
      row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: state.activePlayer, sourceTroopId: unit.troopId, kind: 'revive', stackActionId: row.id });
    }
    if (row.status !== 'waiting-input') finishStackAction(state, row.id);
  }
}

export type PassiveHandler = (state: GameState, unit: UnitState, event: TriggerEvent, cards: ReadonlyMap<string, TroopSeed>) => void;
const customEventHandlers: Partial<Record<Trigger, Partial<Record<string, PassiveHandler>>>> = {};

function triggerMatches(trigger: TriggerDefinition, unit: UnitState, event: TriggerEvent, activeAction?: CardAction): boolean {
  if (trigger.condition.signal && trigger.condition.signal !== event.trigger) return false;
  if (trigger.condition.kind === 'phase' && !['start', 'end', 'opponentStart', 'opponentEnd'].includes(event.trigger)) return false;
  if (trigger.condition.kind === 'phase' && trigger.condition.type?.includes('start') && event.trigger !== 'start') return false;
  if (trigger.condition.kind === 'phase' && trigger.condition.type?.includes('end') && event.trigger !== 'end') return false;
  if (trigger.condition.kind && trigger.condition.kind !== (event.actionKind ?? activeAction?.kind)) return false;
  if (trigger.condition.type?.some(type => !activeAction?.type?.includes(type))) return false;
  if (trigger.condition.subject !== 'self') return true;
  if (event.trigger === 'start' || event.trigger === 'end' || event.trigger === 'opponentStart' || event.trigger === 'opponentEnd') return true;
  if (event.trigger === 'bashAttack') return event.attackerId === unitId(unit);
  if (event.trigger === 'bashDefense') return event.defenderId === unitId(unit);
  if (event.trigger === 'bashResolved') return event.troopIds.includes(unitId(unit));
  return event.actingTroopId === unit.troopId || event.troopIds.includes(unitId(unit));
}

function resolveTriggeredAction(state: GameState, unit: UnitState, event: TriggerEvent, trigger: TriggerDefinition, cards: ReadonlyMap<string, TroopSeed>, row: StackAction): void {
    const action = trigger.action;
    if (action.kind === 'heal') { const value = amount(action) ?? 0; unit.permanentDamage = Math.max(0, unit.permanentDamage - value); row.outcome = { healed: [{ unitId: unitId(unit), amount: value }] }; }
    else if (action.kind === 'upgrade' && action.type?.includes('permanent') && action.type.includes('attack')) {
      unit.rangedDamageBonus = (unit.rangedDamageBonus ?? 0) + (amount(action) ?? 0);
      unit.rangedRangeBonus = (unit.rangedRangeBonus ?? 0) + (amount(action, 1) ?? 0);
    }
    else if (action.kind === 'damage' && action.type?.includes('permanent')) {
      const value = amount(action) ?? 0; unit.permanentDamage += value; row.outcome = { damaged: [{ unitId: unitId(unit), amount: value }] };
      if (health(unit, cards) === 0) remove(state, unit, cards);
    }
    else if (action.kind === 'modifier' && action.type?.includes('permanent') && action.type.includes('bash')) unit.bashModifierBonus = (unit.bashModifierBonus ?? 0) + (amount(action) ?? 0);
    else if (action.kind === 'modifier' && action.type?.includes('permanent') && action.type.includes('magic')) unit.magicModifierBonus = (unit.magicModifierBonus ?? 0) + (amount(action) ?? 0);
    else if (action.kind === 'modifier' && action.type?.includes('permanent') && !action.type.includes('bash')) {
      unit.combatModifierBonus = (unit.combatModifierBonus ?? 0) + (amount(action) ?? 0);
      if (Array.isArray(action.amount)) unit.magicModifierBonus = (unit.magicModifierBonus ?? 0) + (amount(action, 1) ?? 0);
    }
    else if (action.kind === 'ranged' && action.type?.includes('instant') && event.player === unit.owner) {
      row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: event.player, sourceTroopId: unit.troopId, kind: 'instant-ranged', origin: unit.coordinate, damage: amount(action) ?? 0, range: action.range, remaining: amount(action, 1) ?? 1, ...(action.type.includes('optional') ? { optional: true } : {}), stackActionId: row.id });
    }
    else if (action.kind === 'fire' && action.type?.includes('instant') && event.player === unit.owner) {
      row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: event.player, sourceTroopId: unit.troopId, kind: 'instant-magic', origin: unit.coordinate, damage: amount(action) ?? 0, range: action.range, ...(action.type.includes('pierce') ? { pierce: true } : {}), stackActionId: row.id });
    }
    else if (action.kind === 'stun' && event.targetUnitId && event.player === unit.owner) {
      const target = findUnit(state, event.targetUnitId);
      if (target && target.owner !== unit.owner) {
        target.stunnedTurns = Math.max(target.stunnedTurns ?? 0, amount(action) ?? 0);
        clearShield(target); target.magicModifierBonus = undefined; target.combatModifierBonus = undefined; target.bashModifierBonus = undefined;
        state.effects.push({ owner: unit.owner, sourceTroopId: unit.troopId, sourceUnitId: unitId(unit), targetUnitId: unitId(target), kind: 'stun', target: target.coordinate, value: amount(action) ?? 0 });
      }
    }
    else if (action.kind === 'stun' && event.player === unit.owner) {
      if (stunTargets(state, unit.owner, unit.coordinate, action.range).length) {
        row.status = 'waiting-input';
        enqueueResolution(state, { owner: unit.owner, turnPlayer: event.player, sourceTroopId: unit.troopId, kind: 'stun', origin: unit.coordinate, turns: amount(action) ?? 0, range: action.range, stackActionId: row.id });
      }
    }
    else if (action.kind === 'pull' && event.player === unit.owner) {
      if (pullTargets(state, unit, amount(action) ?? 0, action.range).length) {
        row.status = 'waiting-input';
        enqueueResolution(state, { owner: unit.owner, turnPlayer: event.player, sourceUnitId: unitId(unit), sourceTroopId: unit.troopId, kind: 'trigger-pull', distance: amount(action) ?? 0, range: action.range, stackActionId: row.id });
      }
    }
    else if (action.kind === 'defense' && action.type?.includes('adjacent') && event.player === unit.owner) {
      for (const coordinate of adjacentCoordinates(unit.coordinate)) {
        const ally = at(state, coordinate);
        if (ally?.owner !== unit.owner) continue;
        addShield(ally, amount(action) ?? 0, unitId(unit));
      }
    }
    // Triggered moves are always optional (declinable) unless a future type
    // qualifier marks them mandatory. The pending choice owns the Skip action.
    else if (action.kind === 'move' && event.player === unit.owner) {
      if (optionalMoveTargets(state, unit, action.range).length) {
        row.status = 'waiting-input'; enqueueResolution(state, { owner: unit.owner, turnPlayer: event.player, sourceUnitId: unitId(unit), sourceTroopId: unit.troopId, kind: 'optional-move', distance: action.range, stackActionId: row.id });
      }
    }
}

export function registerPassive(trigger: Trigger, troopId: string, handler: PassiveHandler): () => void {
  return registerEventHandler(trigger, troopId, handler);
}

/** Register imperative behavior for exceptional event effects not expressible by EventResolution. */
export function registerEventHandler(trigger: Trigger, troopId: string, handler: PassiveHandler): () => void {
  const handlers = customEventHandlers[trigger] ?? (customEventHandlers[trigger] = {});
  const previous = handlers[troopId];
  handlers[troopId] = handler;
  return () => { if (previous) handlers[troopId] = previous; else delete handlers[troopId]; };
}

/**
 * Invoke a trigger for the specified listeners. The trigger is recorded so a
 * reconnecting client can explain why a passive effect occurred.
 */
export function dispatchTrigger(state: GameState, event: TriggerEvent, cards: ReadonlyMap<string, TroopSeed>, listenerOwners: readonly Player[] = [1, 2]): void {
  state.triggerEvents ??= [];
  state.triggerEvents.push(structuredClone(event));
  const handlers = customEventHandlers[event.trigger] ?? {};
  const priority = (unit: UnitState): [number, number, number, string] => {
    const deckIndex = state.deckOrder?.[unit.owner]?.indexOf(unit.troopId) ?? -1;
    return [unit.owner === state.activePlayer ? 0 : 1, deckIndex >= 0 ? deckIndex : Number.MAX_SAFE_INTEGER, card(cards, unit.troopId).role === 'hero' ? 0 : 1, unit.troopId];
  };
  const units = state.units.filter(unit => listenerOwners.includes(unit.owner)).sort((left, right) => {
    const a = priority(left); const b = priority(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]);
  });
  const parentId = state.currentEventId;
  const activeAction = state.dashboard?.find(row => row.id === parentId)?.action;
  const matches = units.flatMap(unit => (card(cards, unit.troopId).triggers ?? []).filter(trigger => triggerMatches(trigger, unit, event, activeAction)).map(trigger => ({ unit, trigger })));
  const rows = matches.map(({ unit, trigger }) => appendStackAction(state, cards, {
    ...(parentId ? { parentId } : {}), causedByTriggerId: `${unit.troopId}:${trigger.id}`, status: 'ready', phase: state.phase ?? 'action-resolve', activePlayer: state.activePlayer, controller: unit.owner, sourceUnitId: unitId(unit), signal: event.trigger, action: structuredClone(trigger.action), targetHexes: event.hex ? [event.hex] : []
  }));
  // appendStackAction records declaration order; the actual LIFO stack is
  // loaded in reverse so the first priority entry resolves first.
  const rowIds = new Set(rows.map(row => row.id));
  state.resolutionStack = (state.resolutionStack ?? []).filter(id => !rowIds.has(id));
  state.resolutionStack.push(...rows.map(row => row.id).reverse());
  state.currentEventId = state.resolutionStack.at(-1);
  for (let index = 0; index < matches.length; index++) {
    const { unit, trigger } = matches[index]; const row = rows[index];
    resolveTriggeredAction(state, unit, event, trigger, cards, row);
    if (row.status !== 'waiting-input') finishStackAction(state, row.id, row.outcome);
  }
  for (const unit of units) handlers[unit.troopId]?.(state, unit, event, cards);
  const parent = state.dashboard?.find(row => row.id === parentId);
  if (parent?.status === 'checking-triggers') parent.status = 'ready';
}

/**
 * Enumerate actions that the engine would accept for one troop right now.
 * This is the single source of truth used by server-side selection validation
 * and by clients when presenting targets.
 */
export function availableActionsFor(state: GameState, player: Player, troopId: string, cards: ReadonlyMap<string, TroopSeed>): GameAction[] {
  if (state.pendingResolution) {
    const pending = state.pendingResolution;
    if (pending.owner !== player || pending.sourceTroopId !== troopId) return [];
    const choices: GameAction[] = [{ type: 'resolve-pass', troopId }];
    if (pending.kind === 'optional-move') {
      const source = findUnit(state, pending.sourceUnitId); if (!source) return choices;
      for (const coordinate of optionalMoveTargets(state, source, pending.distance)) choices.push({ type: 'resolve-move', troopId, coordinate });
    } else if (pending.kind === 'death-attack') {
      for (const target of state.units.filter(unit => unit.owner !== player && hexDistance(pending.origin, unit.coordinate) <= pending.range)) {
        choices.push({ type: 'resolve-death-attack', troopId, coordinate: target.coordinate, targetUnitId: unitId(target) });
      }
    } else if (pending.kind === 'instant-ranged') {
      for (const coordinate of PLAYABLE_COORDINATES.filter(coordinate => hexDistance(pending.origin, coordinate) <= pending.range)) choices.push({ type: 'resolve-instant-ranged', troopId, coordinate });
    } else if (pending.kind === 'instant-magic') {
      for (const coordinate of PLAYABLE_COORDINATES.filter(coordinate => hexDistance(pending.origin, coordinate) <= pending.range)) choices.push({ type: 'resolve-instant-magic', troopId, coordinate });
    } else if (pending.kind === 'stun') {
      for (const target of stunTargets(state, player, pending.origin, pending.range)) choices.push({ type: 'resolve-stun', troopId, coordinate: target.coordinate, targetUnitId: unitId(target) });
    } else if (pending.kind === 'trigger-pull') {
      const source = findUnit(state, pending.sourceUnitId);
      if (source) for (const { target, destination } of pullTargets(state, source, pending.distance, pending.range)) choices.push({ type: 'resolve-pull', troopId, coordinate: target.coordinate, destination, targetUnitId: unitId(target) });
    } else {
      for (const defeatedId of state.defeatedTroopIds ?? []) {
        const targetTroopId = defeatedId.split(':').slice(1).join(':');
        if (targetTroopId !== pending.sourceTroopId && defeatedId.startsWith(`${player}:`) && cards.get(targetTroopId)?.role !== 'hero') choices.push({ type: 'resolve-revive', troopId, targetTroopId });
      }
    }
    return choices;
  }
  const troop = cards.get(troopId);
  const deployedUnit = state.units.find(item => item.owner === player && item.troopId === troopId);
  if (!troop || state.winner || state.activePlayer !== player || state.lastActingTroopId?.[player] === troopId || (deployedUnit?.stunnedTurns ?? 0) > 0 || state.defeatedTroopIds?.includes(`${player}:${troopId}`)) return [];
  const unit = deployedUnit;
  const available: GameAction[] = [];
  const addIfAccepted = (action: GameAction): void => {
    try {
      applyGameAction(state, player, action, cards);
      available.push(action);
    } catch {
      // Rejection is the engine's answer for this candidate.
    }
  };

  if (!unit) {
    for (const coordinate of PLAYABLE_COORDINATES) addIfAccepted({ type: 'deploy', troopId, coordinate });
    return available;
  }

  for (const action of troop.actions) {
    const type = actionType(action);
    if (type === 'push' || type === 'pull') {
      const bonus = upgradeBonus(unit, type);
      for (const coordinate of PLAYABLE_COORDINATES) {
        const line = displacementLine(type, unit.coordinate, coordinate, (amount(action) ?? 0) + bonus.left);
        const destination = line?.at(-1);
        if (destination) for (const target of state.units.filter(candidate => candidate.coordinate === coordinate)) {
          addIfAccepted({ type, troopId, coordinate, destination, targetUnitId: unitId(target) });
        }
        if (destination && state.bombs?.some(bomb => bomb.coordinate === coordinate)) {
          addIfAccepted({ type, troopId, coordinate, destination, targetBomb: true });
        }
      }
      continue;
    }
    if (type === 'upgrade') {
      for (const target of state.units.filter(candidate => candidate.owner === player)) {
        const targetCard = cards.get(target.troopId);
        if (!targetCard) continue;
        const abilities = [
          ...targetCard.actions.map(actionType),
          ...(targetCard.selfDefense !== undefined ? ['self-defense' as const] : []),
          ...(targetCard.selfMagicDefense !== undefined ? ['self-magic-defense' as const] : [])
        ];
        for (const ability of abilities) addIfAccepted({ type: 'upgrade', troopId, coordinate: target.coordinate, ability });
      }
      continue;
    }
    for (const coordinate of PLAYABLE_COORDINATES) {
      addIfAccepted({ type, troopId, coordinate } as GameAction);
    }
  }
  // Every troop may place its default self shield even before a threat exists.
  // The resulting shield is stored on that troop and follows it through
  // non-true triggered movement.
  addIfAccepted({ type: 'self-defense', troopId });
  if (troop.selfMagicDefense !== undefined) addIfAccepted({ type: 'self-magic-defense', troopId });
  return available;
}

export function applyGameAction(before: GameState, player: Player, action: GameAction, cards: ReadonlyMap<string, TroopSeed>): GameState {
  const state: GameState = structuredClone(before);
  // Persisted games from before phases were introduced resume in their only
  // player-input window. Event choices retain the phase that produced them.
  state.phase ??= state.pendingResolution ? 'end' : 'action';
  if (state.winner || (!state.pendingResolution && state.activePlayer !== player)) throw new Error('It is not your turn.');
  if (state.pendingResolution) {
    const pending = state.pendingResolution;
    if (pending.owner !== player || !('troopId' in action) || action.troopId !== pending.sourceTroopId || !['resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-instant-magic', 'resolve-stun', 'resolve-pull', 'resolve-revive', 'resolve-pass'].includes(action.type)) throw new Error('Resolve the pending event action first.');
    let origin: Coordinate | undefined;
    if (pending.kind === 'optional-move' && action.type === 'resolve-move') {
      const unit = findUnit(state, pending.sourceUnitId); if (!unit) throw new Error('Event source is no longer available.');
      if (!isBoardCoordinate(action.coordinate) || hexDistance(unit.coordinate, action.coordinate) > pending.distance || !hasFreePath(state, unit.coordinate, action.coordinate, pending.distance) || state.bashes.some(bash => bash.target === action.coordinate)) throw new Error('Resolve move is out of range.');
      const target = at(state, action.coordinate);
      origin = unit.coordinate;
      if (!target) unit.coordinate = action.coordinate;
      else if (target.owner === player) throw new Error('A friendly troop occupies this hex.');
      else {
        unit.coordinate = action.coordinate;
        const attackerId = unitId(unit); const defenderId = unitId(target);
        state.bashes.push({ attackerId, defenderId, target: action.coordinate });
        const event: TriggerEvent = { trigger: 'bash', player, hex: action.coordinate, troopIds: [attackerId, defenderId], actingTroopId: unit.troopId, attackerId, defenderId };
        dispatchTrigger(state, { ...event, trigger: 'bashAttack' }, cards, [player]);
        dispatchTrigger(state, { ...event, trigger: 'bashDefense' }, cards, [target.owner]);
        dispatchTrigger(state, event, cards, [player, target.owner]);
      }
    } else if (pending.kind === 'death-attack' && action.type === 'resolve-death-attack') {
      const target = findUnit(state, action.targetUnitId);
      if (!target || target.owner === player || target.coordinate !== action.coordinate || hexDistance(pending.origin, target.coordinate) > pending.range) throw new Error('Death attack target is invalid.');
      target.permanentDamage += Math.max(0, pending.damage - modifier(state, target, cards));
      clearShield(target);
      if (health(target, cards) === 0) remove(state, target, cards);
    } else if (pending.kind === 'instant-ranged' && action.type === 'resolve-instant-ranged') {
      if (!isBoardCoordinate(action.coordinate) || hexDistance(pending.origin, action.coordinate) > pending.range) throw new Error('Instant ranged target is invalid.');
      const target = at(state, action.coordinate);
      if (target && target.owner !== player) {
        target.permanentDamage += Math.max(0, pending.damage - modifier(state, target, cards));
        clearShield(target);
        if (health(target, cards) === 0) remove(state, target, cards);
      }
      if (pending.remaining > 1) enqueueResolution(state, { ...pending, remaining: pending.remaining - 1 });
    } else if (pending.kind === 'stun' && action.type === 'resolve-stun') {
      const target = findUnit(state, action.targetUnitId);
      if (!target || target.owner === player || target.coordinate !== action.coordinate || hexDistance(pending.origin, target.coordinate) > pending.range) throw new Error('Stun target is invalid.');
      target.stunnedTurns = Math.max(target.stunnedTurns ?? 0, pending.turns);
      clearShield(target);
      target.magicModifierBonus = undefined;
      target.combatModifierBonus = undefined;
      target.bashModifierBonus = undefined;
      state.effects.push({ owner: player, sourceTroopId: pending.sourceTroopId, targetUnitId: unitId(target), kind: 'stun', target: action.coordinate, value: pending.turns });
      dispatchTrigger(state, { trigger: 'stunUsed', player, hex: action.coordinate, troopIds: [`${player}:${pending.sourceTroopId}` as UnitId, unitId(target)], actingTroopId: pending.sourceTroopId, targetUnitId: unitId(target) }, cards, [player]);
    } else if (pending.kind === 'instant-magic' && action.type === 'resolve-instant-magic') {
      if (!isBoardCoordinate(action.coordinate) || hexDistance(pending.origin, action.coordinate) > pending.range) throw new Error('Instant magic target is invalid.');
      const bomb = state.bombs?.find(item => item.coordinate === action.coordinate);
      if (bomb) explodeBombNow(state, bomb, player, pending.pierce ?? false, cards);
      else {
        const target = at(state, action.coordinate);
        const pierceMagic = pending.pierce ?? false;
        if (target && target.owner !== player && (pierceMagic || !hasPassive(cards.get(target.troopId), 'obsidian'))) {
          const lethalThreshold = pending.damage - (pierceMagic ? 0 : (target.magicModifierBonus ?? 0));
          target.magicModifierBonus = undefined;
          if (health(target, cards) <= lethalThreshold) remove(state, target, cards);
        }
      }
    } else if (pending.kind === 'trigger-pull' && action.type === 'resolve-pull') {
      const source = findUnit(state, pending.sourceUnitId);
      const target = findUnit(state, action.targetUnitId);
      const line = source && target ? displacementLine('pull', source.coordinate, target.coordinate, pending.distance) : undefined;
      if (!source || !target || target.owner === player || target.coordinate !== action.coordinate || !line || action.destination !== line.at(-1) || state.bashes.some(bash => bash.target === action.destination)) throw new Error('Pull target is invalid.');
      const occupant = at(state, action.destination);
      if (occupant?.owner === target.owner) throw new Error('A pulled troop cannot land on a friendly troop.');
      target.coordinate = action.destination;
      if (occupant) {
        state.bashes.push({ attackerId: unitId(target), defenderId: unitId(occupant), target: action.destination });
        const bashEvent: TriggerEvent = { trigger: 'bash', player, hex: action.destination, troopIds: [unitId(target), unitId(occupant)], actingTroopId: source.troopId, attackerId: unitId(target), defenderId: unitId(occupant) };
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [target.owner]);
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [occupant.owner]);
        dispatchTrigger(state, bashEvent, cards, [target.owner, occupant.owner]);
      }
    } else if (pending.kind === 'revive' && action.type === 'resolve-revive') {
      const defeatedId = `${player}:${action.targetTroopId}`;
      if (action.targetTroopId === pending.sourceTroopId || !state.defeatedTroopIds?.includes(defeatedId) || cards.get(action.targetTroopId)?.role === 'hero') throw new Error('Revive target is invalid.');
      state.defeatedTroopIds = state.defeatedTroopIds.filter(id => id !== defeatedId);
      if (state.lastActingTroopId?.[player] === action.targetTroopId) delete state.lastActingTroopId[player];
    } else if (action.type !== 'resolve-pass') {
      throw new Error('This resolution does not support that action.');
    }
    state.pendingResolution = state.pendingResolutionQueue?.shift();
    if (!state.pendingResolution) state.pendingResolutionQueue = [];
    if (pending.stackActionId && state.pendingResolution?.stackActionId !== pending.stackActionId) finishStackAction(state, pending.stackActionId);
    state.revision = (state.revision ?? 0) + 1;
    state.events ??= [];
    state.events.push({ revision: state.revision, player, action: structuredClone(action), ...(origin ? { origin } : {}) });
    if (state.pendingResolution) return state;
    if (pendingResumesTurn(state, pending)) {
      finishOpenStack(state);
      completePhase(state, 'action', cards);
      return state;
    }
    state.phase = 'end';
    const turnPlayer = pending.turnPlayer;
    const opponentOfTurnPlayer = turnPlayer === 1 ? 2 : 1;
    dispatchTrigger(state, { trigger: 'opponentEnd', player: turnPlayer, troopIds: [], actingTroopId: pending.sourceTroopId }, cards, [opponentOfTurnPlayer]);
    finishOpenStack(state);
    clearStunAtTurnEnd(state, turnPlayer);
    state.activePlayer = turnPlayer === 1 ? 2 : 1;
    const startRow = recordPhase(state, 'start', cards);
    dispatchTrigger(state, { trigger: 'start', player: state.activePlayer, troopIds: [] }, cards, [state.activePlayer]);
    dispatchTrigger(state, { trigger: 'opponentStart', player: state.activePlayer, troopIds: [] }, cards, [turnPlayer]);
    finishStackAction(state, startRow.id); completePhase(state, 'action', cards);
    return state;
  }
  // Only combats that were already pending when this response began may
  // resolve afterward. A Push can create a bash whose defender belongs to the
  // acting player; that Push itself happened before the bash existed and must
  // not be mistaken for the defender's response.
  const bashesAwaitingResponse = new Set(state.bashes);
  const commandRow = beginCommandRow(state, player, action, cards);
  if (action.type === 'pass') {
    const turnEvent = { player, troopIds: [] as UnitId[] };
    // Passing is still the defender's response.  Resolve delayed attacks,
    // magic, bashes, and their temporary upgrades exactly as after any other
    // response action, before end-of-turn triggers run.
    commandRow.status = 'ready'; completePhase(state, 'combat-resolve', cards);
    resolveAfterDefenderAction(state, player, cards, bashesAwaitingResponse);
    const endRow = recordPhase(state, 'end', cards);
    dispatchTrigger(state, { ...turnEvent, trigger: 'end' }, cards, [player]);
    state.revision = (state.revision ?? 0) + 1;
    state.events ??= [];
    state.events.push({ revision: state.revision, player, action: structuredClone(action) });
    if (state.pendingResolution) return state;
    const opponent = player === 1 ? 2 : 1;
    dispatchTrigger(state, { ...turnEvent, trigger: 'opponentEnd' }, cards, [opponent]);
    finishStackAction(state, endRow.id); finishStackAction(state, commandRow.id);
    clearStunAtTurnEnd(state, player);
    state.activePlayer = player === 1 ? 2 : 1;
    const nextPlayer = state.activePlayer;
    const startRow = recordPhase(state, 'start', cards);
    dispatchTrigger(state, { trigger: 'start', player: nextPlayer, troopIds: [] }, cards, [nextPlayer]);
    dispatchTrigger(state, { trigger: 'opponentStart', player: nextPlayer, troopIds: [] }, cards, [nextPlayer === 1 ? 2 : 1]);
    finishStackAction(state, startRow.id); completePhase(state, 'action', cards);
    return state;
  }
  if (action.type === 'resolve-move' || action.type === 'resolve-death-attack' || action.type === 'resolve-instant-ranged' || action.type === 'resolve-instant-magic' || action.type === 'resolve-stun' || action.type === 'resolve-pull' || action.type === 'resolve-revive' || action.type === 'resolve-pass') throw new Error('There is no pending event action.');
  if (state.lastActingTroopId?.[player] === action.troopId) throw new Error('This troop acted on your previous turn.');
  if (action.type !== 'self-defense' && action.type !== 'self-magic-defense' && !isBoardCoordinate(action.coordinate)) throw new Error('Invalid hex.');
  const troop = card(cards, action.troopId);
  const unit = state.units.find(item => item.owner === player && item.troopId === action.troopId);
  if ((unit?.stunnedTurns ?? 0) > 0) throw new Error('This troop is stunned.');
  completePhase(state, 'action-resolve', cards);
  let vacatedCoordinate: Coordinate | undefined;
  if (action.type === 'deploy') {
    if (unit || state.defeatedTroopIds?.includes(`${player}:${action.troopId}`) || at(state, action.coordinate)) throw new Error('Deployment hex is unavailable.');
    const targetRegion = regionAt(action.coordinate);
    if (!targetRegion) throw new Error('Invalid hex.');
    const enemyRegionOnly = troop.deploymentRule === 'enemy-region';
    const allowed = enemyRegionOnly
      ? troop.deploymentRegions.includes(targetRegion.type) && targetRegion.home !== undefined && targetRegion.home !== player && controller(state, action.coordinate, cards) === player
      : troop.deploymentRegions.includes(targetRegion.type) && controller(state, action.coordinate, cards) === player;
    if (!allowed) throw new Error('You do not control a valid deployment region.');
    if (troop.role !== 'hero' && !state.units.some(item => item.owner === player && card(cards, item.troopId).role === 'hero')) throw new Error('Deploy your hero first.');
    state.units.push({ id: `${player}:${action.troopId}`, troopId: action.troopId, owner: player, coordinate: action.coordinate, permanentDamage: 0 });
    dispatchTrigger(state, { trigger: 'deploy', player, hex: action.coordinate, troopIds: [`${player}:${action.troopId}`], actingTroopId: action.troopId }, cards, [player]);
  } else {
    if (!unit) throw new Error('Your troop is not deployed.');
    // A real troop action consumes that troop's existing shield. Resolution
    // actions (resolve-move, resolve-death-attack, etc.) never reach here.
    if (isTrueAction(action)) clearShield(unit);
    if (action.type === 'move' || action.type === 'fly') {
      const maxDistance = action.type === 'move' ? moveRange(state, troop, unit, cards) : flyRange(troop, unit);
      if (hexDistance(unit.coordinate, action.coordinate) > maxDistance || (action.type === 'move' && !hasFreePath(state, unit.coordinate, action.coordinate, maxDistance))) throw new Error(action.type === 'fly' ? 'Flight destination is out of range.' : 'Move has no free path.');
      if (state.bashes.some(bash => bash.target === action.coordinate)) throw new Error('A bash is already happening on this hex.');
      const target = at(state, action.coordinate);
      if (!target) { vacatedCoordinate = unit.coordinate; unit.coordinate = action.coordinate; }
      else if (target.owner !== player) {
        vacatedCoordinate = unit.coordinate;
        const attackerId = unitId(unit); const defenderId = unitId(target);
        unit.coordinate = action.coordinate;
        state.bashes.push({ attackerId, defenderId, target: action.coordinate });
        // A bash begins as soon as the attacker enters an enemy hex. Both
        // sides can react through their specialised trigger or the shared one.
        const bashEvent: TriggerEvent = { trigger: 'bash', player, hex: action.coordinate, troopIds: [attackerId, defenderId], actingTroopId: action.troopId, attackerId, defenderId };
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [player]);
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [target.owner]);
        dispatchTrigger(state, bashEvent, cards, [player, target.owner]);
      }
      else throw new Error('A friendly troop occupies this hex.');
    } else if (action.type === 'gore') {
      const maximumRange = actionRange(state, troop, unit, cards, 'gore');
      const line = straightLine(unit.coordinate, action.coordinate, maximumRange);
      // Gore is a straight-line leap: intervening troops do not block it.
      // Only alignment, range, and the final destination constrain the action.
      if (!line) throw new Error('Gore destination is out of range or not aligned.');
      if (state.bashes.some(bash => bash.target === action.coordinate)) throw new Error('A bash is already happening on this hex.');
      const target = at(state, action.coordinate);
      if (target?.owner === player) throw new Error('A friendly troop occupies this hex.');
      vacatedCoordinate = unit.coordinate;
      const attackerId = unitId(unit);
      const enemiesInPath = line.map(coordinate => at(state, coordinate)).filter((candidate): candidate is UnitState => Boolean(candidate && candidate.owner !== player));
      // A zero-damage marker keeps an empty charge pending and records its
      // landing hex. Enemy-specific effects snapshot every troop in the line.
      state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: attackerId, kind: 'gore', target: action.coordinate, value: 0, origin: vacatedCoordinate, goreDestination: action.coordinate });
      for (const enemy of enemiesInPath) state.effects.push({
        owner: player, sourceTroopId: action.troopId, sourceUnitId: attackerId,
        targetUnitId: unitId(enemy), kind: 'gore', target: enemy.coordinate,
        value: goreDamage(troop, unit), origin: vacatedCoordinate, goreDestination: action.coordinate,
      });
    } else if (action.type === 'self-defense') {
      addShield(unit, (troop.selfDefense ?? 1) + upgradeBonus(unit, 'self-defense').left, unitId(unit));
    } else if (action.type === 'self-magic-defense') {
      if (troop.selfMagicDefense === undefined) throw new Error('This troop cannot use self magic defense.');
      addMagicModifier(unit, troop.selfMagicDefense + upgradeBonus(unit, 'self-magic-defense').left);
    } else if (action.type === 'push' || action.type === 'pull') {
      const displacement = actionOfType(troop, action.type);
      const pushedBomb = action.targetBomb ? state.bombs?.find(bomb => bomb.coordinate === action.coordinate) : undefined;
      const pushed = action.targetBomb ? undefined : action.targetUnitId ? findUnit(state, action.targetUnitId) : at(state, action.coordinate);
      const bonus = upgradeBonus(unit, action.type);
      const pushTarget = pushedBomb ?? pushed;
      const line = displacement && pushTarget && hexDistance(unit.coordinate, action.coordinate) <= displacement.range + bonus.right ? displacementLine(action.type, unit.coordinate, action.coordinate, displacement.maxDistance + bonus.left) : undefined;
      if (!pushTarget || pushTarget.coordinate !== action.coordinate || !line || action.destination !== line.at(-1)) throw new Error(`Invalid ${action.type} destination.`);
      if (pushedBomb) {
        state.bombs ??= [];
        const landingBomb = state.bombs.find(bomb => bomb !== pushedBomb && bomb.coordinate === action.destination);
        vacatedCoordinate = pushedBomb.coordinate;
        if (landingBomb) {
          landingBomb.damage += pushedBomb.damage;
          if (pushedBomb.pierce) landingBomb.pierce = true;
          state.bombs = state.bombs.filter(bomb => bomb !== pushedBomb);
        } else pushedBomb.coordinate = action.destination;
      } else {
      if (!pushed) throw new Error('Invalid push target.');
      const landingOccupant = at(state, action.destination);
      if (state.bashes.some(bash => bash.target === action.destination)) throw new Error('A bash is already happening on this hex.');
      if (!landingOccupant) { vacatedCoordinate = pushed.coordinate; pushed.coordinate = action.destination; }
      else if (landingOccupant.owner === pushed.owner) throw new Error('A pushed troop cannot land on a friendly troop.');
      else {
        vacatedCoordinate = pushed.coordinate;
        const attackerId = unitId(pushed); const defenderId = unitId(landingOccupant);
        pushed.coordinate = action.destination;
        state.bashes.push({ attackerId, defenderId, target: action.destination });
        const bashEvent: TriggerEvent = { trigger: 'bash', player, hex: action.destination, troopIds: [attackerId, defenderId], actingTroopId: action.troopId, attackerId, defenderId };
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [pushed.owner]);
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [landingOccupant.owner]);
        dispatchTrigger(state, bashEvent, cards, [pushed.owner, landingOccupant.owner]);
      }
      }
    } else {
      const maximumRange = actionRange(state, troop, unit, cards, action.type);
      if (maximumRange < 0 || hexDistance(unit.coordinate, action.coordinate) > maximumRange) throw new Error('Target is out of range.');
      const isBashTarget = state.bashes.some(bash => bash.target === action.coordinate);
      const isOffensive = action.type === 'attack' || action.type === 'magic' || action.type === 'stun';
      const offensiveTarget = offensiveTargetAt(state, player, action.coordinate);
      if (isOffensive && offensiveTarget?.owner === player && !isBashTarget && !(action.type === 'magic' && state.bombs?.some(bomb => bomb.coordinate === action.coordinate))) throw new Error('Cannot target a friendly troop.');
      if (action.type === 'cannon') {
        const line = straightLine(unit.coordinate, action.coordinate, maximumRange);
        if (!line) throw new Error('Cannon target must be in a straight line.');
        commandRow.targetHexes = [...line]; commandRow.targets = snapshotTargets(state, line, cards);
        for (const target of line) {
          const targetUnit = offensiveTargetAt(state, player, target);
          state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), ...(targetUnit ? { targetUnitId: unitId(targetUnit) } : {}), kind: 'cannon', target, value: cannonDamage(troop, unit) });
        }
      } else if (action.type === 'bomb') {
        state.bombs ??= [];
        const landingBomb = state.bombs.find(bomb => bomb.coordinate === action.coordinate);
        const thrownPierce = Boolean(actionOfType(troop, 'bomb')?.qualifiers?.includes('pierce'));
        if (landingBomb) { landingBomb.damage += bombDamage(troop, unit); if (thrownPierce) landingBomb.pierce = true; }
        else state.bombs.push({ owner: player, sourceTroopId: action.troopId, coordinate: action.coordinate, damage: bombDamage(troop, unit), ...(thrownPierce ? { pierce: true } : {}) });
      } else {
      if (action.type === 'defense' || action.type === 'magic-defense') {
        const target = state.units.find(candidate => candidate.owner === player && candidate.coordinate === action.coordinate);
        if (!target) throw new Error('Defense must target a friendly troop.');
        if (action.type === 'magic-defense') addMagicModifier(target, (actionOfType(troop, 'magic-defense')?.amount ?? 0) + upgradeBonus(unit, 'magic-defense').left);
        else addShield(target, (actionOfType(troop, 'defense')?.amount ?? 0) + upgradeBonus(unit, 'defense').left, unitId(unit));
      } else if (action.type === 'attack') {
        const printedAttack = actionOfType(troop, 'attack');
        if (printedAttack?.qualifiers?.includes('instant')) {
          if (offensiveTarget && offensiveTarget.owner !== player && !hasPassive(cards.get(offensiveTarget.troopId), 'titanium')) {
            const damage = Math.max(0, attackDamage(state, troop, unit, cards) - (printedAttack.qualifiers.includes('pierce') ? 0 : modifier(state, offensiveTarget, cards)));
            offensiveTarget.permanentDamage += damage;
            clearShield(offensiveTarget);
            if (damage > 0) dispatchTrigger(state, { trigger: 'successfulAttack', player, hex: action.coordinate, troopIds: [unitId(unit), unitId(offensiveTarget)], actingTroopId: unit.troopId, targetUnitId: unitId(offensiveTarget), actionKind: 'ranged' }, cards, [player]);
            if (health(offensiveTarget, cards) === 0) remove(state, offensiveTarget, cards);
          }
        } else state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), ...(offensiveTarget ? { targetUnitId: unitId(offensiveTarget) } : {}), kind: 'attack', target: action.coordinate, value: attackDamage(state, troop, unit, cards), ...(printedAttack?.qualifiers?.includes('pierce') ? { pierce: true } : {}) });
      }
      else if (action.type === 'mending') {
        const target = at(state, action.coordinate);
        if (!target || target.owner !== player) throw new Error('Mending must target a friendly troop.');
        const mending = actionOfType(troop, 'mending');
        target.permanentDamage = Math.max(0, target.permanentDamage - (mending?.amount ?? 0) - upgradeBonus(unit, 'mending').left);
      } else if (action.type === 'upgrade') {
        const target = at(state, action.coordinate);
        if (!target || target.owner !== player) throw new Error('Upgrade must target a friendly troop.');
        if (card(cards, target.troopId).role === 'temple') throw new Error('A temple cannot be upgraded.');
        const upgrade = actionOfType(troop, 'upgrade');
        target.upgrades ??= [];
        const targetCard = card(cards, target.troopId);
        const targetAction = action.ability === 'self-defense' ? targetCard.selfDefense !== undefined : targetCard.actions.some(item => actionType(item) === action.ability);
        const useful = action.ability === 'move' || action.ability === 'fly' ? upgrade?.right : action.ability === 'self-defense' ? upgrade?.left : (upgrade?.left ?? 0) || (upgrade?.right ?? 0);
        if (!targetAction || !useful) throw new Error('This upgrade cannot affect the selected ability.');
        target.upgrades.push({ ability: action.ability, left: upgrade?.left, right: upgrade?.right, sourceUnitId: unitId(unit) });
      } else if (action.type === 'magic') {
        const magicAction = actionOfType(troop, 'magic');
        const bomb = state.bombs?.find(item => item.coordinate === action.coordinate);
        if (bomb && magicAction?.qualifiers?.includes('instant')) explodeBombNow(state, bomb, player, Boolean(magicAction.qualifiers.includes('pierce')), cards);
        else if (bomb) igniteBomb(state, bomb, player, Boolean(magicAction?.qualifiers?.includes('pierce')));
        else if (magicAction?.qualifiers?.includes('instant')) {
          const pierceMagic = magicAction.qualifiers.includes('pierce');
          if (offensiveTarget && offensiveTarget.owner !== player && (pierceMagic || !hasPassive(cards.get(offensiveTarget.troopId), 'obsidian'))) {
            const lethalThreshold = effectValue(state, troop, cards, unit) - (pierceMagic ? 0 : (offensiveTarget.magicModifierBonus ?? 0));
            offensiveTarget.magicModifierBonus = undefined;
            if (health(offensiveTarget, cards) <= lethalThreshold) remove(state, offensiveTarget, cards);
          }
        } else state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), ...(offensiveTarget ? { targetUnitId: unitId(offensiveTarget) } : {}), kind: 'magic', target: action.coordinate, value: effectValue(state, troop, cards, unit), ...(magicAction?.qualifiers?.includes('pierce') ? { pierce: true } : {}) });
      } else if (action.type === 'stun') {
        if (!offensiveTarget || offensiveTarget.owner === player) throw new Error('Stun must target an enemy troop.');
        const turns = actionOfType(troop, 'stun')?.amount ?? 0;
        offensiveTarget.stunnedTurns = Math.max(offensiveTarget.stunnedTurns ?? 0, turns);
        clearShield(offensiveTarget);
        offensiveTarget.magicModifierBonus = undefined;
        state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), targetUnitId: unitId(offensiveTarget), kind: 'stun', target: action.coordinate, value: turns });
      }
    }
  }
  }
  if (unit) spendUpgrade(unit, action);
  if (action.type === 'magic' && unit) {
    dispatchTrigger(state, { trigger: 'magicUsed', player, hex: action.coordinate, troopIds: [unitId(unit)], actingTroopId: action.troopId }, cards, [player]);
  }
  if (action.type === 'move' && unit) {
    dispatchTrigger(state, { trigger: 'movementUsed', player, hex: action.coordinate, troopIds: [unitId(unit)], actingTroopId: action.troopId }, cards, [player]);
  }
  commandRow.status = 'ready'; completePhase(state, 'combat-resolve', cards);
  resolveAfterDefenderAction(state, player, cards, bashesAwaitingResponse);
  const actingUnit = state.units.find(item => item.owner === player && item.troopId === action.troopId);
  const turnEvent = { player, hex: actingUnit?.coordinate ?? ('coordinate' in action ? action.coordinate : undefined), troopIds: actingUnit ? [unitId(actingUnit)] : [], actingTroopId: action.troopId };
  // Combat completes before end-of-turn passives. Own and opponent triggers
  // are deliberately separate, so a card can opt into exactly one of them.
  const endRow = recordPhase(state, 'end', cards);
  dispatchTrigger(state, { ...turnEvent, trigger: 'end' }, cards, [player]);
  state.lastActingTroopId ??= {};
  state.lastActingTroopId[player] = action.troopId;
  state.revision = (state.revision ?? 0) + 1;
  state.events ??= [];
  state.events.push({ revision: state.revision, player, action: structuredClone(action), ...(vacatedCoordinate ? { origin: vacatedCoordinate } : {}) });
  if (state.pendingResolution) return state;
  const opponent = player === 1 ? 2 : 1;
  dispatchTrigger(state, { ...turnEvent, trigger: 'opponentEnd' }, cards, [opponent]);
  finishStackAction(state, endRow.id); finishStackAction(state, commandRow.id);
  clearStunAtTurnEnd(state, player);
  state.activePlayer = player === 1 ? 2 : 1;
  const nextPlayer = state.activePlayer;
  const startRow = recordPhase(state, 'start', cards);
  dispatchTrigger(state, { trigger: 'start', player: nextPlayer, troopIds: [] }, cards, [nextPlayer]);
  dispatchTrigger(state, { trigger: 'opponentStart', player: nextPlayer, troopIds: [] }, cards, [nextPlayer === 1 ? 2 : 1]);
  finishStackAction(state, startRow.id); completePhase(state, 'action', cards);
  return state;
}

function resolveAfterDefenderAction(state: GameState, defender: Player, cards: ReadonlyMap<string, TroopSeed>, bashesAwaitingResponse: ReadonlySet<Bash>): void {
  const resolvedUpgradeSources = new Set<UnitId>();
  // The fallback keeps older persisted bash snapshots compatible; new bashes
  // already store the attacker directly on the contested hex.
  const effectCoordinate = (unit: UnitState): Coordinate =>
    state.bashes.find(bash => bash.attackerId === unitId(unit))?.target ?? unit.coordinate;
  for (const effect of state.effects.filter(item => item.owner !== defender && (item.kind === 'attack' || item.kind === 'gore'))) {
    if (effect.kind === 'gore' && effect.sourceUnitId && !findUnit(state, effect.sourceUnitId)) continue;
    if (effect.sourceUnitId) resolvedUpgradeSources.add(effect.sourceUnitId);
    const unit = effect.targetUnitId ? findUnit(state, effect.targetUnitId) : at(state, effect.target);
    if (effect.targetUnitId && unit && effectCoordinate(unit) !== effect.target) continue;
    if (unit && unit.owner === defender) {
      // Titanium prevents the physical hit itself, so an existing shield is
      // not contacted or consumed.
      if (hasPassive(cards.get(unit.troopId), 'titanium')) continue;
      const damage = Math.max(0, effect.value - (effect.pierce ? 0 : modifier(state, unit, cards)));
      unit.permanentDamage += damage;
      // A physical ranged attack consumes the shield on the troop it actually
      // resolves over, even when the shield absorbs all of its damage.
      clearShield(unit);
      if (damage > 0 && (effect.kind === 'attack' || effect.kind === 'gore') && effect.sourceUnitId) {
        const source = findUnit(state, effect.sourceUnitId);
        if (source) dispatchTrigger(state, { trigger: 'successfulAttack', player: effect.owner, hex: effect.target, troopIds: [unitId(source), unitId(unit)], actingTroopId: source.troopId, targetUnitId: unitId(unit), actionKind: effect.kind === 'gore' ? 'gore' : 'ranged' }, cards, [effect.owner]);
      }
      if (health(unit, cards) === 0) remove(state, unit, cards);
    }
  }
  const resolvingGoreCharges = new Map<UnitId, Effect>();
  for (const effect of state.effects.filter(item => item.owner !== defender && item.kind === 'gore' && item.sourceUnitId && item.goreDestination)) {
    resolvingGoreCharges.set(effect.sourceUnitId!, effect);
  }
  for (const [sourceId, effect] of resolvingGoreCharges) {
    const source = findUnit(state, sourceId);
    const destination = effect.goreDestination;
    if (!source || !destination) continue;
    source.coordinate = destination;
    const target = state.units.find(unit => unit !== source && unit.coordinate === destination);
    if (!target || target.owner === source.owner || state.bashes.some(bash => bash.target === destination)) continue;
    const attackerId = unitId(source); const defenderId = unitId(target);
    state.bashes.push({ attackerId, defenderId, target: destination });
    const bashEvent: TriggerEvent = { trigger: 'bash', player: source.owner, hex: destination, troopIds: [attackerId, defenderId], actingTroopId: source.troopId, attackerId, defenderId };
    dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [source.owner]);
    dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [target.owner]);
    dispatchTrigger(state, bashEvent, cards, [source.owner, target.owner]);
  }
  // Cannon and Bomb are magic damage: the physical modifier is ignored, but
  // the magic modifier reduces the blast and is consumed, and Obsidian blocks
  // it unless the blast pierces. Bomb explosions and cannon lines are
  // neutral, so either player's troops can be caught on their affected hexes.
  for (const effect of state.effects.filter(item => item.owner !== defender && (item.kind === 'cannon' || item.kind === 'bomb'))) {
    if (effect.sourceUnitId) resolvedUpgradeSources.add(effect.sourceUnitId);
    if (effect.kind === 'bomb') {
      const chainedBomb = state.bombs?.find(bomb => bomb.coordinate === effect.target);
      // The current player's completed action caused this ignition. Giving
      // the fresh effects that player as owner makes them resolve after the
      // following player's action, never recursively in this same pass.
      if (chainedBomb) igniteBomb(state, chainedBomb, defender, Boolean(effect.pierce));
    }
    const targets = state.units.filter(unit => unit.coordinate === effect.target);
    for (const unit of targets) {
      if (!effect.pierce && hasPassive(cards.get(unit.troopId), 'obsidian')) continue;
      const damage = effect.pierce ? effect.value : Math.max(0, effect.value - (unit.magicModifierBonus ?? 0));
      unit.magicModifierBonus = undefined;
      unit.permanentDamage += damage;
      if (health(unit, cards) === 0) remove(state, unit, cards);
    }
  }
  for (const effect of state.effects.filter(item => item.owner !== defender && item.kind === 'magic')) {
    if (effect.sourceUnitId) resolvedUpgradeSources.add(effect.sourceUnitId);
    const unit = effect.targetUnitId ? findUnit(state, effect.targetUnitId) : at(state, effect.target);
    if (effect.targetUnitId && unit && effectCoordinate(unit) !== effect.target) continue;
    if (unit && unit.owner === defender) {
      if (!effect.pierce && hasPassive(cards.get(unit.troopId), 'obsidian')) continue;
      const lethalThreshold = effect.pierce ? effect.value : effect.value - (unit.magicModifierBonus ?? 0);
      unit.magicModifierBonus = undefined;
      if (health(unit, cards) <= lethalThreshold) remove(state, unit, cards);
    }
  }
  for (const bash of [...state.bashes]) {
    if (!bashesAwaitingResponse.has(bash)) continue;
    const attacker = findUnit(state, bash.attackerId);
    const originalDefender = findUnit(state, bash.defenderId);
    if (!attacker || !originalDefender) { state.bashes = state.bashes.filter(item => item !== bash); continue; }
    if (originalDefender.owner !== defender) continue;
    // The defending unit may spend its response action moving away.  That is
    // a dodge, not combat: the attacker enters the now-vacant hex and neither
    // unit receives bash damage.
    const participantMoved = attacker.coordinate !== bash.target || originalDefender.coordinate !== bash.target;
    if (participantMoved || originalDefender.owner !== defender) {
      dispatchTrigger(state, { trigger: 'bashRetreat', player: attacker.owner, hex: bash.target, troopIds: [unitId(attacker), unitId(originalDefender)], attackerId: unitId(attacker), defenderId: unitId(originalDefender) }, cards, [attacker.owner, originalDefender.owner]);
      state.bashes = state.bashes.filter(item => item !== bash);
      continue;
    }
    const attackerVirtual = { ...attacker, coordinate: bash.target };
    const attackerModifier = modifier(state, attacker, cards, attackerVirtual);
    const defenderModifier = modifier(state, originalDefender, cards, attackerVirtual);
    const attackerPower = health(attacker, cards) + attackerModifier;
    const defenderPower = health(originalDefender, cards) + defenderModifier;
    const firstStrikeUnit = [attacker, originalDefender].find(unit => hasPassive(cards.get(unit.troopId), 'first-strike'));
    let firstStrike: TriggerEvent['firstStrike'];
    if (firstStrikeUnit) {
      const firstStrikeTarget = firstStrikeUnit === attacker ? originalDefender : attacker;
      const firstStrikeVirtual = { ...firstStrikeUnit, coordinate: bash.target };
      const targetVirtual = { ...firstStrikeTarget, coordinate: bash.target };
      const firstStrikeModifier = modifier(state, firstStrikeUnit, cards, firstStrikeVirtual);
      const firstStrikeTargetModifier = modifier(state, firstStrikeTarget, cards, targetVirtual);
      const firstDamage = Math.max(0, health(firstStrikeUnit, cards) + firstStrikeModifier - firstStrikeTargetModifier);
      firstStrikeTarget.permanentDamage += firstDamage;
      const targetSurvived = health(firstStrikeTarget, cards) > 0;
      if (!targetSurvived) remove(state, firstStrikeTarget, cards);

      let retaliationDamage = 0;
      if (targetSurvived) {
        const refreshedTargetModifier = modifier(state, firstStrikeTarget, cards, { ...firstStrikeTarget, coordinate: bash.target });
        const refreshedFirstStrikeModifier = modifier(state, firstStrikeUnit, cards, firstStrikeVirtual);
        retaliationDamage = Math.max(0, health(firstStrikeTarget, cards) + refreshedTargetModifier - refreshedFirstStrikeModifier);
        firstStrikeUnit.permanentDamage += retaliationDamage;
        if (health(firstStrikeUnit, cards) === 0) remove(state, firstStrikeUnit, cards);
      }
      firstStrike = {
        unitId: unitId(firstStrikeUnit),
        targetId: unitId(firstStrikeTarget),
        firstDamage,
        retaliationDamage,
        targetSurvived,
      };
    } else if (attackerPower === defenderPower) { remove(state, attacker, cards); remove(state, originalDefender, cards); }
    else {
      const winner = attackerPower > defenderPower ? attacker : originalDefender;
      const loser = winner === attacker ? originalDefender : attacker;
      const loserCombat = winner === attacker ? defenderPower : attackerPower;
      const winnerModifier = winner === attacker ? attackerModifier : defenderModifier;
      winner.permanentDamage += Math.max(0, loserCombat - winnerModifier);
      remove(state, loser, cards);
      if (winner === attacker && state.units.includes(winner)) winner.coordinate = bash.target;
    }
    const survivingParticipants = [attacker, originalDefender].filter(unit => state.units.includes(unit));
    clearShield(attacker);
    clearShield(originalDefender);
        dispatchTrigger(state, { trigger: 'bashResolved', player: attacker.owner, hex: bash.target, troopIds: survivingParticipants.map(unitId), attackerId: unitId(attacker), defenderId: unitId(originalDefender), ...(firstStrike ? { firstStrike } : {}) }, cards, [...new Set(survivingParticipants.map(unit => unit.owner))]);
    state.bashes = state.bashes.filter(item => item !== bash);
  }
  // Keep only the defending player's unresolved effects. Shields live on
  // troops now, so they are consumed at the exact troop-resolution points
  // above rather than by coordinate or opponent-end expiry.
  state.effects = state.effects.filter(effect => effect.owner === defender);
  // Do this after all pending effects have read their boosted values. It also
  // keeps the purple upgraded numbers visible until the opponent's response
  // resolves the attack.
  for (const sourceId of resolvedUpgradeSources) {
    const source = findUnit(state, sourceId);
    if (source?.upgrades) source.upgrades = [];
  }
}
