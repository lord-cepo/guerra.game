import type { Coordinate } from '../game/board.js';
import type { Player } from '../game/types.js';
import type { GameActionType, ServerLegalAction, ServerMatchState, ServerUnitState } from './protocol.js';
import { catalogueById, deploymentDescription, pullIcon, pushIcon, stunIcon, troopDisplayName, type Troop } from './troop-view.js';

interface ActionBarOptions {
  panel: HTMLElement;
  error: () => string | undefined;
  selectedTroopId: () => string | undefined;
  selectedAction: () => GameActionType | undefined;
  setSelectedAction: (type: GameActionType) => void;
  pendingAction: () => ServerLegalAction | undefined;
  setPendingAction: (action: ServerLegalAction | undefined) => void;
  pushChoices: () => ServerLegalAction[];
  clearPushChoices: () => void;
  selectedUnit: () => ServerUnitState | undefined;
  legalActions: () => ServerLegalAction[];
  troop: (cardId: string, owner: Player, unit?: ServerUnitState) => Troop | undefined;
  sendAction: (action: ServerLegalAction | { type: GameActionType; troopId?: string }) => void;
  sendSelection: (troopId: string | undefined, target?: { type: GameActionType; coordinate: Coordinate }) => void;
  clearSelection: () => void;
  confirm: () => void;
  renderMatch: (match: ServerMatchState) => void;
  sendSandboxMode: (match: ServerMatchState, freePlacement: boolean) => void;
  saveSandbox: (match: ServerMatchState) => Promise<void>;
  loadSandbox: () => Promise<void>;
  undoSandbox: (match: ServerMatchState) => Promise<void>;
  leaveSandbox: (match: ServerMatchState) => void;
  reportError: (message: string) => void;
}

const labels: Record<GameActionType, string> = {
  deploy: 'Deploy', move: '🥾 Move', fly: '🪽 Fly', attack: '🏹 Ranged', cannon: '🧨 Cannon', gore: '🐏 Gore', bomb: '💣 Bomb',
  push: `${pushIcon} Push`, pull: `${pullIcon} Pull`, stun: `${stunIcon} Stun`, defense: '🛡️ Defense', 'magic-defense': '🛡️M Magic Defense',
  'self-defense': '🛡️ Self Defense', 'self-magic-defense': '🛡️M Self Magic Defense', magic: '🔥 Fire Magic', mending: '❤️ Mending', upgrade: '🔮 Upgrade', pass: 'Pass',
  'resolve-move': '🥾 End move', 'resolve-death-attack': '💀 Death attack', 'resolve-instant-ranged': 'F🏹 Instant ranged',
  'resolve-instant-magic': 'F🔥 Instant magic', 'resolve-stun': `${stunIcon} End stun`, 'resolve-pull': `${pullIcon} Resolve pull`, 'resolve-revive': '👼 Revive', 'resolve-pass': 'Skip triggered action',
};

export function actionLabel(type: GameActionType): string { return labels[type]; }

function appendLabel(button: HTMLButtonElement, type: GameActionType, shortcut?: number): void {
  if (shortcut !== undefined && shortcut <= 9) button.append(document.createTextNode(`${shortcut} · `));
  const label = actionLabel(type); if (type !== 'magic-defense' && type !== 'self-magic-defense') { button.append(document.createTextNode(label)); return; }
  const [before, ...after] = label.split('🛡️'); button.append(document.createTextNode(before));
  const shield = document.createElement('span'); shield.classList.add('magic-detail', 'magic-symbol'); shield.textContent = '🛡︎'; button.append(shield);
  if (after.length) button.append(document.createTextNode(after.join('🛡️')));
}

export function createMatchActionBar(options: ActionBarOptions): (match: ServerMatchState, local: Player) => void {
  const render = (match: ServerMatchState, local: Player): void => {
    const panel = options.panel; panel.replaceChildren();
    if (match.sandbox) {
      const tools = document.createElement('span'); tools.className = 'sandbox-tools';
      const free = document.createElement('button'); free.type = 'button'; free.textContent = match.sandboxFreePlacement ? 'Free placement: on' : 'Free placement: off'; free.classList.toggle('active-action', Boolean(match.sandboxFreePlacement)); free.addEventListener('click', () => options.sendSandboxMode(match, !match.sandboxFreePlacement));
      const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save playground'; save.addEventListener('click', () => { void options.saveSandbox(match); });
      const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Load saved'; load.addEventListener('click', () => { void options.loadSandbox().catch(error => { options.reportError(error instanceof Error ? error.message : 'Could not load playground.'); render(match, local); }); });
      const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back'; back.title = 'Revert the last playground action'; back.disabled = !match.sandboxUndoAvailable; back.addEventListener('click', () => { void options.undoSandbox(match).catch(error => { options.reportError(error instanceof Error ? error.message : 'Could not undo the playground action.'); render(match, local); }); });
      const menu = document.createElement('button'); menu.type = 'button'; menu.textContent = 'Back to menu'; menu.addEventListener('click', () => options.leaveSandbox(match));
      tools.append(free, save, load, back, menu); panel.append(tools);
    }
    const message = document.createElement('span');
    if (match.winner) message.textContent = `Player ${match.winner === 1 ? '1 / Red' : '2 / Blue'} wins.`;
    else if (options.error()) message.textContent = options.error()!;
    else if (match.pendingResolution?.owner === local) message.textContent = match.pendingResolution.kind === 'optional-move' ? 'End: move this hero 1 hex, or decline to finish your turn.'
      : match.pendingResolution.kind === 'death-attack' ? 'Death burst: choose an enemy target.'
        : match.pendingResolution.kind === 'instant-ranged' ? `Choose a hex for the instant ranged effect${match.pendingResolution.remaining > 1 ? ` (${match.pendingResolution.remaining} remaining)` : ''}.`
          : match.pendingResolution.kind === 'instant-magic' ? 'Choose a hex for the instant magic effect.' : match.pendingResolution.kind === 'stun' ? 'Choose an enemy troop to stun.'
            : match.pendingResolution.kind === 'trigger-pull' ? 'Start Pull: choose a friendly or enemy troop, or skip and take your normal turn.' : 'Revive: choose one of your defeated troops, or skip.';
    else message.textContent = match.activePlayer === local ? 'Your turn.' : `Opponent's turn — Player ${match.activePlayer === 1 ? '1 / Red' : '2 / Blue'}.`;
    panel.append(message);
    if (match.sandbox && match.activePlayer === local && !match.winner && !match.pendingResolution) { const pass = document.createElement('button'); pass.type = 'button'; pass.textContent = 'Pass turn'; pass.addEventListener('click', () => options.sendAction({ type: 'pass' })); panel.append(pass); }
    const selectedId = options.selectedTroopId(); const unit = options.selectedUnit();
    if (!selectedId || (match.pendingResolution?.owner ?? match.activePlayer) !== local || match.winner) return;
    const legal = options.legalActions();
    if (match.pendingResolution?.kind === 'revive') {
      for (const choice of legal.filter(action => action.type === 'resolve-revive')) { if (!choice.targetTroopId) continue; const button = document.createElement('button'); button.type = 'button'; button.textContent = `👼 ${catalogueById.get(choice.targetTroopId)?.name ?? choice.targetTroopId}`; button.addEventListener('click', () => options.sendAction(choice)); panel.append(button); }
      const skip = legal.find(action => action.type === 'resolve-pass'); if (skip) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Skip'; button.addEventListener('click', () => options.sendAction(skip)); panel.append(button); }
    } else if (match.pendingResolution && ['death-attack', 'instant-ranged', 'instant-magic', 'stun'].includes(match.pendingResolution.kind)) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = match.pendingResolution.kind === 'death-attack' ? '💀 Choose ranged target' : match.pendingResolution.kind === 'stun' ? `${stunIcon} Choose target troop` : match.pendingResolution.kind === 'instant-magic' ? 'F🔥 Choose target hex' : 'F🏹 Choose target hex'; button.classList.add('active-action'); panel.append(button);
      const skip = legal.find(action => action.type === 'resolve-pass'); if (skip) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Skip'; button.addEventListener('click', () => options.sendAction(skip)); panel.append(button); }
    } else if (!unit) {
      const troop = options.troop(selectedId, local); const canDeploy = legal.some(action => action.type === 'deploy');
      message.textContent = options.pendingAction() ? `Deploy to ${options.pendingAction()?.coordinate}. Confirm when ready.` : canDeploy ? 'Choose a highlighted hex, or drag this card directly onto a legal deployment hex.' : troop ? `No legal hex for ${troopDisplayName(troop)} yet. ${deploymentDescription(troop)}` : 'This card has no legal deployment hex right now.';
    } else {
      const available = new Set(legal.map(action => action.type)); const order: GameActionType[] = ['resolve-move', 'resolve-death-attack', 'resolve-instant-ranged', 'resolve-instant-magic', 'resolve-stun', 'resolve-pull', 'resolve-pass', 'move', 'fly', 'attack', 'cannon', 'gore', 'bomb', 'push', 'pull', 'stun', 'defense', 'magic-defense', 'self-defense', 'self-magic-defense', 'magic', 'mending', 'upgrade']; let next = 2;
      for (const type of order.filter(candidate => available.has(candidate))) {
        const shortcut = type === 'move' || type === 'resolve-move' ? 1 : next++; const button = document.createElement('button'); button.type = 'button'; appendLabel(button, type, shortcut); button.classList.toggle('active-action', options.selectedAction() === type);
        if (shortcut <= 9) { button.dataset.actionShortcut = String(shortcut); button.setAttribute('aria-keyshortcuts', String(shortcut)); button.title = `Keyboard shortcut: ${shortcut}`; }
        button.addEventListener('click', () => { if (type === 'resolve-pass') { options.sendAction({ type, troopId: selectedId }); return; } options.setSelectedAction(type); const self = type === 'self-defense' || type === 'self-magic-defense' ? legal.find(action => action.type === type) : undefined; options.setPendingAction(self ? { ...self } : undefined); options.sendSelection(selectedId, type === 'self-defense' || type === 'self-magic-defense' ? { type, coordinate: unit.coordinate } : undefined); if (type !== 'self-defense' && type !== 'self-magic-defense') options.renderMatch(match); }); panel.append(button);
      }
    }
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel selection'; cancel.addEventListener('click', options.clearSelection); if (!match.pendingResolution) panel.append(cancel);
    const pending = options.pendingAction();
    if (pending?.type === 'upgrade' && pending.coordinate) {
      const upgrades = legal.filter(action => action.type === 'upgrade' && action.coordinate === pending.coordinate && action.ability);
      if (upgrades.length) { message.textContent = 'Choose the recipient ability to upgrade.'; for (const upgrade of upgrades) { const button = document.createElement('button'); button.type = 'button'; button.textContent = actionLabel(upgrade.ability as GameActionType); button.classList.toggle('active-action', pending.ability === upgrade.ability); button.addEventListener('click', () => { options.setPendingAction({ ...upgrade }); render(match, local); }); panel.append(button); } }
    }
    if (options.pushChoices().length > 1) { const choices = options.pushChoices(); const verb = choices[0]?.type === 'push' ? 'Push' : 'Pull'; message.textContent = `Choose which object to ${verb.toLowerCase()}.`; for (const choice of choices) { const target = match.units.find(unit => unit.id === choice.targetUnitId); const troop = target ? options.troop(target.troopId, target.owner, target) : undefined; const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.targetBomb ? `${verb} Bomb` : `${verb} ${troop ? troopDisplayName(troop) : target?.troopId ?? 'troop'}`; button.addEventListener('click', () => { options.setPendingAction({ ...choice }); options.clearPushChoices(); render(match, local); options.renderMatch(match); }); panel.append(button); } }
    if (options.pendingAction()) { const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm action'; confirm.addEventListener('click', options.confirm); panel.append(confirm); }
  };
  return render;
}
