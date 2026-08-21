import type { UpgradableAbility } from './game/cards.js';
import { adjacentCoordinates, hexDistance, regionAt, straightLine, toCoordinate, type Coordinate, type RegionId } from './game/board.js';
import { combatSummary, type GameState, type UnitId, type UnitState } from './game/engine.js';
import type { Player } from './game/types.js';
import { addDeckCard, clearDeckSlots, completedDeckFormats, createDeckSlots, moveDeckCard, removeDeckCard, selectedDeckCards, swapDeckCards, type DeckFormat, type DeckSlots } from './client/deck-state.js';
import type { GameActionType, ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './client/protocol.js';
import { actionOfType, boardDescriptionEntries, cardRuleDetails, catalogueById, catalogueIds, compareTroopsForTray, createTroopView, deploymentDescription, fullEffectLines, hasDeploymentTarget, healthDescription, healthOf, permanentUpgradeBonus, pushIcon, rangedDamage, serverCardDetails, staticAuraBonus, threeLineSummary, trayRoleLabel, troopDisplayName, upgradeBonus, type Troop } from './client/troop-view.js';

interface Point {
  x: number;
  y: number;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const boardPanel = requiredElement<SVGSVGElement>('#board');
const boardAreaPanel = requiredElement<HTMLElement>('.board-area');
const playerOneCardsPanel = requiredElement<HTMLElement>('#player-one-cards');
const playerTwoCardsPanel = requiredElement<HTMLElement>('#player-two-cards');
const actionBarPanel = requiredElement<HTMLElement>('#action-bar');
const gameLayoutPanel = requiredElement<HTMLElement>('.game-layout');
const troopInspectorPanel = requiredElement<HTMLElement>('#troop-inspector');
const inspectorContentPanel = requiredElement<HTMLElement>('#inspector-content');
const inspectorCloseButton = requiredElement<HTMLButtonElement>('#inspector-close');
const hoverDetailsPanel = requiredElement<HTMLElement>('#hover-details');
const loginScreenPanel = requiredElement<HTMLElement>('#login-screen');
const menuScreenPanel = requiredElement<HTMLElement>('#menu-screen');
const loginFormPanel = requiredElement<HTMLFormElement>('#login-form');
const nicknameInputField = requiredElement<HTMLInputElement>('#nickname');
const loginErrorPanel = requiredElement<HTMLElement>('#login-error');
const welcomePanel = requiredElement<HTMLElement>('#welcome');
const deckReadinessPanel = requiredElement<HTMLElement>('#deck-readiness');
const buildDecksButtonPanel = requiredElement<HTMLButtonElement>('#build-decks');
const playGameButtonPanel = requiredElement<HTMLButtonElement>('#play-game');
const sandboxGameButtonPanel = requiredElement<HTMLButtonElement>('#sandbox-game');
const resumeSandboxButtonPanel = requiredElement<HTMLButtonElement>('#resume-sandbox');
const playFormatsPanel = requiredElement<HTMLElement>('#play-formats');
const playEightCardsButtonPanel = requiredElement<HTMLButtonElement>('#play-8-cards');
const playTenCardsButtonPanel = requiredElement<HTMLButtonElement>('#play-10-cards');
const backFromPlayButtonPanel = requiredElement<HTMLButtonElement>('#back-from-play');
const playFormatErrorPanel = requiredElement<HTMLElement>('#play-format-error');
const sandboxFormatsPanel = requiredElement<HTMLElement>('#sandbox-formats');
const sandboxEightCardsButtonPanel = requiredElement<HTMLButtonElement>('#sandbox-8-cards');
const sandboxTenCardsButtonPanel = requiredElement<HTMLButtonElement>('#sandbox-10-cards');
const loadSandboxButtonPanel = requiredElement<HTMLButtonElement>('#load-sandbox');
const backFromSandboxButtonPanel = requiredElement<HTMLButtonElement>('#back-from-sandbox');
const sandboxErrorPanel = requiredElement<HTMLElement>('#sandbox-error');
const matchScreenPanel = requiredElement<HTMLElement>('#match-screen');
const matchStatusPanel = requiredElement<HTMLElement>('#match-status');
const matchDecksPanel = requiredElement<HTMLElement>('#match-decks');
const openMatchBoardButtonPanel = requiredElement<HTMLButtonElement>('#open-match-board');
const mainPanel = requiredElement<HTMLElement>('main');
const connectionStatusPanel = requiredElement<HTMLElement>('#connection-status');

const cellsByCoordinate = new Map<Coordinate, { cell: SVGGElement; position: Point }>();
let currentNickname: string | undefined;
let playgroundEnabled = false;
let activeDeckIndex = 0;
let deckFormat: DeckFormat = 8;
let activeMatchId: string | undefined;
let matchSocket: WebSocket | undefined;
let localMatchPlayer: Player | undefined;
let serverMatch: ServerMatchState | undefined;
let serverSelectedTroopId: string | undefined;
let serverRequestedTroopId: string | undefined;
let serverSelectionRequestPending = false;
const playedDeploymentAnimations = new Set<string>();
let confirmedDeploymentAnimationRevision: number | undefined;
const bashHoverTimers = new WeakMap<SVGGElement, number>();
let serverInspectedUnitId: string | undefined;
let serverSelectedAction: GameActionType | undefined;
let serverPendingAction: ServerLegalAction | undefined;
let serverPushTargetChoices: ServerLegalAction[] = [];
let serverActionError: string | undefined;
let serverPreviewPath: Coordinate[] = [];
let serverHoverPreviewCoordinate: Coordinate | undefined;
let serverBashReveal: 'defender' | 'attacker' = 'defender';
let resumableSandbox: ServerMatchState | undefined;
let reconnectTimer: number | undefined;
let draggedDatabaseCardId: string | undefined;
let draggedDeckSlot: number | undefined;
let draggedBoardTroop: { owner: Player; troopId: string; mode: 'deploy' | 'free' } | undefined;
let activeDragPreview: HTMLElement | undefined;
let activeDragSource: Element | undefined;
const ignoredDragClicks = new WeakSet<Element>();
let playableDeckFormats = new Set<DeckFormat>();
let deckSlots: DeckSlots = createDeckSlots();
let deckBuilderDirty = false;
let deckBuilderNotice: string | undefined;

/** Give API failures a useful message even when a proxy returns HTML/text. */
async function readApiJson<T>(response: Response, endpoint: string): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown content type';
    const preview = body.trim().replace(/\s+/g, ' ').slice(0, 80) || '(empty response)';
    throw new Error(`${endpoint} returned ${response.status} (${contentType}), not JSON: ${preview}`);
  }
}

function renderDeckReadiness(formats?: readonly DeckFormat[], error?: string): void {
  playableDeckFormats = new Set(formats ?? []);
  const checking = formats === undefined && !error;
  playGameButtonPanel.disabled = checking || playableDeckFormats.size === 0;
  playEightCardsButtonPanel.disabled = !playableDeckFormats.has(8);
  playTenCardsButtonPanel.disabled = !playableDeckFormats.has(10);
  playEightCardsButtonPanel.textContent = playableDeckFormats.has(8) ? '8-card game' : '8-card game — deck required';
  playTenCardsButtonPanel.textContent = playableDeckFormats.has(10) ? '10-card game' : '10-card game — deck required';
  deckReadinessPanel.classList.toggle('ready', playableDeckFormats.size > 0);
  deckReadinessPanel.textContent = error ?? (checking
    ? 'Checking saved decks…'
    : playableDeckFormats.size === 0
      ? 'Build a complete deck with exactly one hero to unlock Play.'
      : `Ready to play: ${[...playableDeckFormats].map(format => `${format}-card`).join(' and ')} deck available.`);
}

async function refreshDeckReadiness(): Promise<void> {
  if (!currentNickname) return;
  renderDeckReadiness();
  try {
    const response = await fetch(`/api/decks?nickname=${encodeURIComponent(currentNickname)}`);
    const payload = await readApiJson<{ decks?: unknown; error?: string }>(response, 'Load decks');
    if (!response.ok) throw new Error(payload.error ?? 'Could not check saved decks.');
    renderDeckReadiness(completedDeckFormats(payload.decks, catalogueById));
  } catch (error) {
    renderDeckReadiness([], error instanceof Error ? error.message : 'Could not check saved decks.');
  }
}

async function persistDeck(): Promise<void> {
  const cards = selectedDeckCards(deckSlots, deckFormat);
  if (!currentNickname) return;
  const deckIndex = activeDeckIndex;
  const format = deckFormat;
  const response = await fetch(`/api/decks/${deckIndex}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: currentNickname, cards, format })
  });
  if (response.ok) return;
  const payload = await readApiJson<{ error?: string }>(response, 'Save deck');
  throw new Error(payload.error ?? 'Could not save the deck.');
}

async function loadDeck(deckIndex: number): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/decks?nickname=${encodeURIComponent(currentNickname)}`);
  const payload = await response.json() as { decks?: Record<string, unknown> };
  const formatDecks = payload.decks?.[String(deckFormat)];
  const cards = Array.isArray(formatDecks) && Array.isArray(formatDecks[deckIndex])
    ? formatDecks[deckIndex].filter((id): id is string => typeof id === 'string' && catalogueById.has(id))
    : [];
  deckSlots = createDeckSlots(cards);
  deckBuilderDirty = false;
  deckBuilderNotice = undefined;
}

function openMatchEntry(matchId: string): void {
  activeMatchId = matchId;
  serverMatch = undefined;
  playedDeploymentAnimations.clear();
  confirmedDeploymentAnimationRevision = undefined;
  menuScreenPanel.hidden = true;
  mainPanel.hidden = true;
  matchStatusPanel.textContent = `Match ${matchId.slice(0, 8)} is ready. The board will connect to the authoritative server state here.`;
  openMatchBoardButtonPanel.disabled = true;
  matchScreenPanel.hidden = false;
  void loadMatchDeckChoices(matchId);
}

function resumeLiveMatch(match: ServerMatchState): void {
  activeMatchId = match.id;
  menuScreenPanel.hidden = true;
  matchScreenPanel.hidden = true;
  mainPanel.hidden = false;
  renderServerMatchState(match);
  connectToMatch(match.id);
}

function localPlayerFor(match: ServerMatchState): Player | undefined {
  if (!currentNickname) return undefined;
  if (match.sandbox) return match.sandboxSide;
  return match.players[1] === currentNickname ? 1 : match.players[2] === currentNickname ? 2 : undefined;
}

function applyLocalPlayerView(match: ServerMatchState): Player | undefined {
  const local = localPlayerFor(match);
  if (!local) return undefined;
  localMatchPlayer = local;
  document.body.classList.toggle('local-player-one', local === 1);
  document.body.classList.toggle('local-player-two', local === 2);
  document.body.classList.toggle('active-player-one', match.activePlayer === 1);
  document.body.classList.toggle('active-player-two', match.activePlayer === 2);
  matchStatusPanel.textContent = match.sandbox
    ? `Playground: controlling ${local === 1 ? 'Red' : 'Blue'}. Control follows each turn.`
    : local === 1 ? 'You are Red and take the first turn.' : 'You are Blue. Red takes the first turn.';
  return local;
}

async function loadMatchDeckChoices(matchId: string): Promise<void> {
  if (!currentNickname) return;
  const [matchResponse, decksResponse] = await Promise.all([
    fetch(`/api/matches/${matchId}`), fetch(`/api/decks?nickname=${encodeURIComponent(currentNickname)}`)
  ]);
  const matchPayload = await matchResponse.json() as { match?: ServerMatchState };
  const decksPayload = await decksResponse.json() as { decks?: Record<string, unknown> };
  const match = matchPayload.match;
  const local = match && localPlayerFor(match);
  const formatDecks = match && decksPayload.decks?.[String(match.format)];
  if (!match || !local || !Array.isArray(formatDecks)) return;
  matchDecksPanel.replaceChildren();
  const selected = match.deckChoices?.[local];
  const label = document.createElement('p');
  label.textContent = selected === undefined ? `Choose one of your ${match.format}-card decks.` : `Deck ${selected + 1} selected.`;
  matchDecksPanel.append(label);
  let available = 0;
  formatDecks.forEach((deck, index) => {
    if (!Array.isArray(deck) || deck.length !== match.format) return;
    available += 1;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = `Deck ${index + 1}`; button.disabled = selected !== undefined;
    button.addEventListener('click', async () => {
      const response = await fetch(`/api/matches/${matchId}/deck`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname, deckIndex: index })
      });
      const payload = await response.json() as { match?: ServerMatchState; error?: string };
      if (!response.ok || !payload.match) { matchStatusPanel.textContent = payload.error ?? 'Could not select that deck.'; return; }
      matchStatusPanel.textContent = `Deck ${index + 1} locked in. Press Ready when you are set.`;
      openMatchBoardButtonPanel.disabled = false;
      await loadMatchDeckChoices(matchId);
    });
    matchDecksPanel.append(button);
  });
  if (available === 0) {
    const warning = document.createElement('p'); warning.textContent = `No completed ${match.format}-card deck is available. Build one before playing.`; matchDecksPanel.append(warning);
  }
  openMatchBoardButtonPanel.disabled = selected === undefined;
}

function serverTroop(cardId: string, owner: Player, unit?: ServerUnitState): Troop | undefined {
  const troop = createTroopView(cardId, owner, unit, serverMatch?.defeatedTroopIds.includes(`${owner}:${cardId}`));
  if (!troop || !unit || !serverMatch) return troop;
  troop.staticAuras = [];
  for (const source of serverMatch.units.filter(candidate => candidate.owner === owner)) {
    for (const bonus of catalogueById.get(source.troopId)?.continuousEffects ?? []) {
      if (bonus.kind === 'ability-bonus' && bonus.condition === 'deployed') {
        troop.staticAuras.push({ ability: bonus.ability, left: bonus.left ?? 0, right: bonus.right ?? 0, sourceCardId: source.troopId });
      }
    }
  }
  return troop;
}

function troopSprite(role: Troop['role'], owner?: Player, boardVariant = false): string {
  if (role === 'temple') {
    if (boardVariant && owner) return `assets/sprites/temple-${owner === 1 ? 'red' : 'blue'}-board.svg`;
    return 'assets/sprites/temple.svg';
  }
  const kind = role === 'hero' ? 'crown' : 'helm';
  const colour = owner === 1 ? 'red' : owner === 2 ? 'blue' : 'tray';
  return `assets/sprites/${kind}-${colour}${boardVariant && owner ? '-board' : ''}.svg`;
}

function cardTroopIcon(role: Troop['role']): HTMLImageElement {
  const icon = document.createElement('img');
  icon.classList.add('troop-symbol');
  icon.src = troopSprite(role);
  icon.alt = role === 'hero' ? 'Hero crown' : role === 'temple' ? 'Temple' : 'Troop helm';
  return icon;
}

interface CardDetail {
  text: string;
  upgraded?: boolean;
}

function cardVisual(troop: Troop, healthText: string): HTMLSpanElement {
  const visual = document.createElement('span');
  visual.classList.add('card-visual');
  const health = document.createElement('span');
  health.classList.add('card-health');
  health.textContent = healthText;
  visual.append(cardTroopIcon(troop.role), health);
  return visual;
}

function appendTroopCardContent(card: HTMLElement, troop: Troop, detailLines: readonly CardDetail[], healthText: string): void {
  if (!missingCardArtwork.has(troop.cardId)) {
    const artwork = document.createElement('img');
    artwork.classList.add('troop-card-artwork');
    artwork.src = `assets/cards/${cardArtworkFilename(troop.cardId)}`;
    artwork.alt = '';
    artwork.loading = 'lazy';
    artwork.decoding = 'async';
    artwork.setAttribute('aria-hidden', 'true');
    artwork.addEventListener('error', () => {
      missingCardArtwork.add(troop.cardId);
      artwork.remove();
    }, { once: true });
    card.append(artwork);
  }
  const copy = document.createElement('span');
  copy.classList.add('card-copy');
  const title = document.createElement('strong');
  title.textContent = troopDisplayName(troop);
  const details = document.createElement('span');
  details.classList.add('troop-details');
  for (const detail of detailLines) {
    const line = document.createElement('span');
    line.textContent = detail.text;
    if (detail.upgraded) line.classList.add('upgraded-detail');
    details.append(line);
  }
  copy.append(title, details);
  const frame = document.createElement('span');
  frame.classList.add('troop-card-frame');
  card.append(copy, cardVisual(troop, healthText), frame);
}

function createTroopDragPreview(troop: Troop, owner?: Player): HTMLElement {
  activeDragPreview?.remove();
  activeDragSource?.classList.remove('dragging-card');
  const preview = document.createElement('div');
  preview.classList.add('troop-drag-preview');
  if (owner) preview.dataset.owner = String(owner);
  const name = document.createElement('strong');
  name.textContent = troopDisplayName(troop);
  preview.append(name, cardTroopIcon(troop.role));
  document.body.append(preview);
  activeDragPreview = preview;
  return preview;
}

function beginTroopDrag(event: DragEvent, troop: Troop, source: Element, owner?: Player): void {
  const preview = createTroopDragPreview(troop, owner);
  source.classList.add('dragging-card');
  activeDragSource = source;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
  }
}

function endTroopDrag(): void {
  activeDragPreview?.remove();
  activeDragSource?.classList.remove('dragging-card');
  activeDragPreview = undefined;
  activeDragSource = undefined;
  for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('drag-over');
}

function canDropBoardTroop(dragged: typeof draggedBoardTroop): boolean {
  if (!dragged || !serverMatch || !localMatchPlayer) return false;
  if (dragged.mode === 'free') return Boolean(serverMatch.sandboxFreePlacement);
  return !serverMatch.sandboxFreePlacement
    && dragged.owner === localMatchPlayer
    && serverMatch.activePlayer === localMatchPlayer;
}

function boardCellAtPoint(x: number, y: number): SVGGElement | undefined {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest<SVGGElement>('.cell');
  return cell?.dataset.x !== undefined && cell.dataset.y !== undefined && cell.id !== 'hex-0-0' ? cell : undefined;
}

function dropBoardTroop(dragged: NonNullable<typeof draggedBoardTroop>, coordinate: Coordinate): void {
  if (dragged.mode === 'free') placeSandboxTroop(coordinate);
  else stageServerDeployment(dragged.troopId, coordinate);
}

function enablePointerBoardDrag(source: Element, troop: Troop, dragged: NonNullable<typeof draggedBoardTroop>): void {
  source.classList.add('pointer-draggable');
  source.addEventListener('click', event => {
    if (!ignoredDragClicks.delete(source)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  source.addEventListener('pointerdown', rawStartEvent => {
    const startEvent = rawStartEvent as PointerEvent;
    if (startEvent.button !== 0 || !canDropBoardTroop(dragged)) return;
    const start = { x: startEvent.clientX, y: startEvent.clientY };
    let moving = false;
    const clearTarget = (): void => {
      for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('drag-over');
    };
    const finish = (): void => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      draggedBoardTroop = undefined;
      endTroopDrag();
    };
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== startEvent.pointerId) return;
      if (!moving && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      if (!moving) {
        moving = true;
        draggedBoardTroop = dragged;
        const preview = createTroopDragPreview(troop, dragged.owner);
        preview.classList.add('pointer-drag-preview');
        source.classList.add('dragging-card');
        activeDragSource = source;
        hideHoverDetails();
      }
      event.preventDefault();
      if (activeDragPreview) activeDragPreview.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px) rotate(2deg)`;
      clearTarget();
      if (canDropBoardTroop(dragged)) boardCellAtPoint(event.clientX, event.clientY)?.classList.add('drag-over');
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerId !== startEvent.pointerId) return;
      if (moving) {
        event.preventDefault();
        const cell = boardCellAtPoint(event.clientX, event.clientY);
        if (cell && canDropBoardTroop(dragged)) {
          const coordinate = toCoordinate(Number(cell.dataset.x), Number(cell.dataset.y));
          dropBoardTroop(dragged, coordinate);
        }
        ignoredDragClicks.add(source);
      }
      finish();
    };
    const cancel = (event: PointerEvent): void => {
      if (event.pointerId === startEvent.pointerId) finish();
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
  });
}

function createHoverCard(troop: Troop): { card: HTMLElement; copy: HTMLElement } {
  const card = document.createElement('section');
  card.classList.add('hover-card', troop.owner === 1 ? 'server-owner-one' : 'server-owner-two');
  const artwork = document.createElement('img');
  artwork.classList.add('troop-card-artwork');
  if (!missingCardArtwork.has(troop.cardId)) artwork.src = `assets/cards/${cardArtworkFilename(troop.cardId)}`;
  artwork.alt = '';
  artwork.decoding = 'async';
  artwork.setAttribute('aria-hidden', 'true');
  artwork.addEventListener('error', () => {
    missingCardArtwork.add(troop.cardId);
    artwork.remove();
  }, { once: true });
  const copy = document.createElement('span');
  copy.classList.add('hover-card-copy');
  const heading = document.createElement('strong');
  heading.textContent = troopDisplayName(troop);
  copy.append(heading);
  const frame = document.createElement('span');
  frame.classList.add('troop-card-frame');
  card.append(artwork, copy, cardVisual(troop, healthDescription(troop)), frame);
  return { card, copy };
}

function appendHoverRules(copy: HTMLElement, troop: Troop): void {
  const list = document.createElement('div');
  list.classList.add('hover-rule-list');
  for (const [index, rule] of cardRuleDetails(troop).entries()) {
    const line = document.createElement('div');
    line.classList.add('hover-rule-line');
    if (index === 0) line.classList.add('hover-deployment-rule');
    appendRichHoverRule(line, troop, rule);
    list.append(line);
  }
  copy.append(list);
}

function appendRichHoverRule(line: HTMLElement, troop: Troop, rule: string): void {
  const match = rule.match(/^(\d+)(🏹|🔥|🛡️|🧨|💣|❤️|🫸)(\d+)(.*)$/u);
  const movement = rule.match(/^(🥾|🪽)(\d+)(.*)$/u);
  if (!match && movement) {
    const ability = movement[1] === '🥾' ? 'move' : 'fly';
    const temporary = upgradeBonus(troop, ability);
    const aura = ability === 'move' ? staticAuraBonus(troop, 'move') : { left: 0, right: 0 };
    line.append(document.createTextNode(`${movement[1]}${Number(movement[2]) - temporary.right - aura.right}`));
    if (temporary.right) { const value = document.createElement('span'); value.classList.add('temporary-upgrade'); value.textContent = `+${temporary.right}`; line.append(value); }
    if (aura.right) { const value = document.createElement('span'); value.classList.add('static-upgrade'); value.textContent = `+${aura.right}`; line.append(value); }
    appendBoldHoverCopy(line, movement[3]);
    appendHoverUpgradeSources(line, troop, ability, (troop.staticAuras ?? []).filter(source => source.ability === ability).map(source => source.sourceCardId));
    return;
  }
  if (!match) { appendBoldHoverCopy(line, rule); return; }
  const ability = match[2] === '🏹' ? 'attack' : match[2] === '🔥' ? 'magic' : match[2] === '🛡️' ? 'defense' : match[2] === '🧨' ? 'cannon' : match[2] === '💣' ? 'bomb' : match[2] === '❤️' ? 'mending' : 'push';
  const temporary = upgradeBonus(troop, ability);
  const aura = ability === 'attack' || ability === 'magic' ? staticAuraBonus(troop, ability) : { left: 0, right: 0 };
  const permanent = ability === 'attack' || ability === 'magic' ? permanentUpgradeBonus(troop, ability) : { left: 0, right: 0 };
  const magenta = { left: aura.left + permanent.left, right: aura.right + permanent.right };
  const totalLeft = Number(match[1]); const totalRight = Number(match[3]);
  const baseLeft = totalLeft - temporary.left - magenta.left; const baseRight = totalRight - temporary.right - magenta.right;
  const bonus = (value: number, className: string): void => {
    if (!value) return;
    const span = document.createElement('span'); span.classList.add(className); span.textContent = `+${value}`; line.append(span);
  };
  line.append(document.createTextNode(String(baseLeft)));
  bonus(temporary.left, 'temporary-upgrade'); bonus(magenta.left, 'static-upgrade');
  line.append(document.createTextNode(match[2]));
  line.append(document.createTextNode(String(baseRight)));
  bonus(temporary.right, 'temporary-upgrade'); bonus(magenta.right, 'static-upgrade');
  appendBoldHoverCopy(line, match[4]);
  const magentaSources = (troop.staticAuras ?? []).filter(source => source.ability === ability).map(source => source.sourceCardId);
  if (permanent.left || permanent.right) magentaSources.push(troop.cardId);
  appendHoverUpgradeSources(line, troop, ability, magentaSources);
}

function appendBoldHoverCopy(line: HTMLElement, text: string): void {
  const tokens = text.split(/(\([^)]+\)|^[^:]+:)/u).filter(Boolean);
  for (const token of tokens) {
    if ((token.startsWith('(') && token.endsWith(')')) || token.endsWith(':')) {
      const label = document.createElement('strong'); label.classList.add('hover-rule-label'); label.textContent = token; line.append(label);
    } else line.append(document.createTextNode(token));
  }
}

function appendHoverUpgradeSources(line: HTMLElement, troop: Troop, ability: UpgradableAbility, staticSourceIds: readonly string[]): void {
  const temporarySources = [...new Set((troop.upgrades ?? []).filter(upgrade => (upgrade.ability === ability || upgrade.ability === undefined) && upgrade.sourceUnitId).map(upgrade => upgrade.sourceUnitId?.split(':').slice(1).join(':')).filter((id): id is string => Boolean(id)))];
  const staticSources = [...new Set(staticSourceIds)];
  for (const [sources, className] of [[temporarySources, 'temporary-upgrade'], [staticSources, 'static-upgrade']] as const) {
    for (const sourceId of sources) {
      const source = document.createElement('span'); source.classList.add(className, 'hover-upgrade-source'); source.textContent = catalogueById.get(sourceId)?.name ?? sourceId; line.append(source);
    }
  }
}

function boardTroopIcon(role: Troop['role'], owner: Player, x: number, y: number, size = 32): SVGImageElement {
  const icon = document.createElementNS(ns, 'image');
  icon.setAttribute('href', troopSprite(role, owner, true));
  icon.setAttribute('x', String(x - size / 2));
  icon.setAttribute('y', String(y - size / 2));
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return icon;
}

function cardArtworkFilename(cardId: string): string {
  // New artwork is discovered by convention: assets/cards/<card-id>.png.
  // Keep this one compatibility alias until the existing file is renamed.
  return cardId === 'mole-artificer' ? 'mole-artificier.png' : `${cardId}.png`;
}

let boardCardMaskSequence = 0;
const boardCardMasks = new Map<string, string>();
const missingCardArtwork = new Set<string>();

function boardCardEdgeMask(position: Point, width: number, height: number): string {
  const defs = boardPanel.querySelector('defs');
  const key = `${position.x},${position.y}`;
  const existing = boardCardMasks.get(key);
  if (existing && boardPanel.querySelector(existing.slice(4, -1))) return existing;
  const id = `board-card-edge-fade-${boardCardMaskSequence++}`;
  const left = position.x - width / 2;
  const top = position.y - height / 2;

  const mask = document.createElementNS(ns, 'mask');
  mask.id = id;
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
  mask.setAttribute('x', String(left));
  mask.setAttribute('y', String(top));
  mask.setAttribute('width', String(width));
  mask.setAttribute('height', String(height));
  // Firefox does not reliably blur an objectBoundingBox mask applied to an
  // SVG image. Twenty sub-pixel hex bands produce the same edge-distance fade
  // without relying on SVG filter behavior: transparent at the actual cell
  // edge, fully opaque at 90% of the centre-to-edge distance.
  for (let step = 1; step <= 20; step += 1) {
    const scale = 1 - step * .005;
    const polygon = document.createElementNS(ns, 'polygon');
    polygon.setAttribute('points', Array.from({ length: 6 }, (_, index) => {
      const angle = 60 * index * Math.PI / 180;
      const x = position.x + (size - hexGap) * horizontalScale * scale * Math.cos(angle);
      const y = position.y + (size - hexGap) * scale * Math.sin(angle);
      return `${x},${y}`;
    }).join(' '));
    polygon.setAttribute('fill', 'white');
    polygon.setAttribute('fill-opacity', String(step / 20));
    mask.append(polygon);
  }
  defs?.append(mask);
  const reference = `url(#${id})`;
  boardCardMasks.set(key, reference);
  return reference;
}

function boardCardImage(cardId: string, position: Point, clipId?: string): SVGImageElement {
  const width = size * 2 * horizontalScale;
  const height = size * 2;
  const image = document.createElementNS(ns, 'image');
  image.setAttribute('href', `assets/cards/${cardArtworkFilename(cardId)}`);
  image.setAttribute('x', String(position.x - width / 2));
  image.setAttribute('y', String(position.y - height / 2));
  image.setAttribute('width', String(width));
  image.setAttribute('height', String(height));
  image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  image.setAttribute('mask', boardCardEdgeMask(position, width, height));
  if (clipId) image.setAttribute('clip-path', `url(#${clipId})`);
  image.classList.add('board-card-picture');
  return image;
}

function boardCardMarker(troop: Troop, position: Point, clipId?: string): SVGGElement {
  const marker = document.createElementNS(ns, 'g');
  const fallback = boardTroopIcon(troop.role, troop.owner, position.x, position.y, 32);
  if (missingCardArtwork.has(troop.cardId)) {
    marker.append(fallback);
    return marker;
  }
  const picture = boardCardImage(troop.cardId, position, clipId);
  picture.addEventListener('load', () => fallback.remove(), { once: true });
  picture.addEventListener('error', () => {
    missingCardArtwork.add(troop.cardId);
    picture.remove();
  }, { once: true });
  marker.append(fallback, picture);
  return marker;
}

function isServerLastActing(owner: Player, troopId: string): boolean {
  return serverMatch?.lastActingTroopId?.[owner] === troopId;
}

function selectServerTroop(troopId: string): void {
  if (!serverMatch || !localMatchPlayer || serverMatch.winner || serverMatch.activePlayer !== localMatchPlayer || isServerLastActing(localMatchPlayer, troopId)) return;
  const isInDeck = serverMatch.decks[localMatchPlayer].includes(troopId);
  if (!isInDeck || serverMatch.defeatedTroopIds.includes(`${localMatchPlayer}:${troopId}`)) return;
  serverActionError = undefined;
  serverInspectedUnitId = undefined;
  // Keep the current target set in place until the server returns the next
  // one. This lets CSS transition directly between the two sets instead of
  // briefly lowering every legal hex and raising the replacement set later.
  serverRequestedTroopId = serverSelectedTroopId === troopId ? undefined : troopId;
  serverSelectionRequestPending = true;
  sendServerSelection(serverRequestedTroopId);
}

function appendCardRoleGroup(parent: ParentNode, role: Troop['role']): HTMLElement {
  const group = document.createElement('section');
  group.className = 'card-role-group';
  const heading = document.createElement('h3');
  heading.className = 'card-role-heading';
  heading.textContent = trayRoleLabel(role);
  const cards = document.createElement('div');
  cards.className = 'card-role-cards';
  group.append(heading, cards);
  parent.append(group);
  return cards;
}

function appendGroupedTroopCards(
  parent: ParentNode,
  troops: readonly Troop[],
  renderCard: (troop: Troop) => Node
): void {
  let currentRole: Troop['role'] | undefined;
  let groupCards: HTMLElement | undefined;
  for (const troop of [...troops].sort(compareTroopsForTray)) {
    if (!groupCards || troop.role !== currentRole) {
      groupCards = appendCardRoleGroup(parent, troop.role);
      currentRole = troop.role;
    }
    groupCards.append(renderCard(troop));
  }
}

function renderServerTrayCard(
  match: ServerMatchState,
  owner: Player,
  troop: Troop,
  interactive: boolean
): HTMLButtonElement {
  const cardId = troop.cardId;
  const lastActing = isServerLastActing(owner, cardId);
  const freePlacement = Boolean(match.sandbox && match.sandboxFreePlacement);
  const canDeploy = freePlacement || hasDeploymentTarget(match, owner, troop);
  const canChoose = interactive && !match.winner && !troop.defeated && !lastActing && canDeploy;
  const dragMode = freePlacement ? 'free' : canChoose ? 'deploy' : undefined;
  const card = document.createElement('button');
  card.type = 'button';
  card.disabled = !freePlacement && !canChoose;
  card.draggable = false;
  card.classList.add('troop-card', owner === 1 ? 'server-owner-one' : 'server-owner-two');
  if (!freePlacement && owner !== match.activePlayer) card.classList.add('inactive-player-card');
  card.dataset.deploymentOwner = owner === 1 ? 'red' : 'blue';
  if (troop.role === 'hero') card.classList.add('hero-card');
  if (lastActing) card.classList.add('last-acting-card');
  if (troop.defeated || lastActing) card.classList.add('unavailable-card');
  if (!freePlacement && !canDeploy) card.classList.add('undeployable-card');
  if ((owner === localMatchPlayer && serverSelectedTroopId === cardId) || match.selections?.[owner] === cardId) card.classList.add('selected-card');
  if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-both');
  else if (troop.deploymentRegions.includes('starting')) card.classList.add('deployment-starting');
  else if (troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-intermediate');
  if (troop.deploymentRule === 'enemy-region') card.classList.add('deployment-enemy');
  const details = threeLineSummary(troop.defeated ? ['Defeated'] : serverCardDetails(troop))
    .map(text => ({ text, upgraded: text.startsWith('🔮 ') }));
  appendTroopCardContent(card, troop, details, healthDescription(troop));
  card.addEventListener('pointerenter', () => showHoverDetails([troop]));
  card.addEventListener('pointerleave', hideHoverDetails);
  card.addEventListener('focus', () => showHoverDetails([troop]));
  card.addEventListener('blur', hideHoverDetails);
  if (dragMode) enablePointerBoardDrag(card, troop, { owner, troopId: cardId, mode: dragMode });
  card.addEventListener('click', () => {
    if (canChoose) selectServerTroop(cardId);
  });
  return card;
}

function renderServerTray(owner: Player, tray: HTMLElement, interactive: boolean): void {
  const match = serverMatch;
  if (!match) return;
  tray.replaceChildren();
  tray.classList.remove('deck-builder');
  tray.classList.add('grouped-card-list');
  tray.classList.toggle('sandbox-catalog', Boolean(match.sandbox));
  const fragment = document.createDocumentFragment();
  const deployedTroopIds = new Set(match.units
    .filter(unit => unit.owner === owner)
    .map(unit => unit.troopId));
  const undeployedTroops = match.decks[owner]
    .filter(cardId => !deployedTroopIds.has(cardId))
    .map(cardId => serverTroop(cardId, owner))
    .filter((troop): troop is Troop => Boolean(troop));
  appendGroupedTroopCards(fragment, undeployedTroops, troop => renderServerTrayCard(match, owner, troop, interactive));
  tray.append(fragment);
}

function clearServerBoardRender(): void {
  boardPanel.querySelectorAll<SVGElement>('[data-server-render], .board-troop, .board-troop-description, .action-land, .bash-stat, .bash-icon').forEach(element => element.remove());
  clearServerPreviewPath();
  for (const { cell } of cellsByCoordinate.values()) {
    cell.classList.remove('server-controlled-one', 'server-controlled-two', 'server-contested', 'server-occupied', 'server-selected', 'server-selected-one', 'server-selected-two', 'server-last-acting', 'server-action-highlight', 'server-action-highlight-one', 'server-action-highlight-two', 'server-pending-target', 'server-pending-target-one', 'server-pending-target-two', 'server-pending-deployment', 'server-remote-pending-target', 'server-reachable', 'server-bash-target');
    cell.removeAttribute('tabindex');
    cell.removeAttribute('role');
    cell.removeAttribute('aria-label');
  }
}

function serverRegionController(match: ServerMatchState, coordinate: Coordinate, previewBash?: ServerBashState): Player | undefined {
  return serverControllerWithPreview(coordinate, previewBash, match);
}
/** The shared horizontal board needs no player-dependent overlay rotation. */
function keepServerOverlayUpright(_element: SVGElement, _centre: Point): void {}

function serverPreviewTargets(): Array<{ owner: Player; target: { troopId: string; type: GameActionType; coordinate: Coordinate } }> {
  if (!serverMatch) return [];
  const targets = Object.entries(serverMatch.targetSelections ?? {}).flatMap(([owner, target]) =>
    target ? [{ owner: Number(owner) as Player, target }] : []
  );
  if (!localMatchPlayer || !serverPendingAction?.coordinate) return targets;
  return [
    ...targets.filter(item => item.owner !== localMatchPlayer),
    { owner: localMatchPlayer, target: { troopId: serverPendingAction.troopId, type: serverPendingAction.type, coordinate: serverPendingAction.coordinate } }
  ];
}

/** Recalculate control with pending bashes and unconfirmed deployments included. */
function serverControllerWithPreview(coordinate: Coordinate, previewBash?: ServerBashState, match = serverMatch): Player | undefined {
  if (!match) return undefined;
  const region = regionAt(coordinate);
  if (!region) return undefined;
  let playerOne = region.home === 1 ? .5 : 0;
  let playerTwo = region.home === 2 ? .5 : 0;
  const bashTargets = new Map(match.bashes.filter(bash => !serverBashIsDodged(bash, match)).map(bash => [bash.attackerId, bash.target]));
  if (previewBash) bashTargets.set(previewBash.attackerId, previewBash.target);
  const movementPreview = serverPendingMovementPreview();
  for (const unit of match.units) {
    const unitCoordinate = movementPreview?.unit.id === unit.id
      ? movementPreview.coordinate
      : bashTargets.get(unit.id) ?? unit.coordinate;
    if (regionAt(unitCoordinate)?.id !== region.id) continue;
    if (unit.owner === 1) playerOne += unit.currentHealth;
    else playerTwo += unit.currentHealth;
  }
  if (match === serverMatch) {
    for (const { owner, target } of serverPreviewTargets()) {
      if (target.type !== 'deploy' || regionAt(target.coordinate)?.id !== region.id) continue;
      const troop = serverTroop(target.troopId, owner);
      if (!troop) continue;
      if (owner === 1) playerOne += healthOf(troop);
      else playerTwo += healthOf(troop);
    }
  }
  return playerOne === playerTwo ? undefined : playerOne > playerTwo ? 1 : 2;
}

function serverBashHasSteadyOpponent(unit: ServerUnitState, bash: ServerBashState | undefined): boolean {
  if (!bash || !serverMatch) return false;
  const opponentId = bash.attackerId === unit.id ? bash.defenderId : bash.attackerId;
  return serverMatch.units.find(candidate => candidate.id === opponentId)?.troopId === 'canyon-hawk';
}

function serverPreviewBlock(unit: ServerUnitState, coordinate: Coordinate): number {
  return serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .reduce((sum, { owner, target }) => {
      const source = serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const defense = troop ? actionOfType(troop, 'defense') : undefined;
      const value = target.type === 'self-defense'
        ? (troop?.selfDefense ?? 1) + (troop ? upgradeBonus(troop, 'self-defense').left : 0)
        : (defense?.block ?? 0) + (troop ? upgradeBonus(troop, 'defense').left : 0);
      return sum + value;
    }, 0);
}

function serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): Array<{ label: string; value: number }> {
  if (!serverMatch) return [];
  if (serverBashHasSteadyOpponent(unit, bash)) return [];
  const entries: Array<{ label: string; value: number }> = [];
  const confirmedShields = serverMatch.effects.filter(effect => effect.kind === 'defense' && effect.owner === unit.owner && effect.target === coordinate);
  const confirmedBlock = confirmedShields.reduce((sum, effect) => sum + effect.value, 0);
  const previewBlock = serverPreviewBlock(unit, coordinate);
  const block = confirmedBlock + previewBlock;
  if (block) entries.push({ label: 'Shield', value: block });
  const previewShieldSources = serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .map(({ owner, target }) => serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId))
    .filter((source): source is ServerUnitState => Boolean(source));
  const shieldedByAlly = confirmedShields.some(shield => (shield.sourceUnitId ?? `${shield.owner}:${shield.sourceTroopId}`) !== unit.id)
    || previewShieldSources.some(source => source.id !== unit.id);
  for (const source of serverMatch.units.filter(candidate => candidate.owner === unit.owner)) {
    for (const effect of catalogueById.get(source.troopId)?.continuousEffects ?? []) {
      if (effect.kind !== 'combat-modifier' || (effect.scope ?? 'self') === 'self' && source.id !== unit.id) continue;
      const defender = bash ? serverMatch.units.find(candidate => candidate.id === bash.defenderId) : undefined;
      const active = effect.condition === 'bash-attacker' ? bash?.attackerId === unit.id
        : effect.condition === 'bash-attacker-vs-hero' ? bash?.attackerId === unit.id && catalogueById.get(defender?.troopId ?? '')?.role === 'hero'
        : effect.condition === 'in-bash' ? Boolean(bash)
        : effect.condition === 'injured' ? unit.permanentDamage > 0
        : effect.condition === 'shielded' ? block > 0
        : effect.condition === 'shielded-by-ally' ? shieldedByAlly
        : false;
      if (!active) continue;
      const growth = source.id === unit.id && effect.condition === 'in-bash' ? unit.bashModifierBonus ?? 0 : 0;
      entries.push({ label: effect.label, value: effect.value + growth });
    }
  }
  if (bash && serverControllerWithPreview(coordinate, bash) === unit.owner) entries.push({ label: 'Control', value: 1 });
  return entries;
}

function serverModifier(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): number {
  if (!bash) {
    const previewBlock = serverPreviewBlock(unit, coordinate);
    if (!previewBlock || !serverMatch) return unit.combat.modifier + previewBlock;
    const confirmedShields = serverMatch.effects.filter(effect => effect.kind === 'defense' && effect.owner === unit.owner && effect.target === coordinate);
    const previewAllyShield = serverPreviewTargets()
      .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
      .some(({ owner, target }) => serverMatch?.units.some(source => source.owner === owner && source.troopId === target.troopId && source.id !== unit.id));
    const newlyShieldedPenalty = unit.troopId === 'marsh-badger' && confirmedShields.length === 0 ? -1 : 0;
    const alreadyShieldedByAlly = confirmedShields.some(shield => (shield.sourceUnitId ?? `${shield.owner}:${shield.sourceTroopId}`) !== unit.id);
    const newlySupportedBonus = unit.troopId === 'river-otter' && previewAllyShield && !alreadyShieldedByAlly ? 1 : 0;
    return unit.combat.modifier + previewBlock + newlyShieldedPenalty + newlySupportedBonus;
  }
  return serverModifierEntries(unit, coordinate, bash).reduce((total, entry) => total + entry.value, 0);
}

function appendServerBoardUnit(unit: ServerUnitState, transition?: 'move-out' | 'move-in' | 'push-in', transitionOrigin?: Coordinate): void {
  const target = cellsByCoordinate.get(unit.coordinate); const troop = serverTroop(unit.troopId, unit.owner, unit);
  if (!target || !troop) return;
  target.cell.classList.add('server-occupied');
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.setAttribute('aria-label', `${troopDisplayName(troop)}, Player ${unit.owner}`);
  const visual = document.createElementNS(ns, 'g');
  visual.dataset.serverRender = 'unit-visual';
  visual.dataset.clipId = target.cell.dataset.clipId;
  visual.classList.add('board-unit-visual');
  if (transition) visual.classList.add(`troop-${transition}-animation`);
  if (transition === 'push-in' && transitionOrigin) {
    const origin = cellsByCoordinate.get(transitionOrigin)?.position;
    if (origin) {
      visual.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
      visual.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
    }
  }
  const marker = boardCardMarker(troop, target.position, target.cell.dataset.clipId);
  marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
  if (serverMatch?.sandboxFreePlacement) {
    marker.classList.add('sandbox-draggable');
    enablePointerBoardDrag(marker, troop, { owner: unit.owner, troopId: unit.troopId, mode: 'free' });
  }
  keepServerOverlayUpright(marker, target.position);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  if (isServerLastActing(unit.owner, unit.troopId)) {
    marker.classList.add('last-acting-troop');
    target.cell.classList.add('server-last-acting');
  }
  if ((unit.owner === localMatchPlayer && unit.troopId === serverSelectedTroopId) || serverMatch?.selections?.[unit.owner] === unit.troopId || unit.id === serverInspectedUnitId) target.cell.classList.add('server-selected', unit.owner === 1 ? 'server-selected-one' : 'server-selected-two');
  // Every overlay uses the same shared horizontal board orientation.
  const highlightedAction = unit.owner === localMatchPlayer && unit.troopId === serverSelectedTroopId ? serverSelectedAction : undefined;
  const latestAction = serverMatch?.events?.at(-1);
  const newlyDeployed = latestAction?.action.type === 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId;
  const deploymentPreview = unit.id.startsWith('deployment-preview:') && unit.owner === localMatchPlayer;
  const confirmedForOpponent = newlyDeployed
    && unit.owner !== localMatchPlayer
    && serverMatch?.revision === confirmedDeploymentAnimationRevision;
  const deploymentAnimationKey = deploymentPreview
    ? `preview:${unit.owner}:${unit.troopId}:${unit.coordinate}`
    : confirmedForOpponent
      ? `confirmed:${serverMatch?.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`
      : undefined;
  if (deploymentAnimationKey && !playedDeploymentAnimations.has(deploymentAnimationKey)) {
    playedDeploymentAnimations.add(deploymentAnimationKey);
    visual.classList.add('deploy-fall-animation');
  }
  const persistedAction = latestAction && serverMatch?.activePlayer !== latestAction.player
    && latestAction.action.type !== 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId
    ? latestAction.action.type : undefined;
  const descriptionAction = highlightedAction ?? persistedAction;
  const ignitionDamage = latestAction?.action.type === 'magic'
    && latestAction.player === unit.owner
    && latestAction.action.troopId === unit.troopId
    ? serverMatch?.effects.filter(effect => effect.kind === 'bomb' && effect.owner === unit.owner).reduce((damage, effect) => Math.max(damage, effect.value), 0)
    : undefined;
  const showSelfBlock = descriptionAction === 'self-defense';
  const pendingSelfBlock = descriptionAction === 'self-defense' && serverPendingAction?.type === 'self-defense';
  // The unit remains one rigid animated object, but the transparent ornamental
  // PNG is painted after it so the hand-drawn hex edge stays above the card.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  visual.append(marker);
  appendBoardInfoFrame(visual, troop, target.position);
  appendServerActionDescriptionHighlight(visual, troop, target.position, descriptionAction, newlyDeployed, showSelfBlock, pendingSelfBlock, ignitionDamage);
  const description = document.createElementNS(ns, 'text');
  description.dataset.serverRender = 'description';
  description.classList.add('board-troop-description');
  writeServerBoardDescription(description, troop, target.position, showSelfBlock, descriptionAction === 'move', ignitionDamage);
  keepServerOverlayUpright(description, target.position);
  visual.append(description);
  target.cell.append(visual);
  if (hexArtwork) target.cell.append(hexArtwork);
}

function appendServerBash(bash: ServerBashState, showSplitBorder = true): void {
  if (!serverMatch) return;
  const target = cellsByCoordinate.get(bash.target); const attacker = serverMatch.units.find(unit => unit.id === bash.attackerId); const defender = serverMatch.units.find(unit => unit.id === bash.defenderId);
  if (!target || !attacker || !defender) return;
  const attackerTroop = serverTroop(attacker.troopId, attacker.owner, attacker);
  const defenderTroop = serverTroop(defender.troopId, defender.owner, defender);
  // Board sides are player-owned, independent of who initiated the bash:
  // Red (Player 1) is always left and Blue (Player 2) is always right.
  const sideUnits: [ServerUnitState, ServerUnitState] = attacker.owner === 1
    ? [attacker, defender]
    : [defender, attacker];
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.classList.add('server-bash-target');
  enableBashSideHover(target.cell);
  target.cell.setAttribute('aria-label', `${attackerTroop ? troopDisplayName(attackerTroop) : attacker.troopId} versus ${defenderTroop ? troopDisplayName(defenderTroop) : defender.troopId}`);
  if (showSplitBorder) {
    // The normal region-edge overlay is appended last.  Hide it on a bash so
    // it cannot paint a full control-colour outline over the two half-borders.
    const vertex = (index: number): Point => {
      const angle = 60 * index * Math.PI / 180;
      return { x: target.position.x + (size - hexGap) * horizontalScale * Math.cos(angle), y: target.position.y + (size - hexGap) * Math.sin(angle) };
    };
    const middle = (left: number, right: number): Point => {
      const a = vertex(left); const b = vertex(right);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const point = (value: Point): string => `${value.x},${value.y}`;
    // The top and bottom outlines each include half of the two side edges.
    // That makes the colour boundary a real horizontal half-hex rather than
    // leaving the middle edges to the underlying normal border.
    const topPath = `M ${point(middle(3, 4))} L ${point(vertex(4))} L ${point(vertex(5))} L ${point(vertex(0))} L ${point(middle(0, 1))}`;
    const bottomPath = `M ${point(middle(0, 1))} L ${point(vertex(1))} L ${point(vertex(2))} L ${point(vertex(3))} L ${point(middle(3, 4))}`;
    const control = serverRegionController(serverMatch, bash.target, bash);
    const isHomeOrMiddle = ['player-one-middle', 'player-one-side', 'player-two-middle', 'player-two-side'].some(name => target.cell.classList.contains(name));
    const controlStroke = control === 1 ? (isHomeOrMiddle ? '#fb7185' : '#ef4444') : control === 2 ? (isHomeOrMiddle ? '#60a5fa' : '#3b82f6') : '#e5e7eb';
    // A bash holds two troops in one hex.  Its two half-borders describe
    // their own availability: the troop that moved (and any defender that
    // already acted) is grey; an available defender retains the region colour.
    for (const [pathData, , stroke] of [
      [topPath, attacker, isServerLastActing(attacker.owner, attacker.troopId) ? '#94a3b8' : controlStroke],
      [bottomPath, defender, isServerLastActing(defender.owner, defender.troopId) ? '#94a3b8' : controlStroke]
    ] as const) {
      const border = document.createElementNS(ns, 'path');
      border.dataset.serverRender = 'bash'; border.classList.add('bash-border');
      border.style.stroke = stroke;
      border.setAttribute('d', pathData);
      keepServerOverlayUpright(border, target.position);
      target.cell.append(border);
    }
  }
  for (const [index, unit] of sideUnits.entries()) {
    const side = index === 0 ? 'left' : 'right';
    const troop = serverTroop(unit.troopId, unit.owner, unit);
    if (troop) {
      const picture = boardCardMarker(troop, target.position);
      picture.dataset.serverRender = 'bash-picture';
      picture.classList.add('board-troop', 'bash-troop-picture', side === 'left' ? 'bash-left-picture' : 'bash-right-picture');
      if (isServerLastActing(unit.owner, unit.troopId)) picture.classList.add('last-acting-troop');
      keepServerOverlayUpright(picture, target.position);
      target.cell.append(picture);
    }
  }
  // Preserve the hand-drawn edge above both full-size, half-clipped pictures.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  if (hexArtwork) target.cell.append(hexArtwork);

  for (const [index, unit] of sideUnits.entries()) {
    const statX = target.position.x + (index === 0 ? -18 : 18);
    const ownerClass = unit.owner === 1 ? 'player-one-bash' : 'player-two-bash';
    const side = index === 0 ? 'left' : 'right';
    const ui = document.createElementNS(ns, 'g');
    ui.dataset.serverRender = 'bash-ui';
    ui.classList.add('bash-side-ui', `bash-${side}-ui`);
    keepServerOverlayUpright(ui, target.position);
    const health = document.createElementNS(ns, 'text');
    health.dataset.serverRender = 'bash'; health.classList.add('bash-stat', 'bash-health', ownerClass);
    health.setAttribute('x', String(statX)); health.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0)));
    health.textContent = `♥ ${unit.currentHealth}`;
    ui.append(health);
    const modifierValue = serverModifier(unit, bash.target, bash);
    const modifier = document.createElementNS(ns, 'text');
    modifier.dataset.serverRender = 'bash'; modifier.classList.add('bash-stat', 'bash-modifier', ownerClass);
    modifier.setAttribute('x', String(statX)); modifier.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0) + boardDescriptionLineHeight));
    modifier.textContent = `${modifierValue >= 0 ? '+' : ''}${modifierValue}`;
    ui.append(modifier);
    const troop = serverTroop(unit.troopId, unit.owner, unit);
    if (troop) {
      const description = document.createElementNS(ns, 'text');
      description.dataset.serverRender = 'bash-description';
      description.classList.add('board-troop-description', 'bash-side-description', `bash-${side}-description`);
      writeServerBoardDescription(description, troop, target.position);
      description.querySelector('.board-health')?.remove();
      keepServerOverlayUpright(description, target.position);
      target.cell.append(description);
    }
    target.cell.append(ui);
  }
}

function enableBashSideHover(cell: SVGGElement): void {
  if (cell.dataset.bashHoverBound) return;
  cell.dataset.bashHoverBound = 'true';
  const clearTimer = (): void => {
    const timer = bashHoverTimers.get(cell);
    if (timer !== undefined) window.clearTimeout(timer);
    bashHoverTimers.delete(cell);
    delete cell.dataset.bashPendingSide;
  };
  cell.addEventListener('pointermove', event => {
    if (!cell.classList.contains('server-bash-target')) return;
    const bounds = cell.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
    const wantedClass = `bash-focus-${side}`;
    if (cell.classList.contains(wantedClass) || cell.dataset.bashPendingSide === side) return;
    const changingSide = cell.classList.contains(side === 'left' ? 'bash-focus-right' : 'bash-focus-left');
    clearTimer();
    cell.classList.remove('bash-focus-left', 'bash-focus-right');
    if (!changingSide) {
      cell.classList.add(wantedClass);
      return;
    }
    cell.dataset.bashPendingSide = side;
    const timer = window.setTimeout(() => {
      if (cell.matches(':hover') && cell.classList.contains('server-bash-target')) cell.classList.add(wantedClass);
      bashHoverTimers.delete(cell);
      delete cell.dataset.bashPendingSide;
    }, 340);
    bashHoverTimers.set(cell, timer);
  });
  cell.addEventListener('pointerleave', () => {
    clearTimer();
    cell.classList.remove('bash-focus-left', 'bash-focus-right');
  });
}

interface ServerDamagePreview {
  attacker?: ServerUnitState;
  owner: Player;
  target: ServerUnitState;
  coordinate: Coordinate;
  targetModifier: number;
  damage: number;
  icon: string;
  magic: boolean;
  /** The bash is replaced by this projected post-combat target. */
  replacesBash?: boolean;
}

type DamageType = 'attack' | 'magic' | 'cannon' | 'bomb';

/** Shared rules calculator for every damage preview. New damage mechanics only
 * need to map their type here instead of duplicating UI-specific arithmetic. */
function calculatePreviewDamage(type: DamageType, rawDamage: number, currentHealth: number, physicalModifier: number): Pick<ServerDamagePreview, 'targetModifier' | 'damage' | 'magic'> {
  if (type === 'magic') return { targetModifier: 0, damage: rawDamage >= currentHealth ? rawDamage : 0, magic: true };
  if (type === 'cannon' || type === 'bomb') return { targetModifier: 0, damage: rawDamage, magic: false };
  return { targetModifier: physicalModifier, damage: Math.max(0, rawDamage - physicalModifier), magic: false };
}

function serverBashIsDodged(bash: ServerBashState, match = serverMatch): boolean {
  if (!match) return false;
  const defender = match.units.find(unit => unit.id === bash.defenderId);
  const response = defender ? match.targetSelections?.[defender.owner] : undefined;
  const selectedMoveAway = Boolean(response
    && defender
    && response.troopId === defender.troopId
    && (response.type === 'move' || response.type === 'fly')
    && response.coordinate !== bash.target);
  const localMoveAway = Boolean(serverPendingAction
    && localMatchPlayer === defender?.owner
    && defender
    && serverPendingAction.troopId === defender.troopId
    && (serverPendingAction.type === 'move' || serverPendingAction.type === 'fly')
    && serverPendingAction.coordinate !== bash.target);
  return selectedMoveAway || localMoveAway;
}

/** Project the single troop left on a bash hex before a defender's delayed attack resolves. */
function serverPostBashSurvivor(bash: ServerBashState, match: ServerMatchState): ServerUnitState | undefined {
  const attacker = match.units.find(unit => unit.id === bash.attackerId);
  const defender = match.units.find(unit => unit.id === bash.defenderId);
  if (!attacker || !defender || serverBashIsDodged(bash, match)) return undefined;
  const attackerModifier = serverModifier(attacker, bash.target, bash);
  const defenderModifier = serverModifier(defender, bash.target, bash);
  const attackerPower = attacker.currentHealth + attackerModifier;
  const defenderPower = defender.currentHealth + defenderModifier;
  if (attackerPower === defenderPower) return undefined;
  const winner = attackerPower > defenderPower ? attacker : defender;
  const winnerModifier = winner === attacker ? attackerModifier : defenderModifier;
  const loserPower = winner === attacker ? defenderPower : attackerPower;
  const permanentDamage = winner.permanentDamage + Math.max(0, loserPower - winnerModifier);
  const units: UnitState[] = match.units
    .filter(unit => unit.id !== (winner === attacker ? defender.id : attacker.id))
    .map(unit => ({
      id: unit.id as UnitId,
      troopId: unit.troopId,
      owner: unit.owner,
      coordinate: unit.id === attacker.id ? bash.target : unit.coordinate,
      permanentDamage: unit.id === winner.id ? permanentDamage : unit.permanentDamage,
      rangedDamageBonus: unit.rangedDamageBonus,
      rangedRangeBonus: unit.rangedRangeBonus,
      upgrades: unit.upgrades?.map(upgrade => ({ ...upgrade, sourceUnitId: unit.id as UnitId })) as UnitState['upgrades']
    }));
  const projected: GameState = {
    activePlayer: match.activePlayer,
    winner: match.winner,
    units,
    effects: match.effects.map(effect => ({ ...effect, sourceUnitId: effect.sourceUnitId as UnitId | undefined, targetUnitId: effect.targetUnitId as UnitId | undefined })),
    bashes: match.bashes.filter(item => item !== bash),
    lastActingTroopId: match.lastActingTroopId
  };
  const projectedWinner = projected.units.find(unit => unit.id === winner.id);
  if (!projectedWinner) return undefined;
  const combat = combatSummary(projected, projectedWinner.id ?? `${projectedWinner.owner}:${projectedWinner.troopId}`, catalogueById);
  return { ...winner, coordinate: projectedWinner.coordinate, permanentDamage: projectedWinner.permanentDamage, currentHealth: combat.health, combat };
}

/** An action into a bash hex targets its opponent only if that opponent survives the bash. */
function serverOffensivePreviewTarget(match: ServerMatchState, attacker: ServerUnitState, coordinate: Coordinate): { target?: ServerUnitState; replacesBash: boolean } {
  const bash = match.bashes.find(item => item.target === coordinate);
  if (!bash) return { target: match.units.find(unit => unit.coordinate === coordinate), replacesBash: false };
  const opponentId = [bash.attackerId, bash.defenderId]
    .find(id => match.units.find(unit => unit.id === id)?.owner !== attacker.owner);
  const survivor = serverPostBashSurvivor(bash, match);
  return { target: survivor?.id === opponentId ? survivor : undefined, replacesBash: survivor?.id === opponentId };
}

function createServerDamagePreview(
  attacker: ServerUnitState | undefined,
  owner: Player,
  target: ServerUnitState,
  coordinate: Coordinate,
  type: DamageType,
  rawDamage: number,
  match: ServerMatchState,
  replacesBash = false
): ServerDamagePreview {
  const bash = replacesBash ? undefined : match.bashes.find(item => item.target === coordinate
    && (item.attackerId === target.id || item.defenderId === target.id));
  const calculated = calculatePreviewDamage(type, rawDamage, target.currentHealth, serverModifier(target, coordinate, bash));
  // The marker communicates the resulting injury, independent of whether it
  // came from a ranged attack, cannon, or spell.
  const icon = '🩸';
  return { attacker, owner, target, coordinate, ...calculated, icon, replacesBash };
}

/** Calculate every damage marker for a local action or confirmed effects. */
function serverPendingDamagePreviews(): ServerDamagePreview[] {
  const match = serverMatch;
  const pending = serverPendingAction;
  const local = localMatchPlayer;
  if (!match) return [];
  const previews: ServerDamagePreview[] = [];
  if (pending && pending.coordinate && local
    && (pending.type === 'attack' || pending.type === 'magic' || pending.type === 'cannon')) {
    const attacker = match.units.find(unit => unit.owner === local && unit.troopId === pending.troopId);
    const targetPreview = attacker ? serverOffensivePreviewTarget(match, attacker, pending.coordinate) : undefined;
    const target = targetPreview?.target;
    const troop = attacker ? serverTroop(attacker.troopId, attacker.owner, attacker) : undefined;
    const action = troop ? actionOfType(troop, pending.type) : undefined;
    if (attacker && target && troop && action && (action.type === 'attack' || action.type === 'magic' || action.type === 'cannon')) {
      const rawDamage = action.type === 'attack'
        ? rangedDamage(troop, action) + upgradeBonus(troop, 'attack').left
        : action.damage + upgradeBonus(troop, action.type).left;
      previews.push(createServerDamagePreview(attacker, local, target, pending.coordinate, action.type, rawDamage, match, targetPreview.replacesBash));
    }
  }

  const projectedUnits = serverPendingUnitPreviews();
  const projectedById = new Map(projectedUnits.map(unit => [unit.id, unit]));
  const unitsAtResolution = match.units.map(unit => projectedById.get(unit.id) ?? unit);
  for (const effect of match.effects) {
    if (effect.kind !== 'attack' && effect.kind !== 'magic' && effect.kind !== 'cannon' && effect.kind !== 'bomb') continue;
    const attacker = effect.sourceUnitId
      ? match.units.find(unit => unit.id === effect.sourceUnitId)
      : match.units.find(unit => unit.owner === effect.owner && unit.troopId === effect.sourceTroopId);
    const targets = effect.kind === 'bomb'
      ? unitsAtResolution.filter(unit => unit.coordinate === effect.target)
      : effect.targetUnitId
        ? [unitsAtResolution.find(unit => unit.id === effect.targetUnitId && unit.coordinate === effect.target)].filter((unit): unit is ServerUnitState => Boolean(unit))
        : [unitsAtResolution.find(unit => unit.coordinate === effect.target)].filter((unit): unit is ServerUnitState => Boolean(unit));
    for (const target of targets) previews.push(createServerDamagePreview(attacker, effect.owner, target, effect.target, effect.kind, effect.value, match));
  }
  return previews;
}

/** Show target effectiveness above and effective damage below the target hex. */
function appendServerDamagePreview(): void {
  for (const preview of serverPendingDamagePreviews()) {
  if (serverHoverPreviewCoordinate === preview.coordinate) continue;
  const target = cellsByCoordinate.get(preview.coordinate);
  if (!target) continue;
  const top = document.createElementNS(ns, 'text');
  top.dataset.serverRender = 'damage-preview';
  top.classList.add('bash-stat', preview.target.owner === 1 ? 'player-one-bash' : 'player-two-bash');
  top.setAttribute('x', String(target.position.x));
  top.setAttribute('y', String(target.position.y - 18));
  top.textContent = `${preview.target.currentHealth} + ${preview.targetModifier}`;
  keepServerOverlayUpright(top, target.position);

  const bottom = document.createElementNS(ns, 'text');
  bottom.dataset.serverRender = 'damage-preview';
  bottom.classList.add('bash-stat', preview.owner === 1 ? 'player-one-bash' : 'player-two-bash');
  bottom.setAttribute('x', String(target.position.x));
  bottom.setAttribute('y', String(target.position.y + 24));
  bottom.textContent = `${preview.damage} ${preview.icon}`;
  keepServerOverlayUpright(bottom, target.position);
  target.cell.append(top, bottom);
  }
}

interface ServerMovementPreview {
  unit: ServerUnitState;
  coordinate: Coordinate;
}

function serverPendingActionForPreview(): ServerLegalAction | undefined {
  const match = serverMatch;
  if (!match) return undefined;
  if (serverPendingAction) return serverPendingAction;
  const remote = match.targetSelections?.[match.activePlayer];
  return remote ? { troopId: remote.troopId, type: remote.type, coordinate: remote.coordinate } : undefined;
}

/** Project a movement, flight, or empty landing push onto the board. */
function serverPendingMovementPreview(): ServerMovementPreview | undefined {
  const match = serverMatch;
  if (!match) return undefined;
  const pending = serverPendingActionForPreview();
  if (!pending || !pending.coordinate || (pending.type !== 'move' && pending.type !== 'fly' && pending.type !== 'push')) return undefined;
  let unit: ServerUnitState | undefined;
  let coordinate: Coordinate = pending.coordinate;
  if (pending.type === 'push') {
    if (!serverPendingAction?.destination) return undefined;
    unit = match.units.find(candidate => candidate.coordinate === pending.coordinate);
    coordinate = serverPendingAction.destination;
  } else {
    const owner = serverPendingAction ? localMatchPlayer : match.activePlayer;
    if (!owner) return undefined;
    unit = match.units.find(candidate => candidate.owner === owner && candidate.troopId === pending.troopId);
  }
  if (!unit || match.units.some(candidate => candidate.coordinate === coordinate && candidate.id !== unit?.id)) return undefined;
  return { unit, coordinate };
}

/** Project the unit-facing result of a pending mending or upgrade action. */
function serverPendingUnitPreviews(): ServerUnitState[] {
  const match = serverMatch;
  const pending = serverPendingActionForPreview();
  if (!match || !pending || !pending.coordinate) return [];
  const owner = serverPendingAction ? localMatchPlayer : match.activePlayer;
  if (!owner) return [];
  if (pending.type === 'deploy') {
    const troop = serverTroop(pending.troopId, owner);
    if (!troop || match.units.some(unit => unit.coordinate === pending.coordinate)) return [];
    const health = healthOf(troop);
    return [{
      id: `deployment-preview:${owner}:${pending.troopId}`,
      troopId: pending.troopId,
      owner,
      coordinate: pending.coordinate,
      permanentDamage: 0,
      currentHealth: health,
      combat: { health, modifier: 0, modifiers: [], total: health },
    }];
  }
  const source = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
  if (!source) return [];
  if (pending.type === 'move' || pending.type === 'fly' || pending.type === 'push') {
    const movement = serverPendingMovementPreview();
    return movement ? [{ ...movement.unit, coordinate: movement.coordinate }] : [];
  }
  const target = match.units.find(unit => unit.owner === owner && unit.coordinate === pending.coordinate);
  if (!target) return [];
  const sourceTroop = serverTroop(source.troopId, owner, source);
  if (!sourceTroop) return [];
  if (pending.type === 'mending') {
    const mending = actionOfType(sourceTroop, 'mending');
    if (!mending) return [];
    const amount = mending.amount + upgradeBonus(sourceTroop, 'mending').left;
    const targetTroop = serverTroop(target.troopId, target.owner, target);
    if (!targetTroop) return [];
    const health = Math.min(healthOf(targetTroop) + amount, targetTroop.baseHealth);
    return [{ ...target, permanentDamage: target.permanentDamage - (health - healthOf(targetTroop)), currentHealth: health, combat: { ...target.combat, health, total: health + target.combat.modifier } }];
  }
  if (pending.type === 'upgrade' && pending.ability) {
    const upgrade = actionOfType(sourceTroop, 'upgrade');
    if (!upgrade) return [];
    return [{ ...target, upgrades: [...(target.upgrades ?? []), { ability: pending.ability, left: upgrade.left, right: upgrade.right }] }];
  }
  return [];
}

/** The prospective bash created by an unconfirmed move, flight, or push. */
function serverPendingBash(): ServerBashState | undefined {
  const match = serverMatch;
  const pending = serverPendingActionForPreview();
  if (!match || !pending) return undefined;
  const owner = serverPendingAction ? localMatchPlayer : match.activePlayer;
  if (!owner) return undefined;
  if ((pending.type === 'move' || pending.type === 'fly') && pending.coordinate) {
    const attacker = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
    const defender = match.units.find(unit => unit.coordinate === pending.coordinate && unit.owner !== owner);
    return attacker && defender ? { attackerId: attacker.id, defenderId: defender.id, target: pending.coordinate } : undefined;
  }
  if (pending.type === 'push' && pending.coordinate && pending.destination) {
    const attacker = match.units.find(unit => unit.coordinate === pending.coordinate);
    const defender = match.units.find(unit => unit.coordinate === pending.destination);
    return attacker && defender && attacker.owner !== defender.owner
      ? { attackerId: attacker.id, defenderId: defender.id, target: pending.destination }
      : undefined;
  }
  return undefined;
}

/** Show the same combat structure for a selected, not-yet-confirmed bash. */
function appendServerPreviewBash(): void {
  const bash = serverPendingBash();
  if (bash && serverHoverPreviewCoordinate !== bash.target) appendServerBash(bash, false);
}

function serverPreviewAt(coordinate: Coordinate): boolean {
  if (serverPendingDamagePreviews().some(preview => preview.coordinate === coordinate)) return true;
  if (serverPendingBash()?.target === coordinate) return true;
  return Boolean(serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, serverMatch)));
}

function setServerHoverPreview(coordinate: Coordinate, hovering: boolean, bashReveal: 'defender' | 'attacker' = 'defender'): void {
  const animatedBash = serverPendingBash()?.target === coordinate
    || Boolean(serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, serverMatch)));
  // Bash inspection is now an in-place, reversible left/right animation.
  // The legacy hover preview rebuilt the board on pointer entry, destroying
  // the animated nodes before their transitions could begin.
  if (animatedBash) {
    if (!hovering && serverHoverPreviewCoordinate === coordinate) {
      serverHoverPreviewCoordinate = undefined;
      if (serverMatch) renderServerMatchState(serverMatch);
    }
    return;
  }
  if (serverPendingAction?.type === 'bomb' && serverPendingAction.coordinate === coordinate) return;
  const next = hovering && serverPreviewAt(coordinate) ? coordinate : undefined;
  if (serverHoverPreviewCoordinate === next && (!next || serverBashReveal === bashReveal)) return;
  serverHoverPreviewCoordinate = next;
  serverBashReveal = bashReveal;
  if (serverMatch) renderServerMatchState(serverMatch);
}

/** Draw the region edge last, so unit sprites appear cut off behind it. */
function appendServerHexBorderOverlays(): void {
  for (const { cell, position } of cellsByCoordinate.values()) {
    const overlay = document.createElementNS(ns, 'polygon');
    overlay.dataset.serverRender = 'border-overlay';
    overlay.classList.add('hex', 'hex-border-overlay');
    overlay.setAttribute('points', hexPoints(position.x, position.y));
    cell.append(overlay);
  }
}

/** Unlit bombs coexist with units beside the same vertex used by the preview. */
function appendServerBombs(match: ServerMatchState): void {
  for (const bomb of match.bombs ?? []) {
    const target = cellsByCoordinate.get(bomb.coordinate); if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    // Match the exact endpoint of appendServerBombActionPreview.
    const horizontalOffset = (size - hexGap) * horizontalScale * .68;
    const centre = { x: target.position.x + horizontalOffset, y: target.position.y };
    marker.setAttribute('href', './assets/bomb-unlight.png');
    marker.setAttribute('x', String(centre.x - 16.5)); marker.setAttribute('y', String(centre.y - 16.5));
    marker.setAttribute('width', '33'); marker.setAttribute('height', '33');
    target.cell.append(marker);
  }
}

function renderServerMatchState(match: ServerMatchState): void {
  if (!serverMatch || serverMatch.id !== match.id) serverHoverPreviewCoordinate = undefined;
  // A new revision is an authoritative action (or sandbox placement), not a
  // local selection echo. Clear the previous side's card/action before control
  // passes; both fixed trays share card IDs across their separate owners.
  const stateAdvanced = serverMatch?.id === match.id && serverMatch.revision !== match.revision;
  confirmedDeploymentAnimationRevision = stateAdvanced ? match.revision : undefined;
  if (stateAdvanced) {
    serverSelectedTroopId = undefined;
    serverSelectedAction = undefined;
    serverPendingAction = undefined;
    serverPushTargetChoices = [];
    serverInspectedUnitId = undefined;
    clearServerPreviewPath();
  }
  serverMatch = match;
  const local = applyLocalPlayerView(match); if (!local) return;
  if (serverSelectionRequestPending && match.selections?.[local] === serverRequestedTroopId) {
    serverSelectedTroopId = serverRequestedTroopId;
    serverSelectedAction = undefined;
    serverPendingAction = undefined;
    serverSelectionRequestPending = false;
  }
  const awaitingLocalAction = match.status === 'active' && !match.winner
    && (match.pendingResolution?.owner ?? match.activePlayer) === local;
  boardAreaPanel.classList.toggle('awaiting-local-action', awaitingLocalAction);
  if (match.pendingResolution?.owner === local) {
    const pending = match.pendingResolution;
    const source = 'sourceUnitId' in pending ? match.units.find(unit => unit.id === pending.sourceUnitId) : undefined;
    serverSelectedTroopId = match.pendingResolution.sourceTroopId;
    if (source) serverInspectedUnitId = source.id;
  }
  gameLayoutPanel.classList.remove('deck-building');
  if (match.winner || (match.pendingResolution?.owner ?? match.activePlayer) !== local) { serverSelectedTroopId = undefined; serverSelectedAction = undefined; serverPendingAction = undefined; clearServerPreviewPath(); }
  const selectedActions = match.selections?.[local] === serverSelectedTroopId ? match.legalActions?.[local] ?? [] : [];
  const actionTypes = new Set(selectedActions.map(action => action.type));
  if (serverSelectedTroopId && selectedActions.length > 0 && (!serverSelectedAction || !actionTypes.has(serverSelectedAction))) {
    serverSelectedAction = (['deploy', 'resolve-move', 'move', 'fly'] as const).find(type => actionTypes.has(type)) ?? selectedActions[0]?.type;
  }
  renderServerTray(2, playerTwoCardsPanel, local === 2);
  renderServerTray(1, playerOneCardsPanel, local === 1);
  clearServerBoardRender();
  for (const [coordinate, { cell }] of cellsByCoordinate) {
    const previewBash = serverPendingBash();
    const controller = serverRegionController(match, coordinate, previewBash);
    cell.classList.add(controller === 1 ? 'server-controlled-one' : controller === 2 ? 'server-controlled-two' : 'server-contested');
    const regionId = regionAt(coordinate)?.id;
    const artwork = cell.querySelector<SVGImageElement>('.board-hex-artwork');
    const filename = controlledBoardHexArtwork(regionId, controller);
    if (artwork && filename) artwork.setAttribute('href', `./assets/${filename}`);
  }
  const damagePreviews = serverPendingDamagePreviews();
  const replacedBashes = match.bashes.filter(bash => damagePreviews.some(preview => preview.replacesBash && bash.target === preview.coordinate));
  const visibleBashes = match.bashes.filter(bash => !serverBashIsDodged(bash, match)
    && bash.target !== serverHoverPreviewCoordinate
    && !replacedBashes.includes(bash));
  const bashingIds = new Set(visibleBashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const revealedBash = match.bashes.find(bash => bash.target === serverHoverPreviewCoordinate && !serverBashIsDodged(bash, match));
  const revealedBashingIds = new Set(revealedBash ? [revealedBash.attackerId, revealedBash.defenderId] : []);
  const revealedUnitId = revealedBash ? (serverBashReveal === 'attacker' ? revealedBash.attackerId : revealedBash.defenderId) : undefined;
  const replacedBashIds = new Set(replacedBashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const pendingBash = serverPendingBash();
  const previewDefenderId = pendingBash?.defenderId;
  const revealPendingBash = pendingBash?.target === serverHoverPreviewCoordinate;
  const unitPreviews = serverPendingUnitPreviews();
  const movementPreview = serverPendingMovementPreview();
  const movementPreviewType = serverPendingActionForPreview()?.type;
  const previewUnitIds = new Set(unitPreviews.map(unit => unit.id));
  const previewDamageTargetIds = new Set(damagePreviews.map(preview => preview.target.id));
  const revealDamageTargetIds = new Set(damagePreviews.filter(preview => preview.coordinate === serverHoverPreviewCoordinate).map(preview => preview.target.id));
  for (const unit of match.units) if (!bashingIds.has(unit.id)
    && (!revealedBashingIds.has(unit.id) || unit.id === revealedUnitId)
    && !replacedBashIds.has(unit.id)
    && (unit.id !== previewDefenderId || revealPendingBash)
    && !previewUnitIds.has(unit.id)
    && (!previewDamageTargetIds.has(unit.id) || revealDamageTargetIds.has(unit.id))) appendServerBoardUnit(unit);
  // A pending move has two simultaneous visual halves: retain a temporary
  // source copy that dissolves downward, while its projected destination copy
  // materializes upward into the new hex.
  if (movementPreview && movementPreviewType !== 'push') appendServerBoardUnit(movementPreview.unit, 'move-out');
  for (const unit of unitPreviews) if (!previewDamageTargetIds.has(unit.id) || revealDamageTargetIds.has(unit.id)) {
    const isMovementDestination = movementPreview?.unit.id === unit.id && movementPreview.coordinate === unit.coordinate;
    const transition = isMovementDestination ? (movementPreviewType === 'push' ? 'push-in' : 'move-in') : undefined;
    appendServerBoardUnit(unit, transition, movementPreview?.unit.coordinate);
  }
  for (const preview of damagePreviews) if (preview.replacesBash && revealDamageTargetIds.has(preview.target.id)) appendServerBoardUnit(preview.target);
  for (const effect of match.effects) {
    if (effect.kind === 'attack' || effect.kind === 'cannon' || effect.kind === 'bomb' || effect.kind === 'magic') {
      // The acting player's fill communicates pending damage without adding a
      // second, side-positioned damage label to the hex.
      cellsByCoordinate.get(effect.target)?.cell.classList.add('server-action-highlight', effect.owner === 1 ? 'server-action-highlight-one' : 'server-action-highlight-two');
    }
  }
  for (const bash of visibleBashes) appendServerBash(bash);
  // A pending bash is independent of bashes already waiting elsewhere on the
  // board. Draw all confirmed bashes and the prospective one together.
  appendServerPreviewBash();
  appendServerDamagePreview();
  appendServerBombs(match);
  for (const [owner, target] of Object.entries(match.targetSelections ?? {})) {
    if (!target?.coordinate) continue;
    const selectionOwner = Number(owner) as Player;
    const highlightClass = selectionOwner === local ? 'server-pending-target' : 'server-remote-pending-target';
    const ownerClass = selectionOwner === 1 ? 'server-pending-target-one' : 'server-pending-target-two';
    const localPushPreview = Number(owner) === local && target.type === 'push' && serverPendingAction?.type === 'push' && serverPendingAction.destination;
    if (!localPushPreview) cellsByCoordinate.get(target.coordinate)?.cell.classList.add(highlightClass, ownerClass, 'server-reachable');
    if (target.type === 'cannon') {
      const source = match.units.find(unit => unit.owner === Number(owner) && unit.troopId === target.troopId);
      if (source) for (const coordinate of straightLine(source.coordinate, target.coordinate, hexDistance(source.coordinate, target.coordinate)) ?? []) {
        cellsByCoordinate.get(coordinate)?.cell.classList.add(highlightClass, ownerClass, 'server-reachable');
      }
    }
  }
  renderServerActionBar(match, local);
  renderServerActionTargets();
  appendServerHexBorderOverlays();
  raiseActionTargetCells();
  appendServerBombActionPreview();
  confirmedDeploymentAnimationRevision = undefined;
}

function appendServerBombActionPreview(): void {
  if (!serverMatch || serverSelectedAction !== 'bomb') return;
  const source = selectedServerUnit();
  if (!source) return;
  const sourceCell = cellsByCoordinate.get(source.coordinate);
  if (!sourceCell) return;
  const horizontalOffset = (size - hexGap) * horizontalScale * .68;
  const start: Point = { x: sourceCell.position.x - horizontalOffset, y: sourceCell.position.y };
  const targetCoordinate = serverPendingAction?.type === 'bomb' ? serverPendingAction.coordinate : undefined;
  const pendingTarget = targetCoordinate
    ? cellsByCoordinate.get(targetCoordinate)
    : undefined;
  if (!pendingTarget || !targetCoordinate) {
    const unlit = document.createElementNS(ns, 'image');
    unlit.dataset.serverRender = 'bomb-action-preview';
    unlit.classList.add('bomb-action-icon', 'bomb-unlit-preview');
    unlit.setAttribute('href', './assets/bomb-unlight.png');
    unlit.setAttribute('x', String(start.x - 18)); unlit.setAttribute('y', String(start.y - 18));
    unlit.setAttribute('width', '36'); unlit.setAttribute('height', '36');
    boardPanel.append(unlit);
    return;
  }

  const end: Point = { x: pendingTarget.position.x + horizontalOffset, y: pendingTarget.position.y };
  const control: Point = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 - Math.max(42, hexDistance(source.coordinate, targetCoordinate) * 20),
  };
  const pathData = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  const trajectory = document.createElementNS(ns, 'path');
  trajectory.dataset.serverRender = 'bomb-action-preview';
  trajectory.classList.add('bomb-pencil-trajectory');
  trajectory.setAttribute('d', pathData); trajectory.setAttribute('pathLength', '1');
  boardPanel.append(trajectory);

  const moving = document.createElementNS(ns, 'g');
  moving.dataset.serverRender = 'bomb-action-preview'; moving.classList.add('bomb-flight');
  const bomb = document.createElementNS(ns, 'image');
  bomb.classList.add('bomb-action-icon'); bomb.setAttribute('href', './assets/bomb-unlight.png');
  bomb.setAttribute('x', '-19.5'); bomb.setAttribute('y', '-19.5'); bomb.setAttribute('width', '39'); bomb.setAttribute('height', '39');
  moving.setAttribute('transform', `translate(${end.x} ${end.y})`);
  moving.append(bomb); boardPanel.append(moving);
  // Sample the same quadratic curve into Web Animation keyframes. This is
  // more reliable in Firefox than dynamically inserted SVG animateMotion and
  // preserves the image's upright orientation throughout the flight.
  const flightFrames: Keyframe[] = Array.from({ length: 25 }, (_, index) => {
    const t = index / 24; const inverse = 1 - t;
    const x = inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x;
    const y = inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y;
    return { translate: `${x - end.x}px ${y - end.y}px`, offset: t };
  });
  moving.animate(flightFrames, { duration: 900, easing: 'linear', fill: 'both' });
}

function selectedServerUnit(): ServerUnitState | undefined {
  return serverMatch?.units.find(unit => unit.owner === localMatchPlayer && unit.troopId === serverSelectedTroopId);
}

function selectedServerLegalActions(): ServerLegalAction[] {
  if (!serverMatch || !localMatchPlayer || serverMatch.selections?.[localMatchPlayer] !== serverSelectedTroopId) return [];
  return serverMatch.legalActions?.[localMatchPlayer] ?? [];
}

function clearServerSelection(): void {
  if (!serverMatch) return;
  serverSelectedTroopId = undefined;
  serverSelectedAction = undefined;
  serverPendingAction = undefined;
  serverPushTargetChoices = [];
  serverInspectedUnitId = undefined;
  clearServerPreviewPath();
  sendServerSelection(undefined);
  renderServerMatchState(serverMatch);
}

function sendServerSelection(troopId: string | undefined, target?: { type: GameActionType; coordinate: Coordinate }): void {
  if (!serverMatch || !matchSocket || matchSocket.readyState !== WebSocket.OPEN) return;
  matchSocket.send(JSON.stringify({ type: 'select', matchId: serverMatch.id, troopId, target }));
}

function sendServerAction(action: { type: GameActionType; troopId?: string; coordinate?: Coordinate; destination?: Coordinate; targetUnitId?: string; ability?: UpgradableAbility }): void {
  if (serverMatch?.winner) return;
  if (!serverMatch || !matchSocket || matchSocket.readyState !== WebSocket.OPEN) {
    serverActionError = 'Connection to the match server is unavailable.';
    if (serverMatch && localMatchPlayer) renderServerActionBar(serverMatch, localMatchPlayer);
    return;
  }
  serverActionError = undefined;
  matchSocket.send(JSON.stringify({ type: 'action', matchId: serverMatch.id, action }));
}

function confirmServerPendingAction(): void {
  const action = serverPendingAction;
  if (!action) return;
  if (action.type === 'upgrade' && !action.ability) { serverActionError = 'Choose which ability to upgrade.'; if (serverMatch && localMatchPlayer) renderServerActionBar(serverMatch, localMatchPlayer); return; }
  serverPendingAction = undefined;
  renderServerActionTargets();
  sendServerAction(action);
}

function stageServerDeployment(troopId: string, coordinate: Coordinate, action?: ServerLegalAction): void {
  if (!serverMatch || !localMatchPlayer || serverMatch.winner || serverMatch.activePlayer !== localMatchPlayer) return;
  serverSelectedTroopId = troopId;
  serverSelectedAction = 'deploy';
  serverPendingAction = action ? { ...action } : { type: 'deploy', troopId, coordinate };
  serverPushTargetChoices = [];
  serverActionError = undefined;
  sendServerSelection(troopId, { type: 'deploy', coordinate });
  renderServerMatchState(serverMatch);
}

function performServerActionAt(coordinate: Coordinate): void {
  if (!serverMatch || serverMatch.winner || !localMatchPlayer || !serverSelectedTroopId || !serverSelectedAction || (serverMatch.pendingResolution?.owner ?? serverMatch.activePlayer) !== localMatchPlayer) return;
  if (serverSelectedAction === 'self-defense') return;
  const candidates = selectedServerLegalActions().filter(action => action.type === serverSelectedAction && action.coordinate === coordinate);
  if (serverSelectedAction === 'push' && candidates.length > 1) {
    serverPushTargetChoices = candidates;
    serverPendingAction = undefined;
    renderServerActionBar(serverMatch, localMatchPlayer);
    return;
  }
  const action = candidates[0];
  if (!action) return;
  if (action.type === 'deploy') {
    stageServerDeployment(action.troopId, coordinate, action);
    return;
  }
  serverPendingAction = action.type === 'upgrade'
    ? { type: action.type, troopId: action.troopId, coordinate: action.coordinate }
    : { ...action };
  serverPushTargetChoices = [];
  sendServerSelection(serverSelectedTroopId, { type: serverSelectedAction, coordinate });
  // Movement previews are rendered once from the server's target-selection
  // echo. Rendering optimistically here would build the same animated group a
  // second time a few milliseconds later and visibly restart the motion.
  if (action.type !== 'move' && action.type !== 'fly' && action.type !== 'push' && action.type !== 'bomb') renderServerMatchState(serverMatch);
}

function clearServerPreviewPath(): void {
  for (const coordinate of serverPreviewPath) cellsByCoordinate.get(coordinate)?.cell.classList.remove('movement-path');
  serverPreviewPath = [];
}

/** A UI-only free-path preview. The server still validates the submitted move. */
function serverMovePath(from: Coordinate, destination: Coordinate, maxDistance: number): Coordinate[] | undefined {
  if (!serverMatch || destination === from || destination === '0,0') return undefined;
  const occupied = new Map(serverMatch.units.map(unit => [unit.coordinate, unit]));
  const seen = new Set<Coordinate>([from]);
  const queue: Array<{ coordinate: Coordinate; path: Coordinate[] }> = [{ coordinate: from, path: [] }];
  while (queue.length > 0) {
    const current = queue.shift(); if (!current || current.path.length === maxDistance) continue;
    for (const next of adjacentCoordinates(current.coordinate)) {
      if (!cellsByCoordinate.has(next) || next === '0,0' || seen.has(next)) continue;
      const path = [...current.path, next];
      if (next === destination) return path;
      if (occupied.has(next)) continue;
      seen.add(next); queue.push({ coordinate: next, path });
    }
  }
  return undefined;
}

function previewServerPath(coordinate: Coordinate): void {
  clearServerPreviewPath();
  const unit = selectedServerUnit();
  const isLegalMove = selectedServerLegalActions().some(action => action.type === 'move' && action.coordinate === coordinate);
  if (!unit || serverSelectedAction !== 'move' || !isLegalMove) return;
  const path = serverMovePath(unit.coordinate, coordinate, cellsByCoordinate.size);
  if (!path) return;
  serverPreviewPath = path;
  for (const item of path) cellsByCoordinate.get(item)?.cell.classList.add('movement-path');
}

function showServerHoverDetailsForCoordinate(coordinate: Coordinate): void {
  if (!serverMatch) return;
  const bomb = serverMatch.bombs?.find(item => item.coordinate === coordinate);
  const damagePreviews = serverPendingDamagePreviews();
  const coordinateDamagePreviews = damagePreviews.filter(preview => preview.coordinate === coordinate);
  const projectedDamageTarget = coordinateDamagePreviews.find(preview => preview.replacesBash)?.target;
  const bash = projectedDamageTarget ? undefined : serverMatch.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, serverMatch));
  const unitPreview = serverPendingUnitPreviews().find(unit => unit.coordinate === coordinate);
  const unitAtCoordinate = serverMatch.units.find(unit => unit.coordinate === coordinate)
    ?? unitPreview;
  const units = projectedDamageTarget ? [projectedDamageTarget] : bash
    ? [serverMatch.units.find(unit => unit.id === (serverBashReveal === 'attacker' ? bash.attackerId : bash.defenderId))]
    : [unitAtCoordinate];
  const displayed = units.filter((unit): unit is ServerUnitState => unit !== undefined);
  if (displayed.length === 0 && !bomb) return;
  hoverDetailsPanel.replaceChildren();
  // Match the fixed board layout: Red is described first, then Blue.
  for (const unit of displayed.sort((left, right) => left.owner - right.owner)) {
    const troop = serverTroop(unit.troopId, unit.owner, unit); if (!troop) continue;
    const { card, copy } = createHoverCard(troop);
    const damagePreview = coordinateDamagePreviews.find(preview => preview.target.id === unit.id);
    const isDamageTarget = Boolean(damagePreview);
    if (bash) {
      const modifier = serverModifier(unit, bash.target, bash);
      const combat = document.createElement('div'); combat.classList.add('hover-detail-line'); combat.textContent = `Bash strength: ${unit.combat.health} + ${modifier} = ${unit.combat.health + modifier}`; copy.append(combat);
      for (const entry of serverModifierEntries(unit, bash.target, bash)) {
        const source = document.createElement('div'); source.classList.add('hover-detail-line'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; copy.append(source);
      }
    }
    appendHoverRules(copy, troop);
    if (isDamageTarget && damagePreview) {
      const effectiveness = document.createElement('div'); effectiveness.classList.add('hover-detail-line'); effectiveness.textContent = `Damage preview: ${damagePreview.target.currentHealth} + ${damagePreview.targetModifier}`; copy.append(effectiveness);
      const damage = document.createElement('div'); damage.classList.add('hover-detail-line'); damage.textContent = `Effective damage: ${damagePreview.damage} ${damagePreview.icon}`; copy.append(damage);
      if (!bash && !damagePreview.magic) {
        const entries = [...unit.combat.modifiers];
        const pendingBlock = serverPreviewBlock(unit, coordinate);
        if (pendingBlock) entries.push({ label: 'Pending shield', value: pendingBlock });
        for (const entry of entries) {
          const source = document.createElement('div'); source.classList.add('hover-detail-line'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; copy.append(source);
        }
      }
    }
    hoverDetailsPanel.append(card);
  }
  if (bomb) {
    const detail = document.createElement('div');
    detail.classList.add('hover-card', bomb.owner === 1 ? 'server-owner-one' : 'server-owner-two');
    const sourceName = catalogueById.get(bomb.sourceTroopId)?.name ?? bomb.sourceTroopId;
    detail.textContent = `💣 Bomb — ${bomb.damage} black-magic damage on this hex and all 6 adjacent hexes when lit by fire magic. It affects both players, ignores modifiers, resolves after the next action, then is removed. Another bomb cannot be thrown onto this hex. Thrown by ${sourceName}.`;
    hoverDetailsPanel.append(detail);
  }
  hoverDetailsPanel.hidden = false;
}

function renderServerActionTargets(): void {
  for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('action-target', 'push-target', 'deployment-target', 'region-target', 'server-pending-target', 'server-pending-deployment', 'server-reachable');
  if (!serverSelectedAction) return;
  for (const action of selectedServerLegalActions()) {
    if (action.type !== serverSelectedAction || !action.coordinate) continue;
    const cell = cellsByCoordinate.get(action.coordinate)?.cell;
    if (!cell) continue;
    if (serverPendingAction?.coordinate !== action.coordinate) cell.classList.add('action-target');
    cell.classList.add('region-target', 'server-reachable');
    if (action.type === 'deploy') cell.classList.add('deployment-target');
    if (action.type === 'push') cell.classList.add('push-target');
  }
  if (serverPendingAction?.coordinate) {
    const pendingCell = cellsByCoordinate.get(serverPendingAction.coordinate)?.cell;
    pendingCell?.classList.add('server-pending-target', 'server-reachable');
    if (serverPendingAction.type === 'deploy') pendingCell?.classList.add('server-pending-deployment');
  }
  if (serverPendingAction?.type === 'push' && serverPendingAction.destination) {
    cellsByCoordinate.get(serverPendingAction.destination)?.cell.classList.add('server-pending-target', 'server-reachable');
  }
  const unit = selectedServerUnit();
  if (unit && serverPendingAction?.type === 'cannon' && serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, serverPendingAction.coordinate, hexDistance(unit.coordinate, serverPendingAction.coordinate)) ?? []) {
      cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
}

function raiseActionTargetCells(): void {
  for (const { cell } of cellsByCoordinate.values()) {
    if (cell.classList.contains('action-target') || cell.classList.contains('server-pending-target')) boardPanel.append(cell);
  }
}

const serverActionLabels: Record<GameActionType, string> = {
  deploy: 'Deploy',
  move: '🥾 Move',
  fly: '🪽 Fly',
  attack: '🏹 Attack',
  cannon: '🧨 Cannon',
  bomb: '💣 Bomb',
  push: `${pushIcon} Push`,
  magic: '🔥 Magic',
  mending: '❤️ Mend',
  upgrade: '🔮 Upgrade',
  defense: '🛡️ Block',
  'self-defense': '🛡️ Self block',
  pass: 'Pass turn',
  'resolve-move': '🥾 End move',
  'resolve-death-attack': '💀 Ranged attack',
  'resolve-instant-ranged': '🏹❗ Instant attack',
  'resolve-revive': '👼 Revive',
  'resolve-pass': 'Decline end move'
};

function serverActionLabel(type: GameActionType): string {
  return serverActionLabels[type];
}

function renderServerActionBar(match: ServerMatchState, local: Player): void {
  actionBarPanel.replaceChildren();
  if (match.sandbox) {
    const tools = document.createElement('span'); tools.className = 'sandbox-tools';
    const freePlacement = document.createElement('button');
    freePlacement.type = 'button'; freePlacement.textContent = match.sandboxFreePlacement ? 'Free placement: on' : 'Free placement: off';
    freePlacement.classList.toggle('active-action', Boolean(match.sandboxFreePlacement));
    freePlacement.addEventListener('click', () => { sendSandboxMode(match, !match.sandboxFreePlacement); });
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Save playground';
    save.addEventListener('click', () => { void saveSandbox(match); });
    const load = document.createElement('button');
    load.type = 'button'; load.textContent = 'Load saved';
    load.addEventListener('click', () => { void loadSandbox().catch(error => {
      serverActionError = error instanceof Error ? error.message : 'Could not load playground.';
      renderServerActionBar(match, local);
    }); });
    const back = document.createElement('button');
    back.type = 'button'; back.textContent = 'Back';
    back.title = 'Revert the last playground action';
    back.disabled = !match.sandboxUndoAvailable;
    back.addEventListener('click', () => { void undoSandbox(match).catch(error => {
      serverActionError = error instanceof Error ? error.message : 'Could not undo the playground action.';
      renderServerActionBar(match, local);
    }); });
    const menu = document.createElement('button');
    menu.type = 'button'; menu.textContent = 'Back to menu';
    menu.setAttribute('aria-label', 'Leave playground and return to the main menu');
    menu.addEventListener('click', () => {
      resumableSandbox = match;
      resumeSandboxButtonPanel.hidden = false;
      mainPanel.hidden = true;
      menuScreenPanel.hidden = false;
      returnToMainMenu();
    });
    tools.append(freePlacement, save, load, back, menu); actionBarPanel.append(tools);
  }
  const message = document.createElement('span');
  if (match.winner) message.textContent = `Player ${match.winner === 1 ? '1 / Red' : '2 / Blue'} wins.`;
  else if (serverActionError) message.textContent = serverActionError;
  else if (match.pendingResolution?.owner === local) message.textContent = match.pendingResolution.kind === 'optional-move'
    ? 'End: move this hero 1 hex, or decline to finish your turn.'
    : match.pendingResolution.kind === 'death-attack' ? 'Death burst: choose an enemy target.'
      : match.pendingResolution.kind === 'instant-ranged' ? `Choose a hex for the instant ranged effect${match.pendingResolution.remaining > 1 ? ` (${match.pendingResolution.remaining} remaining)` : ''}.`
        : 'Revive: choose one of your defeated troops.';
  else message.textContent = match.activePlayer === local ? 'Your turn.' : `Opponent's turn — Player ${match.activePlayer === 1 ? '1 / Red' : '2 / Blue'}.`;
  actionBarPanel.append(message);
  if (match.sandbox && match.activePlayer === local && !match.winner && !match.pendingResolution) {
    const pass = document.createElement('button');
    pass.type = 'button'; pass.textContent = 'Pass turn';
    pass.addEventListener('click', () => sendServerAction({ type: 'pass' }));
    actionBarPanel.append(pass);
  }
  const unit = selectedServerUnit();
  if (!serverSelectedTroopId || (match.pendingResolution?.owner ?? match.activePlayer) !== local || match.winner) return;
  const legalActions = selectedServerLegalActions();
  if (match.pendingResolution?.kind === 'revive') {
    for (const choice of legalActions.filter(action => action.type === 'resolve-revive')) {
      const targetId = choice.targetTroopId; if (!targetId) continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `👼 ${catalogueById.get(targetId)?.name ?? targetId}`;
      button.addEventListener('click', () => sendServerAction(choice)); actionBarPanel.append(button);
    }
    const skip = legalActions.find(action => action.type === 'resolve-pass');
    if (skip) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Skip'; button.addEventListener('click', () => sendServerAction(skip)); actionBarPanel.append(button); }
  } else if (match.pendingResolution?.kind === 'death-attack' || match.pendingResolution?.kind === 'instant-ranged') {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = match.pendingResolution.kind === 'death-attack' ? '💀 Choose ranged target' : '🏹❗ Choose target hex'; button.classList.add('active-action'); actionBarPanel.append(button);
    const skip = legalActions.find(action => action.type === 'resolve-pass');
    if (skip) { const skipButton = document.createElement('button'); skipButton.type = 'button'; skipButton.textContent = 'Skip'; skipButton.addEventListener('click', () => sendServerAction(skip)); actionBarPanel.append(skipButton); }
  } else if (!unit) {
    const troop = serverTroop(serverSelectedTroopId, local);
    const canDeploy = legalActions.some(action => action.type === 'deploy');
    message.textContent = serverPendingAction
      ? `Deploy to ${serverPendingAction.coordinate}. Confirm when ready.`
      : canDeploy
        ? 'Choose a highlighted hex, or drag this card directly onto a legal deployment hex.'
        : troop
          ? `No legal hex for ${troopDisplayName(troop)} yet. ${deploymentDescription(troop)}`
          : 'This card has no legal deployment hex right now.';
  } else {
    const availableTypes = new Set(legalActions.map(action => action.type));
    const orderedTypes: GameActionType[] = ['resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-pass', 'move', 'fly', 'attack', 'cannon', 'bomb', 'push', 'defense', 'self-defense', 'magic', 'mending', 'upgrade'];
    for (const type of orderedTypes.filter(candidate => availableTypes.has(candidate))) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = serverActionLabel(type); button.classList.toggle('active-action', serverSelectedAction === type);
      button.addEventListener('click', () => {
        if (type === 'resolve-pass') { sendServerAction({ type, troopId: serverSelectedTroopId }); return; }
        serverSelectedAction = type;
        const selfDefense = type === 'self-defense' ? legalActions.find(action => action.type === type) : undefined;
        serverPendingAction = selfDefense ? { ...selfDefense } : undefined;
        sendServerSelection(serverSelectedTroopId, type === 'self-defense' ? { type, coordinate: unit.coordinate } : undefined);
        renderServerMatchState(match);
      });
      actionBarPanel.append(button);
    }
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel selection';
  cancel.addEventListener('click', clearServerSelection);
  if (!match.pendingResolution) actionBarPanel.append(cancel);
  if (serverPendingAction?.type === 'upgrade' && serverPendingAction.coordinate) {
    const upgrades = legalActions.filter(action => action.type === 'upgrade' && action.coordinate === serverPendingAction?.coordinate && action.ability);
    if (upgrades.length > 0) {
      message.textContent = 'Choose the recipient ability to upgrade.';
      for (const upgrade of upgrades) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = serverActionLabel(upgrade.ability as GameActionType);
        button.classList.toggle('active-action', serverPendingAction.ability === upgrade.ability);
        button.addEventListener('click', () => { serverPendingAction = { ...upgrade }; renderServerActionBar(match, local); });
        actionBarPanel.append(button);
      }
    }
  }
  if (serverPushTargetChoices.length > 1) {
    message.textContent = 'Choose which troop in the bash to push.';
    for (const choice of serverPushTargetChoices) {
      const target = match.units.find(unit => unit.id === choice.targetUnitId);
      const targetTroop = target ? serverTroop(target.troopId, target.owner, target) : undefined;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `Push ${targetTroop ? troopDisplayName(targetTroop) : target?.troopId ?? 'troop'}`;
      button.addEventListener('click', () => {
        serverPendingAction = { ...choice };
        serverPushTargetChoices = [];
        renderServerActionBar(match, local);
        renderServerMatchState(match);
      });
      actionBarPanel.append(button);
    }
  }
  if (serverPendingAction) {
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.textContent = 'Confirm action';
    confirm.addEventListener('click', confirmServerPendingAction);
    actionBarPanel.append(confirm);
  }
}

function sendSandboxMode(match: ServerMatchState, freePlacement: boolean): void {
  if (!matchSocket || matchSocket.readyState !== WebSocket.OPEN) return;
  matchSocket.send(JSON.stringify({ type: 'sandbox-mode', matchId: match.id, freePlacement }));
}

function placeSandboxTroop(coordinate: Coordinate): void {
  if (!serverMatch?.sandboxFreePlacement || !draggedBoardTroop || !matchSocket || matchSocket.readyState !== WebSocket.OPEN) return;
  const { owner, troopId } = draggedBoardTroop;
  matchSocket.send(JSON.stringify({ type: 'sandbox-place', matchId: serverMatch.id, owner, troopId, coordinate }));
}

async function saveSandbox(match: ServerMatchState): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/sandbox/${match.id}/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
  });
  const payload = await readApiJson<{ savedAt?: string; error?: string }>(response, 'Save playground');
  serverActionError = response.ok ? `Playground saved${payload.savedAt ? ` at ${new Date(payload.savedAt).toLocaleTimeString()}` : '.'}` : payload.error ?? 'Could not save the playground.';
  renderServerActionBar(match, localMatchPlayer ?? 1);
}

function setConnectionStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'): void {
  connectionStatusPanel.className = status;
  connectionStatusPanel.hidden = status === 'connected';
  connectionStatusPanel.textContent = status === 'connected' ? 'Connected to match server.'
    : status === 'connecting' ? 'Connecting to match server…'
    : status === 'reconnecting' ? 'Connection lost — reconnecting…'
    : 'Connection lost.';
}

function connectToMatch(matchId: string, reconnecting = false): void {
  if (!currentNickname) return;
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const previousSocket = matchSocket;
  matchSocket = undefined;
  previousSocket?.close();
  setConnectionStatus(reconnecting ? 'reconnecting' : 'connecting');
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
  matchSocket = socket;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', matchId, nickname: currentNickname }));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as { type?: string; match?: ServerMatchState; message?: string };
    if (message.type === 'error') {
      serverActionError = message.message ?? 'The server rejected that action.';
      matchStatusPanel.textContent = serverActionError;
      if (serverMatch && localMatchPlayer && !mainPanel.hidden) renderServerActionBar(serverMatch, localMatchPlayer);
      return;
    }
    if (message.type !== 'state' || !message.match || !currentNickname) return;
    const match = message.match;
    if (!applyLocalPlayerView(match)) return;
    setConnectionStatus('connected');
    if (!mainPanel.hidden) renderServerMatchState(match);
  });
  socket.addEventListener('close', () => {
    if (matchSocket !== socket || activeMatchId !== matchId || serverMatch?.winner) return;
    matchSocket = undefined;
    setConnectionStatus('reconnecting');
    reconnectTimer = window.setTimeout(() => connectToMatch(matchId, true), 1500);
  });
}

function renderDeckCard(troop: Troop, className: 'database-card' | 'deck-card', slot?: number): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.classList.add('troop-card', className);
  card.dataset.deploymentOwner = className === 'database-card' ? 'blue' : 'red';
  if (troop.role === 'hero') card.classList.add('hero-card');
  if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-both');
  else if (troop.deploymentRegions.includes('starting')) card.classList.add('deployment-starting');
  else if (troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-intermediate');
  if (troop.deploymentRule === 'enemy-region') card.classList.add('deployment-enemy');
  appendTroopCardContent(card, troop, threeLineSummary(fullEffectLines(troop)).map(text => ({ text })), `♥ ${troop.baseHealth}`);
  card.addEventListener('pointerenter', () => showHoverDetails([troop]));
  card.addEventListener('pointerleave', hideHoverDetails);
  card.addEventListener('focus', () => showHoverDetails([troop]));
  card.addEventListener('blur', hideHoverDetails);
  if (className === 'database-card') {
    card.draggable = true;
    card.addEventListener('dragstart', event => {
      draggedDatabaseCardId = troop.cardId;
      draggedDeckSlot = undefined;
      beginTroopDrag(event, troop, card, 2);
    });
    card.addEventListener('dragend', endTroopDrag);
    card.addEventListener('click', () => addCardToDeck(troop.cardId));
  } else if (slot !== undefined) {
    card.draggable = true;
    card.addEventListener('dragstart', event => {
      draggedDeckSlot = slot;
      draggedDatabaseCardId = undefined;
      beginTroopDrag(event, troop, card, 1);
    });
    card.addEventListener('dragend', endTroopDrag);
    card.addEventListener('click', () => removeCardFromDeck(slot));
    card.addEventListener('dragover', event => event.preventDefault());
    card.addEventListener('drop', event => {
      event.preventDefault();
      if (draggedDatabaseCardId) moveDatabaseCardToSlot(draggedDatabaseCardId, slot);
      else if (draggedDeckSlot !== undefined) swapDeckSlots(draggedDeckSlot, slot);
    });
  }
  return card;
}

function addCardToDeck(cardId: string): void {
  applyDeckEdit(addDeckCard(deckSlots, cardId, deckFormat, catalogueById));
}

function removeCardFromDeck(slot: number): void {
  applyDeckEdit(removeDeckCard(deckSlots, slot, deckFormat));
}

function moveDatabaseCardToSlot(cardId: string, slot: number): void {
  draggedDatabaseCardId = undefined;
  draggedDeckSlot = undefined;
  applyDeckEdit(moveDeckCard(deckSlots, cardId, slot, deckFormat, catalogueById));
}

function swapDeckSlots(from: number, to: number): void {
  draggedDeckSlot = undefined;
  applyDeckEdit(swapDeckCards(deckSlots, from, to, deckFormat));
}

function applyDeckEdit(next: DeckSlots): void {
  if (next === deckSlots) return;
  deckSlots = next;
  deckBuilderDirty = true;
  deckBuilderNotice = undefined;
  renderDeckBuilder();
}

function renderDeckBuilder(): void {
  gameLayoutPanel.classList.add('deck-building');
  playerTwoCardsPanel.replaceChildren();
  playerOneCardsPanel.replaceChildren();
  playerTwoCardsPanel.classList.remove('grouped-card-list', 'sandbox-catalog');
  playerOneCardsPanel.classList.remove('grouped-card-list', 'sandbox-catalog');
  playerTwoCardsPanel.classList.add('deck-builder', 'grouped-card-list');
  playerOneCardsPanel.classList.add('deck-builder');
  const availableTroops = catalogueIds
    .filter(cardId => !deckSlots.includes(cardId))
    .map(cardId => createTroopView(cardId, 2))
    .filter((troop): troop is Troop => Boolean(troop));
  appendGroupedTroopCards(playerTwoCardsPanel, availableTroops, troop => renderDeckCard(troop, 'database-card'));
  for (let slot = 0; slot < deckFormat; slot += 1) {
    const troop = deckSlots[slot] ? createTroopView(deckSlots[slot] as string, 1) : undefined;
    if (troop) {
      playerOneCardsPanel.append(renderDeckCard(troop, 'deck-card', slot));
    } else {
      const empty = document.createElement('div');
      empty.classList.add('troop-card', 'deck-empty');
      empty.textContent = `Empty ${slot + 1}`;
      empty.addEventListener('dragover', event => event.preventDefault());
      empty.addEventListener('drop', event => {
        event.preventDefault();
        if (draggedDatabaseCardId) moveDatabaseCardToSlot(draggedDatabaseCardId, slot);
        else if (draggedDeckSlot !== undefined) swapDeckSlots(draggedDeckSlot, slot);
      });
      playerOneCardsPanel.append(empty);
    }
  }
  renderDeckBuilderActionBar();
}

const ns = 'http://www.w3.org/2000/svg';
const size = 42;
const hexGap = 1.5;
const horizontalScale = 1.4;
const center: Point = { x: 400, y: 310 };

function axialToPixel(x: number, y: number): Point {
  const verticalX = Math.sqrt(3) * size * (x - y / 2);
  const verticalY = 1.5 * size * y;
  return {
    x: center.x + verticalY * horizontalScale,
    y: center.y - verticalX
  };
}

function hexPoints(cx: number, cy: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = 60 * index * Math.PI / 180;
    return `${cx + (size - hexGap) * horizontalScale * Math.cos(angle)},${cy + (size - hexGap) * Math.sin(angle)}`;
  }).join(' ');
}

function controlledBoardHexArtwork(regionId: RegionId | undefined, controller?: Player): string | undefined {
  if (controller === 1) return regionId === 'p1-start' || regionId === 'p2-start' || regionId === 'front' ? 'hex_dark_red.png' : 'hex_light_red.png';
  if (controller === 2) return regionId === 'p1-start' || regionId === 'p2-start' || regionId === 'front' ? 'hex_dark_blue.png' : 'hex_light_blue.png';
  return regionId === 'p1-start' ? 'hex_dark_red.png'
    : regionId === 'p1-middle' || regionId === 'p1-side' ? 'hex_light_red.png'
      : regionId === 'p2-start' ? 'hex_dark_blue.png'
        : regionId === 'p2-middle' || regionId === 'p2-side' ? 'hex_light_blue.png'
          : regionId === 'front' ? 'hex_grey.png'
            : undefined;
}

function boardHexArtwork(regionId: RegionId | undefined, position: Point): SVGImageElement | undefined {
  const filename = controlledBoardHexArtwork(regionId);
  if (!filename) return undefined;
  const image = document.createElementNS(ns, 'image');
  image.classList.add('board-hex-artwork');
  image.setAttribute('href', `./assets/${filename}`);
  // The visible frame occupies x=75..1185 and y=149..1087 of the 1254px
  // source canvas. Map those alpha bounds exactly onto this SVG hex.
  image.setAttribute('x', String(position.x - 64.37));
  image.setAttribute('y', String(position.y - 46.23));
  image.setAttribute('width', '128.16');
  image.setAttribute('height', '93.82');
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('aria-hidden', 'true');
  return image;
}

/** Place a server-rendered description using the shared board orientation. */
function contextualBoardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number): ReturnType<typeof boardDescriptionEntries> {
  const entries = boardDescriptionEntries(troop, includeSelfBlock, revealMoveOne);
  return ignitionDamage
    ? entries.map(line => line.action === 'magic' ? { ...line, text: `${ignitionDamage} 💣` } : line)
    : entries;
}

const boardEmojiPattern = /(❤️|♥|🥾|🪽|🏹|🛡️|🔥|🧨|💣|🫸|🔮|⚔️|👑|🩸|💀|👼|❗)/gu;
const boardDescriptionLineHeight = 9;

function boardDescriptionLineY(position: Point, lineCount: number, index: number): number {
  // Health belongs to the upper area of the full board hex. Only the
  // remaining ability/effect rows are placed in the lower info hex.
  if (index === 0) return position.y - 19;
  const infoLineCount = Math.max(1, lineCount - 1);
  return position.y + 29 - (infoLineCount - index) * boardDescriptionLineHeight;
}

function appendBoardDescriptionText(parent: SVGTSpanElement, text: string): void {
  for (const token of text.split(boardEmojiPattern).filter(Boolean)) {
    const span = document.createElementNS(ns, 'tspan');
    span.textContent = token;
    if (token.match(boardEmojiPattern)) {
      span.classList.add('board-info-emoji');
    } else span.classList.add('board-info-glyph');
    parent.append(span);
  }
}

function appendBoardInfoFrame(cell: SVGGElement, troop: Troop, position: Point): void {
  const frame = document.createElementNS(ns, 'polygon');
  frame.dataset.serverRender = 'info-frame';
  frame.classList.add('board-info-frame', troop.owner === 1 ? 'player-one-info-frame' : 'player-two-info-frame');
  const radius = size - hexGap;
  const sqrt3Quarter = Math.sqrt(3) / 4;
  const infoCentre: Point = {
    x: position.x,
    y: position.y + radius * sqrt3Quarter
  };
  const relativePoints: Point[] = [
    { x: 3 / 4, y: 0 },
    { x: 1 / 2, y: -sqrt3Quarter },
    { x: -1 / 2, y: -sqrt3Quarter },
    { x: -3 / 4, y: 0 },
    { x: -1 / 2, y: sqrt3Quarter },
    { x: 1 / 2, y: sqrt3Quarter }
  ];
  frame.setAttribute('points', relativePoints.map(point =>
    `${infoCentre.x + point.x * radius * horizontalScale},${infoCentre.y + point.y * radius}`
  ).join(' '));
  frame.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  keepServerOverlayUpright(frame, position);
  cell.append(frame);
}

function writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number): void {
  marker.replaceChildren();
  const lines = contextualBoardDescriptionEntries(troop, includeSelfBlock, revealMoveOne, ignitionDamage);
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(ns, 'tspan');
    row.setAttribute('x', String(position.x));
    row.setAttribute('y', String(boardDescriptionLineY(position, lines.length, index)));
    if (index === 0 && line.text.includes('♥')) {
      row.classList.add('board-health');
      const ownerClass = troop.owner === 1 ? 'player-one-health' : 'player-two-health';
      const match = line.text.match(/(♥|❤️)\s*(\d+)/u);
      if (match) {
        const heart = document.createElementNS(ns, 'tspan');
        heart.classList.add('board-health-heart', ownerClass);
        heart.textContent = match[1];
        const value = document.createElementNS(ns, 'tspan');
        value.classList.add('board-health-value', ownerClass);
        value.textContent = ` ${match[2]}`;
        row.append(heart, value);
        marker.append(row);
        continue;
      }
    }
    if (line.upgraded) row.classList.add('upgraded-effect');
    const values = line.text.match(/^(\d+)(.*?)(\d+)$/u);
    if (values && (line.staticLeft || line.staticRight)) {
      const left = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(left, values[1]);
      const middle = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(middle, values[2]);
      const right = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(right, values[3]);
      if (line.staticLeft) left.classList.add('static-effect');
      if (line.staticRight) right.classList.add('static-effect');
      row.append(left, middle, right);
    } else appendBoardDescriptionText(row, line.text);
    marker.append(row);
  }
}

function appendServerActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action?: GameActionType, highlightLife = false, includeSelfBlock = false, negativeSelfBlock = false, ignitionDamage?: number): void {
  const relevantAction = action === 'self-defense' && includeSelfBlock ? 'self-defense' : action === 'self-defense' ? 'defense' : action;
  // Life has no action tag. Do not let an absent selection accidentally
  // match it; it is highlighted only for a troop just deployed this turn.
  if (!highlightLife && !relevantAction) return;
  const entries = contextualBoardDescriptionEntries(troop, includeSelfBlock, relevantAction === 'move', ignitionDamage);
  const index = highlightLife ? 0 : entries.findIndex(line => line.action === relevantAction);
  if (index < 0) return;
  const line = entries[index];
  const rect = document.createElementNS(ns, 'rect');
  rect.dataset.serverRender = 'description-highlight';
  rect.classList.add('action-description-highlight', troop.owner === 1 ? 'player-one-highlight' : 'player-two-highlight');
  if (negativeSelfBlock) rect.classList.add('self-block-pending-highlight');
  const width = Math.min(72, Math.max(18, line.text.length * 7.4 + 8));
  rect.setAttribute('x', String(position.x - width / 2));
  rect.setAttribute('y', String(boardDescriptionLineY(position, entries.length, index) - 9));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', '11'); rect.setAttribute('rx', '2');
  rect.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  keepServerOverlayUpright(rect, position);
  cell.append(rect);
}

function showHoverDetails(troopsToShow: Troop[]): void {
  if (troopsToShow.length === 0) return;
  hoverDetailsPanel.replaceChildren();
  for (const troop of troopsToShow.sort((left, right) => right.owner - left.owner)) {
    const { card, copy } = createHoverCard(troop);
    appendHoverRules(copy, troop);
    hoverDetailsPanel.append(card);
  }
  hoverDetailsPanel.hidden = false;
}

function hideHoverDetails(): void {
  hoverDetailsPanel.hidden = true;
}

function renderInspectorCard(troop: Troop): HTMLElement {
  const card = document.createElement('article');
  card.classList.add('inspector-card', troop.owner === 1 ? 'player-one-inspector' : 'player-two-inspector');
  const heading = document.createElement('h2');
  heading.textContent = troopDisplayName(troop);
  const stats = document.createElement('p');
  stats.textContent = `Starting health: ${troop.baseHealth} · Current health: ${healthOf(troop)}`;
  const actions = document.createElement('ul');
  for (const detail of cardRuleDetails(troop)) {
    const item = document.createElement('li');
    item.textContent = detail;
    actions.append(item);
  }
  card.append(heading, stats, actions);
  return card;
}

function showTroopInspectorForTroops(displayedTroops: Troop[]): void {
  if (displayedTroops.length === 0) return;
  inspectorContentPanel.replaceChildren(...displayedTroops.sort((left, right) => right.owner - left.owner).map(renderInspectorCard));
  troopInspectorPanel.hidden = false;
  inspectorCloseButton.focus();
}

function showTroopInspector(coordinate: Coordinate): void {
  if (!serverMatch) return;
  const bash = serverMatch.bashes.find(item => item.target === coordinate);
  const units = bash
    ? [serverMatch.units.find(unit => unit.id === bash.attackerId), serverMatch.units.find(unit => unit.id === bash.defenderId)]
    : [serverMatch.units.find(unit => unit.coordinate === coordinate)];
  const displayedTroops = units
    .filter((unit): unit is ServerUnitState => unit !== undefined)
    .map(unit => serverTroop(unit.troopId, unit.owner, unit))
    .filter((troop): troop is Troop => troop !== undefined);
  showTroopInspectorForTroops(displayedTroops);
}

function hideTroopInspector(): void {
  troopInspectorPanel.hidden = true;
}

function renderDeckBuilderActionBar(): void {
  actionBarPanel.replaceChildren();
  const formatPicker = document.createElement('select');
  for (const format of [8, 10] as const) {
    const option = document.createElement('option'); option.value = String(format); option.textContent = `${format}-card`; option.selected = format === deckFormat; formatPicker.append(option);
  }
  formatPicker.addEventListener('change', async () => {
    deckFormat = Number(formatPicker.value) as 8 | 10;
    await loadDeck(activeDeckIndex);
    renderDeckBuilder();
  });
  actionBarPanel.append(formatPicker);
  const deckPicker = document.createElement('select');
  for (let index = 0; index < 4; index += 1) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Deck ${index + 1}`;
    option.selected = index === activeDeckIndex;
    deckPicker.append(option);
  }
  deckPicker.addEventListener('change', async () => {
    activeDeckIndex = Number(deckPicker.value);
    await loadDeck(activeDeckIndex);
    renderDeckBuilder();
  });
  actionBarPanel.append(deckPicker);
  const selectedCards = selectedDeckCards(deckSlots, deckFormat);
  const heroCount = selectedCards.filter(id => catalogueById.get(id)?.role === 'hero').length;
  const hasHero = heroCount === 1;
  const message = document.createElement('span');
  message.textContent = deckBuilderNotice ?? `Deck builder: ${selectedCards.length}/${deckFormat} cards${hasHero ? '' : ' — choose exactly one hero'}${deckBuilderDirty ? ' — unsaved changes' : ''}. Click database cards to add; click deck cards to remove.`;
  actionBarPanel.append(message);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear deck';
  clear.disabled = selectedCards.length === 0;
  clear.addEventListener('click', () => {
    applyDeckEdit(clearDeckSlots());
  });
  actionBarPanel.append(clear);
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save deck';
  save.disabled = !deckBuilderDirty;
  save.addEventListener('click', () => {
    const savedDraft = deckSlots;
    const savedFormat = deckFormat;
    const savedIndex = activeDeckIndex;
    save.disabled = true;
    deckBuilderNotice = 'Saving deck…';
    message.textContent = deckBuilderNotice;
    void persistDeck().then(() => {
      const unchanged = deckSlots === savedDraft && deckFormat === savedFormat && activeDeckIndex === savedIndex;
      if (unchanged) deckBuilderDirty = false;
      deckBuilderNotice = unchanged ? 'Deck saved.' : 'Saved the previous version; newer changes are still unsaved.';
      renderDeckBuilder();
    }).catch(error => {
      deckBuilderNotice = error instanceof Error ? error.message : 'Could not save the deck.';
      renderDeckBuilder();
    });
  });
  actionBarPanel.append(save);
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Back';
  back.addEventListener('click', () => {
    deckSlots = createDeckSlots();
    deckBuilderDirty = false;
    deckBuilderNotice = undefined;
    mainPanel.hidden = true;
    menuScreenPanel.hidden = false;
    void refreshDeckReadiness();
  });
  actionBarPanel.append(back);
}

for (let y = -4; y <= 4; y += 1) {
  for (let x = -3; x <= 3; x += 1) {
    if (x - y < -3 || x - y > 3) continue;

    const position = axialToPixel(x, y);
    const coordinate = toCoordinate(x, y);
    const isCenter = coordinate === '0,0';
    const cell = document.createElementNS(ns, 'g');
    cell.classList.add('cell');
    const regionId = regionAt(coordinate)?.id;
    if (regionId === 'p1-start') cell.classList.add('player-one');
    if (regionId === 'p2-start') cell.classList.add('player-two');
    if (regionId === 'p1-middle') cell.classList.add('player-one-middle');
    if (regionId === 'p2-middle') cell.classList.add('player-two-middle');
    if (regionId === 'p1-side') cell.classList.add('player-one-side');
    if (regionId === 'p2-side') cell.classList.add('player-two-side');
    if (regionId === 'front') cell.classList.add('front');
    if (isCenter) cell.classList.add('center');
    cell.dataset.x = String(x);
    cell.dataset.y = String(y);
    cell.id = `hex-${x}-${y}`;

    const hex = document.createElementNS(ns, 'polygon');
    hex.classList.add('hex');
    hex.setAttribute('points', hexPoints(position.x, position.y));

    const clipId = `hex-clip-${x}-${y}`;
    const clip = document.createElementNS(ns, 'clipPath');
    clip.id = clipId;
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipHex = document.createElementNS(ns, 'polygon');
    clipHex.setAttribute('points', hexPoints(position.x, position.y));
    clip.append(clipHex);
    cell.dataset.clipId = clipId;

    const label = document.createElementNS(ns, 'text');
    label.classList.add('coordinate');
    label.setAttribute('x', String(position.x));
    label.setAttribute('y', String(position.y + 4));
    label.textContent = `${x}, ${y}`;

    const artwork = boardHexArtwork(regionId, position);
    cell.append(clip, ...(artwork ? [artwork] : []), hex, label);
    cell.addEventListener('pointerenter', () => {
      if (serverMatch) { setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
    });
    cell.addEventListener('pointerleave', () => { hideHoverDetails(); setServerHoverPreview(coordinate, false); if (serverMatch) clearServerPreviewPath(); });
    cell.addEventListener('focus', () => {
      if (serverMatch) { setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
    });
    cell.addEventListener('blur', () => { hideHoverDetails(); setServerHoverPreview(coordinate, false); if (serverMatch) clearServerPreviewPath(); });
    if (!isCenter) {
      let longPressTimer: number | undefined;
      let attackerRevealed = false;
      let suppressNextClick = false;
      const cancelLongPress = (): void => {
        if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      };
      cell.addEventListener('pointerdown', () => {
        cancelLongPress();
        longPressTimer = window.setTimeout(() => {
          const bash = serverMatch?.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, serverMatch));
          if (bash) {
            attackerRevealed = true;
            setServerHoverPreview(coordinate, true, 'attacker');
            showServerHoverDetailsForCoordinate(coordinate);
          }
          longPressTimer = undefined;
        }, 600);
      });
      cell.addEventListener('pointerup', () => {
        cancelLongPress();
        if (attackerRevealed) {
          suppressNextClick = true;
          attackerRevealed = false;
          setServerHoverPreview(coordinate, true, 'defender');
          showServerHoverDetailsForCoordinate(coordinate);
        }
      });
      cell.addEventListener('pointerleave', () => { cancelLongPress(); attackerRevealed = false; });
      cell.addEventListener('dblclick', () => showTroopInspector(coordinate));
      cell.addEventListener('click', () => {
        if (suppressNextClick) { suppressNextClick = false; return; }
        if (!serverMatch) return;
        // Any legal action target owns the click before a friendly unit can
        // be selected. This keeps Block, Mend, and Upgrade targets usable.
        if (serverSelectedTroopId && cell.classList.contains('action-target')) {
          performServerActionAt(coordinate);
          return;
        }
        const bash = serverMatch.bashes.find(candidate => candidate.target === coordinate && !serverBashIsDodged(candidate, serverMatch));
        const localBashUnitId = bash && localMatchPlayer
          ? [bash.attackerId, bash.defenderId].find(id => serverMatch?.units.find(candidate => candidate.id === id)?.owner === localMatchPlayer)
          : undefined;
        const unit = localBashUnitId
          ? serverMatch.units.find(candidate => candidate.id === localBashUnitId)
          : serverMatch.units.find(candidate => candidate.coordinate === coordinate);
        // A different available friendly unit replaces the current selection
        // instead of becoming a passive inspection while an action is open.
        if (unit && unit.owner === localMatchPlayer) {
          selectServerTroop(unit.troopId);
          return;
        }
        // Do not manufacture a pending move/fly/attack preview from an
        // undashed hex.  The target renderer is the local legality source;
        // without this guard an out-of-range or path-blocked enemy could
        // appear to begin a bash until the server rejected confirmation.
        if (serverSelectedTroopId && serverSelectedAction && !cell.classList.contains('action-target')) {
          if (!unit) clearServerSelection();
          else { serverInspectedUnitId = unit.id; renderServerMatchState(serverMatch); }
          return;
        }
        if (unit && !serverSelectedTroopId) {
          serverInspectedUnitId = unit.id;
          renderServerMatchState(serverMatch);
          return;
        }
        if (!unit && serverSelectedTroopId && !cell.classList.contains('action-target')) {
          clearServerSelection();
          return;
        }
        performServerActionAt(coordinate);
      });
    }
    cellsByCoordinate.set(coordinate, { cell, position });
    boardPanel.append(cell);
  }
}
boardPanel.addEventListener('click', event => {
  // SVG clicks that did not originate in a hex are outside the board.
  if (serverMatch && event.target === boardPanel) clearServerSelection();
});

async function loadApplicationConfig(): Promise<void> {
  try {
    const response = await fetch('/api/config');
    const payload = await readApiJson<{ playgroundEnabled?: boolean }>(response, 'Load application configuration');
    playgroundEnabled = response.ok && payload.playgroundEnabled === true;
  } catch {
    // Developer-only features fail closed if configuration cannot be loaded.
    playgroundEnabled = false;
  }
  sandboxGameButtonPanel.hidden = !playgroundEnabled;
}

async function login(nickname: string): Promise<void> {
  const response = await fetch('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname })
  });
  const payload = await readApiJson<{ nickname?: string; error?: string }>(response, 'Login');
  if (!response.ok || !payload.nickname) throw new Error(payload.error ?? 'Login failed.');
  currentNickname = payload.nickname;
  localStorage.setItem('hex-war-nickname', currentNickname);
  welcomePanel.textContent = `Welcome, ${currentNickname}`;
  loginScreenPanel.hidden = true;
  menuScreenPanel.hidden = false;
  void refreshDeckReadiness();
  const activeMatch = await fetch(`/api/matches/active?nickname=${encodeURIComponent(currentNickname)}`);
  if (!activeMatch.ok) return;
  const matchPayload = await activeMatch.json() as { match?: ServerMatchState };
  const match = matchPayload.match;
  if (!match?.id) return;
  // Never take over the screen just because a persisted session exists. This
  // applies to both sandboxes and multiplayer matches: the menu always wins
  // after login, and resuming is an explicit choice.
  if (!match.sandbox || playgroundEnabled) {
    resumableSandbox = match;
    resumeSandboxButtonPanel.textContent = match.sandbox ? 'Resume playground' : 'Resume match';
    resumeSandboxButtonPanel.hidden = false;
  }
}

loginFormPanel.addEventListener('submit', event => {
  event.preventDefault();
  loginErrorPanel.textContent = '';
  void login(nicknameInputField.value.trim()).catch(error => {
    loginErrorPanel.textContent = error instanceof Error ? error.message : 'Login failed.';
  });
});

buildDecksButtonPanel.addEventListener('click', async () => {
  if (!currentNickname) return;
  activeDeckIndex = 0;
  await loadDeck(activeDeckIndex);
  menuScreenPanel.hidden = true;
  mainPanel.hidden = false;
  renderDeckBuilder();
});

async function queueForFormat(format: 8 | 10): Promise<void> {
  if (!currentNickname) return;
  if (serverMatch?.sandbox) {
    // The server also removes this transient session before queueing. Closing
    // locally prevents a stale sandbox WebSocket update from repainting the
    // board while the player is waiting for an opponent.
    const sandboxSocket = matchSocket;
    matchSocket = undefined;
    sandboxSocket?.close();
    serverMatch = undefined;
    activeMatchId = undefined;
  }
  playFormatErrorPanel.textContent = '';
  deckFormat = format;
  playEightCardsButtonPanel.disabled = true;
  playTenCardsButtonPanel.disabled = true;
  playEightCardsButtonPanel.textContent = format === 8 ? 'Waiting for an opponent…' : '8-card game';
  playTenCardsButtonPanel.textContent = format === 10 ? 'Waiting for an opponent…' : '10-card game';
  let firstQueueAttempt = true;
  const queue = async (): Promise<void> => {
    const response = await fetch('/api/queue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: currentNickname, format, restart: firstQueueAttempt })
    });
    firstQueueAttempt = false;
    const result = await response.json() as { status?: string; matchId?: string; error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Could not join the queue.');
    if (result.status === 'matched' && result.matchId) {
      openMatchEntry(result.matchId);
      return;
    }
    window.setTimeout(() => { void queue(); }, 1500);
  };
  await queue().catch(error => {
    renderDeckReadiness([...playableDeckFormats]);
    playFormatErrorPanel.textContent = error instanceof Error ? error.message : 'Could not join the queue.';
  });
}

function returnToMainMenu(): void {
  playFormatsPanel.hidden = true;
  sandboxFormatsPanel.hidden = true;
  playFormatErrorPanel.textContent = '';
  sandboxErrorPanel.textContent = '';
  playGameButtonPanel.hidden = false;
  buildDecksButtonPanel.hidden = false;
  sandboxGameButtonPanel.hidden = !playgroundEnabled;
}

playGameButtonPanel.addEventListener('click', () => {
  playGameButtonPanel.hidden = true;
  buildDecksButtonPanel.hidden = true;
  sandboxGameButtonPanel.hidden = true;
  playFormatsPanel.hidden = false;
});
playEightCardsButtonPanel.addEventListener('click', () => { void queueForFormat(8); });
playTenCardsButtonPanel.addEventListener('click', () => { void queueForFormat(10); });
backFromPlayButtonPanel.addEventListener('click', returnToMainMenu);

async function startSandbox(format: 8 | 10): Promise<void> {
  if (!currentNickname || !playgroundEnabled) return;
  sandboxErrorPanel.textContent = '';
  const response = await fetch('/api/sandbox', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname, format, deckIndex: 0 })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Start playground');
  if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not start playground.');
  resumeLiveMatch(payload.match);
}

async function loadSandbox(): Promise<void> {
  if (!currentNickname || !playgroundEnabled) return;
  sandboxErrorPanel.textContent = '';
  const response = await fetch('/api/sandbox/load', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Load playground');
  if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not load playground.');
  resumeLiveMatch(payload.match);
}

async function undoSandbox(match: ServerMatchState): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/sandbox/${match.id}/undo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: currentNickname })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Undo playground action');
  if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not undo the playground action.');
  serverSelectedTroopId = undefined;
  serverSelectedAction = undefined;
  serverPendingAction = undefined;
  renderServerMatchState(payload.match);
}

sandboxGameButtonPanel.addEventListener('click', () => {
  if (!playgroundEnabled) return;
  sandboxGameButtonPanel.hidden = true;
  playGameButtonPanel.hidden = true;
  buildDecksButtonPanel.hidden = true;
  sandboxFormatsPanel.hidden = false;
});
resumeSandboxButtonPanel.addEventListener('click', () => {
  if (resumableSandbox) resumeLiveMatch(resumableSandbox);
});
sandboxEightCardsButtonPanel.addEventListener('click', () => { void startSandbox(8).catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not start playground.'; }); });
sandboxTenCardsButtonPanel.addEventListener('click', () => { void startSandbox(10).catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not start playground.'; }); });
loadSandboxButtonPanel.addEventListener('click', () => { void loadSandbox().catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not load playground.'; }); });
backFromSandboxButtonPanel.addEventListener('click', returnToMainMenu);

openMatchBoardButtonPanel.addEventListener('click', () => {
  if (!activeMatchId || !currentNickname) return;
  const matchId = activeMatchId;
  openMatchBoardButtonPanel.disabled = true;
  openMatchBoardButtonPanel.textContent = 'Ready — waiting for opponent…';
  const waitForOpponent = async (): Promise<void> => {
    const ready = await fetch(`/api/matches/${matchId}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname }) });
    if (!ready.ok) throw new Error('Could not mark this player ready.');
    const response = await fetch(`/api/matches/${matchId}`);
    const payload = await response.json() as { match?: { ready?: { 1?: boolean; 2?: boolean } } };
    if (payload.match?.ready?.[1] && payload.match?.ready?.[2]) {
      // Use the server snapshot even before the first socket message arrives.
      const state = await (await fetch(`/api/matches/${matchId}`)).json() as { match?: ServerMatchState };
      if (!state.match) throw new Error('Could not load the match state.');
      resumeLiveMatch(state.match);
      return;
    }
    window.setTimeout(() => { void waitForOpponent(); }, 1000);
  };
  void waitForOpponent().catch(error => {
    openMatchBoardButtonPanel.disabled = false;
    openMatchBoardButtonPanel.textContent = error instanceof Error ? error.message : 'Ready';
  });
});

async function initialiseApplication(): Promise<void> {
  renderDeckBuilder();
  await loadApplicationConfig();
  const savedNickname = localStorage.getItem('hex-war-nickname');
  if (!savedNickname) return;
  nicknameInputField.value = savedNickname;
  try {
    await login(savedNickname);
  } catch {
    // Keep the login form visible when the saved nickname is no longer valid.
    loginErrorPanel.textContent = 'Please log in again.';
  }
}
void initialiseApplication();
inspectorCloseButton.addEventListener('click', hideTroopInspector);
troopInspectorPanel.addEventListener('click', event => {
  if (event.target === troopInspectorPanel) hideTroopInspector();
});

document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || (target instanceof HTMLElement && target.isContentEditable)) return;
  if (serverPendingAction) {
    event.preventDefault();
    confirmServerPendingAction();
    return;
  }
  // Space also means "continue" while an optional triggered resolution is
  // waiting. Use the authoritative legal action so mandatory effects (for
  // example the Last Bell's two attacks) cannot accidentally be skipped.
  const local = localMatchPlayer;
  const skip = local && serverMatch?.pendingResolution?.owner === local
    ? serverMatch.legalActions?.[local]?.find(action => action.type === 'resolve-pass')
    : undefined;
  if (!skip) return;
  event.preventDefault();
  sendServerAction(skip);
});
