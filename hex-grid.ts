import type { Coordinate } from './game/board.js';
import type { Player } from './game/types.js';
import type { Point } from './client/board-animation-geometry.js';
import { hexPoints, svgNamespace as ns } from './client/board-geometry.js';
import { appendActionDescriptionHighlight as appendPresentationActionHighlight, appendBoardInfoFrame as appendPresentationInfoFrame, writeBoardDescription } from './client/board-descriptions.js';
import { appendHoverRules, boardCardMarker as createBoardCardMarker, createHoverCard } from './client/card-presentation.js';
import { createDeckBuilderController } from './client/deck-builder-controller.js';
import { createBoardGrid } from './client/board-grid-view.js';
import { createApplicationShell } from './client/application-shell.js';
import { createTroopTrayController } from './client/troop-tray-controller.js';
import { createMatchConnection } from './client/match-connection.js';
import { createMatchActionBar } from './client/match-action-bar.js';
import { createHexGridState } from './client/hex-grid-state.js';
import { createBoardEffectsRenderer } from './client/board-effects-renderer.js';
import { createBoardUnitRenderer } from './client/board-unit-renderer.js';
import { createMatchBoardActions } from './client/match-board-actions.js';
import { createMatchBoardRenderer } from './client/match-board-renderer.js';
import { getApplicationElements } from './client/application-elements.js';
import { createBrowserRuntime } from './client/browser-runtime.js';
import { createMatchSessionController } from './client/match-session-controller.js';
import type { GameActionType, ServerMatchState } from './client/protocol.js';
import type { Troop } from './client/troop-view.js';

const elements = getApplicationElements();
const {
  board: boardPanel, boardArea: boardAreaPanel, playerOneCards: playerOneCardsPanel,
  playerTwoCards: playerTwoCardsPanel, actionBar: actionBarPanel, gameLayout: gameLayoutPanel,
  troopInspector: troopInspectorPanel, inspectorClose: inspectorCloseButton,
  hoverDetails: hoverDetailsPanel, loginScreen: loginScreenPanel, menuScreen: menuScreenPanel,
  loginForm: loginFormPanel, nicknameInput: nicknameInputField, loginError: loginErrorPanel,
  welcome: welcomePanel, deckReadiness: deckReadinessPanel, buildDecks: buildDecksButtonPanel,
  playGame: playGameButtonPanel, sandboxGame: sandboxGameButtonPanel, resumeSandbox: resumeSandboxButtonPanel,
  playFormats: playFormatsPanel, playEightCards: playEightCardsButtonPanel,
  playTenCards: playTenCardsButtonPanel, backFromPlay: backFromPlayButtonPanel,
  playFormatError: playFormatErrorPanel, sandboxFormats: sandboxFormatsPanel,
  sandboxEightCards: sandboxEightCardsButtonPanel, sandboxTenCards: sandboxTenCardsButtonPanel,
  loadSandbox: loadSandboxButtonPanel, backFromSandbox: backFromSandboxButtonPanel,
  sandboxError: sandboxErrorPanel, matchScreen: matchScreenPanel, matchStatus: matchStatusPanel,
  matchDecks: matchDecksPanel, openMatchBoard: openMatchBoardButtonPanel, main: mainPanel,
  connectionStatus: connectionStatusPanel,
} = elements;

const state = createHexGridState();
const bashHoverTimers = new WeakMap<SVGGElement, number>();
const { assetsReady, withBusyCursor, readApiJson } = createBrowserRuntime();

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

const matchSession = createMatchSessionController({
  state,
  elements: {
    menuScreen: menuScreenPanel,
    main: mainPanel,
    matchStatus: matchStatusPanel,
    openMatchBoard: openMatchBoardButtonPanel,
    matchScreen: matchScreenPanel,
    matchDecks: matchDecksPanel,
  },
  connect: matchId => connectToMatch(matchId),
  renderMatch: match => renderServerMatchState(match),
});
const { openMatchEntry, resumeLiveMatch, applyLocalPlayerView, serverTroop } = matchSession;

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

const unitRenderer = createBoardUnitRenderer({
  board: boardPanel,
  state,
  bashHoverTimers,
  clearServerPreviewPath: () => clearServerPreviewPath(),
  serverTroop,
  boardCardMarker,
  isServerInactive,
  enablePointerBoardDrag,
  appendInactiveTroopWash,
  appendBoardInfoFrame,
  appendServerActionDescriptionHighlight,
  writeServerBoardDescription,
  showServerHoverDetailsForCoordinate: coordinate => showServerHoverDetailsForCoordinate(coordinate),
  renderServerMatchState: match => renderServerMatchState(match),
});
const {
  clearServerBoardRender, serverRegionController, serverModifierEntries,
  serverModifier, appendServerBoardUnit, appendServerBash, serverBashIsDodged,
  serverPendingActionForPreview, serverPendingMovementPreview, serverPendingUnitPreviews,
  serverPendingBash, appendServerPreviewBash, serverBashScreenSide, queueCurrentMovementPreviewReturn,
  setServerHoverPreview, redirectMovementInspection, beginLastMovementInspection, endLastMovementInspection,
  redirectDeploymentInspection, beginLastDeploymentInspection, endLastDeploymentInspection,
} = unitRenderer;

/** The shared horizontal board needs no player-dependent overlay rotation. */
function keepServerOverlayUpright(_element: SVGElement, _centre: Point): void {}

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

const matchBoardRenderer = createMatchBoardRenderer({
  state,
  boardAreaPanel,
  gameLayoutPanel,
  applyLocalPlayerView,
  clearServerPreviewPath: () => clearServerPreviewPath(),
  serverPendingBash,
  serverRegionController,
  serverBashIsDodged,
  serverBashScreenSide,
  serverPendingUnitPreviews,
  serverPendingMovementPreview,
  serverPendingActionForPreview,
  clearServerBoardRender,
  appendServerBoardUnit,
  appendServerBash,
  appendServerPreviewBash,
  renderServerTray,
  renderServerActionTargets: () => renderServerActionTargets(),
  renderServerActionBar: (match, player) => renderServerActionBar(match, player),
  playerOneCardsPanel,
  playerTwoCardsPanel,
  appendServerHexBorderOverlays,
  appendServerTriggeredShieldAnimations,
  appendServerDefenseAnimations,
  appendServerStunAnimations,
  appendServerProjectile,
  appendServerProjectiles,
  appendServerMendingAnimations,
  appendPhysicalDamageModifiers,
  appendDamageResolutionAnimations,
  appendBombExplosionAnimations,
  appendBashResolutionAnimations,
  appendServerBombs,
  appendConfirmedIgnitedBomb,
  confirmedServerProjectiles,
});
const { renderServerMatchState, replayLastTurnAnimation } = matchBoardRenderer;
const matchBoardActions = createMatchBoardActions({
  state,
  hoverDetailsPanel,
  send: message => matchConnection.send(message),
  renderServerMatchState,
  renderServerActionBar: (match, player) => renderServerActionBar(match, player),
  serverPendingMovementPreview,
  serverPendingUnitPreviews,
  serverPendingBash,
  queueCurrentMovementPreviewReturn,
  serverBashIsDodged,
  serverTroop,
  serverModifier,
  serverModifierEntries,
});
const {
  selectedServerUnit, selectedServerLegalActions, clearServerSelection, sendServerSelection,
  sendServerAction, confirmServerPendingAction, stageServerDeployment, performServerActionAt, clearServerPreviewPath,
  previewServerPath, showServerHoverDetailsForCoordinate, renderServerActionTargets,
} = matchBoardActions;
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
  startup: async () => { await assetsReady; renderDeckBuilder(); },
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
