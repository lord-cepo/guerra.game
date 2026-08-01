import type { UpgradableAbility } from '../game/cards.js';
import type { Coordinate } from '../game/board.js';
import type { GameAction, PendingResolution } from '../game/engine.js';
import type { Player } from '../game/types.js';

export type GameActionType = GameAction['type'];

export interface ServerLegalAction {
  type: GameActionType;
  troopId: string;
  coordinate?: Coordinate;
  destination?: Coordinate;
  targetUnitId?: string;
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
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number; sourceUnitId?: string }>;
  combat: {
    health: number;
    modifier: number;
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
  kind: 'attack' | 'cannon' | 'bomb' | 'magic' | 'defense';
  target: Coordinate;
  value: number;
}

export interface ServerBashState {
  attackerId: string;
  defenderId: string;
  target: Coordinate;
}

export interface ServerControlState {
  controller?: Player;
  playerOne: number;
  playerTwo: number;
}

export interface ServerGameEvent {
  player: Player;
  action: { type: GameActionType; troopId: string; coordinate?: Coordinate };
  origin?: Coordinate;
}

export interface ServerTargetSelection {
  troopId: string;
  type: GameActionType;
  coordinate: Coordinate;
}

export interface ServerMatchState {
  id: string;
  activePlayer: Player;
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
  bombs?: Array<{ owner: Player; sourceTroopId: string; coordinate: Coordinate; damage: number }>;
  bashes: ServerBashState[];
  pendingResolution?: PendingResolution;
  lastActingTroopId?: Partial<Record<Player, string>>;
  selections?: Partial<Record<Player, string>>;
  targetSelections?: Partial<Record<Player, ServerTargetSelection>>;
  legalActions?: Partial<Record<Player, ServerLegalAction[]>>;
  control: Record<string, ServerControlState>;
  events?: ServerGameEvent[];
}
