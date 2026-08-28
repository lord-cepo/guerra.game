import type { GameActionType } from './protocol.js';
import { boardDescriptionEntries, type Troop } from './troop-view.js';
import { hexGap, hexSize, horizontalScale, svgNamespace } from './board-geometry.js';
import type { Point } from './board-animation-geometry.js';

export interface BoardDescriptionOptions {
  includeSelfBlock?: boolean;
  revealMoveOne?: boolean;
  ignitionDamage?: number;
  modifier?: number | string;
  magicModifier?: number;
}

const emojiPattern = /(❤️|♥|🥾|🪽|🏹|🛡️|🔥|🧨|🐏|💣|🫸|🫷|🚫|🔮|⚔️|👑|🩸|💀|👼|❗)/gu;
export const boardDescriptionLineHeight = 9;

export function signedModifier(value: number): string { return `${value >= 0 ? '+' : ''}${value}`; }

/** Keep a physical/magic modifier pair centered as one SVG text run. */
export function writeModifierPair(marker: SVGTextElement, physical: number, magic = 0): void {
  marker.replaceChildren(document.createTextNode(signedModifier(physical)));
  if (!magic) return;
  const magicValue = document.createElementNS(svgNamespace, 'tspan');
  magicValue.classList.add('magic-modifier');
  magicValue.textContent = signedModifier(magic);
  marker.append(magicValue);
}

function displayedEntries(troop: Troop, options: BoardDescriptionOptions): ReturnType<typeof boardDescriptionEntries> {
  const entries = boardDescriptionEntries(troop, options.includeSelfBlock, options.revealMoveOne);
  const contextual = options.ignitionDamage
    ? entries.map(line => line.action === 'magic' ? { ...line, text: `${options.ignitionDamage} 💣` } : line)
    : entries;
  if (options.modifier === undefined) return contextual;
  return [contextual[0] ?? { text: '' }, { text: typeof options.modifier === 'number' ? signedModifier(options.modifier) : options.modifier }, ...contextual.slice(1)];
}

export function boardDescriptionLineY(position: Point, lineCount: number, index: number): number {
  if (index === 0) return position.y - 19;
  const hasModifier = lineCount === 5;
  if (hasModifier && index === 1) return position.y - 19 + boardDescriptionLineHeight;
  return position.y + 11 + (index - (hasModifier ? 2 : 1)) * boardDescriptionLineHeight;
}

function appendText(parent: SVGTSpanElement, text: string, magicShield = false): void {
  for (const token of text.split(emojiPattern).filter(Boolean)) {
    const span = document.createElementNS(svgNamespace, 'tspan');
    span.textContent = token;
    if (token.match(emojiPattern)) {
      span.classList.add('board-info-emoji');
      if (magicShield && token === '🛡️') { span.classList.add('magic-modifier'); span.textContent = '🛡︎'; }
    } else span.classList.add('board-info-glyph');
    parent.append(span);
  }
}

function appendMagicText(parent: SVGTSpanElement, text: string): void {
  for (const part of text.split(/(~[^~]+~)/u).filter(Boolean)) {
    if (!(part.startsWith('~') && part.endsWith('~'))) { appendText(parent, part); continue; }
    const value = document.createElementNS(svgNamespace, 'tspan');
    value.classList.add('magic-modifier'); value.style.fill = '#c084fc'; value.textContent = part.slice(1, -1); parent.append(value);
  }
}

export function appendBoardInfoFrame(cell: SVGGElement, troop: Troop, position: Point, keepUpright: (element: SVGElement, centre: Point) => void): void {
  const frame = document.createElementNS(svgNamespace, 'polygon');
  frame.dataset.serverRender = 'info-frame';
  frame.classList.add('board-info-frame', troop.owner === 1 ? 'player-one-info-frame' : 'player-two-info-frame');
  const radius = hexSize - hexGap;
  const quarter = Math.sqrt(3) / 4;
  const centre = { x: position.x, y: position.y + radius * quarter };
  const points = [{ x: 3 / 4, y: 0 }, { x: 1 / 2, y: -quarter }, { x: -1 / 2, y: -quarter }, { x: -3 / 4, y: 0 }, { x: -1 / 2, y: quarter }, { x: 1 / 2, y: quarter }];
  frame.setAttribute('points', points.map(point => `${centre.x + point.x * radius * horizontalScale},${centre.y + point.y * radius}`).join(' '));
  frame.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  keepUpright(frame, position); cell.append(frame);
}

export function writeBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, options: BoardDescriptionOptions): void {
  marker.replaceChildren();
  const lines = displayedEntries(troop, options);
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(svgNamespace, 'tspan');
    row.setAttribute('x', String(position.x)); row.setAttribute('y', String(boardDescriptionLineY(position, lines.length, index)));
    if (index === 0 && line.text.includes('♥')) {
      row.classList.add('board-health');
      const ownerClass = troop.owner === 1 ? 'player-one-health' : 'player-two-health';
      const wounded = line.text.match(/^(\d+)\s*(♥|❤️)\s*(\d+)$/u);
      const healthy = line.text.match(/^(♥|❤️)\s*(\d+)$/u);
      if (wounded || healthy) {
        if (wounded) { const current = document.createElementNS(svgNamespace, 'tspan'); current.classList.add('board-health-value', ownerClass); current.textContent = `${wounded[1]} `; row.append(current); }
        const heart = document.createElementNS(svgNamespace, 'tspan'); heart.classList.add('board-health-heart', ownerClass); heart.textContent = wounded?.[2] ?? healthy?.[1] ?? '♥';
        const total = document.createElementNS(svgNamespace, 'tspan'); total.classList.add('board-health-value', ownerClass); total.textContent = ` ${wounded?.[3] ?? healthy?.[2] ?? ''}`;
        row.append(heart, total); marker.append(row); continue;
      }
    }
    if (index === 1 && options.modifier !== undefined) {
      row.classList.add(troop.owner === 1 ? 'player-one-health' : 'player-two-health');
      if (options.magicModifier) {
        const magicText = signedModifier(options.magicModifier);
        const modifierText = typeof options.modifier === 'string' ? options.modifier : signedModifier(options.modifier);
        const physicalText = modifierText.endsWith(magicText) ? modifierText.slice(0, -magicText.length) : modifierText;
        if (physicalText) appendText(row, physicalText);
        const magic = document.createElementNS(svgNamespace, 'tspan'); magic.classList.add('magic-modifier'); magic.style.fill = '#c084fc'; magic.textContent = magicText;
        row.append(magic); marker.append(row); continue;
      }
    }
    if (line.upgraded) row.classList.add('upgraded-effect');
    const values = line.text.match(/^(\d+)(.*?)(\d+)( \.\.\.)?$/u);
    if (values && (line.staticLeft || line.staticRight)) {
      const left = document.createElementNS(svgNamespace, 'tspan'); appendText(left, values[1]);
      const middle = document.createElementNS(svgNamespace, 'tspan'); appendText(middle, values[2]);
      const right = document.createElementNS(svgNamespace, 'tspan'); appendText(right, values[3]);
      if (line.staticLeft) left.classList.add('static-effect'); if (line.staticRight) right.classList.add('static-effect');
      row.append(left, middle, right); if (values[4]) appendText(row, values[4]);
    } else if (line.magicModifier) appendMagicText(row, line.text);
    else appendText(row, line.text, line.action === 'magic-defense' || line.action === 'self-magic-defense');
    marker.append(row);
  }
}

export function appendActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action: GameActionType | undefined, options: BoardDescriptionOptions & { highlightLife?: boolean; negativeSelfBlock?: boolean }, keepUpright: (element: SVGElement, centre: Point) => void): void {
  const relevant = action === 'self-defense' && options.includeSelfBlock ? 'self-defense' : action === 'self-magic-defense' && options.includeSelfBlock ? 'self-magic-defense' : action === 'self-defense' ? 'defense' : action === 'self-magic-defense' ? 'magic-defense' : action;
  if (!options.highlightLife && !relevant) return;
  const entries = displayedEntries(troop, { ...options, revealMoveOne: relevant === 'move' });
  const index = options.highlightLife ? 0 : entries.findIndex(line => line.action === relevant);
  if (index < 0) return;
  const rect = document.createElementNS(svgNamespace, 'rect');
  rect.dataset.serverRender = 'description-highlight'; rect.classList.add('action-description-highlight', troop.owner === 1 ? 'player-one-highlight' : 'player-two-highlight');
  if (options.negativeSelfBlock) rect.classList.add('self-block-pending-highlight');
  const width = Math.min(72, Math.max(18, entries[index].text.length * 7.4 + 8));
  rect.setAttribute('x', String(position.x - width / 2)); rect.setAttribute('y', String(boardDescriptionLineY(position, entries.length, index) - 9));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', '11'); rect.setAttribute('rx', '2'); rect.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  keepUpright(rect, position); cell.append(rect);
}
