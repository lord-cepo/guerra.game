import assert from 'node:assert/strict';
import test from 'node:test';
import { curvedTrajectory, unwrappedTrajectoryAngles } from '../dist/client/board-animation-geometry.js';

test('curved trajectories preserve their exact endpoints', () => {
  const trajectory = curvedTrajectory({ x: 10, y: 20 }, { x: 90, y: 60 }, 30);
  assert.deepEqual(trajectory.pointAt(0), trajectory.start);
  assert.deepEqual(trajectory.pointAt(1), trajectory.end);
  assert.match(trajectory.pathData, /^M /);
});

test('parallel projectile lanes retain their perpendicular offset', () => {
  const trajectory = curvedTrajectory({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 7);
  assert.deepEqual(trajectory.start, { x: 0, y: 7 });
  assert.deepEqual(trajectory.end, { x: 100, y: 7 });
});

test('sampled tangent angles stay continuous across 180 degrees', () => {
  const angles = unwrappedTrajectoryAngles(curvedTrajectory({ x: 100, y: 0 }, { x: 0, y: 0 }, 50), 25);
  for (let index = 1; index < angles.length; index += 1) {
    assert.ok(Math.abs(angles[index] - angles[index - 1]) <= 180);
  }
});
