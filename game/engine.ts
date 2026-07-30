import { type TroopAction, type TroopSeed, type UpgradableAbility } from './cards.js';
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
  | { type: 'push'; troopId: string; coordinate: Coordinate; destination: Coordinate }
  | { type: 'magic'; troopId: string; coordinate: Coordinate }
  | { type: 'mending'; troopId: string; coordinate: Coordinate }
  | { type: 'upgrade'; troopId: string; coordinate: Coordinate; ability: UpgradableAbility }
  | { type: 'defense'; troopId: string; coordinate: Coordinate }
  | { type: 'self-defense'; troopId: string };

/** Stable identity for a card in a match. A card can exist once for each owner. */
export type UnitId = `${Player}:${string}`;
export interface Upgrade { ability: UpgradableAbility; left?: number; right?: number; sourceUnitId: UnitId; }
export interface UnitState { id?: UnitId; troopId: string; owner: Player; coordinate: Coordinate; permanentDamage: number; rangedDamageBonus?: number; rangedRangeBonus?: number; upgrades?: Upgrade[]; }
export interface Effect { owner: Player; sourceTroopId: string; sourceUnitId?: UnitId; kind: 'attack' | 'cannon' | 'magic' | 'defense'; target: Coordinate; value: number; }
interface Bash { attackerId: string; defenderId: string; target: Coordinate; }
export interface GameEvent { revision: number; player: Player; action: GameAction; /** Hex vacated by the completed move, flight, or push. */ origin?: Coordinate; }
export type Trigger = 'start' | 'end' | 'opponentStart' | 'opponentEnd' | 'bashAttack' | 'bashDefense' | 'bashRetreat' | 'bash' | 'magicUsed';
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
}
export interface GameState { activePlayer: Player; winner?: Player; units: UnitState[]; effects: Effect[]; bashes: Bash[]; lastActingTroopId?: Partial<Record<Player, string>>; defeatedTroopIds?: string[]; revision?: number; events?: GameEvent[]; triggerEvents?: TriggerEvent[]; }

export function createGameState(): GameState { return { activePlayer: 1, units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: [], triggerEvents: [] }; }
export function unitId(unit: Pick<UnitState, 'owner' | 'troopId' | 'id'>): UnitId { return unit.id ?? `${unit.owner}:${unit.troopId}`; }
function findUnit(state: GameState, id: string): UnitState | undefined { return state.units.find(unit => unit.id === id || unitId(unit) === id || (!unit.id && unit.troopId === id)); }
function matchesUnitId(unit: UnitState, id: string): boolean { return unit.id === id || unitId(unit) === id || (!unit.id && unit.troopId === id); }
function health(unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number { return Math.max(0, (cards.get(unit.troopId)?.baseHealth ?? 0) - unit.permanentDamage); }
export interface ModifierEntry { label: string; value: number; }
export interface CombatSummary {
  health: number;
  modifier: number;
  modifiers: ModifierEntry[];
  total: number;
  controller?: Player;
}
function combatUnitAndVirtual(state: GameState, troopId: string, contestedCoordinate?: Coordinate): { unit: UnitState; virtual?: UnitState } {
  const unit = findUnit(state, troopId);
  if (!unit) throw new Error('Troop is not on the board.');
  const bash = contestedCoordinate ? state.bashes.find(item => item.target === contestedCoordinate) : undefined;
  const bashAttacker = bash ? findUnit(state, bash.attackerId) : undefined;
  const virtual = contestedCoordinate ? { ...(bashAttacker ?? unit), coordinate: contestedCoordinate } : undefined;
  return { unit, virtual };
}
export function combatBreakdown(state: GameState, troopId: string, cards: ReadonlyMap<string, TroopSeed>, contestedCoordinate?: Coordinate): { health: number; modifier: number; total: number; controller?: Player } {
  const { modifiers: _modifiers, ...breakdown } = combatSummary(state, troopId, cards, contestedCoordinate);
  return breakdown;
}
export function combatSummary(state: GameState, troopId: string, cards: ReadonlyMap<string, TroopSeed>, contestedCoordinate?: Coordinate): CombatSummary {
  const { unit, virtual } = combatUnitAndVirtual(state, troopId, contestedCoordinate);
  const currentHealth = health(unit, cards);
  const modifiers = modifierEntries(state, unit, cards, virtual);
  const currentModifier = modifiers.reduce((sum, entry) => sum + entry.value, 0);
  return { health: currentHealth, modifier: currentModifier, modifiers, total: currentHealth + currentModifier, controller: controller(state, contestedCoordinate ?? unit.coordinate, cards, virtual) };
}
function card(cards: ReadonlyMap<string, TroopSeed>, id: string): TroopSeed { const result = cards.get(id); if (!result) throw new Error('Unknown troop.'); return result; }
function at(state: GameState, coordinate: Coordinate): UnitState | undefined { return state.units.find(unit => unit.coordinate === coordinate); }
function actionOfType<Type extends TroopAction['type']>(troop: TroopSeed, type: Type): Extract<TroopAction, { type: Type }> | undefined {
  return troop.actions.find(action => action.type === type) as Extract<TroopAction, { type: Type }> | undefined;
}
function upgradeBonus(unit: UnitState, ability: UpgradableAbility): Required<Pick<Upgrade, 'left' | 'right'>> { return (unit.upgrades ?? []).filter(upgrade => upgrade.ability === ability || upgrade.ability === undefined).reduce((total, upgrade) => ({ left: total.left + (upgrade.left ?? 0), right: total.right + (upgrade.right ?? 0) }), { left: 0, right: 0 }); }
function moveRange(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'move')?.maxDistance ?? 0) + upgradeBonus(unit, 'move').right; }
function flyRange(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'fly')?.maxDistance ?? 0) + upgradeBonus(unit, 'fly').right; }
function actionRange(troop: TroopSeed, unit: UnitState, type: 'attack' | 'cannon' | 'magic' | 'defense' | 'push' | 'mending' | 'upgrade'): number {
  const action = actionOfType(troop, type);
  return action ? action.range + upgradeBonus(unit, type).right + (type === 'attack' ? unit.rangedRangeBonus ?? 0 : 0) : -1;
}
function attackDamage(troop: TroopSeed, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): number {
  const action = actionOfType(troop, 'attack');
  return (action?.damage ?? health(unit, cards)) + (unit.rangedDamageBonus ?? 0) + upgradeBonus(unit, 'attack').left;
}
function effectValue(troop: TroopSeed, type: 'magic' | 'defense', cards: ReadonlyMap<string, TroopSeed>, unit: UnitState): number {
  if (type === 'magic') return (actionOfType(troop, 'magic')?.damage ?? health(unit, cards)) + upgradeBonus(unit, 'magic').left;
  return (actionOfType(troop, 'defense')?.block ?? health(unit, cards)) + upgradeBonus(unit, 'defense').left;
}
function cannonDamage(troop: TroopSeed, unit: UnitState): number { return (actionOfType(troop, 'cannon')?.damage ?? 0) + upgradeBonus(unit, 'cannon').left; }
/** Immediate abilities spend their upgrade straight away. Delayed attacks keep
 * it visible until their pending effect is actually resolved next turn. */
function spendUpgrade(unit: UnitState, action: GameAction): void { if (['move', 'fly', 'defense', 'self-defense', 'push', 'mending', 'upgrade'].includes(action.type)) unit.upgrades = []; }
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
    if (unit.owner === 1) playerOne += health(unit, cards);
    else playerTwo += health(unit, cards);
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
function shieldBonus(unit: UnitState, effect: Effect): number { return unit.troopId === 'river-otter' && effect.owner === unit.owner && (effect.sourceUnitId ?? `${effect.owner}:${effect.sourceTroopId}`) !== unitId(unit) ? 1 : 0; }
function modifierEntries(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): ModifierEntry[] {
  const combatCoordinate = virtual?.coordinate ?? unit.coordinate;
  const block = state.effects.filter(effect => effect.kind === 'defense' && effect.owner === unit.owner && effect.target === combatCoordinate).reduce((sum, effect) => sum + effect.value + shieldBonus(unit, effect), 0);
  const bash = state.bashes.find(item => item.target === combatCoordinate && (item.attackerId === unitId(unit) || item.defenderId === unitId(unit)));
  // Steady is a live opposing-side bash passive. It suppresses the opponent's
  // shield, control, and conditional bonuses, never the Hawk's own modifier
  // or either troop's base health, and applies whether the Hawk attacks or
  // defends.
  if (bash) {
    const opponentId = bash.attackerId === unitId(unit) ? bash.defenderId : bash.attackerId;
    if (findUnit(state, opponentId)?.troopId === 'canyon-hawk') return [];
  }
  const isAttacker = bash?.attackerId === unitId(unit);
  const warTempleAura = Boolean(bash && state.units.some(item => item.owner === unit.owner && item.troopId === 'war-temple'));
  const entries: ModifierEntry[] = [];
  if (block) entries.push({ label: 'Shield', value: block });
  if (block > 0 && unit.troopId === 'marsh-badger') entries.push({ label: 'Marsh Badger', value: -1 });
  if (unit.troopId === 'alps-lone-wolf' && unit.permanentDamage > 0) entries.push({ label: 'Alps Lone Wolf', value: 2 });
  if (unit.troopId === 'canyon-ibex' && isAttacker) entries.push({ label: 'Canyon Ibex', value: 2 });
  if (warTempleAura) entries.push({ label: 'War Temple', value: 1 });
  if (controller(state, combatCoordinate, cards, virtual) === unit.owner) entries.push({ label: 'Control', value: 1 });
  return entries;
}
function modifier(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>, virtual?: UnitState): number { return modifierEntries(state, unit, cards, virtual).reduce((sum, entry) => sum + entry.value, 0); }
function remove(state: GameState, unit: UnitState, cards: ReadonlyMap<string, TroopSeed>): void { state.units = state.units.filter(item => item !== unit); state.defeatedTroopIds ??= []; state.defeatedTroopIds.push(unitId(unit)); if (card(cards, unit.troopId).role === 'hero') state.winner = unit.owner === 1 ? 2 : 1; }

export type PassiveHandler = (state: GameState, unit: UnitState, event: TriggerEvent, cards: ReadonlyMap<string, TroopSeed>) => void;
const passiveHandlers: Partial<Record<Trigger, Partial<Record<string, PassiveHandler>>>> = {
  // Squirrel King heals only after it personally casts magic, never because
  // another troop acts or because its turn ends.
  magicUsed: { 'squirrel-king': (_state, unit, event) => {
    if (event.actingTroopId === unit.troopId) unit.permanentDamage = Math.max(0, unit.permanentDamage - 1);
  } },
  bashAttack: { 'sahel-porcupine': (_state, unit, event) => {
    if (event.attackerId !== unitId(unit)) return;
    unit.rangedDamageBonus = (unit.rangedDamageBonus ?? 0) + 1;
    unit.rangedRangeBonus = (unit.rangedRangeBonus ?? 0) + 1;
  } }
};

export function registerPassive(trigger: Trigger, troopId: string, handler: PassiveHandler): () => void {
  const handlers = passiveHandlers[trigger] ?? (passiveHandlers[trigger] = {});
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
  const handlers = passiveHandlers[event.trigger] ?? {};
  const units = state.units.filter(unit => listenerOwners.includes(unit.owner)).sort((left, right) => {
    const leftHero = card(cards, left.troopId).role === 'hero'; const rightHero = card(cards, right.troopId).role === 'hero';
    return leftHero === rightHero ? left.troopId.localeCompare(right.troopId) : leftHero ? -1 : 1;
  });
  for (const unit of units) handlers[unit.troopId]?.(state, unit, event, cards);
}

function hasIncomingPhysicalThreat(state: GameState, player: Player, coordinate: Coordinate): boolean {
  return state.effects.some(effect =>
    effect.owner !== player
    && (effect.kind === 'attack' || effect.kind === 'cannon')
    && effect.target === coordinate
  ) || state.bashes.some(bash =>
    bash.target === coordinate
    && findUnit(state, bash.defenderId)?.owner === player
  );
}

/**
 * Enumerate actions that the engine would accept for one troop right now.
 * This is the single source of truth used by server-side selection validation
 * and by clients when presenting targets.
 */
export function availableActionsFor(state: GameState, player: Player, troopId: string, cards: ReadonlyMap<string, TroopSeed>): GameAction[] {
  const troop = cards.get(troopId);
  if (!troop || state.winner || state.activePlayer !== player || state.lastActingTroopId?.[player] === troopId || state.defeatedTroopIds?.includes(`${player}:${troopId}`)) return [];
  const unit = state.units.find(item => item.owner === player && item.troopId === troopId);
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
    if (action.type === 'push') {
      const bonus = upgradeBonus(unit, 'push');
      for (const coordinate of PLAYABLE_COORDINATES) {
        const line = pushLine(unit.coordinate, coordinate, action.maxDistance + bonus.left);
        const destination = line?.at(-1);
        if (destination) addIfAccepted({ type: 'push', troopId, coordinate, destination });
      }
      continue;
    }
    if (action.type === 'upgrade') {
      for (const target of state.units.filter(candidate => candidate.owner === player)) {
        const targetCard = cards.get(target.troopId);
        if (!targetCard) continue;
        const abilities = [
          ...targetCard.actions.map(candidate => candidate.type),
          ...(targetCard.selfDefense !== undefined ? ['self-defense' as const] : [])
        ];
        for (const ability of abilities) addIfAccepted({ type: 'upgrade', troopId, coordinate: target.coordinate, ability });
      }
      continue;
    }
    for (const coordinate of PLAYABLE_COORDINATES) {
      if (action.type === 'defense' && !hasIncomingPhysicalThreat(state, player, coordinate)) continue;
      addIfAccepted({ type: action.type, troopId, coordinate } as GameAction);
    }
  }
  if (hasIncomingPhysicalThreat(state, player, unit.coordinate)) addIfAccepted({ type: 'self-defense', troopId });
  return available;
}

export function applyGameAction(before: GameState, player: Player, action: GameAction, cards: ReadonlyMap<string, TroopSeed>): GameState {
  const state: GameState = structuredClone(before);
  if (state.winner || state.activePlayer !== player) throw new Error('It is not your turn.');
  if (action.type === 'pass') {
    const turnEvent = { player, troopIds: [] as UnitId[] };
    // Passing is still the defender's response.  Resolve delayed attacks,
    // magic, bashes, and their temporary upgrades exactly as after any other
    // response action, before end-of-turn triggers run.
    resolveAfterDefenderAction(state, player, cards);
    dispatchTrigger(state, { ...turnEvent, trigger: 'end' }, cards, [player]);
    dispatchTrigger(state, { ...turnEvent, trigger: 'opponentEnd' }, cards, [player === 1 ? 2 : 1]);
    state.revision = (state.revision ?? 0) + 1;
    state.events ??= [];
    state.events.push({ revision: state.revision, player, action: structuredClone(action) });
    state.activePlayer = player === 1 ? 2 : 1;
    const nextPlayer = state.activePlayer;
    dispatchTrigger(state, { trigger: 'start', player: nextPlayer, troopIds: [] }, cards, [nextPlayer]);
    dispatchTrigger(state, { trigger: 'opponentStart', player: nextPlayer, troopIds: [] }, cards, [nextPlayer === 1 ? 2 : 1]);
    return state;
  }
  if (state.lastActingTroopId?.[player] === action.troopId) throw new Error('This troop acted on your previous turn.');
  if (action.type !== 'self-defense' && !isBoardCoordinate(action.coordinate)) throw new Error('Invalid hex.');
  const troop = card(cards, action.troopId);
  const unit = state.units.find(item => item.owner === player && item.troopId === action.troopId);
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
  } else {
    if (!unit) throw new Error('Your troop is not deployed.');
    if (action.type === 'move' || action.type === 'fly') {
      const maxDistance = action.type === 'move' ? moveRange(troop, unit) : flyRange(troop, unit);
      if (hexDistance(unit.coordinate, action.coordinate) > maxDistance || (action.type === 'move' && !hasFreePath(state, unit.coordinate, action.coordinate, maxDistance))) throw new Error(action.type === 'fly' ? 'Flight destination is out of range.' : 'Move has no free path.');
      const target = at(state, action.coordinate);
      if (!target) { vacatedCoordinate = unit.coordinate; unit.coordinate = action.coordinate; }
      else if (target.owner !== player) {
        vacatedCoordinate = unit.coordinate;
        if (state.bashes.some(bash => bash.target === action.coordinate)) throw new Error('A bash is already happening on this hex.');
        const attackerId = unitId(unit); const defenderId = unitId(target);
        state.bashes.push({ attackerId, defenderId, target: action.coordinate });
        // A bash begins as soon as the attacker enters an enemy hex. Both
        // sides can react through their specialised trigger or the shared one.
        const bashEvent: TriggerEvent = { trigger: 'bash', player, hex: action.coordinate, troopIds: [attackerId, defenderId], actingTroopId: action.troopId, attackerId, defenderId };
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [player]);
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [target.owner]);
        dispatchTrigger(state, bashEvent, cards, [player, target.owner]);
      }
      else throw new Error('A friendly troop occupies this hex.');
    } else if (action.type === 'self-defense') {
      state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: 'defense', target: unit.coordinate, value: (troop.selfDefense ?? 1) + upgradeBonus(unit, 'self-defense').left });
    } else if (action.type === 'push') {
      const push = actionOfType(troop, 'push');
      const pushed = at(state, action.coordinate);
      const bonus = upgradeBonus(unit, 'push');
      const line = push && pushed && hexDistance(unit.coordinate, action.coordinate) <= push.range + bonus.right ? pushLine(unit.coordinate, action.coordinate, push.maxDistance + bonus.left) : undefined;
      if (!pushed || !line || action.destination !== line.at(-1)) throw new Error('Invalid push destination.');
      const landingOccupant = at(state, action.destination);
      if (!landingOccupant) { vacatedCoordinate = pushed.coordinate; pushed.coordinate = action.destination; }
      else if (landingOccupant.owner === pushed.owner) throw new Error('A pushed troop cannot land on a friendly troop.');
      else {
        if (state.bashes.some(bash => bash.target === action.destination)) throw new Error('A bash is already happening on this hex.');
        const attackerId = unitId(pushed); const defenderId = unitId(landingOccupant);
        state.bashes.push({ attackerId, defenderId, target: action.destination });
        const bashEvent: TriggerEvent = { trigger: 'bash', player, hex: action.destination, troopIds: [attackerId, defenderId], actingTroopId: action.troopId, attackerId, defenderId };
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashAttack' }, cards, [pushed.owner]);
        dispatchTrigger(state, { ...bashEvent, trigger: 'bashDefense' }, cards, [landingOccupant.owner]);
        dispatchTrigger(state, bashEvent, cards, [pushed.owner, landingOccupant.owner]);
      }
    } else {
      const maximumRange = actionRange(troop, unit, action.type);
      if (maximumRange < 0 || hexDistance(unit.coordinate, action.coordinate) > maximumRange) throw new Error('Target is out of range.');
      const targetUnit = at(state, action.coordinate);
      const isBashTarget = state.bashes.some(bash => bash.target === action.coordinate);
      const isOffensive = action.type === 'attack' || action.type === 'magic';
      if (isOffensive && targetUnit?.owner === player && !isBashTarget) throw new Error('Cannot target a friendly troop.');
      if (action.type === 'cannon') {
        const line = straightLine(unit.coordinate, action.coordinate, maximumRange);
        if (!line) throw new Error('Cannon target must be in a straight line.');
        for (const target of line) state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: 'cannon', target, value: cannonDamage(troop, unit) });
      } else {
      if (action.type === 'attack') state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: 'attack', target: action.coordinate, value: attackDamage(troop, unit, cards) });
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
        const targetAction = action.ability === 'self-defense' ? targetCard.selfDefense !== undefined : targetCard.actions.some(item => item.type === action.ability);
        const useful = action.ability === 'move' || action.ability === 'fly' ? upgrade?.right : action.ability === 'self-defense' ? upgrade?.left : (upgrade?.left ?? 0) || (upgrade?.right ?? 0);
        if (!targetAction || !useful) throw new Error('This upgrade cannot affect the selected ability.');
        target.upgrades.push({ ability: action.ability, left: upgrade?.left, right: upgrade?.right, sourceUnitId: unitId(unit) });
      } else state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: action.type, target: action.coordinate, value: effectValue(troop, action.type, cards, unit) });
      }
    }
  }
  if (unit) spendUpgrade(unit, action);
  if (action.type === 'magic' && unit) {
    dispatchTrigger(state, { trigger: 'magicUsed', player, hex: action.coordinate, troopIds: [unitId(unit)], actingTroopId: action.troopId }, cards, [player]);
  }
  resolveAfterDefenderAction(state, player, cards);
  const actingUnit = state.units.find(item => item.owner === player && item.troopId === action.troopId);
  const turnEvent = { player, hex: actingUnit?.coordinate ?? ('coordinate' in action ? action.coordinate : undefined), troopIds: actingUnit ? [unitId(actingUnit)] : [], actingTroopId: action.troopId };
  // Combat completes before end-of-turn passives. Own and opponent triggers
  // are deliberately separate, so a card can opt into exactly one of them.
  dispatchTrigger(state, { ...turnEvent, trigger: 'end' }, cards, [player]);
  dispatchTrigger(state, { ...turnEvent, trigger: 'opponentEnd' }, cards, [player === 1 ? 2 : 1]);
  state.lastActingTroopId ??= {};
  state.lastActingTroopId[player] = action.troopId;
  state.revision = (state.revision ?? 0) + 1;
  state.events ??= [];
  state.events.push({ revision: state.revision, player, action: structuredClone(action), ...(vacatedCoordinate ? { origin: vacatedCoordinate } : {}) });
  state.activePlayer = player === 1 ? 2 : 1;
  const nextPlayer = state.activePlayer;
  dispatchTrigger(state, { trigger: 'start', player: nextPlayer, troopIds: [] }, cards, [nextPlayer]);
  dispatchTrigger(state, { trigger: 'opponentStart', player: nextPlayer, troopIds: [] }, cards, [nextPlayer === 1 ? 2 : 1]);
  return state;
}

function resolveAfterDefenderAction(state: GameState, defender: Player, cards: ReadonlyMap<string, TroopSeed>): void {
  const resolvedUpgradeSources = new Set<UnitId>();
  for (const effect of state.effects.filter(item => item.owner !== defender && (item.kind === 'attack' || item.kind === 'cannon'))) {
    if (effect.sourceUnitId) resolvedUpgradeSources.add(effect.sourceUnitId);
    const unit = at(state, effect.target);
    if (unit && unit.owner === defender) { unit.permanentDamage += Math.max(0, effect.value - modifier(state, unit, cards)); if (health(unit, cards) === 0) remove(state, unit, cards); }
  }
  for (const effect of state.effects.filter(item => item.owner !== defender && item.kind === 'magic')) {
    if (effect.sourceUnitId) resolvedUpgradeSources.add(effect.sourceUnitId);
    const unit = at(state, effect.target);
    if (unit && unit.owner === defender && health(unit, cards) <= effect.value) remove(state, unit, cards);
  }
  for (const bash of [...state.bashes]) {
    const attacker = findUnit(state, bash.attackerId);
    const target = at(state, bash.target);
    const originalDefender = findUnit(state, bash.defenderId);
    if (!attacker || !originalDefender) { state.bashes = state.bashes.filter(item => item !== bash); continue; }
    if (originalDefender.owner !== defender) continue;
    // The defending unit may spend its response action moving away.  That is
    // a dodge, not combat: the attacker enters the now-vacant hex and neither
    // unit receives bash damage.
    const defenderDodged = originalDefender.coordinate !== bash.target;
    if (defenderDodged || !target || !matchesUnitId(target, bash.defenderId) || target.owner !== defender) {
      attacker.coordinate = bash.target;
      dispatchTrigger(state, { trigger: 'bashRetreat', player: attacker.owner, hex: bash.target, troopIds: [unitId(attacker), unitId(originalDefender)], attackerId: unitId(attacker), defenderId: unitId(originalDefender) }, cards, [attacker.owner, originalDefender.owner]);
      state.bashes = state.bashes.filter(item => item !== bash);
      continue;
    }
    const attackerVirtual = { ...attacker, coordinate: bash.target };
    const attackerModifier = modifier(state, attacker, cards, attackerVirtual);
    const defenderModifier = modifier(state, target, cards, attackerVirtual);
    const attackerPower = health(attacker, cards) + attackerModifier;
    const defenderPower = health(target, cards) + defenderModifier;
    if (attackerPower === defenderPower) { remove(state, attacker, cards); remove(state, target, cards); }
    else {
      const winner = attackerPower > defenderPower ? attacker : target;
      const loser = winner === attacker ? target : attacker;
      const loserCombat = winner === attacker ? defenderPower : attackerPower;
      const winnerModifier = winner === attacker ? attackerModifier : defenderModifier;
      winner.permanentDamage += Math.max(0, loserCombat - winnerModifier);
      remove(state, loser, cards);
      if (winner === attacker && state.units.includes(winner)) winner.coordinate = bash.target;
    }
    state.bashes = state.bashes.filter(item => item !== bash);
  }
  const resolvedEnemyAttack = state.effects.some(effect => effect.owner !== defender && (effect.kind === 'attack' || effect.kind === 'cannon' || effect.kind === 'magic'));
  state.effects = state.effects.filter(effect => effect.owner === defender && !(effect.kind === 'defense' && resolvedEnemyAttack));
  // Do this after all pending effects have read their boosted values. It also
  // keeps the purple upgraded numbers visible until the opponent's response
  // resolves the attack.
  for (const sourceId of resolvedUpgradeSources) {
    const source = findUnit(state, sourceId);
    if (source?.upgrades) source.upgrades = [];
  }
}
