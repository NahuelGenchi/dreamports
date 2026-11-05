// Bigger pieces the scenes share: reflections, waves, smoke, houses, castles, ships and machines.
import { hex, mix, lighter, deep, dither, cloud } from './kit.mjs';
import { ART } from './sprites.mjs';

export function silhouette(p, name, x, y, c, flip = false) {
  const colour = hex(c);
  p.sprite(x, y, ART[name], new Proxy({}, { get: () => colour }), { flip });
}

// the picture above y0 mirrored below it, rippling, mixed toward the water's colour
export function reflect(p, y0, y1, toward, k, R, wobble = 1) {
  const src = p.d.slice();
  for (let y = y0; y < y1; y++) {
    const dy = y - y0;
    const sy = y0 - 1 - Math.floor(dy * 1.15);
    if (sy < 0) break;
    const shift = Math.round(Math.sin(y * 1.9 + R() * 0.6) * wobble * (0.6 + dy / 8));
    for (let x = 0; x < p.w; x++) {
      const sx = Math.min(p.w - 1, Math.max(0, x + shift));
      const i = (sy * p.w + sx) * 4;
      p.put(x, y, mix([src[i], src[i + 1], src[i + 2]], toward, Math.min(0.9, k + dy * 0.012)));
    }
  }
}

// rolling waves: crests catch the light, troughs fall into shade, whitecaps up close
export function waves(p, T, R, y0, y1, { calm = 0.5, foam = '#ffffff', x0 = 0, x1 = p.w } = {}) {
  const shade = deep(T.water[2], 0.35);
  for (let y = y0 + 1; y < y1; ) {
    const depth = (y - y0) / Math.max(1, y1 - y0);
    const len = 8 + depth * 26;
    const phase = R() * 10;
    const amp = 0.4 + depth * 1.6;
    for (let x = x0; x < x1; x++) {
      const s = Math.sin((x / len) * Math.PI * 2 + phase + Math.sin(x / 37 + phase) * 1.3);
      const yy = y + Math.round(-s * amp * 0.5);
      if (s > 0.45) p.tint(x, yy, T.shine, 0.35 + depth * 0.25);
      if (s > 0.8 + calm * 0.15 && depth > 0.25) p.put(x, yy - 1, T.tone(foam, 0.5));
      if (s < -0.35) p.tint(x, yy + 1, shade, 0.2 + depth * 0.2);
    }
    y += 2 + Math.round(depth * 4);
  }
}

// a puff of smoke or steam, darker underneath
export function smoke(p, T, x, y, w, R, cols = ['#f2f2f2', '#cfcfd6', '#9a9aa8']) {
  cloud(p, T, x, y, w, R, cols.map((c) => T.tone(c, 0.7)));
}

// a little spray of drops
export function splash(p, T, R, x, y, w, h, c = '#ffffff') {
  for (let i = 0; i < w * h * 0.5; i++) {
    const dx = R.range(-w / 2, w / 2);
    const up = (1 - Math.abs(dx) / (w / 2)) * h;
    p.put(x + dx, y - R.range(0, up), T.tone(R.chance(0.7) ? c : '#bfe6ff', 0.4));
  }
}

export function window4(p, x, y, lit, frame) {
  p.rect(x, y, 3, 3, lit);
  p.put(x + 1, y, frame);
  p.put(x + 1, y + 2, frame);
  p.put(x, y + 1, frame);
  p.put(x + 2, y + 1, frame);
  p.put(x + 1, y + 1, frame);
}

// a cottage: lit side and shaded side, a pitched roof, windows that glow after dark
export function house(p, T, R, x, base, w, h, { wall = '#f2e2c4', roof = '#c84a3a', snow = false, chimney = true, lit } = {}) {
  lit ??= T.dark > 0.3;
  x = Math.round(x);
  const wallC = T.tone(wall);
  const wallS = T.tone(deep(wall, 0.2));
  p.rect(x, base - h, w, h, wallC);
  p.rect(x + w - 2, base - h, 2, h, wallS);
  const rh = Math.max(3, Math.round(w * 0.42));
  const cx = x + (w - 1) / 2;
  if (chimney) {
    const chx = x + Math.round(w * 0.7);
    p.rect(chx, base - h - rh + 1, 2, rh - 1, T.tone('#8a4a3a'));
    if (snow) p.rect(chx, base - h - rh + 1, 2, 1, T.tone('#ffffff'));
    if (lit || R.chance(0.6))
      for (let i = 0; i < 6; i++) p.tint(chx + Math.round(Math.sin(i * 1.3) * 1.5 + i * 0.4), base - h - rh - 1 - i * 1.6, T.tone('#e8e8f0', 0.5), 0.55 - i * 0.07);
  }
  for (let i = 0; i <= rh; i++) {
    const half = (i / rh) * (w / 2 + 1);
    const y = base - h - rh + i;
    for (let dx = Math.round(-half); dx <= Math.round(half); dx++) {
      const xx = Math.round(cx + dx);
      let c = dx <= 0 ? T.tone(roof) : T.tone(deep(roof, 0.3));
      if (snow) c = dx <= 0 ? T.tone('#ffffff', 0.7) : T.tone('#c4d4ee', 0.7);
      if (!snow && (y + (dx & 1)) % 3 === 0) c = mix(c, deep(roof, 0.5), 0.35);
      p.put(xx, y, c);
    }
  }
  p.rect(x - 1, base - h, w + 2, 1, snow ? T.tone('#eaf2ff', 0.7) : T.tone(deep(roof, 0.45)));
  const glass = lit ? hex(R.chance(0.85) ? '#ffd26a' : '#ffb84a') : T.tone('#8ccaf2');
  const frame = T.tone(deep(wall, 0.45));
  const rows = h >= 14 ? 2 : 1;
  const cols = Math.max(1, Math.floor((w - 4) / 6));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const wx = x + 2 + c * 6 + Math.round(((w - 4) - cols * 6) / 2) + 1;
      const wy = base - h + 2 + r * 6;
      if (r === rows - 1 && c === Math.floor(cols / 2) && cols > 1) continue;
      const on = !lit || R.chance(0.75);
      window4(p, wx, wy, on ? glass : T.tone('#3a3a5a'), frame);
      if (lit && on) p.glow(wx + 1.5, wy + 1.5, 5, hex('#ffcf70'), 0.25);
    }
  const dx = x + Math.round(w / 2) - 1;
  p.rect(dx, base - 5, 3, 5, T.tone('#7a4a2a'));
  p.put(dx + 2, base - 3, T.tone('#e8c060'));
}

// a stone castle: towers with pointed roofs, battlements, banners
export function castle(p, T, R, x, base, w, h, { roof = '#3a6ad0', banner = '#e84a4a', stone = '#c8c0b4' } = {}) {
  x = Math.round(x);
  const lit = T.tone(stone);
  const sh = T.tone(deep(stone, 0.25));
  const dk = T.tone(deep(stone, 0.5));
  const block = (bx, by, bw, bh) => {
    for (let yy = by; yy < by + bh; yy++)
      for (let xx = bx; xx < bx + bw; xx++) {
        const edge = xx >= bx + bw - Math.max(2, Math.round(bw * 0.3));
        let c = edge ? sh : lit;
        if ((yy - by) % 3 === 2 && dither(xx, yy) < 0.5) c = mix(c, dk, 0.35);
        if ((yy - by) % 3 !== 2 && (xx + Math.floor((yy - by) / 3) * 2) % 5 === 0) c = mix(c, dk, 0.25);
        p.put(xx, yy, c);
      }
    for (let xx = bx; xx < bx + bw; xx += 2) p.put(xx, by - 1, (xx - bx) % 4 === 0 ? lit : null);
  };
  const towerRoof = (tx, ty, tw) => {
    const rh = Math.round(tw * 1.3);
    for (let i = 0; i < rh; i++) {
      const half = ((i + 1) / rh) * (tw / 2 + 1);
      for (let dx = -Math.round(half); dx <= Math.round(half); dx++)
        p.put(tx + tw / 2 + dx - 0.5, ty - rh + i, dx < 0 ? T.tone(roof) : T.tone(deep(roof, 0.35)));
    }
    const fy = ty - rh - 6;
    p.line(tx + tw / 2, fy, tx + tw / 2, ty - rh, T.tone('#5a4a3a'));
    const flagC = T.tone(banner);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3 - (i > 3 ? 1 : 0); j++) p.put(tx + tw / 2 + 1 + i, fy + j + (i > 2 ? 1 : 0) * (i % 2), flagC);
  };
  // the wall
  const wallH = Math.round(h * 0.5);
  block(x, base - wallH, w, wallH);
  // the keep
  const kw = Math.round(w * 0.34);
  const kx = x + Math.round(w * 0.33);
  block(kx, base - Math.round(h * 0.8), kw, Math.round(h * 0.8));
  towerRoof(kx + 2, base - Math.round(h * 0.8), kw - 4);
  // towers at the ends
  const tw = Math.max(7, Math.round(w * 0.16));
  for (const tx of [x - 2, x + w - tw + 2]) {
    block(tx, base - Math.round(h * 0.68), tw, Math.round(h * 0.68));
    towerRoof(tx, base - Math.round(h * 0.68), tw);
  }
  // gate and windows
  const gx = x + Math.round(w / 2) - 3;
  p.rect(gx, base - 8, 7, 8, T.tone('#3a2a22'));
  p.rect(gx + 1, base - 9, 5, 1, T.tone('#3a2a22'));
  for (let i = 0; i < 7; i += 2) p.line(gx + i, base - 8, gx + i, base - 1, T.tone('#6a5a4a'));
  const glass = T.dark > 0.3 ? hex('#ffd06a') : T.tone('#2a2a40');
  for (let i = 0; i < 3; i++) p.rect(kx + 3 + i * Math.round((kw - 6) / 2.5), base - Math.round(h * 0.65), 2, 3, glass);
  // long banners hanging from the wall
  for (let i = 0; i < 2; i++) {
    const bx = x + Math.round(w * (0.18 + i * 0.6));
    p.rect(bx, base - wallH + 1, 4, 9, T.tone(banner));
    p.rect(bx + 1, base - wallH + 3, 2, 4, T.tone('#f2d050'));
    p.put(bx, base - wallH + 10, T.tone(banner));
    p.put(bx + 3, base - wallH + 10, T.tone(banner));
  }
}

// a tall ship with full sails, facing right unless flipped
export function galleon(p, T, R, x, waterY, s, { flip = false, sail = '#f4ecd8', hull = '#7a4a28', flag = '#e84a4a', stripe = '#e2b84a' } = {}) {
  const dir = flip ? -1 : 1;
  const X = (dx) => Math.round(x + dx * dir);
  const len = Math.round(34 * s);
  const hullH = Math.round(7 * s);
  const hullC = T.tone(hull);
  const hullS = T.tone(deep(hull, 0.35));
  // hull: a curved bottom, high at the back
  for (let dx = 0; dx < len; dx++) {
    const t = dx / (len - 1);
    const top = waterY - hullH - (t < 0.25 ? Math.round((0.25 - t) * 12 * s) : 0) - (t > 0.9 ? Math.round((t - 0.9) * 10 * s) : 0);
    const bottom = waterY + Math.round(2 * s) - Math.round(Math.abs(t - 0.5) ** 2 * 6 * s);
    for (let y = top; y <= bottom; y++) {
      let c = y > waterY - hullH * 0.35 ? hullS : hullC;
      if (y === top + Math.round(2 * s)) c = T.tone(stripe);
      p.put(X(dx), y, c);
    }
    if (dx % Math.max(3, Math.round(4 * s)) === 2 && dx > 4 && dx < len - 4 && s > 0.6) p.put(X(dx), top + Math.round(3.5 * s), T.tone('#2a1a12'));
  }
  // bowsprit
  p.line(X(len - 1), waterY - hullH, X(len + 7 * s), waterY - hullH - 5 * s, T.tone('#5a3a20'));
  // masts and sails
  const masts = [0.3, 0.55, 0.8];
  masts.forEach((m, i) => {
    const mx = Math.round(len * m);
    const mh = Math.round((i === 1 ? 34 : 28) * s);
    p.line(X(mx), waterY - hullH, X(mx), waterY - hullH - mh, T.tone('#5a3a20'));
    const sails = 2;
    for (let k = 0; k < sails; k++) {
      const sw = Math.round((10 - k * 2.5) * s);
      const shh = Math.round((9 - k * 2) * s);
      const sy = waterY - hullH - Math.round(5 * s) - k * Math.round(11 * s) - shh;
      for (let yy = 0; yy < shh; yy++)
        for (let dx = -sw / 2; dx <= sw / 2; dx++) {
          const belly = Math.round(Math.sin((yy / shh) * Math.PI) * 1.5 * s);
          const lit = dx < sw / 6;
          p.put(X(mx + dx + belly), sy + yy, T.tone(lit ? sail : deep(sail, 0.18), 0.8));
        }
      p.line(X(mx - sw / 2 - 1), sy, X(mx + sw / 2 + 1), sy, T.tone('#5a3a20'));
    }
    const fy = waterY - hullH - mh;
    for (let j = 0; j < 4; j++) p.put(X(mx + 1 + j), fy + (j % 2), T.tone(flag));
    p.put(X(mx + 1), fy + 1, T.tone(flag));
  });
}

// a cannon's flash and its cloud
export function cannonFire(p, T, R, x, y, dir) {
  p.glow(x + dir * 3, y, 10, hex('#ffd070'), 0.5);
  p.disc(x + dir * 2, y, 2, hex('#fff6c0'));
  for (let i = 0; i < 3; i++) smoke(p, T, x + dir * (4 + i * 5) - 5, y + 2 - i, 10 + i * 3, R);
}

// a hot air balloon: stripes around a lit side, a basket below
export function balloon(p, T, R, cx, cy, r, cols) {
  const [a, b] = cols.map((c) => T.tone(c, 0.8));
  for (let y = Math.floor(cy - r); y <= cy + r * 1.15; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dy = (y - cy) / r;
      const narrow = dy > 0 ? 1 - dy * 0.5 : 1;
      const dx = (x - cx + 0.5) / (r * narrow);
      if (dx * dx + Math.min(dy, 0) ** 2 + Math.max(dy, 0) ** 2 * 0.55 > 1) continue;
      const stripe = Math.floor((Math.asin(Math.max(-1, Math.min(1, dx))) / Math.PI + 0.5) * 6) % 2;
      let c = stripe ? a : b;
      const light = -dx * 0.6 - dy * 0.5;
      if (light > 0.45) c = lighter(c, 0.3);
      else if (light < -0.35 + dither(x, y) * 0.2) c = deep(c, 0.3);
      p.put(x, y, c);
    }
  const by = Math.round(cy + r * 1.15 + 3);
  p.line(cx - r * 0.45, cy + r * 1.05, cx - 1, by, T.tone('#5a4030'));
  p.line(cx + r * 0.45, cy + r * 1.05, cx + 1, by, T.tone('#5a4030'));
  p.rect(cx - 2, by, 4, Math.max(2, Math.round(r / 3)), T.tone('#9a6a3a'));
}

// a wind turbine, its blades at an angle
export function turbine(p, T, x, base, h, angle) {
  const white = T.tone('#f4f6fa');
  const grey = T.tone('#c2c8d4');
  for (let y = base - h; y < base; y++) {
    const half = ((y - (base - h)) / h) * 1.2;
    p.put(x, y, white);
    if (half > 0.6) p.put(x + 1, y, grey);
  }
  const hy = base - h;
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    const L = h * 0.55;
    for (let i = 0; i < L; i++) p.put(Math.round(x + Math.cos(a) * i), Math.round(hy + Math.sin(a) * i), i < L * 0.7 ? white : grey);
  }
  p.rect(x - 1, hy - 1, 3, 2, grey);
}

// a dish for listening to the sky
export function dish(p, T, x, base, r, tilt) {
  const white = T.tone('#eef2f8', 0.8);
  const shade = T.tone('#9aa6bc', 0.8);
  const leg = T.tone('#6a7488', 0.8);
  p.line(x - r * 0.5, base, x, base - r * 0.9, leg);
  p.line(x + r * 0.5, base, x, base - r * 0.9, leg);
  p.rect(x - 1, base - r * 0.9, 2, r * 0.9, leg);
  const cy = base - r * 1.4;
  for (let y = -r; y <= r; y++)
    for (let xx = -r; xx <= r; xx++) {
      const u = xx * Math.cos(tilt) + y * Math.sin(tilt);
      const v = -xx * Math.sin(tilt) + y * Math.cos(tilt);
      const e = (u / r) ** 2 + (v / (r * 0.45)) ** 2;
      if (e <= 1) p.put(x + xx, cy + y, e > 0.55 ? white : v > 0 ? shade : mix(white, shade, 0.5));
    }
  const fx = x + Math.round(Math.sin(tilt) * r * 0.9);
  const fy = cy - Math.round(Math.cos(tilt) * r * 0.9);
  p.line(x, cy, fx, fy, leg);
  p.put(fx, fy, T.tone('#ff5a4a', 0.3));
}

// a firework burst with its trail of sparks
export function firework(p, R, cx, cy, r, c) {
  const col = hex(c);
  p.glow(cx, cy, r * 1.9, col, 0.3);
  const n = 12 + Math.round(r);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R.range(-0.08, 0.08);
    const reach = r * R.range(0.85, 1.05);
    // a trail that fades toward the middle, and a bright spark at its end
    for (let i = reach * 0.45; i < reach; i += 1) {
      const t = i / reach;
      const fall = t * t * 2.2;
      p.tint(cx + Math.cos(a) * i, cy + Math.sin(a) * i + fall, col, 0.25 + t * 0.6);
    }
    const ex = cx + Math.cos(a) * reach;
    const ey = cy + Math.sin(a) * reach + 2.2;
    p.put(ex, ey, lighter(col, 0.7));
    if (R.chance(0.5)) p.put(ex, ey + 2, col);
  }
  p.glow(cx, cy, 2.5, [255, 255, 255], 0.5);
}

// a rocket, its flame and the smoke rolling away
export function rocket(p, T, R, x, base, h, lift) {
  const body = T.tone('#f2f4f8', 0.6);
  const shade = T.tone('#b8c0d0', 0.6);
  const red = T.tone('#e8403a', 0.6);
  const w = Math.max(5, Math.round(h / 5.5));
  const top = base - h - lift;
  for (let y = top; y < base - lift; y++) {
    const t = (y - top) / h;
    const half = t < 0.18 ? Math.max(1, Math.round((t / 0.18) * (w / 2))) : w / 2;
    for (let dx = -Math.floor(half); dx < Math.ceil(half); dx++) p.put(x + dx, y, dx >= half / 3 ? shade : t > 0.18 && t < 0.24 ? red : body);
  }
  p.rect(x - 1, top + Math.round(h * 0.3), 2, 2, T.tone('#3a6ad0', 0.6));
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) p.line(x + s * (w / 2 + i * 0.5), base - lift - 5 + i, x + s * (w / 2 + i * 0.5), base - lift, red);
  const fy = base - lift;
  for (let y = 0; y < 10 + lift * 0.3; y++) {
    const half = Math.max(0, (w / 2) * (1 - y / (12 + lift * 0.3)) + R.range(-0.5, 0.5));
    for (let dx = -half; dx <= half; dx++) p.put(x + dx, fy + y, y < 3 ? hex('#ffffff') : Math.abs(dx) < half / 2 ? hex('#fff2a0') : hex('#ff9a3a'));
  }
  p.glow(x, fy + 4, 16, hex('#ffb060'), 0.45);
}

// a steam engine and its carriages, facing right
export function train(p, T, R, x, rail, cars, { body = '#2a2a36', trim = '#d8403a', car = '#3a7a5a' } = {}) {
  const dark = T.tone(body, 0.7);
  const red = T.tone(trim, 0.7);
  const gold = T.tone('#e8c050', 0.7);
  let cx = x;
  for (let i = 0; i < cars; i++) {
    const c = T.tone(car, 0.7);
    p.rect(cx, rail - 9, 16, 7, c);
    p.rect(cx, rail - 10, 16, 1, T.tone(deep(car, 0.4), 0.7));
    p.rect(cx, rail - 4, 16, 1, T.tone(deep(car, 0.4), 0.7));
    for (let k = 0; k < 3; k++) p.rect(cx + 2 + k * 5, rail - 8, 3, 3, T.dark > 0.3 ? hex('#ffd26a') : T.tone('#bfe4ff', 0.7));
    p.disc(cx + 3, rail - 1, 1.6, dark);
    p.disc(cx + 13, rail - 1, 1.6, dark);
    cx += 17;
  }
  // engine
  p.rect(cx, rail - 7, 16, 5, dark);
  p.rect(cx, rail - 12, 5, 10, dark);
  p.rect(cx - 1, rail - 13, 7, 1, red);
  p.rect(cx + 1, rail - 11, 3, 3, T.dark > 0.3 ? hex('#ffd26a') : T.tone('#bfe4ff', 0.7));
  p.rect(cx + 11, rail - 11, 2, 4, dark);
  p.rect(cx + 10, rail - 12, 4, 1, red);
  p.rect(cx + 5, rail - 5, 11, 1, gold);
  p.rect(cx - 1, rail - 3, 18, 1, red);
  for (const wx of [cx + 3, cx + 8, cx + 13]) p.disc(wx, rail - 1, 2, red);
  p.line(cx + 16, rail - 2, cx + 18, rail, red);
  if (T.dark > 0.3) p.glow(cx + 18, rail - 5, 10, hex('#fff0a0'), 0.5);
  return { stackX: cx + 11, stackY: rail - 13 };
}
