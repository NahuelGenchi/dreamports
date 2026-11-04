// What moves on screen in a level: a sprite's animation, and how it reaches the console's sprites, its tiles and its
// colours, rewritten from how the original does it, from its own instructions. Each function is named by its address in
// the USA copy.

const CARTRIDGE = 0x08000000, OBJ_TILES = 0x10000;

/** 0x080353E0: an animation from the cartridge at `address`: its picture sheet's frames, how long each lasts and whether it loops. */
export function readAnimation(rom, address) {
  const at = address - CARTRIDGE, word = rom.u32(at + 20);
  return {
    address,
    sheet: rom.u32(at) - CARTRIDGE, list: rom.u32(at + 4) - CARTRIDGE, colours: rom.u32(at + 8) - CARTRIDGE,
    x: rom.view.getInt16(at + 12, true), y: rom.view.getInt16(at + 14, true), w: rom.u8(at + 16), h: rom.u8(at + 17),
    delay: word & 0xFF, count: (word >> 8) & 0xFF, loops: ((word >> 16) & 1) !== 0,
  };
}

/** 0x08035654: something on screen playing an animation, at its place in eighths of a pixel (0x080352DC starts it). */
export function createSprite(rom, address, x, y, flipX = false) {
  const sprite = { rom, x, y, flipX, flipY: false, animation: null, frame: 0, next: 0, ended: false, hidden: false };
  sprite.animation = readAnimation(rom, address);
  return sprite;
}

/** 0x080352DC: a new animation from its first frame, at this `clock` (0x02007284). */
export function playAnimation(sprite, address, clock) {
  sprite.animation = readAnimation(sprite.rom, address);
  sprite.frame = 0;
  sprite.ended = false;
  sprite.next = clock + sprite.animation.delay + 1;
}

/** 0x080351A8: the next frame once its time has come; a frame late stays behind by no more than one frame's length. */
export function stepAnimation(sprite, clock) {
  if (clock < sprite.next) return;
  const { animation } = sprite;
  if (sprite.frame === animation.count - 1) {
    if (animation.loops) sprite.frame = 0;
    else sprite.ended = true;
  } else sprite.frame++;
  sprite.next += animation.delay + 1;
  if (clock > sprite.next) sprite.next = clock + animation.delay + 1;
}

/** The console's sprites as a frame's objects ask for them: 0x08037C54's tile memory, 0x0801F7A8's colours and 0x0200A820's list. */
export function createSprites(video, rom, firstTile = 0) {
  return { video, rom, list: [], firstTile, tiles: firstTile, jobs: [], slots: new Map(), nextSlot: 15 };
}

// 0x08069648: how many tiles each shape and size holds, and 0x080695E8 its width and height
const TILES = [1, 4, 16, 64, 2, 4, 8, 32, 2, 4, 8, 32];
const WIDTHS = [8, 16, 32, 64, 16, 32, 32, 64, 8, 8, 16, 32];
const HEIGHTS = [8, 16, 32, 64, 8, 8, 16, 32, 16, 32, 32, 64];

/** 0x0801F7A8: the sprites' colours held at `at` in the cartridge, in a slot of their own from the first time they're asked for. */
export function colourSlot(sprites, at, colours) {
  let slot = sprites.slots.get(at);
  if (slot === undefined) {
    slot = sprites.nextSlot--;
    sprites.slots.set(at, slot);
    for (let i = 0; i < 16; i++) colours[256 + slot * 16 + i] = sprites.rom.u16(at + i * 2);
  }
  return slot;
}

/** 0x080190D0 with 0x08018BD8: a sprite's frame at its place on screen: its colours, its pieces and its tiles. */
export function drawSprite(sprites, sprite, screenX, screenY, colours) {
  const { rom, list } = sprites, { animation } = sprite;
  const slot = colourSlot(sprites, animation.colours, colours);
  const frame = rom.u32(animation.sheet + 4) - CARTRIDGE + rom.u16(animation.list + sprite.frame * 2) * 44;
  const parts = rom.u32(frame) - CARTRIDGE, count = rom.u8(frame + 16);
  let offset = 0;
  for (let n = 0; n < count; n++) {
    const at = parts + n * 8, kind = rom.u8(at + 4);
    const partX = rom.view.getInt16(at, true), partY = rom.view.getInt16(at + 2, true);
    const w = WIDTHS[kind], h = HEIGHTS[kind];
    const y = sprite.flipY ? screenY - partY - h : screenY + partY;
    const x = sprite.flipX ? screenX - partX - w : screenX + partX;
    if (y > -h && y <= 159 && x > -w && x <= 239) {
      list.push([
        (y & 0xFF) | ((kind & 0xC) << 12),
        (x & 0x1FF) | ((kind & 3) << 14) | (sprite.flipX ? 0x1000 : 0) | (sprite.flipY ? 0x2000 : 0),
        (slot << 12) | ((sprite.priority ?? 1) << 10) | (sprites.tiles + offset),   // [52], which 0x08019190 sets to 1 in a level and 0x08019254 starts at 0
      ]);
    }
    offset += TILES[kind];
  }
  // 0x08037B5C: the frame's tiles, which go into video memory at the V-blank, in pairs
  sprites.jobs.push([rom.u32(frame + 4) - CARTRIDGE, sprites.tiles, offset]);
  sprites.tiles += (offset + 1) & ~1;
}

/** 0x0800E1A8: a letter from the font's tiles at `from`, at priority 0, of the shape its `attributes` give: by default 8 by 16, tall, with mosaic set. */
export function drawLetter(sprites, from, x, y, slot, { shape = 0x9000, size = 0, tiles = 2 } = {}) {
  sprites.list.push([(y & 0xFF) | shape, (x & 0x1FF) | size, (slot << 12) | sprites.tiles]);
  sprites.jobs.push([from, sprites.tiles, tiles]);
  sprites.tiles += (tiles + 1) & ~1;
}

/** At the V-blank: 0x08037B28's tiles and 0x0803FA50's list. */
export function showSprites(sprites) {
  const { video, rom, list, jobs } = sprites;
  for (const [from, tile, count] of jobs) video.vram.set(rom.bytes.subarray(from, from + count * 32), OBJ_TILES + tile * 32);
  video.oam.fill(0);
  for (let n = 0; n < 128; n++) {
    const entry = list[n];
    video.oam[n * 4] = entry ? entry[0] : 160;
    video.oam[n * 4 + 1] = entry ? entry[1] : 0;
    video.oam[n * 4 + 2] = entry ? entry[2] : 0;
  }
  list.length = 0;
  jobs.length = 0;
  sprites.tiles = sprites.firstTile;
}
