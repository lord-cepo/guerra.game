import type { Coordinate } from '../game/board.js';
import type { Point } from './board-animation-geometry.js';
import { bombExplosionSize, damageResolutionDuration, deathAnimationDuration, projectileTravelDuration } from './board-animation-timing.js';
import { boardDescriptionLineHeight, boardDescriptionLineY, signedModifier } from './board-descriptions.js';
import { hexPoints, svgNamespace as ns } from './board-geometry.js';
import { serverProjectileKey } from './board-projectiles.js';
import type { EffectsRendererContext } from './board-effects-renderer.js';
import type { ServerEffectState, ServerMatchState, ServerUnitState } from './protocol.js';
import { actionOfType } from './troop-view.js';

interface BoardResolutionEffectsContext {
  effects: EffectsRendererContext;
  appendBombDamageLabel(parent: SVGElement, centre: Point, damage: number, pierce?: boolean): SVGTextElement;
  bombIconCentre(position: Point): Point;
  positionBombIcon(image: SVGImageElement, centre: Point): void;
  switchBombIconOnArrival(marker: SVGImageElement, key: string, lit: boolean): SVGImageElement | undefined;
}

export function createBoardResolutionEffects(context: BoardResolutionEffectsContext) {
  const state = context.effects.state;
  const { appendBombDamageLabel, bombIconCentre, positionBombIcon, switchBombIconOnArrival } = context;
function appendPhysicalDamageModifiers(match: ServerMatchState): void {
  const targets: Array<{ key: string; coordinate: Coordinate; target: ServerUnitState }> = [];
  if (state.serverPendingAction?.type === 'attack' && state.serverPendingAction.coordinate && state.localMatchPlayer) {
    const source = match.units.find(unit => unit.owner === state.localMatchPlayer && unit.troopId === state.serverPendingAction?.troopId);
    const target = state.serverPendingAction.targetUnitId
      ? match.units.find(unit => unit.id === state.serverPendingAction?.targetUnitId)
      : match.units.find(unit => unit.coordinate === state.serverPendingAction?.coordinate && unit.owner !== state.localMatchPlayer);
    const sourceTroop = source ? context.effects.serverTroop(source.troopId, source.owner) : undefined;
    if (source && target && !actionOfType(sourceTroop!, 'attack')?.qualifiers?.includes('pierce')) targets.push({
      key: serverProjectileKey(state.localMatchPlayer, source.id, 'attack', state.serverPendingAction.coordinate),
      coordinate: state.serverPendingAction.coordinate,
      target,
    });
  }
  for (const effect of match.effects) {
    if (effect.kind !== 'attack' && effect.kind !== 'gore') continue;
    if (effect.pierce) continue;
    const sourceId = effect.sourceUnitId ?? `${effect.owner}:${effect.sourceTroopId}`;
    const target = effect.targetUnitId
      ? match.units.find(unit => unit.id === effect.targetUnitId)
      : match.units.find(unit => unit.coordinate === effect.target && unit.owner !== effect.owner);
    const targetBash = target ? match.bashes.find(bash => (bash.attackerId === target.id || bash.defenderId === target.id)
      && !context.effects.serverBashIsDodged(bash, match)) : undefined;
    const displayedCoordinate = targetBash?.target ?? target?.coordinate;
    if (displayedCoordinate !== effect.target) continue;
    if (target) targets.push({
      key: serverProjectileKey(effect.owner, sourceId, 'attack', effect.target),
      coordinate: effect.target,
      target,
    });
  }
  const activeKeys = new Set(targets.map(target => target.key));
  for (const key of state.physicalModifierArrivalTimes.keys()) if (!activeKeys.has(key)) state.physicalModifierArrivalTimes.delete(key);
  for (const { key, coordinate, target } of [...new Map(targets.map(item => [item.key, item])).values()]) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    let arrivalTime = state.physicalModifierArrivalTimes.get(key);
    if (arrivalTime === undefined) {
      arrivalTime = performance.now() + projectileTravelDuration;
      state.physicalModifierArrivalTimes.set(key, arrivalTime);
    }
    const bash = match.bashes.find(candidate => candidate.target === coordinate && !context.effects.serverBashIsDodged(candidate, match));
    const x = cell.position.x + (bash ? (context.effects.serverBashScreenSide(target) === 'left' ? -18 : 18) : 0);
    const label = document.createElementNS(ns, 'text');
    label.dataset.serverRender = 'physical-modifier';
    label.classList.add('bash-stat', 'bash-modifier', target.owner === 1 ? 'player-one-bash' : 'player-two-bash');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
    const modifier = context.effects.serverModifier(target, coordinate, bash);
    label.textContent = `${modifier >= 0 ? '+' : ''}${modifier}`;
    const remaining = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.max(0, arrivalTime - performance.now());
    if (remaining > 0) {
      label.classList.add('physical-modifier-awaiting-impact');
      window.setTimeout(() => label.classList.remove('physical-modifier-awaiting-impact'), remaining);
    }
    context.effects.board.append(label);
  }
}

function appendDamageResolutionAnimations(): void {
  for (const animation of state.damageResolutionAnimations) {
    const cell = state.cellsByCoordinate.get(animation.coordinate);
    if (!cell) continue;
    let deathCard: SVGGElement | undefined;
    let skull: SVGImageElement | undefined;
    if (animation.killed) {
      const troop = context.effects.serverTroop(animation.troopId, animation.owner);
      if (troop) {
        deathCard = context.effects.boardCardMarker(troop, cell.position, cell.cell.dataset.clipId);
        deathCard.dataset.serverRender = 'death-animation';
        deathCard.classList.add('board-troop', 'death-resolution-card');
        cell.cell.append(deathCard);
        const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
        if (artwork) cell.cell.append(artwork);
      }
      skull = document.createElementNS(ns, 'image');
      skull.dataset.serverRender = 'death-animation';
      skull.classList.add('death-resolution-skull');
      skull.setAttribute('href', './assets/skull.png');
      skull.setAttribute('x', String(cell.position.x - 34));
      skull.setAttribute('y', String(cell.position.y - 34));
      skull.setAttribute('width', '68');
      skull.setAttribute('height', '68');
      skull.style.animationDelay = `${animation.delay + damageResolutionDuration}ms`;
      // Death belongs to the impacted hex, not to the authoritative unit node
      // that disappears in the same revision. Ordinary selection/hover
      // rerenders therefore leave the retained card and skull intact.
      cell.cell.append(skull);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        deathCard?.animate([
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: .55 },
          { opacity: 0, offset: 1 },
        ], {
          duration: deathAnimationDuration,
          delay: animation.delay + damageResolutionDuration,
          easing: 'ease-in-out',
          fill: 'forwards',
        });
      }
    }
    // Hide the already-updated authoritative row immediately. Delayed
    // presentations (Bomb explosion or replayed projectile flight) keep the
    // old value visible until their slash actually begins.
    cell.cell.classList.add('damage-resolving');
    const slash = document.createElementNS(ns, 'image');
    slash.dataset.serverRender = 'damage-resolution';
    slash.classList.add('damage-resolution-slash');
    slash.style.animationDelay = `${animation.delay}ms`;
    slash.setAttribute('href', './assets/slash.png');
    slash.setAttribute('x', String(cell.position.x - 34));
    slash.setAttribute('y', String(cell.position.y - 43));
    slash.setAttribute('width', '68');
    slash.setAttribute('height', '68');
    context.effects.board.append(slash);

    const health = document.createElementNS(ns, 'text');
    health.dataset.serverRender = 'damage-resolution';
    health.classList.add('bash-stat', 'damage-resolution-health', animation.owner === 1 ? 'player-one-health' : 'player-two-health');
    const healthX = cell.position.x + (animation.bashSide === 'left' ? -18 : animation.bashSide === 'right' ? 18 : 0);
    health.setAttribute('x', String(healthX));
    health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
    const healthText = (actual: number): string => animation.bashSide
      ? `♥ ${actual}`
      : `${actual} ♥ ${animation.totalHealth}`;
    health.textContent = healthText(animation.oldHealth);
    const bashHealth = [...cell.cell.querySelectorAll<SVGTextElement>('.bash-health')]
      .find(label => label.dataset.unitId === animation.targetId);
    if (bashHealth) bashHealth.style.opacity = '0';
    context.effects.board.append(health);

    let modifier: SVGTextElement | undefined;
    if (animation.includesPhysical && !animation.ignoresModifier) {
      modifier = document.createElementNS(ns, 'text');
      modifier.dataset.serverRender = 'damage-resolution';
      modifier.classList.add('bash-stat', 'bash-modifier', animation.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(healthX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(animation.oldModifier);
      context.effects.board.append(modifier);
      const absorbed = Math.min(Math.max(0, animation.oldModifier), animation.physicalDamage);
      for (let step = 1; step <= 4; step += 1) window.setTimeout(() => {
        if (modifier) modifier.textContent = signedModifier(Math.round(animation.oldModifier - absorbed * step / 4));
      }, animation.delay + step * 120);
    }
    const healthLoss = Math.max(0, animation.oldHealth - animation.newHealth);
    const healthCountdownStart = animation.includesPhysical ? 600 : 120;
    for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
      const actual = Math.round(animation.oldHealth - healthLoss * step / 5);
      health.textContent = healthText(actual);
    }, animation.delay + healthCountdownStart + step * 150);
    window.setTimeout(() => {
      slash.remove();
      modifier?.remove();
      if (animation.killed) {
        cell.cell.classList.remove('damage-resolving');
        health.remove();
      } else {
        // Keep the final authoritative value mounted until the next ordinary
        // board render. Relying on the underlying row alone can leave a blank
        // stat area after replay/resolution until hover causes another render.
        health.textContent = healthText(animation.newHealth);
        health.style.opacity = '1';
      }
    }, animation.delay + damageResolutionDuration);
    if (animation.killed) window.setTimeout(() => {
      deathCard?.remove();
      skull?.remove();
    }, animation.delay + damageResolutionDuration + deathAnimationDuration);
  }
}

function appendBombExplosionAnimations(): void {
  for (const coordinate of state.explosionAffectedCoordinates) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const highlight = document.createElementNS(ns, 'polygon');
    highlight.dataset.serverRender = 'bomb-explosion';
    highlight.classList.add('bomb-explosion', 'bomb-explosion-highlight');
    highlight.style.animationDelay = `${state.explosionResolutionDelay}ms`;
    highlight.setAttribute('points', hexPoints(cell.position.x, cell.position.y));
    context.effects.board.append(highlight);
  }
  for (const coordinate of state.explosionResolutionCoordinates) {
    const cell = state.cellsByCoordinate.get(coordinate);
    if (!cell) continue;
    const explosion = document.createElementNS(ns, 'image');
    explosion.dataset.serverRender = 'bomb-explosion';
    explosion.classList.add('bomb-explosion');
    explosion.style.animationDelay = `${state.explosionResolutionDelay}ms`;
    explosion.setAttribute('href', './assets/explosion-purple.png');
    explosion.setAttribute('x', String(cell.position.x - bombExplosionSize / 2));
    explosion.setAttribute('y', String(cell.position.y - bombExplosionSize / 2 - 20));
    explosion.setAttribute('width', String(bombExplosionSize));
    explosion.setAttribute('height', String(bombExplosionSize));
    context.effects.board.append(explosion);
  }
}

function appendBashResolutionAnimations(match: ServerMatchState): void {
  for (const animation of state.bashResolutionAnimations) {
    const cell = state.cellsByCoordinate.get(animation.bash.target);
    if (!cell) continue;
    cell.cell.classList.add('bash-resolving');
    const units = [animation.attacker, animation.defender].sort((left, right) => right.owner - left.owner);
    const firstStrike = animation.firstStrike;
    const firstStrikeTarget = firstStrike ? [animation.attacker, animation.defender].find(unit => unit.id === firstStrike.targetId) : undefined;
    const firstStrikeTargetSurvives = Boolean(firstStrike?.targetSurvived && firstStrikeTarget);
    const combatDuration = firstStrike
      ? damageResolutionDuration * (firstStrikeTargetSurvives ? 2 : 1)
      : damageResolutionDuration;
    const sliderStart = animation.delay + combatDuration;
    const sideOf = (unit: ServerUnitState): 'left' | 'right' => unit.owner === 2 ? 'left' : 'right';
    const appendSlash = (unit: ServerUnitState | undefined, delay: number): void => {
      const slash = document.createElementNS(ns, 'image');
      slash.dataset.serverRender = 'bash-resolution';
      slash.classList.add('damage-resolution-slash');
      slash.style.animationDelay = `${delay}ms`;
      slash.setAttribute('href', './assets/slash.png');
      const side = unit ? sideOf(unit) : undefined;
      slash.setAttribute('x', String(cell.position.x + (side === 'left' ? -18 : side === 'right' ? 18 : 0) - 34));
      slash.setAttribute('y', String(cell.position.y - 43));
      slash.setAttribute('width', '68');
      slash.setAttribute('height', '68');
      context.effects.board.append(slash);
    };
    if (firstStrike) {
      appendSlash(firstStrikeTarget, animation.delay);
      if (firstStrikeTargetSurvives) {
        const firstStrikeUnit = units.find(unit => unit.id === firstStrike.unitId);
        appendSlash(firstStrikeUnit, animation.delay + damageResolutionDuration);
      }
    } else appendSlash(undefined, animation.delay);
    for (const [index, unit] of units.entries()) {
      const side = index === 0 ? 'left' : 'right';
      const troop = context.effects.serverTroop(unit.troopId, unit.owner, unit);
      if (!troop) continue;
      const picture = context.effects.boardCardMarker(troop, cell.position);
      picture.dataset.serverRender = 'bash-resolution';
      picture.classList.add('board-troop', 'bash-troop-picture', side === 'left' ? 'bash-left-picture' : 'bash-right-picture');
      cell.cell.append(picture);
      const statX = cell.position.x + (side === 'left' ? -18 : 18);
      const ui = document.createElementNS(ns, 'g');
      ui.dataset.serverRender = 'bash-resolution';
      const health = document.createElementNS(ns, 'text');
      health.classList.add('bash-stat', 'bash-health', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      health.setAttribute('x', String(statX));
      health.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0)));
      health.textContent = `♥ ${unit.currentHealth}`;
      const modifier = document.createElementNS(ns, 'text');
      modifier.classList.add('bash-stat', 'bash-modifier', unit.owner === 1 ? 'player-one-bash' : 'player-two-bash');
      modifier.setAttribute('x', String(statX));
      modifier.setAttribute('y', String(boardDescriptionLineY(cell.position, 2, 0) + boardDescriptionLineHeight));
      modifier.textContent = signedModifier(unit.combat.modifier);
      ui.append(health, modifier);
      cell.cell.append(ui);
      const won = animation.continues || unit.id === animation.winnerId;
      const finalClip = won ? 'inset(0)' : side === 'left' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
      picture.animate([{ clipPath: getComputedStyle(picture).clipPath }, { clipPath: finalClip, opacity: won ? 1 : 0 }], {
        duration: 420,
        delay: sliderStart,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      ui.animate([
        { opacity: 1, translate: '0 0' },
        { opacity: won ? 1 : 0, translate: won ? `${side === 'left' ? 18 : -18}px 0` : '0 0' },
      ], { duration: 420, delay: sliderStart, easing: 'ease-in-out', fill: 'forwards' });
      const nextUnit = match.units.find(candidate => candidate.id === unit.id);
      const finalHealth = nextUnit?.currentHealth ?? 0;
      const isFirstStrikeTarget = firstStrike?.targetId === unit.id;
      const isFirstStrikeUnit = firstStrike?.unitId === unit.id;
      const firstStrikeTargetHealth = firstStrikeTarget && isFirstStrikeTarget
        ? Math.max(0, unit.currentHealth - firstStrike.firstDamage)
        : undefined;
      const healthStart = isFirstStrikeUnit && firstStrikeTargetSurvives
        ? animation.delay + damageResolutionDuration
        : animation.delay;
      const healthEnd = isFirstStrikeTarget && firstStrikeTargetHealth !== undefined && firstStrikeTargetSurvives
        ? firstStrikeTargetHealth
        : finalHealth;
      for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
        const actual = Math.round(unit.currentHealth - (unit.currentHealth - healthEnd) * step / 5);
        health.textContent = `♥ ${actual}`;
      }, healthStart + 600 + step * 150);
      if (isFirstStrikeTarget && firstStrikeTargetSurvives) {
        for (let step = 1; step <= 5; step += 1) window.setTimeout(() => {
          const actual = Math.round((firstStrikeTargetHealth ?? unit.currentHealth) - ((firstStrikeTargetHealth ?? unit.currentHealth) - finalHealth) * step / 5);
          health.textContent = `♥ ${actual}`;
        }, animation.delay + damageResolutionDuration + 600 + step * 150);
      }
      window.setTimeout(() => modifier.remove(), sliderStart);
      window.setTimeout(() => {
        cell.cell.classList.remove('bash-resolving');
        picture.remove();
        ui.remove();
      }, sliderStart + 430);
    }
    const artwork = cell.cell.querySelector<SVGImageElement>('.board-hex-artwork');
    if (artwork) cell.cell.append(artwork);
  }
}

/** Unlit bombs coexist with units beside the same vertex used by the preview. */
function appendServerBombs(match: ServerMatchState): void {
  const preview = state.serverPendingAction?.type === 'magic' ? state.serverPendingAction : undefined;
  const latest = match.events?.at(-1);
  const pendingPush = (state.serverPendingAction?.type === 'push' || state.serverPendingAction?.type === 'pull') && state.serverPendingAction.targetBomb ? state.serverPendingAction : undefined;
  const confirmedPush = state.confirmedMovementAnimationRevision === match.revision
    && (latest?.action.type === 'push' || latest?.action.type === 'pull') && latest.action.targetBomb ? latest.action : undefined;
  const bombPush = pendingPush ?? confirmedPush;
  const pushOrigin = pendingPush?.coordinate ?? (confirmedPush ? latest?.origin : undefined);
  const pushDestination = bombPush?.destination;
  const sourceBomb = pendingPush && pushOrigin ? match.bombs?.find(bomb => bomb.coordinate === pushOrigin) : undefined;
  const landingBomb = pendingPush && pushDestination ? match.bombs?.find(bomb => bomb.coordinate === pushDestination) : undefined;
  const displayedBombs = sourceBomb && pushDestination
    ? [
        ...(match.bombs ?? []).filter(bomb => bomb !== sourceBomb && bomb !== landingBomb),
        { ...(landingBomb ?? sourceBomb), coordinate: pushDestination, damage: sourceBomb.damage + (landingBomb?.damage ?? 0), pierce: (sourceBomb.pierce ?? false) || (landingBomb?.pierce ?? false) },
      ]
    : [...(match.bombs ?? [])];
  const activePreviewKeys = new Set<string>();
  for (const bomb of displayedBombs) {
    const target = state.cellsByCoordinate.get(bomb.coordinate); if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    // Match the endpoint used by the shared Bomb projectile trajectory.
    const centre = bombIconCentre(target.position);
    const ignitionKey = `preview-ignition:${match.id}:${preview?.troopId ?? ''}:${bomb.coordinate}`;
    const previewIgnitesBomb = preview?.coordinate === bomb.coordinate;
    if (previewIgnitesBomb) activePreviewKeys.add(ignitionKey);
    positionBombIcon(marker, centre);
    const litMarker = switchBombIconOnArrival(marker, ignitionKey, previewIgnitesBomb);
    const label = appendBombDamageLabel(target.cell, centre, bomb.damage, bomb.pierce);
    if (pushOrigin && pushDestination === bomb.coordinate) {
      const origin = state.cellsByCoordinate.get(pushOrigin)?.position;
      if (origin) for (const element of [marker, label]) {
        element.classList.add('bomb-push-animation');
        element.style.setProperty('--push-from-x', `${origin.x - target.position.x}px`);
        element.style.setProperty('--push-from-y', `${origin.y - target.position.y}px`);
      }
    }
    const key = serverProjectileKey(bomb.owner, bomb.sourceTroopId, 'bomb', bomb.coordinate);
    const arrivalTime = state.confirmedBombArrivalTimes.get(key);
    const remainingTravel = arrivalTime === undefined || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : Math.max(0, arrivalTime - performance.now());
    if (remainingTravel > 0) {
      marker.classList.add('bomb-awaiting-arrival');
      label.classList.add('bomb-awaiting-arrival');
      window.setTimeout(() => {
        marker.classList.remove('bomb-awaiting-arrival');
        label.classList.remove('bomb-awaiting-arrival');
      }, remainingTravel);
    }
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
  for (const key of state.bombIgnitionArrivalTimes.keys()) {
    if (key.startsWith('preview-ignition:') && !activePreviewKeys.has(key)) state.bombIgnitionArrivalTimes.delete(key);
  }
}

function appendConfirmedIgnitedBomb(match: ServerMatchState): void {
  const latest = match.events?.at(-1);
  const centerEffects = new Map<Coordinate, ServerEffectState>();
  for (const effect of match.effects) {
    if (effect.kind !== 'bomb' || !effect.origin || effect.target !== effect.origin) continue;
    centerEffects.set(effect.origin, effect);
  }
  // Persisted matches created before bomb origins were recorded can still
  // identify a direct Fire Magic ignition from the latest action.
  if (latest?.action.type === 'magic' && latest.action.coordinate && !centerEffects.has(latest.action.coordinate)) {
    const legacyCenter = match.effects.find(effect => effect.kind === 'bomb' && effect.target === latest.action.coordinate);
    if (legacyCenter) centerEffects.set(latest.action.coordinate, legacyCenter);
  }
  for (const [coordinate, effect] of centerEffects) {
    const target = state.cellsByCoordinate.get(coordinate);
    if (!target) continue;
    const marker = document.createElementNS(ns, 'image');
    marker.dataset.serverRender = 'bomb';
    marker.classList.add('bomb-action-icon');
    const centre = bombIconCentre(target.position);
    positionBombIcon(marker, centre);
    const key = `confirmed-ignition:${match.id}:${match.revision}:${coordinate}`;
    const isConfirmedFireIgnition = latest?.action.type === 'magic' && latest.action.coordinate === coordinate;
    const waitsForOpponentPlayback = isConfirmedFireIgnition
      && (state.replayingLastTurn || latest.player !== state.localMatchPlayer)
      && state.bombIgnitionArrivalTimes.has(key);
    let litMarker: SVGImageElement | undefined;
    if (waitsForOpponentPlayback) litMarker = switchBombIconOnArrival(marker, key, true);
    else marker.setAttribute('href', './assets/bomb-light.png');
    appendBombDamageLabel(target.cell, centre, effect.value, effect.pierce);
    target.cell.append(marker, ...(litMarker ? [litMarker] : []));
  }
}
  return {
    appendPhysicalDamageModifiers,
    appendDamageResolutionAnimations,
    appendBombExplosionAnimations,
    appendBashResolutionAnimations,
    appendServerBombs,
    appendConfirmedIgnitedBomb,
  };
}
