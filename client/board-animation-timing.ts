export const projectileTravelDuration = 1050;
export const deploymentAnimationDuration = 1400;
export const pushAnimationDuration = 780;
export const movementAnimationDuration = 800;
export const projectileImpactDuration = 350;
export const projectileRepeatBuffer = 1000;
export const projectileCycleDuration = projectileTravelDuration + projectileImpactDuration + projectileRepeatBuffer;
export const projectileMaterializeFraction = .18;
export const projectileTrailLifetime = 500;
export const projectileTrailSegments = 8;
export const shieldFrameDuration = 150;
export const shieldAnimationSize = 68;
export const damageResolutionDuration = 1500;
export const bombExplosionDuration = 900;
export const bombExplosionSize = 120;
export const deathAnimationDuration = 1100;
export const stunAnimationDuration = 900;

export function projectileMaterializationOpacity(progress: number): number {
  return Math.min(1, progress / projectileMaterializeFraction);
}
