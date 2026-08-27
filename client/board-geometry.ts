import type { RegionId } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { Point } from './board-animation-geometry.js';

export const svgNamespace = 'http://www.w3.org/2000/svg';
export const hexSize = 42;
export const hexGap = 1.5;
export const horizontalScale = 1.4;
const boardCenter: Point = { x: 400, y: 310 };

export function axialToPixel(x: number, y: number): Point {
  const verticalX = Math.sqrt(3) * hexSize * (x - y / 2);
  const verticalY = 1.5 * hexSize * y;
  return { x: boardCenter.x + verticalY * horizontalScale, y: boardCenter.y - verticalX };
}

export function hexPoints(cx: number, cy: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = 60 * index * Math.PI / 180;
    return `${cx + (hexSize - hexGap) * horizontalScale * Math.cos(angle)},${cy + (hexSize - hexGap) * Math.sin(angle)}`;
  }).join(' ');
}

export function controlledBoardHexArtwork(regionId: RegionId | undefined, controller?: Player): string | undefined {
  if (controller === 1) return regionId === 'p1-start' || regionId === 'p2-start' || regionId === 'front' ? 'hex_dark_red.png' : 'hex_light_red.png';
  if (controller === 2) return regionId === 'p1-start' || regionId === 'p2-start' || regionId === 'front' ? 'hex_dark_blue.png' : 'hex_light_blue.png';
  return regionId === 'p1-start' ? 'hex_dark_red.png'
    : regionId === 'p1-middle' || regionId === 'p1-side' ? 'hex_light_red.png'
      : regionId === 'p2-start' ? 'hex_dark_blue.png'
        : regionId === 'p2-middle' || regionId === 'p2-side' ? 'hex_light_blue.png'
          : regionId === 'front' ? 'hex_grey.png' : undefined;
}

export function boardHexArtwork(regionId: RegionId | undefined, position: Point): SVGImageElement | undefined {
  const filename = controlledBoardHexArtwork(regionId);
  if (!filename) return undefined;
  const image = document.createElementNS(svgNamespace, 'image');
  image.classList.add('board-hex-artwork'); image.setAttribute('href', `./assets/${filename}`);
  image.setAttribute('x', String(position.x - 64.37)); image.setAttribute('y', String(position.y - 46.23));
  image.setAttribute('width', '128.16'); image.setAttribute('height', '93.82'); image.setAttribute('preserveAspectRatio', 'none'); image.setAttribute('aria-hidden', 'true');
  return image;
}
