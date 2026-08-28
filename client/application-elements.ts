function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

export function getApplicationElements() {
  return {
    board: requiredElement<SVGSVGElement>('#board'),
    boardArea: requiredElement<HTMLElement>('.board-area'),
    playerOneCards: requiredElement<HTMLElement>('#player-one-cards'),
    playerTwoCards: requiredElement<HTMLElement>('#player-two-cards'),
    actionBar: requiredElement<HTMLElement>('#action-bar'),
    gameLayout: requiredElement<HTMLElement>('.game-layout'),
    troopInspector: requiredElement<HTMLElement>('#troop-inspector'),
    inspectorClose: requiredElement<HTMLButtonElement>('#inspector-close'),
    hoverDetails: requiredElement<HTMLElement>('#hover-details'),
    loginScreen: requiredElement<HTMLElement>('#login-screen'),
    menuScreen: requiredElement<HTMLElement>('#menu-screen'),
    loginForm: requiredElement<HTMLFormElement>('#login-form'),
    nicknameInput: requiredElement<HTMLInputElement>('#nickname'),
    loginError: requiredElement<HTMLElement>('#login-error'),
    welcome: requiredElement<HTMLElement>('#welcome'),
    deckReadiness: requiredElement<HTMLElement>('#deck-readiness'),
    buildDecks: requiredElement<HTMLButtonElement>('#build-decks'),
    playGame: requiredElement<HTMLButtonElement>('#play-game'),
    sandboxGame: requiredElement<HTMLButtonElement>('#sandbox-game'),
    resumeSandbox: requiredElement<HTMLButtonElement>('#resume-sandbox'),
    playFormats: requiredElement<HTMLElement>('#play-formats'),
    playEightCards: requiredElement<HTMLButtonElement>('#play-8-cards'),
    playTenCards: requiredElement<HTMLButtonElement>('#play-10-cards'),
    backFromPlay: requiredElement<HTMLButtonElement>('#back-from-play'),
    playFormatError: requiredElement<HTMLElement>('#play-format-error'),
    sandboxFormats: requiredElement<HTMLElement>('#sandbox-formats'),
    sandboxEightCards: requiredElement<HTMLButtonElement>('#sandbox-8-cards'),
    sandboxTenCards: requiredElement<HTMLButtonElement>('#sandbox-10-cards'),
    loadSandbox: requiredElement<HTMLButtonElement>('#load-sandbox'),
    backFromSandbox: requiredElement<HTMLButtonElement>('#back-from-sandbox'),
    sandboxError: requiredElement<HTMLElement>('#sandbox-error'),
    matchScreen: requiredElement<HTMLElement>('#match-screen'),
    matchStatus: requiredElement<HTMLElement>('#match-status'),
    matchDecks: requiredElement<HTMLElement>('#match-decks'),
    openMatchBoard: requiredElement<HTMLButtonElement>('#open-match-board'),
    main: requiredElement<HTMLElement>('main'),
    connectionStatus: requiredElement<HTMLElement>('#connection-status'),
  };
}

export type ApplicationElements = ReturnType<typeof getApplicationElements>;
