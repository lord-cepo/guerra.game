import type { Player } from '../game/types.js';
import { addDeckCard, clearDeckSlots, completedDeckFormats, createDeckSlots, moveDeckCard, removeDeckCard, selectedDeckCards, swapDeckCards, type DeckFormat, type DeckSlots } from './deck-state.js';
import { appendTroopCardContent } from './card-presentation.js';
import { catalogueById, catalogueIds, createTroopView, fullEffectLines, threeLineSummary, type Troop } from './troop-view.js';

interface DeckBuilderElements {
  actionBar: HTMLElement;
  gameLayout: HTMLElement;
  database: HTMLElement;
  deck: HTMLElement;
  readiness: HTMLElement;
  playGame: HTMLButtonElement;
  playEight: HTMLButtonElement;
  playTen: HTMLButtonElement;
  main: HTMLElement;
  menu: HTMLElement;
}

interface DeckBuilderOptions {
  elements: DeckBuilderElements;
  nickname: () => string | undefined;
  readApiJson: <T>(response: Response, endpoint: string) => Promise<T>;
  appendGroupedCards: (parent: ParentNode, troops: readonly Troop[], render: (troop: Troop) => HTMLElement) => void;
  showHover: (troops: Troop[]) => void;
  hideHover: () => void;
  beginDrag: (event: DragEvent, troop: Troop, source: Element, owner?: Player) => void;
  endDrag: () => void;
  isMagicShieldSummary: (troop: Troop, text: string) => boolean;
}

export interface DeckBuilderController {
  render(): void;
  load(deckIndex?: number): Promise<void>;
  refreshReadiness(): Promise<void>;
  setFormat(format: DeckFormat): void;
  format(): DeckFormat;
  playableFormats(): readonly DeckFormat[];
}

export function createDeckBuilderController(options: DeckBuilderOptions): DeckBuilderController {
  const ui = options.elements;
  let activeDeckIndex = 0;
  let deckFormat: DeckFormat = 8;
  let playableDeckFormats = new Set<DeckFormat>();
  let deckSlots: DeckSlots = createDeckSlots();
  let dirty = false;
  let notice: string | undefined;
  let searchText = '';
  let searchInput: HTMLInputElement | undefined;
  let draggedDatabaseCardId: string | undefined;
  let draggedDeckSlot: number | undefined;

  function renderReadiness(formats?: readonly DeckFormat[], error?: string): void {
    playableDeckFormats = new Set(formats ?? []);
    const checking = formats === undefined && !error;
    ui.playGame.disabled = checking || playableDeckFormats.size === 0;
    ui.playEight.disabled = !playableDeckFormats.has(8); ui.playTen.disabled = !playableDeckFormats.has(10);
    ui.playEight.textContent = playableDeckFormats.has(8) ? '8-card game' : '8-card game — deck required';
    ui.playTen.textContent = playableDeckFormats.has(10) ? '10-card game' : '10-card game — deck required';
    ui.readiness.classList.toggle('ready', playableDeckFormats.size > 0);
    ui.readiness.textContent = error ?? (checking ? 'Checking saved decks…' : playableDeckFormats.size === 0
      ? 'Build a complete deck with exactly one hero to unlock Play.'
      : `Ready to play: ${[...playableDeckFormats].map(format => `${format}-card`).join(' and ')} deck available.`);
  }

  async function refreshReadiness(): Promise<void> {
    const nickname = options.nickname(); if (!nickname) return;
    renderReadiness();
    try {
      const response = await fetch(`/api/decks?nickname=${encodeURIComponent(nickname)}`);
      const payload = await options.readApiJson<{ decks?: unknown; error?: string }>(response, 'Load decks');
      if (!response.ok) throw new Error(payload.error ?? 'Could not check saved decks.');
      renderReadiness(completedDeckFormats(payload.decks, catalogueById));
    } catch (error) { renderReadiness([], error instanceof Error ? error.message : 'Could not check saved decks.'); }
  }

  async function load(deckIndex = activeDeckIndex): Promise<void> {
    const nickname = options.nickname(); if (!nickname) return;
    activeDeckIndex = deckIndex;
    const response = await fetch(`/api/decks?nickname=${encodeURIComponent(nickname)}`);
    const payload = await response.json() as { decks?: Record<string, unknown> };
    const formatDecks = payload.decks?.[String(deckFormat)];
    const cards = Array.isArray(formatDecks) && Array.isArray(formatDecks[deckIndex])
      ? formatDecks[deckIndex].filter((id): id is string => typeof id === 'string' && catalogueById.has(id)) : [];
    deckSlots = createDeckSlots(cards); dirty = false; notice = undefined;
  }

  async function persist(): Promise<void> {
    const nickname = options.nickname(); if (!nickname) return;
    const response = await fetch(`/api/decks/${activeDeckIndex}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname, cards: selectedDeckCards(deckSlots, deckFormat), format: deckFormat }),
    });
    if (response.ok) return;
    const payload = await options.readApiJson<{ error?: string }>(response, 'Save deck');
    throw new Error(payload.error ?? 'Could not save the deck.');
  }

  function searchMatches(troop: Troop): boolean {
    const tokens = searchText.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
    const types = tokens.filter(token => token.startsWith('t:')).map(token => token.slice(2)).filter(Boolean);
    const names = tokens.filter(token => !token.startsWith('t:'));
    const actions = [...troop.actions, ...(troop.triggers ?? []).map(trigger => trigger.action)].flatMap(action => {
      const aliases = action.kind === 'ranged' ? ['attack'] : action.kind === 'fire' ? ['magic'] : [];
      if (action.kind === 'defense' && action.type?.includes('magic')) aliases.push('magic-defense');
      return [action.kind, ...aliases];
    });
    if (troop.selfMagicDefense !== undefined) actions.push('self-magic-defense');
    return names.every(term => `${troop.name ?? ''} ${troop.cardId}`.toLocaleLowerCase().includes(term)) && types.every(type => actions.includes(type));
  }

  function applyEdit(next: DeckSlots): void {
    if (next === deckSlots) return; deckSlots = next; dirty = true; notice = undefined; render();
  }

  function moveDatabaseCard(cardId: string, slot: number): void {
    draggedDatabaseCardId = undefined; draggedDeckSlot = undefined; applyEdit(moveDeckCard(deckSlots, cardId, slot, deckFormat, catalogueById));
  }

  function swapSlots(from: number, to: number): void { draggedDeckSlot = undefined; applyEdit(swapDeckCards(deckSlots, from, to, deckFormat)); }

  function renderCard(troop: Troop, className: 'database-card' | 'deck-card', slot?: number): HTMLButtonElement {
    const card = document.createElement('button'); card.type = 'button'; card.classList.add('troop-card', className, 'server-owner-one');
    card.dataset.deploymentOwner = 'red';
    if (troop.role === 'hero') card.classList.add('hero-card');
    if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-both');
    else if (troop.deploymentRegions.includes('starting')) card.classList.add('deployment-starting');
    else if (troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-intermediate');
    else if (troop.deploymentRegions.includes('front')) card.classList.add('deployment-front');
    if (troop.deploymentRule === 'enemy-region') card.classList.add('deployment-enemy');
    appendTroopCardContent(card, troop, threeLineSummary(fullEffectLines(troop)).map(text => { const magicShield = options.isMagicShieldSummary(troop, text); return { text: magicShield ? text.replace(/^~|~$/g, '') : text, magicShield }; }), `♥ ${troop.baseHealth}`);
    card.addEventListener('pointerenter', () => options.showHover([troop])); card.addEventListener('pointerleave', options.hideHover);
    card.addEventListener('focus', () => options.showHover([troop])); card.addEventListener('blur', options.hideHover);
    card.draggable = true;
    if (className === 'database-card') {
      card.addEventListener('dragstart', event => { draggedDatabaseCardId = troop.cardId; draggedDeckSlot = undefined; options.beginDrag(event, troop, card, 1); });
      card.addEventListener('click', () => applyEdit(addDeckCard(deckSlots, troop.cardId, deckFormat, catalogueById)));
    } else if (slot !== undefined) {
      card.addEventListener('dragstart', event => { draggedDeckSlot = slot; draggedDatabaseCardId = undefined; options.beginDrag(event, troop, card, 1); });
      card.addEventListener('click', () => applyEdit(removeDeckCard(deckSlots, slot, deckFormat)));
      card.addEventListener('dragover', event => event.preventDefault());
      card.addEventListener('drop', event => { event.preventDefault(); if (draggedDatabaseCardId) moveDatabaseCard(draggedDatabaseCardId, slot); else if (draggedDeckSlot !== undefined) swapSlots(draggedDeckSlot, slot); });
    }
    card.addEventListener('dragend', options.endDrag); return card;
  }

  function renderActionBar(): void {
    ui.actionBar.replaceChildren();
    const search = document.createElement('input'); search.type = 'search'; search.className = 'deck-builder-search'; search.placeholder = 'Search cards or t:fire, t:ranged…'; search.setAttribute('aria-label', 'Search deck builder cards'); search.value = searchText; searchInput = search;
    search.addEventListener('input', () => { const cursor = search.selectionStart ?? search.value.length; searchText = search.value; render(); searchInput?.focus(); searchInput?.setSelectionRange(cursor, cursor); }); ui.actionBar.append(search);
    const formatPicker = document.createElement('select');
    for (const format of [8, 10] as const) { const option = document.createElement('option'); option.value = String(format); option.textContent = `${format}-card`; option.selected = format === deckFormat; formatPicker.append(option); }
    formatPicker.addEventListener('change', async () => { deckFormat = Number(formatPicker.value) as DeckFormat; await load(); render(); }); ui.actionBar.append(formatPicker);
    const deckPicker = document.createElement('select');
    for (let index = 0; index < 4; index += 1) { const option = document.createElement('option'); option.value = String(index); option.textContent = `Deck ${index + 1}`; option.selected = index === activeDeckIndex; deckPicker.append(option); }
    deckPicker.addEventListener('change', async () => { await load(Number(deckPicker.value)); render(); }); ui.actionBar.append(deckPicker);
    const cards = selectedDeckCards(deckSlots, deckFormat); const hasHero = cards.filter(id => catalogueById.get(id)?.role === 'hero').length === 1;
    const message = document.createElement('span'); message.textContent = notice ?? `Deck builder: ${cards.length}/${deckFormat} cards${hasHero ? '' : ' — choose exactly one hero'}${dirty ? ' — unsaved changes' : ''}. Click database cards to add; click deck cards to remove.`; ui.actionBar.append(message);
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear deck'; clear.disabled = cards.length === 0; clear.addEventListener('click', () => applyEdit(clearDeckSlots())); ui.actionBar.append(clear);
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save deck'; save.disabled = !dirty;
    save.addEventListener('click', () => { const draft = deckSlots; const format = deckFormat; const index = activeDeckIndex; save.disabled = true; notice = 'Saving deck…'; message.textContent = notice;
      void persist().then(() => { const unchanged = deckSlots === draft && deckFormat === format && activeDeckIndex === index; if (unchanged) dirty = false; notice = unchanged ? 'Deck saved.' : 'Saved the previous version; newer changes are still unsaved.'; render(); })
        .catch(error => { notice = error instanceof Error ? error.message : 'Could not save the deck.'; render(); }); }); ui.actionBar.append(save);
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back';
    back.addEventListener('click', () => { deckSlots = createDeckSlots(); dirty = false; notice = undefined; ui.main.hidden = true; ui.menu.hidden = false; void refreshReadiness(); }); ui.actionBar.append(back);
  }

  function render(): void {
    ui.gameLayout.classList.add('deck-building'); ui.database.replaceChildren(); ui.deck.replaceChildren();
    ui.database.classList.remove('grouped-card-list', 'sandbox-catalog'); ui.deck.classList.remove('grouped-card-list', 'sandbox-catalog'); ui.database.classList.add('deck-builder', 'grouped-card-list'); ui.deck.classList.add('deck-builder');
    const available = catalogueIds.filter(id => !deckSlots.includes(id)).map(id => createTroopView(id, 1)).filter((troop): troop is Troop => Boolean(troop)).filter(searchMatches);
    options.appendGroupedCards(ui.database, available, troop => renderCard(troop, 'database-card'));
    for (let slot = 0; slot < deckFormat; slot += 1) {
      const troop = deckSlots[slot] ? createTroopView(deckSlots[slot] as string, 1) : undefined;
      if (troop) { ui.deck.append(renderCard(troop, 'deck-card', slot)); continue; }
      const empty = document.createElement('div'); empty.classList.add('troop-card', 'deck-empty'); empty.textContent = `Empty ${slot + 1}`; empty.addEventListener('dragover', event => event.preventDefault());
      empty.addEventListener('drop', event => { event.preventDefault(); if (draggedDatabaseCardId) moveDatabaseCard(draggedDatabaseCardId, slot); else if (draggedDeckSlot !== undefined) swapSlots(draggedDeckSlot, slot); }); ui.deck.append(empty);
    }
    renderActionBar();
  }

  return { render, load, refreshReadiness, setFormat: format => { deckFormat = format; }, format: () => deckFormat, playableFormats: () => [...playableDeckFormats] };
}
