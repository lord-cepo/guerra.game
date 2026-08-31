import type { UpgradableAbility } from '../game/cards.js';
import type { Player } from '../game/types.js';
import type { Point } from './board-animation-geometry.js';
import { hexGap, hexSize, horizontalScale, svgNamespace } from './board-geometry.js';
import { cardRuleDetails, catalogueById, goreIcon, healthDescription, healthOf, permanentUpgradeBonus, pullIcon, staticAuraBonus, stunIcon, troopDisplayName, upgradeBonus, type Troop } from './troop-view.js';

export interface CardDetail { text: string; upgraded?: boolean; magicModifier?: boolean; magicShield?: boolean }

const missingCardArtwork = new Set<string>();
const boardCardMasks = new Map<string, string>();
let boardCardMaskSequence = 0;

export function troopSprite(role: Troop['role'], owner?: Player, boardVariant = false): string {
  if (role === 'temple') {
    if (boardVariant && owner) return `assets/sprites/temple-${owner === 1 ? 'red' : 'blue'}-board.svg`;
    return 'assets/sprites/temple.svg';
  }
  const kind = role === 'hero' ? 'crown' : 'helm';
  const colour = owner === 1 ? 'red' : owner === 2 ? 'blue' : 'tray';
  return `assets/sprites/${kind}-${colour}${boardVariant && owner ? '-board' : ''}.svg`;
}

export function cardTroopIcon(role: Troop['role']): HTMLImageElement {
  const icon = document.createElement('img'); icon.classList.add('troop-symbol'); icon.src = troopSprite(role);
  icon.alt = role === 'hero' ? 'Hero crown' : role === 'temple' ? 'Temple' : 'Troop helm'; return icon;
}

function appendRelationText(parent: HTMLElement, text: string, owner: Player, extraClass?: string): void {
  for (const part of text.split(/(\[\[(?:friend|enemy)(?:-dark)?:[^\]]+\]\])/u).filter(Boolean)) {
    const marker = part.match(/^\[\[(friend|enemy)(-dark)?:([^\]]+)\]\]$/u);
    if (!marker) { const node = document.createTextNode(part); parent.append(node); continue; }
    const player = marker[1] === 'friend' ? owner : owner === 1 ? 2 : 1;
    const span = document.createElement('span'); span.classList.add(`relation-player-${player}${marker[2] ? '-dark' : ''}`);
    if (extraClass) span.classList.add(extraClass); span.textContent = marker[3]; parent.append(span);
  }
}

export function appendMagicDescriptionText(parent: HTMLElement, text: string, owner: Player = 1): void {
  for (const part of text.split(/(~[^~]+~)/u).filter(Boolean)) {
    if (part.startsWith('~') && part.endsWith('~')) {
      const magic = document.createElement('span'); magic.classList.add('magic-detail'); appendRelationText(magic, part.slice(1, -1), owner); parent.append(magic);
    } else appendRelationText(parent, part, owner);
  }
}

function appendCardDetailText(line: HTMLElement, text: string, owner: Player, magicShield = false): void {
  if (!magicShield) { appendMagicDescriptionText(line, text, owner); return; }
  const [before, ...after] = text.split('🛡️'); appendMagicDescriptionText(line, before, owner);
  const shield = document.createElement('span'); shield.classList.add('magic-detail', 'magic-symbol'); shield.textContent = '🛡︎'; line.append(shield);
  if (after.length) appendMagicDescriptionText(line, after.join('🛡️'), owner);
}

function cardVisual(troop: Troop, healthText: string): HTMLSpanElement {
  const visual = document.createElement('span'); visual.classList.add('card-visual');
  const health = document.createElement('span'); health.classList.add('card-health'); health.textContent = healthText;
  visual.append(cardTroopIcon(troop.role), health); return visual;
}

export function cardHealthDescription(troop: Troop): string {
  return healthOf(troop) === troop.baseHealth ? `♥ ${troop.baseHealth}` : healthDescription(troop);
}

export function appendTroopCardContent(card: HTMLElement, troop: Troop, detailLines: readonly CardDetail[], healthText: string): void {
  if (!missingCardArtwork.has(troop.cardId)) {
    const artwork = document.createElement('img'); artwork.classList.add('troop-card-artwork'); artwork.src = `assets/cards/${troop.cardId}.png`;
    artwork.alt = ''; artwork.loading = 'lazy'; artwork.decoding = 'async'; artwork.setAttribute('aria-hidden', 'true');
    artwork.addEventListener('error', () => { missingCardArtwork.add(troop.cardId); artwork.remove(); }, { once: true }); card.append(artwork);
  }
  const copy = document.createElement('span'); copy.classList.add('card-copy');
  const title = document.createElement('strong'); title.textContent = troopDisplayName(troop);
  const details = document.createElement('span'); details.classList.add('troop-details');
  for (const detail of detailLines) {
    const line = document.createElement('span'); appendCardDetailText(line, detail.text, troop.owner, detail.magicShield);
    if (detail.upgraded) line.classList.add('upgraded-detail'); details.append(line);
  }
  copy.append(title, details);
  const frame = document.createElement('span'); frame.classList.add('troop-card-frame'); card.append(copy, cardVisual(troop, healthText), frame);
}

export function createHoverCard(troop: Troop): { card: HTMLElement; copy: HTMLElement } {
  const card = document.createElement('section'); card.classList.add('hover-card', troop.owner === 1 ? 'server-owner-one' : 'server-owner-two');
  const artwork = document.createElement('img'); artwork.classList.add('troop-card-artwork');
  if (!missingCardArtwork.has(troop.cardId)) artwork.src = `assets/cards/${troop.cardId}.png`;
  artwork.alt = ''; artwork.decoding = 'async'; artwork.setAttribute('aria-hidden', 'true');
  artwork.addEventListener('error', () => { missingCardArtwork.add(troop.cardId); artwork.remove(); }, { once: true });
  const copy = document.createElement('span'); copy.classList.add('hover-card-copy');
  const heading = document.createElement('strong'); heading.textContent = troopDisplayName(troop); copy.append(heading);
  const frame = document.createElement('span'); frame.classList.add('troop-card-frame');
  card.append(artwork, copy, cardVisual(troop, cardHealthDescription(troop)), frame); return { card, copy };
}

export function appendHoverRules(copy: HTMLElement, troop: Troop): void {
  const list = document.createElement('div'); list.classList.add('hover-rule-list');
  for (const [index, rule] of cardRuleDetails(troop).entries()) {
    const line = document.createElement('div'); line.classList.add('hover-rule-line'); if (index === 0) line.classList.add('hover-deployment-rule');
    appendRichHoverRule(line, troop, rule); list.append(line);
  }
  copy.append(list);
}

function appendRichHoverRule(line: HTMLElement, troop: Troop, rule: string): void {
  const match = rule.match(/^(\d+)([PF]*)(🏹|🔥|🛡️|🧨|🐏|💣|❤️|🫸|🫷|🚫)(\d+)(.*)$/u);
  const movement = rule.match(/^(🥾|🪽)(\d+)(.*)$/u);
  if (!match && movement) {
    const ability = movement[1] === '🥾' ? 'move' : 'fly'; const temporary = upgradeBonus(troop, ability);
    const aura = ability === 'move' ? staticAuraBonus(troop, 'move') : { left: 0, right: 0 };
    line.append(document.createTextNode(`${movement[1]}${Number(movement[2]) - temporary.right - aura.right}`));
    appendBonus(line, temporary.right, 'temporary-upgrade'); appendBonus(line, aura.right, 'static-upgrade'); appendBoldCopy(line, movement[3], troop.owner);
    appendUpgradeSources(line, troop, ability, (troop.staticAuras ?? []).filter(source => source.ability === ability).map(source => source.sourceCardId)); return;
  }
  if (!match) { appendBoldCopy(line, rule, troop.owner); return; }
  const ability = match[3] === '🏹' ? 'attack' : match[3] === '🔥' ? 'magic' : match[3] === '🛡️' ? 'defense' : match[3] === '🧨' ? 'cannon' : match[3] === goreIcon ? 'gore' : match[3] === '💣' ? 'bomb' : match[3] === '❤️' ? 'mending' : match[3] === pullIcon ? 'pull' : match[3] === stunIcon ? 'stun' : 'push';
  const temporary = upgradeBonus(troop, ability); const aura = ability === 'attack' || ability === 'magic' ? staticAuraBonus(troop, ability) : { left: 0, right: 0 };
  const permanent = ability === 'attack' || ability === 'magic' ? permanentUpgradeBonus(troop, ability) : { left: 0, right: 0 };
  const magenta = { left: aura.left + permanent.left, right: aura.right + permanent.right };
  line.append(document.createTextNode(String(Number(match[1]) - temporary.left - magenta.left))); appendBonus(line, temporary.left, 'temporary-upgrade'); appendBonus(line, magenta.left, 'static-upgrade'); line.append(document.createTextNode(match[2]));
  if (match[3] === '🛡️' && rule.toLowerCase().includes('magic')) { const shield = document.createElement('span'); shield.classList.add('magic-detail', 'magic-symbol'); shield.textContent = '🛡︎'; line.append(shield); } else line.append(document.createTextNode(match[3]));
  line.append(document.createTextNode(String(Number(match[4]) - temporary.right - magenta.right))); appendBonus(line, temporary.right, 'temporary-upgrade'); appendBonus(line, magenta.right, 'static-upgrade'); appendBoldCopy(line, match[5], troop.owner);
  const sources = (troop.staticAuras ?? []).filter(source => source.ability === ability).map(source => source.sourceCardId); if (permanent.left || permanent.right) sources.push(troop.cardId);
  appendUpgradeSources(line, troop, ability, sources);
}

function appendBonus(line: HTMLElement, value: number, className: string): void {
  if (!value) return; const span = document.createElement('span'); span.classList.add(className); span.textContent = `+${value}`; line.append(span);
}

function appendBoldCopy(line: HTMLElement, text: string, owner: Player): void {
  for (const token of text.split(/(\([^)]+\)|^[^:]+:)/u).filter(Boolean)) {
    if ((token.startsWith('(') && token.endsWith(')')) || token.endsWith(':')) { const label = document.createElement('strong'); label.classList.add('hover-rule-label'); label.textContent = token; line.append(label); }
    else appendMagicDescriptionText(line, token, owner);
  }
}

function appendUpgradeSources(line: HTMLElement, troop: Troop, ability: UpgradableAbility, staticSourceIds: readonly string[]): void {
  const temporary = [...new Set((troop.upgrades ?? []).filter(upgrade => (upgrade.ability === ability || upgrade.ability === undefined) && upgrade.sourceUnitId).map(upgrade => upgrade.sourceUnitId?.split(':').slice(1).join(':')).filter((id): id is string => Boolean(id)))];
  for (const [sources, className] of [[temporary, 'temporary-upgrade'], [[...new Set(staticSourceIds)], 'static-upgrade']] as const) {
    for (const sourceId of sources) { const source = document.createElement('span'); source.classList.add(className, 'hover-upgrade-source'); source.textContent = catalogueById.get(sourceId)?.name ?? sourceId; line.append(source); }
  }
}

export function boardTroopIcon(role: Troop['role'], owner: Player, x: number, y: number, size = 32): SVGImageElement {
  const icon = document.createElementNS(svgNamespace, 'image'); icon.setAttribute('href', troopSprite(role, owner, true));
  icon.setAttribute('x', String(x - size / 2)); icon.setAttribute('y', String(y - size / 2)); icon.setAttribute('width', String(size)); icon.setAttribute('height', String(size)); icon.setAttribute('preserveAspectRatio', 'xMidYMid meet'); return icon;
}

function boardCardEdgeMask(board: SVGSVGElement, position: Point, width: number, height: number): string {
  const key = `${position.x},${position.y}`; const existing = boardCardMasks.get(key);
  if (existing && board.querySelector(existing.slice(4, -1))) return existing;
  const id = `board-card-edge-fade-${boardCardMaskSequence++}`; const mask = document.createElementNS(svgNamespace, 'mask'); mask.id = id;
  mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('maskContentUnits', 'userSpaceOnUse'); mask.setAttribute('x', String(position.x - width / 2)); mask.setAttribute('y', String(position.y - height / 2)); mask.setAttribute('width', String(width)); mask.setAttribute('height', String(height));
  for (let step = 1; step <= 20; step += 1) {
    const scale = 1 - step * .005; const polygon = document.createElementNS(svgNamespace, 'polygon');
    polygon.setAttribute('points', Array.from({ length: 6 }, (_, index) => { const angle = 60 * index * Math.PI / 180; return `${position.x + (hexSize - hexGap) * horizontalScale * scale * Math.cos(angle)},${position.y + (hexSize - hexGap) * scale * Math.sin(angle)}`; }).join(' '));
    polygon.setAttribute('fill', 'white'); polygon.setAttribute('fill-opacity', String(step / 20)); mask.append(polygon);
  }
  board.querySelector('defs')?.append(mask); const reference = `url(#${id})`; boardCardMasks.set(key, reference); return reference;
}

export function boardCardMarker(board: SVGSVGElement, troop: Troop, position: Point, clipId?: string): SVGGElement {
  const marker = document.createElementNS(svgNamespace, 'g'); const fallback = boardTroopIcon(troop.role, troop.owner, position.x, position.y);
  if (missingCardArtwork.has(troop.cardId)) { marker.append(fallback); return marker; }
  const width = hexSize * 2 * horizontalScale; const height = hexSize * 2; const picture = document.createElementNS(svgNamespace, 'image');
  picture.setAttribute('href', `assets/cards/${troop.cardId}.png`); picture.setAttribute('x', String(position.x - width / 2)); picture.setAttribute('y', String(position.y - height / 2)); picture.setAttribute('width', String(width)); picture.setAttribute('height', String(height)); picture.setAttribute('preserveAspectRatio', 'xMidYMid slice'); picture.setAttribute('mask', boardCardEdgeMask(board, position, width, height));
  if (clipId) picture.setAttribute('clip-path', `url(#${clipId})`); picture.classList.add('board-card-picture');
  picture.addEventListener('load', () => fallback.remove(), { once: true }); picture.addEventListener('error', () => { missingCardArtwork.add(troop.cardId); picture.remove(); }, { once: true });
  marker.append(fallback, picture); return marker;
}
