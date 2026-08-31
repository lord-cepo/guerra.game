import { toCoordinate, type Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { ServerMatchState, ServerUnitState } from './protocol.js';
import { appendTroopCardContent, cardHealthDescription, cardTroopIcon } from './card-presentation.js';
import { compareTroopsForTray, hasDeploymentTarget, isMagicShieldSummaryText, serverCardDetails, threeLineSummary, trayRoleLabel, troopDisplayName, type Troop } from './troop-view.js';
import type { BoardCellView } from './board-grid-view.js';

type BoardDrag = { owner: Player; troopId: string; mode: 'deploy' | 'free' };

interface TroopTrayOptions {
  match: () => ServerMatchState | undefined;
  localPlayer: () => Player | undefined;
  selectedTroopId: () => string | undefined;
  cells: () => ReadonlyMap<Coordinate, BoardCellView>;
  troop: (cardId: string, owner: Player, unit?: ServerUnitState) => Troop | undefined;
  selectTroop: (troopId: string) => void;
  stageDeployment: (troopId: string, coordinate: Coordinate) => void;
  placeFree: (dragged: BoardDrag, coordinate: Coordinate) => void;
  showHover: (troops: Troop[]) => void;
  hideHover: () => void;
}

export interface TroopTrayController {
  beginDrag(event: DragEvent, troop: Troop, source: Element, owner?: Player): void;
  endDrag(): void;
  enableBoardDrag(source: Element, troop: Troop, dragged: BoardDrag): void;
  appendGroupedCards(parent: ParentNode, troops: readonly Troop[], render: (troop: Troop) => Node): void;
  isMagicShieldSummary(troop: Troop, text: string): boolean;
  render(owner: Player, tray: HTMLElement, interactive: boolean): void;
}

export function createTroopTrayController(options: TroopTrayOptions): TroopTrayController {
  let activePreview: HTMLElement | undefined;
  let activeSource: Element | undefined;
  const ignoredClicks = new WeakSet<Element>();

  function createDragPreview(troop: Troop, owner?: Player): HTMLElement {
    activePreview?.remove(); activeSource?.classList.remove('dragging-card');
    const preview = document.createElement('div'); preview.classList.add('troop-drag-preview'); if (owner) preview.dataset.owner = String(owner);
    const name = document.createElement('strong'); name.textContent = troopDisplayName(troop); preview.append(name, cardTroopIcon(troop.role));
    document.body.append(preview); activePreview = preview; return preview;
  }

  function beginDrag(event: DragEvent, troop: Troop, source: Element, owner?: Player): void {
    const preview = createDragPreview(troop, owner); source.classList.add('dragging-card'); activeSource = source;
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2); }
  }

  function endDrag(): void {
    activePreview?.remove(); activeSource?.classList.remove('dragging-card'); activePreview = undefined; activeSource = undefined;
    for (const { cell } of options.cells().values()) cell.classList.remove('drag-over');
  }

  function canDrop(dragged: BoardDrag | undefined): boolean {
    const match = options.match(); const local = options.localPlayer();
    if (!dragged || !match || !local) return false;
    return dragged.mode === 'free' ? Boolean(match.sandboxFreePlacement)
      : !match.sandboxFreePlacement && dragged.owner === local && match.activePlayer === local;
  }

  function cellAtPoint(x: number, y: number): SVGGElement | undefined {
    const cell = document.elementFromPoint(x, y)?.closest<SVGGElement>('.cell');
    return cell?.dataset.x !== undefined && cell.dataset.y !== undefined && cell.id !== 'hex-0-0' ? cell : undefined;
  }

  function drop(dragged: BoardDrag, coordinate: Coordinate): void {
    if (dragged.mode === 'free') options.placeFree(dragged, coordinate); else options.stageDeployment(dragged.troopId, coordinate);
  }

  function enableBoardDrag(source: Element, troop: Troop, dragged: BoardDrag): void {
    source.classList.add('pointer-draggable');
    source.addEventListener('click', event => { if (!ignoredClicks.delete(source)) return; event.preventDefault(); event.stopImmediatePropagation(); }, true);
    source.addEventListener('pointerdown', raw => {
      const startEvent = raw as PointerEvent; if (startEvent.button !== 0 || !canDrop(dragged)) return;
      const start = { x: startEvent.clientX, y: startEvent.clientY }; let moving = false;
      const clearTarget = (): void => { for (const { cell } of options.cells().values()) cell.classList.remove('drag-over'); };
      const finish = (): void => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true); endDrag(); };
      const move = (event: PointerEvent): void => {
        if (event.pointerId !== startEvent.pointerId || (!moving && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6)) return;
        if (!moving) { moving = true; const preview = createDragPreview(troop, dragged.owner); preview.classList.add('pointer-drag-preview'); source.classList.add('dragging-card'); activeSource = source; options.hideHover(); }
        event.preventDefault(); if (activePreview) activePreview.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px) rotate(2deg)`;
        clearTarget(); if (canDrop(dragged)) cellAtPoint(event.clientX, event.clientY)?.classList.add('drag-over');
      };
      const up = (event: PointerEvent): void => { if (event.pointerId !== startEvent.pointerId) return; if (moving) { event.preventDefault(); const cell = cellAtPoint(event.clientX, event.clientY); if (cell && canDrop(dragged)) drop(dragged, toCoordinate(Number(cell.dataset.x), Number(cell.dataset.y))); ignoredClicks.add(source); } finish(); };
      const cancel = (event: PointerEvent): void => { if (event.pointerId === startEvent.pointerId) finish(); };
      document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
    });
  }

  function appendGroupedCards(parent: ParentNode, troops: readonly Troop[], render: (troop: Troop) => Node): void {
    let role: Troop['role'] | undefined; let cards: HTMLElement | undefined;
    for (const troop of [...troops].sort(compareTroopsForTray)) {
      if (!cards || troop.role !== role) { const group = document.createElement('section'); group.className = 'card-role-group'; const heading = document.createElement('h3'); heading.className = 'card-role-heading'; heading.textContent = trayRoleLabel(troop.role); cards = document.createElement('div'); cards.className = 'card-role-cards'; group.append(heading, cards); parent.append(group); role = troop.role; }
      cards.append(render(troop));
    }
  }

  function isMagicShieldSummary(troop: Troop, text: string): boolean { return isMagicShieldSummaryText(troop, text); }

  function renderCard(match: ServerMatchState, owner: Player, troop: Troop, interactive: boolean): HTMLButtonElement {
    const deployedUnit = match.units.find(unit => unit.owner === owner && unit.troopId === troop.cardId);
    const lastActing = Boolean(deployedUnit?.inactive) || (!deployedUnit && match.lastActingTroopId?.[owner] === troop.cardId) || (deployedUnit?.stunnedTurns ?? 0) > 0;
    const free = Boolean(match.sandbox && match.sandboxFreePlacement); const canDeploy = free || hasDeploymentTarget(match, owner, troop);
    const canChoose = interactive && !match.winner && !troop.defeated && !lastActing && canDeploy; const dragMode = free ? 'free' : canChoose ? 'deploy' : undefined;
    const card = document.createElement('button'); card.type = 'button'; card.disabled = !free && !canChoose; card.draggable = false; card.classList.add('troop-card', owner === 1 ? 'server-owner-one' : 'server-owner-two');
    if (!free && owner !== match.activePlayer) card.classList.add('inactive-player-card'); card.dataset.deploymentOwner = owner === 1 ? 'red' : 'blue';
    if (troop.role === 'hero') card.classList.add('hero-card'); if (lastActing) card.classList.add('last-acting-card'); if (troop.defeated || lastActing) card.classList.add('unavailable-card'); if (!free && !canDeploy) card.classList.add('undeployable-card');
    if ((owner === options.localPlayer() && options.selectedTroopId() === troop.cardId) || match.selections?.[owner] === troop.cardId) card.classList.add('selected-card');
    if (troop.deploymentRegions.includes('starting') && troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-both'); else if (troop.deploymentRegions.includes('starting')) card.classList.add('deployment-starting'); else if (troop.deploymentRegions.includes('intermediate')) card.classList.add('deployment-intermediate'); else if (troop.deploymentRegions.includes('front')) card.classList.add('deployment-front'); if (troop.deploymentRule === 'enemy-region') card.classList.add('deployment-enemy');
    const details = threeLineSummary(troop.defeated ? ['Defeated'] : serverCardDetails(troop)).map(text => { const magicShield = isMagicShieldSummary(troop, text); const clean = magicShield ? text.replace(/^~|~$/g, '') : text; return { text: clean, upgraded: clean.startsWith('🔮 '), magicShield }; });
    appendTroopCardContent(card, troop, details, cardHealthDescription(troop));
    card.addEventListener('pointerenter', () => options.showHover([troop])); card.addEventListener('pointerleave', options.hideHover); card.addEventListener('focus', () => options.showHover([troop])); card.addEventListener('blur', options.hideHover);
    if (dragMode) enableBoardDrag(card, troop, { owner, troopId: troop.cardId, mode: dragMode }); card.addEventListener('click', () => { if (canChoose) options.selectTroop(troop.cardId); }); return card;
  }

  function render(owner: Player, tray: HTMLElement, interactive: boolean): void {
    const match = options.match(); if (!match) return; tray.replaceChildren(); tray.classList.remove('deck-builder'); tray.classList.add('grouped-card-list'); tray.classList.toggle('sandbox-catalog', Boolean(match.sandbox));
    const deployed = new Set(match.units.filter(unit => unit.owner === owner).map(unit => unit.troopId));
    const troops = match.decks[owner].filter(id => !deployed.has(id)).map(id => options.troop(id, owner)).filter((troop): troop is Troop => Boolean(troop));
    const fragment = document.createDocumentFragment(); appendGroupedCards(fragment, troops, troop => renderCard(match, owner, troop, interactive)); tray.append(fragment);
  }

  return { beginDrag, endDrag, enableBoardDrag, appendGroupedCards, isMagicShieldSummary, render };
}
