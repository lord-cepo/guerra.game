import type { RegionType } from './cards.js';
import type { Player } from './types.js';

export type Coordinate = `${number},${number}`;
export type RegionId = 'p1-start' | 'p2-start' | 'p1-middle' | 'p2-middle' | 'p1-side' | 'p2-side' | 'front';

export interface BoardRegion {
  id: RegionId;
  type: RegionType;
  home?: Player;
}

const playerOneStart = new Set<Coordinate>(['1,2', '1,3', '1,4', '2,3', '2,4', '3,4']);
const playerOneMiddle = new Set<Coordinate>(['0,1', '0,2', '0,3', '-1,1', '-2,1', '-1,2']);
const playerOneSide = new Set<Coordinate>(['1,1', '2,1', '3,1', '2,2', '3,2', '3,3']);

export function toCoordinate(x: number, y: number): Coordinate {
  return `${x},${y}`;
}

export function oppositeCoordinate(coordinate: Coordinate): Coordinate {
  const [x, y] = coordinate.split(',').map(Number);
  return toCoordinate(-x, -y);
}

const playerTwoStart = new Set([...playerOneStart].map(oppositeCoordinate));
const playerTwoMiddle = new Set([...playerOneMiddle].map(oppositeCoordinate));
const playerTwoSide = new Set([...playerOneSide].map(oppositeCoordinate));

const regions: ReadonlyArray<readonly [ReadonlySet<Coordinate>, BoardRegion]> = [
  [playerOneStart, { id: 'p1-start', type: 'starting', home: 1 }],
  [playerTwoStart, { id: 'p2-start', type: 'starting', home: 2 }],
  [playerOneMiddle, { id: 'p1-middle', type: 'intermediate', home: 1 }],
  [playerTwoMiddle, { id: 'p2-middle', type: 'intermediate', home: 2 }],
  [playerOneSide, { id: 'p1-side', type: 'intermediate', home: 1 }],
  [playerTwoSide, { id: 'p2-side', type: 'intermediate', home: 2 }]
];

export function isBoardCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== 'string' || value === '0,0') return false;
  const match = value.match(/^(-?\d+),(-?\d+)$/);
  if (!match) return false;
  const [x, y] = match.slice(1).map(Number);
  return x >= -3 && x <= 3 && y >= -4 && y <= 4 && x - y >= -3 && x - y <= 3;
}

export const PLAYABLE_COORDINATES: readonly Coordinate[] = Array.from({ length: 9 }, (_, yIndex) => yIndex - 4)
  .flatMap(y => Array.from({ length: 7 }, (_, xIndex) => xIndex - 3).map(x => toCoordinate(x, y)))
  .filter(isBoardCoordinate);

export function hexDistance(from: Coordinate, to: Coordinate): number {
  const [fromX, fromY] = from.split(',').map(Number);
  const [toX, toY] = to.split(',').map(Number);
  return Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), Math.abs((toX - toY) - (fromX - fromY)));
}

/** Coordinates after `from` on a board-aligned line, including `to`. */
export function straightLine(from: Coordinate, to: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number);
  const [toX, toY] = to.split(',').map(Number);
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const steps = hexDistance(from, to);
  if (!steps || steps > maxDistance || !(deltaX === 0 || deltaY === 0 || deltaX === deltaY)) return undefined;
  const stepX = deltaX === 0 ? 0 : deltaX / Math.abs(deltaX);
  const stepY = deltaY === 0 ? 0 : deltaY / Math.abs(deltaY);
  const line = Array.from({ length: steps }, (_, index) =>
    toCoordinate(fromX + stepX * (index + 1), fromY + stepY * (index + 1))
  );
  // The centre is a gap, not an obstruction: lines may cross but not end on it.
  return isBoardCoordinate(to) && line.every(coordinate => coordinate === '0,0' || isBoardCoordinate(coordinate))
    ? line
    : undefined;
}

export function adjacentCoordinates(coordinate: Coordinate): Coordinate[] {
  const [x, y] = coordinate.split(',').map(Number);
  return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
    .map(([deltaX, deltaY]) => toCoordinate(x + deltaX, y + deltaY));
}

export function regionAt(coordinate: Coordinate): BoardRegion | undefined {
  if (!isBoardCoordinate(coordinate)) return undefined;
  for (const [coordinates, region] of regions) {
    if (coordinates.has(coordinate)) return region;
  }
  return { id: 'front', type: 'front' };
}
