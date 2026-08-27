export interface Point {
  x: number;
  y: number;
}

export interface QuadraticTrajectory {
  start: Point;
  control: Point;
  end: Point;
  pathData: string;
  pointAt: (progress: number) => Point;
  angleAt: (progress: number) => number;
}

/** Shared curved-flight geometry for board projectiles and shield delivery. */
export function curvedTrajectory(start: Point, end: Point, arcHeight: number, parallelOffset = 0): QuadraticTrajectory {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const laneStart = { x: start.x + normal.x * parallelOffset, y: start.y + normal.y * parallelOffset };
  const laneEnd = { x: end.x + normal.x * parallelOffset, y: end.y + normal.y * parallelOffset };
  const control = {
    x: (laneStart.x + laneEnd.x) / 2,
    y: (laneStart.y + laneEnd.y) / 2 - arcHeight,
  };
  const pointAt = (progress: number): Point => {
    const inverse = 1 - progress;
    return {
      x: inverse * inverse * laneStart.x + 2 * inverse * progress * control.x + progress * progress * laneEnd.x,
      y: inverse * inverse * laneStart.y + 2 * inverse * progress * control.y + progress * progress * laneEnd.y,
    };
  };
  const angleAt = (progress: number): number => {
    const tangentX = 2 * (1 - progress) * (control.x - laneStart.x) + 2 * progress * (laneEnd.x - control.x);
    const tangentY = 2 * (1 - progress) * (control.y - laneStart.y) + 2 * progress * (laneEnd.y - control.y);
    return Math.atan2(tangentY, tangentX) * 180 / Math.PI;
  };
  return {
    start: laneStart,
    control,
    end: laneEnd,
    pathData: `M ${laneStart.x} ${laneStart.y} Q ${control.x} ${control.y} ${laneEnd.x} ${laneEnd.y}`,
    pointAt,
    angleAt,
  };
}

/** Keep sampled tangent angles continuous across atan2's -180/180 boundary. */
export function unwrappedTrajectoryAngles(trajectory: QuadraticTrajectory, sampleCount: number): number[] {
  const angles: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    let angle = trajectory.angleAt(index / (sampleCount - 1));
    const previous = angles.at(-1);
    if (previous !== undefined) {
      while (angle - previous > 180) angle -= 360;
      while (angle - previous < -180) angle += 360;
    }
    angles.push(angle);
  }
  return angles;
}
