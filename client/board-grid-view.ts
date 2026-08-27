import { regionAt, toCoordinate, type Coordinate } from '../game/board.js';
import type { Point } from './board-animation-geometry.js';
import { axialToPixel, boardHexArtwork, hexPoints, svgNamespace } from './board-geometry.js';

export interface BoardCellView { cell: SVGGElement; position: Point }

interface BoardGridHandlers {
  enter(coordinate: Coordinate): void;
  leave(coordinate: Coordinate): void;
  focus(coordinate: Coordinate): void;
  blur(coordinate: Coordinate): void;
  revealBashAttacker(coordinate: Coordinate): boolean;
  restoreBashDefender(coordinate: Coordinate): void;
  click(coordinate: Coordinate, cell: SVGGElement): void;
  backgroundClick(): void;
}

export function createBoardGrid(board: SVGSVGElement, handlers: BoardGridHandlers): Map<Coordinate, BoardCellView> {
  const cells = new Map<Coordinate, BoardCellView>();
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -3; x <= 3; x += 1) {
      if (x - y < -3 || x - y > 3) continue;
      const position = axialToPixel(x, y);
      const coordinate = toCoordinate(x, y);
      const isCenter = coordinate === '0,0';
      const cell = document.createElementNS(svgNamespace, 'g'); cell.classList.add('cell');
      const regionId = regionAt(coordinate)?.id;
      const regionClass = regionId === 'p1-start' ? 'player-one' : regionId === 'p2-start' ? 'player-two'
        : regionId === 'p1-middle' ? 'player-one-middle' : regionId === 'p2-middle' ? 'player-two-middle'
          : regionId === 'p1-side' ? 'player-one-side' : regionId === 'p2-side' ? 'player-two-side'
            : regionId === 'front' ? 'front' : undefined;
      if (regionClass) cell.classList.add(regionClass); if (isCenter) cell.classList.add('center');
      cell.dataset.x = String(x); cell.dataset.y = String(y); cell.id = `hex-${x}-${y}`;
      const points = hexPoints(position.x, position.y);
      const hex = document.createElementNS(svgNamespace, 'polygon'); hex.classList.add('hex'); hex.setAttribute('points', points);
      const clipId = `hex-clip-${x}-${y}`; const clip = document.createElementNS(svgNamespace, 'clipPath'); clip.id = clipId; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const clipHex = document.createElementNS(svgNamespace, 'polygon'); clipHex.setAttribute('points', points); clip.append(clipHex); cell.dataset.clipId = clipId;
      const label = document.createElementNS(svgNamespace, 'text'); label.classList.add('coordinate'); label.setAttribute('x', String(position.x)); label.setAttribute('y', String(position.y + 4)); label.textContent = `${x}, ${y}`;
      const artwork = boardHexArtwork(regionId, position); cell.append(clip, ...(artwork ? [artwork] : []), hex, label);
      cell.addEventListener('pointerenter', () => handlers.enter(coordinate)); cell.addEventListener('pointerleave', () => handlers.leave(coordinate));
      cell.addEventListener('focus', () => handlers.focus(coordinate)); cell.addEventListener('blur', () => handlers.blur(coordinate));
      if (!isCenter) installCellActivation(cell, coordinate, handlers);
      cells.set(coordinate, { cell, position }); board.append(cell);
    }
  }
  board.addEventListener('click', event => { if (event.target === board) handlers.backgroundClick(); });
  return cells;
}

function installCellActivation(cell: SVGGElement, coordinate: Coordinate, handlers: BoardGridHandlers): void {
  let longPressTimer: number | undefined;
  let attackerRevealed = false;
  let suppressNextClick = false;
  const cancelLongPress = (): void => { if (longPressTimer !== undefined) window.clearTimeout(longPressTimer); longPressTimer = undefined; };
  cell.addEventListener('pointerdown', () => {
    cancelLongPress();
    longPressTimer = window.setTimeout(() => { attackerRevealed = handlers.revealBashAttacker(coordinate); longPressTimer = undefined; }, 600);
  });
  cell.addEventListener('pointerup', () => {
    cancelLongPress();
    if (attackerRevealed) { suppressNextClick = true; attackerRevealed = false; handlers.restoreBashDefender(coordinate); }
  });
  cell.addEventListener('pointerleave', () => { cancelLongPress(); attackerRevealed = false; });
  cell.addEventListener('click', () => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    handlers.click(coordinate, cell);
  });
}
