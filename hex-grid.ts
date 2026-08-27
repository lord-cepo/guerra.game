import type { UpgradableAbility } from './game/cards.js';
import { adjacentCoordinates, hexDistance, regionAt, straightLine, type Coordinate } from './game/board.js';
import type { Player } from './game/types.js';
import type { Point } from './client/board-animation-geometry.js';
import { deploymentAnimationDuration, movementAnimationDuration, projectileTravelDuration, pushAnimationDuration } from './client/board-animation-timing.js';
import { serverProjectileKey } from './client/board-projectiles.js';
import { confirmedOneTimeActionDuration, instantResolutionPresentation, resolvedBashAnimations, resolvedBombExplosion, resolvedDamageAnimations, resolvedGoreMovementBetween, resolvedProjectilesForReplay, type ResolutionProjectionOptions } from './client/board-resolution.js';
import { controlledBoardHexArtwork, hexGap, hexPoints, hexSize as size, horizontalScale, svgNamespace as ns } from './client/board-geometry.js';
import { appendActionDescriptionHighlight as appendPresentationActionHighlight, appendBoardInfoFrame as appendPresentationInfoFrame, boardDescriptionLineHeight, boardDescriptionLineY, signedModifier, writeBoardDescription } from './client/board-descriptions.js';
import { appendHoverRules, boardCardMarker as createBoardCardMarker, createHoverCard } from './client/card-presentation.js';
import { createDeckBuilderController } from './client/deck-builder-controller.js';
import { createBoardGrid } from './client/board-grid-view.js';
import { createApplicationShell } from './client/application-shell.js';
import { pendingActionForPreview, pendingBash, pendingMovementPreview, pendingUnitPreviews, type ServerMovementPreview } from './client/board-preview-projection.js';
import { createTroopTrayController } from './client/troop-tray-controller.js';
import { createMatchConnection } from './client/match-connection.js';
import { shieldFrameCount } from './client/board-animation-view.js';
import { createMatchActionBar } from './client/match-action-bar.js';
import { createHexGridState } from './client/hex-grid-state.js';
import { createBoardEffectsRenderer } from './client/board-effects-renderer.js';
import type { GameActionType, ServerBashState, ServerLegalAction, ServerMatchState, ServerUnitState } from './client/protocol.js';
import { actionOfType, catalogueById, createTroopView, healthOf, troopDisplayName, upgradeBonus, type Troop } from './client/troop-view.js';

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

const state = createHexGridState();
const bashHoverTimers = new WeakMap<SVGGElement, number>();
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

const matchConnection = createMatchConnection({
  nickname: () => state.currentNickname,
  activeMatchId: () => state.activeMatchId,
  currentMatch: () => state.serverMatch,
  onStatus: setConnectionStatus,
  onError: message => {
    state.serverActionError = message;
    matchStatusPanel.textContent = message;
    if (state.serverMatch && state.localMatchPlayer && !mainPanel.hidden) renderServerActionBar(state.serverMatch, state.localMatchPlayer);
  },
  onState: match => {
    if (!applyLocalPlayerView(match)) return;
    if (!mainPanel.hidden) renderServerMatchState(match);
  },
});

function connectToMatch(matchId: string, reconnecting = false): void { matchConnection.connect(matchId, reconnecting); }

const deckBuilder = createDeckBuilderController({
  elements: {
    actionBar: actionBarPanel, gameLayout: gameLayoutPanel, database: playerTwoCardsPanel, deck: playerOneCardsPanel,
    readiness: deckReadinessPanel, playGame: playGameButtonPanel, playEight: playEightCardsButtonPanel,
    playTen: playTenCardsButtonPanel, main: mainPanel, menu: menuScreenPanel,
  },
  nickname: () => state.currentNickname,
  readApiJson,
  appendGroupedCards: appendGroupedTroopCards,
  showHover: showHoverDetails,
  hideHover: hideHoverDetails,
  beginDrag: beginTroopDrag,
  endDrag: endTroopDrag,
  isMagicShieldSummary,
});

function refreshDeckReadiness(): Promise<void> { return deckBuilder.refreshReadiness(); }
function loadDeck(deckIndex?: number): Promise<void> { return deckBuilder.load(deckIndex); }
function renderDeckBuilder(): void { deckBuilder.render(); }

function openMatchEntry(matchId: string): void {
  state.activeMatchId = matchId;
  state.serverMatch = undefined;
  state.playedDeploymentAnimations.clear();
  state.deploymentAnimationStartTimes.clear();
  state.confirmedDeploymentAnimationRevision = undefined;
  state.confirmedBashAnimationRevision = undefined;
  state.confirmedMovementAnimationRevision = undefined;
  state.confirmedDefenseAnimationRevision = undefined;
  state.confirmedMendingAnimationRevision = undefined;
  state.confirmedBombTrajectorySources.clear();
  state.playedConfirmedBombHeads.clear();
  state.confirmedUpgradeTrajectorySources.clear();
  state.playedConfirmedUpgradeHeads.clear();
  state.confirmedBombArrivalTimes.clear();
  state.bombIgnitionArrivalTimes.clear();
  state.playedConfirmedBombIgnitions.clear();
  state.physicalModifierArrivalTimes.clear();
  state.projectileAnimationStartTimes.clear();
  state.stunAnimationStartTimes.clear();
  state.replayingLastTurn = false;
  state.lastTurnReplayBefore = undefined;
  state.lastTurnReplayAfter = undefined;
  state.damageResolutionAnimations = [];
  state.explosionResolutionCoordinates = [];
  state.explosionAffectedCoordinates = [];
  state.explosionResolutionDelay = 0;
  state.bashResolutionAnimations = [];
  state.replayResolvedProjectiles = [];
  state.instantResolvedProjectiles = [];
  state.playedPreviewMendingSweepKey = undefined;
  state.lastMovementInspection = undefined;
  state.lastDeploymentInspection = undefined;
  state.armedRewindInspections.clear();
  menuScreenPanel.hidden = true;
  mainPanel.hidden = true;
  matchStatusPanel.textContent = `Match ${matchId.slice(0, 8)} is ready. The board will connect to the authoritative server state here.`;
  openMatchBoardButtonPanel.disabled = true;
  matchScreenPanel.hidden = false;
  void loadMatchDeckChoices(matchId);
}

function resumeLiveMatch(match: ServerMatchState): void {
  state.activeMatchId = match.id;
  menuScreenPanel.hidden = true;
  matchScreenPanel.hidden = true;
  mainPanel.hidden = false;
  renderServerMatchState(match);
  connectToMatch(match.id);
}

function localPlayerFor(match: ServerMatchState): Player | undefined {
  if (!state.currentNickname) return undefined;
  if (match.sandbox) return match.sandboxSide;
  return match.players[1] === state.currentNickname ? 1 : match.players[2] === state.currentNickname ? 2 : undefined;
}

function applyLocalPlayerView(match: ServerMatchState): Player | undefined {
  const local = localPlayerFor(match);
  if (!local) return undefined;
  state.localMatchPlayer = local;
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
  if (!state.currentNickname) return;
  const [matchResponse, decksResponse] = await Promise.all([
    fetch(`/api/matches/${matchId}`), fetch(`/api/decks?nickname=${encodeURIComponent(state.currentNickname)}`)
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
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: state.currentNickname, deckIndex: index })
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
  const troop = createTroopView(cardId, owner, unit, state.serverMatch?.defeatedTroopIds.includes(`${owner}:${cardId}`));
  // ServerUnitState.currentHealth is the authoritative post-resolution value.
  // Derive the view damage from it so the normal N ♥ M row cannot fall back
  // to total health when persisted damage metadata arrives out of sync.
  if (troop && unit) troop.permanentDamage = Math.max(0, troop.baseHealth - unit.currentHealth);
  if (!troop || !unit || !state.serverMatch) return troop;
  troop.staticAuras = [];
  for (const source of state.serverMatch.units.filter(candidate => candidate.owner === owner)) {
    for (const bonus of catalogueById.get(source.troopId)?.continuousEffects ?? []) {
      if (bonus.kind === 'ability-bonus' && bonus.condition === 'deployed') {
        troop.staticAuras.push({ ability: bonus.ability, left: bonus.left ?? 0, right: bonus.right ?? 0, sourceCardId: source.troopId });
      }
    }
  }
  return troop;
}

const troopTray = createTroopTrayController({
  match: () => state.serverMatch,
  localPlayer: () => state.localMatchPlayer,
  selectedTroopId: () => state.serverSelectedTroopId,
  cells: () => state.cellsByCoordinate,
  troop: serverTroop,
  selectTroop: selectServerTroop,
  stageDeployment: (troopId, coordinate) => stageServerDeployment(troopId, coordinate),
  placeFree: (dragged, coordinate) => {
    if (!state.serverMatch?.sandboxFreePlacement) return;
    matchConnection.send({ type: 'sandbox-place', matchId: state.serverMatch.id, owner: dragged.owner, troopId: dragged.troopId, coordinate });
  },
  showHover: showHoverDetails,
  hideHover: hideHoverDetails,
});

function beginTroopDrag(event: DragEvent, troop: Troop, source: Element, owner?: Player): void { troopTray.beginDrag(event, troop, source, owner); }
function endTroopDrag(): void { troopTray.endDrag(); }
function enablePointerBoardDrag(source: Element, troop: Troop, dragged: { owner: Player; troopId: string; mode: 'deploy' | 'free' }): void { troopTray.enableBoardDrag(source, troop, dragged); }

function boardCardMarker(troop: Troop, position: Point, clipId?: string): SVGGElement {
  return createBoardCardMarker(boardPanel, troop, position, clipId);
}

function isServerLastActing(owner: Player, troopId: string): boolean {
  return state.serverMatch?.lastActingTroopId?.[owner] === troopId;
}

function isServerInactive(owner: Player, troopId: string): boolean {
  const unit = state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === troopId);
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
  if (!state.serverMatch || !state.localMatchPlayer || state.serverMatch.winner || state.serverMatch.activePlayer !== state.localMatchPlayer || isServerInactive(state.localMatchPlayer, troopId)) return;
  const isInDeck = state.serverMatch.decks[state.localMatchPlayer].includes(troopId);
  if (!isInDeck || state.serverMatch.defeatedTroopIds.includes(`${state.localMatchPlayer}:${troopId}`)) return;
  state.serverActionError = undefined;
  state.serverInspectedUnitId = undefined;
  state.queuedMovementPreviewOrigin = undefined;
  const selecting = state.serverSelectedTroopId !== troopId;
  if (selecting) {
    redirectMovementInspection(1);
    redirectDeploymentInspection(1);
  }
  // Keep the current target set in place until the server returns the next
  // one. This lets CSS transition directly between the two sets instead of
  // briefly lowering every legal hex and raising the replacement set later.
  state.serverRequestedTroopId = state.serverSelectedTroopId === troopId ? undefined : troopId;
  if (state.serverRequestedTroopId === undefined) queueCurrentMovementPreviewReturn();
  else state.queuedMovementPreviewReturn = undefined;
  state.serverSelectionRequestPending = true;
  sendServerSelection(state.serverRequestedTroopId);
}

function appendGroupedTroopCards(parent: ParentNode, troops: readonly Troop[], renderCard: (troop: Troop) => Node): void { troopTray.appendGroupedCards(parent, troops, renderCard); }
function isMagicShieldSummary(troop: Troop, text: string): boolean { return troopTray.isMagicShieldSummary(troop, text); }
function renderServerTray(owner: Player, tray: HTMLElement, interactive: boolean): void { troopTray.render(owner, tray, interactive); }

function clearServerBoardRender(): void {
  boardPanel.querySelectorAll<SVGElement>('[data-server-render]:not([data-server-render="death-animation"]), .board-troop:not(.death-resolution-card), .board-troop-description, .action-land, .bash-stat, .bash-icon').forEach(element => element.remove());
  clearServerPreviewPath();
  for (const { cell } of state.cellsByCoordinate.values()) {
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
  if (!state.serverMatch) return [];
  const targets = Object.entries(state.serverMatch.targetSelections ?? {}).flatMap(([owner, target]) =>
    target ? [{ owner: Number(owner) as Player, target }] : []
  );
  if (!state.localMatchPlayer || !state.serverPendingAction?.coordinate) return targets;
  return [
    ...targets.filter(item => item.owner !== state.localMatchPlayer),
    { owner: state.localMatchPlayer, target: { troopId: state.serverPendingAction.troopId, type: state.serverPendingAction.type, coordinate: state.serverPendingAction.coordinate } }
  ];
}

/** Recalculate control with pending bashes and unconfirmed deployments included. */
function serverControllerWithPreview(coordinate: Coordinate, previewBash?: ServerBashState, match = state.serverMatch): Player | undefined {
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
  if (match === state.serverMatch) {
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
  if (!bash || !state.serverMatch) return false;
  const opponentId = bash.attackerId === unit.id ? bash.defenderId : bash.attackerId;
  return state.serverMatch.units.find(candidate => candidate.id === opponentId)?.troopId === 'canyon-hawk';
}

function serverPreviewBlock(unit: ServerUnitState, coordinate: Coordinate): number {
  return serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .reduce((sum, { owner, target }) => {
      const source = state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
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
      const source = state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const defense = troop ? actionOfType(troop, 'magic-defense') : undefined;
      const value = target.type === 'self-magic-defense'
        ? (troop?.selfMagicDefense ?? 0) + (troop ? upgradeBonus(troop, 'self-magic-defense').left : 0)
        : (defense?.block ?? 0) + (troop ? upgradeBonus(troop, 'magic-defense').left : 0);
      return sum + value;
    }, 0);
}

function serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): Array<{ label: string; value: number }> {
  if (!state.serverMatch) return [];
  if (serverBashHasSteadyOpponent(unit, bash)) return [];
  const entries: Array<{ label: string; value: number }> = [];
  const confirmedShields = unit.shields ?? [];
  const confirmedBlock = confirmedShields.reduce((sum, shield) => sum + shield.value, 0);
  const previewBlock = serverPreviewBlock(unit, coordinate);
  const block = confirmedBlock + previewBlock;
  if (block) entries.push({ label: 'Shield', value: block });
  const previewShieldSources = serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .map(({ owner, target }) => state.serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId))
    .filter((source): source is ServerUnitState => Boolean(source));
  const shieldedByAlly = confirmedShields.some(shield => shield.sourceUnitId !== undefined && shield.sourceUnitId !== unit.id)
    || previewShieldSources.some(source => source.id !== unit.id);
  for (const source of state.serverMatch.units.filter(candidate => candidate.owner === unit.owner)) {
    for (const effect of catalogueById.get(source.troopId)?.continuousEffects ?? []) {
      if (effect.kind !== 'combat-modifier' || (effect.scope ?? 'self') === 'self' && source.id !== unit.id) continue;
      const defender = bash ? state.serverMatch.units.find(candidate => candidate.id === bash.defenderId) : undefined;
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
    if (!previewBlock || !state.serverMatch) return unit.combat.modifier + previewBlock;
    const confirmedShields = unit.shields ?? [];
    const previewAllyShield = serverPreviewTargets()
      .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
      .some(({ owner, target }) => state.serverMatch?.units.some(source => source.owner === owner && source.troopId === target.troopId && source.id !== unit.id));
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
  return `${signedModifier(physical)} ${signedModifier(magic)}`;
}

function appendServerBoardUnit(unit: ServerUnitState, transition?: 'move-out' | 'move-in' | 'move-inspect-origin' | 'move-inspect-destination' | 'push-in' | 'push-out' | 'push-inspect' | 'deploy-out' | 'deploy-in', transitionOrigin?: Coordinate, transitionHalf?: 'left' | 'right'): void {
  const target = state.cellsByCoordinate.get(unit.coordinate); const troop = serverTroop(unit.troopId, unit.owner, unit);
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
    const origin = state.cellsByCoordinate.get(transitionOrigin)?.position;
    if (origin) {
      visual.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
      visual.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
    }
  }
  const marker = boardCardMarker(troop, target.position, target.cell.dataset.clipId);
  marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
  if (transitionHalf) marker.classList.add(transitionHalf === 'left' ? 'bash-left-picture' : 'bash-right-picture');
  if (state.serverMatch?.sandboxFreePlacement) {
    marker.classList.add('sandbox-draggable');
    enablePointerBoardDrag(marker, troop, { owner: unit.owner, troopId: unit.troopId, mode: 'free' });
  }
  keepServerOverlayUpright(marker, target.position);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  if (isServerInactive(unit.owner, unit.troopId)) {
    marker.classList.add('last-acting-troop');
    target.cell.classList.add('server-last-acting');
  }
  if ((unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId) || state.serverMatch?.selections?.[unit.owner] === unit.troopId || unit.id === state.serverInspectedUnitId) target.cell.classList.add('server-selected', unit.owner === 1 ? 'server-selected-one' : 'server-selected-two');
  // Every overlay uses the same shared horizontal board orientation.
  const highlightedAction = unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId ? state.serverSelectedAction : undefined;
  const latestAction = state.serverMatch?.events?.at(-1);
  const newlyDeployed = latestAction?.action.type === 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId;
  const deploymentPreview = unit.id.startsWith('deployment-preview:') && unit.owner === state.localMatchPlayer;
  const confirmedForOpponent = newlyDeployed
    && (state.replayingLastTurn || unit.owner !== state.localMatchPlayer)
    && state.serverMatch?.revision === state.confirmedDeploymentAnimationRevision;
  const deploymentAnimationKey = deploymentPreview
    ? `preview:${unit.owner}:${unit.troopId}:${unit.coordinate}`
    : confirmedForOpponent
      ? `confirmed:${state.serverMatch?.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`
      : undefined;
  if (deploymentAnimationKey) {
    let startedAt = state.deploymentAnimationStartTimes.get(deploymentAnimationKey);
    if (startedAt === undefined && !state.playedDeploymentAnimations.has(deploymentAnimationKey)) {
      startedAt = performance.now();
      state.deploymentAnimationStartTimes.set(deploymentAnimationKey, startedAt);
      state.playedDeploymentAnimations.add(deploymentAnimationKey);
      window.setTimeout(() => state.deploymentAnimationStartTimes.delete(deploymentAnimationKey), deploymentAnimationDuration);
    }
    if (startedAt !== undefined) {
      const elapsed = performance.now() - startedAt;
      if (elapsed < deploymentAnimationDuration) {
        visual.classList.add('deploy-fall-animation');
        visual.style.animationDelay = `${-elapsed}ms`;
      }
    }
  }
  const persistedAction = latestAction && state.serverMatch?.activePlayer !== latestAction.player
    && latestAction.action.type !== 'deploy' && latestAction.player === unit.owner && latestAction.action.troopId === unit.troopId
    ? latestAction.action.type : undefined;
  const descriptionAction = highlightedAction ?? persistedAction;
  const ignitionDamage = latestAction?.action.type === 'magic'
    && latestAction.player === unit.owner
    && latestAction.action.troopId === unit.troopId
    ? state.serverMatch?.effects.filter(effect => effect.kind === 'bomb' && effect.owner === unit.owner).reduce((damage, effect) => Math.max(damage, effect.value), 0)
    : undefined;
  const showSelfBlock = descriptionAction === 'self-defense' || descriptionAction === 'self-magic-defense';
  const pendingSelfBlock = showSelfBlock && (state.serverPendingAction?.type === 'self-defense' || state.serverPendingAction?.type === 'self-magic-defense');
  const displayedModifier = serverModifierText(unit, unit.coordinate);
  // The unit remains one rigid animated object, but the transparent ornamental
  // PNG is painted after it so the hand-drawn hex edge stays above the card.
  const hexArtwork = target.cell.querySelector<SVGImageElement>('.board-hex-artwork');
  visual.append(marker);
  const pending = state.serverMatch?.pendingResolution;
  const pendingSource = pending
    && (('sourceUnitId' in pending && pending.sourceUnitId === unit.id)
      || (!('sourceUnitId' in pending) && pending.owner === unit.owner && pending.sourceTroopId === unit.troopId));
  if (pendingSource) {
    const wash = document.createElementNS(ns, 'polygon');
    wash.dataset.serverRender = 'pending-action-source';
    wash.classList.add('pending-action-source-wash');
    wash.setAttribute('points', hexPoints(target.position.x, target.position.y));
    wash.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
    visual.append(wash);
  }
  if (isServerInactive(unit.owner, unit.troopId)) appendInactiveTroopWash(visual, target.position, target.cell.dataset.clipId);
  appendBoardInfoFrame(visual, troop, target.position);
  appendServerActionDescriptionHighlight(visual, troop, target.position, descriptionAction, newlyDeployed, showSelfBlock, pendingSelfBlock, ignitionDamage, displayedModifier);
  const description = document.createElementNS(ns, 'text');
  description.dataset.serverRender = 'description';
  description.classList.add('board-troop-description');
  const displayedMagicModifier = unit.combat.magicModifier + serverPreviewMagicBlock(unit, unit.coordinate);
  writeServerBoardDescription(description, troop, target.position, showSelfBlock, descriptionAction === 'move', ignitionDamage, displayedModifier, displayedMagicModifier);
  keepServerOverlayUpright(description, target.position);
  visual.append(description);
  target.cell.append(visual);
  if ((transition === 'move-inspect-origin' || transition === 'move-inspect-destination') && state.lastMovementInspection?.unitId === unit.id) {
    const progress = movementInspectionProgress(state.lastMovementInspection);
    const targetProgress = state.lastMovementInspection.direction === 1 ? 1 : 0;
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
  if (transition === 'push-inspect' && state.lastMovementInspection?.unitId === unit.id) {
    const origin = state.cellsByCoordinate.get(state.lastMovementInspection.origin)?.position;
    if (origin) {
      const fromX = origin.x - target.position.x;
      const fromY = origin.y - target.position.y;
      const progress = movementInspectionProgress(state.lastMovementInspection);
      const targetProgress = state.lastMovementInspection.direction === 1 ? 1 : 0;
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
  if ((transition === 'deploy-in' || transition === 'deploy-out') && state.lastDeploymentInspection?.unitId === unit.id) {
    visual.classList.add('deployment-inspection-animation');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const deployed = state.lastDeploymentInspection.direction === 1;
      visual.style.opacity = deployed ? '1' : '0';
      visual.style.translate = deployed ? '0 0' : '0 -150px';
      if (hexArtwork) target.cell.append(hexArtwork);
      return;
    }
    const progress = deploymentInspectionProgress(state.lastDeploymentInspection);
    const targetProgress = state.lastDeploymentInspection.direction === 1 ? 1 : 0;
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
  if (!state.serverMatch) return;
  const target = state.cellsByCoordinate.get(bash.target); const attacker = state.serverMatch.units.find(unit => unit.id === bash.attackerId); const defender = state.serverMatch.units.find(unit => unit.id === bash.defenderId);
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
    const control = serverRegionController(state.serverMatch, bash.target, bash);
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
    state.serverBashReveal = hoveredUnit.id === bash.attackerId ? 'attacker' : 'defender';
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

function serverBashIsDodged(bash: ServerBashState, match = state.serverMatch): boolean {
  if (!match) return false;
  const defender = match.units.find(unit => unit.id === bash.defenderId);
  const response = defender ? match.targetSelections?.[defender.owner] : undefined;
  const selectedMoveAway = Boolean(response
    && defender
    && response.troopId === defender.troopId
    && (response.type === 'move' || response.type === 'fly')
    && response.coordinate !== bash.target);
  const localMoveAway = Boolean(state.serverPendingAction
    && state.localMatchPlayer === defender?.owner
    && defender
    && state.serverPendingAction.troopId === defender.troopId
    && (state.serverPendingAction.type === 'move' || state.serverPendingAction.type === 'fly')
    && state.serverPendingAction.coordinate !== bash.target);
  return selectedMoveAway || localMoveAway;
}

function serverPendingActionForPreview(): ServerLegalAction | undefined {
  return pendingActionForPreview(state.serverMatch, state.serverPendingAction);
}

function serverPendingMovementPreview(): ServerMovementPreview | undefined {
  return pendingMovementPreview(state.serverMatch, state.serverPendingAction, state.localMatchPlayer);
}

function serverPendingUnitPreviews(): ServerUnitState[] {
  return pendingUnitPreviews(state.serverMatch, state.serverPendingAction, state.localMatchPlayer, serverTroop);
}

function serverPendingBash(): ServerBashState | undefined {
  return pendingBash(state.serverMatch, state.serverPendingAction, state.localMatchPlayer);
}

/** Show the same combat structure for a selected, not-yet-confirmed bash. */
function appendServerPreviewBash(): void {
  const bash = serverPendingBash();
  if (bash && state.serverHoverPreviewCoordinate !== bash.target) appendServerBash(bash, false, true);
}

function serverBashScreenSide(unit: ServerUnitState): 'left' | 'right' {
  return unit.owner === 2 ? 'left' : 'right';
}

function queueCurrentMovementPreviewReturn(): void {
  const movement = serverPendingMovementPreview();
  const bash = serverPendingBash();
  state.queuedMovementPreviewReturn = movement
    ? {
      unitId: movement.unit.id,
      coordinate: movement.coordinate,
      wasBash: bash?.attackerId === movement.unit.id,
    }
    : undefined;
}

function serverPreviewAt(coordinate: Coordinate): boolean {
  if (serverPendingBash()?.target === coordinate) return true;
  return Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
}

function coordinateHasVisibleBash(coordinate: Coordinate): boolean {
  return serverPendingBash()?.target === coordinate
    || Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
}

function setServerHoverPreview(coordinate: Coordinate, hovering: boolean, bashReveal: 'defender' | 'attacker' = 'defender'): void {
  const animatedBash = serverPendingBash()?.target === coordinate
    || Boolean(state.serverMatch?.bashes.some(bash => bash.target === coordinate && !serverBashIsDodged(bash, state.serverMatch)));
  // Bash inspection is now an in-place, reversible left/right animation.
  // The legacy hover preview rebuilt the board on pointer entry, destroying
  // the animated nodes before their transitions could begin.
  if (animatedBash) {
    if (!hovering && state.serverHoverPreviewCoordinate === coordinate) {
      state.serverHoverPreviewCoordinate = undefined;
      if (state.serverMatch) renderServerMatchState(state.serverMatch);
    }
    return;
  }
  if (state.serverPendingAction?.type === 'bomb' && state.serverPendingAction.coordinate === coordinate) return;
  const next = hovering && serverPreviewAt(coordinate) ? coordinate : undefined;
  if (state.serverHoverPreviewCoordinate === next && (!next || state.serverBashReveal === bashReveal)) return;
  state.serverHoverPreviewCoordinate = next;
  state.serverBashReveal = bashReveal;
  if (state.serverMatch) renderServerMatchState(state.serverMatch);
}

function latestMovementInspectionAt(coordinate: Coordinate): typeof state.lastMovementInspection {
  const match = state.serverMatch;
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

function movementInspectionProgress(inspection: NonNullable<typeof state.lastMovementInspection>): number {
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
  if (!state.lastMovementInspection || state.lastMovementInspection.direction === direction || !state.serverMatch) return;
  state.lastMovementInspection = {
    ...state.lastMovementInspection,
    progress: movementInspectionProgress(state.lastMovementInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(state.serverMatch);
}

function beginLastMovementInspection(coordinate: Coordinate): boolean {
  if (state.serverSelectionRequestPending || state.serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return false;
  if (state.lastMovementInspection?.hoverCoordinate === coordinate) {
    redirectMovementInspection(-1);
    return true;
  }
  // A completed or returning inspection must not monopolize the hover state;
  // entering another inactive troop switches the single visible inspector.
  if (state.lastMovementInspection) state.lastMovementInspection = undefined;
  const inspection = latestMovementInspectionAt(coordinate);
  if (!inspection || !state.serverMatch) return false;
  state.armedRewindInspections.add(inspection.key);
  state.lastMovementInspection = inspection;
  renderServerMatchState(state.serverMatch);
  return true;
}

function endLastMovementInspection(coordinate: Coordinate): void {
  if (!state.lastMovementInspection) {
    const inspection = latestMovementInspectionAt(coordinate);
    if (inspection) state.armedRewindInspections.add(inspection.key);
    return;
  }
  if (state.lastMovementInspection.hoverCoordinate !== coordinate || !state.serverMatch) return;
  redirectMovementInspection(1);
}

function latestDeploymentInspectionAt(coordinate: Coordinate): typeof state.lastDeploymentInspection {
  const match = state.serverMatch;
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

function deploymentInspectionProgress(inspection: NonNullable<typeof state.lastDeploymentInspection>): number {
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
  if (!state.lastDeploymentInspection || state.lastDeploymentInspection.direction === direction || !state.serverMatch) return;
  state.lastDeploymentInspection = {
    ...state.lastDeploymentInspection,
    progress: deploymentInspectionProgress(state.lastDeploymentInspection),
    direction,
    changedAt: performance.now(),
  };
  renderServerMatchState(state.serverMatch);
}

function beginLastDeploymentInspection(coordinate: Coordinate): boolean {
  if (state.serverSelectionRequestPending || state.serverSelectedTroopId || coordinateHasVisibleBash(coordinate)) return false;
  if (state.lastDeploymentInspection?.coordinate === coordinate) {
    redirectDeploymentInspection(-1);
    return true;
  }
  if (state.lastDeploymentInspection) state.lastDeploymentInspection = undefined;
  const inspection = latestDeploymentInspectionAt(coordinate);
  if (!inspection || !state.serverMatch) return false;
  state.armedRewindInspections.add(inspection.key);
  state.lastDeploymentInspection = inspection;
  renderServerMatchState(state.serverMatch);
  return true;
}

function endLastDeploymentInspection(coordinate: Coordinate): void {
  if (!state.lastDeploymentInspection) {
    const inspection = latestDeploymentInspectionAt(coordinate);
    if (inspection) state.armedRewindInspections.add(inspection.key);
    return;
  }
  if (state.lastDeploymentInspection.coordinate !== coordinate || !state.serverMatch) return;
  redirectDeploymentInspection(1);
}

/** Draw the region edge last, so unit sprites appear cut off behind it. */
const effectsRenderer = createBoardEffectsRenderer({
  board: boardPanel,
  state,
  serverTroop,
  serverBashIsDodged,
  serverBashScreenSide,
  serverModifier,
  boardCardMarker,
  beginLastMovementInspection,
  beginLastDeploymentInspection,
});
const {
  appendServerHexBorderOverlays, appendServerTriggeredShieldAnimations, appendServerDefenseAnimations, appendServerProjectile,
  replayInspectionAt, appendServerStunAnimations, appendServerProjectiles, appendServerMendingAnimations,
  appendPhysicalDamageModifiers, appendDamageResolutionAnimations, appendBombExplosionAnimations,
  appendBashResolutionAnimations, appendServerBombs, appendConfirmedIgnitedBomb, confirmedServerProjectiles,
} = effectsRenderer;

function resolutionProjectionOptions(): ResolutionProjectionOptions {
  return {
    replayingLastTurn: state.replayingLastTurn,
    localPlayer: state.localMatchPlayer,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    shieldFrameCount,
    baseHealthForTroop: troopId => catalogueById.get(troopId)?.baseHealth,
    passivesForTroop: troopId => catalogueById.get(troopId)?.passives ?? [],
    confirmedProjectiles: confirmedServerProjectiles,
  };
}

function renderServerMatchState(match: ServerMatchState): void {
  if (!state.serverMatch || state.serverMatch.id !== match.id) {
    state.serverHoverPreviewCoordinate = undefined;
  }
  // A new revision is an authoritative action (or sandbox placement), not a
  // local selection echo. Clear the previous side's card/action before control
  // passes; both fixed trays share card IDs across their separate owners.
  const previousMatch = state.serverMatch;
  const stateAdvanced = previousMatch?.id === match.id && previousMatch.revision !== match.revision;
  if (stateAdvanced && !state.replayingLastTurn && previousMatch
    && (match.events?.length ?? 0) > (previousMatch.events?.length ?? 0)) {
    state.lastTurnReplayBefore = structuredClone(previousMatch);
    state.lastTurnReplayAfter = structuredClone(match);
  }
  const latestEvent = match.events?.at(-1);
  const resolutionOptions = resolutionProjectionOptions();
  const resolvedExplosion = stateAdvanced
    ? resolvedBombExplosion(previousMatch, match)
    : { origins: [], affected: [] };
  state.explosionResolutionCoordinates = resolvedExplosion.origins;
  state.explosionAffectedCoordinates = resolvedExplosion.affected;
  state.explosionResolutionDelay = resolvedExplosion.origins.length > 0 ? confirmedOneTimeActionDuration(match, resolutionOptions) : 0;
  const instantPresentation = stateAdvanced
    ? instantResolutionPresentation(previousMatch, match, resolutionOptions)
    : { projectiles: [], damage: [] };
  state.instantResolvedProjectiles = instantPresentation.projectiles;
  state.damageResolutionAnimations = stateAdvanced
    ? [...resolvedDamageAnimations(previousMatch, match, state.explosionResolutionDelay, resolutionOptions), ...instantPresentation.damage]
    : [];
  state.bashResolutionAnimations = stateAdvanced ? resolvedBashAnimations(previousMatch, match, resolutionOptions) : [];
  state.replayResolvedProjectiles = stateAdvanced && state.replayingLastTurn ? resolvedProjectilesForReplay(previousMatch, match, resolutionOptions) : [];
  state.resolvedGoreMovement = stateAdvanced ? resolvedGoreMovementBetween(previousMatch, match) : undefined;
  state.confirmedDeploymentAnimationRevision = stateAdvanced ? match.revision : undefined;
  state.confirmedDefenseAnimationRevision = stateAdvanced
    && (latestEvent?.action.type === 'defense' || latestEvent?.action.type === 'self-defense' || latestEvent?.action.type === 'magic-defense' || latestEvent?.action.type === 'self-magic-defense')
    ? match.revision
    : undefined;
  state.confirmedMendingAnimationRevision = stateAdvanced && latestEvent?.action.type === 'mending'
    ? match.revision
    : undefined;
  if (stateAdvanced && latestEvent?.action.type === 'bomb' && latestEvent.action.coordinate) {
    const key = serverProjectileKey(latestEvent.player, latestEvent.action.troopId, 'bomb', latestEvent.action.coordinate);
    state.confirmedBombArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  if (stateAdvanced
    && latestEvent?.action.type === 'magic'
    && latestEvent.action.coordinate
    && (state.replayingLastTurn || latestEvent.player !== state.localMatchPlayer)
    && previousMatch?.bombs?.some(bomb => bomb.coordinate === latestEvent.action.coordinate)
    && match.effects.some(effect => effect.kind === 'bomb' && effect.target === latestEvent.action.coordinate)) {
    const key = `confirmed-ignition:${match.id}:${match.revision}:${latestEvent.action.coordinate}`;
    state.bombIgnitionArrivalTimes.set(key, performance.now() + projectileTravelDuration);
  }
  state.confirmedBashAnimationRevision = stateAdvanced
    && (state.replayingLastTurn || latestEvent?.player !== state.localMatchPlayer || latestEvent?.action.type === 'gore')
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore')
    && match.bashes.some(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    ? match.revision
    : undefined;
  state.confirmedMovementAnimationRevision = stateAdvanced
    && (state.replayingLastTurn || latestEvent?.player !== state.localMatchPlayer || latestEvent?.action.type === 'gore')
    && (latestEvent?.action.type === 'move' || latestEvent?.action.type === 'fly' || latestEvent?.action.type === 'gore' || latestEvent?.action.type === 'push' || latestEvent?.action.type === 'pull')
    && latestEvent.origin
    ? match.revision
    : undefined;
  if (stateAdvanced && !state.replayingLastTurn) {
    state.serverSelectedTroopId = undefined;
    state.serverSelectedAction = undefined;
    state.serverPendingAction = undefined;
    state.queuedMovementPreviewOrigin = undefined;
    state.queuedMovementPreviewReturn = undefined;
    state.serverPushTargetChoices = [];
    state.serverInspectedUnitId = undefined;
    state.lastMovementInspection = undefined;
    state.lastDeploymentInspection = undefined;
    clearServerPreviewPath();
  }
  state.serverMatch = match;
  const local = applyLocalPlayerView(match); if (!local) return;
  if (state.serverSelectionRequestPending && match.selections?.[local] === state.serverRequestedTroopId) {
    state.serverSelectedTroopId = state.serverRequestedTroopId;
    state.serverSelectedAction = undefined;
    state.serverPendingAction = undefined;
    state.serverSelectionRequestPending = false;
  }
  const awaitingLocalAction = match.status === 'active' && !match.winner
    && (match.pendingResolution?.owner ?? match.activePlayer) === local;
  boardAreaPanel.classList.toggle('awaiting-local-action', awaitingLocalAction);
  if (match.pendingResolution?.owner === local) {
    const pending = match.pendingResolution;
    const source = 'sourceUnitId' in pending ? match.units.find(unit => unit.id === pending.sourceUnitId) : undefined;
    state.serverSelectedTroopId = match.pendingResolution.sourceTroopId;
    if (source) state.serverInspectedUnitId = source.id;
  }
  gameLayoutPanel.classList.remove('deck-building');
  if (match.winner || (match.pendingResolution?.owner ?? match.activePlayer) !== local) { state.serverSelectedTroopId = undefined; state.serverSelectedAction = undefined; state.serverPendingAction = undefined; clearServerPreviewPath(); }
  const selectedActions = match.selections?.[local] === state.serverSelectedTroopId ? match.legalActions?.[local] ?? [] : [];
  const actionTypes = new Set(selectedActions.map(action => action.type));
  if (state.serverSelectedTroopId && selectedActions.length > 0 && (!state.serverSelectedAction || !actionTypes.has(state.serverSelectedAction))) {
    // Pending choices always include resolve-pass first, but the board should
    // open on the actual target action so legal hexes are visible immediately.
    state.serverSelectedAction = (['deploy', 'resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-instant-magic', 'resolve-stun', 'resolve-pull', 'move', 'fly'] as const)
      .find(type => actionTypes.has(type))
      ?? selectedActions.find(action => action.type !== 'resolve-pass')?.type
      ?? selectedActions[0]?.type;
  }
  renderServerTray(2, playerTwoCardsPanel, local === 2);
  renderServerTray(1, playerOneCardsPanel, local === 1);
  clearServerBoardRender();
  for (const [coordinate, { cell }] of state.cellsByCoordinate) {
    const previewBash = serverPendingBash();
    const controller = serverRegionController(match, coordinate, previewBash);
    cell.classList.add(controller === 1 ? 'server-controlled-one' : controller === 2 ? 'server-controlled-two' : 'server-contested');
    const regionId = regionAt(coordinate)?.id;
    const artwork = cell.querySelector<SVGImageElement>('.board-hex-artwork');
    const filename = controlledBoardHexArtwork(regionId, controller);
    if (artwork && filename) artwork.setAttribute('href', `./assets/${filename}`);
  }
  const visibleBashes = match.bashes.filter(bash => !serverBashIsDodged(bash, match)
    && bash.target !== state.serverHoverPreviewCoordinate);
  const bashingIds = new Set(visibleBashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const revealedBash = match.bashes.find(bash => bash.target === state.serverHoverPreviewCoordinate && !serverBashIsDodged(bash, match));
  const revealedBashingIds = new Set(revealedBash ? [revealedBash.attackerId, revealedBash.defenderId] : []);
  const revealedUnitId = revealedBash ? (state.serverBashReveal === 'attacker' ? revealedBash.attackerId : revealedBash.defenderId) : undefined;
  const pendingBash = serverPendingBash();
  const previewDefenderId = pendingBash?.defenderId;
  const revealPendingBash = pendingBash?.target === state.serverHoverPreviewCoordinate;
  const unitPreviews = serverPendingUnitPreviews();
  const movementPreview = serverPendingMovementPreview();
  const movementPreviewType = serverPendingActionForPreview()?.type;
  const queuedPreviewOrigin = movementPreview
    && state.queuedMovementPreviewOrigin?.unitId === movementPreview.unit.id
    && state.queuedMovementPreviewOrigin.destination === movementPreview.coordinate
    ? state.queuedMovementPreviewOrigin
    : undefined;
  const confirmedIntroBash = state.confirmedBashAnimationRevision === match.revision && latestEvent?.origin
    ? visibleBashes.find(bash => match.units.some(unit => unit.id === bash.attackerId
      && unit.owner === latestEvent.player
      && unit.troopId === latestEvent.action.troopId))
    : undefined;
  const resolvedGoreIntroBash = state.resolvedGoreMovement
    ? visibleBashes.find(bash => bash.attackerId === state.resolvedGoreMovement?.unit.id && bash.target === state.resolvedGoreMovement.destination)
    : undefined;
  const confirmedMovementAction = state.confirmedMovementAnimationRevision === match.revision && latestEvent?.origin
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
  const returningPreviewUnit = state.queuedMovementPreviewReturn
    ? match.units.find(unit => unit.id === state.queuedMovementPreviewReturn?.unitId)
    : undefined;
  const inspectedMovementUnit = state.lastMovementInspection
    ? match.units.find(unit => unit.id === state.lastMovementInspection?.unitId)
    : undefined;
  const inspectedDeploymentUnit = state.lastDeploymentInspection
    ? match.units.find(unit => unit.id === state.lastDeploymentInspection?.unitId)
    : undefined;
  const previewUnitIds = new Set(unitPreviews.map(unit => unit.id));
  for (const unit of match.units) if (!bashingIds.has(unit.id)
    && (!revealedBashingIds.has(unit.id) || unit.id === revealedUnitId)
    && (unit.id !== previewDefenderId || revealPendingBash)
    && !previewUnitIds.has(unit.id)
    && unit.id !== returningPreviewUnit?.id
    && (unit.id !== confirmedMovementUnit?.id || Boolean(confirmedIntroBash))
    && unit.id !== inspectedMovementUnit?.id
    && unit.id !== state.resolvedGoreMovement?.unit.id
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
  if (returningPreviewUnit && state.queuedMovementPreviewReturn) {
    appendServerBoardUnit(
      { ...returningPreviewUnit, coordinate: state.queuedMovementPreviewReturn.coordinate },
      'move-out',
      undefined,
      state.queuedMovementPreviewReturn.wasBash ? serverBashScreenSide(returningPreviewUnit) : undefined,
    );
    appendServerBoardUnit(returningPreviewUnit, 'move-in');
  }
  if (inspectedMovementUnit && state.lastMovementInspection) {
    const inspection = state.lastMovementInspection;
    if (inspection.type === 'push' || inspection.type === 'pull') {
      appendServerBoardUnit(inspectedMovementUnit, 'push-inspect', inspection.origin);
    } else {
      appendServerBoardUnit({ ...inspectedMovementUnit, coordinate: inspection.origin }, 'move-inspect-origin');
      appendServerBoardUnit(inspectedMovementUnit, 'move-inspect-destination');
    }
  }
  if (inspectedDeploymentUnit && state.lastDeploymentInspection) {
    appendServerBoardUnit(inspectedDeploymentUnit, state.lastDeploymentInspection.direction === 1 ? 'deploy-in' : 'deploy-out');
  }
  if (confirmedMovementUnit && latestEvent?.origin && !confirmedIntroBash) {
    if (confirmedMovementAction?.type === 'push' || confirmedMovementAction?.type === 'pull') appendServerBoardUnit(confirmedMovementUnit, 'push-in', latestEvent.origin);
    else {
      appendServerBoardUnit({ ...confirmedMovementUnit, coordinate: latestEvent.origin }, 'move-out');
      appendServerBoardUnit(confirmedMovementUnit, 'move-in');
    }
  }
  if (state.resolvedGoreMovement && !resolvedGoreIntroBash) {
    appendServerBoardUnit({ ...state.resolvedGoreMovement.unit, coordinate: state.resolvedGoreMovement.origin }, 'move-out');
    appendServerBoardUnit(state.resolvedGoreMovement.unit, 'move-in');
  }
  if (state.resolvedGoreMovement && resolvedGoreIntroBash) {
    appendServerBoardUnit({ ...state.resolvedGoreMovement.unit, coordinate: state.resolvedGoreMovement.origin }, 'move-out');
  }
  if (confirmedIntroBash && latestEvent?.origin) {
    const attacker = match.units.find(unit => unit.id === confirmedIntroBash.attackerId);
    if (attacker) {
      appendServerBoardUnit({ ...attacker, coordinate: latestEvent.origin }, 'move-out');
    }
  }
  for (const bash of visibleBashes) appendServerBash(bash, true, bash === confirmedIntroBash || bash === resolvedGoreIntroBash);
  // A pending bash is independent of bashes already waiting elsewhere on the
  // board. Draw all confirmed bashes and the prospective one together.
  appendServerPreviewBash();
  appendServerBombs(match);
  appendConfirmedIgnitedBomb(match);
  renderServerActionBar(match, local);
  renderServerActionTargets();
  appendServerHexBorderOverlays();
  appendServerProjectiles(match);
  for (const projectile of state.replayResolvedProjectiles) appendServerProjectile(projectile);
  for (const projectile of state.instantResolvedProjectiles) appendServerProjectile(projectile);
  appendServerMendingAnimations(match);
  appendPhysicalDamageModifiers(match);
  appendServerDefenseAnimations(match);
  appendServerTriggeredShieldAnimations(match, previousMatch);
  appendServerStunAnimations(match);
  appendBombExplosionAnimations();
  appendDamageResolutionAnimations();
  appendBashResolutionAnimations(match);
  state.confirmedDeploymentAnimationRevision = undefined;
  state.confirmedBashAnimationRevision = undefined;
  state.confirmedMovementAnimationRevision = undefined;
  state.confirmedDefenseAnimationRevision = undefined;
  state.confirmedMendingAnimationRevision = undefined;
  state.damageResolutionAnimations = [];
  state.explosionResolutionCoordinates = [];
  state.explosionAffectedCoordinates = [];
  state.explosionResolutionDelay = 0;
  state.bashResolutionAnimations = [];
  state.replayResolvedProjectiles = [];
  state.instantResolvedProjectiles = [];
  state.resolvedGoreMovement = undefined;
  if (queuedPreviewOrigin === state.queuedMovementPreviewOrigin) state.queuedMovementPreviewOrigin = undefined;
  state.queuedMovementPreviewReturn = undefined;
}

function replayLastTurnAnimation(): void {
  if (!state.serverMatch || !state.lastTurnReplayBefore || !state.lastTurnReplayAfter
    || state.serverMatch.id !== state.lastTurnReplayAfter.id
    || state.serverMatch.revision !== state.lastTurnReplayAfter.revision) return;
  const latest = state.lastTurnReplayAfter.events?.at(-1);
  if (!latest) return;
  const source = state.lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
  if (source) {
    const prefix = `${latest.player}:${source.id}:`;
    for (const key of state.projectileAnimationStartTimes.keys()) if (key.startsWith(prefix)) state.projectileAnimationStartTimes.delete(key);
  }
  if (latest.action.type === 'deploy') {
    const unit = state.lastTurnReplayAfter.units.find(item => item.owner === latest.player && item.troopId === latest.action.troopId);
    if (unit) {
      const key = `confirmed:${state.lastTurnReplayAfter.revision}:${unit.owner}:${unit.troopId}:${unit.coordinate}`;
      state.playedDeploymentAnimations.delete(key);
      state.deploymentAnimationStartTimes.delete(key);
    }
  }
  if (latest.action.type === 'bomb' && latest.action.coordinate) {
    const key = serverProjectileKey(latest.player, latest.action.troopId, 'bomb', latest.action.coordinate);
    state.playedConfirmedBombHeads.delete(key);
    state.confirmedBombArrivalTimes.delete(key);
  }
  if (latest.action.type === 'upgrade' && latest.action.coordinate) {
    const source = state.lastTurnReplayAfter.units.find(unit => unit.owner === latest.player && unit.troopId === latest.action.troopId);
    if (source) state.playedConfirmedUpgradeHeads.delete(serverProjectileKey(latest.player, source.id, 'upgrade', latest.action.coordinate));
  }
  state.replayingLastTurn = true;
  state.serverMatch = structuredClone(state.lastTurnReplayBefore);
  try { renderServerMatchState(structuredClone(state.lastTurnReplayAfter)); }
  finally { state.replayingLastTurn = false; }
}

function selectedServerUnit(): ServerUnitState | undefined {
  return state.serverMatch?.units.find(unit => unit.owner === state.localMatchPlayer && unit.troopId === state.serverSelectedTroopId);
}

function selectedServerLegalActions(): ServerLegalAction[] {
  if (!state.serverMatch || !state.localMatchPlayer || state.serverMatch.selections?.[state.localMatchPlayer] !== state.serverSelectedTroopId) return [];
  return state.serverMatch.legalActions?.[state.localMatchPlayer] ?? [];
}

function clearServerSelection(): void {
  if (!state.serverMatch) return;
  queueCurrentMovementPreviewReturn();
  state.serverSelectedTroopId = undefined;
  state.serverSelectedAction = undefined;
  state.serverPendingAction = undefined;
  state.queuedMovementPreviewOrigin = undefined;
  state.serverPushTargetChoices = [];
  state.serverInspectedUnitId = undefined;
  clearServerPreviewPath();
  sendServerSelection(undefined);
  renderServerMatchState(state.serverMatch);
}

function sendServerSelection(troopId: string | undefined, target?: { type: GameActionType; coordinate: Coordinate }): void {
  if (!state.serverMatch) return;
  matchConnection.send({ type: 'select', matchId: state.serverMatch.id, troopId, target });
}

function sendServerAction(action: { type: GameActionType; troopId?: string; coordinate?: Coordinate; destination?: Coordinate; targetUnitId?: string; targetBomb?: boolean; ability?: UpgradableAbility }): void {
  if (state.serverMatch?.winner) return;
  if (!state.serverMatch) {
    state.serverActionError = 'Connection to the match server is unavailable.';
    if (state.serverMatch && state.localMatchPlayer) renderServerActionBar(state.serverMatch, state.localMatchPlayer);
    return;
  }
  state.serverActionError = undefined;
  matchConnection.send({ type: 'action', matchId: state.serverMatch.id, action });
}

function confirmServerPendingAction(): void {
  const action = state.serverPendingAction;
  if (!action) return;
  if (action.type === 'upgrade' && !action.ability) { state.serverActionError = 'Choose which ability to upgrade.'; if (state.serverMatch && state.localMatchPlayer) renderServerActionBar(state.serverMatch, state.localMatchPlayer); return; }
  state.serverPendingAction = undefined;
  state.queuedMovementPreviewOrigin = undefined;
  state.queuedMovementPreviewReturn = undefined;
  renderServerActionTargets();
  sendServerAction(action);
}

function stageServerDeployment(troopId: string, coordinate: Coordinate, action?: ServerLegalAction): void {
  if (!state.serverMatch || !state.localMatchPlayer || state.serverMatch.winner || state.serverMatch.activePlayer !== state.localMatchPlayer) return;
  state.serverSelectedTroopId = troopId;
  state.serverSelectedAction = 'deploy';
  state.serverPendingAction = action ? { ...action } : { type: 'deploy', troopId, coordinate };
  state.serverPushTargetChoices = [];
  state.serverActionError = undefined;
  sendServerSelection(troopId, { type: 'deploy', coordinate });
  renderServerMatchState(state.serverMatch);
}

function performServerActionAt(coordinate: Coordinate): void {
  if (!state.serverMatch || state.serverMatch.winner || !state.localMatchPlayer || !state.serverSelectedTroopId || !state.serverSelectedAction || (state.serverMatch.pendingResolution?.owner ?? state.serverMatch.activePlayer) !== state.localMatchPlayer) return;
  if (state.serverSelectedAction === 'self-defense' || state.serverSelectedAction === 'self-magic-defense') return;
  const candidates = selectedServerLegalActions().filter(action => action.type === state.serverSelectedAction && action.coordinate === coordinate);
  if ((state.serverSelectedAction === 'push' || state.serverSelectedAction === 'pull') && candidates.length > 1) {
    state.serverPushTargetChoices = candidates;
    state.serverPendingAction = undefined;
    renderServerActionBar(state.serverMatch, state.localMatchPlayer);
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
  state.queuedMovementPreviewOrigin = previousMovement && nextMovementDestination
    ? {
      unitId: previousMovement.unit.id,
      coordinate: previousMovement.coordinate,
      wasBash: previousBash?.attackerId === previousMovement.unit.id,
      destination: nextMovementDestination,
    }
    : undefined;
  state.queuedMovementPreviewReturn = undefined;
  state.serverPendingAction = action.type === 'upgrade'
    ? { type: action.type, troopId: action.troopId, coordinate: action.coordinate }
    : { ...action };
  state.serverPushTargetChoices = [];
  sendServerSelection(state.serverSelectedTroopId, { type: state.serverSelectedAction, coordinate });
  // Movement previews are rendered once from the server's target-selection
  // echo. Rendering optimistically here would build the same animated group a
  // second time a few milliseconds later and visibly restart the motion.
  if (action.type !== 'move' && action.type !== 'fly' && action.type !== 'push' && action.type !== 'pull' && action.type !== 'bomb' && action.type !== 'defense' && action.type !== 'magic-defense') renderServerMatchState(state.serverMatch);
}

function clearServerPreviewPath(): void {
  for (const coordinate of state.serverPreviewPath) state.cellsByCoordinate.get(coordinate)?.cell.classList.remove('movement-path');
  state.serverPreviewPath = [];
}

/** A UI-only free-path preview. The server still validates the submitted move. */
function serverMovePath(from: Coordinate, destination: Coordinate, maxDistance: number): Coordinate[] | undefined {
  if (!state.serverMatch || destination === from || destination === '0,0') return undefined;
  const occupied = new Map(state.serverMatch.units.map(unit => [unit.coordinate, unit]));
  const seen = new Set<Coordinate>([from]);
  const queue: Array<{ coordinate: Coordinate; path: Coordinate[] }> = [{ coordinate: from, path: [] }];
  while (queue.length > 0) {
    const current = queue.shift(); if (!current || current.path.length === maxDistance) continue;
    for (const next of adjacentCoordinates(current.coordinate)) {
      if (!state.cellsByCoordinate.has(next) || next === '0,0' || seen.has(next)) continue;
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
  if (!unit || state.serverSelectedAction !== 'move' || !isLegalMove) return;
  const path = serverMovePath(unit.coordinate, coordinate, state.cellsByCoordinate.size);
  if (!path) return;
  state.serverPreviewPath = path;
  for (const item of path) state.cellsByCoordinate.get(item)?.cell.classList.add('movement-path');
}

function showServerHoverDetailsForCoordinate(coordinate: Coordinate): void {
  if (!state.serverMatch) return;
  const bomb = state.serverMatch.bombs?.find(item => item.coordinate === coordinate);
  const bash = state.serverMatch.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, state.serverMatch));
  const unitPreview = serverPendingUnitPreviews().find(unit => unit.coordinate === coordinate);
  const unitAtCoordinate = state.serverMatch.units.find(unit => unit.coordinate === coordinate)
    ?? unitPreview;
  const units = bash
    ? [state.serverMatch.units.find(unit => unit.id === (state.serverBashReveal === 'attacker' ? bash.attackerId : bash.defenderId))]
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
    detail.textContent = `💣 Bomb — ${bomb.damage}${bomb.pierce ? 'P' : ''} black-magic damage on this hex and all 6 adjacent hexes when lit by fire magic. It affects both players, ignores physical modifiers but is reduced by magic shields, resolves after the next action, then is removed. Another bomb thrown onto this hex merges its damage${bomb.pierce ? '; P means the blast pierces Obsidian magic immunity' : ''}. Thrown by ${sourceName}.`;
    hoverDetailsPanel.append(detail);
  }
  hoverDetailsPanel.hidden = false;
}

function renderServerActionTargets(): void {
  for (const { cell } of state.cellsByCoordinate.values()) cell.classList.remove('action-target', 'push-target', 'deployment-target', 'region-target', 'server-pending-target', 'server-pending-deployment', 'server-reachable');
  if (!state.serverSelectedAction) return;
  for (const action of selectedServerLegalActions()) {
    if (action.type !== state.serverSelectedAction || !action.coordinate) continue;
    const cell = state.cellsByCoordinate.get(action.coordinate)?.cell;
    if (!cell) continue;
    if (state.serverPendingAction?.coordinate !== action.coordinate) cell.classList.add('action-target');
    cell.classList.add('region-target', 'server-reachable');
    if (action.type === 'deploy') cell.classList.add('deployment-target');
    if (action.type === 'push' || action.type === 'pull') cell.classList.add('push-target');
  }
  if (state.serverPendingAction?.coordinate) {
    const pendingCell = state.cellsByCoordinate.get(state.serverPendingAction.coordinate)?.cell;
    pendingCell?.classList.add('server-pending-target', 'server-reachable');
    if (state.serverPendingAction.type === 'deploy') pendingCell?.classList.add('server-pending-deployment');
  }
  if ((state.serverPendingAction?.type === 'push' || state.serverPendingAction?.type === 'pull') && state.serverPendingAction.destination) {
    state.cellsByCoordinate.get(state.serverPendingAction.destination)?.cell.classList.add('server-pending-target', 'server-reachable');
  }
  // True-action Pull previews its complete displacement. Use the existing
  // soft pending fill rather than an SVG border; resolve-pull keeps the
  // triggered choice's compact endpoint-only presentation.
  if (state.serverPendingAction?.type === 'pull' && state.serverPendingAction.coordinate && state.serverPendingAction.destination) {
    const distance = hexDistance(state.serverPendingAction.coordinate, state.serverPendingAction.destination);
    for (const coordinate of straightLine(state.serverPendingAction.coordinate, state.serverPendingAction.destination, distance) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
  const unit = selectedServerUnit();
  if (unit && state.serverPendingAction?.type === 'cannon' && state.serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, state.serverPendingAction.coordinate, hexDistance(unit.coordinate, state.serverPendingAction.coordinate)) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
  if (unit && state.serverPendingAction?.type === 'gore' && state.serverPendingAction.coordinate) {
    for (const coordinate of straightLine(unit.coordinate, state.serverPendingAction.coordinate, hexDistance(unit.coordinate, state.serverPendingAction.coordinate)) ?? []) {
      state.cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
}

const renderServerActionBar = createMatchActionBar({
  panel: actionBarPanel,
  error: () => state.serverActionError,
  selectedTroopId: () => state.serverSelectedTroopId,
  selectedAction: () => state.serverSelectedAction,
  setSelectedAction: type => { state.serverSelectedAction = type; },
  pendingAction: () => state.serverPendingAction,
  setPendingAction: action => { state.serverPendingAction = action; },
  pushChoices: () => state.serverPushTargetChoices,
  clearPushChoices: () => { state.serverPushTargetChoices = []; },
  selectedUnit: selectedServerUnit,
  legalActions: selectedServerLegalActions,
  troop: serverTroop,
  sendAction: sendServerAction,
  sendSelection: sendServerSelection,
  clearSelection: clearServerSelection,
  confirm: confirmServerPendingAction,
  renderMatch: renderServerMatchState,
  sendSandboxMode,
  saveSandbox,
  loadSandbox,
  undoSandbox,
  leaveSandbox: match => {
    applicationShell.setResumable(match); mainPanel.hidden = true; menuScreenPanel.hidden = false; returnToMainMenu();
  },
  reportError: message => { state.serverActionError = message; },
});

function sendSandboxMode(match: ServerMatchState, freePlacement: boolean): void {
  matchConnection.send({ type: 'sandbox-mode', matchId: match.id, freePlacement });
}

async function saveSandbox(match: ServerMatchState): Promise<void> {
  if (!state.currentNickname) return;
  await withBusyCursor(async () => {
    const response = await fetch(`/api/sandbox/${match.id}/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: state.currentNickname })
    });
    const payload = await readApiJson<{ savedAt?: string; error?: string }>(response, 'Save playground');
    state.serverActionError = response.ok ? `Playground saved${payload.savedAt ? ` at ${new Date(payload.savedAt).toLocaleTimeString()}` : '.'}` : payload.error ?? 'Could not save the playground.';
    renderServerActionBar(match, state.localMatchPlayer ?? 1);
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

function appendBoardInfoFrame(cell: SVGGElement, troop: Troop, position: Point): void {
  appendPresentationInfoFrame(cell, troop, position, keepServerOverlayUpright);
}

function writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock = false, revealMoveOne = false, ignitionDamage?: number, modifier?: number | string, magicModifier = 0): void {
  writeBoardDescription(marker, troop, position, { includeSelfBlock, revealMoveOne, ignitionDamage, modifier, magicModifier });
}

function appendServerActionDescriptionHighlight(cell: SVGGElement, troop: Troop, position: Point, action?: GameActionType, highlightLife = false, includeSelfBlock = false, negativeSelfBlock = false, ignitionDamage?: number, modifier?: number | string): void {
  appendPresentationActionHighlight(cell, troop, position, action, { highlightLife, includeSelfBlock, negativeSelfBlock, ignitionDamage, modifier }, keepServerOverlayUpright);
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

function handleBoardCellClick(coordinate: Coordinate, cell: SVGGElement): void {
  if (!state.serverMatch) return;
  if (state.serverSelectedTroopId && cell.classList.contains('action-target')) { performServerActionAt(coordinate); return; }
  if (replayInspectionAt(coordinate)) return;
  const bash = state.serverMatch.bashes.find(candidate => candidate.target === coordinate && !serverBashIsDodged(candidate, state.serverMatch));
  const localBashUnitId = bash && state.localMatchPlayer
    ? [bash.attackerId, bash.defenderId].find(id => state.serverMatch?.units.find(candidate => candidate.id === id)?.owner === state.localMatchPlayer)
    : undefined;
  const unit = localBashUnitId ? state.serverMatch.units.find(candidate => candidate.id === localBashUnitId) : state.serverMatch.units.find(candidate => candidate.coordinate === coordinate);
  if (unit && unit.owner === state.localMatchPlayer) { selectServerTroop(unit.troopId); return; }
  if (state.serverSelectedTroopId && state.serverSelectedAction && !cell.classList.contains('action-target')) {
    if (!unit) clearServerSelection(); else { state.serverInspectedUnitId = unit.id; renderServerMatchState(state.serverMatch); }
    return;
  }
  if (unit && !state.serverSelectedTroopId) { state.serverInspectedUnitId = unit.id; renderServerMatchState(state.serverMatch); return; }
  if (!unit && state.serverSelectedTroopId && !cell.classList.contains('action-target')) { clearServerSelection(); return; }
  performServerActionAt(coordinate);
}

for (const [coordinate, view] of createBoardGrid(boardPanel, {
  enter: coordinate => { if (state.serverMatch) { setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); } },
  leave: coordinate => { hideHoverDetails(); endLastMovementInspection(coordinate); endLastDeploymentInspection(coordinate); setServerHoverPreview(coordinate, false); if (state.serverMatch) clearServerPreviewPath(); },
  focus: coordinate => { if (state.serverMatch) { setServerHoverPreview(coordinate, true); showServerHoverDetailsForCoordinate(coordinate); previewServerPath(coordinate); } },
  blur: coordinate => { hideHoverDetails(); setServerHoverPreview(coordinate, false); if (state.serverMatch) clearServerPreviewPath(); },
  revealBashAttacker: coordinate => {
    const bash = state.serverMatch?.bashes.find(item => item.target === coordinate && !serverBashIsDodged(item, state.serverMatch));
    if (!bash) return false;
    setServerHoverPreview(coordinate, true, 'attacker'); showServerHoverDetailsForCoordinate(coordinate); return true;
  },
  restoreBashDefender: coordinate => { setServerHoverPreview(coordinate, true, 'defender'); showServerHoverDetailsForCoordinate(coordinate); },
  click: handleBoardCellClick,
  backgroundClick: () => { if (state.serverMatch) clearServerSelection(); },
})) state.cellsByCoordinate.set(coordinate, view);

const applicationShell = createApplicationShell({
  elements: {
    loginScreen: loginScreenPanel, menuScreen: menuScreenPanel, loginForm: loginFormPanel, nicknameInput: nicknameInputField,
    loginError: loginErrorPanel, welcome: welcomePanel, buildDecks: buildDecksButtonPanel, playGame: playGameButtonPanel,
    sandboxGame: sandboxGameButtonPanel, resumeSandbox: resumeSandboxButtonPanel, playFormats: playFormatsPanel,
    playEight: playEightCardsButtonPanel, playTen: playTenCardsButtonPanel, backFromPlay: backFromPlayButtonPanel,
    playError: playFormatErrorPanel, sandboxFormats: sandboxFormatsPanel, sandboxEight: sandboxEightCardsButtonPanel,
    sandboxTen: sandboxTenCardsButtonPanel, loadSandbox: loadSandboxButtonPanel, backFromSandbox: backFromSandboxButtonPanel,
    sandboxError: sandboxErrorPanel, matchScreen: matchScreenPanel, matchStatus: matchStatusPanel,
    openMatchBoard: openMatchBoardButtonPanel, main: mainPanel,
  },
  nickname: () => state.currentNickname,
  setNickname: nickname => { state.currentNickname = nickname; },
  activeMatchId: () => state.activeMatchId,
  currentMatch: () => state.serverMatch,
  closeSandboxSession: () => { matchConnection.close(); state.serverMatch = undefined; state.activeMatchId = undefined; },
  readApiJson,
  withBusyCursor,
  refreshDeckReadiness,
  setDeckFormat: format => deckBuilder.setFormat(format),
  openDeckBuilder: async () => { if (!state.currentNickname) return; await loadDeck(0); menuScreenPanel.hidden = true; mainPanel.hidden = false; renderDeckBuilder(); },
  openMatchEntry,
  resumeMatch: resumeLiveMatch,
  undoMatch: match => { state.serverSelectedTroopId = undefined; state.serverSelectedAction = undefined; state.serverPendingAction = undefined; renderServerMatchState(match); },
  startup: async () => { await Promise.all([shieldFramesReady, skullReady]); renderDeckBuilder(); },
});

function loadSandbox(): Promise<void> { return applicationShell.loadSandbox(); }
function undoSandbox(match: ServerMatchState): Promise<void> { return applicationShell.undoSandbox(match); }
function returnToMainMenu(): void { applicationShell.returnToMenu(); }

void applicationShell.initialize();
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
  if (state.serverPendingAction) {
    event.preventDefault();
    confirmServerPendingAction();
    return;
  }
  // Space also means "continue" while an optional triggered resolution is
  // waiting. Use the authoritative legal action so mandatory effects (for
  // example the Last Bell's two attacks) cannot accidentally be skipped.
  const local = state.localMatchPlayer;
  const skip = local && state.serverMatch?.pendingResolution?.owner === local
    ? state.serverMatch.legalActions?.[local]?.find(action => action.type === 'resolve-pass')
    : undefined;
  if (!skip) return;
  event.preventDefault();
  sendServerAction(skip);
});
