import type { UpgradableAbility } from '../game/cards.js';
import type { Coordinate } from '../game/board.js';
import type { GameAction, PendingResolution, StackAction, TurnPhase } from '../game/engine.js';
import type { Player } from '../game/types.js';

export type GameActionType = GameAction['type'];

export interface ServerLegalAction {
  type: GameActionType;
  troopId: string;
  coordinate?: Coordinate;
  destination?: Coordinate;
  targetUnitId?: string;
  targetBomb?: boolean;
  targetTroopId?: string;
  ability?: UpgradableAbility;
}

export interface ServerUnitState {
  id: string;
  troopId: string;
  owner: Player;
  coordinate: Coordinate;
  permanentDamage: number;
  currentHealth: number;
  maxHealth?: number;
  maxLifeBonus?: number;
  inactive?: boolean;
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  bashModifierBonus?: number;
  magicModifierBonus?: number;
  stunnedTurns?: number;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number; sourceUnitId?: string }>;
  shields?: Array<{ value: number; sourceUnitId?: string }>;
  combat: {
    health: number;
    modifier: number;
    magicModifier: number;
    modifiers: Array<{ label: string; value: number }>;
    total: number;
    controller?: Player;
  };
}

export interface ServerEffectState {
  owner: Player;
  sourceTroopId: string;
  sourceUnitId?: string;
  targetUnitId?: string;
  kind: 'attack' | 'cannon' | 'gore' | 'bomb' | 'magic' | 'stun';
  target: Coordinate;
  value: number;
  pierce?: boolean;
  origin?: Coordinate;
  goreDestination?: Coordinate;
}

export interface ServerBashState {
  attackerId: string;
  defenderId: string;
  target: Coordinate;
  awaitingEnd?: boolean;
}

export interface ServerControlState {
  controller?: Player;
  playerOne: number;
  playerTwo: number;
}

export interface ServerGameEvent {
  player: Player;
  action: { type: GameActionType; troopId: string; coordinate?: Coordinate; destination?: Coordinate; targetUnitId?: string; targetBomb?: boolean };
  origin?: Coordinate;
}

export interface ServerTriggerEvent {
  trigger: string;
  actionKind?: string;
  player: Player;
  hex?: Coordinate;
  troopIds: string[];
  actingTroopId?: string;
  attackerId?: string;
  defenderId?: string;
  firstStrike?: {
    unitId: string;
    targetId: string;
    firstDamage: number;
    retaliationDamage: number;
    targetSurvived: boolean;
  };
}

export interface ServerTargetSelection {
  troopId: string;
  type: GameActionType;
  coordinate: Coordinate;
}

export interface ServerMatchState {
  id: string;
  activePlayer: Player;
  phase: TurnPhase;
  players: { 1: string; 2: string };
  sandbox?: boolean;
  sandboxSide?: Player;
  sandboxFreePlacement?: boolean;
  sandboxUndoAvailable?: boolean;
  ready: { 1: boolean; 2: boolean };
  format: 8 | 10;
  status: 'active' | 'finished';
  winner?: Player;
  revision: number;
  decks: { 1: string[]; 2: string[] };
  deckChoices?: { 1?: number; 2?: number };
  units: ServerUnitState[];
  defeatedTroopIds: string[];
  effects: ServerEffectState[];
  bombs?: Array<{ owner: Player; sourceTroopId: string; coordinate: Coordinate; damage: number; pierce?: boolean }>;
  bashes: ServerBashState[];
  pendingResolution?: PendingResolution;
  dashboard: StackAction[];
  resolutionStack: number[];
  currentEventId?: number;
  lastActingTroopId?: Partial<Record<Player, string>>;
  turnCounts?: Partial<Record<Player, number>>;
  turnNumber?: number;
  selections?: Partial<Record<Player, string>>;
  targetSelections?: Partial<Record<Player, ServerTargetSelection>>;
  legalActions?: Partial<Record<Player, ServerLegalAction[]>>;
  control: Record<string, ServerControlState>;
  events?: ServerGameEvent[];
  triggerEvents?: ServerTriggerEvent[];
}
