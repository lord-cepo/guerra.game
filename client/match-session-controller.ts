import type { Player } from '../game/types.js';
import type { HexGridState } from './hex-grid-state.js';
import type { ServerMatchState, ServerUnitState } from './protocol.js';
import { createTroopView, type Troop } from './troop-view.js';

interface MatchSessionContext {
  state: HexGridState;
  elements: {
    menuScreen: HTMLElement;
    main: HTMLElement;
    matchStatus: HTMLElement;
    openMatchBoard: HTMLButtonElement;
    matchScreen: HTMLElement;
    matchDecks: HTMLElement;
  };
  connect(matchId: string): void;
  renderMatch(match: ServerMatchState): void;
}

export function createMatchSessionController(context: MatchSessionContext) {
  const { state } = context;
  const {
    menuScreen: menuScreenPanel, main: mainPanel, matchStatus: matchStatusPanel,
    openMatchBoard: openMatchBoardButtonPanel, matchScreen: matchScreenPanel,
    matchDecks: matchDecksPanel,
  } = context.elements;
  const connectToMatch = context.connect;
  const renderServerMatchState = context.renderMatch;
function openMatchEntry(matchId: string): void {
  state.activeMatchId = matchId;
  state.serverMatch = undefined;
  state.serverAuthoritativeMatch = undefined;
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
  state.serverAuthoritativeMatch = match;
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
  // Effective actions and passives arrive with the authoritative unit. The
  // browser no longer reconstructs catalogue auras for confirmed state.
  troop.staticAuras = [];
  return troop;
}
  return { openMatchEntry, resumeLiveMatch, localPlayerFor, applyLocalPlayerView, serverTroop };
}
