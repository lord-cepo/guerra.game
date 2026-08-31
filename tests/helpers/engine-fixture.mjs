import { troopSeeds } from '../../dist/game/cards.js';

export function createEngineCards() {
  const catalogueCards = new Map(troopSeeds.map(card => [card.id, card]));
  const cards = new Map(catalogueCards);
  // Generic scenarios use Queen Bee's ranged profile on a non-hero fixture so
  // deployment prerequisites can be tested independently.
  cards.set('queen-bee', { ...cards.get('queen-bee'), role: 'troop', baseHealth: 3 });
  cards.set('pierce-test', { id: 'pierce-test', name: 'Pierce Test', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: [{ kind: 'ranged', amount: 1, range: 3, type: ['pierce'] }] });
  cards.set('magic-defense-test', { id: 'magic-defense-test', name: 'Magic Defense Test', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: [{ kind: 'defense', amount: 2, range: 2, type: ['magic'] }] });
  cards.set('self-magic-defense-test', { id: 'self-magic-defense-test', name: 'Self Magic Defense Test', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: [], selfMagicDefense: 2 });
  cards.set('pierce-fire-test', { id: 'pierce-fire-test', name: 'Pierce Fire Test', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: [{ kind: 'fire', amount: 2, range: 2, type: ['pierce'] }] });
  cards.set('tireless-test', { id: 'tireless-test', name: 'Tireless Test', role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: [{ kind: 'ranged', amount: 1, range: 3, type: ['tireless'] }] });
  return { cards, catalogueCards, troopSeeds };
}
