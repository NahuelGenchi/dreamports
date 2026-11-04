// The camera, rewritten from 0x0804F9.. UpdateCamera (camera.c): it follows the character in charge, a little behind.

const W = 240, H = 160;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const IN_AIR = 0x4;

/** Task_8051688 (0x08051684), then UpdateCamera, once a frame. */
export function updateCamera(t) {
  const stage = t.data, cam = stage.camera, p = stage.players[stage.playerIndex];
  if (!p || (p.moveState & 0x80000100) === 0x100) return;
  let x = cam.x, y = cam.y;
  cam.dx = x;
  cam.dy = y;
  cam.shiftX = p.qCamOffsetX >> 4;
  cam.shiftY = p.qCamOffsetY >> 4;
  x = clamp(x, cam.minX, cam.maxX - (W + 1));
  y = clamp(y, cam.minY, cam.maxY - (H + 1));
  if (cam.unk40 !== 0) cam.unk40--;
  else {
    const speedX = (p.qSpeedAirX << 16) >> 16;
    cam.unk10 = (p.qWorldX >> 8) + cam.shiftX - W / 2;
    cam.unk56 = (speedX + cam.unk56 * 15) >> 4;
    cam.unk10 += cam.unk56 >> 5;
    let unk64 = cam.unk64;
    const target = p.spriteOffsetY - 4;
    if (unk64 !== target) {
      unk64 = unk64 < target ? Math.min(unk64 + 5, target) : Math.max(unk64 - 5, target);
      cam.unk64 = unk64;
    }
    cam.unk14 = (p.qWorldY >> 8) + cam.shiftY - H / 2 + unk64;
    const dx = cam.unk10 - x;
    if (dx > cam.unk44) x += Math.min(cam.qUnk8 >> 8, dx - cam.unk44);
    else if (dx < -cam.unk44) x += Math.max(-(cam.qUnk8 >> 8), dx + cam.unk44);
    x = clamp(x, cam.minX, cam.maxX - W);
    if (cam.qUnk8 < 0x1000) cam.qUnk8 += 0x20;
    cam.unk48 = p.moveState & IN_AIR ? Math.min(cam.unk48 + 4, 24) : Math.max(cam.unk48 - 4, 0);
    const dy = cam.unk14 - y;
    if (dy > cam.unk48) y += Math.min(cam.unkC, dy - cam.unk48);
    else if (dy < -cam.unk48) y += Math.max(-cam.unkC, dy + cam.unk48);
    y = clamp(y, cam.minY, cam.maxY - H);
  }
  x = clamp(x, cam.minX, cam.maxX - W);
  y = clamp(y, cam.minY, cam.maxY - H);
  cam.x = x;
  cam.y = y;
  cam.dx -= x;
  cam.dy -= y;
}
