import type { UpgradableAbility } from './game/cards.js';
import { adjacentCoordinates, hexDistance, regionAt, straightLine, toCoordinate, type Coordinate } from './game/board.js';
import type { Player } from './game/types.js';
import { addDeckCard, clearDeckSlots, completedDeckFormats, createDeckSlots, moveDeckCard, removeDeckCard, selectedDeckCards, swapDeckCards, type DeckFormat, type DeckSlots } from './client/deck-state.js';
import type { GameActionType, ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './client/protocol.js';
import { boardDescriptionEntries, cardRuleDetails, catalogueById, catalogueIds, compareTroopsForTray, createTroopView, deploymentDescription, fullEffectLines, hasDeploymentTarget, healthDescription, healthOf, pushIcon, serverCardDetails, threeLineSummary, trayRoleLabel, troopDisplayName, type Troop } from './client/troop-view.js';

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
let serverInspectedUnitId: string | undefined;
let serverSelectedAction: GameActionType | undefined;
let serverPendingAction: ServerLegalAction | undefined;
let serverActionError: string | undefined;
let serverPreviewPath: Coordinate[] = [];
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
  document.body.classList.add('board-player-two');
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
  return createTroopView(cardId, owner, unit, serverMatch?.defeatedTroopIds.includes(`${owner}:${cardId}`));
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
  card.append(copy, cardVisual(troop, healthText));
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
  else sendServerAction({ type: 'deploy', troopId: dragged.troopId, coordinate });
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
  const copy = document.createElement('span');
  copy.classList.add('hover-card-copy');
  const heading = document.createElement('strong');
  heading.textContent = troopDisplayName(troop);
  copy.append(heading);
  card.append(copy, cardVisual(troop, healthDescription(troop)));
  return { card, copy };
}

function appendHoverRules(copy: HTMLElement, troop: Troop): void {
  const list = document.createElement('div');
  list.classList.add('hover-rule-list');
  for (const [index, rule] of cardRuleDetails(troop).entries()) {
    const line = document.createElement('div');
    line.classList.add('hover-rule-line');
    if (index === 0) line.classList.add('hover-deployment-rule');
    line.textContent = rule;
    list.append(line);
  }
  copy.append(list);
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

function isServerLastActing(owner: Player, troopId: string): boolean {
  return serverMatch?.lastActingTroopId?.[owner] === troopId;
}

function selectServerTroop(troopId: string): void {
  if (!serverMatch || !localMatchPlayer || serverMatch.winner || serverMatch.activePlayer !== localMatchPlayer || isServerLastActing(localMatchPlayer, troopId)) return;
  const isInDeck = serverMatch.decks[localMatchPlayer].includes(troopId);
  if (!isInDeck || serverMatch.defeatedTroopIds.includes(`${localMatchPlayer}:${troopId}`)) return;
  serverActionError = undefined;
  serverInspectedUnitId = undefined;
  serverSelectedTroopId = serverSelectedTroopId === troopId ? undefined : troopId;
  serverSelectedAction = undefined;
  serverPendingAction = undefined;
  sendServerSelection(serverSelectedTroopId);
  renderServerMatchState(serverMatch);
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
    cell.classList.remove('server-controlled-one', 'server-controlled-two', 'server-contested', 'server-selected', 'server-selected-one', 'server-selected-two', 'server-last-acting', 'server-action-highlight', 'server-action-highlight-one', 'server-action-highlight-two', 'server-pending-target', 'server-pending-target-one', 'server-pending-target-two', 'server-remote-pending-target', 'server-reachable', 'server-bash-target');
    cell.removeAttribute('tabindex');
    cell.removeAttribute('role');
    cell.removeAttribute('aria-label');
  }
}

function serverRegionController(match: ServerMatchState, coordinate: Coordinate): Player | undefined {
  const regionId = regionAt(coordinate)?.id;
  return regionId ? match.control[regionId]?.controller : undefined;
}
/**
 * The board is permanently rotated into its Blue-bottom view. Counter-rotate
 * each overlay about its hex centre so artwork and statistics remain upright.
 */
function keepServerOverlayUpright(element: SVGElement, centre: Point): void {
  element.setAttribute('transform', `rotate(180 ${centre.x} ${centre.y})`);
}
function appendServerBoardUnit(unit: ServerUnitState): void {
  const target = cellsByCoordinate.get(unit.coordinate); const troop = serverTroop(unit.troopId, unit.owner, unit);
  if (!target || !troop) return;
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.setAttribute('aria-label', `${troopDisplayName(troop)}, Player ${unit.owner}`);
  const marker = boardTroopIcon(troop.role, unit.owner, target.position.x, target.position.y + 21, 23); marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
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
  // Every overlay uses the same fixed Blue-bottom placement as the icon and
  // is counter-rotated so its text stays upright.
  const highlightedAction = unit.owner === localMatchPlayer && unit.troopId === serverSelectedTroopId ? serverSelectedAction : undefined;
  const latestAction = serverMatch?.events?.at(-1);
  const newlyDeployed = latestAction?.action.type === 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId;
  const persistedAction = latestAction && serverMatch?.activePlayer !== latestAction.player
    && latestAction.action.type !== 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId
    ? latestAction.action.type : undefined;
  const descriptionAction = highlightedAction ?? persistedAction;
  const showSelfBlock = descriptionAction === 'self-defense';
  const pendingSelfBlock = descriptionAction === 'self-defense' && serverPendingAction?.type === 'self-defense';
  appendServerActionDescriptionHighlight(target.cell, troop, target.position, descriptionAction, newlyDeployed, showSelfBlock, pendingSelfBlock);
  const description = document.createElementNS(ns, 'text'); description.dataset.serverRender = 'description'; description.classList.add('board-troop-description'); writeServerBoardDescription(description, troop, target.position, showSelfBlock, descriptionAction === 'move');
  keepServerOverlayUpright(description, target.position);
  target.cell.append(marker, description);
}

function appendServerBash(bash: ServerBashState, showSplitBorder = true): void {
  if (!serverMatch) return;
  const target = cellsByCoordinate.get(bash.target); const attacker = serverMatch.units.find(unit => unit.id === bash.attackerId); const defender = serverMatch.units.find(unit => unit.id === bash.defenderId);
  if (!target || !attacker || !defender) return;
  const attackerTroop = serverTroop(attacker.troopId, attacker.owner, attacker);
  const defenderTroop = serverTroop(defender.troopId, defender.owner, defender);
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.setAttribute('aria-label', `${attackerTroop ? troopDisplayName(attackerTroop) : attacker.troopId} versus ${defenderTroop ? troopDisplayName(defenderTroop) : defender.troopId}`);
  if (showSplitBorder) {
    // The normal region-edge overlay is appended last.  Hide it on a bash so
    // it cannot paint a full control-colour outline over the two half-borders.
    target.cell.classList.add('server-bash-target');
    const vertex = (index: number): Point => {
      const angle = (60 * index - 30) * Math.PI / 180;
      return { x: target.position.x + (size - hexGap) * Math.cos(angle), y: target.position.y + (size - hexGap) * Math.sin(angle) };
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
    const control = serverRegionController(serverMatch, bash.target);
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
  const sword = document.createElementNS(ns, 'text');
  sword.dataset.serverRender = 'bash'; sword.classList.add('bash-icon');
  sword.setAttribute('x', String(target.position.x)); sword.setAttribute('y', String(target.position.y + 5)); sword.textContent = '⚔️';
  keepServerOverlayUpright(sword, target.position);
  target.cell.append(sword);
  for (const unit of [attacker, defender]) {
    const statY = target.position.y + (unit.owner === 2 ? 24 : -18);
    const stat = document.createElementNS(ns, 'text'); stat.dataset.serverRender = 'bash'; stat.classList.add('bash-stat', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash'); stat.setAttribute('x', String(target.position.x)); stat.setAttribute('y', String(statY)); stat.textContent = `${unit.combat.health} + ${unit.combat.modifier}`;
    keepServerOverlayUpright(stat, target.position);
    target.cell.append(stat);
  }
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

function renderServerMatchState(match: ServerMatchState): void {
  // A new revision is an authoritative action (or sandbox placement), not a
  // local selection echo. Clear the previous side's card/action before control
  // passes; both fixed trays share card IDs across their separate owners.
  const stateAdvanced = serverMatch?.id === match.id && serverMatch.revision !== match.revision;
  if (stateAdvanced) {
    serverSelectedTroopId = undefined;
    serverSelectedAction = undefined;
    serverPendingAction = undefined;
    serverInspectedUnitId = undefined;
    clearServerPreviewPath();
  }
  serverMatch = match;
  const local = applyLocalPlayerView(match); if (!local) return;
  gameLayoutPanel.classList.remove('deck-building');
  if (match.winner || match.activePlayer !== local) { serverSelectedTroopId = undefined; serverSelectedAction = undefined; serverPendingAction = undefined; clearServerPreviewPath(); }
  const selectedActions = match.selections?.[local] === serverSelectedTroopId ? match.legalActions?.[local] ?? [] : [];
  const actionTypes = new Set(selectedActions.map(action => action.type));
  if (serverSelectedTroopId && selectedActions.length > 0 && (!serverSelectedAction || !actionTypes.has(serverSelectedAction))) {
    serverSelectedAction = (['deploy', 'move', 'fly'] as const).find(type => actionTypes.has(type)) ?? selectedActions[0]?.type;
  }
  renderServerTray(2, playerTwoCardsPanel, local === 2);
  renderServerTray(1, playerOneCardsPanel, local === 1);
  clearServerBoardRender();
  for (const [coordinate, { cell }] of cellsByCoordinate) {
    const controller = serverRegionController(match, coordinate);
    cell.classList.add(controller === 1 ? 'server-controlled-one' : controller === 2 ? 'server-controlled-two' : 'server-contested');
  }
  const bashingIds = new Set(match.bashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  for (const unit of match.units) if (!bashingIds.has(unit.id)) appendServerBoardUnit(unit);
  for (const effect of match.effects) {
    if (effect.kind === 'attack' || effect.kind === 'cannon' || effect.kind === 'magic') {
      // The acting player's fill communicates pending damage without adding a
      // second, side-positioned damage label to the hex.
      cellsByCoordinate.get(effect.target)?.cell.classList.add('server-action-highlight', effect.owner === 1 ? 'server-action-highlight-one' : 'server-action-highlight-two');
    }
  }
  const latestEvent = match.events?.at(-1);
  if (latestEvent?.origin && ['move', 'fly', 'push'].includes(latestEvent.action.type)) {
    cellsByCoordinate.get(latestEvent.origin)?.cell.classList.add('server-action-highlight', latestEvent.player === 1 ? 'server-action-highlight-one' : 'server-action-highlight-two');
  }
  for (const bash of match.bashes) appendServerBash(bash);
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
  serverInspectedUnitId = undefined;
  clearServerPreviewPath();
  sendServerSelection(undefined);
  renderServerMatchState(serverMatch);
}

function sendServerSelection(troopId: string | undefined, target?: { type: GameActionType; coordinate: Coordinate }): void {
  if (!serverMatch || !matchSocket || matchSocket.readyState !== WebSocket.OPEN) return;
  matchSocket.send(JSON.stringify({ type: 'select', matchId: serverMatch.id, troopId, target }));
}

function sendServerAction(action: { type: GameActionType; troopId?: string; coordinate?: Coordinate; destination?: Coordinate; ability?: UpgradableAbility }): void {
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

function performServerActionAt(coordinate: Coordinate): void {
  if (!serverMatch || serverMatch.winner || !localMatchPlayer || !serverSelectedTroopId || !serverSelectedAction || serverMatch.activePlayer !== localMatchPlayer) return;
  if (serverSelectedAction === 'self-defense') return;
  const candidates = selectedServerLegalActions().filter(action => action.type === serverSelectedAction && action.coordinate === coordinate);
  const action = candidates[0];
  if (!action) return;
  if (action.type === 'deploy') {
    serverPendingAction = undefined;
    sendServerAction(action);
    return;
  }
  serverPendingAction = action.type === 'upgrade'
    ? { type: action.type, troopId: action.troopId, coordinate: action.coordinate }
    : { ...action };
  sendServerSelection(serverSelectedTroopId, { type: serverSelectedAction, coordinate });
  renderServerMatchState(serverMatch);
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
  const bash = serverMatch.bashes.find(item => item.target === coordinate);
  const units = bash
    ? [serverMatch.units.find(unit => unit.id === bash.attackerId), serverMatch.units.find(unit => unit.id === bash.defenderId)]
    : [serverMatch.units.find(unit => unit.coordinate === coordinate)];
  const displayed = units.filter((unit): unit is ServerUnitState => unit !== undefined);
  if (displayed.length === 0) return;
  hoverDetailsPanel.replaceChildren();
  // Match the fixed board layout: Red is described first, then Blue.
  for (const unit of displayed.sort((left, right) => left.owner - right.owner)) {
    const troop = serverTroop(unit.troopId, unit.owner, unit); if (!troop) continue;
    const { card, copy } = createHoverCard(troop);
    if (bash) {
      const combat = document.createElement('div'); combat.classList.add('hover-detail-line'); combat.textContent = `Bash strength: ${unit.combat.health} + ${unit.combat.modifier} = ${unit.combat.total}`; copy.append(combat);
      for (const entry of unit.combat.modifiers) {
        const source = document.createElement('div'); source.classList.add('hover-detail-line'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; copy.append(source);
      }
    }
    appendHoverRules(copy, troop);
    hoverDetailsPanel.append(card);
  }
  hoverDetailsPanel.hidden = false;
}

function renderServerActionTargets(): void {
  for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('action-target', 'push-target', 'deployment-target', 'region-target', 'server-pending-target', 'server-reachable');
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
  if (serverPendingAction?.coordinate) cellsByCoordinate.get(serverPendingAction.coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
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

const serverActionLabels: Record<GameActionType, string> = {
  deploy: 'Deploy',
  move: '🥾 Move',
  fly: '🪽 Fly',
  attack: '🏹 Attack',
  cannon: '🧨 Cannon',
  push: `${pushIcon} Push`,
  magic: '🔥 Magic',
  mending: '❤️ Mend',
  upgrade: '🔮 Upgrade',
  defense: '🛡️ Block',
  'self-defense': '🛡️ Self block',
  pass: 'Pass turn'
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
    const menu = document.createElement('button');
    menu.type = 'button'; menu.textContent = 'Back to menu';
    menu.addEventListener('click', () => {
      resumableSandbox = match;
      resumeSandboxButtonPanel.hidden = false;
      mainPanel.hidden = true;
      menuScreenPanel.hidden = false;
      returnToMainMenu();
    });
    tools.append(freePlacement, save, load, menu); actionBarPanel.append(tools);
  }
  const message = document.createElement('span');
  if (match.winner) message.textContent = `Player ${match.winner === 1 ? '1 / Red' : '2 / Blue'} wins.`;
  else if (serverActionError) message.textContent = serverActionError;
  else message.textContent = match.activePlayer === local ? 'Your turn.' : `Opponent's turn — Player ${match.activePlayer === 1 ? '1 / Red' : '2 / Blue'}.`;
  actionBarPanel.append(message);
  if (match.sandbox && match.activePlayer === local && !match.winner) {
    const pass = document.createElement('button');
    pass.type = 'button'; pass.textContent = 'Pass turn';
    pass.addEventListener('click', () => sendServerAction({ type: 'pass' }));
    actionBarPanel.append(pass);
  }
  const unit = selectedServerUnit();
  if (!serverSelectedTroopId || match.activePlayer !== local || match.winner) return;
  const legalActions = selectedServerLegalActions();
  if (!unit) {
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
    const orderedTypes: GameActionType[] = ['move', 'fly', 'attack', 'cannon', 'push', 'defense', 'self-defense', 'magic', 'mending', 'upgrade'];
    for (const type of orderedTypes.filter(candidate => availableTypes.has(candidate))) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = serverActionLabel(type); button.classList.toggle('active-action', serverSelectedAction === type);
      button.addEventListener('click', () => {
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
  actionBarPanel.append(cancel);
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
const center: Point = { x: 400, y: 310 };

function axialToPixel(x: number, y: number): Point {
  return {
    x: center.x + Math.sqrt(3) * size * (x - y / 2),
    y: center.y + 1.5 * size * y
  };
}

function hexPoints(cx: number, cy: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index - 30) * Math.PI / 180;
    return `${cx + (size - hexGap) * Math.cos(angle)},${cy + (size - hexGap) * Math.sin(angle)}`;
  }).join(' ');
}

/** Place a server-rendered description using the shared board orientation. */
function writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock = false, revealMoveOne = false): void {
  marker.replaceChildren();
  const lines = boardDescriptionEntries(troop, includeSelfBlock, revealMoveOne);
  const firstLineY = position.y - (lines.length > 3 ? 27 : 22);
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(ns, 'tspan');
    row.setAttribute('x', String(position.x));
    row.setAttribute('y', String(firstLineY + index * 11));
    if (index === 0 && line.text.includes('♥')) row.classList.add('board-health');
    if (line.upgraded) row.classList.add('upgraded-effect');
    row.textContent = line.text;
    marker.append(row);
  }
}

function appendServerActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action?: GameActionType, highlightLife = false, includeSelfBlock = false, negativeSelfBlock = false): void {
  const relevantAction = action === 'self-defense' && includeSelfBlock ? 'self-defense' : action === 'self-defense' ? 'defense' : action;
  // Life has no action tag. Do not let an absent selection accidentally
  // match it; it is highlighted only for a troop just deployed this turn.
  if (!highlightLife && !relevantAction) return;
  const entries = boardDescriptionEntries(troop, includeSelfBlock, relevantAction === 'move');
  const index = highlightLife ? 0 : entries.findIndex(line => line.action === relevantAction);
  if (index < 0) return;
  const line = entries[index];
  const firstLineY = position.y - (entries.length > 3 ? 27 : 22);
  const rect = document.createElementNS(ns, 'rect');
  rect.dataset.serverRender = 'description-highlight';
  rect.classList.add('action-description-highlight', troop.owner === 1 ? 'player-one-highlight' : 'player-two-highlight');
  if (negativeSelfBlock) rect.classList.add('self-block-pending-highlight');
  const width = Math.min(72, Math.max(18, line.text.length * 7.4 + 8));
  rect.setAttribute('x', String(position.x - width / 2));
  rect.setAttribute('y', String(firstLineY + index * 11 - 9));
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

    cell.append(clip, hex, label);
    cell.addEventListener('pointerenter', () => {
      if (serverMatch) { showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
    });
    cell.addEventListener('pointerleave', () => { hideHoverDetails(); if (serverMatch) clearServerPreviewPath(); });
    cell.addEventListener('focus', () => {
      if (serverMatch) { showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
    });
    cell.addEventListener('blur', () => { hideHoverDetails(); if (serverMatch) clearServerPreviewPath(); });
    if (!isCenter) {
      let longPressTimer: number | undefined;
      const cancelLongPress = (): void => {
        if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      };
      cell.addEventListener('pointerdown', () => {
        cancelLongPress();
        longPressTimer = window.setTimeout(() => {
          showTroopInspector(coordinate);
          longPressTimer = undefined;
        }, 600);
      });
      cell.addEventListener('pointerup', cancelLongPress);
      cell.addEventListener('pointerleave', cancelLongPress);
      cell.addEventListener('dblclick', () => showTroopInspector(coordinate));
      cell.addEventListener('click', () => {
        if (!serverMatch) return;
        // Any legal action target owns the click before a friendly unit can
        // be selected. This keeps Block, Mend, and Upgrade targets usable.
        if (serverSelectedTroopId && cell.classList.contains('action-target')) {
          performServerActionAt(coordinate);
          return;
        }
        const unit = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
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
  if (event.code !== 'Space' || event.repeat || !serverPendingAction) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || (target instanceof HTMLElement && target.isContentEditable)) return;
  event.preventDefault();
  confirmServerPendingAction();
});
