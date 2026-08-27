import type { ServerMatchState } from './protocol.js';

interface ApplicationElements {
  loginScreen: HTMLElement; menuScreen: HTMLElement; loginForm: HTMLFormElement; nicknameInput: HTMLInputElement; loginError: HTMLElement; welcome: HTMLElement;
  buildDecks: HTMLButtonElement; playGame: HTMLButtonElement; sandboxGame: HTMLButtonElement; resumeSandbox: HTMLButtonElement;
  playFormats: HTMLElement; playEight: HTMLButtonElement; playTen: HTMLButtonElement; backFromPlay: HTMLButtonElement; playError: HTMLElement;
  sandboxFormats: HTMLElement; sandboxEight: HTMLButtonElement; sandboxTen: HTMLButtonElement; loadSandbox: HTMLButtonElement; backFromSandbox: HTMLButtonElement; sandboxError: HTMLElement;
  matchScreen: HTMLElement; matchStatus: HTMLElement; openMatchBoard: HTMLButtonElement; main: HTMLElement;
}

interface ApplicationShellOptions {
  elements: ApplicationElements;
  nickname: () => string | undefined;
  setNickname: (nickname: string) => void;
  activeMatchId: () => string | undefined;
  currentMatch: () => ServerMatchState | undefined;
  closeSandboxSession: () => void;
  readApiJson: <T>(response: Response, endpoint: string) => Promise<T>;
  withBusyCursor: <T>(operation: () => Promise<T>) => Promise<T>;
  refreshDeckReadiness: () => Promise<void>;
  setDeckFormat: (format: 8 | 10) => void;
  openDeckBuilder: () => Promise<void>;
  openMatchEntry: (matchId: string) => void;
  resumeMatch: (match: ServerMatchState) => void;
  undoMatch: (match: ServerMatchState) => void;
  startup: () => Promise<void>;
}

export interface ApplicationShell {
  initialize(): Promise<void>;
  loadSandbox(): Promise<void>;
  undoSandbox(match: ServerMatchState): Promise<void>;
  returnToMenu(): void;
  setResumable(match: ServerMatchState): void;
}

export function createApplicationShell(options: ApplicationShellOptions): ApplicationShell {
  const ui = options.elements;
  let playgroundEnabled = false;
  let resumableMatch: ServerMatchState | undefined;

  async function loadConfiguration(): Promise<void> {
    try {
      const response = await fetch('/api/config');
      const payload = await options.readApiJson<{ playgroundEnabled?: boolean }>(response, 'Load application configuration');
      playgroundEnabled = response.ok && payload.playgroundEnabled === true;
    } catch { playgroundEnabled = false; }
    ui.sandboxGame.hidden = !playgroundEnabled;
  }

  function setResumable(match: ServerMatchState): void {
    resumableMatch = match; ui.resumeSandbox.textContent = match.sandbox ? 'Resume playground' : 'Resume match'; ui.resumeSandbox.hidden = false;
  }

  async function login(nickname: string): Promise<void> {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) });
    const payload = await options.readApiJson<{ nickname?: string; error?: string }>(response, 'Login');
    if (!response.ok || !payload.nickname) throw new Error(payload.error ?? 'Login failed.');
    options.setNickname(payload.nickname); localStorage.setItem('hex-war-nickname', payload.nickname); ui.welcome.textContent = `Welcome, ${payload.nickname}`;
    ui.loginScreen.hidden = true; ui.menuScreen.hidden = false; void options.refreshDeckReadiness();
    const active = await fetch(`/api/matches/active?nickname=${encodeURIComponent(payload.nickname)}`);
    if (!active.ok) return;
    const match = (await active.json() as { match?: ServerMatchState }).match;
    if (match?.id && (!match.sandbox || playgroundEnabled)) setResumable(match);
  }

  async function queueForFormat(format: 8 | 10): Promise<void> {
    const nickname = options.nickname(); if (!nickname) return;
    if (options.currentMatch()?.sandbox) options.closeSandboxSession();
    ui.playError.textContent = ''; options.setDeckFormat(format); ui.playEight.disabled = true; ui.playTen.disabled = true;
    ui.playEight.textContent = format === 8 ? 'Waiting for an opponent…' : '8-card game'; ui.playTen.textContent = format === 10 ? 'Waiting for an opponent…' : '10-card game';
    let first = true;
    const poll = async (): Promise<void> => {
      const response = await fetch('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, format, restart: first }) }); first = false;
      const result = await response.json() as { status?: string; matchId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not join the queue.');
      if (result.status === 'matched' && result.matchId) { options.openMatchEntry(result.matchId); return; }
      window.setTimeout(() => { void poll(); }, 1500);
    };
    await poll().catch(error => { void options.refreshDeckReadiness(); ui.playError.textContent = error instanceof Error ? error.message : 'Could not join the queue.'; });
  }

  function returnToMenu(): void {
    ui.playFormats.hidden = true; ui.sandboxFormats.hidden = true; ui.playError.textContent = ''; ui.sandboxError.textContent = '';
    ui.playGame.hidden = false; ui.buildDecks.hidden = false; ui.sandboxGame.hidden = !playgroundEnabled;
  }

  async function startSandbox(format: 8 | 10): Promise<void> {
    const nickname = options.nickname(); if (!nickname || !playgroundEnabled) return;
    await options.withBusyCursor(async () => {
      ui.sandboxError.textContent = '';
      const response = await fetch('/api/sandbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, format, deckIndex: 0 }) });
      const payload = await options.readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Start playground');
      if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not start playground.'); options.resumeMatch(payload.match);
    });
  }

  async function loadSandbox(): Promise<void> {
    const nickname = options.nickname(); if (!nickname || !playgroundEnabled) return;
    await options.withBusyCursor(async () => {
      ui.sandboxError.textContent = '';
      const response = await fetch('/api/sandbox/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) });
      const payload = await options.readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Load playground');
      if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not load playground.'); options.resumeMatch(payload.match);
    });
  }

  async function undoSandbox(match: ServerMatchState): Promise<void> {
    const nickname = options.nickname(); if (!nickname) return;
    await options.withBusyCursor(async () => {
      const response = await fetch(`/api/sandbox/${match.id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) });
      const payload = await options.readApiJson<{ match?: ServerMatchState; error?: string }>(response, 'Undo playground action');
      if (!response.ok || !payload.match) throw new Error(payload.error ?? 'Could not undo the playground action.'); options.undoMatch(payload.match);
    });
  }

  function installEvents(): void {
    ui.loginForm.addEventListener('submit', event => { event.preventDefault(); ui.loginError.textContent = ''; void login(ui.nicknameInput.value.trim()).catch(error => { ui.loginError.textContent = error instanceof Error ? error.message : 'Login failed.'; }); });
    ui.buildDecks.addEventListener('click', () => { void options.openDeckBuilder(); });
    ui.playGame.addEventListener('click', () => { ui.playGame.hidden = true; ui.buildDecks.hidden = true; ui.sandboxGame.hidden = true; ui.playFormats.hidden = false; });
    ui.playEight.addEventListener('click', () => { void queueForFormat(8); }); ui.playTen.addEventListener('click', () => { void queueForFormat(10); }); ui.backFromPlay.addEventListener('click', returnToMenu);
    ui.sandboxGame.addEventListener('click', () => { if (!playgroundEnabled) return; ui.sandboxGame.hidden = true; ui.playGame.hidden = true; ui.buildDecks.hidden = true; ui.sandboxFormats.hidden = false; });
    ui.resumeSandbox.addEventListener('click', () => { if (resumableMatch) options.resumeMatch(resumableMatch); });
    ui.sandboxEight.addEventListener('click', () => { void startSandbox(8).catch(error => { ui.sandboxError.textContent = error instanceof Error ? error.message : 'Could not start playground.'; }); });
    ui.sandboxTen.addEventListener('click', () => { void startSandbox(10).catch(error => { ui.sandboxError.textContent = error instanceof Error ? error.message : 'Could not start playground.'; }); });
    ui.loadSandbox.addEventListener('click', () => { void loadSandbox().catch(error => { ui.sandboxError.textContent = error instanceof Error ? error.message : 'Could not load playground.'; }); }); ui.backFromSandbox.addEventListener('click', returnToMenu);
    ui.openMatchBoard.addEventListener('click', () => { const matchId = options.activeMatchId(); const nickname = options.nickname(); if (!matchId || !nickname) return; ui.openMatchBoard.disabled = true; ui.openMatchBoard.textContent = 'Ready — waiting for opponent…';
      const wait = async (): Promise<void> => { const ready = await fetch(`/api/matches/${matchId}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) }); if (!ready.ok) throw new Error('Could not mark this player ready.');
        const payload = await (await fetch(`/api/matches/${matchId}`)).json() as { match?: ServerMatchState }; if (payload.match?.ready[1] && payload.match.ready[2]) { options.resumeMatch(payload.match); return; } window.setTimeout(() => { void wait(); }, 1000); };
      void wait().catch(error => { ui.openMatchBoard.disabled = false; ui.openMatchBoard.textContent = error instanceof Error ? error.message : 'Ready'; }); });
  }

  async function initialize(): Promise<void> {
    installEvents(); await options.startup(); await loadConfiguration();
    const saved = localStorage.getItem('hex-war-nickname'); if (!saved) return; ui.nicknameInput.value = saved;
    try { await login(saved); } catch { ui.loginError.textContent = 'Please log in again.'; }
  }

  return { initialize, loadSandbox, undoSandbox, returnToMenu, setResumable };
}
