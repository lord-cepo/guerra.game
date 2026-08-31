import { curvedTrajectory, type Point, type QuadraticTrajectory } from './board-animation-geometry.js';
import { projectileCycleDuration, projectileImpactDuration, projectileMaterializationOpacity, projectileTrailLifetime, projectileTrailSegments, projectileTravelDuration, shieldAnimationSize, shieldFrameDuration, stunAnimationDuration } from './board-animation-timing.js';
import { svgNamespace } from './board-geometry.js';

const shieldFrameUrls = Array.from({ length: 7 }, (_, index) => `./assets/shield-${index}.png`);
export const shieldFrameCount = shieldFrameUrls.length;
const shieldFlightSize = shieldAnimationSize * .5;
export const modifierGainAnimationDuration = 700;

export function appendProjectileTrail(board: SVGSVGElement, trajectory: QuadraticTrajectory, iterations = Infinity, phaseDelay = 0): void {
  for (let index = 0; index < projectileTrailSegments; index += 1) {
    const startProgress = index / projectileTrailSegments; const endProgress = (index + 1) / projectileTrailSegments; const progress = (startProgress + endProgress) / 2;
    const start = trajectory.pointAt(startProgress); const end = trajectory.pointAt(endProgress); const middle = trajectory.pointAt(progress);
    const width = Math.hypot(end.x - start.x, end.y - start.y) + 3;
    const trace = document.createElementNS(svgNamespace, 'image'); trace.dataset.serverRender = 'projectile'; trace.classList.add('projectile-trail-segment');
    trace.setAttribute('href', './assets/trail.png'); trace.setAttribute('x', String(-width / 2)); trace.setAttribute('y', '-4.5'); trace.setAttribute('width', String(width)); trace.setAttribute('height', '9'); trace.setAttribute('preserveAspectRatio', 'none');
    trace.setAttribute('transform', `translate(${middle.x} ${middle.y}) rotate(${trajectory.angleAt(progress)})`); board.append(trace);
    trace.animate([{ opacity: .78, offset: 0 }, { opacity: 0, offset: projectileTrailLifetime / projectileCycleDuration }, { opacity: 0, offset: 1 }],
      { duration: projectileCycleDuration, delay: endProgress * projectileTravelDuration + phaseDelay, iterations });
  }
}

export function appendShieldFrameSequence(board: SVGSVGElement, target: Point, delay = 0, magic = false): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const indexes = reduced ? [3] : Array.from({ length: shieldFrameCount }, (_, index) => index);
  for (const [sequenceIndex, frameIndex] of indexes.entries()) {
    const frame = document.createElementNS(svgNamespace, 'image'); frame.dataset.serverRender = 'shield-animation'; frame.classList.add('shield-animation-frame'); if (magic) frame.classList.add('magic-shield-animation');
    frame.setAttribute('href', shieldFrameUrls[frameIndex]); frame.setAttribute('x', String(target.x - shieldAnimationSize / 2)); frame.setAttribute('y', String(target.y - shieldAnimationSize / 2)); frame.setAttribute('width', String(shieldAnimationSize)); frame.setAttribute('height', String(shieldAnimationSize)); board.append(frame);
    const frameDelay = delay + sequenceIndex * shieldFrameDuration; const duration = reduced ? 450 : shieldFrameDuration;
    window.setTimeout(() => { frame.style.opacity = '1'; }, frameDelay); window.setTimeout(() => { frame.style.opacity = '0'; }, frameDelay + duration);
  }
}

/** Present a non-continuous modifier gain without implying that a Shield was used. */
export function appendModifierGain(board: SVGSVGElement, target: Point, delay = 0, magic = false): void {
  const image = document.createElementNS(svgNamespace, 'image');
  image.dataset.serverRender = 'modifier-animation';
  image.classList.add('modifier-gain-animation');
  image.setAttribute('href', './assets/upgrade.png');
  const size = 54;
  image.setAttribute('x', String(target.x - size / 2));
  image.setAttribute('y', String(target.y - size / 2));
  image.setAttribute('width', String(size));
  image.setAttribute('height', String(size));
  if (!magic) image.style.filter = 'grayscale(1)';
  board.append(image);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    image.animate([{ opacity: 0 }, { opacity: .8 }, { opacity: 0 }], { duration: 450, delay, fill: 'forwards' });
    return;
  }
  image.animate([
    { opacity: 0, clipPath: 'inset(100% 0 0 0)', offset: 0 },
    { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: .62 },
    { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: .76 },
    { opacity: 0, clipPath: 'inset(0 0 0 0)', offset: 1 },
  ], { duration: modifierGainAnimationDuration, delay, easing: 'ease-out', fill: 'forwards' });
}

export function appendFlyingShield(board: SVGSVGElement, source: Point, target: Point, magic = false): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { appendShieldFrameSequence(board, target, 0, magic); return; }
  const trajectory = curvedTrajectory(source, target, Math.max(36, Math.hypot(target.x - source.x, target.y - source.y) * .28)); appendProjectileTrail(board, trajectory);
  const moving = document.createElementNS(svgNamespace, 'g'); moving.dataset.serverRender = 'shield-animation';
  const shield = document.createElementNS(svgNamespace, 'image'); shield.classList.add('shield-flight'); if (magic) shield.classList.add('magic-shield-animation');
  shield.setAttribute('href', './assets/shield-3.png'); shield.setAttribute('x', String(target.x - shieldFlightSize / 2)); shield.setAttribute('y', String(target.y - shieldFlightSize / 2)); shield.setAttribute('width', String(shieldFlightSize)); shield.setAttribute('height', String(shieldFlightSize)); moving.append(shield); board.append(moving);
  const frames: Keyframe[] = Array.from({ length: 24 }, (_, index) => { const progress = index / 24; const point = trajectory.pointAt(progress); return { translate: `${point.x - target.x}px ${point.y - target.y}px`, opacity: projectileMaterializationOpacity(progress), offset: progress }; });
  frames.push({ translate: '0px 0px', opacity: 0, offset: 1 }); moving.animate(frames, { duration: projectileTravelDuration, easing: 'linear', fill: 'forwards' }); appendShieldFrameSequence(board, target, projectileTravelDuration, magic);
}

export function appendStunImage(board: SVGSVGElement, target: Point, elapsed = 0): void {
  const image = document.createElementNS(svgNamespace, 'image'); image.dataset.serverRender = 'stun-animation'; image.classList.add('stun-animation'); image.setAttribute('href', './assets/stun.png');
  const size = 90; image.setAttribute('x', String(target.x - size / 2)); image.setAttribute('y', String(target.y - size / 2)); image.setAttribute('width', String(size)); image.setAttribute('height', String(size)); image.style.transformBox = 'fill-box'; image.style.transformOrigin = 'center';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) image.style.opacity = '.8'; else image.animate([
    { opacity: 0, transform: 'rotate(0deg)', offset: 0 }, { opacity: 1, transform: 'rotate(72deg)', offset: .2 },
    { opacity: 1, transform: 'rotate(288deg)', offset: .8 }, { opacity: 0, transform: 'rotate(360deg)', offset: 1 },
  ], { duration: stunAnimationDuration, delay: -elapsed, easing: 'linear', fill: 'both' }); board.append(image);
}

const heartEmoji = '\u2764\uFE0F';

export function appendMendingFlight(board: SVGSVGElement, source: Point, target: Point, mode: 'repeat' | 'once', playSweep: boolean): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const trajectory = curvedTrajectory(source, target, Math.max(36, Math.hypot(target.x - source.x, target.y - source.y) * .28)); if (!reduced) appendProjectileTrail(board, trajectory, mode === 'once' ? 1 : Infinity);
  const heart = document.createElementNS(svgNamespace, 'text'); heart.dataset.serverRender = 'mending-animation'; heart.classList.add('mending-flight-heart'); heart.setAttribute('x', '0'); heart.setAttribute('y', '0'); heart.setAttribute('transform', `translate(${trajectory.end.x} ${trajectory.end.y})`); heart.textContent = heartEmoji; board.append(heart);
  if (reduced) heart.style.opacity = '.7'; else {
    const travel = projectileTravelDuration / projectileCycleDuration; const impact = (projectileTravelDuration + projectileImpactDuration) / projectileCycleDuration;
    const frames: Keyframe[] = Array.from({ length: 25 }, (_, index) => { const progress = index / 24; const point = trajectory.pointAt(progress); return { translate: `${point.x - trajectory.end.x}px ${point.y - trajectory.end.y}px`, opacity: projectileMaterializationOpacity(progress), offset: progress * travel }; });
    frames.push({ translate: '0px 0px', opacity: 0, offset: impact }, { translate: '0px 0px', opacity: 0, offset: 1 }); heart.animate(frames, { duration: projectileCycleDuration, iterations: mode === 'once' ? 1 : Infinity, easing: 'linear', fill: mode === 'once' ? 'forwards' : 'none' });
  }
  if (playSweep) { const sweep = document.createElementNS(svgNamespace, 'text'); sweep.dataset.serverRender = 'mending-animation'; sweep.classList.add('mending-resolution-heart'); sweep.setAttribute('x', String(target.x)); sweep.setAttribute('y', String(target.y - 9)); sweep.style.animationDelay = `${reduced ? 0 : projectileTravelDuration}ms`; sweep.textContent = heartEmoji; board.append(sweep); }
}
