import { type Player, type TroopSeed, type UpgradableAbility } from './cards.js';

export type Coordinate = `${number},${number}`;
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
export type PassiveTiming = 'start' | 'end';

export function createGameState(): GameState { return { activePlayer: 1, units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: [], triggerEvents: [] }; }
export function unitId(unit: Pick<UnitState, 'owner' | 'troopId' | 'id'>): UnitId { return unit.id ?? `${unit.owner}:${unit.troopId}`; }
function findUnit(state: GameState, id: string): UnitState | undefined { return state.units.find(unit => unit.id === id || unitId(unit) === id || (!unit.id && unit.troopId === id)); }
function matchesUnitId(unit: UnitState, id: string): boolean { return unit.id === id || unitId(unit) === id || (!unit.id && unit.troopId === id); }
export function health(unit: UnitState, cards: Map<string, TroopSeed>): number { return Math.max(0, (cards.get(unit.troopId)?.baseHealth ?? 0) - unit.permanentDamage); }
export function combatBreakdown(state: GameState, troopId: string, cards: Map<string, TroopSeed>, contestedCoordinate?: Coordinate): { health: number; modifier: number; total: number; controller?: Player } {
  const unit = findUnit(state, troopId);
  if (!unit) throw new Error('Troop is not on the board.');
  const bash = contestedCoordinate ? state.bashes.find(item => item.target === contestedCoordinate) : undefined;
  const bashAttacker = bash ? findUnit(state, bash.attackerId) : undefined;
  const virtual = contestedCoordinate ? { ...(bashAttacker ?? unit), coordinate: contestedCoordinate } : undefined;
  const currentHealth = health(unit, cards);
  const currentModifier = modifier(state, unit, cards, virtual);
  return { health: currentHealth, modifier: currentModifier, total: currentHealth + currentModifier, controller: controller(state, contestedCoordinate ?? unit.coordinate, cards, virtual) };
}
function card(cards: Map<string, TroopSeed>, id: string): TroopSeed { const result = cards.get(id); if (!result) throw new Error('Unknown troop.'); return result; }
function at(state: GameState, coordinate: Coordinate): UnitState | undefined { return state.units.find(unit => unit.coordinate === coordinate); }
function upgradeBonus(unit: UnitState, ability: UpgradableAbility): Required<Pick<Upgrade, 'left' | 'right'>> { return (unit.upgrades ?? []).filter(upgrade => upgrade.ability === ability || upgrade.ability === undefined).reduce((total, upgrade) => ({ left: total.left + (upgrade.left ?? 0), right: total.right + (upgrade.right ?? 0) }), { left: 0, right: 0 }); }
function moveRange(troop: TroopSeed, unit: UnitState): number { return (troop.actions.find(action => action.type === 'move')?.maxDistance ?? 0) + upgradeBonus(unit, 'move').right; }
function flyRange(troop: TroopSeed, unit: UnitState): number { return (troop.actions.find(action => action.type === 'fly')?.maxDistance ?? 0) + upgradeBonus(unit, 'fly').right; }
function range(troop: TroopSeed, unit: UnitState, type: 'attack' | 'cannon' | 'magic' | 'defense' | 'push' | 'mending' | 'upgrade'): number { const action = troop.actions.find(item => item.type === type); return action && 'range' in action ? action.range + upgradeBonus(unit, type).right + (type === 'attack' ? unit.rangedRangeBonus ?? 0 : 0) : -1; }
function attackDamage(troop: TroopSeed, unit: UnitState, cards: Map<string, TroopSeed>): number {
  const action = troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'attack' }> => item.type === 'attack');
  return (action?.damage ?? health(unit, cards)) + (unit.rangedDamageBonus ?? 0) + upgradeBonus(unit, 'attack').left;
}
function value(troop: TroopSeed, type: 'magic' | 'defense', cards: Map<string, TroopSeed>, unit: UnitState): number {
  if (type === 'magic') return (troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'magic' }> => item.type === 'magic')?.damage ?? health(unit, cards)) + upgradeBonus(unit, 'magic').left;
  return (troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'defense' }> => item.type === 'defense')?.block ?? health(unit, cards)) + upgradeBonus(unit, 'defense').left;
}
function cannonDamage(troop: TroopSeed, unit: UnitState): number { return (troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'cannon' }> => item.type === 'cannon')?.damage ?? 0) + upgradeBonus(unit, 'cannon').left; }
/** Immediate abilities spend their upgrade straight away. Delayed attacks keep
 * it visible until their pending effect is actually resolved next turn. */
function spendUpgrade(unit: UnitState, action: GameAction): void { if (['move', 'fly', 'defense', 'self-defense', 'push', 'mending', 'upgrade'].includes(action.type)) unit.upgrades = []; }
function distance(a: Coordinate, b: Coordinate): number { const [ax, ay] = a.split(',').map(Number); const [bx, by] = b.split(',').map(Number); return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs((ax - ay) - (bx - by))); }
function cannonLine(from: Coordinate, to: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number); const [toX, toY] = to.split(',').map(Number);
  const dx = toX - fromX; const dy = toY - fromY; const steps = distance(from, to);
  if (!steps || steps > maxDistance || !((dx === 0) || (dy === 0) || (dx === dy))) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx); const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: steps }, (_, index) => `${fromX + stepX * (index + 1)},${fromY + stepY * (index + 1)}` as Coordinate);
  // A cannonball may travel across the board's central gap.  The gap is not
  // a playable destination, but it does not block a straight-line shot.
  return line.every(coordinate => coordinate === '0,0' || valid(coordinate)) ? line : undefined;
}
function pushLine(from: Coordinate, target: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number); const [targetX, targetY] = target.split(',').map(Number);
  const dx = targetX - fromX; const dy = targetY - fromY; const steps = distance(from, target);
  if (!steps || !(dx === 0 || dy === 0 || dx === dy)) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx); const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: maxDistance }, (_, index) => `${targetX + stepX * (index + 1)},${targetY + stepY * (index + 1)}` as Coordinate);
  // A push displaces a troop in a straight line; unlike movement it may pass
  // over the board's central gap. Only the final landing hex must be playable.
  return valid(line.at(-1) as Coordinate) ? line : undefined;
}
function neighbours(coordinate: Coordinate): Coordinate[] { const [x, y] = coordinate.split(',').map(Number); return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]].map(([dx, dy]) => `${x + dx},${y + dy}` as Coordinate); }
function hasFreePath(state: GameState, from: Coordinate, to: Coordinate, maxDistance: number): boolean {
  const visited = new Set<Coordinate>([from]); const queue: Array<[Coordinate, number]> = [[from, 0]];
  while (queue.length) { const [current, steps] = queue.shift() as [Coordinate, number]; if (steps === maxDistance) continue; for (const next of neighbours(current)) { if (!valid(next) || visited.has(next)) continue; if (next === to) return true; if (at(state, next)) continue; visited.add(next); queue.push([next, steps + 1]); } }
  return false;
}
function valid(c: Coordinate): boolean { const match = c.match(/^(-?\d+),(-?\d+)$/); if (!match || c === '0,0') return false; const [x, y] = match.slice(1).map(Number); return x >= -3 && x <= 3 && y >= -4 && y <= 4 && x - y >= -3 && x - y <= 3; }
const p1Start = new Set<Coordinate>(['1,2','1,3','1,4','2,3','2,4','3,4']);
const p1Middle = new Set<Coordinate>(['0,1','0,2','0,3','-1,1','-2,1','-1,2']);
const p1Side = new Set<Coordinate>(['1,1','2,1','3,1','2,2','3,2','3,3']);
const flip = (coordinate: Coordinate): Coordinate => { const [x, y] = coordinate.split(',').map(Number); return `${-x},${-y}`; };
function region(c: Coordinate): { id: string; type: 'starting' | 'intermediate' | 'front'; home?: Player } { if (p1Start.has(c)) return { id: 'p1-start', type: 'starting', home: 1 }; if ([...p1Start].map(flip).includes(c)) return { id: 'p2-start', type: 'starting', home: 2 }; if (p1Middle.has(c)) return { id: 'p1-middle', type: 'intermediate', home: 1 }; if ([...p1Middle].map(flip).includes(c)) return { id: 'p2-middle', type: 'intermediate', home: 2 }; if (p1Side.has(c)) return { id: 'p1-side', type: 'intermediate', home: 1 }; if ([...p1Side].map(flip).includes(c)) return { id: 'p2-side', type: 'intermediate', home: 2 }; return { id: 'front', type: 'front' }; }
export interface ControlState { id: string; type: 'starting' | 'intermediate' | 'front'; home?: Player; playerOne: number; playerTwo: number; controller?: Player; }
export function controlAt(state: GameState, coordinate: Coordinate, cards: Map<string, TroopSeed>, virtual?: UnitState): ControlState { const target = region(coordinate); let one = target.home === 1 ? .5 : 0; let two = target.home === 2 ? .5 : 0; const units = virtual ? [...state.units.filter(unit => unitId(unit) !== unitId(virtual)), virtual] : state.units; for (const unit of units) { if (region(unit.coordinate).id !== target.id) continue; if (unit.owner === 1) one += health(unit, cards); else two += health(unit, cards); } return { ...target, playerOne: one, playerTwo: two, controller: one === two ? undefined : one > two ? 1 : 2 }; }
export function controlSummary(state: GameState, cards: Map<string, TroopSeed>): Record<string, ControlState> {
  return Object.fromEntries(['1,2','-1,-2','0,1','0,-1','1,1','-1,-1','1,0'].map(coordinate => {
    // A pending attacker is already contesting the destination.  Use that
    // virtual position everywhere control is shown, just as bash resolution
    // does after the defender has completed their response.
    // The summary uses one representative coordinate per region.  A bash can
    // happen on any hex in that region, so find it by region rather than only
    // by that representative coordinate.
    const bash = state.bashes.find(item => region(item.target).id === region(coordinate as Coordinate).id);
    const attacker = bash ? findUnit(state, bash.attackerId) : undefined;
    const summary = controlAt(state, coordinate as Coordinate, cards, attacker ? { ...attacker, coordinate: bash!.target } : undefined);
    return [summary.id, summary];
  }));
}
function controller(state: GameState, coordinate: Coordinate, cards: Map<string, TroopSeed>, virtual?: UnitState): Player | undefined { return controlAt(state, coordinate, cards, virtual).controller; }
function shieldBonus(unit: UnitState, effect: Effect): number { return (unit.troopId === 'p2-2' || unit.troopId === 'river-otter') && effect.owner === unit.owner && (effect.sourceUnitId ?? `${effect.owner}:${effect.sourceTroopId}`) !== unitId(unit) ? 1 : 0; }
function modifier(state: GameState, unit: UnitState, cards: Map<string, TroopSeed>, virtual?: UnitState): number {
  const combatCoordinate = virtual?.coordinate ?? unit.coordinate;
  const block = state.effects.filter(effect => effect.kind === 'defense' && effect.owner === unit.owner && effect.target === combatCoordinate).reduce((sum, effect) => sum + effect.value + shieldBonus(unit, effect), 0);
  const bash = state.bashes.find(item => item.target === combatCoordinate && (item.attackerId === unitId(unit) || item.defenderId === unitId(unit)));
  // Steady is a live opposing-side bash passive. It suppresses the opponent's
  // shield, control, and conditional bonuses, never the Hawk's own modifier
  // or either troop's base health, and applies whether the Hawk attacks or
  // defends.
  if (bash) {
    const opponentId = bash.attackerId === unitId(unit) ? bash.defenderId : bash.attackerId;
    if (findUnit(state, opponentId)?.troopId === 'canyon-hawk') return 0;
  }
  const isAttacker = bash?.attackerId === unitId(unit);
  const warTempleAura = Boolean(bash && state.units.some(item => item.owner === unit.owner && item.troopId === 'war-temple'));
  return block + (block > 0 && (unit.troopId === 'p1-5' || unit.troopId === 'marsh-badger') ? -1 : 0) + (unit.troopId === 'alps-lone-wolf' && unit.permanentDamage > 0 ? 2 : 0) + (unit.troopId === 'canyon-ibex' && isAttacker ? 2 : 0) + (warTempleAura ? 1 : 0) + (controller(state, combatCoordinate, cards, virtual) === unit.owner ? 1 : 0);
}
function remove(state: GameState, unit: UnitState, cards: Map<string, TroopSeed>): void { state.units = state.units.filter(item => item !== unit); state.defeatedTroopIds ??= []; state.defeatedTroopIds.push(unitId(unit)); if (card(cards, unit.troopId).role === 'hero') state.winner = unit.owner === 1 ? 2 : 1; }

export type PassiveHandler = (state: GameState, unit: UnitState, event: TriggerEvent, cards: Map<string, TroopSeed>) => void;
export type TimedPassiveHandler = (state: GameState, unit: UnitState, actingTroopId: string | undefined) => void;
const passiveHandlers: Partial<Record<Trigger, Partial<Record<string, PassiveHandler>>>> = {
  // Squirrel King heals only after it personally casts magic, never because
  // another troop acts or because its turn ends.
  magicUsed: { 'p2-hero': (state, unit, event) => {
    if (event.actingTroopId === unit.troopId) unit.permanentDamage = Math.max(0, unit.permanentDamage - 1);
  }, 'squirrel-king': (state, unit, event) => {
    if (event.actingTroopId === unit.troopId) unit.permanentDamage = Math.max(0, unit.permanentDamage - 1);
  } },
  bashAttack: { 'sahel-porcupine': (_state, unit, event) => {
    if (event.attackerId !== unitId(unit)) return;
    unit.rangedDamageBonus = (unit.rangedDamageBonus ?? 0) + 1;
    unit.rangedRangeBonus = (unit.rangedRangeBonus ?? 0) + 1;
  }, 'p1-4': (_state, unit, event) => {
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
export function dispatchTrigger(state: GameState, event: TriggerEvent, cards: Map<string, TroopSeed>, listenerOwners: readonly Player[] = [1, 2]): void {
  state.triggerEvents ??= [];
  state.triggerEvents.push(structuredClone(event));
  const handlers = passiveHandlers[event.trigger] ?? {};
  const units = state.units.filter(unit => listenerOwners.includes(unit.owner)).sort((left, right) => {
    const leftHero = card(cards, left.troopId).role === 'hero'; const rightHero = card(cards, right.troopId).role === 'hero';
    return leftHero === rightHero ? left.troopId.localeCompare(right.troopId) : leftHero ? -1 : 1;
  });
  for (const unit of units) handlers[unit.troopId]?.(state, unit, event, cards);
}

/** Compatibility wrapper for the former start/end-only passive API. */
export function registerTimedPassive(timing: PassiveTiming, troopId: string, handler: TimedPassiveHandler): () => void {
  return registerPassive(timing, troopId, (state, unit, event) => handler(state, unit, event.actingTroopId));
}

export function runTimedPassives(state: GameState, player: Player, timing: PassiveTiming, cards: Map<string, TroopSeed>, actingTroopId?: string): void {
  const actingUnit = actingTroopId ? state.units.find(unit => unit.owner === player && unit.troopId === actingTroopId) : undefined;
  dispatchTrigger(state, { trigger: timing, player, hex: actingUnit?.coordinate, troopIds: actingUnit ? [unitId(actingUnit)] : [], actingTroopId }, cards, [player]);
}

export function applyGameAction(before: GameState, player: Player, action: GameAction, cards: Map<string, TroopSeed>): GameState {
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
  if (action.type !== 'self-defense' && !valid(action.coordinate)) throw new Error('Invalid hex.');
  const troop = card(cards, action.troopId);
  const unit = state.units.find(item => item.owner === player && item.troopId === action.troopId);
  let vacatedCoordinate: Coordinate | undefined;
  if (action.type === 'deploy') {
    if (unit || state.defeatedTroopIds?.includes(`${player}:${action.troopId}`) || at(state, action.coordinate)) throw new Error('Deployment hex is unavailable.');
    const targetRegion = region(action.coordinate);
    const enemyIntermediateOnly = troop.passiveDescription === 'Can be deployed only in enemy intermediate regions';
    const enemyRegionOnly = troop.deploymentRule === 'enemy-region';
    const allowed = enemyRegionOnly
      ? troop.deploymentRegions.includes(targetRegion.type) && targetRegion.home !== undefined && targetRegion.home !== player && controller(state, action.coordinate, cards) === player
      : enemyIntermediateOnly
      ? targetRegion.type === 'intermediate' && targetRegion.home !== player && controller(state, action.coordinate, cards) === player
      : troop.deploymentRegions.includes(targetRegion.type) && controller(state, action.coordinate, cards) === player;
    if (!allowed) throw new Error('You do not control a valid deployment region.');
    if (troop.role !== 'hero' && !state.units.some(item => item.owner === player && card(cards, item.troopId).role === 'hero')) throw new Error('Deploy your hero first.');
    state.units.push({ id: `${player}:${action.troopId}`, troopId: action.troopId, owner: player, coordinate: action.coordinate, permanentDamage: 0 });
  } else {
    if (!unit) throw new Error('Your troop is not deployed.');
    if (action.type === 'move' || action.type === 'fly') {
      const maxDistance = action.type === 'move' ? moveRange(troop, unit) : flyRange(troop, unit);
      if (distance(unit.coordinate, action.coordinate) > maxDistance || (action.type === 'move' && !hasFreePath(state, unit.coordinate, action.coordinate, maxDistance))) throw new Error(action.type === 'fly' ? 'Flight destination is out of range.' : 'Move has no free path.');
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
      const push = troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'push' }> => item.type === 'push');
      const pushed = at(state, action.coordinate);
      const bonus = upgradeBonus(unit, 'push');
      const line = push && pushed && distance(unit.coordinate, action.coordinate) <= push.range + bonus.right ? pushLine(unit.coordinate, action.coordinate, push.maxDistance + bonus.left) : undefined;
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
      const actionRange = range(troop, unit, action.type);
      if (actionRange < 0 || distance(unit.coordinate, action.coordinate) > actionRange) throw new Error('Target is out of range.');
      const targetUnit = at(state, action.coordinate);
      const isBashTarget = state.bashes.some(bash => bash.target === action.coordinate);
      const isOffensive = action.type === 'attack' || action.type === 'magic';
      if (isOffensive && targetUnit?.owner === player && !isBashTarget) throw new Error('Cannot target a friendly troop.');
      if (action.type === 'cannon') {
        const line = cannonLine(unit.coordinate, action.coordinate, actionRange);
        if (!line) throw new Error('Cannon target must be in a straight line.');
        for (const target of line) state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: 'cannon', target, value: cannonDamage(troop, unit) });
      } else {
      if (action.type === 'attack') state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: 'attack', target: action.coordinate, value: attackDamage(troop, unit, cards) });
      else if (action.type === 'mending') {
        const target = at(state, action.coordinate);
        if (!target || target.owner !== player) throw new Error('Mending must target a friendly troop.');
        const mending = troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'mending' }> => item.type === 'mending');
        target.permanentDamage = Math.max(0, target.permanentDamage - (mending?.amount ?? 0) - upgradeBonus(unit, 'mending').left);
      } else if (action.type === 'upgrade') {
        const target = at(state, action.coordinate);
        if (!target || target.owner !== player) throw new Error('Upgrade must target a friendly troop.');
        if (card(cards, target.troopId).role === 'temple') throw new Error('A temple cannot be upgraded.');
        const upgrade = troop.actions.find((item): item is Extract<TroopSeed['actions'][number], { type: 'upgrade' }> => item.type === 'upgrade');
        target.upgrades ??= [];
        const targetCard = card(cards, target.troopId);
        const targetAction = action.ability === 'self-defense' ? targetCard.selfDefense !== undefined : targetCard.actions.some(item => item.type === action.ability);
        const useful = action.ability === 'move' || action.ability === 'fly' ? upgrade?.right : action.ability === 'self-defense' ? upgrade?.left : (upgrade?.left ?? 0) || (upgrade?.right ?? 0);
        if (!targetAction || !useful) throw new Error('This upgrade cannot affect the selected ability.');
        target.upgrades.push({ ability: action.ability, left: upgrade?.left, right: upgrade?.right, sourceUnitId: unitId(unit) });
      } else state.effects.push({ owner: player, sourceTroopId: action.troopId, sourceUnitId: unitId(unit), kind: action.type, target: action.coordinate, value: value(troop, action.type, cards, unit) });
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

function resolveAfterDefenderAction(state: GameState, defender: Player, cards: Map<string, TroopSeed>): void {
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
    const attackerModifier = modifier(state, attacker, cards, attackerVirtual) + (attacker.troopId === 'p1-4' ? 2 : 0);
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
