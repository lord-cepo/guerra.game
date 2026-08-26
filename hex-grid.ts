import type { UpgradableAbility } from './game/cards.js';
import { adjacentCoordinates, hexDistance, regionAt, straightLine, toCoordinate, type Coordinate, type RegionId } from './game/board.js';
import type { Player } from './game/types.js';
import { addDeckCard, clearDeckSlots, completedDeckFormats, createDeckSlots, moveDeckCard, removeDeckCard, selectedDeckCards, swapDeckCards, type DeckFormat, type DeckSlots } from './client/deck-state.js';
import type { GameActionType, ServerBashState, ServerEffectState, ServerLegalAction, ServerMatchState, ServerTriggerEvent, ServerUnitState } from './client/protocol.js';
import { actionOfType, boardDescriptionEntries, cardRuleDetails, catalogueById, catalogueIds, compareTroopsForTray, createTroopView, deploymentDescription, fullEffectLines, goreIcon, hasDeploymentTarget, healthDescription, healthOf, permanentUpgradeBonus, pullIcon, pushIcon, rangedDamage, serverCardDetails, staticAuraBonus, stunIcon, threeLineSummary, trayRoleLabel, troopDisplayName, upgradeBonus, type Troop } from './client/troop-view.js';

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
const deploymentAnimationStartTimes = new Map<string, number>();
let confirmedDeploymentAnimationRevision: number | undefined;
let confirmedBashAnimationRevision: number | undefined;
let confirmedMovementAnimationRevision: number | undefined;
let confirmedDefenseAnimationRevision: number | undefined;
let confirmedMendingAnimationRevision: number | undefined;
let replayingLastTurn = false;
let lastTurnReplayBefore: ServerMatchState | undefined;
let lastTurnReplayAfter: ServerMatchState | undefined;
const confirmedBombTrajectorySources = new Map<string, Coordinate>();
const playedConfirmedBombHeads = new Set<string>();
const confirmedUpgradeTrajectorySources = new Map<string, Coordinate>();
const playedConfirmedUpgradeHeads = new Set<string>();
const confirmedBombArrivalTimes = new Map<string, number>();
const bombIgnitionArrivalTimes = new Map<string, number>();
const playedConfirmedBombIgnitions = new Set<string>();
const physicalModifierArrivalTimes = new Map<string, number>();
const projectileAnimationStartTimes = new Map<string, number>();
const stunAnimationStartTimes = new Map<string, number>();
interface DamageResolutionAnimation {
  targetId: string;
  troopId: string;
  coordinate: Coordinate;
  owner: Player;
  oldHealth: number;
  newHealth: number;
  totalHealth: number;
  oldModifier: number;
  physicalDamage: number;
  includesPhysical: boolean;
  ignoresModifier: boolean;
  delay: number;
  killed: boolean;
  bashSide?: 'left' | 'right';
}
interface BashResolutionAnimation {
  bash: ServerBashState;
  attacker: ServerUnitState;
  defender: ServerUnitState;
  winnerId?: string;
  delay: number;
  firstStrike?: NonNullable<ServerTriggerEvent['firstStrike']>;
}
let damageResolutionAnimations: DamageResolutionAnimation[] = [];
let explosionResolutionCoordinates: Coordinate[] = [];
let explosionAffectedCoordinates: Coordinate[] = [];
let explosionResolutionDelay = 0;
let bashResolutionAnimations: BashResolutionAnimation[] = [];
let replayResolvedProjectiles: ServerProjectile[] = [];
let playedPreviewMendingSweepKey: string | undefined;
const bashHoverTimers = new WeakMap<SVGGElement, number>();
let lastMovementInspection: { key: string; eventIndex: number; actor: Player; unitId: string; hoverCoordinate: Coordinate; origin: Coordinate; destination: Coordinate; type: 'move' | 'fly' | 'push' | 'pull'; progress: number; direction: -1 | 1; changedAt: number } | undefined;
let lastDeploymentInspection: { key: string; eventIndex: number; actor: Player; unitId: string; coordinate: Coordinate; progress: number; direction: -1 | 1; changedAt: number } | undefined;
const armedRewindInspections = new Set<string>();
let serverInspectedUnitId: string | undefined;
let serverSelectedAction: GameActionType | undefined;
let serverPendingAction: ServerLegalAction | undefined;
let queuedMovementPreviewOrigin: { unitId: string; coordinate: Coordinate; wasBash: boolean; destination: Coordinate } | undefined;
let queuedMovementPreviewReturn: { unitId: string; coordinate: Coordinate; wasBash: boolean } | undefined;
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
const shieldFrameUrls = Array.from({ length: 7 }, (_, index) => `./assets/shield-${index}.png`);
// Shield frames have short, discrete display windows. Retain the preload
// images and wait for decoded pixels before the app becomes interactive;
// merely assigning `src` can leave the first 150 ms frame decoding on demand.
const shieldFramePreloads = shieldFrameUrls.map(url => {
  const image = new Image();
  image.src = url;
  return image;
});
const shieldFramesReady = Promise.all(shieldFramePreloads.map(image => image.decode().catch(() => undefined)));
const slashPreload = new Image();
slashPreload.src = './assets/slash.png';
const skullPreload = new Image();
skullPreload.src = './assets/skull.png';
const skullReady = skullPreload.decode().catch(() => undefined);
let playableDeckFormats = new Set<DeckFormat>();
let deckSlots: DeckSlots = createDeckSlots();
let deckBuilderDirty = false;
let deckBuilderNotice: string | undefined;
let deckBuilderSearch = '';
let deckBuilderSearchInput: HTMLInputElement | undefined;
let busyOperationCount = 0;

/** Keep slow HTTP-backed operations visible without letting overlapping work
 * clear the cursor while another request is still pending. */
async function withBusyCursor<T>(operation: () => Promise<T>): Promise<T> {
  busyOperationCount += 1;
  document.documentElement.classList.add('app-busy');
  document.documentElement.setAttribute('aria-busy', 'true');
  try {
    return await operation();
  } finally {
    busyOperationCount -= 1;
    if (busyOperationCount === 0) {
      document.documentElement.classList.remove('app-busy');
      document.documentElement.removeAttribute('aria-busy');
    }
  }
}

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
  deploymentAnimationStartTimes.clear();
  confirmedDeploymentAnimationRevision = undefined;
  confirmedBashAnimationRevision = undefined;
  confirmedMovementAnimationRevision = undefined;
  confirmedDefenseAnimationRevision = undefined;
  confirmedMendingAnimationRevision = undefined;
  confirmedBombTrajectorySources.clear();
  playedConfirmedBombHeads.clear();
  confirmedUpgradeTrajectorySources.clear();
  playedConfirmedUpgradeHeads.clear();
  confirmedBombArrivalTimes.clear();
  bombIgnitionArrivalTimes.clear();
  playedConfirmedBombIgnitions.clear();
  physicalModifierArrivalTimes.clear();
  projectileAnimationStartTimes.clear();
  stunAnimationStartTimes.clear();
  replayingLastTurn = false;
  lastTurnReplayBefore = undefined;
  lastTurnReplayAfter = undefined;
  damageResolutionAnimations = [];
  explosionResolutionCoordinates = [];
  explosionAffectedCoordinates = [];
  explosionResolutionDelay = 0;
  bashResolutionAnimations = [];
  replayResolvedProjectiles = [];
  playedPreviewMendingSweepKey = undefined;
  lastMovementInspection = undefined;
  lastDeploymentInspection = undefined;
  armedRewindInspections.clear();
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
  // ServerUnitState.currentHealth is the authoritative post-resolution value.
  // Derive the view damage from it so the normal N ♥ M row cannot fall back
  // to total health when persisted damage metadata arrives out of sync.
  if (troop && unit) troop.permanentDamage = Math.max(0, troop.baseHealth - unit.currentHealth);
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

function cardHealthDescription(troop: Troop): string {
  const current = healthOf(troop);
  return current === troop.baseHealth ? `♥ ${troop.baseHealth}` : healthDescription(troop);
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
  card.append(artwork, copy, cardVisual(troop, cardHealthDescription(troop)), frame);
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
  const match = rule.match(/^(\d+)([PF]*)(🏹|🔥|🛡️|🧨|💣|❤️|🫸)(\d+)(.*)$/u);
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
  const ability = match[3] === '🏹' ? 'attack' : match[3] === '🔥' ? 'magic' : match[3] === '🛡️' ? 'defense' : match[3] === '🧨' ? 'cannon' : match[3] === goreIcon ? 'gore' : match[3] === '💣' ? 'bomb' : match[3] === '❤️' ? 'mending' : match[3] === pullIcon ? 'pull' : match[3] === stunIcon ? 'stun' : 'push';
  const temporary = upgradeBonus(troop, ability);
  const aura = ability === 'attack' || ability === 'magic' ? staticAuraBonus(troop, ability) : { left: 0, right: 0 };
  const permanent = ability === 'attack' || ability === 'magic' ? permanentUpgradeBonus(troop, ability) : { left: 0, right: 0 };
  const magenta = { left: aura.left + permanent.left, right: aura.right + permanent.right };
  const totalLeft = Number(match[1]); const totalRight = Number(match[4]);
  const baseLeft = totalLeft - temporary.left - magenta.left; const baseRight = totalRight - temporary.right - magenta.right;
  const bonus = (value: number, className: string): void => {
    if (!value) return;
    const span = document.createElement('span'); span.classList.add(className); span.textContent = `+${value}`; line.append(span);
  };
  line.append(document.createTextNode(String(baseLeft)));
  bonus(temporary.left, 'temporary-upgrade'); bonus(magenta.left, 'static-upgrade');
  line.append(document.createTextNode(`${match[2]}${match[3]}`));
  line.append(document.createTextNode(String(baseRight)));
  bonus(temporary.right, 'temporary-upgrade'); bonus(magenta.right, 'static-upgrade');
  appendBoldHoverCopy(line, match[5]);
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

function isServerInactive(owner: Player, troopId: string): boolean {
  const unit = serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === troopId);
  return isServerLastActing(owner, troopId) || (unit?.stunnedTurns ?? 0) > 0;
}

function appendInactiveTroopWash(parent: SVGGElement, position: Point, clipId?: string): void {
  const wash = document.createElementNS(ns, 'polygon');
  wash.classList.add('inactive-troop-wash');
  wash.setAttribute('points', hexPoints(position.x, position.y));
  if (clipId) wash.setAttribute('clip-path', `url(#${clipId})`);
  parent.append(wash);
}

function selectServerTroop(troopId: string): void {
  if (!serverMatch || !localMatchPlayer || serverMatch.winner || serverMatch.activePlayer !== localMatchPlayer || isServerInactive(localMatchPlayer, troopId)) return;
  const isInDeck = serverMatch.decks[localMatchPlayer].includes(troopId);
  if (!isInDeck || serverMatch.defeatedTroopIds.includes(`${localMatchPlayer}:${troopId}`)) return;
  serverActionError = undefined;
  serverInspectedUnitId = undefined;
  queuedMovementPreviewOrigin = undefined;
  const selecting = serverSelectedTroopId !== troopId;
  if (selecting) {
    redirectMovementInspection(1);
    redirectDeploymentInspection(1);
  }
  // Keep the current target set in place until the server returns the next
  // one. This lets CSS transition directly between the two sets instead of
  // briefly lowering every legal hex and raising the replacement set later.
  serverRequestedTroopId = serverSelectedTroopId === troopId ? undefined : troopId;
  if (serverRequestedTroopId === undefined) queueCurrentMovementPreviewReturn();
  else queuedMovementPreviewReturn = undefined;
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
  const lastActing = isServerInactive(owner, cardId);
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
  appendTroopCardContent(card, troop, details, cardHealthDescription(troop));
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
  boardPanel.querySelectorAll<SVGElement>('[data-server-render]:not([data-server-render="death-animation"]), .board-troop:not(.death-resolution-card), .board-troop-description, .action-land, .bash-stat, .bash-icon').forEach(element => element.remove());
  clearServerPreviewPath();
  for (const { cell } of cellsByCoordinate.values()) {
    cell.classList.remove('server-controlled-one', 'server-controlled-two', 'server-contested', 'server-occupied', 'server-selected', 'server-selected-one', 'server-selected-two', 'server-last-acting', 'server-action-highlight', 'server-action-highlight-one', 'server-action-highlight-two', 'server-pending-target', 'server-pending-target-one', 'server-pending-target-two', 'server-pending-deployment', 'server-remote-pending-target', 'server-reachable', 'server-bash-target', 'bash-entering', 'bash-focus-left', 'bash-focus-right', 'damage-resolving', 'bash-resolving');
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

function serverPreviewMagicBlock(unit: ServerUnitState, coordinate: Coordinate): number {
  return serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'magic-defense' || target.type === 'self-magic-defense'))
    .reduce((sum, { owner, target }) => {
      const source = serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const defense = troop ? actionOfType(troop, 'magic-defense') : undefined;
      const value = target.type === 'self-magic-defense'
        ? (troop?.selfMagicDefense ?? 0) + (troop ? upgradeBonus(troop, 'self-magic-defense').left : 0)
        : (defense?.block ?? 0) + (troop ? upgradeBonus(troop, 'magic-defense').left : 0);
      return sum + value;
    }, 0);
}

function serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): Array<{ label: string; value: number }> {
  if (!serverMatch) return [];
  if (serverBashHasSteadyOpponent(unit, bash)) return [];
  const entries: Array<{ label: string; value: number }> = [];
  const confirmedShields = unit.shields ?? [];
  const confirmedBlock = confirmedShields.reduce((sum, shield) => sum + shield.value, 0);
  const previewBlock = serverPreviewBlock(unit, coordinate);
  const block = confirmedBlock + previewBlock;
  if (block) entries.push({ label: 'Shield', value: block });
  const previewShieldSources = serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .map(({ owner, target }) => serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId))
    .filter((source): source is ServerUnitState => Boolean(source));
  const shieldedByAlly = confirmedShields.some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unit.id)
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
    const confirmedShields = unit.shields ?? [];
    const previewAllyShield = serverPreviewTargets()
      .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
      .some(({ owner, target }) => serverMatch?.units.some(source => source.owner === owner && source.troopId === target.troopId && source.id !== unit.id));
    const newlyShieldedPenalty = unit.troopId === 'marsh-badger' && confirmedShields.length === 0 ? -1 : 0;
    const alreadyShieldedByAlly = confirmedShields.some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unit.id);
    const newlySupportedBonus = unit.troopId === 'river-otter' && previewAllyShield && !alreadyShieldedByAlly ? 1 : 0;
    return unit.combat.modifier + previewBlock + newlyShieldedPenalty + newlySupportedBonus;
  }
  return serverModifierEntries(unit, coordinate, bash).reduce((total, entry) => total + entry.value, 0);
}

function serverModifierText(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): string {
  const physical = serverModifier(unit, coordinate, bash);
  const magic = unit.combat.magicModifier + serverPreviewMagicBlock(unit, coordinate);
  if (!magic) return signedModifier(physical);
  if (!physical) return signedModifier(magic);
  return `${signedModifier(physical)}${signedModifier(magic)}`;
}

function appendMagicShieldIcon(parent: SVGGElement, position: Point, x: number, y: number): void {
  const icon = document.createElementNS(ns, 'text');
  icon.dataset.serverRender = 'magic-shield-icon';
  icon.classList.add('magic-shield-icon');
  icon.setAttribute('x', String(x));
  icon.setAttribute('y', String(y));
  icon.textContent = '🛡️';
  keepServerOverlayUpright(icon, position);
  parent.append(icon);
}

function appendServerBoardUnit(unit: ServerUnitState, transition?: 'move-out' | 'move-in' | 'move-inspect-origin' | 'move-inspect-destination' | 'push-in' | 'push-out' | 'push-inspect' | 'deploy-out' | 'deploy-in', transitionOrigin?: Coordinate, transitionHalf?: 'left' | 'right'): void {
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
  if (transition
    && transition !== 'deploy-in'
    && transition !== 'deploy-out'
    && transition !== 'push-inspect'
    && transition !== 'move-inspect-origin'
    && transition !== 'move-inspect-destination') visual.classList.add(`troop-${transition}-animation`);
  if (transitionHalf) visual.classList.add('bash-transition-source');
  if ((transition === 'push-in' || transition === 'push-out' || transition === 'push-inspect') && transitionOrigin) {
    const origin = cellsByCoordinate.get(transitionOrigin)?.position;
    if (origin) {
      visual.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
      visual.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
    }
  }
  const marker = boardCardMarker(troop, target.position, target.cell.dataset.clipId);
  marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
  if (transitionHalf) marker.classList.add(transitionHalf === 'left' ? 'bash-left-picture' : 'bash-right-picture');
  if (serverMatch?.sandboxFreePlacement) {
    marker.classList.add('sandbox-draggable');
    enablePointerBoardDrag(marker, troop, { owner: unit.owner, troopId: unit.troopId, mode: 'free' });
  }
  keepServerOverlayUpright(marker, target.position);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  if (isServerInactive(unit.owner, unit.troopId)) {
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
    && (replayingLastTurn || unit.owner !== localMatchPlayer)
    && serverMatch?.revision === confirmedDeploymentAnimationRevision;
  const deploymentAnimationKey = deploymentPreview
    ? `preview:${unit.owner}:${unit.troopId}:${unit.coordinate}`
    : confirmedForOpponent
      ? `confirmed:${serverMatch?.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`
      : undefined;
  if (deploymentAnimationKey) {
    let startedAt = deploymentAnimationStartTimes.get(deploymentAnimationKey);
    if (startedAt === undefined && !playedDeploymentAnimations.has(deploymentAnimationKey)) {
      startedAt = performance.now();
      deploymentAnimationStartTimes.set(deploymentAnimationKey, startedAt);
      playedDeploymentAnimations.add(deploymentAnimationKey);
      window.setTimeout(() => deploymentAnimationStartTimes.delete(deploymentAnimationKey), deploymentAnimationDuration);
    }
    if (startedAt !== undefined) {
      const elapsed = performance.now() - startedAt;
      if (elapsed < deploymentAnimationDuration) {
        visual.classList.add('deploy-fall-animation');
        visual.style.animationDelay = `${-elapsed}ms`;
      }
    }
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
  const showSelfBlock = descriptionAction === 'self-defense' || descriptionAction === 'self-magic-defense';
  const pendingSelfBlock = showSelfBlock && (serverPendingAction?.type === 'self-defense' || serverPendingAction?.type === 'self-magic-defense');
  const displayedModifier = serverModifierText(unit, unit.coordinate);
  // The unit remains one rigid animated object, but the transparent ornamental
  // PNG is painted after it so the hand-drawn hex edge stays above the card.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  visual.append(marker);
  if (isServerInactive(unit.owner, unit.troopId)) appendInactiveTroopWash(visual, target.position, target.cell.dataset.clipId);
  appendBoardInfoFrame(visual, troop, target.position);
  appendServerActionDescriptionHighlight(visual, troop, target.position, descriptionAction, newlyDeployed, showSelfBlock, pendingSelfBlock, ignitionDamage, displayedModifier);
  const description = document.createElementNS(ns, 'text');
  description.dataset.serverRender = 'description';
  description.classList.add('board-troop-description');
  writeServerBoardDescription(description, troop, target.position, showSelfBlock, descriptionAction === 'move', ignitionDamage, displayedModifier, undefined, unit.combat.magicModifier);
  keepServerOverlayUpright(description, target.position);
  visual.append(description);
  if (unit.combat.magicModifier) appendMagicShieldIcon(visual, target.position, target.position.x + 27, boardDescriptionLineY(target.position, 4, 1) + 4);
  target.cell.append(visual);
  if ((transition === 'move-inspect-origin' || transition === 'move-inspect-destination') && lastMovementInspection?.unitId === unit.id) {
    const progress = movementInspectionProgress(lastMovementInspection);
    const targetProgress = lastMovementInspection.direction === 1 ? 1 : 0;
    const distance = Math.abs(targetProgress - progress);
    const originVisual = transition === 'move-inspect-origin';
    const frame = (value: number): Keyframe => originVisual
      ? { opacity: 1 - value, translate: `0 ${55 * value}px` }
      : { opacity: value, translate: `0 ${55 * (1 - value)}px` };
    const timeline = visual.animate([frame(progress), frame(targetProgress)], {
      duration: Math.max(1, movementAnimationDuration * distance),
      easing: 'cubic-bezier(.2, .72, .3, 1)',
      fill: 'both',
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timeline.finish();
      timeline.pause();
    } else if (distance === 0) timeline.pause();
  }
  if (transition === 'push-inspect' && lastMovementInspection?.unitId === unit.id) {
    const origin = cellsByCoordinate.get(lastMovementInspection.origin)?.position;
    if (origin) {
      const fromX = origin.x - target.position.x;
      const fromY = origin.y - target.position.y;
      const progress = movementInspectionProgress(lastMovementInspection);
      const targetProgress = lastMovementInspection.direction === 1 ? 1 : 0;
      const distance = Math.abs(targetProgress - progress);
      const timeline = visual.animate([
        { translate: `${fromX * (1 - progress)}px ${fromY * (1 - progress)}px` },
        { translate: `${fromX * (1 - targetProgress)}px ${fromY * (1 - targetProgress)}px` },
      ], { duration: Math.max(1, pushAnimationDuration * distance), easing: 'cubic-bezier(.06, .78, .18, 1)', fill: 'both' });
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timeline.finish();
        timeline.pause();
      } else if (distance === 0) timeline.pause();
      else timeline.play();
    }
  }
  if ((transition === 'deploy-in' || transition === 'deploy-out') && lastDeploymentInspection?.unitId === unit.id) {
    visual.classList.add('deployment-inspection-animation');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const deployed = lastDeploymentInspection.direction === 1;
      visual.style.opacity = deployed ? '1' : '0';
      visual.style.translate = deployed ? '0 0' : '0 -150px';
      if (hexArtwork) target.cell.append(hexArtwork);
      return;
    }
    const progress = deploymentInspectionProgress(lastDeploymentInspection);
    const targetProgress = lastDeploymentInspection.direction === 1 ? 1 : 0;
    const distance = Math.abs(targetProgress - progress);
    const timeline = visual.animate([
      { opacity: deploymentInspectionOpacity(progress), translate: `0 ${-150 * (1 - progress)}px` },
      { opacity: deploymentInspectionOpacity(targetProgress), translate: `0 ${-150 * (1 - targetProgress)}px` },
    ], { duration: Math.max(1, deploymentAnimationDuration * distance), easing: 'cubic-bezier(.2, .72, .3, 1)', fill: 'both' });
    if (distance === 0) timeline.pause();
  }
  if (hexArtwork) target.cell.append(hexArtwork);
}

function appendServerBash(bash: ServerBashState, showSplitBorder = true, animateEntrance = false): void {
  if (!serverMatch) return;
  const target = cellsByCoordinate.get(bash.target); const attacker = serverMatch.units.find(unit => unit.id === bash.attackerId); const defender = serverMatch.units.find(unit => unit.id === bash.defenderId);
  if (!target || !attacker || !defender) return;
  const attackerTroop = serverTroop(attacker.troopId, attacker.owner, attacker);
  const defenderTroop = serverTroop(defender.troopId, defender.owner, defender);
  // Match the fixed screen trays after removal of the old 180-degree board
  // rotation: Blue (Player 2) is on the left and Red (Player 1) on the right.
  const sideUnits: [ServerUnitState, ServerUnitState] = attacker.owner === 2
    ? [attacker, defender]
    : [defender, attacker];
  target.cell.setAttribute('tabindex', '0');
  target.cell.setAttribute('role', 'button');
  target.cell.classList.add('server-bash-target');
  if (animateEntrance) target.cell.classList.add('bash-entering');
  enableBashSideHover(target.cell, bash, sideUnits);
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
      [topPath, attacker, isServerInactive(attacker.owner, attacker.troopId) ? '#94a3b8' : controlStroke],
      [bottomPath, defender, isServerInactive(defender.owner, defender.troopId) ? '#94a3b8' : controlStroke]
    ] as const) {
      const border = document.createElementNS(ns, 'path');
      border.dataset.serverRender = 'bash'; border.classList.add('bash-border');
      if (animateEntrance) border.classList.add('bash-entrance-border');
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
      if (animateEntrance && unit.id === attacker.id) picture.classList.add('bash-entrance-attacker');
      if (isServerInactive(unit.owner, unit.troopId)) picture.classList.add('last-acting-troop');
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
    health.dataset.serverRender = 'bash'; health.dataset.unitId = unit.id; health.classList.add('bash-stat', 'bash-health', ownerClass);
    health.setAttribute('x', String(statX)); health.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0)));
    health.textContent = `♥ ${unit.currentHealth}`;
    ui.append(health);
    const modifier = document.createElementNS(ns, 'text');
    modifier.dataset.serverRender = 'bash'; modifier.classList.add('bash-stat', 'bash-modifier', ownerClass);
    modifier.setAttribute('x', String(statX)); modifier.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0) + boardDescriptionLineHeight));
    modifier.textContent = signedModifier(serverModifier(unit, bash.target, bash));
    ui.append(modifier);
    if (unit.combat.magicModifier) {
      const magicModifier = document.createElementNS(ns, 'text');
      magicModifier.dataset.serverRender = 'bash'; magicModifier.classList.add('bash-stat', 'bash-modifier', 'magic-modifier', ownerClass);
      magicModifier.setAttribute('x', String(statX + 18)); magicModifier.setAttribute('y', String(boardDescriptionLineY(target.position, 2, 0) + boardDescriptionLineHeight));
      magicModifier.textContent = signedModifier(unit.combat.magicModifier);
      ui.append(magicModifier);
    }
    if (unit.combat.magicModifier) appendMagicShieldIcon(ui, target.position, statX + 18, boardDescriptionLineY(target.position, 2, 1) + 4);
    const troop = serverTroop(unit.troopId, unit.owner, unit);
    if (troop) {
      const description = document.createElementNS(ns, 'text');
      description.dataset.serverRender = 'bash-description';
      description.classList.add('board-troop-description', 'bash-side-description', `bash-${side}-description`);
      const bashModifier = unit.troopId === 'boar-warlord'
        ? { value: 1 + (unit.bashModifierBonus ?? 0), upgraded: (unit.bashModifierBonus ?? 0) > 0 }
        : undefined;
      writeServerBoardDescription(description, troop, target.position, false, false, undefined, undefined, bashModifier);
      description.querySelector('.board-health')?.remove();
      keepServerOverlayUpright(description, target.position);
      target.cell.append(description);
    }
    target.cell.append(ui);
  }
}

function enableBashSideHover(cell: SVGGElement, bash: ServerBashState, sideUnits: [ServerUnitState, ServerUnitState]): void {
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
    const hoveredUnit = sideUnits[side === 'left' ? 0 : 1];
    serverBashReveal = hoveredUnit.id === bash.attackerId ? 'attacker' : 'defender';
    showServerHoverDetailsForCoordinate(bash.target);
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
  const pending = serverPendingAction;
  if (!pending || !pending.coordinate || (pending.type !== 'move' && pending.type !== 'fly' && pending.type !== 'push' && pending.type !== 'pull')) return undefined;
  let unit: ServerUnitState | undefined;
  let coordinate: Coordinate = pending.coordinate;
  if (pending.type === 'push' || pending.type === 'pull') {
    if (!serverPendingAction?.destination) return undefined;
    unit = match.units.find(candidate => candidate.coordinate === pending.coordinate);
    coordinate = serverPendingAction.destination;
  } else {
    const owner = localMatchPlayer;
    if (!owner) return undefined;
    unit = match.units.find(candidate => candidate.owner === owner && candidate.troopId === pending.troopId);
  }
  if (!unit) return undefined;
  const occupant = match.units.find(candidate => candidate.coordinate === coordinate && candidate.id !== unit.id);
  // An enemy occupant is precisely the case in which movement becomes a bash;
  // keep projecting the attacker so its travel animation can finish before
  // the split combat presentation enters. Friendly occupancy is still invalid.
  if (occupant?.owner === unit.owner) return undefined;
  return { unit, coordinate };
}

/** Project the unit-facing result of a pending mending or upgrade action. */
function serverPendingUnitPreviews(): ServerUnitState[] {
  const match = serverMatch;
  const pending = serverPendingAction;
  if (!match || !pending || !pending.coordinate) return [];
  const owner = localMatchPlayer;
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
      combat: { health, modifier: 0, magicModifier: 0, modifiers: [], total: health },
    }];
  }
  const source = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
  if (!source) return [];
  if (pending.type === 'move' || pending.type === 'fly' || pending.type === 'push' || pending.type === 'pull') {
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
  const pending = serverPendingAction;
  if (!match || !pending) return undefined;
  const owner = localMatchPlayer;
  if (!owner) return undefined;
  if ((pending.type === 'move' || pending.type === 'fly') && pending.coordinate) {
    const attacker = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
    const defender = match.units.find(unit => unit.coordinate === pending.coordinate && unit.owner !== owner);
    return attacker && defender ? { attackerId: attacker.id, defenderId: defender.id, target: pending.coordinate } : undefined;
  }
  if ((pending.type === 'push' || pending.type === 'pull') && pending.coordinate && pending.destination) {
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
  if (bash && serverHoverPreviewCoordinate !== bash.target) appendServerBash(bash, false, true);
}

function serverBashScreenSide(unit: ServerUnitState): 'left' | 'right' {
  return unit.owner === 2 ? 'left' : 'right';
}

function queueCurrentMovementPreviewReturn(): void {
  const movement = serverPendingMovementPreview();
  const bash = serverPendingBash();
  queuedMovementPreviewReturn = movement
    ? {
      unitId: movement.unit.id,
      coordinate: movement.coordinate,
      wasBash: bash?.attackerId === movement.unit.id,
    }
    : undefined;
}

function serverPreviewAt(coordinate: Coordinate): boolean {
  if (serverPendingBash()?.target === coordinate) return true;
  return Boolean(serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, serverMatch)));
}

function coordinateHasVisibleBash(coordinate: Coordinate): boolean {
  return serverPendingBash()?.target === coordinate
    || Boolean(serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, serverMatch)));
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

function latestMovementInspectionAt(coordinate: Coordinate): typeof lastMovementInspection {
  const match = serverMatch;
  if (!match) return undefined;
  const actingUnit = match.units.find(candidate => candidate.coordinate === coordinate
    && isServerInactive(candidate.owner, candidate.troopId));
  if (!actingUnit) return undefined;
  let eventIndex = -1;
  for (let index = (match.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = match.events?.[index];
    if (event?.player === actingUnit.owner && event.action.troopId === actingUnit.troopId) { eventIndex = index; break; }
  }
  const latest = eventIndex >= 0 ? match.events?.[eventIndex] : undefined;
  if (!latest?.origin || (latest.action.type !== 'move' && latest.action.type !== 'fly' && latest.action.type !== 'push' && latest.action.type !== 'pull')) return undefined;
  const movementAction = latest.action as typeof latest.action & { targetUnitId?: string; targetBomb?: boolean; destination?: Coordinate };
  if ((movementAction.type === 'push' || movementAction.type === 'pull') && movementAction.targetBomb) return undefined;
  const unit = latest.action.type === 'push' || latest.action.type === 'pull'
    ? movementAction.targetUnitId
      ? match.units.find(candidate => candidate.id === movementAction.targetUnitId)
      : match.units.find(candidate => candidate.coordinate === movementAction.destination)
    : match.units.find(candidate => candidate.owner === latest.player && candidate.troopId === latest.action.troopId);
  if (!unit || ((latest.action.type !== 'push' && latest.action.type !== 'pull') && unit.coordinate !== coordinate)) return undefined;
  const key = `movement:${unit.id}:${eventIndex}`;
  return { key, eventIndex, actor: latest.player, unitId: unit.id, hoverCoordinate: coordinate, origin: latest.origin, destination: unit.coordinate, type: latest.action.type, progress: 1, direction: -1, changedAt: performance.now() };
}

function movementInspectionProgress(inspection: NonNullable<typeof lastMovementInspection>): number {
  const duration = inspection.type === 'push' || inspection.type === 'pull' ? pushAnimationDuration : movementAnimationDuration;
  const target = inspection.direction === 1 ? 1 : 0;
  const distance = Math.abs(target - inspection.progress);
  if (distance === 0) return target;
  const elapsed = (performance.now() - inspection.changedAt) / (duration * distance);
  const eased = inspection.type === 'push' || inspection.type === 'pull'
    ? cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .06, .78, .18, 1)
    : cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .2, .72, .3, 1);
  return inspection.progress + (target - inspection.progress) * eased;
}

function redirectMovementInspection(direction: -1 | 1): void {
  if (!lastMovementInspection || lastMovementInspection.direction === direction || !serverMatch) return;
  lastMovementInspection = {
    ...lastMovementInspection,
    progress: movementInspectionProgress(lastMovementInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(serverMatch);
}

function beginLastMovementInspection(coordinate: Coordinate): void {
  if (serverSelectionRequestPending || serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return;
  if (lastMovementInspection?.hoverCoordinate === coordinate) {
    redirectMovementInspection(-1);
    return;
  }
  // A completed or returning inspection must not monopolize the hover state;
  // entering another inactive troop switches the single visible inspector.
  if (lastMovementInspection) lastMovementInspection = undefined;
  const inspection = latestMovementInspectionAt(coordinate);
  if (!inspection || !serverMatch) return;
  if (inspection.actor !== localMatchPlayer || inspection.eventIndex < (serverMatch.events?.length ?? 0) - 1) armedRewindInspections.add(inspection.key);
  if (!armedRewindInspections.has(inspection.key)) return;
  lastMovementInspection = inspection;
  renderServerMatchState(serverMatch);
}

function endLastMovementInspection(coordinate: Coordinate): void {
  if (!lastMovementInspection) {
    const inspection = latestMovementInspectionAt(coordinate);
    if (inspection) armedRewindInspections.add(inspection.key);
    return;
  }
  if (lastMovementInspection.hoverCoordinate !== coordinate || !serverMatch) return;
  redirectMovementInspection(1);
}

function latestDeploymentInspectionAt(coordinate: Coordinate): typeof lastDeploymentInspection {
  const match = serverMatch;
  if (!match) return undefined;
  const unit = match.units.find(candidate => candidate.coordinate === coordinate
    && isServerInactive(candidate.owner, candidate.troopId));
  if (!unit) return undefined;
  let eventIndex = -1;
  for (let index = (match.events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = match.events?.[index];
    if (event?.player === unit.owner && event.action.troopId === unit.troopId) { eventIndex = index; break; }
  }
  const latest = eventIndex >= 0 ? match.events?.[eventIndex] : undefined;
  if (latest?.action.type !== 'deploy' || latest.action.coordinate !== coordinate) return undefined;
  const key = `deployment:${unit.id}:${eventIndex}`;
  return { key, eventIndex, actor: latest.player, unitId: unit.id, coordinate, progress: 1, direction: -1, changedAt: performance.now() };
}

function deploymentInspectionProgress(inspection: NonNullable<typeof lastDeploymentInspection>): number {
  const target = inspection.direction === 1 ? 1 : 0;
  const distance = Math.abs(target - inspection.progress);
  if (distance === 0) return target;
  const elapsed = (performance.now() - inspection.changedAt) / (deploymentAnimationDuration * distance);
  const eased = cubicBezierProgress(Math.max(0, Math.min(1, elapsed)), .2, .72, .3, 1);
  return inspection.progress + (target - inspection.progress) * eased;
}

function deploymentInspectionOpacity(progress: number): number {
  if (progress <= .35) return .28 * progress / .35;
  if (progress <= .72) return .28 + (.82 - .28) * (progress - .35) / (.72 - .35);
  return .82 + (1 - .82) * (progress - .72) / (1 - .72);
}

function cubicBezierProgress(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const sample = (t: number, first: number, second: number): number => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
  };
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middle = (low + high) / 2;
    if (sample(middle, x1, x2) < x) low = middle;
    else high = middle;
  }
  return sample((low + high) / 2, y1, y2);
}

function redirectDeploymentInspection(direction: -1 | 1): void {
  if (!lastDeploymentInspection || lastDeploymentInspection.direction === direction || !serverMatch) return;
  lastDeploymentInspection = {
    ...lastDeploymentInspection,
    progress: deploymentInspectionProgress(lastDeploymentInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(serverMatch);
}

function beginLastDeploymentInspection(coordinate: Coordinate): void {
  if (serverSelectionRequestPending || serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return;
  if (lastDeploymentInspection?.coordinate === coordinate) {
    redirectDeploymentInspection(-1);
    return;
  }
  if (lastDeploymentInspection) lastDeploymentInspection = undefined;
  const inspection = latestDeploymentInspectionAt(coordinate);
  if (!inspection || !serverMatch) return;
  if (inspection.actor !== localMatchPlayer || inspection.eventIndex < (serverMatch.events?.length ?? 0) - 1) armedRewindInspections.add(inspection.key);
  if (!armedRewindInspections.has(inspection.key)) return;
  lastDeploymentInspection = inspection;
  renderServerMatchState(serverMatch);
}

function endLastDeploymentInspection(coordinate: Coordinate): void {
  if (!lastDeploymentInspection) {
    const inspection = latestDeploymentInspectionAt(coordinate);
    if (inspection) armedRewindInspections.add(inspection.key);
    return;
  }
  if (lastDeploymentInspection.coordinate !== coordinate || !serverMatch) return;
  redirectDeploymentInspection(1);
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

const bombIconSize = 36;
const bombDamageLabelGap = 1;
const bombIgnitionCrossfadeDuration = 350;

function positionBombIcon(image: SVGImageElement, centre: Point): void {
  const radius = bombIconSize / 2;
  image.setAttribute('x', String(centre.x - radius));
  image.setAttribute('y', String(centre.y - radius));
  image.setAttribute('width', String(bombIconSize));
  image.setAttribute('height', String(bombIconSize));
}

function bombIconCentre(position: Point): Point {
  return { x: position.x + (size - hexGap) * horizontalScale * .68, y: position.y };
}

function switchBombIconOnArrival(marker: SVGImageElement, key: string, lit: boolean): SVGImageElement | undefined {
  if (!lit) {
    marker.setAttribute('href', './assets/bomb-unlight.png');
    return undefined;
  }
  let arrivalTime = bombIgnitionArrivalTimes.get(key);
  if (arrivalTime === undefined) {
    arrivalTime = performance.now() + projectileTravelDuration;
    bombIgnitionArrivalTimes.set(key, arrivalTime);
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const remaining = reducedMotion ? 0 : Math.max(0, arrivalTime - performance.now());
  if (remaining <= 0) {
    marker.setAttribute('href', './assets/bomb-light.png');
    return undefined;
  }
  marker.setAttribute('href', './assets/bomb-unlight.png');
  const litMarker = marker.cloneNode(false) as SVGImageElement;
  litMarker.setAttribute('href', './assets/bomb-light.png');
  litMarker.style.opacity = '0';
  window.setTimeout(() => {
    marker.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: bombIgnitionCrossfadeDuration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    litMarker.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: bombIgnitionCrossfadeDuration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
  }, remaining);
  return litMarker;
}

function appendBombDamageLabel(parent: SVGElement, centre: Point, damage: number): SVGTextElement {
  const label = document.createElementNS(ns, 'text');
  label.dataset.serverRender = 'bomb';
  label.classList.add('bomb-damage-label');
  label.setAttribute('x', String(centre.x - bombIconSize / 2 - bombDamageLabelGap));
  label.setAttribute('y', String(centre.y + 4));
  label.textContent = String(damage);
  parent.append(label);
  return label;
}

interface ServerProjectile {
  key: string;
  kind: 'attack' | 'magic' | 'bomb' | 'cannon' | 'gore' | 'upgrade';
  source: Coordinate;
  target: Coordinate;
  damage: number;
  headMode?: 'repeat' | 'once' | 'none';
  trailMode?: 'repeat' | 'once';
  presentation?: 'ignition';
}

interface QuadraticTrajectory {
  start: Point;
  control: Point;
  end: Point;
  pathData: string;
  pointAt: (progress: number) => Point;
  angleAt: (progress: number) => number;
}

/** Shared curved flight geometry for bombs, arrows, and fireballs. */
function curvedTrajectory(start: Point, end: Point, arcHeight: number, parallelOffset = 0): QuadraticTrajectory {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const laneStart = { x: start.x + normal.x * parallelOffset, y: start.y + normal.y * parallelOffset };
  const laneEnd = { x: end.x + normal.x * parallelOffset, y: end.y + normal.y * parallelOffset };
  const control = {
    x: (laneStart.x + laneEnd.x) / 2,
    y: (laneStart.y + laneEnd.y) / 2 - arcHeight,
  };
  const pointAt = (progress: number): Point => {
    const inverse = 1 - progress;
    return {
      x: inverse * inverse * laneStart.x + 2 * inverse * progress * control.x + progress * progress * laneEnd.x,
      y: inverse * inverse * laneStart.y + 2 * inverse * progress * control.y + progress * progress * laneEnd.y,
    };
  };
  const angleAt = (progress: number): number => {
    const tangentX = 2 * (1 - progress) * (control.x - laneStart.x) + 2 * progress * (laneEnd.x - control.x);
    const tangentY = 2 * (1 - progress) * (control.y - laneStart.y) + 2 * progress * (laneEnd.y - control.y);
    return Math.atan2(tangentY, tangentX) * 180 / Math.PI;
  };
  return {
    start: laneStart,
    control,
    end: laneEnd,
    pathData: `M ${laneStart.x} ${laneStart.y} Q ${control.x} ${control.y} ${laneEnd.x} ${laneEnd.y}`,
    pointAt,
    angleAt,
  };
}

/** Keep sampled tangent angles continuous across atan2's -180/180 boundary.
 * Without unwrapping, Web Animations interpolates through the long rotation
 * and an arrow can visibly flip for a frame on a leftward curve. */
function unwrappedTrajectoryAngles(trajectory: QuadraticTrajectory, sampleCount: number): number[] {
  const angles: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    let angle = trajectory.angleAt(index / (sampleCount - 1));
    const previous = angles.at(-1);
    if (previous !== undefined) {
      while (angle - previous > 180) angle -= 360;
      while (angle - previous < -180) angle += 360;
    }
    angles.push(angle);
  }
  return angles;
}

function serverProjectileKey(owner: Player, sourceId: string, kind: ServerProjectile['kind'], target: Coordinate): string {
  return `${owner}:${sourceId}:${kind}:${target}`;
}

function projectileDamage(troop: Troop, kind: ServerProjectile['kind']): number | undefined {
  if (kind === 'bomb' || kind === 'cannon' || kind === 'gore' || kind === 'upgrade') return undefined;
  const action = actionOfType(troop, kind);
  if (!action || (action.type !== 'attack' && action.type !== 'magic')) return undefined;
  return action.type === 'attack'
    ? rangedDamage(troop, action) + upgradeBonus(troop, 'attack').left + staticAuraBonus(troop, 'attack').left
    : action.damage + permanentUpgradeBonus(troop, 'magic').left + upgradeBonus(troop, 'magic').left + staticAuraBonus(troop, 'magic').left;
}

function confirmedServerProjectiles(match: ServerMatchState): ServerProjectile[] {
  const projectiles: ServerProjectile[] = [];
  for (const effect of match.effects) {
    if (effect.kind === 'gore' && replayingLastTurn && effect.sourceUnitId && effect.origin) {
      const source = match.units.find(unit => unit.id === effect.sourceUnitId);
      if (source) projectiles.push({
        key: serverProjectileKey(effect.owner, source.id, 'gore', effect.target),
        kind: 'gore',
        source: effect.origin,
        target: effect.target,
        damage: 1,
      });
      continue;
    }
    if ((effect.kind !== 'attack' && effect.kind !== 'magic') || !effect.sourceUnitId) continue;
    const source = match.units.find(unit => unit.id === effect.sourceUnitId);
    if (source) projectiles.push({
      key: serverProjectileKey(effect.owner, source.id, effect.kind, effect.target),
      kind: effect.kind,
      source: source.coordinate,
      target: effect.target,
      damage: effect.value,
    });
  }
  const cannonEffects = match.effects.filter(effect => effect.kind === 'cannon' && effect.sourceUnitId);
  const cannonGroups = new Map<string, typeof cannonEffects>();
  for (const effect of cannonEffects) {
    const key = `${effect.owner}:${effect.sourceUnitId}`;
    cannonGroups.set(key, [...(cannonGroups.get(key) ?? []), effect]);
  }
  for (const effects of cannonGroups.values()) {
    const first = effects[0];
    const source = first?.sourceUnitId ? match.units.find(unit => unit.id === first.sourceUnitId) : undefined;
    if (!first || !source) continue;
    const target = effects.reduce((farthest, effect) =>
      hexDistance(source.coordinate, effect.target) > hexDistance(source.coordinate, farthest.target) ? effect : farthest
    ).target;
    projectiles.push({
      key: serverProjectileKey(first.owner, source.id, 'cannon', target),
      kind: 'cannon',
      source: source.coordinate,
      target,
      damage: 1,
    });
  }
  // Lighting a bomb replaces the direct Magic effect with explosion effects.
  // Preserve the fire projectile using the authoritative action event instead.
  const latest = match.events?.at(-1);
  if (latest?.action.type === 'magic'
    && latest.action.coordinate
    && match.effects.some(effect => effect.owner === latest.player && effect.kind === 'bomb' && effect.target === latest.action.coordinate)) {
    const target = latest.action.coordinate;
    const source = match.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
    const troop = source ? serverTroop(source.troopId, source.owner, source) : undefined;
    const damage = troop ? projectileDamage(troop, 'magic') : undefined;
    if (source) projectiles.push({
      key: serverProjectileKey(latest.player, source.id, 'magic', target),
      kind: 'magic',
      source: source.coordinate,
      target,
      damage: 1,
      headMode: 'none',
    });
    if ((replayingLastTurn || latest.player !== localMatchPlayer) && source && damage !== undefined) projectiles.push({
        key: `ignition:${match.id}:${match.revision}:${serverProjectileKey(latest.player, source.id, 'magic', target)}`,
        kind: 'magic',
        source: source.coordinate,
        target,
        damage,
        headMode: 'once',
        trailMode: 'once',
        presentation: 'ignition',
      });
  }
  return [...new Map(projectiles.map(projectile => [projectile.key, projectile])).values()];
}

function stagedServerProjectile(match: ServerMatchState): ServerProjectile | undefined {
  const pending = serverPendingAction;
  if (!pending?.coordinate || (pending.type !== 'attack' && pending.type !== 'magic' && pending.type !== 'bomb' && pending.type !== 'cannon' && pending.type !== 'gore' && pending.type !== 'upgrade')) return undefined;
  const owner = localMatchPlayer;
  if (!owner) return undefined;
  const source = match.units.find(unit => unit.owner === owner && unit.troopId === pending.troopId);
  const troop = source ? serverTroop(source.troopId, source.owner, source) : undefined;
  const damage = pending.type === 'bomb' || pending.type === 'cannon' || pending.type === 'gore' || pending.type === 'upgrade' ? 1 : troop ? projectileDamage(troop, pending.type) : undefined;
  if (!source || damage === undefined) return undefined;
  return {
    key: serverProjectileKey(owner, source.id, pending.type, pending.coordinate),
    kind: pending.type,
    source: source.coordinate,
    target: pending.coordinate,
    damage: Math.max(1, damage),
    headMode: 'repeat',
  };
}

const projectileTravelDuration = 1050;
const deploymentAnimationDuration = 1400;
const pushAnimationDuration = 780;
const movementAnimationDuration = 800;
const projectileImpactDuration = 350;
const projectileRepeatBuffer = 1000;
const projectileCycleDuration = projectileTravelDuration + projectileImpactDuration + projectileRepeatBuffer;
const projectileMaterializeFraction = .18;
const projectileTrailLifetime = 500;
const projectileTrailSegments = 8;
const shieldFrameDuration = 150;
const shieldFrameCount = shieldFrameUrls.length;
const shieldAnimationSize = 68;
const shieldFlightSize = shieldAnimationSize * .5;
const damageResolutionDuration = 1500;
const bombExplosionDuration = 900;
const bombExplosionSize = 120;
const deathAnimationDuration = 1100;
const stunAnimationDuration = 900;

function projectileMaterializationOpacity(progress: number): number {
  return Math.min(1, progress / projectileMaterializeFraction);
}

function appendShieldFrameSequence(target: Point, delay = 0, magic = false): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frameIndexes = reducedMotion ? [3] : Array.from({ length: shieldFrameCount }, (_, index) => index);
  for (const [sequenceIndex, frameIndex] of frameIndexes.entries()) {
    const frame = document.createElementNS(ns, 'image');
    frame.dataset.serverRender = 'shield-animation';
    frame.classList.add('shield-animation-frame');
    if (magic) frame.classList.add('magic-shield-animation');
    frame.setAttribute('href', shieldFrameUrls[frameIndex]);
    frame.setAttribute('x', String(target.x - shieldAnimationSize / 2));
    frame.setAttribute('y', String(target.y - shieldAnimationSize / 2));
    frame.setAttribute('width', String(shieldAnimationSize));
    frame.setAttribute('height', String(shieldAnimationSize));
    boardPanel.append(frame);
    const frameDelay = delay + sequenceIndex * shieldFrameDuration;
    const visibleDuration = reducedMotion ? 450 : shieldFrameDuration;
    window.setTimeout(() => { frame.style.opacity = '1'; }, frameDelay);
    window.setTimeout(() => { frame.style.opacity = '0'; }, frameDelay + visibleDuration);
  }
}

function appendServerMagicShieldAnimations(match: ServerMatchState, previous: ServerMatchState | undefined): void {
  if (!previous || previous.id !== match.id || previous.revision === match.revision) return;
  for (const unit of match.units) {
    const oldUnit = previous.units.find(candidate => candidate.id === unit.id);
    if (!oldUnit || unit.combat.magicModifier <= oldUnit.combat.magicModifier) continue;
    const target = cellsByCoordinate.get(unit.coordinate)?.position;
    if (target) appendShieldFrameSequence(target, 0, true);
  }
}

function replayMagicShieldOnHover(coordinate: Coordinate): void {
  if (!lastTurnReplayBefore || !lastTurnReplayAfter || serverSelectionRequestPending || serverSelectedTroopId) return;
  const unit = lastTurnReplayAfter.units.find(candidate => candidate.coordinate === coordinate);
  const previous = unit ? lastTurnReplayBefore.units.find(candidate => candidate.id === unit.id) : undefined;
  if (!unit || !previous || unit.combat.magicModifier <= previous.combat.magicModifier) return;
  const target = cellsByCoordinate.get(coordinate)?.position;
  if (target) appendShieldFrameSequence(target, 0, true);
}

function appendFlyingShield(source: Point, target: Point): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    appendShieldFrameSequence(target);
    return;
  }
  const trajectory = curvedTrajectory(source, target, Math.max(36, Math.hypot(target.x - source.x, target.y - source.y) * .28));
  // Keep only the hand-drawn trajectory repeating after the one-shot shield
  // launch, so the protected troop remains visually connected to its source.
  appendProjectileTrail(trajectory);
  const moving = document.createElementNS(ns, 'g');
  moving.dataset.serverRender = 'shield-animation';
  const shield = document.createElementNS(ns, 'image');
  shield.classList.add('shield-flight');
  shield.setAttribute('href', './assets/shield-3.png');
  shield.setAttribute('x', String(target.x - shieldFlightSize / 2));
  shield.setAttribute('y', String(target.y - shieldFlightSize / 2));
  shield.setAttribute('width', String(shieldFlightSize));
  shield.setAttribute('height', String(shieldFlightSize));
  moving.append(shield);
  boardPanel.append(moving);
  const frames: Keyframe[] = Array.from({ length: 24 }, (_, index) => {
    const progress = index / 24;
    const point = trajectory.pointAt(progress);
    return {
      translate: `${point.x - target.x}px ${point.y - target.y}px`,
      opacity: projectileMaterializationOpacity(progress),
      offset: progress,
    };
  });
  frames.push({ translate: '0px 0px', opacity: 0, offset: 1 });
  moving.animate(frames, { duration: projectileTravelDuration, easing: 'linear', fill: 'forwards' });
  appendShieldFrameSequence(target, projectileTravelDuration);
}

function appendServerDefenseAnimations(match: ServerMatchState): void {
  const staged = serverPendingAction;
  let action: { owner: Player; troopId: string; type: 'defense' | 'self-defense'; coordinate?: Coordinate } | undefined;
  if (localMatchPlayer && staged && (staged.type === 'defense' || staged.type === 'self-defense')) {
    action = { owner: localMatchPlayer, troopId: staged.troopId, type: staged.type, coordinate: staged.coordinate };
  } else {
    const latest = match.events?.at(-1);
    if (confirmedDefenseAnimationRevision === match.revision
      && latest
      && (replayingLastTurn || latest.player !== localMatchPlayer)
      && (latest.action.type === 'defense' || latest.action.type === 'self-defense')) {
      action = { owner: latest.player, troopId: latest.action.troopId, type: latest.action.type, coordinate: latest.action.coordinate };
    }
  }
  if (!action) return;
  const source = match.units.find(unit => unit.owner === action.owner && unit.troopId === action.troopId);
  const sourcePoint = source ? cellsByCoordinate.get(source.coordinate)?.position : undefined;
  const targetCoordinate = action.coordinate ?? source?.coordinate;
  const targetPoint = targetCoordinate ? cellsByCoordinate.get(targetCoordinate)?.position : undefined;
  if (!sourcePoint || !targetPoint) return;
  if (action.type === 'self-defense' || targetCoordinate === source?.coordinate) appendShieldFrameSequence(targetPoint);
  else appendFlyingShield(sourcePoint, targetPoint);
}

function appendStunImage(target: Point, elapsed = 0): void {
  const image = document.createElementNS(ns, 'image');
  image.dataset.serverRender = 'stun-animation';
  image.classList.add('stun-animation');
  image.setAttribute('href', './assets/stun.png');
  const stunSize = 90;
  image.setAttribute('x', String(target.x - stunSize / 2));
  image.setAttribute('y', String(target.y - stunSize / 2));
  image.setAttribute('width', String(stunSize));
  image.setAttribute('height', String(stunSize));
  image.style.transformBox = 'fill-box';
  image.style.transformOrigin = 'center';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    image.style.opacity = '.8';
  } else {
    image.animate([
      { opacity: 0, transform: 'rotate(0deg)', offset: 0 },
      { opacity: 1, transform: 'rotate(72deg)', offset: .2 },
      { opacity: 1, transform: 'rotate(288deg)', offset: .8 },
      { opacity: 0, transform: 'rotate(360deg)', offset: 1 },
    ], { duration: stunAnimationDuration, delay: -elapsed, easing: 'linear', fill: 'both' });
  }
  boardPanel.append(image);
}

function replayStunOnHover(coordinate: Coordinate): void {
  const unit = serverMatch?.units.find(candidate => candidate.coordinate === coordinate);
  if (!unit || (unit.stunnedTurns ?? 0) <= 0) return;
  const target = cellsByCoordinate.get(coordinate)?.position;
  if (target) appendStunImage(target);
}

function appendServerStunAnimations(match: ServerMatchState): void {
  const activeKeys = new Set<string>();
  for (const effect of match.effects.filter(item => item.kind === 'stun')) {
    const key = `${match.id}:${effect.owner}:${effect.sourceUnitId ?? effect.sourceTroopId}:${effect.targetUnitId ?? ''}:${effect.target}:${effect.value}`;
    activeKeys.add(key);
    let startedAt = stunAnimationStartTimes.get(key);
    if (startedAt === undefined) {
      startedAt = performance.now();
      stunAnimationStartTimes.set(key, startedAt);
    }
    const elapsed = performance.now() - startedAt;
    if (elapsed >= stunAnimationDuration) continue;
    const target = cellsByCoordinate.get(effect.target)?.position;
    if (!target) continue;
    appendStunImage(target, elapsed);
  }
  for (const key of stunAnimationStartTimes.keys()) if (!activeKeys.has(key)) stunAnimationStartTimes.delete(key);
}

/** Approximate the curve with a few tangent-aligned copies of the hand-drawn
 * trail texture. This is substantially cheaper than deforming a bitmap or
 * animating dozens of individual SVG trail points. */
function appendProjectileTrail(trajectory: QuadraticTrajectory, iterations = Infinity, phaseDelay = 0): void {
  for (let index = 0; index < projectileTrailSegments; index += 1) {
    const startProgress = index / projectileTrailSegments;
    const endProgress = (index + 1) / projectileTrailSegments;
    const progress = (startProgress + endProgress) / 2;
    const start = trajectory.pointAt(startProgress);
    const end = trajectory.pointAt(endProgress);
    const middle = trajectory.pointAt(progress);
    const width = Math.hypot(end.x - start.x, end.y - start.y) + 3;
    const trace = document.createElementNS(ns, 'image');
    trace.dataset.serverRender = 'projectile';
    trace.classList.add('projectile-trail-segment');
    trace.setAttribute('href', './assets/trail.png');
    trace.setAttribute('x', String(-width / 2));
    trace.setAttribute('y', '-4.5');
    trace.setAttribute('width', String(width));
    trace.setAttribute('height', '9');
    trace.setAttribute('preserveAspectRatio', 'none');
    trace.setAttribute('transform', `translate(${middle.x} ${middle.y}) rotate(${trajectory.angleAt(progress)})`);
    boardPanel.append(trace);
    const arrival = endProgress * projectileTravelDuration;
    trace.animate([
      { opacity: .78, offset: 0 },
      { opacity: 0, offset: projectileTrailLifetime / projectileCycleDuration },
      { opacity: 0, offset: 1 },
    ], { duration: projectileCycleDuration, delay: arrival + phaseDelay, iterations });
  }
}

function createProjectileHead(kind: ServerProjectile['kind'], trajectory: QuadraticTrajectory): { moving: SVGGElement; orientation: SVGGElement } {
  const moving = document.createElementNS(ns, 'g');
  moving.dataset.serverRender = 'projectile';
  moving.classList.add('projectile-flight', `projectile-${kind}`);
  moving.setAttribute('transform', `translate(${trajectory.end.x} ${trajectory.end.y})`);
  const orientation = document.createElementNS(ns, 'g');
  orientation.classList.add('projectile-orientation');
  const image = document.createElementNS(ns, 'image');
  const width = kind === 'bomb' ? bombIconSize : kind === 'upgrade' ? 34 : kind === 'cannon' || kind === 'gore' ? 36 : kind === 'magic' ? 38 : 42;
  const height = kind === 'bomb' ? bombIconSize : kind === 'upgrade' ? 34 : kind === 'cannon' || kind === 'gore' ? 35 : kind === 'magic' ? 11 : 6;
  image.setAttribute('href', kind === 'bomb' ? './assets/bomb-unlight.png' : kind === 'upgrade' ? './assets/upgrade.png' : kind === 'cannon' ? './assets/cannon-purple.png' : kind === 'gore' ? './assets/horns.png' : kind === 'magic' ? './assets/fire.png' : './assets/arrow.png');
  image.setAttribute('x', String(-width / 2)); image.setAttribute('y', String(-height / 2));
  image.setAttribute('width', String(width)); image.setAttribute('height', String(height));
  orientation.append(image);
  moving.append(orientation);
  return { moving, orientation };
}

function appendServerProjectile(projectile: ServerProjectile, phaseDelay = 0): void {
  const sourceCell = cellsByCoordinate.get(projectile.source)?.position;
  const targetCell = cellsByCoordinate.get(projectile.target)?.position;
  if (!sourceCell || !targetCell) return;
  const bombOffset = (size - hexGap) * horizontalScale * .68;
  const source = projectile.kind === 'bomb' ? { x: sourceCell.x - bombOffset, y: sourceCell.y } : sourceCell;
  const latest = serverMatch?.events?.at(-1);
  const targetsBomb = projectile.kind === 'magic' && (serverMatch?.bombs?.some(bomb => bomb.coordinate === projectile.target)
    || (latest?.action.type === 'magic'
      && latest.action.coordinate === projectile.target
      && serverMatch?.effects.some(effect => effect.kind === 'bomb' && effect.target === projectile.target)));
  const target = projectile.kind === 'bomb' || targetsBomb ? bombIconCentre(targetCell) : targetCell;
  const count = projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade' ? 1 : Math.max(1, Math.round(projectile.damage));
  const laneSpacing = projectile.kind === 'magic' ? 7 : 5;
  const arcHeight = Math.max(projectile.kind === 'bomb' ? 42 : 36, hexDistance(projectile.source, projectile.target) * (projectile.kind === 'bomb' ? 20 : 15));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heads: Array<{ element: SVGGElement; movementFrames?: Keyframe[]; orientation?: SVGGElement; rotationFrames?: Keyframe[] }> = [];
  for (let lane = 0; lane < count; lane += 1) {
    const offset = (lane - (count - 1) / 2) * laneSpacing;
    const trajectory = curvedTrajectory(source, target, projectile.kind === 'cannon' || projectile.kind === 'gore' ? 0 : arcHeight, offset);
    const headMode = projectile.headMode ?? 'repeat';
    if (reducedMotion) {
      if (headMode === 'none') continue;
      const { moving, orientation } = createProjectileHead(projectile.kind, trajectory);
      orientation.setAttribute('transform', `rotate(${projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade' ? 0 : trajectory.angleAt(1)})`);
      moving.style.opacity = '.65';
      heads.push({ element: moving });
      continue;
    }
    // Paint the arrow/fireball head after its texture segments so each damage
    // lane reads as one projectile followed by its own fading trail.
    if (projectile.kind !== 'cannon' && projectile.kind !== 'gore') appendProjectileTrail(trajectory, projectile.trailMode === 'once' ? 1 : Infinity, phaseDelay);
    if (headMode === 'none') continue;
    const { moving, orientation } = createProjectileHead(projectile.kind, trajectory);
    const travelFraction = projectileTravelDuration / projectileCycleDuration;
    const impactFraction = (projectileTravelDuration + projectileImpactDuration) / projectileCycleDuration;
    const movementFrames: Keyframe[] = Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24;
      const point = trajectory.pointAt(progress);
      return {
        translate: `${point.x - trajectory.end.x}px ${point.y - trajectory.end.y}px`,
        opacity: projectileMaterializationOpacity(progress),
        offset: progress * travelFraction,
      };
    });
    movementFrames.push({ translate: '0px 0px', opacity: 0, offset: impactFraction });
    movementFrames.push({ translate: '0px 0px', opacity: 0, offset: 1 });
    const trajectoryAngles = projectile.kind === 'bomb' || projectile.kind === 'cannon' || projectile.kind === 'gore' || projectile.kind === 'upgrade'
      ? Array.from({ length: 25 }, () => 0)
      : unwrappedTrajectoryAngles(trajectory, 25);
    const rotationFrames: Keyframe[] = trajectoryAngles.map((angle, index) => {
      const progress = index / 24;
      return { rotate: `${angle}deg`, offset: progress * travelFraction };
    });
    const finalAngle = trajectoryAngles.at(-1) ?? 0;
    rotationFrames.push({ rotate: `${finalAngle}deg`, offset: impactFraction });
    rotationFrames.push({ rotate: `${finalAngle}deg`, offset: 1 });
    heads.push({ element: moving, movementFrames, orientation, rotationFrames });
  }
  // SVG uses document order for paint order. Append all heads only after all
  // lanes' segments so a later lane can never cover an earlier projectile.
  for (const head of heads) {
    boardPanel.append(head.element);
    const iterations = projectile.headMode === 'once' ? 1 : Infinity;
    const fill = projectile.headMode === 'once' ? 'forwards' : 'none';
    if (head.movementFrames) head.element.animate(head.movementFrames, { duration: projectileCycleDuration, delay: phaseDelay, iterations, easing: 'linear', fill });
    if (head.orientation && head.rotationFrames) head.orientation.animate(head.rotationFrames, { duration: projectileCycleDuration, delay: phaseDelay, iterations, easing: 'linear', fill });
  }
  if (projectile.kind === 'bomb' && projectile.headMode === 'once') playedConfirmedBombHeads.add(projectile.key);
  if (projectile.kind === 'upgrade' && projectile.headMode === 'once') playedConfirmedUpgradeHeads.add(projectile.key);
  if (projectile.presentation === 'ignition' && projectile.headMode === 'once') playedConfirmedBombIgnitions.add(projectile.key);
}

function confirmedBombProjectiles(match: ServerMatchState): ServerProjectile[] {
  const activeKeys = new Set<string>();
  const projectiles = (match.bombs ?? []).flatMap(bomb => {
    const key = serverProjectileKey(bomb.owner, bomb.sourceTroopId, 'bomb', bomb.coordinate);
    activeKeys.add(key);
    let source = confirmedBombTrajectorySources.get(key);
    if (!source) {
      source = match.units.find(unit => unit.owner === bomb.owner && unit.troopId === bomb.sourceTroopId)?.coordinate;
      if (source) confirmedBombTrajectorySources.set(key, source);
    }
    // The throw remains legible for as long as its source troop is inactive.
    // Once another troop acts for that owner, the bomber becomes available
    // again and the fixed bomb no longer needs its historical trajectory.
    return source && match.lastActingTroopId?.[bomb.owner] === bomb.sourceTroopId ? [{
      key,
      kind: 'bomb' as const,
      source,
      target: bomb.coordinate,
      damage: 1,
      headMode: playedConfirmedBombHeads.has(key) ? 'none' as const : 'once' as const,
    }] : [];
  });
  for (const key of confirmedBombTrajectorySources.keys()) if (!activeKeys.has(key)) {
    confirmedBombTrajectorySources.delete(key);
    playedConfirmedBombHeads.delete(key);
    confirmedBombArrivalTimes.delete(key);
  }
  return projectiles;
}

/** Keep a confirmed Upgrade throw visible through the opponent's response and
 * until the upgrading player's next action ends. */
function confirmedUpgradeProjectiles(match: ServerMatchState): ServerProjectile[] {
  const activeKeys = new Set<string>();
  const projectiles: ServerProjectile[] = [];
  for (const owner of [1, 2] as const) {
    const sourceTroopId = match.lastActingTroopId?.[owner];
    if (!sourceTroopId) continue;
    const event = [...(match.events ?? [])].reverse().find(candidate =>
      candidate.player === owner && candidate.action.type === 'upgrade'
      && candidate.action.troopId === sourceTroopId && candidate.action.coordinate);
    if (!event?.action.coordinate) continue;
    const source = match.units.find(unit => unit.owner === owner && unit.troopId === sourceTroopId);
    if (!source) continue;
    const key = serverProjectileKey(owner, source.id, 'upgrade', event.action.coordinate);
    activeKeys.add(key);
    let sourceCoordinate = confirmedUpgradeTrajectorySources.get(key);
    if (!sourceCoordinate) {
      sourceCoordinate = source.coordinate;
      confirmedUpgradeTrajectorySources.set(key, sourceCoordinate);
    }
    projectiles.push({
      key,
      kind: 'upgrade',
      source: sourceCoordinate,
      target: event.action.coordinate,
      damage: 1,
      headMode: playedConfirmedUpgradeHeads.has(key) ? 'none' : 'once',
    });
  }
  for (const key of confirmedUpgradeTrajectorySources.keys()) if (!activeKeys.has(key)) {
    confirmedUpgradeTrajectorySources.delete(key);
    playedConfirmedUpgradeHeads.delete(key);
  }
  return projectiles;
}

function appendServerProjectiles(match: ServerMatchState): void {
  const staged = stagedServerProjectile(match);
  const active = [...confirmedServerProjectiles(match), ...confirmedBombProjectiles(match), ...confirmedUpgradeProjectiles(match), ...(staged ? [staged] : [])];
  const unique = [...new Map(active.map(projectile => [projectile.key, projectile])).values()];
  const activeKeys = new Set(unique.map(projectile => projectile.key));
  for (const key of projectileAnimationStartTimes.keys()) if (!activeKeys.has(key)) projectileAnimationStartTimes.delete(key);
  for (const projectile of unique) {
    if (projectile.presentation === 'ignition' && playedConfirmedBombIgnitions.has(projectile.key)) continue;
    let startedAt = projectileAnimationStartTimes.get(projectile.key);
    if (startedAt === undefined) {
      startedAt = performance.now();
      projectileAnimationStartTimes.set(projectile.key, startedAt);
    }
    // Staged and authoritative delayed projectiles share a stable key. A
    // negative delay lets a confirmation render resume the same cycle instead
    // of visibly launching a duplicate volley from the source.
    const phaseDelay = projectile.headMode === 'once' ? 0 : -(performance.now() - startedAt) % projectileCycleDuration;
    appendServerProjectile(projectile, phaseDelay);
  }
}

const mendingHeartEmoji = '\u2764\uFE0F\u200D\u1FA79';

function appendMendingSweep(target: Point, delay: number): void {
  const heart = document.createElementNS(ns, 'text');
  heart.dataset.serverRender = 'mending-animation';
  heart.classList.add('mending-resolution-heart');
  heart.setAttribute('x', String(target.x));
  heart.setAttribute('y', String(target.y - 9));
  heart.style.animationDelay = `${delay}ms`;
  heart.textContent = mendingHeartEmoji;
  boardPanel.append(heart);
}

function appendMendingFlight(source: Point, target: Point, mode: 'repeat' | 'once', playSweep: boolean): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const trajectory = curvedTrajectory(source, target, Math.max(36, Math.hypot(target.x - source.x, target.y - source.y) * .28));
  if (!reducedMotion) appendProjectileTrail(trajectory, mode === 'once' ? 1 : Infinity);
  const heart = document.createElementNS(ns, 'text');
  heart.dataset.serverRender = 'mending-animation';
  heart.classList.add('mending-flight-heart');
  heart.setAttribute('x', '0');
  heart.setAttribute('y', '0');
  heart.setAttribute('transform', `translate(${trajectory.end.x} ${trajectory.end.y})`);
  heart.textContent = mendingHeartEmoji;
  boardPanel.append(heart);
  const sweepDelay = reducedMotion ? 0 : projectileTravelDuration;
  if (reducedMotion) {
    heart.style.opacity = '.7';
  } else {
    const travelFraction = projectileTravelDuration / projectileCycleDuration;
    const impactFraction = (projectileTravelDuration + projectileImpactDuration) / projectileCycleDuration;
    const frames: Keyframe[] = Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24;
      const point = trajectory.pointAt(progress);
      return {
        translate: `${point.x - trajectory.end.x}px ${point.y - trajectory.end.y}px`,
        opacity: projectileMaterializationOpacity(progress),
        offset: progress * travelFraction,
      };
    });
    frames.push({ translate: '0px 0px', opacity: 0, offset: impactFraction });
    frames.push({ translate: '0px 0px', opacity: 0, offset: 1 });
    heart.animate(frames, {
      duration: projectileCycleDuration,
      iterations: mode === 'once' ? 1 : Infinity,
      easing: 'linear',
      fill: mode === 'once' ? 'forwards' : 'none',
    });
  }
  if (playSweep) appendMendingSweep(target, sweepDelay);
}

function appendServerMendingAnimations(match: ServerMatchState): void {
  const staged = serverPendingAction?.type === 'mending' ? serverPendingAction : undefined;
  if (staged?.coordinate && localMatchPlayer) {
    const source = match.units.find(unit => unit.owner === localMatchPlayer && unit.troopId === staged.troopId);
    const sourcePoint = source ? cellsByCoordinate.get(source.coordinate)?.position : undefined;
    const targetPoint = cellsByCoordinate.get(staged.coordinate)?.position;
    if (!sourcePoint || !targetPoint) return;
    const key = `${match.id}:${localMatchPlayer}:${staged.troopId}:${staged.coordinate}`;
    const playSweep = playedPreviewMendingSweepKey !== key;
    playedPreviewMendingSweepKey = key;
    appendMendingFlight(sourcePoint, targetPoint, 'repeat', playSweep);
    return;
  }
  playedPreviewMendingSweepKey = undefined;
  const latest = match.events?.at(-1);
  if (confirmedMendingAnimationRevision !== match.revision
    || (!replayingLastTurn && latest?.player === localMatchPlayer)
    || latest?.action.type !== 'mending'
    || !latest.action.coordinate) return;
  const source = match.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
  const sourcePoint = source ? cellsByCoordinate.get(source.coordinate)?.position : undefined;
  const targetPoint = cellsByCoordinate.get(latest.action.coordinate)?.position;
  if (sourcePoint && targetPoint) appendMendingFlight(sourcePoint, targetPoint, 'once', true);
}

/** Reveal the modifier used by physical ranged damage after first impact. */
function appendPhysicalDamageModifiers(match: ServerMatchState): void {
  const targets: Array<{ key: string; coordinate: Coordinate; target: ServerUnitState }> = [];
  if (serverPendingAction?.type === 'attack' && serverPendingAction.coordinate && localMatchPlayer) {
    const source = match.units.find(unit => unit.owner === localMatchPlayer && unit.troopId === serverPendingAction?.troopId);
    const target = serverPendingAction.targetUnitId
      ? match.units.find(unit => unit.id === serverPendingAction?.targetUnitId)
      : match.units.find(unit => unit.coordinate === serverPendingAction?.coordinate && unit.owner !== localMatchPlayer);
    const sourceTroop = source ? serverTroop(source.troopId, source.owner) : undefined;
    if (source && target && !actionOfType(sourceTroop!, 'attack')?.qualifiers?.includes('pierce')) targets.push({
      key: serverProjectileKey(localMatchPlayer, source.id, 'attack', serverPendingAction.coordinate),
      coordinate: serverPendingAction.coordinate,
      target,
    });
  }
  for (const effect of match.effects) {
    if (effect.kind !== 'attack' && effect.kind !== 'gore') continue;
    if (effect.pierce) continue;
    const sourceId = effect.sourceUnitId ?? `${effect.owner}:${effect.sourceTroopId}`;
    const target = effect.targetUnitId
      ? match.units.find(unit => unit.id === effect.targetUnitId)
      : match.units.find(unit => unit.coordinate === effect.target && unit.owner !== effect.owner);
    if (target) targets.push({
      key: serverProjectileKey(effect.owner, sourceId, 'attack', effect.target),
      coordinate: effect.target,
      target,
    });
  }
  const activeKeys = new Set(targets.map(target => target.key));
  for (const key of physicalModifierArrivalTimes.keys()) if (!activeKeys.has(key)) physicalModifierArrivalTimes.delete(key);
  for (const { key, coordinate, target } of [...new Map(targets.map(item => [item.key, item])).values()]) {
    const cell = cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    let arrivalTime = physicalModifierArrivalTimes.get(key);
    if (arrivalTime === undefined) {
      arrivalTime = performance.now() + projectileTravelDuration;
      physicalModifierArrivalTimes.set(key, arrivalTime);
    }
    const bash = match.bashes.find(candidate => candidate.target === coordinate && !serverBashIsDodged(candidate, match));
    const x = cell.position.x + (bash ? (serverBashScreenSide(target) === 'left' ? -18 : 18) : 0);
    const label = document.createElementNS(ns, 'text');
    label.dataset.serverRender = 'physical-modifier';
    label.classList.add('bash-stat', 'bash-modifier', target.owner === 1 ? 'player-one-bash' : 'player-two-bash');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
    const modifier = serverModifier(target, coordinate, bash);
    label.textContent = `${modifier >= 0 ? '+' : ''}${modifier}`;
    const remaining = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.max(0, arrivalTime - performance.now());
    if (remaining > 0) {
      label.classList.add('physical-modifier-awaiting-impact');
      window.setTimeout(() => label.classList.remove('physical-modifier-awaiting-impact'), remaining);
    }
    boardPanel.append(label);
  }
}

function signedModifier(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function appendDamageResolutionAnimations(): void {
  for (const animation of damageResolutionAnimations) {
    const cell = cellsByCoordinate.get(animation.coordinate);
    if (!cell) continue;
    let deathCard: SVGGElement | undefined;
    let skull: SVGImageElement | undefined;
    if (animation.killed) {
      const troop = serverTroop(animation.troopId, animation.owner);
      if (troop) {
        deathCard = boardCardMarker(troop, cell.position, cell.cell.dataset.clipId);
        deathCard.dataset.serverRender = 'death-animation';
        deathCard.classList.add('board-troop', 'death-resolution-card');
        cell.cell.append(deathCard);
        const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
        if (artwork) cell.cell.append(artwork);
      }
      skull = document.createElementNS(ns, 'image');
      skull.dataset.serverRender = 'death-animation';
      skull.classList.add('death-resolution-skull');
      skull.setAttribute('href', './assets/skull.png');
      skull.setAttribute('x', String(cell.position.x - 34));
      skull.setAttribute('y', String(cell.position.y - 34));
      skull.setAttribute('width', '68');
      skull.setAttribute('height', '68');
      skull.style.animationDelay = `${animation.delay + damageResolutionDuration}ms`;
      // Death belongs to the impacted hex, not to the authoritative unit node
      // that disappears in the same revision. Ordinary selection/hover
      // rerenders therefore leave the retained card and skull intact.
      cell.cell.append(skull);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        deathCard?.animate([
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: .55 },
          { opacity: 0, offset: 1 },
        ], {
          duration: deathAnimationDuration,
          delay: animation.delay + damageResolutionDuration,
          easing: 'ease-in-out',
          fill: 'forwards',
        });
      }
    }
    // Hide the already-updated authoritative row immediately. Delayed
    // presentations (Bomb explosion or replayed projectile flight) keep the
    // old value visible until their slash actually begins.
    cell.cell.classList.add('damage-resolving');
    const slash = document.createElementNS(ns, 'image');
    slash.dataset.serverRender = 'damage-resolution';
    slash.classList.add('damage-resolution-slash');
    slash.style.animationDelay = `${animation.delay}ms`;
    slash.setAttribute('href', './assets/slash.png');
    slash.setAttribute('x', String(cell.position.x - 34));
    slash.setAttribute('y', String(cell.position.y - 43));
    slash.setAttribute('width', '68');
    slash.setAttribute('height', '68');
    boardPanel.append(slash);

    const health = document.createElementNS(ns, 'text');
    health.dataset.serverRender = 'damage-resolution';
    health.classList.add('bash-stat', 'damage-resolution-health', animation.owner === 1 ? 'player-one-health' : 'player-two-health');
    const healthX = cell.position.x + (animation.bashSide === 'left' ? -18 : animation.bashSide === 'right' ? 18 : 0);
    health.setAttribute('x', String(healthX));
    health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
    const healthText = (actual: number): string => animation.bashSide
      ? `♥ ${actual}`
      : `${actual} ♥ ${animation.totalHealth}`;
    health.textContent = healthText(animation.oldHealth);
    const bashHealth = [...cell.cell.querySelectorAll<SVGTextElement>('.bash-health')]
      .find(label => label.dataset.unitId === animation.targetId);
    if (bashHealth) bashHealth.style.opacity = '0';
    boardPanel.append(health);

    let modifier: SVGTextElement | undefined;
    if (animation.includesPhysical && !animation.ignoresModifier) {
      modifier = document.createElementNS(ns, 'text');
      modifier.dataset.serverRender = 'damage-resolution';
      modifier.classList.add('bash-stat', 'bash-modifier', animation.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(healthX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(animation.oldModifier);
      boardPanel.append(modifier);
      const absorbed = Math.min(Math.max(0, animation.oldModifier), animation.physicalDamage);
      for (let step = 1; step <= 4; step += 1) window.setTimeout(() => {
        if (modifier) modifier.textContent = signedModifier(Math.round(animation.oldModifier - absorbed * step / 4));
      }, animation.delay + step * 120);
    }
    const healthLoss = Math.max(0, animation.oldHealth - animation.newHealth);
    const healthCountdownStart = animation.includesPhysical ? 600 : 120;
    for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
      const actual = Math.round(animation.oldHealth - healthLoss * step / 5);
      health.textContent = healthText(actual);
    }, animation.delay + healthCountdownStart + step * 150);
    window.setTimeout(() => {
      slash.remove();
      modifier?.remove();
      if (animation.killed) {
        cell.cell.classList.remove('damage-resolving');
        health.remove();
      } else {
        // Keep the final authoritative value mounted until the next ordinary
        // board render. Relying on the underlying row alone can leave a blank
        // stat area after replay/resolution until hover causes another render.
        health.textContent = healthText(animation.newHealth);
        health.style.opacity = '1';
      }
    }, animation.delay + damageResolutionDuration);
    if (animation.killed) window.setTimeout(() => {
      deathCard?.remove();
      skull?.remove();
    }, animation.delay + damageResolutionDuration + deathAnimationDuration);
  }
}

function appendBombExplosionAnimations(): void {
  for (const coordinate of explosionAffectedCoordinates) {
    const cell = cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const highlight = document.createElementNS(ns, 'polygon');
    highlight.dataset.serverRender = 'bomb-explosion';
    highlight.classList.add('bomb-explosion', 'bomb-explosion-highlight');
    highlight.style.animationDelay = `${explosionResolutionDelay}ms`;
    highlight.setAttribute('points', hexPoints(cell.position.x, cell.position.y));
    boardPanel.append(highlight);
  }
  for (const coordinate of explosionResolutionCoordinates) {
    const cell = cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const explosion = document.createElementNS(ns, 'image');
    explosion.dataset.serverRender = 'bomb-explosion';
    explosion.classList.add('bomb-explosion');
    explosion.style.animationDelay = `${explosionResolutionDelay}ms`;
    explosion.setAttribute('href', './assets/explosion-purple.png');
    explosion.setAttribute('x', String(cell.position.x - bombExplosionSize / 2));
    explosion.setAttribute('y', String(cell.position.y - bombExplosionSize / 2 - 20));
    explosion.setAttribute('width', String(bombExplosionSize));
    explosion.setAttribute('height', String(bombExplosionSize));
    boardPanel.append(explosion);
  }
}

function appendBashResolutionAnimations(match: ServerMatchState): void {
  for (const animation of bashResolutionAnimations) {
    const cell = cellsByCoordinate.get(animation.bash.target);
    if (!cell) continue;
    cell.cell.classList.add('bash-resolving');
    const units = [animation.attacker, animation.defender].sort((left, right) => right.owner - left.owner);
    const firstStrike = animation.firstStrike;
    const firstStrikeTarget = firstStrike ? [animation.attacker, animation.defender].find(unit => unit.id === firstStrike.targetId) : undefined;
    const firstStrikeTargetSurvives = Boolean(firstStrike?.targetSurvived && firstStrikeTarget);
    const combatDuration = firstStrike
      ? damageResolutionDuration * (firstStrikeTargetSurvives ? 2 : 1)
      : damageResolutionDuration;
    const sliderStart = animation.delay + combatDuration;
    const sideOf = (unit: ServerUnitState): 'left' | 'right' => unit.owner === 2 ? 'left' : 'right';
    const appendSlash = (unit: ServerUnitState | undefined, delay: number): void => {
      const slash = document.createElementNS(ns, 'image');
      slash.dataset.serverRender = 'bash-resolution';
      slash.classList.add('damage-resolution-slash');
      slash.style.animationDelay = `${delay}ms`;
      slash.setAttribute('href', './assets/slash.png');
      const side = unit ? sideOf(unit) : undefined;
      slash.setAttribute('x', String(cell.position.x + (side === 'left' ? -18 : side === 'right' ? 18 : 0) - 34));
      slash.setAttribute('y', String(cell.position.y - 43));
      slash.setAttribute('width', '68');
      slash.setAttribute('height', '68');
      boardPanel.append(slash);
    };
    if (firstStrike) {
      appendSlash(firstStrikeTarget, animation.delay);
      if (firstStrikeTargetSurvives) {
        const firstStrikeUnit = units.find(unit => unit.id === firstStrike.unitId);
        appendSlash(firstStrikeUnit, animation.delay + damageResolutionDuration);
      }
    } else appendSlash(undefined, animation.delay);
    for (const [index, unit] of units.entries()) {
      const side = index === 0 ? 'left' : 'right';
      const troop = serverTroop(unit.troopId, unit.owner, unit);
      if (!troop) continue;
      const picture = boardCardMarker(troop, cell.position);
      picture.dataset.serverRender = 'bash-resolution';
      picture.classList.add('board-troop', 'bash-troop-picture', side === 'left' ? 'bash-left-picture' : 'bash-right-picture');
      cell.cell.append(picture);
      const statX = cell.position.x + (side === 'left' ? -18 : 18);
      const ui = document.createElementNS(ns, 'g');
      ui.dataset.serverRender = 'bash-resolution';
      const health = document.createElementNS(ns, 'text');
      health.classList.add('bash-stat', 'bash-health', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      health.setAttribute('x', String(statX));
      health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
      health.textContent = `♥ ${unit.currentHealth}`;
      const modifier = document.createElementNS(ns, 'text');
      modifier.classList.add('bash-stat', 'bash-modifier', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(statX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(unit.combat.modifier);
      ui.append(health, modifier);
      cell.cell.append(ui);
      const won = unit.id === animation.winnerId;
      const finalClip = won ? 'inset(0)' : side === 'left' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
      picture.animate([{ clipPath: getComputedStyle(picture).clipPath }, { clipPath: finalClip, opacity: won ? 1 : 0 }], {
        duration: 420,
        delay: sliderStart,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      ui.animate([
        { opacity: 1, translate: '0 0' },
        { opacity: won ? 1 : 0, translate: won ? `${side === 'left' ? 18 : -18}px 0` : '0 0' },
      ], { duration: 420, delay: sliderStart, easing: 'ease-in-out', fill: 'forwards' });
      const nextUnit = match.units.find(candidate => candidate.id === unit.id);
      const finalHealth = nextUnit?.currentHealth ?? 0;
      const isFirstStrikeTarget = firstStrike?.targetId === unit.id;
      const isFirstStrikeUnit = firstStrike?.unitId === unit.id;
      const firstStrikeTargetHealth = firstStrikeTarget && isFirstStrikeTarget
        ? Math.max(0, unit.currentHealth - firstStrike.firstDamage)
        : undefined;
      const healthStart = isFirstStrikeUnit && firstStrikeTargetSurvives
        ? animation.delay + damageResolutionDuration
        : animation.delay;
      const healthEnd = isFirstStrikeTarget && firstStrikeTargetHealth !== undefined && firstStrikeTargetSurvives
        ? firstStrikeTargetHealth
        : finalHealth;
      for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
        const actual = Math.round(unit.currentHealth - (unit.currentHealth - healthEnd) * step / 5);
        health.textContent = `♥ ${actual}`;
      }, healthStart + 600 + step * 150);
      if (isFirstStrikeTarget && firstStrikeTargetSurvives) {
        for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
          const actual = Math.round((firstStrikeTargetHealth ?? unit.currentHealth) - ((firstStrikeTargetHealth ?? unit.currentHealth) - finalHealth) * step / 5);
          health.textContent = `♥ ${actual}`;
        }, animation.delay + damageResolutionDuration + 600 + step * 150);
      }
      window.setTimeout(() => modifier.remove(), sliderStart);
      window.setTimeout(() => {
        cell.cell.classList.remove('bash-resolving');
        picture.remove();
        ui.remove();
      }, sliderStart + 430);
    }
    const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
    if (artwork) cell.cell.append(artwork);
  }
}

/** Unlit bombs coexist with units beside the same vertex used by the preview. */
function appendServerBombs(match: ServerMatchState): void {
  const preview = serverPendingAction?.type === 'magic' ? serverPendingAction : undefined;
  const latest = match.events?.at(-1);
  const pendingPush = (serverPendingAction?.type === 'push' || serverPendingAction?.type === 'pull') && serverPendingAction.targetBomb ? serverPendingAction : undefined;
  const confirmedPush = confirmedMovementAnimationRevision === match.revision
    && (latest?.action.type === 'push' || latest?.action.type === 'pull') && latest.action.targetBomb ? latest.action : undefined;
  const bombPush = pendingPush ?? confirmedPush;
  const pushOrigin = pendingPush?.coordinate ?? (confirmedPush ? latest?.origin : undefined);
  const pushDestination = bombPush?.destination;
  const sourceBomb = pendingPush && pushOrigin ? match.bombs?.find(bomb => bomb.coordinate === pushOrigin) : undefined;
  const landingBomb = pendingPush && pushDestination ? match.bombs?.find(bomb => bomb.coordinate === pushDestination) : undefined;
  const displayedBombs = sourceBomb && pushDestination
    ? [
        ...(match.bombs ?? []).filter(bomb => bomb !== sourceBomb && bomb !== landingBomb),
        { ...(landingBomb ?? sourceBomb), coordinate: pushDestination, damage: sourceBomb.damage + (landingBomb?.damage ?? 0) },
      ]
    : [...(match.bombs ?? [])];
  const activePreviewKeys = new Set<string>();
  for (const bomb of displayedBombs) {
    const target = cellsByCoordinate.get(bomb.coordinate); if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    // Match the endpoint used by the shared Bomb projectile trajectory.
    const centre = bombIconCentre(target.position);
    const ignitionKey = `preview-ignition:${match.id}:${preview?.troopId ?? ''}:${bomb.coordinate}`;
    const previewIgnitesBomb = preview?.coordinate === bomb.coordinate;
    if (previewIgnitesBomb) activePreviewKeys.add(ignitionKey);
    positionBombIcon(marker, centre);
    const litMarker = switchBombIconOnArrival(marker, ignitionKey, previewIgnitesBomb);
    const label = appendBombDamageLabel(target.cell, centre, bomb.damage);
    if (pushOrigin && pushDestination === bomb.coordinate) {
      const origin = cellsByCoordinate.get(pushOrigin)?.position;
      if (origin) for (const element of [marker, label]) {
        element.classList.add('bomb-push-animation');
        element.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
        element.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
      }
    }
    const key = serverProjectileKey(bomb.owner, bomb.sourceTroopId, 'bomb', bomb.coordinate);
    const arrivalTime = confirmedBombArrivalTimes.get(key);
    const remainingTravel = arrivalTime === undefined || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : Math.max(0, arrivalTime - performance.now());
    if (remainingTravel > 0) {
      marker.classList.add('bomb-awaiting-arrival');
      label.classList.add('bomb-awaiting-arrival');
      window.setTimeout(() => {
        marker.classList.remove('bomb-awaiting-arrival');
        label.classList.remove('bomb-awaiting-arrival');
      }, remainingTravel);
    }
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
  for (const key of bombIgnitionArrivalTimes.keys()) {
    if (key.startsWith('preview-ignition:') && !activePreviewKeys.has(key)) bombIgnitionArrivalTimes.delete(key);
  }
}

function appendConfirmedIgnitedBomb(match: ServerMatchState): void {
  const latest = match.events?.at(-1);
  const centerEffects = new Map<Coordinate, ServerEffectState>();
  for (const effect of match.effects) {
    if (effect.kind !== 'bomb' || !effect.origin || effect.target !== effect.origin) continue;
    centerEffects.set(effect.origin, effect);
  }
  // Persisted matches created before bomb origins were recorded can still
  // identify a direct Fire Magic ignition from the latest action.
  if (latest?.action.type === 'magic' && latest.action.coordinate && !centerEffects.has(latest.action.coordinate)) {
    const legacyCenter = match.effects.find(effect => effect.kind === 'bomb' && effect.target === latest.action.coordinate);
    if (legacyCenter) centerEffects.set(latest.action.coordinate, legacyCenter);
  }
  for (const [coordinate, effect] of centerEffects) {
    const target = cellsByCoordinate.get(coordinate);
    if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    const centre = bombIconCentre(target.position);
    positionBombIcon(marker, centre);
    const key = `confirmed-ignition:${match.id}:${match.revision}:${coordinate}`;
    const isConfirmedFireIgnition = latest?.action.type === 'magic' && latest.action.coordinate === coordinate;
    const waitsForOpponentPlayback = isConfirmedFireIgnition
      && (replayingLastTurn || latest.player !== localMatchPlayer)
      && bombIgnitionArrivalTimes.has(key);
    let litMarker: SVGImageElement | undefined;
    if (waitsForOpponentPlayback) litMarker = switchBombIconOnArrival(marker, key, true);
    else marker.setAttribute('href', './assets/bomb-light.png');
    appendBombDamageLabel(target.cell, centre, effect.value);
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
}

function effectIdentity(effect: ServerEffectState): string {
  return `${effect.owner}:${effect.sourceUnitId ?? effect.sourceTroopId}:${effect.kind}:${effect.pierce ? 'pierce' : ''}:${effect.origin ?? ''}:${effect.target}:${effect.targetUnitId ?? ''}`;
}

function resolvedDamageAnimations(previous: ServerMatchState | undefined, next: ServerMatchState, explosionDelay = 0): DamageResolutionAnimation[] {
  if (!previous || previous.id !== next.id) return [];
  const nextEffectCounts = new Map<string, number>();
  for (const effect of next.effects) {
    const key = effectIdentity(effect);
    nextEffectCounts.set(key, (nextEffectCounts.get(key) ?? 0) + 1);
  }
  const removed = previous.effects.filter(effect => {
    if (effect.kind !== 'attack' && effect.kind !== 'gore' && effect.kind !== 'magic' && effect.kind !== 'cannon' && effect.kind !== 'bomb') return false;
    const key = effectIdentity(effect);
    const remaining = nextEffectCounts.get(key) ?? 0;
    if (remaining <= 0) return true;
    nextEffectCounts.set(key, remaining - 1);
    return false;
  });
  const grouped = new Map<string, { target: ServerUnitState; effects: ServerEffectState[] }>();
  const latest = next.events?.at(-1);
  for (const effect of removed) {
    const resolvesAgainstHex = effect.kind === 'bomb' || effect.kind === 'cannon';
    const defeatedArrival = resolvesAgainstHex && latest?.action.coordinate === effect.target
      && (latest.action.type === 'move' || latest.action.type === 'fly' || latest.action.type === 'resolve-move')
      ? previous.units.find(unit => unit.owner === latest.player
        && unit.troopId === latest.action.troopId
        && !next.units.some(candidate => candidate.id === unit.id))
      : resolvesAgainstHex && (latest?.action.type === 'push' || latest?.action.type === 'pull')
        && latest.action.destination === effect.target
        && latest.action.targetUnitId
        ? previous.units.find(unit => unit.id === latest.action.targetUnitId
          && !next.units.some(candidate => candidate.id === unit.id))
        : undefined;
    const defeatedDeployment = resolvesAgainstHex && latest?.action.type === 'deploy'
      && latest.action.coordinate === effect.target
      && !next.units.some(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId)
      ? catalogueById.get(latest.action.troopId)
      : undefined;
    const defeatedDeploymentUnit: ServerUnitState | undefined = defeatedDeployment ? {
      id: `${latest?.player}:${latest?.action.troopId}`,
      troopId: latest!.action.troopId,
      owner: latest!.player,
      coordinate: effect.target,
      permanentDamage: 0,
      currentHealth: defeatedDeployment.baseHealth,
      combat: { health: defeatedDeployment.baseHealth, modifier: 0, magicModifier: 0, modifiers: [], total: defeatedDeployment.baseHealth },
    } : undefined;
    const targets = resolvesAgainstHex
      ? [
          // Hex effects resolve after the triggering action. Use occupants
          // from the resulting board so a troop that just moved into the
          // blast receives its own slash, but recover its pre-damage snapshot
          // for the health countdown.
          ...next.units
            .filter(unit => unit.coordinate === effect.target)
            .map(unit => previous.units.find(candidate => candidate.id === unit.id) ?? unit),
          // A defeated stationary occupant no longer exists in `next`; retain
          // it only when it did not survive elsewhere on the board.
          ...previous.units.filter(unit => unit.coordinate === effect.target
            && !next.units.some(candidate => candidate.id === unit.id)),
          ...(defeatedArrival ? [defeatedArrival] : []),
          ...(defeatedDeploymentUnit ? [defeatedDeploymentUnit] : []),
        ]
      : [effect.targetUnitId
          ? previous.units.find(unit => unit.id === effect.targetUnitId)
          : previous.units.find(unit => unit.coordinate === effect.target && unit.owner !== effect.owner)]
        .filter((target): target is ServerUnitState => Boolean(target));
    for (const target of [...new Map(targets.map(candidate => [candidate.id, candidate])).values()]) {
      const nextTarget = next.units.find(unit => unit.id === target.id);
      // A targeted delayed effect is dodged when that unit leaves its recorded
      // coordinate; Bomb and Cannon instead resolve against occupants of their
      // affected hexes, including friendly troops.
      if (effect.kind !== 'bomb' && nextTarget && nextTarget.coordinate !== effect.target) continue;
      const entry = grouped.get(target.id) ?? { target, effects: [] };
      entry.effects.push(effect);
      grouped.set(target.id, entry);
    }
  }
  return [...grouped.values()].map(({ target, effects }) => {
    const nextTarget = next.units.find(unit => unit.id === target.id);
    const physicalEffects = effects.filter(effect => effect.kind === 'attack' || effect.kind === 'gore');
    const bash = [...previous.bashes, ...next.bashes].find(candidate => candidate.target === (effects[0]?.target ?? target.coordinate)
      && (candidate.attackerId === target.id || candidate.defenderId === target.id));
    const bashSide: DamageResolutionAnimation['bashSide'] = bash
      ? (target.owner === 2 ? 'left' : 'right')
      : undefined;
    const animation = {
      targetId: target.id,
      troopId: target.troopId,
      coordinate: effects[0]?.target ?? target.coordinate,
      owner: target.owner,
      oldHealth: target.currentHealth,
      newHealth: nextTarget?.currentHealth ?? 0,
      totalHealth: catalogueById.get(target.troopId)?.baseHealth ?? target.currentHealth,
      oldModifier: target.combat.modifier,
      physicalDamage: physicalEffects.filter(effect => !effect.pierce).reduce((sum, effect) => sum + effect.value, 0),
      includesPhysical: physicalEffects.length > 0,
      ignoresModifier: physicalEffects.length > 0 && physicalEffects.every(effect => effect.pierce),
      delay: effects.some(effect => effect.kind === 'bomb')
        ? explosionDelay + bombExplosionDuration
        : replayingLastTurn && effects.some(effect => effect.kind === 'attack' || effect.kind === 'gore' || effect.kind === 'magic' || effect.kind === 'cannon')
          ? projectileTravelDuration + projectileImpactDuration
          : 0,
      killed: nextTarget === undefined,
      bashSide,
    };
    return animation;
  });
}

function resolvedProjectilesForReplay(previous: ServerMatchState | undefined, next: ServerMatchState): ServerProjectile[] {
  if (!previous || previous.id !== next.id) return [];
  const nextEffectCounts = new Map<string, number>();
  for (const effect of next.effects) {
    const key = effectIdentity(effect);
    nextEffectCounts.set(key, (nextEffectCounts.get(key) ?? 0) + 1);
  }
  const removed = previous.effects.filter(effect => {
    if (effect.kind !== 'attack' && effect.kind !== 'gore' && effect.kind !== 'magic' && effect.kind !== 'cannon') return false;
    const key = effectIdentity(effect);
    const remaining = nextEffectCounts.get(key) ?? 0;
    if (remaining <= 0) return true;
    nextEffectCounts.set(key, remaining - 1);
    return false;
  });
  if (removed.length === 0) return [];
  const replayState: ServerMatchState = { ...previous, effects: removed, events: [] };
  return confirmedServerProjectiles(replayState).map(projectile => ({
    ...projectile,
    key: `replay-resolved:${next.revision}:${projectile.key}`,
    headMode: 'once',
    trailMode: 'once',
  }));
}

function resolvedBombExplosion(previous: ServerMatchState | undefined, next: ServerMatchState): { origins: Coordinate[]; affected: Coordinate[] } {
  if (!previous || previous.id !== next.id) return { origins: [], affected: [] };
  const nextEffectCounts = new Map<string, number>();
  for (const effect of next.effects) {
    const key = effectIdentity(effect);
    nextEffectCounts.set(key, (nextEffectCounts.get(key) ?? 0) + 1);
  }
  const removed = previous.effects.filter(effect => {
    if (effect.kind !== 'bomb') return false;
    const key = effectIdentity(effect);
    const remaining = nextEffectCounts.get(key) ?? 0;
    if (remaining <= 0) return true;
    nextEffectCounts.set(key, remaining - 1);
    return false;
  });
  const origins = [...new Set(removed.map(effect => effect.origin ?? effect.target))];
  return {
    origins,
    affected: [...new Set(origins.flatMap(origin => [origin, ...adjacentCoordinates(origin)]))],
  };
}

function confirmedOneTimeActionDuration(match: ServerMatchState): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const latest = match.events?.at(-1);
  if (!latest || (!replayingLastTurn && latest.player === localMatchPlayer)) return 0;
  if (latest.action.type === 'deploy') return deploymentAnimationDuration;
  if (latest.action.type === 'push' || latest.action.type === 'pull') return pushAnimationDuration;
  if (latest.action.type === 'move' || latest.action.type === 'fly') return movementAnimationDuration;
  return 0;
}

function resolvedBashAnimations(previous: ServerMatchState | undefined, next: ServerMatchState): BashResolutionAnimation[] {
  if (!previous || previous.id !== next.id) return [];
  const previousTriggerCounts = new Map<string, number>();
  for (const event of previous.triggerEvents ?? []) {
    const key = JSON.stringify(event);
    previousTriggerCounts.set(key, (previousTriggerCounts.get(key) ?? 0) + 1);
  }
  const newBashResolutions = (next.triggerEvents ?? []).filter(event => {
    const key = JSON.stringify(event);
    const previousCount = previousTriggerCounts.get(key) ?? 0;
    if (previousCount > 0) {
      previousTriggerCounts.set(key, previousCount - 1);
      return false;
    }
    return event.trigger === 'bashResolved';
  });
  const latest = next.events?.at(-1);
  const playsConfirmedShield = replayingLastTurn || latest?.player !== localMatchPlayer;
  const shieldDelay = playsConfirmedShield && latest?.action.type === 'self-defense'
    ? shieldFrameDuration * shieldFrameCount
    : playsConfirmedShield && latest?.action.type === 'defense'
      ? projectileTravelDuration + shieldFrameDuration * shieldFrameCount
      : 0;
  return previous.bashes
    .filter(bash => !next.bashes.some(candidate => candidate.attackerId === bash.attackerId && candidate.defenderId === bash.defenderId && candidate.target === bash.target))
    .filter(bash => newBashResolutions.some(event => event.hex === bash.target
      && event.attackerId === bash.attackerId
      && event.defenderId === bash.defenderId))
    .flatMap(bash => {
      const attacker = previous.units.find(unit => unit.id === bash.attackerId);
      const defender = previous.units.find(unit => unit.id === bash.defenderId);
      if (!attacker || !defender) return [];
      const survivingParticipants = [attacker, defender].filter(unit => next.units.some(candidate => candidate.id === unit.id));
      const winner = survivingParticipants.length === 1 ? survivingParticipants[0] : undefined;
      const resolution = newBashResolutions.find(event => event.hex === bash.target
        && event.attackerId === bash.attackerId
        && event.defenderId === bash.defenderId);
      return [{ bash, attacker, defender, winnerId: winner?.id, delay: shieldDelay, firstStrike: resolution?.firstStrike }];
    });
}

function renderServerMatchState(match: ServerMatchState): void {
  if (!serverMatch || serverMatch.id !== match.id) {
    serverHoverPreviewCoordinate = undefined;
  }
  // A new revision is an authoritative action (or sandbox placement), not a
  // local selection echo. Clear the previous side's card/action before control
  // passes; both fixed trays share card IDs across their separate owners.
  const previousMatch = serverMatch;
  const stateAdvanced = previousMatch?.id === match.id && previousMatch.revision !== match.revision;
  if (stateAdvanced && !replayingLastTurn && previousMatch
    && (match.events?.length ?? 0) > (previousMatch.events?.length ?? 0)) {
    lastTurnReplayBefore = structuredClone(previousMatch);
    lastTurnReplayAfter = structuredClone(match);
  }
  const latestEvent = match.events?.at(-1);
  const resolvedExplosion = stateAdvanced
    ? resolvedBombExplosion(previousMatch, match)
    : { origins: [], affected: [] };
  explosionResolutionCoordinates = resolvedExplosion.origins;
  explosionAffectedCoordinates = resolvedExplosion.affected;
  explosionResolutionDelay = resolvedExplosion.origins.length > 0 ? confirmedOneTimeActionDuration(match) : 0;
  damageResolutionAnimations = stateAdvanced ? resolvedDamageAnimations(previousMatch, match, explosionResolutionDelay) : [];
  bashResolutionAnimations = stateAdvanced ? resolvedBashAnimations(previousMatch, match) : [];
  replayResolvedProjectiles = stateAdvanced && replayingLastTurn ? resolvedProjectilesForReplay(previousMatch, match) : [];
  confirmedDeploymentAnimationRevision = stateAdvanced ? match.revision : undefined;
  confirmedDefenseAnimationRevision = stateAdvanced
    && (latestEvent?.action.type === 'defense' || latestEvent?.action.type === 'self-defense')
    ? match.revision
    : undefined;
  confirmedMendingAnimationRevision = stateAdvanced && latestEvent?.action.type === 'mending'
    ? match.revision
    : undefined;
  if (stateAdvanced && latestEvent?.action.type === 'bomb' && latestEvent.action.coordinate) {
    const key = serverProjectileKey(latestEvent.player, latestEvent.action.troopId, 'bomb', latestEvent.action.coordinate);
    confirmedBombArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  if (stateAdvanced
    && latestEvent?.action.type === 'magic'
    && latestEvent.action.coordinate
    && (replayingLastTurn || latestEvent.player !== localMatchPlayer)
    && previousMatch?.bombs?.some(bomb => bomb.coordinate === latestEvent.action.coordinate)
    && match.effects.some(effect => effect.kind === 'bomb' && effect.target === latestEvent.action.coordinate)) {
    const key = `confirmed-ignition:${match.id}:${match.revision}:${latestEvent.action.coordinate}`;
    bombIgnitionArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  confirmedBashAnimationRevision = stateAdvanced
    && (replayingLastTurn || latestEvent?.player !== localMatchPlayer || latestEvent?.action.type === 'gore')
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore')
    && match.bashes.some(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    ? match.revision
    : undefined;
  confirmedMovementAnimationRevision = stateAdvanced
    && (replayingLastTurn || latestEvent?.player !== localMatchPlayer || latestEvent?.action.type === 'gore')
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore' || latestEvent?.action.type === 'push' || latestEvent?.action.type === 'pull')
    && latestEvent.origin
    ? match.revision
    : undefined;
  if (stateAdvanced && !replayingLastTurn) {
    serverSelectedTroopId = undefined;
    serverSelectedAction = undefined;
    serverPendingAction = undefined;
    queuedMovementPreviewOrigin = undefined;
    queuedMovementPreviewReturn = undefined;
    serverPushTargetChoices = [];
    serverInspectedUnitId = undefined;
    lastMovementInspection = undefined;
    lastDeploymentInspection = undefined;
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
  const visibleBashes = match.bashes.filter(bash => !serverBashIsDodged(bash, match)
    && bash.target !== serverHoverPreviewCoordinate);
  const bashingIds = new Set(visibleBashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const revealedBash = match.bashes.find(bash => bash.target === serverHoverPreviewCoordinate && !serverBashIsDodged(bash, match));
  const revealedBashingIds = new Set(revealedBash ? [revealedBash.attackerId, revealedBash.defenderId] : []);
  const revealedUnitId = revealedBash ? (serverBashReveal === 'attacker' ? revealedBash.attackerId : revealedBash.defenderId) : undefined;
  const pendingBash = serverPendingBash();
  const previewDefenderId = pendingBash?.defenderId;
  const revealPendingBash = pendingBash?.target === serverHoverPreviewCoordinate;
  const unitPreviews = serverPendingUnitPreviews();
  const movementPreview = serverPendingMovementPreview();
  const movementPreviewType = serverPendingActionForPreview()?.type;
  const queuedPreviewOrigin = movementPreview
    && queuedMovementPreviewOrigin?.unitId === movementPreview.unit.id
    && queuedMovementPreviewOrigin.destination === movementPreview.coordinate
    ? queuedMovementPreviewOrigin
    : undefined;
  const confirmedIntroBash = confirmedBashAnimationRevision === match.revision && latestEvent?.origin
    ? visibleBashes.find(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    : undefined;
  const confirmedMovementAction = confirmedMovementAnimationRevision === match.revision && latestEvent?.origin
    ? latestEvent.action as typeof latestEvent.action & { targetUnitId?: string; targetBomb?: boolean; destination?: Coordinate }
    : undefined;
  const confirmedMovementUnit = confirmedMovementAction
    ? confirmedMovementAction.type === 'push' || confirmedMovementAction.type === 'pull'
      ? confirmedMovementAction.targetBomb
        ? undefined
        : confirmedMovementAction.targetUnitId
        ? match.units.find(unit => unit.id === confirmedMovementAction.targetUnitId)
        : match.units.find(unit => unit.coordinate === confirmedMovementAction.destination)
      : match.units.find(unit => unit.owner === latestEvent?.player && unit.troopId === confirmedMovementAction.troopId)
    : undefined;
  const returningPreviewUnit = queuedMovementPreviewReturn
    ? match.units.find(unit => unit.id === queuedMovementPreviewReturn?.unitId)
    : undefined;
  const inspectedMovementUnit = lastMovementInspection
    ? match.units.find(unit => unit.id === lastMovementInspection?.unitId)
    : undefined;
  const inspectedDeploymentUnit = lastDeploymentInspection
    ? match.units.find(unit => unit.id === lastDeploymentInspection?.unitId)
    : undefined;
  const previewUnitIds = new Set(unitPreviews.map(unit => unit.id));
  for (const unit of match.units) if (!bashingIds.has(unit.id)
    && (!revealedBashingIds.has(unit.id) || unit.id === revealedUnitId)
    && (unit.id !== previewDefenderId || revealPendingBash)
    && !previewUnitIds.has(unit.id)
    && unit.id !== returningPreviewUnit?.id
    && (unit.id !== confirmedMovementUnit?.id || Boolean(confirmedIntroBash))
    && unit.id !== inspectedMovementUnit?.id
    && unit.id !== inspectedDeploymentUnit?.id) appendServerBoardUnit(unit);
  // A pending move has two simultaneous visual halves: retain a temporary
  // source copy that dissolves downward, while its projected destination copy
  // materializes upward into the new hex.
  if (movementPreview && movementPreviewType !== 'push' && movementPreviewType !== 'pull') {
    const sourceCoordinate = queuedPreviewOrigin?.coordinate ?? movementPreview.unit.coordinate;
    appendServerBoardUnit(
      { ...movementPreview.unit, coordinate: sourceCoordinate },
      'move-out',
      undefined,
      queuedPreviewOrigin?.wasBash ? serverBashScreenSide(movementPreview.unit) : undefined,
    );
  }
  for (const unit of unitPreviews) {
    const isMovementDestination = movementPreview?.unit.id === unit.id && movementPreview.coordinate === unit.coordinate;
    const transition = isMovementDestination ? (movementPreviewType === 'push' || movementPreviewType === 'pull' ? 'push-in' : 'move-in') : undefined;
    // The bash renderer owns the destination attacker: only its clipped half
    // materializes, while the defender remains static throughout.
    if (pendingBash?.attackerId !== unit.id) appendServerBoardUnit(unit, transition, queuedPreviewOrigin?.coordinate ?? movementPreview?.unit.coordinate);
  }
  if (returningPreviewUnit && queuedMovementPreviewReturn) {
    appendServerBoardUnit(
      { ...returningPreviewUnit, coordinate: queuedMovementPreviewReturn.coordinate },
      'move-out',
      undefined,
      queuedMovementPreviewReturn.wasBash ? serverBashScreenSide(returningPreviewUnit) : undefined,
    );
    appendServerBoardUnit(returningPreviewUnit, 'move-in');
  }
  if (inspectedMovementUnit && lastMovementInspection) {
    const inspection = lastMovementInspection;
    if (inspection.type === 'push' || inspection.type === 'pull') {
      appendServerBoardUnit(inspectedMovementUnit, 'push-inspect', inspection.origin);
    } else {
      appendServerBoardUnit({ ...inspectedMovementUnit, coordinate: inspection.origin }, 'move-inspect-origin');
      appendServerBoardUnit(inspectedMovementUnit, 'move-inspect-destination');
    }
  }
  if (inspectedDeploymentUnit && lastDeploymentInspection) {
    appendServerBoardUnit(inspectedDeploymentUnit, lastDeploymentInspection.direction === 1 ? 'deploy-in' : 'deploy-out');
  }
  if (confirmedMovementUnit && latestEvent?.origin && !confirmedIntroBash) {
    if (confirmedMovementAction?.type === 'push' || confirmedMovementAction?.type === 'pull') appendServerBoardUnit(confirmedMovementUnit, 'push-in', latestEvent.origin);
    else {
      appendServerBoardUnit({ ...confirmedMovementUnit, coordinate: latestEvent.origin }, 'move-out');
      appendServerBoardUnit(confirmedMovementUnit, 'move-in');
    }
  }
  if (confirmedIntroBash && latestEvent?.origin) {
    const attacker = match.units.find(unit => unit.id === confirmedIntroBash.attackerId);
    if (attacker) {
      appendServerBoardUnit({ ...attacker, coordinate: latestEvent.origin }, 'move-out');
    }
  }
  for (const bash of visibleBashes) appendServerBash(bash, true, bash === confirmedIntroBash);
  // A pending bash is independent of bashes already waiting elsewhere on the
  // board. Draw all confirmed bashes and the prospective one together.
  appendServerPreviewBash();
  appendServerBombs(match);
  appendConfirmedIgnitedBomb(match);
  renderServerActionBar(match, local);
  renderServerActionTargets();
  appendServerHexBorderOverlays();
  appendServerProjectiles(match);
  for (const projectile of replayResolvedProjectiles) appendServerProjectile(projectile);
  appendServerMendingAnimations(match);
  appendPhysicalDamageModifiers(match);
  appendServerDefenseAnimations(match);
  appendServerMagicShieldAnimations(match, previousMatch);
  appendServerStunAnimations(match);
  appendBombExplosionAnimations();
  appendDamageResolutionAnimations();
  appendBashResolutionAnimations(match);
  confirmedDeploymentAnimationRevision = undefined;
  confirmedBashAnimationRevision = undefined;
  confirmedMovementAnimationRevision = undefined;
  confirmedDefenseAnimationRevision = undefined;
  confirmedMendingAnimationRevision = undefined;
  damageResolutionAnimations = [];
  explosionResolutionCoordinates = [];
  explosionAffectedCoordinates = [];
  explosionResolutionDelay = 0;
  bashResolutionAnimations = [];
  replayResolvedProjectiles = [];
  if (queuedPreviewOrigin === queuedMovementPreviewOrigin) queuedMovementPreviewOrigin = undefined;
  queuedMovementPreviewReturn = undefined;
}

function replayLastTurnAnimation(): void {
  if (!serverMatch || !lastTurnReplayBefore || !lastTurnReplayAfter
    || serverMatch.id !== lastTurnReplayAfter.id
    || serverMatch.revision !== lastTurnReplayAfter.revision) return;
  const latest = lastTurnReplayAfter.events?.at(-1);
  if (!latest) return;
  const source = lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
  if (source) {
    const prefix = `${latest.player}:${source.id}:`;
    for (const key of projectileAnimationStartTimes.keys()) if (key.startsWith(prefix)) projectileAnimationStartTimes.delete(key);
  }
  if (latest.action.type === 'deploy') {
    const unit = lastTurnReplayAfter.units.find(item => item.owner === latest.player && item.troopId === latest.action.troopId);
    if (unit) {
      const key = `confirmed:${lastTurnReplayAfter.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`;
      playedDeploymentAnimations.delete(key);
      deploymentAnimationStartTimes.delete(key);
    }
  }
  if (latest.action.type === 'bomb' && latest.action.coordinate) {
    const key = serverProjectileKey(latest.player, latest.action.troopId, 'bomb', latest.action.coordinate);
    playedConfirmedBombHeads.delete(key);
    confirmedBombArrivalTimes.delete(key);
  }
  if (latest.action.type === 'upgrade' && latest.action.coordinate) {
    const source = lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
    if (source) playedConfirmedUpgradeHeads.delete(serverProjectileKey(latest.player, source.id, 'upgrade', latest.action.coordinate));
  }
  replayingLastTurn = true;
  serverMatch = structuredClone(lastTurnReplayBefore);
  try { renderServerMatchState(structuredClone(lastTurnReplayAfter)); }
  finally { replayingLastTurn = false; }
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
  queueCurrentMovementPreviewReturn();
  serverSelectedTroopId = undefined;
  serverSelectedAction = undefined;
  serverPendingAction = undefined;
  queuedMovementPreviewOrigin = undefined;
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

function sendServerAction(action: { type: GameActionType; troopId?: string; coordinate?: Coordinate; destination?: Coordinate; targetUnitId?: string; targetBomb?: boolean; ability?: UpgradableAbility }): void {
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
  queuedMovementPreviewOrigin = undefined;
  queuedMovementPreviewReturn = undefined;
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
  if (serverSelectedAction === 'self-defense' || serverSelectedAction === 'self-magic-defense') return;
  const candidates = selectedServerLegalActions().filter(action => action.type === serverSelectedAction && action.coordinate === coordinate);
  if ((serverSelectedAction === 'push' || serverSelectedAction === 'pull') && candidates.length > 1) {
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
  const previousMovement = serverPendingMovementPreview();
  const previousBash = serverPendingBash();
  const nextMovementDestination = action.type === 'push' || action.type === 'pull' ? action.destination : action.coordinate;
  queuedMovementPreviewOrigin = previousMovement && nextMovementDestination
    ? {
      unitId: previousMovement.unit.id,
      coordinate: previousMovement.coordinate,
      wasBash: previousBash?.attackerId === previousMovement.unit.id,
      destination: nextMovementDestination,
    }
    : undefined;
  queuedMovementPreviewReturn = undefined;
  serverPendingAction = action.type === 'upgrade'
    ? { type: action.type, troopId: action.troopId, coordinate: action.coordinate }
    : { ...action };
  serverPushTargetChoices = [];
  sendServerSelection(serverSelectedTroopId, { type: serverSelectedAction, coordinate });
  // Movement previews are rendered once from the server's target-selection
  // echo. Rendering optimistically here would build the same animated group a
  // second time a few milliseconds later and visibly restart the motion.
  if (action.type !== 'move' && action.type !== 'fly' && action.type !== 'push' && action.type !== 'pull' && action.type !== 'bomb' && action.type !== 'defense' && action.type !== 'magic-defense') renderServerMatchState(serverMatch);
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
  const bash = serverMatch.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, serverMatch));
  const unitPreview = serverPendingUnitPreviews().find(unit => unit.coordinate === coordinate);
  const unitAtCoordinate = serverMatch.units.find(unit => unit.coordinate === coordinate)
    ?? unitPreview;
  const units = bash
    ? [serverMatch.units.find(unit => unit.id === (serverBashReveal === 'attacker' ? bash.attackerId : bash.defenderId))]
    : [unitAtCoordinate];
  const displayed = units.filter((unit): unit is ServerUnitState => unit !== undefined);
  if (displayed.length === 0 && !bomb) return;
  hoverDetailsPanel.replaceChildren();
  // Match the fixed board layout: Red is described first, then Blue.
  for (const unit of displayed.sort((left, right) => left.owner - right.owner)) {
    const troop = serverTroop(unit.troopId, unit.owner, unit); if (!troop) continue;
    const { card, copy } = createHoverCard(troop);
    if (bash) {
      const modifier = serverModifier(unit, bash.target, bash);
      const combat = document.createElement('div'); combat.classList.add('hover-detail-line'); combat.textContent = `Bash strength: ${unit.combat.health} + ${modifier} = ${unit.combat.health + modifier}`; copy.append(combat);
      for (const entry of serverModifierEntries(unit, bash.target, bash)) {
        const source = document.createElement('div'); source.classList.add('hover-detail-line'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; copy.append(source);
      }
    }
    appendHoverRules(copy, troop);
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
    if (action.type === 'push' || action.type === 'pull') cell.classList.add('push-target');
  }
  if (serverPendingAction?.coordinate) {
    const pendingCell = cellsByCoordinate.get(serverPendingAction.coordinate)?.cell;
    pendingCell?.classList.add('server-pending-target', 'server-reachable');
    if (serverPendingAction.type === 'deploy') pendingCell?.classList.add('server-pending-deployment');
  }
  if ((serverPendingAction?.type === 'push' || serverPendingAction?.type === 'pull') && serverPendingAction.destination) {
    cellsByCoordinate.get(serverPendingAction.destination)?.cell.classList.add('server-pending-target', 'server-reachable');
  }
  const unit = selectedServerUnit();
  if (unit && serverPendingAction?.type === 'cannon' && serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, serverPendingAction.coordinate, hexDistance(unit.coordinate, serverPendingAction.coordinate)) ?? []) {
      cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
  if (unit && serverPendingAction?.type === 'gore' && serverPendingAction.coordinate) {
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
  gore: `${goreIcon} Gore`,
  bomb: '💣 Bomb',
  push: `${pushIcon} Push`,
  pull: `${pullIcon} Pull`,
  stun: `${stunIcon} Stun`,
  magic: '🔥 Magic',
  mending: '❤️ Mend',
  upgrade: '🔮 Upgrade',
  defense: '🛡️ Block',
  'magic-defense': '🛡️ Magic block',
  'self-defense': '🛡️ Self block',
  'self-magic-defense': '🛡️ Self magic block',
  pass: 'Pass turn',
  'resolve-move': '🥾 End move',
  'resolve-death-attack': '💀 Ranged attack',
  'resolve-instant-ranged': 'F🏹 Instant attack',
  'resolve-instant-magic': 'F🔥 Instant magic',
  'resolve-stun': `${stunIcon} End stun`,
  'resolve-pull': `${pullIcon} Resolve pull`,
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
        : match.pendingResolution.kind === 'instant-magic' ? 'Choose a hex for the instant magic effect.'
        : match.pendingResolution.kind === 'stun' ? 'Choose an enemy troop to stun.'
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
  } else if (match.pendingResolution?.kind === 'death-attack' || match.pendingResolution?.kind === 'instant-ranged' || match.pendingResolution?.kind === 'instant-magic' || match.pendingResolution?.kind === 'stun') {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = match.pendingResolution.kind === 'death-attack' ? '💀 Choose ranged target' : match.pendingResolution.kind === 'stun' ? `${stunIcon} Choose target troop` : match.pendingResolution.kind === 'instant-magic' ? 'F🔥 Choose target hex' : 'F🏹 Choose target hex'; button.classList.add('active-action'); actionBarPanel.append(button);
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
  const orderedTypes: GameActionType[] = ['resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-instant-magic', 'resolve-stun', 'resolve-pull', 'resolve-pass', 'move', 'fly', 'attack', 'cannon', 'gore', 'bomb', 'push', 'pull', 'stun', 'defense', 'magic-defense', 'self-defense', 'self-magic-defense', 'magic', 'mending', 'upgrade'];
    const displayedTypes = orderedTypes.filter(candidate => availableTypes.has(candidate));
    let nextShortcut = 2;
    for (const type of displayedTypes) {
      const shortcut = type === 'move' || type === 'resolve-move' ? 1 : nextShortcut++;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = shortcut <= 9 ? `${shortcut} · ${serverActionLabel(type)}` : serverActionLabel(type); button.classList.toggle('active-action', serverSelectedAction === type);
      if (shortcut <= 9) {
        button.dataset.actionShortcut = String(shortcut);
        button.setAttribute('aria-keyshortcuts', String(shortcut));
        button.title = `Keyboard shortcut: ${shortcut}`;
      }
      button.addEventListener('click', () => {
        if (type === 'resolve-pass') { sendServerAction({ type, troopId: serverSelectedTroopId }); return; }
        serverSelectedAction = type;
        const selfDefense = type === 'self-defense' || type === 'self-magic-defense' ? legalActions.find(action => action.type === type) : undefined;
        serverPendingAction = selfDefense ? { ...selfDefense } : undefined;
        sendServerSelection(serverSelectedTroopId, type === 'self-defense' || type === 'self-magic-defense' ? { type, coordinate: unit.coordinate } : undefined);
        if (type !== 'self-defense' && type !== 'self-magic-defense') renderServerMatchState(match);
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
    message.textContent = 'Choose which object to push.';
    for (const choice of serverPushTargetChoices) {
      const target = match.units.find(unit => unit.id === choice.targetUnitId);
      const targetTroop = target ? serverTroop(target.troopId, target.owner, target) : undefined;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = choice.targetBomb ? 'Push Bomb' : `Push ${targetTroop ? troopDisplayName(targetTroop) : target?.troopId ?? 'troop'}`;
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
  await withBusyCursor(async () => {
    const response = await fetch(`/api/sandbox/${match.id}/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
    });
    const payload = await readApiJson<{ savedAt?: string; error?: string }>(response, 'Save playground');
    serverActionError = response.ok ? `Playground saved${payload.savedAt ? ` at ${new Date(payload.savedAt).toLocaleTimeString()}` : '.'}` : payload.error ?? 'Could not save the playground.';
    renderServerActionBar(match, localMatchPlayer ?? 1);
  });
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

function deckBuilderSearchMatches(troop: Troop, query: string): boolean {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return true;
  const typeFilters = tokens.filter(token => token.startsWith('t:')).map(token => token.slice(2)).filter(Boolean);
  const nameTerms = tokens.filter(token => !token.startsWith('t:'));
  const searchableName = `${troop.name ?? ''} ${troop.cardId}`.toLocaleLowerCase();
  const actionTypes = [...troop.actions, ...(troop.triggers ?? []).map(trigger => trigger.action)].flatMap(action => {
    const aliases = action.kind === 'ranged' ? ['attack'] : action.kind === 'fire' ? ['magic'] : [];
    if (action.kind === 'defense' && action.type?.includes('magic')) aliases.push('magic-defense');
    return [action.kind, ...aliases];
  });
  if (troop.selfMagicDefense !== undefined) actionTypes.push('self-magic-defense');
  return nameTerms.every(term => searchableName.includes(term))
    && typeFilters.every(type => actionTypes.includes(type));
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
    .filter((troop): troop is Troop => Boolean(troop))
    .filter(troop => deckBuilderSearchMatches(troop, deckBuilderSearch));
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
interface BoardBashModifierDisplay {
  value: number;
  upgraded: boolean;
}

function contextualBoardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number, bashModifier?: BoardBashModifierDisplay): ReturnType<typeof boardDescriptionEntries> {
  const entries = boardDescriptionEntries(troop, includeSelfBlock, revealMoveOne);
  const contextual = ignitionDamage
    ? entries.map(line => line.action === 'magic' ? { ...line, text: `${ignitionDamage} 💣` } : line)
    : entries;
  if (!bashModifier || troop.id !== 'boar-warlord') return contextual;
  return contextual.map(line => line.text === '+1 if ⚔️'
    ? { ...line, text: `+${bashModifier.value} if ⚔️`, upgraded: bashModifier.upgraded }
    : line);
}

function displayedBoardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number, modifier?: number | string, bashModifier?: BoardBashModifierDisplay): ReturnType<typeof boardDescriptionEntries> {
  const entries = contextualBoardDescriptionEntries(troop, includeSelfBlock, revealMoveOne, ignitionDamage, bashModifier);
  if (modifier === undefined) return entries;
  return [entries[0] ?? { text: '' }, { text: typeof modifier === 'number' ? signedModifier(modifier) : modifier }, ...entries.slice(1)];
}

const boardEmojiPattern = /(❤️|♥|🥾|🪽|🏹|🛡️|🔥|🧨|💣|🫸|🫷|🚫|🔮|⚔️|👑|🩸|💀|👼|❗)/gu;
const boardDescriptionLineHeight = 9;

function boardDescriptionLineY(position: Point, lineCount: number, index: number): number {
  // Health and its permanent modifier stay together in the upper stat area.
  // The three ability/effect rows belong in the lower info hex.
  if (index === 0) return position.y - 19;
  const hasModifier = lineCount === 5;
  if (hasModifier && index === 1) return position.y - 19 + boardDescriptionLineHeight;
  const informationIndex = index - (hasModifier ? 2 : 1);
  return position.y + 11 + informationIndex * boardDescriptionLineHeight;
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

function writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number, modifier?: number | string, bashModifier?: BoardBashModifierDisplay, magicModifier = 0): void {
  marker.replaceChildren();
  const lines = displayedBoardDescriptionEntries(troop, includeSelfBlock, revealMoveOne, ignitionDamage, modifier, bashModifier);
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(ns, 'tspan');
    row.setAttribute('x', String(position.x));
    row.setAttribute('y', String(boardDescriptionLineY(position, lines.length, index)));
    if (index === 0 && line.text.includes('♥')) {
      row.classList.add('board-health');
      const ownerClass = troop.owner === 1 ? 'player-one-health' : 'player-two-health';
      const wounded = line.text.match(/^(\d+)\s*(♥|❤️)\s*(\d+)$/u);
      const healthy = line.text.match(/^(♥|❤️)\s*(\d+)$/u);
      if (wounded || healthy) {
        if (wounded) {
          const current = document.createElementNS(ns, 'tspan');
          current.classList.add('board-health-value', ownerClass);
          current.textContent = `${wounded[1]} `;
          row.append(current);
        }
        const heart = document.createElementNS(ns, 'tspan');
        heart.classList.add('board-health-heart', ownerClass);
        heart.textContent = wounded?.[2] ?? healthy?.[1] ?? '♥';
        const total = document.createElementNS(ns, 'tspan');
        total.classList.add('board-health-value', ownerClass);
        total.textContent = ` ${wounded?.[3] ?? healthy?.[2] ?? ''}`;
        row.append(heart, total);
        marker.append(row);
        continue;
      }
    }
    if (index === 1 && modifier !== undefined) {
      row.classList.add(troop.owner === 1 ? 'player-one-health' : 'player-two-health');
      if (magicModifier) {
        const magicText = signedModifier(magicModifier);
        const modifierText = typeof modifier === 'string' ? modifier : signedModifier(modifier);
        const physicalText = modifierText.endsWith(magicText) ? modifierText.slice(0, -magicText.length) : modifierText;
        if (physicalText) appendBoardDescriptionText(row, physicalText);
        const magic = document.createElementNS(ns, 'tspan');
        magic.classList.add('magic-modifier');
        magic.textContent = magicText;
        row.append(magic);
        marker.append(row);
        continue;
      }
    }
    if (line.upgraded) row.classList.add('upgraded-effect');
    const values = line.text.match(/^(\d+)(.*?)(\d+)( \.\.\.)?$/u);
    if (values && (line.staticLeft || line.staticRight)) {
      const left = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(left, values[1]);
      const middle = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(middle, values[2]);
      const right = document.createElementNS(ns, 'tspan'); appendBoardDescriptionText(right, values[3]);
      if (line.staticLeft) left.classList.add('static-effect');
      if (line.staticRight) right.classList.add('static-effect');
      row.append(left, middle, right);
      if (values[4]) appendBoardDescriptionText(row, values[4]);
    } else appendBoardDescriptionText(row, line.text);
    marker.append(row);
  }
}

function appendServerActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action?: GameActionType, highlightLife = false, includeSelfBlock = false, negativeSelfBlock = false, ignitionDamage?: number, modifier?: number | string): void {
  const relevantAction = action === 'self-defense' && includeSelfBlock ? 'self-defense' : action === 'self-magic-defense' && includeSelfBlock ? 'self-magic-defense' : action === 'self-defense' ? 'defense' : action === 'self-magic-defense' ? 'magic-defense' : action;
  // Life has no action tag. Do not let an absent selection accidentally
  // match it; it is highlighted only for a troop just deployed this turn.
  if (!highlightLife && !relevantAction) return;
  const entries = displayedBoardDescriptionEntries(troop, includeSelfBlock, relevantAction === 'move', ignitionDamage, modifier);
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

function hideTroopInspector(): void {
  troopInspectorPanel.hidden = true;
}

function renderDeckBuilderActionBar(): void {
  actionBarPanel.replaceChildren();
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'deck-builder-search';
  search.placeholder = 'Search cards or t:fire, t:ranged…';
  search.setAttribute('aria-label', 'Search deck builder cards');
  search.value = deckBuilderSearch;
  deckBuilderSearchInput = search;
  search.addEventListener('input', () => {
    const cursor = search.selectionStart ?? search.value.length;
    deckBuilderSearch = search.value;
    renderDeckBuilder();
    deckBuilderSearchInput?.focus();
    deckBuilderSearchInput?.setSelectionRange(cursor, cursor);
  });
  actionBarPanel.append(search);
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
      if (serverMatch) { beginLastMovementInspection(coordinate); beginLastDeploymentInspection(coordinate); replayMagicShieldOnHover(coordinate); replayStunOnHover(coordinate); setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
    });
    cell.addEventListener('pointermove', () => {
      if (serverMatch) { beginLastMovementInspection(coordinate); beginLastDeploymentInspection(coordinate); }
    });
    cell.addEventListener('pointerleave', () => { hideHoverDetails(); endLastMovementInspection(coordinate); endLastDeploymentInspection(coordinate); setServerHoverPreview(coordinate, false); if (serverMatch) clearServerPreviewPath(); });
    cell.addEventListener('focus', () => {
      if (serverMatch) { replayMagicShieldOnHover(coordinate); replayStunOnHover(coordinate); setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); }
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
  await withBusyCursor(async () => {
    sandboxErrorPanel.textContent = '';
    const response = await fetch('/api/sandbox', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname, format, deckIndex: 0 })
    });
    const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Start playground');
    if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not start playground.');
    resumeLiveMatch(payload.match);
  });
}

async function loadSandbox(): Promise<void> {
  if (!currentNickname || !playgroundEnabled) return;
  await withBusyCursor(async () => {
    sandboxErrorPanel.textContent = '';
    const response = await fetch('/api/sandbox/load', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
    });
    const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Load playground');
    if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not load playground.');
    resumeLiveMatch(payload.match);
  });
}

async function undoSandbox(match: ServerMatchState): Promise<void> {
  if (!currentNickname) return;
  await withBusyCursor(async () => {
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
  });
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
  await Promise.all([shieldFramesReady, skullReady]);
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
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
  if (!typing && event.key === 'ArrowLeft' && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    replayLastTurnAnimation();
    return;
  }
  if (!typing && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && /^\d$/u.test(event.key)) {
    const button = actionBarPanel.querySelector<HTMLButtonElement>(`button[data-action-shortcut="${event.key}"]:not(:disabled)`);
    if (button) {
      event.preventDefault();
      button.click();
      return;
    }
  }
  if (event.code !== 'Space' || event.repeat) return;
  if (typing || target instanceof HTMLButtonElement) return;
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
