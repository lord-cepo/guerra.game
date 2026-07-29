import { troopSeeds, type AttackAction, type CannonAction, type DefenseAction, type FlyAction, type MagicAction, type MendingAction, type MoveAction, type PushAction, type UpgradeAction, type UpgradableAbility, type Player, type RegionType, type TroopAction, type TroopRole } from './game/cards.js';

type Coordinate = `${number},${number}`;
const pushIcon = '\u{1FAF8}';

interface Point {
  x: number;
  y: number;
}

interface Troop {
  id: string;
  name?: string;
  player: Player;
  role: TroopRole;
  actions: readonly TroopAction[];
  deploymentRegions: readonly RegionType[];
  passiveDescription?: string;
  deploymentRule?: 'enemy-region';
  selfDefense?: number;
  baseHealth: number;
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number }>;
  coordinate?: Coordinate;
  marker?: SVGImageElement;
  descriptionMarker?: SVGTextElement;
  permanentDamage: number;
  defeated: boolean;
}

interface Region {
  id: string;
  name: string;
  type: RegionType;
  homePlayer?: Player;
  coordinates: ReadonlySet<Coordinate>;
}

interface ControlScore {
  playerOne: number;
  playerTwo: number;
}

const board = document.querySelector<SVGSVGElement>('#board');
const playerOneCards = document.querySelector<HTMLElement>('#player-one-cards');
const playerTwoCards = document.querySelector<HTMLElement>('#player-two-cards');
const actionBar = document.querySelector<HTMLElement>('#action-bar');
const gameLayout = document.querySelector<HTMLElement>('.game-layout');
const troopInspector = document.querySelector<HTMLElement>('#troop-inspector');
const inspectorContent = document.querySelector<HTMLElement>('#inspector-content');
const inspectorClose = document.querySelector<HTMLButtonElement>('#inspector-close');
const hoverDetails = document.querySelector<HTMLElement>('#hover-details');
const loginScreen = document.querySelector<HTMLElement>('#login-screen');
const menuScreen = document.querySelector<HTMLElement>('#menu-screen');
const loginForm = document.querySelector<HTMLFormElement>('#login-form');
const nicknameInput = document.querySelector<HTMLInputElement>('#nickname');
const loginError = document.querySelector<HTMLElement>('#login-error');
const welcome = document.querySelector<HTMLElement>('#welcome');
const buildDecksButton = document.querySelector<HTMLButtonElement>('#build-decks');
const playGameButton = document.querySelector<HTMLButtonElement>('#play-game');
const sandboxGameButton = document.querySelector<HTMLButtonElement>('#sandbox-game');
const resumeSandboxButton = document.querySelector<HTMLButtonElement>('#resume-sandbox');
const playFormats = document.querySelector<HTMLElement>('#play-formats');
const playEightCardsButton = document.querySelector<HTMLButtonElement>('#play-8-cards');
const playTenCardsButton = document.querySelector<HTMLButtonElement>('#play-10-cards');
const backFromPlayButton = document.querySelector<HTMLButtonElement>('#back-from-play');
const playFormatError = document.querySelector<HTMLElement>('#play-format-error');
const sandboxFormats = document.querySelector<HTMLElement>('#sandbox-formats');
const sandboxEightCardsButton = document.querySelector<HTMLButtonElement>('#sandbox-8-cards');
const sandboxTenCardsButton = document.querySelector<HTMLButtonElement>('#sandbox-10-cards');
const loadSandboxButton = document.querySelector<HTMLButtonElement>('#load-sandbox');
const backFromSandboxButton = document.querySelector<HTMLButtonElement>('#back-from-sandbox');
const sandboxError = document.querySelector<HTMLElement>('#sandbox-error');
const matchScreen = document.querySelector<HTMLElement>('#match-screen');
const matchStatus = document.querySelector<HTMLElement>('#match-status');
const matchDecks = document.querySelector<HTMLElement>('#match-decks');
const openMatchBoardButton = document.querySelector<HTMLButtonElement>('#open-match-board');
const main = document.querySelector<HTMLElement>('main');
const connectionStatus = document.querySelector<HTMLElement>('#connection-status');

if (!board || !playerOneCards || !playerTwoCards || !actionBar || !gameLayout || !troopInspector || !inspectorContent || !inspectorClose || !hoverDetails || !loginScreen || !menuScreen || !loginForm || !nicknameInput || !loginError || !welcome || !buildDecksButton || !playGameButton || !sandboxGameButton || !resumeSandboxButton || !playFormats || !playEightCardsButton || !playTenCardsButton || !backFromPlayButton || !playFormatError || !sandboxFormats || !sandboxEightCardsButton || !sandboxTenCardsButton || !loadSandboxButton || !backFromSandboxButton || !sandboxError || !matchScreen || !matchStatus || !matchDecks || !openMatchBoardButton || !main || !connectionStatus) {
  throw new Error('The board, card trays, action bar, or inspector is missing.');
}

const playerOneCardsPanel: HTMLElement = playerOneCards;
const boardPanel: SVGSVGElement = board;
const playerTwoCardsPanel: HTMLElement = playerTwoCards;
const actionBarPanel: HTMLElement = actionBar;
const gameLayoutPanel: HTMLElement = gameLayout;
const troopInspectorPanel: HTMLElement = troopInspector;
const inspectorContentPanel: HTMLElement = inspectorContent;
const inspectorCloseButton: HTMLButtonElement = inspectorClose;
const hoverDetailsPanel: HTMLElement = hoverDetails;
const loginScreenPanel: HTMLElement = loginScreen;
const menuScreenPanel: HTMLElement = menuScreen;
const loginFormPanel: HTMLFormElement = loginForm;
const nicknameInputField: HTMLInputElement = nicknameInput;
const loginErrorPanel: HTMLElement = loginError;
const welcomePanel: HTMLElement = welcome;
const buildDecksButtonPanel: HTMLButtonElement = buildDecksButton;
const playGameButtonPanel: HTMLButtonElement = playGameButton;
const sandboxGameButtonPanel: HTMLButtonElement = sandboxGameButton;
const resumeSandboxButtonPanel: HTMLButtonElement = resumeSandboxButton;
const playFormatsPanel: HTMLElement = playFormats;
const playEightCardsButtonPanel: HTMLButtonElement = playEightCardsButton;
const playTenCardsButtonPanel: HTMLButtonElement = playTenCardsButton;
const backFromPlayButtonPanel: HTMLButtonElement = backFromPlayButton;
const playFormatErrorPanel: HTMLElement = playFormatError;
const sandboxFormatsPanel: HTMLElement = sandboxFormats;
const sandboxEightCardsButtonPanel: HTMLButtonElement = sandboxEightCardsButton;
const sandboxTenCardsButtonPanel: HTMLButtonElement = sandboxTenCardsButton;
const loadSandboxButtonPanel: HTMLButtonElement = loadSandboxButton;
const backFromSandboxButtonPanel: HTMLButtonElement = backFromSandboxButton;
const sandboxErrorPanel: HTMLElement = sandboxError;
const matchScreenPanel: HTMLElement = matchScreen;
const matchStatusPanel: HTMLElement = matchStatus;
const matchDecksPanel: HTMLElement = matchDecks;
const openMatchBoardButtonPanel: HTMLButtonElement = openMatchBoardButton;
const mainPanel: HTMLElement = main;
const connectionStatusPanel: HTMLElement = connectionStatus;

const troops = new Map<string, Troop>();
const troopsByCoordinate = new Map<Coordinate, Troop>();
const cellsByCoordinate = new Map<Coordinate, { cell: SVGGElement; position: Point }>();
let matchStarted = false;
let currentNickname: string | undefined;
let activeDeckIndex = 0;
let deckFormat: 8 | 10 = 8;
let activeMatchId: string | undefined;
let matchSocket: WebSocket | undefined;
let localMatchPlayer: Player | undefined;
let serverMatch: ServerMatchState | undefined;
let serverSelectedTroopId: string | undefined;
let serverInspectedUnitId: string | undefined;
let serverSelectedAction: GameActionType | undefined;
let serverPendingAction: { type: GameActionType; troopId: string; coordinate?: Coordinate; destination?: Coordinate; ability?: UpgradableAbility } | undefined;
let serverPushTarget: Coordinate | undefined;
let serverActionError: string | undefined;
let serverPreviewPath: Coordinate[] = [];
let resumableSandbox: ServerMatchState | undefined;
let reconnectTimer: number | undefined;
let draggedDatabaseCardId: string | undefined;
let draggedDeckSlot: number | undefined;
let draggedSandboxTroop: { owner: Player; troopId: string } | undefined;
const gameState: {
  activePlayer: Player;
  selectedTroopId?: string;
  selectedAction?: 'deploy' | 'move' | 'attack' | 'defense' | 'self-defense' | 'magic';
  awaitingResolutionTroopId?: string;
  movementPath: Coordinate[];
  winner?: Player;
  lastActingTroopIdByPlayer: Map<Player, string>;
} = {
  activePlayer: 1,
  movementPath: [],
  lastActingTroopIdByPlayer: new Map()
};

interface PendingAttack {
  owner: Player;
  target: Coordinate;
  damage: number;
  marker: SVGTextElement;
}

const pendingAttacks: PendingAttack[] = [];

interface PendingTimedEffect {
  owner: Player;
  sourceTroopId: string;
  type: 'defense' | 'magic';
  target: Coordinate;
  value: number;
  marker: SVGTextElement;
}

const pendingTimedEffects: PendingTimedEffect[] = [];

interface PendingBash {
  attackerId: string;
  defenderId: string;
  target: Coordinate;
  playerOneStats: SVGTextElement;
  playerTwoStats: SVGTextElement;
  playerOneIcon: SVGImageElement;
  playerTwoIcon: SVGImageElement;
}

const pendingBashes: PendingBash[] = [];

for (const seed of troopSeeds) {
  troops.set(seed.id, { ...seed, permanentDamage: 0, defeated: false });
}

const playerOneDatabase = troopSeeds.map(seed => seed.id);
const storedDeck = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('hex-war-player-one-deck') ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => playerOneDatabase.includes(id)) : [];
  } catch {
    return [];
  }
})();
const playerOneDeck: Array<string | undefined> = [...(storedDeck.length > 0 ? storedDeck : playerOneDatabase), undefined, undefined].slice(0, 10);
let deckSave: Promise<void> = Promise.resolve();

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

function savePlayerOneDeck(): void {
  const cards = playerOneDeck.slice(0, deckFormat).filter((id): id is string => id !== undefined);
  localStorage.setItem(`hex-war-player-one-deck-${deckFormat}`, JSON.stringify(cards));
  if (!currentNickname) return;
  deckSave = fetch(`/api/decks/${activeDeckIndex}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: currentNickname, cards, format: deckFormat })
  }).then(async response => {
    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      throw new Error(payload.error ?? 'Could not save the deck.');
    }
  });
  // Saving is also awaited before queueing; this handler prevents an
  // unobserved rejection while the player remains in the deck builder.
  void deckSave.catch(error => { playFormatErrorPanel.textContent = error instanceof Error ? error.message : 'Could not save the deck.'; });
}

async function loadDeck(deckIndex: number): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/decks?nickname=${encodeURIComponent(currentNickname)}`);
  const payload = await response.json() as { decks?: Record<string, unknown> };
  const formatDecks = payload.decks?.[String(deckFormat)];
  const cards = Array.isArray(formatDecks) && Array.isArray(formatDecks[deckIndex])
    ? formatDecks[deckIndex].filter((id): id is string => typeof id === 'string' && playerOneDatabase.includes(id))
    : [];
  playerOneDeck.splice(0, playerOneDeck.length, ...cards.slice(0, 10), ...Array(Math.max(0, 10 - cards.length)).fill(undefined));
}

function openMatchEntry(matchId: string): void {
  activeMatchId = matchId;
  serverMatch = undefined;
  localStorage.setItem('hex-war-active-match', matchId);
  menuScreenPanel.hidden = true;
  mainPanel.hidden = true;
  matchStatusPanel.textContent = `Match ${matchId.slice(0, 8)} is ready. The board will connect to the authoritative server state here.`;
  openMatchBoardButtonPanel.disabled = true;
  matchScreenPanel.hidden = false;
  void loadMatchDeckChoices(matchId);
}

function resumeLiveMatch(match: ServerMatchState): void {
  activeMatchId = match.id;
  localStorage.setItem('hex-war-active-match', match.id);
  menuScreenPanel.hidden = true;
  matchScreenPanel.hidden = true;
  mainPanel.hidden = false;
  matchStarted = true;
  renderServerMatchState(match);
  connectToMatch(match.id);
}

interface ServerUnitState {
  id: string;
  troopId: string;
  owner: Player;
  coordinate: Coordinate;
  permanentDamage: number;
  currentHealth: number;
  rangedDamageBonus?: number;
  rangedRangeBonus?: number;
  upgrades?: Array<{ ability?: UpgradableAbility; left?: number; right?: number }>;
}
interface ServerEffectState { owner: Player; sourceTroopId: string; sourceUnitId?: string; kind: 'attack' | 'cannon' | 'magic' | 'defense'; target: Coordinate; value: number; }
interface ServerBashState { attackerId: string; defenderId: string; target: Coordinate; }
interface ServerControlState { controller?: Player; playerOne: number; playerTwo: number; }
interface ServerGameEvent { player: Player; action: { type: GameActionType; troopId: string; coordinate?: Coordinate }; origin?: Coordinate; }
interface ServerTargetSelection { troopId: string; type: GameActionType; coordinate: Coordinate; }
type GameActionType = 'deploy' | 'move' | 'fly' | 'attack' | 'cannon' | 'push' | 'magic' | 'mending' | 'upgrade' | 'defense' | 'self-defense' | 'pass';
interface ServerMatchState {
  id: string;
  activePlayer: Player;
  players: { 1: string; 2: string };
  sandbox?: boolean;
  sandboxSide?: Player;
  sandboxFreePlacement?: boolean;
  ready: { 1: boolean; 2: boolean };
  format: 8 | 10;
  status: 'active' | 'finished';
  winner?: Player;
  revision: number;
  decks: { 1: string[]; 2: string[] };
  deckChoices?: { 1?: number; 2?: number };
  units: ServerUnitState[];
  defeatedTroopIds: string[];
  effects: ServerEffectState[];
  bashes: ServerBashState[];
  lastActingTroopId?: Partial<Record<Player, string>>;
  selections?: Partial<Record<Player, string>>;
  targetSelections?: Partial<Record<Player, ServerTargetSelection>>;
  control: Record<string, ServerControlState>;
  events?: ServerGameEvent[];
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
  matchStatusPanel.textContent = match.sandbox
    ? `Sandbox: controlling ${local === 1 ? 'Red' : 'Blue'}. Switch sides between turns in the action bar.`
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
  const seed = troopSeeds.find(candidate => candidate.id === cardId);
  if (!seed) return undefined;
  return { ...seed, id: unit?.id ?? `${owner}:${cardId}`, player: owner, coordinate: unit?.coordinate, permanentDamage: unit?.permanentDamage ?? 0, rangedDamageBonus: unit?.rangedDamageBonus ?? 0, rangedRangeBonus: unit?.rangedRangeBonus ?? 0, upgrades: unit?.upgrades, defeated: serverMatch?.defeatedTroopIds.includes(`${owner}:${cardId}`) ?? false };
}

/** The card catalogue is the single source for names shown throughout the UI. */
function troopDisplayName(troop: Troop): string {
  return troop.name ?? (troop.role === 'hero' ? `Player ${troop.player} hero` : `Player ${troop.player} troop`);
}

function rangedDamage(troop: Troop, attack: AttackAction): number { return (attack.damage ?? healthOf(troop)) + (troop.rangedDamageBonus ?? 0); }
function rangedRange(troop: Troop, attack: AttackAction): number { return attack.range + (troop.rangedRangeBonus ?? 0); }
function upgradeBonus(troop: Troop, ability?: UpgradableAbility): { left: number; right: number } { return (troop.upgrades ?? []).filter(upgrade => !ability || upgrade.ability === ability || upgrade.ability === undefined).reduce<{ left: number; right: number }>((total, upgrade) => ({ left: total.left + (upgrade.left ?? 0), right: total.right + (upgrade.right ?? 0) }), { left: 0, right: 0 }); }

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

function appendHoverTroopSymbol(container: HTMLElement, troop: Troop): void {
  const icon = cardTroopIcon(troop.role);
  icon.classList.add('hover-troop-symbol');
  container.append(icon);
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

function serverCardDetails(troop: Troop): string[] {
  const move = troop.actions.find((action): action is MoveAction => action.type === 'move');
  const fly = troop.actions.find((action): action is FlyAction => action.type === 'fly');
  const attack = troop.actions.find((action): action is AttackAction => action.type === 'attack');
  const defense = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
  const magic = troop.actions.find((action): action is MagicAction => action.type === 'magic');
  const cannon = troop.actions.find((action): action is CannonAction => action.type === 'cannon');
  const push = troop.actions.find((action): action is PushAction => action.type === 'push');
  const mending = troop.actions.find((action): action is MendingAction => action.type === 'mending');
  const upgrade = troop.actions.find((action): action is UpgradeAction => action.type === 'upgrade');
  const detail = (ability: UpgradableAbility, text: string): string => { const bonus = upgradeBonus(troop, ability); return bonus.left || bonus.right ? `🔮 ${text}` : text; };
  return [move && move.maxDistance > 1 ? detail('move', `🥾 ${move.maxDistance + upgradeBonus(troop, 'move').right}`) : '', fly ? detail('fly', `🪽 ${fly.maxDistance + upgradeBonus(troop, 'fly').right}`) : '', attack ? detail('attack', `${rangedDamage(troop, attack) + upgradeBonus(troop, 'attack').left} 🏹 ${rangedRange(troop, attack) + upgradeBonus(troop, 'attack').right}`) : '', defense ? detail('defense', `${defense.block + upgradeBonus(troop, 'defense').left} 🛡️ ${defense.range + upgradeBonus(troop, 'defense').right}`) : '', magic ? detail('magic', `${magic.damage + upgradeBonus(troop, 'magic').left} 🔥 ${magic.range + upgradeBonus(troop, 'magic').right}`) : '', cannon ? detail('cannon', `${cannon.damage + upgradeBonus(troop, 'cannon').left} 🧨 ${cannon.range + upgradeBonus(troop, 'cannon').right}`) : '', push ? detail('push', `${push.maxDistance + upgradeBonus(troop, 'push').left}${pushIcon}${push.range + upgradeBonus(troop, 'push').right}`) : '', mending ? detail('mending', `${mending.amount + upgradeBonus(troop, 'mending').left} ❤️ ${mending.range + upgradeBonus(troop, 'mending').right}`) : '', upgrade ? detail('upgrade', `${upgrade.left ?? ''}🔮${upgrade.right ?? ''} ${upgrade.range}`) : '', troop.passiveDescription ?? ''].filter(Boolean);
}

function isServerLastActing(owner: Player, troopId: string): boolean {
  return serverMatch?.lastActingTroopId?.[owner] === troopId;
}

function selectServerTroop(troopId: string): void {
  if (!serverMatch || !localMatchPlayer || serverMatch.winner || serverMatch.activePlayer !== localMatchPlayer || isServerLastActing(localMatchPlayer, troopId)) return;
  const isInDeck = serverMatch.decks[localMatchPlayer].includes(troopId);
  if (!isInDeck || serverMatch.defeatedTroopIds.includes(`${localMatchPlayer}:${troopId}`)) return;
  const unit = serverMatch.units.find(candidate => candidate.owner === localMatchPlayer && candidate.troopId === troopId);
  serverActionError = undefined;
  serverInspectedUnitId = undefined;
  serverSelectedTroopId = serverSelectedTroopId === troopId ? undefined : troopId;
  const troop = serverSelectedTroopId ? serverTroop(troopId, localMatchPlayer, unit) : undefined;
  serverSelectedAction = serverSelectedTroopId ? (unit ? (troop?.actions.some(action => action.type === 'move') ? 'move' : troop?.actions.some(action => action.type === 'fly') ? 'fly' : undefined) : 'deploy') : undefined;
  serverPendingAction = undefined;
  sendServerSelection(serverSelectedTroopId);
  renderServerMatchState(serverMatch);
}

function renderServerTray(owner: Player, tray: HTMLElement, interactive: boolean): void {
  if (!serverMatch) return;
  tray.replaceChildren();
  tray.classList.remove('deck-builder');
  tray.classList.toggle('sandbox-catalog', Boolean(serverMatch.sandbox));
  const fragment = document.createDocumentFragment();
  for (const cardId of serverMatch.decks[owner]) {
    const unit = serverMatch.units.find(candidate => candidate.owner === owner && candidate.troopId === cardId);
    const troop = serverTroop(cardId, owner, unit);
    if (!troop) continue;
    const card = document.createElement('button');
    const lastActing = isServerLastActing(owner, cardId);
    const canChoose = interactive && !serverMatch.winner && !troop.defeated && !lastActing && serverMatch.activePlayer === owner;
    const canInspect = !interactive && Boolean(unit);
    const freePlacement = Boolean(serverMatch.sandbox && serverMatch.sandboxFreePlacement);
    card.type = 'button'; card.disabled = freePlacement ? false : interactive ? !canChoose : !canInspect;
    card.draggable = freePlacement;
    card.classList.add('troop-card', owner === 1 ? 'server-owner-one' : 'server-owner-two');
    card.dataset.deploymentOwner = owner === 1 ? 'red' : 'blue';
    if (troop.role === 'hero') card.classList.add('hero-card');
    if (unit) card.classList.add('deployed-card');
    if (lastActing) card.classList.add('last-acting-card');
    if (troop.defeated || lastActing) card.classList.add('unavailable-card');
    if ((owner === localMatchPlayer && serverSelectedTroopId === cardId) || serverMatch.selections?.[owner] === cardId || unit?.id === serverInspectedUnitId) card.classList.add('selected-card');
    if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-both');
    else if (troop.deploymentRegions.includes('starting')) card.classList.add('deployment-starting');
    else if (troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-intermediate');
    if (troop.deploymentRule === 'enemy-region' || troop.passiveDescription === 'Can be deployed only in enemy intermediate regions') {
      card.classList.add('deployment-enemy');
    }
    const title = document.createElement('strong'); title.textContent = troopDisplayName(troop);
    const details = document.createElement('span'); details.classList.add('troop-details');
    for (const detail of threeLineSummary(troop.defeated ? ['Defeated'] : serverCardDetails(troop))) { const line = document.createElement('span'); line.textContent = detail; if (detail.startsWith('🔮 ')) line.classList.add('upgraded-detail'); details.append(line); }
    const symbol = cardTroopIcon(troop.role);
    const life = document.createElement('span'); life.classList.add('card-health'); life.textContent = healthDescription(troop);
    card.append(title, details, symbol, life);
    card.addEventListener('pointerenter', () => showHoverDetails([troop]));
    card.addEventListener('pointerleave', hideHoverDetails);
    card.addEventListener('dragstart', event => {
      if (!freePlacement) return;
      draggedSandboxTroop = { owner, troopId: cardId };
      event.dataTransfer?.setData('text/plain', `${owner}:${cardId}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => { draggedSandboxTroop = undefined; });
    card.addEventListener('click', () => {
      if (canChoose) selectServerTroop(cardId);
      else if (canInspect && unit) { serverInspectedUnitId = unit.id; renderServerMatchState(serverMatch as ServerMatchState); }
    });
    fragment.append(card);
  }
  tray.append(fragment);
}

function clearServerBoardRender(): void {
  // Remove any pre-server prototype markers too: the snapshot is the only
  // source of board visuals once a real match has been joined.
  boardPanel.querySelectorAll<SVGElement>('[data-server-render], .board-troop, .board-troop-description, .action-land, .bash-stat, .bash-icon').forEach(element => element.remove());
  troopsByCoordinate.clear();
  pendingAttacks.splice(0); pendingTimedEffects.splice(0); pendingBashes.splice(0);
  clearServerPreviewPath();
  for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('server-controlled-one', 'server-controlled-two', 'server-contested', 'server-selected', 'server-selected-one', 'server-selected-two', 'server-last-acting', 'server-action-highlight', 'server-action-highlight-one', 'server-action-highlight-two', 'server-pending-target', 'server-pending-target-one', 'server-pending-target-two', 'server-remote-pending-target', 'server-reachable', 'server-bash-target');
}

function serverRegionId(coordinate: Coordinate): string | undefined { return regionForCoordinate(coordinate)?.id; }

/**
 * Board colour is a presentation of the received unit positions.  Calculate
 * it here instead of relying only on the summary included in a state message:
 * this keeps region outlines in sync with a just-completed movement update.
 * A bash attacker is still stored on its origin until the bash resolves, but
 * already contributes from the contested destination.
 */
function serverRegionController(match: ServerMatchState, regionId: string | undefined, previewBash?: ServerBashState): Player | undefined {
  const targetRegion = regions.find(region => region.id === regionId);
  if (!targetRegion) return undefined;
  let playerOne = targetRegion.homePlayer === 1 ? .5 : 0;
  let playerTwo = targetRegion.homePlayer === 2 ? .5 : 0;
  const bashTargets = new Map(match.bashes.map(bash => [bash.attackerId, bash.target]));
  if (previewBash) bashTargets.set(previewBash.attackerId, previewBash.target);
  for (const unit of match.units) {
    const coordinate = bashTargets.get(unit.id) ?? unit.coordinate;
    if (regionForCoordinate(coordinate)?.id !== targetRegion.id) continue;
    if (unit.owner === 1) playerOne += unit.currentHealth;
    else playerTwo += unit.currentHealth;
  }
  return playerOne === playerTwo ? undefined : playerOne > playerTwo ? 1 : 2;
}
/**
 * The board itself is rotated for Blue.  Counter-rotate each overlay about
 * its hex centre (not its own bounding box) so it stays upright and keeps
 * exactly the same visual offset as in Red's view.
 */
function keepServerOverlayUpright(element: SVGElement, centre: Point): void {
  if (localMatchPlayer === 2) element.setAttribute('transform', `rotate(180 ${centre.x} ${centre.y})`);
}
interface ModifierEntry { label: string; value: number; }

function serverBashHasSteadyOpponent(unit: ServerUnitState, bash: ServerBashState | undefined): boolean {
  const match = serverMatch;
  if (!bash || !match) return false;
  const opponentId = bash.attackerId === unit.id ? bash.defenderId : bash.attackerId;
  return match.units.find(candidate => candidate.id === opponentId)?.troopId === 'canyon-hawk';
}

function serverPreviewTargets(): Array<{ owner: Player; target: ServerTargetSelection }> {
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

function serverControllerWithPreview(coordinate: Coordinate, previewBash?: ServerBashState): Player | undefined {
  if (!serverMatch) return undefined;
  const regionId = serverRegionId(coordinate);
  if (!regionId) return undefined;
  const targetRegion = regions.find(region => region.id === regionId);
  if (!targetRegion) return undefined;
  let playerOne = targetRegion.homePlayer === 1 ? .5 : 0;
  let playerTwo = targetRegion.homePlayer === 2 ? .5 : 0;
  const bashTargets = new Map(serverMatch.bashes.map(bash => [bash.attackerId, bash.target]));
  if (previewBash) bashTargets.set(previewBash.attackerId, previewBash.target);
  for (const unit of serverMatch.units) {
    const unitCoordinate = bashTargets.get(unit.id) ?? unit.coordinate;
    if (serverRegionId(unitCoordinate) !== regionId) continue;
    if (unit.owner === 1) playerOne += unit.currentHealth;
    else playerTwo += unit.currentHealth;
  }
  for (const { owner, target } of serverPreviewTargets()) {
    if (target.type !== 'deploy' || serverRegionId(target.coordinate) !== regionId) continue;
    const troop = serverTroop(target.troopId, owner);
    if (troop) {
      if (owner === 1) playerOne += healthOf(troop);
      else playerTwo += healthOf(troop);
    }
  }
  return playerOne === playerTwo ? undefined : playerOne > playerTwo ? 1 : 2;
}

function serverModifierEntries(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): ModifierEntry[] {
  if (!serverMatch) return [];
  // Steady suppresses only the Hawk's opponent. Return no entries instead of
  // showing a shield/control bonus that is deliberately being ignored.
  if (serverBashHasSteadyOpponent(unit, bash)) return [];
  const entries: ModifierEntry[] = [];
  const confirmedBlock = serverMatch.effects.filter(effect => effect.kind === 'defense' && effect.owner === unit.owner && effect.target === coordinate)
    .reduce((sum, effect) => sum + effect.value + (unit.troopId === 'p2-2' && effect.sourceUnitId !== unit.id ? 1 : 0), 0);
  const previewBlock = serverPreviewTargets()
    .filter(({ owner, target }) => owner === unit.owner && target.coordinate === coordinate && (target.type === 'defense' || target.type === 'self-defense'))
    .reduce((sum, { owner, target }) => {
      const source = serverMatch?.units.find(candidate => candidate.owner === owner && candidate.troopId === target.troopId);
      const troop = serverTroop(target.troopId, owner, source);
      const value = target.type === 'self-defense'
        ? (troop?.selfDefense ?? 1) + (troop ? upgradeBonus(troop, 'self-defense').left : 0)
        : (troop?.actions.find((action): action is DefenseAction => action.type === 'defense')?.block ?? 0) + (troop ? upgradeBonus(troop, 'defense').left : 0);
      return sum + value + (unit.troopId === 'p2-2' && source?.id !== unit.id ? 1 : 0);
    }, 0);
  const block = confirmedBlock + previewBlock;
  if (block) entries.push({ label: '🛡️', value: block });
  if (block > 0 && unit.troopId === 'p1-5') entries.push({ label: 'Marsh Badger', value: -1 });
  if (unit.troopId === 'alps-lone-wolf' && unit.permanentDamage > 0) entries.push({ label: 'Alps Lone Wolf', value: 2 });
  const control = serverControllerWithPreview(coordinate, bash) === unit.owner ? 1 : 0;
  if (control) entries.push({ label: 'Control', value: 1 });
  if (bash?.attackerId === unit.id && (unit.troopId === 'p1-4' || unit.troopId === 'canyon-ibex')) entries.push({ label: 'Canyon Ibex', value: 2 });
  if (bash && serverMatch.units.some(candidate => candidate.owner === unit.owner && candidate.troopId === 'war-temple')) entries.push({ label: 'War Temple', value: 1 });
  return entries;
}

function serverModifier(unit: ServerUnitState, coordinate: Coordinate, bash?: ServerBashState): number {
  return serverModifierEntries(unit, coordinate, bash).reduce((total, entry) => total + entry.value, 0);
}

function appendServerBoardUnit(unit: ServerUnitState): void {
  const target = cellsByCoordinate.get(unit.coordinate); const troop = serverTroop(unit.troopId, unit.owner, unit);
  if (!target || !troop) return;
  const localBottomOffset = 20 + 32 * .4;
  const marker = boardTroopIcon(troop.role, unit.owner, target.position.x, target.position.y + localBottomOffset); marker.dataset.serverRender = 'unit'; marker.classList.add('board-troop', unit.owner === 1 ? 'player-one-troop' : 'player-two-troop');
  if (serverMatch?.sandboxFreePlacement) {
    marker.classList.add('sandbox-draggable');
    marker.setAttribute('draggable', 'true');
    marker.addEventListener('dragstart', event => {
      draggedSandboxTroop = { owner: unit.owner, troopId: unit.troopId };
      event.dataTransfer?.setData('text/plain', `${unit.owner}:${unit.troopId}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    marker.addEventListener('dragend', () => { draggedSandboxTroop = undefined; });
  }
  keepServerOverlayUpright(marker, target.position);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  if (isServerLastActing(unit.owner, unit.troopId)) {
    marker.classList.add('last-acting-troop');
    target.cell.classList.add('server-last-acting');
  }
  if ((unit.owner === localMatchPlayer && unit.troopId === serverSelectedTroopId) || serverMatch?.selections?.[unit.owner] === unit.troopId || unit.id === serverInspectedUnitId) target.cell.classList.add('server-selected', unit.owner === 1 ? 'server-selected-one' : 'server-selected-two');
  // Every overlay needs the same mirrored local placement as the icon.  The
  // board rotates for Blue, but the sprite/text is counter-rotated by CSS.
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
    const control = serverRegionController(serverMatch, serverRegionId(bash.target));
    const isHomeOrMiddle = ['player-one-middle', 'player-one-side', 'player-two-middle', 'player-two-side'].some(name => target.cell.classList.contains(name));
    const controlStroke = control === 1 ? (isHomeOrMiddle ? '#fb7185' : '#ef4444') : control === 2 ? (isHomeOrMiddle ? '#60a5fa' : '#3b82f6') : '#e5e7eb';
    // A bash holds two troops in one hex.  Its two half-borders describe
    // their own availability: the troop that moved (and any defender that
    // already acted) is grey; an available defender retains the region colour.
    for (const [pathData, unit, stroke] of [
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
    const isLocalTroop = unit.owner === localMatchPlayer;
    const statY = target.position.y + (isLocalTroop ? 24 : -18);
    const stat = document.createElementNS(ns, 'text'); stat.dataset.serverRender = 'bash'; stat.classList.add('bash-stat', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash'); stat.setAttribute('x', String(target.position.x)); stat.setAttribute('y', String(statY)); stat.textContent = `${unit.currentHealth} + ${serverModifier(unit, bash.target, bash)}`;
    keepServerOverlayUpright(stat, target.position);
    target.cell.append(stat);
  }
}

/** The prospective bash created by an unconfirmed move, flight, or push. */
function serverPendingBash(): ServerBashState | undefined {
  const match = serverMatch; const pending = serverPendingAction; const local = localMatchPlayer;
  if (!match || !pending || !local) return undefined;
  if ((pending.type === 'move' || pending.type === 'fly') && pending.coordinate) {
    const attacker = match.units.find(unit => unit.owner === local && unit.troopId === pending.troopId);
    const defender = match.units.find(unit => unit.coordinate === pending.coordinate && unit.owner !== local);
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
  if (bash) appendServerBash(bash, false);
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
  // local selection echo. Clear the previous side's card/action before the
  // sandbox switches to the next player; both trays share card IDs, so a
  // stale ID could otherwise look like an undeployed card for that player.
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
  renderServerTray(local, playerOneCardsPanel, true);
  renderServerTray(local === 1 ? 2 : 1, playerTwoCardsPanel, false);
  clearServerBoardRender();
  for (const [coordinate, { cell }] of cellsByCoordinate) {
    const controller = serverRegionController(match, serverRegionId(coordinate));
    cell.classList.add(controller === 1 ? 'server-controlled-one' : controller === 2 ? 'server-controlled-two' : 'server-contested');
  }
  const bashingIds = new Set(match.bashes.flatMap(bash => [bash.attackerId, bash.defenderId]));
  const previewDefenderId = serverPendingBash()?.defenderId;
  for (const unit of match.units) if (!bashingIds.has(unit.id) && unit.id !== previewDefenderId) appendServerBoardUnit(unit);
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
  if (match.bashes.length === 0) appendServerPreviewBash();
  for (const [owner, target] of Object.entries(match.targetSelections ?? {})) {
    if (!target?.coordinate) continue;
    const selectionOwner = Number(owner) as Player;
    const highlightClass = selectionOwner === local ? 'server-pending-target' : 'server-remote-pending-target';
    const ownerClass = selectionOwner === 1 ? 'server-pending-target-one' : 'server-pending-target-two';
    const localPushPreview = Number(owner) === local && target.type === 'push' && serverPendingAction?.type === 'push' && serverPendingAction.destination;
    if (!localPushPreview) cellsByCoordinate.get(target.coordinate)?.cell.classList.add(highlightClass, ownerClass, 'server-reachable');
    if (target.type === 'cannon') {
      const source = match.units.find(unit => unit.owner === Number(owner) && unit.troopId === target.troopId);
      const sourceTroop = source ? serverTroop(source.troopId, source.owner, source) : undefined;
      const cannon = sourceTroop?.actions.find((action): action is CannonAction => action.type === 'cannon');
      if (source && cannon) for (const coordinate of cannonLineCoordinates(source.coordinate, target.coordinate, cannon.range) ?? []) {
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

function serverPushLine(from: Coordinate, target: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number); const [targetX, targetY] = target.split(',').map(Number);
  const dx = targetX - fromX; const dy = targetY - fromY;
  if (!hexDistance(from, target) || !(dx === 0 || dy === 0 || dx === dy)) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx); const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: maxDistance }, (_, index) => toCoordinate(targetX + stepX * (index + 1), targetY + stepY * (index + 1)));
  // Match the engine: a pushed troop may cross the centre, but cannot land
  // there or outside the board.
  const destination = line.at(-1);
  return destination && cellsByCoordinate.has(destination) && destination !== '0,0' ? line : undefined;
}

function performServerActionAt(coordinate: Coordinate): void {
  if (!serverMatch || serverMatch.winner || !localMatchPlayer || !serverSelectedTroopId || !serverSelectedAction || serverMatch.activePlayer !== localMatchPlayer) return;
  if (serverSelectedAction === 'self-defense') return;
  const unit = selectedServerUnit();
  const troop = unit ? serverTroop(serverSelectedTroopId, localMatchPlayer, unit) : undefined;
  const action = serverSelectedAction === 'move' ? troop?.actions.find(item => item.type === 'move')
    : serverSelectedAction === 'fly' ? troop?.actions.find(item => item.type === 'fly')
    : troop?.actions.find(item => item.type === serverSelectedAction);
  const bonus = troop && serverSelectedAction && serverSelectedAction !== 'deploy' && serverSelectedAction !== 'pass' ? upgradeBonus(troop, serverSelectedAction) : { left: 0, right: 0 };
  const maxDistance = action && ('maxDistance' in action ? action.maxDistance + (serverSelectedAction === 'push' ? bonus.left : bonus.right) : 'range' in action ? action.range + bonus.right + (serverSelectedAction === 'attack' ? troop?.rangedRangeBonus ?? 0 : 0) : undefined);
  if (serverSelectedAction === 'push' && unit && troop) {
    const push = troop.actions.find((item): item is PushAction => item.type === 'push');
    if (!push) return;
    const pushBonus = upgradeBonus(troop, 'push');
    const pushed = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
    const line = pushed && coordinate !== unit.coordinate && hexDistance(unit.coordinate, coordinate) <= push.range + pushBonus.right
      ? serverPushLine(unit.coordinate, coordinate, push.maxDistance + pushBonus.left) : undefined;
    const destination = line?.at(-1);
    const landing = destination && serverMatch.units.find(candidate => candidate.coordinate === destination);
    if (!pushed || !destination || landing?.owner === pushed.owner) return;
    serverPushTarget = coordinate;
    serverPendingAction = { type: 'push', troopId: serverSelectedTroopId, coordinate, destination };
    sendServerSelection(serverSelectedTroopId, { type: 'push', coordinate });
    renderServerMatchState(serverMatch);
    return;
  }
  if (unit && typeof maxDistance === 'number' && hexDistance(unit.coordinate, coordinate) > maxDistance) {
    serverActionError = 'Destination is out of range.';
    renderServerActionBar(serverMatch, localMatchPlayer);
    return;
  }
  if (unit && serverSelectedAction === 'move' && typeof maxDistance === 'number' && !serverMovePath(unit.coordinate, coordinate, maxDistance)) {
    serverActionError = 'Move has no free path.';
    renderServerActionBar(serverMatch, localMatchPlayer);
    return;
  }
  if (serverSelectedAction === 'upgrade' || serverSelectedAction === 'mending') {
    const recipient = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
    const recipientTroop = recipient ? serverTroop(recipient.troopId, recipient.owner, recipient) : undefined;
    if (!recipient || recipient.owner !== localMatchPlayer || (serverSelectedAction === 'upgrade' && recipientTroop?.role === 'temple')) {
      serverActionError = `${serverSelectedAction === 'upgrade' ? 'Upgrade' : 'Mending'} must target a friendly troop.`;
      renderServerActionBar(serverMatch, localMatchPlayer);
      return;
    }
  }
  serverPendingAction = { type: serverSelectedAction, troopId: serverSelectedTroopId, coordinate };
  sendServerSelection(serverSelectedTroopId, { type: serverSelectedAction, coordinate });
  // Show the prospective block/control contribution immediately, rather
  // than waiting for the selection echo from the server.
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
  const troop = serverSelectedTroopId && localMatchPlayer ? serverTroop(serverSelectedTroopId, localMatchPlayer, unit) : undefined;
  const move = troop?.actions.find((action): action is MoveAction => action.type === 'move');
  if (!unit || !troop || !move || serverSelectedAction !== 'move') return;
  const path = serverMovePath(unit.coordinate, coordinate, move.maxDistance + upgradeBonus(troop, 'move').right);
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
  // Match the bash marker: the opponent is described at the top and the
  // local player's troop at the bottom, regardless of who initiated it.
  for (const unit of displayed.sort((left, right) => (left.owner === localMatchPlayer ? 1 : 0) - (right.owner === localMatchPlayer ? 1 : 0))) {
    const troop = serverTroop(unit.troopId, unit.owner, unit); if (!troop) continue;
    const section = document.createElement('section');
    const heading = document.createElement('strong'); heading.textContent = troopDisplayName(troop);
    const life = document.createElement('div'); life.textContent = hoverLifeLine(troop); section.append(heading, life);
    if (bash) {
      const modifier = serverModifier(unit, coordinate, bash);
      const combat = document.createElement('div'); combat.textContent = `Bash strength: ${unit.currentHealth} + ${modifier} = ${unit.currentHealth + modifier}`; section.append(combat);
      for (const entry of serverModifierEntries(unit, coordinate, bash)) {
        const source = document.createElement('div'); source.textContent = `${entry.label}: ${entry.value >= 0 ? '+' : ''}${entry.value}`; section.append(source);
      }
    }
    for (const line of threeLineSummary(fullEffectLines(troop))) { const detail = document.createElement('div'); appendHoverEffectLine(detail, troop, line); section.append(detail); }
    appendHoverTroopSymbol(section, troop);
    hoverDetailsPanel.append(section);
  }
  hoverDetailsPanel.hidden = false;
}

function renderServerActionTargets(): void {
  for (const { cell } of cellsByCoordinate.values()) cell.classList.remove('action-target', 'push-target', 'deployment-target', 'region-target', 'server-pending-target', 'server-reachable');
  const unit = selectedServerUnit();
  const troop = serverSelectedTroopId && localMatchPlayer ? serverTroop(serverSelectedTroopId, localMatchPlayer, unit) : undefined;
  if (!serverMatch || !localMatchPlayer || !troop || !serverSelectedAction) return;
  const occupied = new Set(serverMatch.units.map(item => item.coordinate));
  if (unit && serverSelectedAction === 'push') {
    const push = troop.actions.find((action): action is PushAction => action.type === 'push');
    if (!push) return;
    const pushBonus = upgradeBonus(troop, 'push');
    for (const [coordinate, target] of cellsByCoordinate) {
      const pushed = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
      const line = pushed && coordinate !== unit.coordinate && hexDistance(unit.coordinate, coordinate) <= push.range + pushBonus.right ? serverPushLine(unit.coordinate, coordinate, push.maxDistance + pushBonus.left) : undefined;
      if (pushed && line) target.cell.classList.add('action-target', 'push-target', 'region-target', 'server-reachable');
    }
    if (serverPendingAction?.type === 'push' && serverPendingAction.destination) {
      // Once the target is selected, show only where it will land. The
      // source and any crossed hexes stay visually quiet.
      cellsByCoordinate.get(serverPendingAction.destination)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
    return;
  }
  for (const [coordinate, target] of cellsByCoordinate) {
    if (coordinate === '0,0') continue;
    let available = false;
    if (serverSelectedAction === 'deploy') {
      const region = regionForCoordinate(coordinate);
      const control = region && serverMatch.control[region.id]?.controller;
      const enemyIntermediateOnly = troop.passiveDescription === 'Can be deployed only in enemy intermediate regions';
      const enemyRegionOnly = troop.deploymentRule === 'enemy-region';
      available = !occupied.has(coordinate) && Boolean(region) && (enemyIntermediateOnly
        ? region?.type === 'intermediate' && region.homePlayer !== localMatchPlayer && control === localMatchPlayer
        : enemyRegionOnly
          ? Boolean(region && troop.deploymentRegions.includes(region.type) && region.homePlayer !== undefined && region.homePlayer !== localMatchPlayer && control === localMatchPlayer)
        : Boolean(region && troop.deploymentRegions.includes(region.type) && control === localMatchPlayer));
    } else if (unit && serverSelectedAction !== 'self-defense') {
      const seed = troop;
      const action = serverSelectedAction === 'move' ? seed.actions.find(item => item.type === 'move')
        : serverSelectedAction === 'fly' ? seed.actions.find(item => item.type === 'fly')
        : seed.actions.find(item => item.type === serverSelectedAction);
      const bonus = serverSelectedAction === 'pass' ? { left: 0, right: 0 } : upgradeBonus(troop, serverSelectedAction);
      const maxDistance = action && ('maxDistance' in action ? action.maxDistance + (serverSelectedAction === 'push' ? bonus.left : bonus.right) : 'range' in action ? action.range + bonus.right + (serverSelectedAction === 'attack' ? troop.rangedRangeBonus ?? 0 : 0) : -1);
      if (serverSelectedAction === 'move' && action && 'maxDistance' in action) {
        const occupant = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
        const bashAlreadyThere = serverMatch.bashes.some(bash => bash.target === coordinate);
        available = occupant?.owner !== localMatchPlayer && !bashAlreadyThere && Boolean(serverMovePath(unit.coordinate, coordinate, action.maxDistance + bonus.right));
      } else if (serverSelectedAction === 'fly' && action && 'maxDistance' in action) {
        const occupant = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
        const bashAlreadyThere = serverMatch.bashes.some(bash => bash.target === coordinate);
        available = occupant?.owner !== localMatchPlayer && !bashAlreadyThere && hexDistance(unit.coordinate, coordinate) <= action.maxDistance + bonus.right;
      } else {
        const occupant = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
        const bashTarget = serverMatch.bashes.some(bash => bash.target === coordinate);
        const enemyOnly = serverSelectedAction === 'attack' || serverSelectedAction === 'magic';
        const friendlyOnly = serverSelectedAction === 'mending' || serverSelectedAction === 'upgrade';
        const recipient = occupant ? serverTroop(occupant.troopId, occupant.owner, occupant) : undefined;
        available = typeof maxDistance === 'number' && hexDistance(unit.coordinate, coordinate) <= maxDistance
          && (!enemyOnly || !occupant || occupant.owner !== localMatchPlayer || bashTarget)
          && (!friendlyOnly || (occupant?.owner === localMatchPlayer && (serverSelectedAction !== 'upgrade' || recipient?.role !== 'temple')));
        if (serverSelectedAction === 'cannon') available &&= typeof maxDistance === 'number' && Boolean(cannonLineCoordinates(unit.coordinate, coordinate, maxDistance));
        if (serverSelectedAction === 'defense') available &&= serverIncomingPhysicalThreatAt(localMatchPlayer, coordinate);
      }
    }
    if (available) {
      const isPendingTarget = serverPendingAction?.coordinate === coordinate;
      if (!isPendingTarget) target.cell.classList.add('action-target');
      target.cell.classList.add('region-target');
      target.cell.classList.add('server-reachable');
      if (serverSelectedAction === 'deploy') target.cell.classList.add('deployment-target');
    }
    if (serverPendingAction?.coordinate === coordinate) target.cell.classList.add('server-pending-target', 'server-reachable');
  }
  if (unit && serverPendingAction?.type === 'cannon' && serverPendingAction.coordinate) {
    const cannon = troop.actions.find((action): action is CannonAction => action.type === 'cannon');
    for (const coordinate of cannonLineCoordinates(unit.coordinate, serverPendingAction.coordinate, cannon?.range ?? 0) ?? []) {
      cellsByCoordinate.get(coordinate)?.cell.classList.add('server-pending-target', 'server-reachable');
    }
  }
}

function serverIncomingPhysicalThreatAt(player: Player, coordinate: Coordinate): boolean {
  if (!serverMatch) return false;
  return serverMatch.effects.some(effect => (effect.kind === 'attack' || effect.kind === 'cannon') && effect.owner !== player && effect.target === coordinate)
    || serverMatch.bashes.some(bash => bash.target === coordinate && serverMatch?.units.find(unit => unit.id === bash.defenderId)?.owner === player);
}

function canServerPlaceDefense(troop: Troop, unit: ServerUnitState): boolean {
  const defense = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
  return Boolean(defense && serverMatch && [...cellsByCoordinate.keys()].some(coordinate =>
    hexDistance(unit.coordinate, coordinate) <= defense.range + upgradeBonus(troop, 'defense').right && serverIncomingPhysicalThreatAt(unit.owner, coordinate)
  ));
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
    save.type = 'button'; save.textContent = 'Save sandbox';
    save.addEventListener('click', () => { void saveSandbox(match); });
    const load = document.createElement('button');
    load.type = 'button'; load.textContent = 'Load saved';
    load.addEventListener('click', () => { void loadSandbox().catch(error => {
      serverActionError = error instanceof Error ? error.message : 'Could not load sandbox.';
      renderServerActionBar(match, local);
    }); });
    const menu = document.createElement('button');
    menu.type = 'button'; menu.textContent = 'Back to menu';
    menu.addEventListener('click', () => {
      resumableSandbox = match;
      resumeSandboxButtonPanel.hidden = false;
      mainPanel.hidden = true;
      menuScreenPanel.hidden = false;
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
  const troop = serverSelectedTroopId ? serverTroop(serverSelectedTroopId, local, unit) : undefined;
  if (!troop || match.activePlayer !== local || match.winner) return;
  if (!unit) {
    message.textContent = serverPendingAction ? `Deploy to ${serverPendingAction.coordinate}. Confirm when ready.` : 'Choose a controlled highlighted hex to deploy this card.';
  } else {
    const actions: Array<[GameActionType, string]> = [];
    if (troop.actions.some(action => action.type === 'move')) actions.push(['move', '🥾 Move']);
    if (troop.actions.some(action => action.type === 'fly')) actions.push(['fly', '🪽 Fly']);
    if (troop.actions.some(action => action.type === 'attack')) actions.push(['attack', '🏹 Attack']);
    if (troop.actions.some(action => action.type === 'cannon')) actions.push(['cannon', '🧨 Cannon']);
    if (troop.actions.some(action => action.type === 'push')) actions.push(['push', `${pushIcon} Push`]);
    if (canServerPlaceDefense(troop, unit)) actions.push(['defense', '🛡️ Block']);
    if (serverIncomingPhysicalThreatAt(local, unit.coordinate)) actions.push(['self-defense', '🛡️ Self block']);
    if (troop.actions.some(action => action.type === 'magic')) actions.push(['magic', '🔥 Magic']);
    if (troop.actions.some(action => action.type === 'mending')) actions.push(['mending', '❤️ Mend']);
    if (troop.actions.some(action => action.type === 'upgrade')) actions.push(['upgrade', '🔮 Upgrade']);
    for (const [type, label] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.classList.toggle('active-action', serverSelectedAction === type);
      button.addEventListener('click', () => {
        serverSelectedAction = type;
        serverPushTarget = undefined;
        const selfBlockTarget = type === 'self-defense' ? unit.coordinate : undefined;
        serverPendingAction = type === 'self-defense' ? { type, troopId: serverSelectedTroopId as string, coordinate: selfBlockTarget } : undefined;
        sendServerSelection(serverSelectedTroopId, selfBlockTarget ? { type, coordinate: selfBlockTarget } : undefined);
        renderServerMatchState(match);
      });
      actionBarPanel.append(button);
    }
  }
  if (serverPendingAction?.type === 'upgrade' && serverPendingAction.coordinate) {
    const recipientUnit = match.units.find(candidate => candidate.coordinate === serverPendingAction?.coordinate);
    const recipient = recipientUnit ? serverTroop(recipientUnit.troopId, recipientUnit.owner, recipientUnit) : undefined;
    const sourceUpgrade = troop.actions.find((action): action is UpgradeAction => action.type === 'upgrade');
    if (recipient && sourceUpgrade) {
      message.textContent = 'Choose the recipient ability to upgrade.';
      const abilities: UpgradableAbility[] = [
        ...recipient.actions.map(action => action.type).filter((type): type is Exclude<UpgradableAbility, 'self-defense'> => type !== 'move' || sourceUpgrade.right !== undefined),
        ...(recipient.selfDefense !== undefined && sourceUpgrade.left !== undefined ? ['self-defense' as const] : [])
      ].filter(type => (type === 'move' || type === 'fly') ? sourceUpgrade.right !== undefined : sourceUpgrade.left !== undefined || sourceUpgrade.right !== undefined);
      for (const ability of abilities) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = ability === 'self-defense' ? '🛡️ Self block' : ability === 'mending' ? '❤️ Mend' : ability === 'upgrade' ? '🔮 Upgrade' : ability === 'attack' ? '🏹 Attack' : ability === 'magic' ? '🔥 Magic' : ability === 'cannon' ? '🧨 Cannon' : ability === 'defense' ? '🛡️ Block' : ability === 'push' ? `${pushIcon} Push` : ability === 'fly' ? '🪽 Fly' : '🥾 Move';
        button.classList.toggle('active-action', serverPendingAction.ability === ability);
        button.addEventListener('click', () => { if (serverPendingAction) { serverPendingAction.ability = ability; renderServerActionBar(match, local); } });
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
  if (!serverMatch?.sandboxFreePlacement || !draggedSandboxTroop || !matchSocket || matchSocket.readyState !== WebSocket.OPEN) return;
  const { owner, troopId } = draggedSandboxTroop;
  matchSocket.send(JSON.stringify({ type: 'sandbox-place', matchId: serverMatch.id, owner, troopId, coordinate }));
}

async function setSandboxSide(match: ServerMatchState, side: Player): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/sandbox/${match.id}/side`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname, side })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Set sandbox side');
  if (!response.ok || !payload.match) { serverActionError = payload.error ?? 'Could not switch sandbox side.'; renderServerActionBar(match, localMatchPlayer ?? side); return; }
  serverSelectedTroopId = undefined; serverSelectedAction = undefined; serverPendingAction = undefined;
  renderServerMatchState(payload.match);
}

async function saveSandbox(match: ServerMatchState): Promise<void> {
  if (!currentNickname) return;
  const response = await fetch(`/api/sandbox/${match.id}/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
  });
  const payload = await readApiJson<{ savedAt?: string; error?: string }>(response, 'Save sandbox');
  serverActionError = response.ok ? `Sandbox saved${payload.savedAt ? ` at ${new Date(payload.savedAt).toLocaleTimeString()}` : '.'}` : payload.error ?? 'Could not save the sandbox.';
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

/*
 * Legacy prototype resolver.
 *
 * These functions are retained only while their presentation helpers are
 * being extracted. They have no event path from a live match: the deck
 * builder cannot start a board locally and board clicks dispatch only through
 * performServerActionAt(). Live state is exclusively `serverMatch`.
 */
function heroForPlayer(player: Player): Troop {
  const hero = [...troops.values()].find(troop => troop.player === player && troop.role === 'hero');
  if (!hero) throw new Error(`Player ${player} hero is missing.`);
  return hero;
}

function rosterForPlayer(player: Player): Troop[] {
  return [...troops.values()]
    .filter(troop => troop.player === player && (player !== 1 || !matchStarted || playerOneDeck.includes(troop.id)))
    .sort((left, right) => (left.role === 'hero' ? -1 : right.role === 'hero' ? 1 : left.id.localeCompare(right.id)));
}

function canSelectTroop(troop: Troop): boolean {
  if (gameState.winner) return false;
  if (gameState.awaitingResolutionTroopId) return false;
  if (troop.player !== gameState.activePlayer) return false;
  if (troop.defeated) return false;
  if (gameState.lastActingTroopIdByPlayer.get(troop.player) === troop.id) return false;
  if (troop.coordinate !== undefined) return true;
  return troop.role === 'hero' || heroForPlayer(troop.player).coordinate !== undefined;
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
  if (troop.deploymentRule === 'enemy-region' || troop.passiveDescription === 'Can be deployed only in enemy intermediate regions') card.classList.add('deployment-enemy');
  const name = document.createElement('strong');
  name.textContent = troopDisplayName(troop);
  const details = document.createElement('span');
  details.classList.add('troop-details');
    for (const effect of threeLineSummary(fullEffectLines(troop))) {
    const line = document.createElement('span');
    line.textContent = effect;
    details.append(line);
  }
  const symbol = cardTroopIcon(troop.role);
  const health = document.createElement('span');
  health.classList.add('card-health');
  health.textContent = `♥ ${troop.baseHealth}`;
  card.append(name, details, symbol, health);
  card.addEventListener('pointerenter', () => showHoverDetails([troop]));
  card.addEventListener('pointerleave', hideHoverDetails);
  if (className === 'database-card') {
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      draggedDatabaseCardId = troop.id;
      draggedDeckSlot = undefined;
    });
    card.addEventListener('dblclick', () => addCardToDeck(troop.id));
  } else if (slot !== undefined) {
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      draggedDeckSlot = slot;
      draggedDatabaseCardId = undefined;
    });
    card.addEventListener('dblclick', () => removeCardFromDeck(slot));
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
  if (playerOneDeck.includes(cardId)) return;
  if (troops.get(cardId)?.role === 'hero' && playerOneDeck.some(id => id && troops.get(id)?.role === 'hero')) return;
  const emptySlot = playerOneDeck.findIndex(card => card === undefined);
  if (emptySlot < 0) return;
  playerOneDeck[emptySlot] = cardId;
  savePlayerOneDeck();
  renderDeckBuilder();
}

function removeCardFromDeck(slot: number): void {
  playerOneDeck[slot] = undefined;
  savePlayerOneDeck();
  renderDeckBuilder();
}

function moveDatabaseCardToSlot(cardId: string, slot: number): void {
  const replacing = playerOneDeck[slot];
  if (troops.get(cardId)?.role === 'hero' && !playerOneDeck.includes(cardId)
    && playerOneDeck.some(id => id && id !== replacing && troops.get(id)?.role === 'hero')) return;
  const oldSlot = playerOneDeck.findIndex(card => card === cardId);
  if (oldSlot === slot) return;
  if (oldSlot >= 0) playerOneDeck[oldSlot] = playerOneDeck[slot];
  playerOneDeck[slot] = cardId;
  draggedDatabaseCardId = undefined;
  draggedDeckSlot = undefined;
  savePlayerOneDeck();
  renderDeckBuilder();
}

function swapDeckSlots(from: number, to: number): void {
  if (from === to) return;
  [playerOneDeck[from], playerOneDeck[to]] = [playerOneDeck[to], playerOneDeck[from]];
  draggedDeckSlot = undefined;
  savePlayerOneDeck();
  renderDeckBuilder();
}

function renderDeckBuilder(): void {
  gameLayoutPanel.classList.add('deck-building');
  playerTwoCardsPanel.replaceChildren();
  playerOneCardsPanel.replaceChildren();
  playerTwoCardsPanel.classList.add('deck-builder');
  playerOneCardsPanel.classList.add('deck-builder');
  for (const cardId of playerOneDatabase.filter(cardId => !playerOneDeck.includes(cardId))) {
    const troop = troops.get(cardId);
    if (troop) playerTwoCardsPanel.append(renderDeckCard(troop, 'database-card'));
  }
  for (let slot = 0; slot < deckFormat; slot += 1) {
    const troop = playerOneDeck[slot] ? troops.get(playerOneDeck[slot] as string) : undefined;
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
  renderActionBar();
}

function renderTroopCards(player: Player, tray: HTMLElement): void {
  gameLayoutPanel.classList.remove('deck-building');
  tray.classList.remove('deck-builder');
  const fragment = document.createDocumentFragment();

  for (const [index, troop] of rosterForPlayer(player).entries()) {
    const isHero = troop.role === 'hero';
    const card = document.createElement('button');
    card.type = 'button';
    card.classList.add('troop-card');
    card.dataset.deploymentOwner = player === 1 ? 'red' : 'blue';
    if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) {
      card.classList.add('deployment-both');
    } else if (troop.deploymentRegions.includes('starting')) {
      card.classList.add('deployment-starting');
    } else if (troop.deploymentRegions.includes('intermediate')) {
      card.classList.add('deployment-intermediate');
    }
    if (troop.deploymentRule === 'enemy-region' || troop.passiveDescription === 'Can be deployed only in enemy intermediate regions') card.classList.add('deployment-enemy');
    if (isHero) card.classList.add('hero-card');
    if (troop.coordinate !== undefined) card.classList.add('deployed-card');
    if (gameState.lastActingTroopIdByPlayer.get(player) === troop.id) card.classList.add('last-acting-card');
    if (gameState.selectedTroopId === troop.id) card.classList.add('selected-card');
    card.classList.toggle('unavailable-card', !canSelectTroop(troop));
    card.setAttribute('aria-disabled', String(!canSelectTroop(troop)));
    card.setAttribute('aria-pressed', String(gameState.selectedTroopId === troop.id));
    card.setAttribute('aria-label', `Player ${player} ${isHero ? 'hero' : `troop ${index}`}`);
    if (gameState.lastActingTroopIdByPlayer.get(player) === troop.id) {
      card.title = 'This troop acted on your previous turn.';
    } else if (!isHero && heroForPlayer(player).coordinate === undefined) {
      card.title = 'Deploy your hero first.';
    }

    const name = document.createElement('strong');
    name.textContent = troopDisplayName(troop);
    const details = document.createElement('span');
    details.classList.add('troop-details');
    const moveAction = troop.actions.find((action): action is MoveAction => action.type === 'move');
    const flyAction = troop.actions.find((action): action is FlyAction => action.type === 'fly');
    const attackAction = troop.actions.find((action): action is AttackAction => action.type === 'attack');
    const magicAction = troop.actions.find((action): action is MagicAction => action.type === 'magic');
    const defenseAction = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
    const cannonAction = troop.actions.find((action): action is CannonAction => action.type === 'cannon');
    const pushAction = troop.actions.find((action): action is PushAction => action.type === 'push');
    const moveDetails = moveAction && moveAction.maxDistance > 1 ? `${moveAction.maxDistance} 🥾 · ` : '';
    const effects = [
      moveAction && moveAction.maxDistance !== 1 ? moveDetails.slice(0, -3) : '',
      flyAction ? `${flyAction.maxDistance} 🪽` : '',
      attackAction ? `${rangedDamage(troop, attackAction)} 🏹 ${rangedRange(troop, attackAction)}` : '',
      defenseAction ? `${defenseAction.block} 🛡️ ${defenseAction.range}` : '',
      magicAction ? `${magicAction.damage} 🔥 ${magicAction.range}` : '',
      cannonAction ? `${cannonAction.damage} 🧨 ${cannonAction.range}` : '',
      pushAction ? `${pushAction.maxDistance}${pushIcon}${pushAction.range}` : ''
    ].filter(Boolean);
    const passiveLine = troop.passiveDescription
      ? troop.passiveDescription.length <= 20 ? troop.passiveDescription : '…'
      : undefined;
    const descriptionLines = passiveLine ? [...effects, passiveLine] : effects;
    const visibleEffects = threeLineSummary(descriptionLines);
    if (troop.defeated) {
      details.textContent = 'Defeated';
    } else {
      for (const effect of visibleEffects) {
        const line = document.createElement('span');
        line.textContent = effect;
        details.append(line);
      }
    }
    const symbol = cardTroopIcon(isHero ? 'hero' : 'troop');
    symbol.setAttribute('aria-hidden', 'true');
    const health = document.createElement('span');
    health.classList.add('card-health');
    health.textContent = healthDescription(troop);

    card.append(name, details, symbol, health);
    card.addEventListener('pointerenter', () => showHoverDetails([troop]));
    card.addEventListener('pointerleave', hideHoverDetails);
    card.addEventListener('click', () => {
      if (!canSelectTroop(troop)) return;
      clearMovementPath();
      gameState.selectedTroopId = gameState.selectedTroopId === troop.id ? undefined : troop.id;
      gameState.selectedAction = troop.coordinate === undefined ? 'deploy' : 'move';
      renderTroopCards(1, playerOneCardsPanel);
      renderTroopCards(2, playerTwoCardsPanel);
      renderActionBar();
      refreshActionTargets();
    });
    fragment.append(card);
  }

  tray.replaceChildren(fragment);
}

const ns = 'http://www.w3.org/2000/svg';
const size = 42;
const hexGap = 1.5;
const center: Point = { x: 400, y: 310 };
const playerOneStart = new Set<Coordinate>(['1,2', '1,3', '1,4', '2,3', '2,4', '3,4']);
const playerOneMiddle = new Set<Coordinate>(['0,1', '0,2', '0,3', '-1,1', '-2,1', '-1,2']);
const playerOneSide = new Set<Coordinate>(['1,1', '2,1', '3,1', '2,2', '3,2', '3,3']);
const front = new Set<Coordinate>(['-3,0', '-2,0', '-1,0', '1,0', '2,0', '3,0']);

function toCoordinate(x: number, y: number): Coordinate {
  return `${x},${y}`;
}

function opposite(coordinate: Coordinate): Coordinate {
  const [x, y] = coordinate.split(',').map(Number);
  return toCoordinate(-x, -y);
}

const playerTwoStart = new Set([...playerOneStart].map(opposite));
const playerTwoMiddle = new Set([...playerOneMiddle].map(opposite));
const playerTwoSide = new Set([...playerOneSide].map(opposite));

const regions: readonly Region[] = [
  { id: 'p1-start', name: 'Player 1 starting', type: 'starting', homePlayer: 1, coordinates: playerOneStart },
  { id: 'p1-middle', name: 'Player 1 intermediate', type: 'intermediate', homePlayer: 1, coordinates: playerOneMiddle },
  { id: 'p1-side', name: 'Player 1 intermediate', type: 'intermediate', homePlayer: 1, coordinates: playerOneSide },
  { id: 'front', name: 'Front', type: 'front', coordinates: front },
  { id: 'p2-side', name: 'Player 2 intermediate', type: 'intermediate', homePlayer: 2, coordinates: playerTwoSide },
  { id: 'p2-middle', name: 'Player 2 intermediate', type: 'intermediate', homePlayer: 2, coordinates: playerTwoMiddle },
  { id: 'p2-start', name: 'Player 2 starting', type: 'starting', homePlayer: 2, coordinates: playerTwoStart }
];

function regionForCoordinate(coordinate: Coordinate): Region | undefined {
  return regions.find(region => region.coordinates.has(coordinate));
}

function canDeployTroop(troop: Troop, coordinate: Coordinate): boolean {
  const region = regionForCoordinate(coordinate);
  const enemyIntermediateOnly = troop.passiveDescription === 'Can be deployed only in enemy intermediate regions';
  const enemyRegionOnly = troop.deploymentRule === 'enemy-region';
  return troop.player === gameState.activePlayer
    && troop.coordinate === undefined
    && gameState.lastActingTroopIdByPlayer.get(troop.player) !== troop.id
    && (troop.role === 'hero' || heroForPlayer(troop.player).coordinate !== undefined)
    && coordinate !== '0,0'
    && !troopsByCoordinate.has(coordinate)
    && region !== undefined
    && troop.deploymentRegions.includes(region.type)
    && (enemyIntermediateOnly
      ? region.type === 'intermediate' && region.homePlayer !== troop.player && controllingPlayer(region) === troop.player
      : enemyRegionOnly
        ? troop.deploymentRegions.includes(region.type) && region.homePlayer !== undefined && region.homePlayer !== troop.player && controllingPlayer(region) === troop.player
      : controllingPlayer(region) === troop.player);
}

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

function hexDistance(from: Coordinate, to: Coordinate): number {
  const [fromX, fromY] = from.split(',').map(Number);
  const [toX, toY] = to.split(',').map(Number);
  return Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), Math.abs((toX - toY) - (fromX - fromY)));
}

function cannonLineCoordinates(from: Coordinate, to: Coordinate, maxDistance: number): Coordinate[] | undefined {
  const [fromX, fromY] = from.split(',').map(Number);
  const [toX, toY] = to.split(',').map(Number);
  const dx = toX - fromX; const dy = toY - fromY;
  const steps = hexDistance(from, to);
  if (!steps || steps > maxDistance || !(dx === 0 || dy === 0 || dx === dy)) return undefined;
  const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
  const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
  const line = Array.from({ length: steps }, (_, index) => toCoordinate(fromX + stepX * (index + 1), fromY + stepY * (index + 1)));
  // Match the engine: the central gap cannot be targeted, but cannon fire
  // may cross it to reach a legal hex on the far side.
  return line.every(coordinate => cellsByCoordinate.has(coordinate)) ? line : undefined;
}

function healthOf(troop: Troop): number {
  return Math.max(0, troop.baseHealth - troop.permanentDamage);
}

function healthDescription(troop: Troop): string {
  const health = healthOf(troop);
  return health === troop.baseHealth ? `♥ ${health}` : `${health} ♥ ${troop.baseHealth}`;
}

interface BoardDescriptionLine { text: string; action?: GameActionType; upgraded?: boolean; }

function boardDescriptionEntries(troop: Troop, includeSelfBlock = false, revealMoveOne = false): BoardDescriptionLine[] {
  const moveAction = troop.actions.find((action): action is MoveAction => action.type === 'move');
  const flyAction = troop.actions.find((action): action is FlyAction => action.type === 'fly');
  const attackAction = troop.actions.find((action): action is AttackAction => action.type === 'attack');
  const magicAction = troop.actions.find((action): action is MagicAction => action.type === 'magic');
  const defenseAction = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
  const cannonAction = troop.actions.find((action): action is CannonAction => action.type === 'cannon');
  const pushAction = troop.actions.find((action): action is PushAction => action.type === 'push');
  const mendingAction = troop.actions.find((action): action is MendingAction => action.type === 'mending');
  const upgradeAction = troop.actions.find((action): action is UpgradeAction => action.type === 'upgrade');
  const bonus = (ability: UpgradableAbility) => upgradeBonus(troop, ability);
  const abilities: BoardDescriptionLine[] = [];
  const selfBonus = bonus('self-defense');
  if (includeSelfBlock || (troop.selfDefense ?? 1) + selfBonus.left > 1) abilities.push({ text: `${(troop.selfDefense ?? 1) + selfBonus.left} 🛡️`, action: 'self-defense', upgraded: Boolean(selfBonus.left) });
  if (moveAction) { const b = bonus('move'); if (moveAction.maxDistance + b.right > 1 || revealMoveOne) abilities.push({ text: `🥾 ${moveAction.maxDistance + b.right}`, action: 'move', upgraded: Boolean(b.right) }); }
  if (flyAction) { const b = bonus('fly'); abilities.push({ text: `🪽 ${flyAction.maxDistance + b.right}`, action: 'fly', upgraded: Boolean(b.right) }); }
  if (attackAction) { const b = bonus('attack'); abilities.push({ text: `${rangedDamage(troop, attackAction) + b.left} 🏹 ${rangedRange(troop, attackAction) + b.right}`, action: 'attack', upgraded: Boolean(b.left || b.right) }); }
  if (defenseAction) { const b = bonus('defense'); abilities.push({ text: `${defenseAction.block + b.left} 🛡️ ${defenseAction.range + b.right}`, action: 'defense', upgraded: Boolean(b.left || b.right) }); }
  if (magicAction) { const b = bonus('magic'); abilities.push({ text: `${magicAction.damage + b.left} 🔥 ${magicAction.range + b.right}`, action: 'magic', upgraded: Boolean(b.left || b.right) }); }
  if (cannonAction) { const b = bonus('cannon'); abilities.push({ text: `${cannonAction.damage + b.left} 🧨 ${cannonAction.range + b.right}`, action: 'cannon', upgraded: Boolean(b.left || b.right) }); }
  if (pushAction) { const b = bonus('push'); abilities.push({ text: `${pushAction.maxDistance + b.left}${pushIcon}${pushAction.range + b.right}`, action: 'push', upgraded: Boolean(b.left || b.right) }); }
  if (mendingAction) { const b = bonus('mending'); abilities.push({ text: `${mendingAction.amount + b.left} ❤️ ${mendingAction.range + b.right}`, action: 'mending', upgraded: Boolean(b.left || b.right) }); }
  if (upgradeAction) abilities.push({ text: `${upgradeAction.left ?? ''}🔮${upgradeAction.right ?? ''} ${upgradeAction.range}`, action: 'upgrade' });
  // Health plus two content lines form the stable board summary. A passive
  // gets one of those lines whenever there is room; dots mean actual overflow.
  const visibleAbilities = abilities.slice(0, 2);
  const hiddenAbilities = abilities.length > 2;
  if (troop.passiveDescription && visibleAbilities.length < 2) visibleAbilities.push({ text: troop.passiveDescription });
  while (visibleAbilities.length < 2) visibleAbilities.push({ text: '' });
  const overflow = hiddenAbilities || (troop.passiveDescription && abilities.length >= 2) ? [{ text: '...' }] : [];
  return [{ text: healthDescription(troop) }, ...visibleAbilities, ...overflow];
}

function boardDescriptionLines(troop: Troop): string[] {
  return boardDescriptionEntries(troop).map(line => line.text);
}

function boardDescription(troop: Troop): string {
  return boardDescriptionLines(troop).join(' · ');
}

function writeBoardDescription(marker: SVGTextElement, troop: Troop, position: Point): void {
  marker.replaceChildren();
  const lines = boardDescriptionLines(troop);
  // The icon occupies the lower edge of the hex. Start text at the upper
  // point so all available space above it is used.
  const firstLineY = position.y - (size - hexGap) + 22;
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(ns, 'tspan');
    row.setAttribute('x', String(position.x));
    const isHealth = index === 0 && line.includes('♥');
    row.setAttribute('y', String(firstLineY + index * 13));
    if (isHealth) row.classList.add('board-health');
    row.textContent = line;
    marker.append(row);
  }
}

/** Place a server-rendered description using the shared board orientation. */
function writeServerBoardDescription(marker: SVGTextElement, troop: Troop, position: Point, includeSelfBlock = false, revealMoveOne = false): void {
  marker.replaceChildren();
  const lines = boardDescriptionEntries(troop, includeSelfBlock, revealMoveOne);
  const edge = size - hexGap;
  const firstLineY = position.y - edge + 22;
  for (const [index, line] of lines.entries()) {
    const row = document.createElementNS(ns, 'tspan');
    row.setAttribute('x', String(position.x));
    row.setAttribute('y', String(firstLineY + index * 13));
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
  const edge = size - hexGap;
  const firstLineY = position.y - edge + 22;
  const rect = document.createElementNS(ns, 'rect');
  rect.dataset.serverRender = 'description-highlight';
  rect.classList.add('action-description-highlight', troop.player === 1 ? 'player-one-highlight' : 'player-two-highlight');
  if (negativeSelfBlock) rect.classList.add('self-block-pending-highlight');
  const width = Math.min(72, Math.max(18, line.text.length * 7.4 + 8));
  rect.setAttribute('x', String(position.x - width / 2));
  rect.setAttribute('y', String(firstLineY + index * 13 - 10));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', '12'); rect.setAttribute('rx', '2');
  rect.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  keepServerOverlayUpright(rect, position);
  cell.append(rect);
}

function renderActionLand(player: Player, coordinate: Coordinate, label: string): SVGTextElement {
  const target = cellsByCoordinate.get(coordinate);
  if (!target) throw new Error(`Board cell ${coordinate} is missing.`);
  const angle = (player === 1 ? 330 : 210) * Math.PI / 180;
  const marker = document.createElementNS(ns, 'text');
  marker.classList.add('action-land', player === 1 ? 'player-one-effect' : 'player-two-effect');
  marker.setAttribute('x', String(target.position.x + size * .72 * Math.cos(angle)));
  marker.setAttribute('y', String(target.position.y + size * .72 * Math.sin(angle) + 4));
  keepServerOverlayUpright(marker, target.position);
  marker.textContent = label;
  target.cell.append(marker);
  return marker;
}

function shieldBonusFor(troop: Troop, effect: Pick<PendingTimedEffect, 'owner' | 'sourceTroopId'>): number {
  return troop.id === 'p2-2' && effect.owner === 2 && effect.sourceTroopId !== troop.id ? 1 : 0;
}

function blockAt(coordinate: Coordinate, troop: Troop): number {
  return pendingTimedEffects
    .filter(effect => effect.type === 'defense' && effect.target === coordinate && effect.owner === troop.player)
    .reduce((total, effect) => total + effect.value + shieldBonusFor(troop, effect), 0);
}

function controllingPlayerDuringBash(troop: Troop, coordinate: Coordinate): Player | undefined {
  const region = regionForCoordinate(coordinate);
  if (!region) return undefined;
  const bash = pendingBashes.find(item => item.target === coordinate && (item.attackerId === troop.id || item.defenderId === troop.id));
  if (!bash) return controllingPlayer(region);

  const score = calculateControl(region);
  const attacker = troops.get(bash.attackerId);
  // The attacker already contests the destination, even before the clash is resolved.
  if (attacker && !attacker.defeated && attacker.coordinate !== undefined && !region.coordinates.has(attacker.coordinate)) {
    if (attacker.player === 1) score.playerOne += healthOf(attacker);
    else score.playerTwo += healthOf(attacker);
  }
  if (score.playerOne === score.playerTwo) return undefined;
  return score.playerOne > score.playerTwo ? 1 : 2;
}

function combatModifier(troop: Troop, coordinate: Coordinate): number {
  const region = regionForCoordinate(coordinate);
  const controlModifier = region && controllingPlayerDuringBash(troop, coordinate) === troop.player ? 1 : 0;
  return blockAt(coordinate, troop) + controlModifier;
}

function combatHealth(troop: Troop, coordinate: Coordinate): number {
  return healthOf(troop) + combatModifier(troop, coordinate);
}

function renderBashStat(player: Player, coordinate: Coordinate, troop: Troop): SVGTextElement {
  const target = cellsByCoordinate.get(coordinate);
  if (!target) throw new Error(`Board cell ${coordinate} is missing.`);
  const marker = document.createElementNS(ns, 'text');
  marker.classList.add('bash-stat', player === 1 ? 'player-one-bash' : 'player-two-bash');
  marker.setAttribute('x', String(target.position.x + (player === 1 ? 23 : -23)));
  marker.setAttribute('y', String(target.position.y - 20));
  marker.textContent = `${healthOf(troop)}+${combatModifier(troop, coordinate)}`;
  target.cell.append(marker);
  return marker;
}

function renderBashIcon(player: Player, coordinate: Coordinate, troop: Troop): SVGImageElement {
  const target = cellsByCoordinate.get(coordinate);
  if (!target) throw new Error(`Board cell ${coordinate} is missing.`);
  const marker = boardTroopIcon(troop.role, player, target.position.x + (player === 1 ? 23 : -23), target.position.y + 20 + 32 * .4);
  marker.setAttribute('clip-path', `url(#${target.cell.dataset.clipId})`);
  marker.classList.add('bash-icon', player === 1 ? 'player-one-bash' : 'player-two-bash');
  target.cell.append(marker);
  return marker;
}

function removeBash(bash: PendingBash): void {
  bash.playerOneStats.remove();
  bash.playerTwoStats.remove();
  bash.playerOneIcon.remove();
  bash.playerTwoIcon.remove();
}

function refreshPendingBashStats(): void {
  for (const bash of pendingBashes) {
    const attacker = troops.get(bash.attackerId);
    const defender = troops.get(bash.defenderId);
    if (!attacker || !defender) continue;
    const playerOneTroop = attacker.player === 1 ? attacker : defender;
    const playerTwoTroop = attacker.player === 2 ? attacker : defender;
    bash.playerOneStats.textContent = `${healthOf(playerOneTroop)}+${combatModifier(playerOneTroop, bash.target)}`;
    bash.playerTwoStats.textContent = `${healthOf(playerTwoTroop)}+${combatModifier(playerTwoTroop, bash.target)}`;
  }
}

function actionDetail(troop: Troop): string[] {
  return troop.actions.map(action => {
    if (action.type === 'move') return `Move: up to ${action.maxDistance} hex${action.maxDistance === 1 ? '' : 'es'}`;
    if (action.type === 'fly') return `Fly: land anywhere up to ${action.maxDistance} hex${action.maxDistance === 1 ? '' : 'es'} away`;
    if (action.type === 'attack') return `Ranged attack: ${rangedDamage(troop, action)} damage at range ${rangedRange(troop, action)}`;
    if (action.type === 'defense') return `Block: ${action.block} at range ${action.range}`;
    if (action.type === 'cannon') return `Cannon: ${action.damage} physical damage in a straight line up to ${action.range} hexes`;
    if (action.type === 'push') return `Push: select a troop in a straight line up to ${action.range} hexes away, then push it ${action.maxDistance} hexes`;
    if (action.type === 'mending') return `Mend: restore ${action.amount} health at range ${action.range}`;
    if (action.type === 'upgrade') return `Upgrade: +${action.left ?? 0} left and +${action.right ?? 0} right number at range ${action.range}`;
    return `Magic: ${action.damage} damage at range ${action.range}`;
  });
}

function fullEffectLines(troop: Troop): string[] {
  const moveAction = troop.actions.find((action): action is MoveAction => action.type === 'move');
  const flyAction = troop.actions.find((action): action is FlyAction => action.type === 'fly');
  const attackAction = troop.actions.find((action): action is AttackAction => action.type === 'attack');
  const defenseAction = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
  const magicAction = troop.actions.find((action): action is MagicAction => action.type === 'magic');
  const cannonAction = troop.actions.find((action): action is CannonAction => action.type === 'cannon');
  const pushAction = troop.actions.find((action): action is PushAction => action.type === 'push');
  const mendingAction = troop.actions.find((action): action is MendingAction => action.type === 'mending');
  const upgradeAction = troop.actions.find((action): action is UpgradeAction => action.type === 'upgrade');
  const effects: string[] = [];
  if (moveAction && moveAction.maxDistance + upgradeBonus(troop, 'move').right > 1) effects.push(`${moveAction.maxDistance} 🥾`);
  if (flyAction) effects.push(`${flyAction.maxDistance} 🪽`);
  if ((troop.selfDefense ?? 1) + upgradeBonus(troop, 'self-defense').left > 1) effects.push(`${troop.selfDefense ?? 1} 🛡️`);
  if (attackAction) effects.push(`${rangedDamage(troop, attackAction)} 🏹 ${rangedRange(troop, attackAction)}`);
  if (defenseAction) effects.push(`${defenseAction.block} 🛡️ ${defenseAction.range}`);
  if (magicAction) effects.push(`${magicAction.damage} 🔥 ${magicAction.range}`);
  if (cannonAction) effects.push(`${cannonAction.damage} 🧨 ${cannonAction.range}`);
  if (pushAction) effects.push(`${pushAction.maxDistance}${pushIcon}${pushAction.range}`);
  if (mendingAction) effects.push(`${mendingAction.amount} ❤️ ${mendingAction.range}`);
  if (upgradeAction) effects.push(`${upgradeAction.left ?? ''}🔮${upgradeAction.right ?? ''} ${upgradeAction.range}`);
  if (troop.passiveDescription) effects.push(troop.passiveDescription);
  return effects;
}

function hoverAbility(troop: Troop, line: string): UpgradableAbility | undefined {
  return line.includes('🥾') ? 'move' : line.includes('🪽') ? 'fly' : line.includes('🏹') ? 'attack' : line.includes('🧨') ? 'cannon' : line.includes(pushIcon) ? 'push' : line.includes('🔥') ? 'magic' : line.includes('❤️') ? 'mending' : line.includes('🛡️') ? (troop.actions.some(action => action.type === 'defense') ? 'defense' : 'self-defense') : line.includes('🔮') ? 'upgrade' : undefined;
}

function hoverUpgradeSuffix(troop: Troop, line: string): string | undefined {
  const ability = hoverAbility(troop, line);
  if (!ability) return undefined;
  const bonus = upgradeBonus(troop, ability);
  const values = [bonus.left && `+${bonus.left}`, bonus.right && `+${bonus.right}`].filter(Boolean);
  return values.length ? values.join(' ') : undefined;
}

function hoverBaseLine(line: string): string {
  const move = line.match(/^(\d+) 🥾$/);
  if (move) return `🥾 ${move[1]}`;
  const fly = line.match(/^(\d+) 🪽$/);
  if (fly) return `🪽 ${fly[1]}`;
  return line;
}

function appendHoverEffectLine(element: HTMLElement, troop: Troop, line: string): void {
  if (line === 'Steady') {
    const keyword = document.createElement('strong'); keyword.classList.add('hover-keyword'); keyword.textContent = 'Steady';
    const rule = document.createElement('em'); rule.classList.add('hover-keyword-rule'); rule.textContent = ' — opponent has no modifier when this unit is in a bash';
    element.append(keyword, rule);
    return;
  }
  const ability = hoverAbility(troop, line);
  const bonus = ability ? upgradeBonus(troop, ability) : { left: 0, right: 0 };
  const purple = (value: number): HTMLSpanElement => { const span = document.createElement('span'); span.classList.add('upgraded-detail'); span.textContent = ` +${value}`; return span; };
  const movement = line.match(/^(\d+) (🥾|🪽)$/);
  if (movement) {
    element.append(document.createTextNode(`${movement[2]} ${movement[1]}`));
    if (bonus.right) element.append(purple(bonus.right));
    return;
  }
  const twoNumbers = line.match(/^(\d+)(.*?)(\d+)$/);
  if (twoNumbers && (bonus.left || bonus.right)) {
    element.append(document.createTextNode(twoNumbers[1]));
    if (bonus.left) element.append(purple(bonus.left));
    element.append(document.createTextNode(`${twoNumbers[2]}${twoNumbers[3]}`));
    if (bonus.right) element.append(purple(bonus.right));
    return;
  }
  element.textContent = hoverBaseLine(line);
  const suffix = hoverUpgradeSuffix(troop, line);
  if (suffix) { const upgrade = document.createElement('span'); upgrade.classList.add('upgraded-detail'); upgrade.textContent = ` ${suffix}`; element.append(upgrade); }
}

/** Keep compact board and card summaries readable without overflowing them. */
function threeLineSummary(lines: readonly string[]): string[] {
  return lines.length > 3 ? [...lines.slice(0, 2), '...'] : [...lines];
}

function hoverLifeLine(troop: Troop): string {
  const currentHealth = healthOf(troop);
  return currentHealth === troop.baseHealth
    ? `Life: ♥ ${troop.baseHealth}`
    : `Life: ${currentHealth} ♥ ${troop.baseHealth}`;
}

function showHoverDetails(troopsToShow: Troop[], bashCoordinate?: Coordinate): void {
  if (troopsToShow.length === 0) return;
  hoverDetailsPanel.replaceChildren();
  for (const troop of troopsToShow.sort((left, right) => right.player - left.player)) {
    const block = document.createElement('section');
    const heading = document.createElement('strong');
    heading.textContent = troopDisplayName(troop);
    const life = document.createElement('div');
    life.textContent = hoverLifeLine(troop);
    block.append(life);
    if (bashCoordinate) {
      const combat = document.createElement('div');
      const modifier = combatModifier(troop, bashCoordinate);
      combat.textContent = `Bash: ${healthOf(troop)} + ${modifier} = ${combatHealth(troop, bashCoordinate)}`;
      block.append(combat);
    }
    const effects = fullEffectLines(troop);
    for (const effect of threeLineSummary(effects.length > 0 ? effects : ['Standard movement'])) {
      const line = document.createElement('div');
      appendHoverEffectLine(line, troop, effect);
      block.append(line);
    }
    appendHoverTroopSymbol(block, troop);
    block.prepend(heading);
    hoverDetailsPanel.append(block);
  }
  hoverDetailsPanel.hidden = false;
}

function hideHoverDetails(): void {
  hoverDetailsPanel.hidden = true;
}

function showHoverDetailsForCoordinate(coordinate: Coordinate): void {
  const bash = pendingBashes.find(item => item.target === coordinate);
  const troopsToShow = bash
    ? [troops.get(bash.attackerId), troops.get(bash.defenderId)].filter((troop): troop is Troop => troop !== undefined)
    : [troopsByCoordinate.get(coordinate)].filter((troop): troop is Troop => troop !== undefined);
  showHoverDetails(troopsToShow, bash?.target);
}

function renderInspectorCard(troop: Troop): HTMLElement {
  const card = document.createElement('article');
  card.classList.add('inspector-card', troop.player === 1 ? 'player-one-inspector' : 'player-two-inspector');
  const heading = document.createElement('h2');
  heading.textContent = troopDisplayName(troop);
  const stats = document.createElement('p');
  stats.textContent = `Starting health: ${troop.baseHealth} · Current health: ${healthOf(troop)}`;
  const actions = document.createElement('ul');
  for (const detail of actionDetail(troop)) {
    const item = document.createElement('li');
    item.textContent = detail;
    actions.append(item);
  }
  if (troop.passiveDescription) {
    const passive = document.createElement('p');
    passive.textContent = troop.passiveDescription;
    card.append(heading, stats, actions, passive);
  } else {
    card.append(heading, stats, actions);
  }
  return card;
}

function showTroopInspectorForTroops(displayedTroops: Troop[]): void {
  if (displayedTroops.length === 0) return;
  inspectorContentPanel.replaceChildren(...displayedTroops.sort((left, right) => right.player - left.player).map(renderInspectorCard));
  troopInspectorPanel.hidden = false;
  inspectorCloseButton.focus();
}

function showTroopInspector(coordinate: Coordinate): void {
  const bash = pendingBashes.find(item => item.target === coordinate);
  const displayedTroops = bash
    ? [troops.get(bash.attackerId), troops.get(bash.defenderId)].filter((troop): troop is Troop => troop !== undefined)
    : [troopsByCoordinate.get(coordinate)].filter((troop): troop is Troop => troop !== undefined);
  showTroopInspectorForTroops(displayedTroops);
}

function hideTroopInspector(): void {
  troopInspectorPanel.hidden = true;
}

function renderBoardTroop(troop: Troop, position: Point, cell: SVGGElement): SVGImageElement {
  const marker = boardTroopIcon(troop.role, troop.player, position.x, position.y + 20 + 32 * .4);
  marker.setAttribute('clip-path', `url(#${cell.dataset.clipId})`);
  marker.classList.add('board-troop', troop.player === 1 ? 'player-one-troop' : 'player-two-troop');

  const description = document.createElementNS(ns, 'text');
  description.classList.add('board-troop-description');
  writeBoardDescription(description, troop, position);

  cell.append(marker, description);
  troop.descriptionMarker = description;
  return marker;
}

function refreshBoardTroopAppearance(): void {
  for (const troop of troops.values()) {
    troop.marker?.classList.toggle('last-acting-troop', gameState.lastActingTroopIdByPlayer.get(troop.player) === troop.id);
    if (troop.descriptionMarker && troop.coordinate) {
      const cell = cellsByCoordinate.get(troop.coordinate);
      if (cell) writeBoardDescription(troop.descriptionMarker, troop, cell.position);
    }
  }
}

function removeBoardTroop(troop: Troop): void {
  troop.marker?.remove();
  troop.descriptionMarker?.remove();
  troop.marker = undefined;
  troop.descriptionMarker = undefined;
}

function defeatTroop(troop: Troop): void {
  troop.defeated = true;
  removeBoardTroop(troop);
  if (troop.coordinate) troopsByCoordinate.delete(troop.coordinate);
  troop.coordinate = undefined;
}

function resolveAttacksAfterAction(player: Player): void {
  const incomingDamage = new Map<string, number>();
  const activeBlock = new Map<string, number>();

  for (const effect of pendingTimedEffects) {
    if (effect.type !== 'defense') continue;
    const troop = troopsByCoordinate.get(effect.target);
    if (troop && troop.player === effect.owner) {
      activeBlock.set(troop.id, (activeBlock.get(troop.id) ?? 0) + effect.value + shieldBonusFor(troop, effect));
    }
  }

  for (let index = pendingAttacks.length - 1; index >= 0; index -= 1) {
    const attack = pendingAttacks[index];
    if (attack.owner === player) continue;
    const target = troopsByCoordinate.get(attack.target);
    if (target && target.player !== attack.owner && !target.defeated) {
      incomingDamage.set(target.id, (incomingDamage.get(target.id) ?? 0) + attack.damage);
    }
    attack.marker.remove();
    pendingAttacks.splice(index, 1);
  }

  for (const [troopId, damage] of incomingDamage) {
    const target = troops.get(troopId);
    if (!target || target.defeated) continue;
    const region = target.coordinate ? regionForCoordinate(target.coordinate) : undefined;
    const controlModifier = region && controllingPlayer(region) === target.player ? 1 : 0;
    target.permanentDamage += Math.max(0, damage - (activeBlock.get(target.id) ?? 0) - controlModifier);
    if (healthOf(target) === 0) {
      defeatTroop(target);
      if (target.role === 'hero') gameState.winner = player === 1 ? 2 : 1;
    }
  }
}

function resolveMagicAfterAction(player: Player): void {
  for (let index = pendingTimedEffects.length - 1; index >= 0; index -= 1) {
    const effect = pendingTimedEffects[index];
    if (effect.type !== 'magic' || effect.owner === player) continue;
    const target = troopsByCoordinate.get(effect.target);
    if (target && target.player !== effect.owner && !target.defeated && healthOf(target) <= effect.value) {
      defeatTroop(target);
      if (target.role === 'hero') gameState.winner = effect.owner;
    }
    effect.marker.remove();
    pendingTimedEffects.splice(index, 1);
  }
}

function moveTroopTo(troop: Troop, coordinate: Coordinate): void {
  if (!troop.coordinate) throw new Error(`${troop.id} is not on the board.`);
  troopsByCoordinate.delete(troop.coordinate);
  removeBoardTroop(troop);
  troop.coordinate = coordinate;
  troopsByCoordinate.set(coordinate, troop);
  const target = cellsByCoordinate.get(coordinate);
  if (!target) throw new Error(`Board cell ${coordinate} is missing.`);
  troop.marker = renderBoardTroop(troop, target.position, target.cell);
}

function renderTroopAtCurrentCoordinate(troop: Troop): void {
  if (!troop.coordinate || troop.defeated || troop.marker) return;
  const target = cellsByCoordinate.get(troop.coordinate);
  if (!target) throw new Error(`Board cell ${troop.coordinate} is missing.`);
  troop.marker = renderBoardTroop(troop, target.position, target.cell);
}

function resolveBashesAfterAction(player: Player): void {
  for (let index = pendingBashes.length - 1; index >= 0; index -= 1) {
    const bash = pendingBashes[index];
    const attacker = troops.get(bash.attackerId);
    const defender = troops.get(bash.defenderId);
    if (!attacker || !defender || attacker.defeated || defender.defeated) {
      if (defender && !defender.defeated) renderTroopAtCurrentCoordinate(defender);
      removeBash(bash);
      pendingBashes.splice(index, 1);
      continue;
    }
    if (defender.player === player && defender.coordinate !== bash.target) {
      moveTroopTo(attacker, bash.target);
      removeBash(bash);
      pendingBashes.splice(index, 1);
      continue;
    }
    if (defender.player !== player || defender.coordinate !== bash.target) continue;

    const attackerCombat = combatHealth(attacker, bash.target);
    const defenderCombat = combatHealth(defender, bash.target);
    if (attackerCombat === defenderCombat) {
      defeatTroop(attacker);
      defeatTroop(defender);
    } else {
      const winner = attackerCombat > defenderCombat ? attacker : defender;
      const loser = winner === attacker ? defender : attacker;
      loser === defender ? defeatTroop(defender) : defeatTroop(attacker);
      winner.permanentDamage += Math.max(0, combatHealth(loser, bash.target) - combatModifier(winner, bash.target));
      if (winner === attacker && !attacker.defeated) moveTroopTo(attacker, bash.target);
    }
    if (attacker.role === 'hero' && attacker.defeated) gameState.winner = defender.player;
    if (defender.role === 'hero' && defender.defeated) gameState.winner = attacker.player;
    if (!defender.defeated) renderTroopAtCurrentCoordinate(defender);
    removeBash(bash);
    pendingBashes.splice(index, 1);
  }
}

function resolveEndOfTurnPassives(player: Player, actingTroop: Troop): void {
  for (const troop of rosterForPlayer(player)) {
    if (troop.defeated || troop.coordinate === undefined) continue;
    if (troop.id === 'p2-hero' && troop.id !== actingTroop.id) {
      troop.permanentDamage = Math.max(0, troop.permanentDamage - 1);
    }
  }
}

function clearExpiredTimedEffects(player: Player): void {
  for (let index = pendingTimedEffects.length - 1; index >= 0; index -= 1) {
    const effect = pendingTimedEffects[index];
    if (effect.owner === player) continue;
    effect.marker.remove();
    pendingTimedEffects.splice(index, 1);
  }
}

function endTurn(troop: Troop, visited: readonly Coordinate[]): void {
  resolveEndOfTurnPassives(troop.player, troop);
  resolveAttacksAfterAction(troop.player);
  resolveMagicAfterAction(troop.player);
  resolveBashesAfterAction(troop.player);
  clearExpiredTimedEffects(troop.player);
  gameState.lastActingTroopIdByPlayer.set(troop.player, troop.id);
  refreshBoardTroopAppearance();
  gameState.selectedTroopId = undefined;
  gameState.selectedAction = undefined;
  clearMovementPath();
  gameState.activePlayer = gameState.activePlayer === 1 ? 2 : 1;
  renderTroopCards(1, playerOneCardsPanel);
  renderTroopCards(2, playerTwoCardsPanel);
  renderActionBar();
  refreshActionTargets();
}

function deploySelectedTroop(troop: Troop, coordinate: Coordinate): void {
  if (!canDeployTroop(troop, coordinate)) return;

  troop.coordinate = coordinate;
  troopsByCoordinate.set(coordinate, troop);
  const target = cellsByCoordinate.get(coordinate);
  if (!target) throw new Error(`Board cell ${coordinate} is missing.`);
  troop.marker = renderBoardTroop(troop, target.position, target.cell);
  endTurn(troop, [coordinate]);
}

function canMoveTroop(troop: Troop, coordinate: Coordinate): boolean {
  return troop.player === gameState.activePlayer
    && troop.coordinate !== undefined
    && gameState.lastActingTroopIdByPlayer.get(troop.player) !== troop.id
    && !troopsByCoordinate.has(coordinate)
    && canReachMoveDestination(troop, coordinate);
}

function adjacentCoordinates(coordinate: Coordinate): Coordinate[] {
  const [x, y] = coordinate.split(',').map(Number);
  return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
    .map(([deltaX, deltaY]) => toCoordinate(x + deltaX, y + deltaY));
}

function canReachMoveDestination(troop: Troop, destination: Coordinate): boolean {
  const moveAction = troop.actions.find((action): action is MoveAction => action.type === 'move');
  if (!troop.coordinate || !moveAction || destination === troop.coordinate || destination === '0,0') return false;
  const destinationOccupant = troopsByCoordinate.get(destination);
  if (destinationOccupant?.player === troop.player) return false;

  const visited = new Set<Coordinate>([troop.coordinate]);
  const queue: Array<{ coordinate: Coordinate; distance: number }> = [{ coordinate: troop.coordinate, distance: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.distance === moveAction.maxDistance) continue;
    for (const next of adjacentCoordinates(current.coordinate)) {
      if (!cellsByCoordinate.has(next) || visited.has(next) || next === '0,0') continue;
      const nextDistance = current.distance + 1;
      if (next === destination) return true;
      if (troopsByCoordinate.has(next)) continue;
      visited.add(next);
      queue.push({ coordinate: next, distance: nextDistance });
    }
  }
  return false;
}

function clearMovementPath(): void {
  for (const cell of cellsByCoordinate.values()) cell.cell.classList.remove('movement-path');
  gameState.movementPath = [];
}

function refreshActionTargets(): void {
  for (const cell of cellsByCoordinate.values()) cell.cell.classList.remove('action-target');
  const troop = gameState.selectedTroopId ? troops.get(gameState.selectedTroopId) : undefined;
  if (!troop || gameState.winner) return;

  for (const [coordinate, target] of cellsByCoordinate) {
    if (coordinate === '0,0') continue;
    if (troop.coordinate === undefined) {
      if (canDeployTroop(troop, coordinate)) target.cell.classList.add('action-target');
      continue;
    }
    if (gameState.selectedAction === 'attack' || gameState.selectedAction === 'defense'
      || gameState.selectedAction === 'self-defense' || gameState.selectedAction === 'magic') {
      const rangedAction = gameState.selectedAction === 'attack'
        ? troop.actions.find((action): action is AttackAction => action.type === 'attack')
        : gameState.selectedAction === 'defense'
        ? troop.actions.find((action): action is DefenseAction => action.type === 'defense')
        : gameState.selectedAction === 'self-defense'
        ? { type: 'defense' as const, block: 1, range: 0 }
        : troop.actions.find((action): action is MagicAction => action.type === 'magic');
      const occupant = troopsByCoordinate.get(coordinate);
      const isBashTarget = pendingBashes.some(bash => bash.target === coordinate);
      const canTarget = (gameState.selectedAction !== 'attack' && gameState.selectedAction !== 'magic')
        || occupant?.player !== troop.player || isBashTarget;
      const actionRange = rangedAction && rangedAction.type === 'attack' ? rangedRange(troop, rangedAction) : rangedAction?.range;
      if (rangedAction && actionRange !== undefined && canTarget && hexDistance(troop.coordinate, coordinate) <= actionRange) {
        target.cell.classList.add('action-target');
      }
      continue;
    }
    if (gameState.selectedAction === 'move') {
      if (canReachMoveDestination(troop, coordinate)) {
        target.cell.classList.add('action-target');
      }
    }
  }
}

function moveSelectedTroop(troop: Troop, coordinate: Coordinate): void {
  if (!canMoveTroop(troop, coordinate)) return;
  moveTroopTo(troop, coordinate);
  endTurn(troop, [coordinate]);
}

function attackSelectedTroop(troop: Troop, coordinate: Coordinate): void {
  const attackAction = troop.actions.find((action): action is AttackAction => action.type === 'attack');
  if (!troop.coordinate || !attackAction || coordinate === '0,0' || hexDistance(troop.coordinate, coordinate) > rangedRange(troop, attackAction)) return;
  const occupant = troopsByCoordinate.get(coordinate);
  if (occupant?.player === troop.player && !pendingBashes.some(bash => bash.target === coordinate)) return;
  pendingAttacks.push({
    owner: troop.player,
    target: coordinate,
    damage: healthOf(troop),
    marker: renderActionLand(troop.player, coordinate, `${rangedDamage(troop, attackAction)} 🏹`)
  });
  endTurn(troop, []);
}

function bashSelectedTroop(attacker: Troop, coordinate: Coordinate): void {
  const defender = troopsByCoordinate.get(coordinate);
  if (!defender || defender.player === attacker.player || !canReachMoveDestination(attacker, coordinate)) return;
  const playerOneTroop = attacker.player === 1 ? attacker : defender;
  const playerTwoTroop = attacker.player === 2 ? attacker : defender;
  removeBoardTroop(attacker);
  removeBoardTroop(defender);
  pendingBashes.push({
    attackerId: attacker.id,
    defenderId: defender.id,
    target: coordinate,
    playerOneStats: renderBashStat(1, coordinate, playerOneTroop),
    playerTwoStats: renderBashStat(2, coordinate, playerTwoTroop),
    playerOneIcon: renderBashIcon(1, coordinate, playerOneTroop),
    playerTwoIcon: renderBashIcon(2, coordinate, playerTwoTroop)
  });
  refreshPendingBashStats();
  endTurn(attacker, []);
}

function isIncomingThreatAt(player: Player, coordinate: Coordinate): boolean {
  return pendingAttacks.some(attack => attack.owner !== player && attack.target === coordinate)
    || pendingBashes.some(bash => bash.target === coordinate && troops.get(bash.defenderId)?.player === player);
}

function canSelfBlock(troop: Troop): boolean {
  return troop.coordinate !== undefined && isIncomingThreatAt(troop.player, troop.coordinate);
}

function canPlaceUsefulBlock(troop: Troop): boolean {
  const defense = troop.actions.find((action): action is DefenseAction => action.type === 'defense');
  if (!troop.coordinate || !defense) return false;
  return [...cellsByCoordinate.keys()].some(coordinate =>
    isIncomingThreatAt(troop.player, coordinate) && hexDistance(troop.coordinate as Coordinate, coordinate) <= defense.range
  );
}

function placeTimedEffect(troop: Troop, type: 'defense' | 'self-defense' | 'magic', coordinate: Coordinate): void {
  const action = type === 'self-defense'
    ? { type: 'defense' as const, block: 1, range: 0 }
    : troop.actions.find((item): item is DefenseAction | MagicAction => item.type === type);
  if (!troop.coordinate || !action || coordinate === '0,0' || hexDistance(troop.coordinate, coordinate) > action.range) return;
  const isBashTarget = pendingBashes.some(bash => bash.target === coordinate);
  if (action.type === 'magic' && troopsByCoordinate.get(coordinate)?.player === troop.player && !isBashTarget) return;
  const value = action.type === 'defense' ? action.block : action.damage;
  const icon = action.type === 'defense' ? '🛡️' : '🔥';
  const recipient = troopsByCoordinate.get(coordinate);
  const displayedValue = action.type === 'defense' && recipient
    ? value + shieldBonusFor(recipient, { owner: troop.player, sourceTroopId: troop.id })
    : value;
  pendingTimedEffects.push({
    owner: troop.player,
    sourceTroopId: troop.id,
    type: action.type,
    target: coordinate,
    value,
    marker: renderActionLand(troop.player, coordinate, `${displayedValue} ${icon}`)
  });
  if (action.type === 'defense' && isIncomingThreatAt(troop.player, coordinate)) {
    gameState.awaitingResolutionTroopId = troop.id;
    gameState.selectedAction = undefined;
    renderTroopCards(1, playerOneCardsPanel);
    renderTroopCards(2, playerTwoCardsPanel);
    renderActionBar();
    refreshActionTargets();
    return;
  }
  endTurn(troop, []);
}

function performSelectedAction(coordinate: Coordinate): void {
  const selectedTroop = gameState.selectedTroopId ? troops.get(gameState.selectedTroopId) : undefined;
  if (!selectedTroop) return;
  if (selectedTroop.coordinate === undefined) deploySelectedTroop(selectedTroop, coordinate);
  else if (gameState.selectedAction === 'attack') attackSelectedTroop(selectedTroop, coordinate);
  else if (gameState.selectedAction === 'defense' || gameState.selectedAction === 'self-defense' || gameState.selectedAction === 'magic') {
    placeTimedEffect(selectedTroop, gameState.selectedAction, coordinate);
  }
  else if (gameState.selectedAction === 'move') {
    const occupant = troopsByCoordinate.get(coordinate);
    if (occupant && occupant.player !== selectedTroop.player) {
      bashSelectedTroop(selectedTroop, coordinate);
      return;
    }
    moveSelectedTroop(selectedTroop, coordinate);
  }
}

function renderActionBar(): void {
  actionBarPanel.replaceChildren();
  // A live match is rendered exclusively by renderServerActionBar().  The
  // prototype resolver below is retained temporarily for reusable visual
  // helpers, but it has no route from the live UI.
  if (matchStarted) {
    if (serverMatch && localMatchPlayer) renderServerActionBar(serverMatch, localMatchPlayer);
    return;
  }
  if (!matchStarted) {
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
    const selectedCards = playerOneDeck.slice(0, deckFormat).filter((id): id is string => id !== undefined);
    const heroCount = selectedCards.filter(id => troops.get(id)?.role === 'hero').length;
    const hasHero = heroCount === 1;
    const message = document.createElement('span');
    message.textContent = `Deck builder: ${selectedCards.length}/${deckFormat} cards${hasHero ? '' : ' — choose exactly one hero'}. Double-click database cards to add; double-click deck cards to remove.`;
    actionBarPanel.append(message);
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', () => {
      mainPanel.hidden = true;
      menuScreenPanel.hidden = false;
    });
    actionBarPanel.append(back);
    return;
  }
  if (gameState.winner) {
    actionBarPanel.textContent = `Player ${gameState.winner} wins — the opposing hero was defeated.`;
    return;
  }
  if (gameState.awaitingResolutionTroopId) {
    actionBarPanel.textContent = 'Shield placed — inspect the modifier, then resolve the incoming attack.';
    const resolve = document.createElement('button');
    resolve.type = 'button';
    resolve.textContent = 'Resolve attack';
    resolve.addEventListener('click', () => {
      const troopToResolve = troops.get(gameState.awaitingResolutionTroopId as string);
      if (!troopToResolve) return;
      gameState.awaitingResolutionTroopId = undefined;
      endTurn(troopToResolve, []);
    });
    actionBarPanel.append(resolve);
    return;
  }
  const troop = gameState.selectedTroopId ? troops.get(gameState.selectedTroopId) : undefined;
  if (!troop || troop.coordinate === undefined) return;

  const actions: Array<readonly ['move' | 'attack' | 'defense' | 'self-defense' | 'magic', string]> = [['move', '🥾 Move']];
  if (troop.actions.some(action => action.type === 'attack')) actions.push(['attack', '🏹 Attack']);
  if (canSelfBlock(troop)) actions.push(['self-defense', '🛡️ Self block']);
  if (canPlaceUsefulBlock(troop)) actions.push(['defense', '🛡️ Block']);
  if (troop.actions.some(action => action.type === 'magic')) actions.push(['magic', '🔥 Magic']);
  for (const [type, label] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.classList.toggle('active-action', gameState.selectedAction === type);
    button.addEventListener('click', () => {
      if (type === 'self-defense') {
        placeTimedEffect(troop, 'self-defense', troop.coordinate as Coordinate);
        return;
      }
      gameState.selectedAction = type;
      clearMovementPath();
      renderActionBar();
      refreshActionTargets();
    });
    actionBarPanel.append(button);
  }

}

function calculateControl(region: Region): ControlScore {
  const score: ControlScore = {
    playerOne: region.homePlayer === 1 ? 0.5 : 0,
    playerTwo: region.homePlayer === 2 ? 0.5 : 0
  };
  for (const coordinate of region.coordinates) {
    const troop = troopsByCoordinate.get(coordinate);
    if (!troop || troop.defeated) continue;
    if (troop.player === 1) score.playerOne += healthOf(troop);
    else score.playerTwo += healthOf(troop);
  }
  return score;
}

function controllingPlayer(region: Region): Player | undefined {
  const score = calculateControl(region);
  if (score.playerOne === score.playerTwo) return undefined;
  return score.playerOne > score.playerTwo ? 1 : 2;
}

for (let y = -4; y <= 4; y += 1) {
  for (let x = -3; x <= 3; x += 1) {
    if (x - y < -3 || x - y > 3) continue;

    const position = axialToPixel(x, y);
    const coordinate = toCoordinate(x, y);
    const isCenter = coordinate === '0,0';
    const cell = document.createElementNS(ns, 'g');
    cell.classList.add('cell');
    if (playerOneStart.has(coordinate)) cell.classList.add('player-one');
    if (playerTwoStart.has(coordinate)) cell.classList.add('player-two');
    if (playerOneMiddle.has(coordinate)) cell.classList.add('player-one-middle');
    if (playerTwoMiddle.has(coordinate)) cell.classList.add('player-two-middle');
    if (playerOneSide.has(coordinate)) cell.classList.add('player-one-side');
    if (playerTwoSide.has(coordinate)) cell.classList.add('player-two-side');
    if (front.has(coordinate)) cell.classList.add('front');
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
      else showHoverDetailsForCoordinate(coordinate);
    });
    cell.addEventListener('pointerleave', () => { hideHoverDetails(); if (serverMatch) clearServerPreviewPath(); });
    cell.addEventListener('dragover', event => {
      if (serverMatch?.sandboxFreePlacement && coordinate !== '0,0') event.preventDefault();
    });
    cell.addEventListener('drop', event => {
      if (!serverMatch?.sandboxFreePlacement || coordinate === '0,0') return;
      event.preventDefault();
      placeSandboxTroop(coordinate);
    });
    if (!isCenter) {
      let longPressTimer: number | undefined;
      let inspectorOpenedByLongPress = false;
      const cancelLongPress = (): void => {
        if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      };
      cell.addEventListener('pointerdown', () => {
        cancelLongPress();
        longPressTimer = window.setTimeout(() => {
          showTroopInspector(coordinate);
          inspectorOpenedByLongPress = true;
          longPressTimer = undefined;
        }, 600);
      });
      cell.addEventListener('pointerup', cancelLongPress);
      cell.addEventListener('pointerleave', cancelLongPress);
      cell.addEventListener('dblclick', () => showTroopInspector(coordinate));
      cell.addEventListener('click', () => {
        if (!serverMatch) return;
        // A selected support ability owns the next click. Do this before
        // checking the occupant, otherwise clicking a friendly recipient
        // merely selects that troop and discards the temple's action.
        if ((serverSelectedAction === 'mending' || serverSelectedAction === 'upgrade') && serverSelectedTroopId) {
          performServerActionAt(coordinate);
          return;
        }
        // Any legal action target owns the click before a friendly unit can
        // be selected or inspected. This is especially important for Block:
        // its target is commonly an allied troop on the board.
        if (serverSelectedTroopId && cell.classList.contains('action-target')) {
          performServerActionAt(coordinate);
          return;
        }
        if (serverSelectedAction === 'push' && serverSelectedTroopId) {
          performServerActionAt(coordinate);
          return;
        }
        const unit = serverMatch.units.find(candidate => candidate.coordinate === coordinate);
        // Do not manufacture a pending move/fly/attack preview from an
        // undashed hex.  The target renderer is the local legality source;
        // without this guard an out-of-range or path-blocked enemy could
        // appear to begin a bash until the server rejected confirmation.
        if (serverSelectedTroopId && serverSelectedAction && !cell.classList.contains('action-target')) {
          if (!unit) clearServerSelection();
          else { serverInspectedUnitId = unit.id; renderServerMatchState(serverMatch); }
          return;
        }
        if (unit && unit.owner === localMatchPlayer) {
          selectServerTroop(unit.troopId);
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
    board.append(cell);
  }
}
boardPanel.addEventListener('click', event => {
  // SVG clicks that did not originate in a hex are outside the board.
  if (serverMatch && event.target === boardPanel) clearServerSelection();
});

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
  const activeMatch = await fetch(`/api/matches/active?nickname=${encodeURIComponent(currentNickname)}`);
  if (!activeMatch.ok) return;
  const matchPayload = await activeMatch.json() as { match?: ServerMatchState };
  const match = matchPayload.match;
  if (!match?.id) return;
  // Never take over the screen just because a persisted session exists. This
  // applies to both sandboxes and multiplayer matches: the menu always wins
  // after login, and resuming is an explicit choice.
  resumableSandbox = match;
  resumeSandboxButtonPanel.textContent = match.sandbox ? 'Resume sandbox' : 'Resume match';
  resumeSandboxButtonPanel.hidden = false;
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
    localStorage.removeItem('hex-war-active-match');
  }
  playFormatErrorPanel.textContent = '';
  deckFormat = format;
  try {
    await deckSave;
  } catch (error) {
    playFormatErrorPanel.textContent = error instanceof Error ? error.message : 'Could not save the deck.';
    return;
  }
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
    playEightCardsButtonPanel.disabled = false;
    playTenCardsButtonPanel.disabled = false;
    playEightCardsButtonPanel.textContent = '8-card game';
    playTenCardsButtonPanel.textContent = '10-card game';
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
  sandboxGameButtonPanel.hidden = false;
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
  if (!currentNickname) return;
  sandboxErrorPanel.textContent = '';
  const response = await fetch('/api/sandbox', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname, format, deckIndex: 0 })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Start sandbox');
  if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not start sandbox.');
  resumeLiveMatch(payload.match);
}

async function loadSandbox(): Promise<void> {
  if (!currentNickname) return;
  sandboxErrorPanel.textContent = '';
  const response = await fetch('/api/sandbox/load', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: currentNickname })
  });
  const payload = await readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Load sandbox');
  if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not load sandbox.');
  resumeLiveMatch(payload.match);
}

sandboxGameButtonPanel.addEventListener('click', () => {
  sandboxGameButtonPanel.hidden = true;
  playGameButtonPanel.hidden = true;
  buildDecksButtonPanel.hidden = true;
  sandboxFormatsPanel.hidden = false;
});
resumeSandboxButtonPanel.addEventListener('click', () => {
  if (resumableSandbox) resumeLiveMatch(resumableSandbox);
});
sandboxEightCardsButtonPanel.addEventListener('click', () => { void startSandbox(8).catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not start sandbox.'; }); });
sandboxTenCardsButtonPanel.addEventListener('click', () => { void startSandbox(10).catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not start sandbox.'; }); });
loadSandboxButtonPanel.addEventListener('click', () => { void loadSandbox().catch(error => { sandboxErrorPanel.textContent = error instanceof Error ? error.message : 'Could not load sandbox.'; }); });
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

renderDeckBuilder();
const savedNickname = localStorage.getItem('hex-war-nickname');
if (savedNickname) {
  nicknameInputField.value = savedNickname;
  void login(savedNickname).catch(() => {
    // Keep the login form visible when the saved nickname is no longer valid.
    loginErrorPanel.textContent = 'Please log in again.';
  });
}
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
