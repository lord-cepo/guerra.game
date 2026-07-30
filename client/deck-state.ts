import type { TroopRole } from '../game/cards.js';

export type DeckFormat = 8 | 10;
export type DeckSlot = string | undefined;
export type DeckSlots = readonly DeckSlot[];

type DeckCatalogue = ReadonlyMap<string, { role: TroopRole }>;

const MAX_DECK_SIZE = 10;

export function createDeckSlots(cards: readonly string[] = []): DeckSlots {
  return Array.from({ length: MAX_DECK_SIZE }, (_, index) => cards[index]);
}

/** Start an empty draft without mutating the saved or currently rendered deck. */
export function clearDeckSlots(): DeckSlots {
  return createDeckSlots();
}

export function selectedDeckCards(slots: DeckSlots, format: DeckFormat): string[] {
  return slots.slice(0, format).filter((cardId): cardId is string => cardId !== undefined);
}

export function isCompleteDeck(cards: unknown, format: DeckFormat, catalogue: DeckCatalogue): cards is string[] {
  if (!Array.isArray(cards) || cards.length !== format || new Set(cards).size !== cards.length) return false;
  if (!cards.every(cardId => typeof cardId === 'string' && catalogue.has(cardId))) return false;
  return cards.filter(cardId => catalogue.get(cardId)?.role === 'hero').length === 1;
}

export function completedDeckFormats(decks: unknown, catalogue: DeckCatalogue): DeckFormat[] {
  if (!decks || typeof decks !== 'object') return [];
  const formats: DeckFormat[] = [8, 10];
  return formats.filter(format => {
    const savedDecks = (decks as Record<string, unknown>)[String(format)];
    return Array.isArray(savedDecks) && savedDecks.some(cards => isCompleteDeck(cards, format, catalogue));
  });
}

function validSlot(slot: number, format: DeckFormat): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < format;
}

function canPlaceCard(slots: DeckSlots, cardId: string, slot: number, format: DeckFormat, catalogue: DeckCatalogue): boolean {
  const card = catalogue.get(cardId);
  if (!card || !validSlot(slot, format)) return false;
  if (card.role !== 'hero') return true;
  const replacing = slots[slot];
  return !selectedDeckCards(slots, format).some(
    selectedId => selectedId !== cardId && selectedId !== replacing && catalogue.get(selectedId)?.role === 'hero'
  );
}

/** Add a catalogue card to the first empty slot visible in the chosen format. */
export function addDeckCard(slots: DeckSlots, cardId: string, format: DeckFormat, catalogue: DeckCatalogue): DeckSlots {
  if (slots.includes(cardId) || !catalogue.has(cardId)) return slots;
  const slot = slots.slice(0, format).findIndex(selectedId => selectedId === undefined);
  if (slot < 0 || !canPlaceCard(slots, cardId, slot, format, catalogue)) return slots;
  const next = [...slots];
  next[slot] = cardId;
  return next;
}

export function removeDeckCard(slots: DeckSlots, slot: number, format: DeckFormat): DeckSlots {
  if (!validSlot(slot, format) || slots[slot] === undefined) return slots;
  const next = [...slots];
  next[slot] = undefined;
  return next;
}

/** Drop a catalogue card into a visible slot, swapping it with its old slot when needed. */
export function moveDeckCard(slots: DeckSlots, cardId: string, slot: number, format: DeckFormat, catalogue: DeckCatalogue): DeckSlots {
  if (!canPlaceCard(slots, cardId, slot, format, catalogue)) return slots;
  const oldSlot = slots.indexOf(cardId);
  if (oldSlot === slot) return slots;
  const next = [...slots];
  if (oldSlot >= 0) next[oldSlot] = next[slot];
  next[slot] = cardId;
  return next;
}

export function swapDeckCards(slots: DeckSlots, from: number, to: number, format: DeckFormat): DeckSlots {
  if (from === to || !validSlot(from, format) || !validSlot(to, format)) return slots;
  const next = [...slots];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
