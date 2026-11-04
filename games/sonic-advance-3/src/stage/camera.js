// The camera, written from how the original behaves (0x0804FE88, UpdateCamera, which 0x08051684 runs each frame). It keeps
// the character in charge near the middle of the screen: it looks ahead the way they're going, lets them drift off its
// target by a few pixels before it moves, catches up at a limited speed, and never shows past the stage's edges.

const W = 240, H = 160;
const DRIFT_X = 8, MAX_DRIFT_Y = 24, DRIFT_Y_STEP = 4;
const CATCH_UP_X = 16, CATCH_UP_Y = 12;
const FEET_STEP = 5, IN_AIR = 0x4;

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const towards = (from, to, step) => (from < to ? Math.min(from + step, to) : Math.max(from - step, to));

// nothing while `to` is within `drift` of `from`, and then up to `step` pixels nearer, stopping at that drift
function follow(from, to, drift, step) {
  const gap = to - from;
  if (Math.abs(gap) <= drift) return from;
  return from + Math.sign(gap) * Math.min(step, Math.abs(gap) - drift);
}

/** What the camera keeps from frame to frame, other than where it is. */
export const cameraMemory = () => ({ lookAhead: 0, feetOffset: -4, driftY: 0 });

/** A frame of the camera, as a task. */
export function updateCamera(t) {
  const stage = t.data, cam = stage.camera, leader = stage.players[stage.playerIndex];
  const lastX = cam.maxX - W, lastY = cam.maxY - H;

  cam.lookAhead = (((leader.velX << 16) >> 16) + cam.lookAhead * 15) >> 4;   // an average of its speed across the last frames
  cam.feetOffset = towards(cam.feetOffset, leader.halfHeight - 4, FEET_STEP);
  cam.driftY = towards(cam.driftY, leader.flags & IN_AIR ? MAX_DRIFT_Y : 0, DRIFT_Y_STEP);

  const targetX = (leader.x >> 8) - W / 2 + (cam.lookAhead >> 5);
  const targetY = (leader.y >> 8) - H / 2 + cam.feetOffset;
  // it works from a pixel inside the far edges, so it can come back from them
  cam.x = clamp(follow(clamp(cam.x, cam.minX, lastX - 1), targetX, DRIFT_X, CATCH_UP_X), cam.minX, lastX);
  cam.y = clamp(follow(clamp(cam.y, cam.minY, lastY - 1), targetY, cam.driftY, CATCH_UP_Y), cam.minY, lastY);
}
