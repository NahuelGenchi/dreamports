// What prove says about what the console holds as it draws a frame, in the original and in a Dreamport: its display
// registers, colours, sprites and video memory, only where they differ, which says why a picture differs when the
// pictures alone don't. Both come as the same bytes (tools/gba/original.c, lib/in-page.js) and stay on this computer.
// It names each value's place and use, and prints the contents of no tile: of video memory only where it differs, and
// how each stretch of a map starts.

const IO_BYTES = 0x58, COLOURS_AT = IO_BYTES, SPRITES_AT = COLOURS_AT + 0x400, VRAM_AT = SPRITES_AT + 0x400, VRAM_BYTES = 0x18000;
/** The bytes of a state: the display registers, the colours, the sprites and the video memory. */
export const STATE_BYTES = VRAM_AT + VRAM_BYTES;

// how many of each a frame's lines show; report.json keeps them all
const SHOWN = 8;
// two stretches of video memory this close together are one
const NEAR_BYTES = 32;

const hex = (value, digits = 4) => `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
const colourName = c => `#${[c & 31, c >> 5 & 31, c >> 10 & 31].map(v => (v << 3 | v >> 2).toString(16).padStart(2, '0')).join('')}`;

// the display registers the kit keeps (kit/gba/video.js), by byte offset from 0x04000000
const REGISTERS = new Map([
  [0x00, { name: 'DISPCNT' }],
  ...[0, 1, 2, 3].flatMap(n => [
    [0x08 + n * 2, { name: `BG${n}CNT`, layer: n }],
    [0x10 + n * 4, { name: `BG${n}HOFS`, layer: n, scroll: true }],
    [0x12 + n * 4, { name: `BG${n}VOFS`, layer: n, scroll: true }],
  ]),
  ...[2, 3].flatMap(n => ['PA', 'PB', 'PC', 'PD', 'X_L', 'X_H', 'Y_L', 'Y_H'].map((part, i) => [(n === 2 ? 0x20 : 0x30) + i * 2, { name: `BG${n}${part}`, layer: n, rotating: true }])),
  ...['WIN0H', 'WIN1H', 'WIN0V', 'WIN1V', 'WININ', 'WINOUT'].map((name, i) => [0x40 + i * 2, { name, window: true }]),
  [0x4C, { name: 'MOSAIC' }],
  [0x50, { name: 'BLDCNT' }],
  [0x52, { name: 'BLDALPHA' }],
  [0x54, { name: 'BLDY' }],
]);

// a state's parts, whichever way it came
function partsOf(state) {
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  return {
    register: at => view.getUint16(at, true),
    colour: i => view.getUint16(COLOURS_AT + i * 2, true),
    sprite: (i, attribute) => view.getUint16(SPRITES_AT + i * 8 + attribute * 2, true),
    vram: at => state[VRAM_AT + at],
    vram16: at => view.getUint16(VRAM_AT + at, true),
  };
}

// whether a layer shows, in the original or the Dreamport: a register of one that shows in neither can't matter
const shows = (dispcnt, layer) => (dispcnt >> (8 + layer) & 1) === 1;

function differentRegisters(theirs, ours) {
  const a = theirs.register(0), b = ours.register(0), found = [];
  for (const [at, { name, layer, rotating, window, scroll: isScroll }] of REGISTERS) {
    if (layer !== undefined && !shows(a, layer) && !shows(b, layer)) continue;
    if (rotating && !(a & 7) && !(b & 7)) continue;
    if (window && !(a >> 13 & 3) && !(b >> 13 & 3)) continue;
    const original = theirs.register(at), dreamport = ours.register(at);
    if (original !== dreamport) found.push({ name, address: hex(0x04000000 + at, 8), original, dreamport, scroll: !!isScroll });
  }
  return found;
}

function differentColours(theirs, ours) {
  const found = [];
  for (let i = 0; i < 512; i++) {
    const original = theirs.colour(i), dreamport = ours.colour(i);
    if (original === dreamport) continue;
    const sprites = i >= 256, index = i & 255;
    found.push({ address: hex(0x05000000 + i * 2, 8), of: sprites ? 'sprites' : 'backgrounds', palette: index >> 4, colour: index & 15, original, dreamport });
  }
  return found;
}

const ROTATION_VALUES = ['PA', 'PB', 'PC', 'PD'];

// a sprite as people read one, or null when it doesn't show
function spriteOf(state, i) {
  const a0 = state.sprite(i, 0), a1 = state.sprite(i, 1), a2 = state.sprite(i, 2);
  if ((a0 >> 8 & 3) === 2) return null;
  const size = a1 >> 14, shape = a0 >> 14;
  const [w, h] = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]], [[8, 8], [8, 8], [8, 8], [8, 8]]][shape][size];
  // a rotating sprite also draws with its group's four values, each in the spare attribute of one of four sprites in a row, hidden or not
  const group = a1 >> 9 & 31, rotationValues = a0 >> 8 & 1 ? ROTATION_VALUES.map((_, k) => state.sprite(group * 4 + k, 3)) : [];
  return {
    x: a1 & 0x1FF, y: a0 & 0xFF, tile: a2 & 0x3FF, width: w, height: h, palette: a2 >> 12, priority: a2 >> 10 & 3,
    ...(a0 >> 8 & 1 ? { rotation: group, rotationValues } : { flipped: `${a1 >> 12 & 1 ? 'h' : ''}${a1 >> 13 & 1 ? 'v' : ''}` }),
    attributes: [a0, a1, a2, ...rotationValues],
  };
}

function differentSprites(theirs, ours) {
  const found = [];
  for (let i = 0; i < 128; i++) {
    const original = spriteOf(theirs, i), dreamport = spriteOf(ours, i);
    if (!original && !dreamport) continue;
    if (original && dreamport && original.attributes.every((v, k) => v === dreamport.attributes[k])) continue;
    found.push({ sprite: i, address: hex(0x07000000 + i * 8, 8), original, dreamport });
  }
  return found;
}

// what the frame's layers and sprites read from video memory, by the original's registers or the Dreamport's: { what, from, to, map }
function usesOf(theirs, ours) {
  const uses = new Map();
  for (const [state, whose] of [[theirs, 'original'], [ours, 'Dreamport']]) {
    const dispcnt = state.register(0), mode = dispcnt & 7;
    const add = (what, from, to, map = false) => {
      const key = `${what} ${from}`;
      if (uses.has(key)) uses.get(key).whose = 'both';
      else uses.set(key, { what, from, to, map, whose });
    };
    if (mode >= 3) add('the bitmap', 0, mode === 3 ? 0x12C00 : 0xA000);
    else for (let n = 0; n < 4; n++) {
      if (!shows(dispcnt, n)) continue;
      const rotating = mode === 2 ? n >= 2 : mode === 1 ? n === 2 : false;
      if (mode === 1 && n === 3) continue;
      if (mode === 2 && n < 2) continue;
      const cnt = state.register(0x08 + n * 2), size = cnt >> 14;
      const tiles = (cnt >> 2 & 3) * 0x4000, map = (cnt >> 8 & 31) * 0x800;
      add(`BG${n}'s tiles`, tiles, Math.min(0x10000, tiles + (cnt >> 7 & 1 ? 0x10000 : 0x8000)));
      const mapBytes = rotating ? (128 << size) ** 2 / 64 : (size === 3 ? 0x2000 : size === 0 ? 0x800 : 0x1000);
      add(`BG${n}'s map`, map, map + mapBytes, !rotating);
    }
    if (dispcnt >> 12 & 1) add('the sprites\' tiles', 0x10000, 0x18000);
  }
  return [...uses.values()];
}

function differentVideoMemory(theirs, ours) {
  const stretches = [];
  let bytes = 0;
  for (let at = 0; at < VRAM_BYTES; at++) {
    if (theirs.vram(at) === ours.vram(at)) continue;
    bytes++;
    const last = stretches.at(-1);
    if (last && at - last.to <= NEAR_BYTES) { last.to = at + 1; last.bytes++; }
    else stretches.push({ from: at, to: at + 1, bytes: 1 });
  }
  const uses = usesOf(theirs, ours);
  let unused = 0;
  const used = [];
  for (const stretch of stretches) {
    const here = uses.filter(u => stretch.from < u.to && u.from < stretch.to);
    if (!here.length) { unused += stretch.bytes; continue; }
    // a layer's tiles can reach over all of video memory, so a map, the more particular, is all a stretch in one names
    const maps = here.filter(u => u.map);
    const at = stretch.from & ~1;
    const entry = maps.length ? { original: theirs.vram16(at), dreamport: ours.vram16(at) } : {};
    used.push({ from: hex(0x06000000 + stretch.from, 8), to: hex(0x06000000 + stretch.to - 1, 8), bytes: stretch.bytes, uses: [...new Set((maps.length ? maps : here).map(u => u.what))], ...entry });
  }
  return { bytes, stretches: used, unused };
}

/** Compares what the original held at a frame with what the Dreamport held, both as STATE_BYTES bytes. */
export function compareState(original, dreamport) {
  const theirs = partsOf(original), ours = partsOf(dreamport);
  return {
    registers: differentRegisters(theirs, ours),
    colours: differentColours(theirs, ours),
    sprites: differentSprites(theirs, ours),
    videoMemory: differentVideoMemory(theirs, ours),
  };
}

const bytesOf = count => `${count.toLocaleString('en')} ${count === 1 ? 'byte' : 'bytes'}`;
const more = (list, line) => `${list.slice(0, SHOWN).map(line).join('; ')}${list.length > SHOWN ? `; and ${list.length - SHOWN} more` : ''}`;
const spriteText = s => (s ? `x ${s.x}, y ${s.y}, tile ${s.tile}, ${s.width} x ${s.height}, palette ${s.palette}, priority ${s.priority}${s.rotation !== undefined ? `, rotation ${s.rotation}, ${ROTATION_VALUES.map((name, k) => `${name} ${hex(s.rotationValues[k])}`).join(', ')}` : s.flipped ? `, flipped ${s.flipped}` : ''}` : 'hidden');

/** The lines prove prints about a frame's comparison, and whether its picture differs. */
export function describeState(frame, { registers, colours, sprites, videoMemory }, pictureDiffers) {
  const lines = [];
  if (registers.length) {
    lines.push(`Registers, ${registers.length}: ${more(registers, r => `${r.name} is ${r.scroll ? r.original : hex(r.original)} in the original, ${r.scroll ? r.dreamport : hex(r.dreamport)} in the Dreamport`)}.`);
  }
  if (colours.length) {
    lines.push(`Colours, ${colours.length} of 512: ${more(colours, c => `${c.address}, the ${c.of}' palette ${c.palette}, colour ${c.colour}, is ${colourName(c.original)} in the original, ${colourName(c.dreamport)} in the Dreamport`)}.`);
  }
  if (sprites.length) {
    lines.push(`Sprites, ${sprites.length} of 128: ${more(sprites, s => `sprite ${s.sprite} is ${spriteText(s.original)} in the original, ${spriteText(s.dreamport)} in the Dreamport`)}.`);
  }
  if (videoMemory.stretches.length) {
    lines.push(`Video memory, ${bytesOf(videoMemory.stretches.reduce((sum, s) => sum + s.bytes, 0))} this frame uses: ${more(videoMemory.stretches, s => `${s.from} to ${s.to}, ${s.uses.join(' and ')}, ${bytesOf(s.bytes)}${s.original !== undefined ? `, starting ${hex(s.original)} in the original, ${hex(s.dreamport)} in the Dreamport` : ''}`)}.`);
  }
  if (videoMemory.unused) lines.push(`Video memory this frame doesn't use, ${bytesOf(videoMemory.unused)}, which doesn't change the picture.`);
  const heading = `Frame ${frame}, what the console holds as it draws it`;
  if (!lines.length) return [`${heading}: the same in both.${pictureDiffers ? ' So the picture differs because of how it\'s drawn (kit/gba/video.js), or a register changed between lines.' : ''}`];
  return [`${heading}, where it differs:`, ...lines.map(line => `  ${line}`)];
}
