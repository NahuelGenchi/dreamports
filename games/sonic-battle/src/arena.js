// The arena of a fight: its pictures and shape loaded, its walls and the things standing in it drawn each frame, and
// the colours that move (the original's 0x0800FDC8, 0x0801103C, 0x08011C7C, 0x0800F9C0 and 0x0800F3C4).
//
// All of it keeps its state in work RAM at the original's addresses (bus.js). Which arena is which, and every table,
// stays in the cartridge: this file only says where they are.

import { clearLayer, layerBits, layerCharBase, layerScreenBase } from './core.js';
import { read8, read16, reads16, write8, write16, copy16, divArm } from './bus.js';
import { fn0801816c, fn08018204, fn08017f00, fn08017f34 } from './sprites.js';

const ARENA = 0x03002CB4;                      // which arena this is
const ARENA_LAYOUT = 0x03002CB0;               // the number its load gives it

// the arena's limits, two pairs of 16-bit values, and the lists of its shape, with how long each is
const LIMIT_A_HIGH = 0x03002B74, LIMIT_A_LOW = 0x03002BD0, LIMIT_B_HIGH = 0x03002B80, LIMIT_B_LOW = 0x03002B70;
const POINTS = 0x03002AD0, POINT_COUNT = 0x03002B7C;
const SCREEN_POINTS = 0x03002BE0;              // the points as the camera sees them
const WALL_POINTS = 0x03002A80, WALL_COUNT = 0x03002C80;   // bytes: two points' numbers for each wall
const WALL_LOOKS = 0x030029C0;                 // 16-bit: two for each wall, its picture and its colours
const FLOORS = 0x03002B90, FLOOR_COUNT = 0x03002B84;
const SHAPE_DONE = 0x03001B00;                 // what the shape's load leaves here

const CAMERA_HEIGHT = 0x03001384, MATRIX_COUNT = 0x03001388;
const SCREEN_TOP = 0x030016D0, SCREEN_BOTTOM = 0x030017C0;
const VIEW = 0x03001370;                       // which way the camera faces

// the arena's things, twelve of 68 bytes each
const THINGS = 0x030017D0, THING_SIZE = 68, THING_COUNT = 12;
const THING_FLIP = 5, THING_BASE_FLIP = 6, THING_COLOURS = 4, THING_PICTURES = 26, THING_X = 18, THING_Y = 20;
const THING_PART_X = 34, THING_PART_Y = 42, THING_SIZE_KIND = 52, THING_OWNER = 53, THING_KIND = 56, THING_AT_X = 58;
const THING_AT_Y = 60, THING_HEIGHT = 62, THING_FACING = 64;
const KIND_PARTS = 0x0806B414;                 // how many parts each kind of thing has, by the kind's number
const NOTHING_NEW = 0xFFFF;                    // a part's picture that has been sent already
const THINGS_DRAWN = 0x03002684;

// who owns a thing picks which of two sets of pictures it shows
const SETUP = 0x03001620, OWNER_CHARACTER = 20, OWNER_OTHER = 24;
const PICTURES_ONE = 0x08B40858, PICTURES_TWO = 0x08A8F038;
const PICTURE_BYTES = [256, 512, 512, 1024, 64];   // by the thing's size kind

// the moving colours: the frame they're on, whether they move, and how many frames they take in each arena
const COLOUR_FRAME = 0x03002B78, COLOURS_MOVE = 0x03002034, COLOUR_FRAMES = 0x08070F1A;
const COLOURS_A = 0x03002C90, COLOURS_B = 0x03002A60;
const PALETTE_1A0 = 0x050001A0, PALETTE_1C0 = 0x050001C0, PALETTE_002 = 0x05000002, PALETTE_060 = 0x05000060;

// How each arena's load copies (each a 16-bit DMA 3 of `count` words): [from, to, count].
const ARENAS = [
  // arena 0
  { layout: 9, copies: [
    [0x0846DD38, 0x06000000, 0xDA0],
    [0x0846F878, 0x0600E000, 0x800],
    [0x08468B78, 0x06004000, 0x1FE0],
    [0x0846CB38, 0x0600F000, 0x800],
    [0x08468978, 0x05000000, 0x100],
    [0x08467E78, 0x05000340, 0x10],
    [0x08467E98, 0x05000360, 0x10],
    [0x08467EB8, 0x05000380, 0x10],
    [0x08467ED8, 0x050003A0, 0x10],
    [0x08467EF8, 0x06014D00, 0x100],
    [0x084680F8, 0x06014F00, 0x80],
    [0x084681F8, 0x06015000, 0x40],
    [0x08468278, 0x06015080, 0x100],
    [0x08468478, 0x06015280, 0x80],
    [0x08468578, 0x06015380, 0x40],
    [0x084685F8, 0x06015400, 0x100],
    [0x084687F8, 0x06015600, 0x80],
    [0x084688F8, 0x06015700, 0x40],
  ] },
  // arena 1
  { layout: 4, copies: [
    [0x0844A738, 0x06000000, 0x220],
    [0x0844AB78, 0x0600E000, 0x800],
    [0x08445578, 0x06004000, 0x1FE0],
    [0x08449538, 0x0600F000, 0x800],
    [0x08445378, 0x05000000, 0x100],
    [0x08444898, 0x05000340, 0x10],
    [0x084448B8, 0x05000360, 0x10],
    [0x084448D8, 0x05000380, 0x10],
    [0x084448F8, 0x06014D00, 0x100],
    [0x08444AF8, 0x06014F00, 0x80],
    [0x08444BF8, 0x06015000, 0x40],
    [0x08444C78, 0x06015080, 0x100],
    [0x08444E78, 0x06015280, 0x80],
    [0x08444F78, 0x06015380, 0x40],
    [0x08444FF8, 0x06015400, 0x100],
    [0x084451F8, 0x06015600, 0x80],
    [0x084452F8, 0x06015700, 0x40],
  ] },
  // arena 2
  { layout: 0, copies: [
    [0x0842BA98, 0x06000000, 0x420],
    [0x0842C2D8, 0x0600E000, 0x800],
    [0x08428898, 0x06004000, 0x1000],
    [0x0842A898, 0x0600F000, 0x800],
    [0x08428698, 0x05000000, 0x100],
    [0x08427858, 0x05000340, 0x10],
    [0x08427878, 0x05000360, 0x10],
    [0x08427898, 0x06014D00, 0x100],
    [0x08427A98, 0x06014F00, 0x80],
    [0x08427B98, 0x06015000, 0x40],
    [0x08427C18, 0x06015080, 0x100],
    [0x08427E18, 0x06015280, 0x80],
    [0x08427F18, 0x06015380, 0x40],
    [0x08427F98, 0x06015400, 0x100],
    [0x08428198, 0x06015600, 0x80],
    [0x08428298, 0x06015700, 0x40],
    [0x08428318, 0x06015780, 0x100],
    [0x08428518, 0x06015980, 0x80],
    [0x08428618, 0x06015A80, 0x40],
  ] },
  // arena 3
  { layout: 2, copies: [
    [0x0843B498, 0x06000000, 0x420],
    [0x0843BCD8, 0x0600E000, 0x800],
    [0x08436318, 0x06004000, 0x1FC0],
    [0x0843A298, 0x0600F000, 0x800],
    [0x08436118, 0x05000000, 0x100],
    [0x08435298, 0x05000340, 0x10],
    [0x084352B8, 0x05000360, 0x10],
    [0x084352D8, 0x05000380, 0x10],
    [0x084352F8, 0x050003A0, 0x10],
    [0x08435318, 0x06014D00, 0x100],
    [0x08435518, 0x06014F00, 0x80],
    [0x08435618, 0x06015000, 0x40],
    [0x08435698, 0x06015080, 0x100],
    [0x08435898, 0x06015280, 0x80],
    [0x08435998, 0x06015380, 0x40],
    [0x08435A18, 0x06015400, 0x100],
    [0x08435C18, 0x06015600, 0x80],
    [0x08435D18, 0x06015700, 0x40],
    [0x08435D98, 0x06015780, 0x100],
    [0x08435F98, 0x06015980, 0x80],
    [0x08436098, 0x06015A80, 0x40],
  ] },
  // arena 4
  { layout: 3, copies: [
    [0x08442F58, 0x06000000, 0x4A0],
    [0x08443898, 0x0600E000, 0x800],
    [0x0843DD58, 0x06004000, 0x2000],
    [0x08441D58, 0x0600F000, 0x800],
    [0x0843DB58, 0x05000000, 0x100],
    [0x0843CCD8, 0x05000340, 0x10],
    [0x0843CCF8, 0x05000360, 0x10],
    [0x0843CD18, 0x05000380, 0x10],
    [0x0843CD38, 0x050003A0, 0x10],
    [0x0843CD58, 0x06014D00, 0x100],
    [0x0843CF58, 0x06014F00, 0x80],
    [0x0843D058, 0x06015000, 0x40],
    [0x0843D0D8, 0x06015080, 0x100],
    [0x0843D2D8, 0x06015280, 0x80],
    [0x0843D3D8, 0x06015380, 0x40],
    [0x0843D458, 0x06015400, 0x100],
    [0x0843D658, 0x06015600, 0x80],
    [0x0843D758, 0x06015700, 0x40],
    [0x0843D7D8, 0x06015780, 0x100],
    [0x0843D9D8, 0x06015980, 0x80],
    [0x0843DAD8, 0x06015A80, 0x40],
  ] },
  // arena 5
  { layout: 5, copies: [
    [0x08451A38, 0x06000000, 0x1020],
    [0x08453A78, 0x0600E000, 0x800],
    [0x0844C878, 0x06004000, 0x1FE0],
    [0x08450838, 0x0600F000, 0x800],
    [0x0844C678, 0x05000000, 0x100],
    [0x0844BB78, 0x05000340, 0x10],
    [0x0844BB98, 0x05000360, 0x10],
    [0x0844BBB8, 0x05000380, 0x10],
    [0x0844BBD8, 0x050003A0, 0x10],
    [0x0844BBF8, 0x06014D00, 0x100],
    [0x0844BDF8, 0x06014F00, 0x80],
    [0x0844BEF8, 0x06015000, 0x40],
    [0x0844BF78, 0x06015080, 0x100],
    [0x0844C178, 0x06015280, 0x80],
    [0x0844C278, 0x06015380, 0x40],
    [0x0844C2F8, 0x06015400, 0x100],
    [0x0844C4F8, 0x06015600, 0x80],
    [0x0844C5F8, 0x06015700, 0x40],
  ] },
  // arena 6
  { layout: 11, copies: [
    [0x084795D8, 0x06000000, 0x220],
    [0x08479A18, 0x0600E000, 0x800],
    [0x08474658, 0x06004000, 0x1EC0],
    [0x084783D8, 0x0600F000, 0x800],
    [0x08474458, 0x05000000, 0x100],
    [0x08473898, 0x05000340, 0x10],
    [0x084738B8, 0x05000360, 0x10],
    [0x084738D8, 0x05000380, 0x10],
    [0x084738F8, 0x050003A0, 0x10],
    [0x08473918, 0x06014D00, 0x100],
    [0x08473B38, 0x06014F00, 0x80],
    [0x08473C58, 0x06015000, 0x40],
    [0x08473CD8, 0x06015080, 0x100],
    [0x08473EF8, 0x06015280, 0x80],
    [0x08474018, 0x06015380, 0x40],
    [0x08474098, 0x06015400, 0x100],
    [0x084742B8, 0x06015600, 0x80],
    [0x084743D8, 0x06015700, 0x40],
  ] },
  // arena 7
  { layout: 1, copies: [
    [0x08432ED8, 0x06000000, 0x9E0],
    [0x08434298, 0x0600E000, 0x800],
    [0x0842E318, 0x06004000, 0x1E40],
    [0x08431CD8, 0x0600F000, 0x800],
    [0x0842E118, 0x05000000, 0x100],
    [0x0842D2F8, 0x05000340, 0x10],
    [0x0842D2D8, 0x05000360, 0x10],
    [0x0842D318, 0x06014D00, 0x100],
    [0x0842D518, 0x06014F00, 0x80],
    [0x0842D618, 0x06015000, 0x40],
    [0x0842D698, 0x06015080, 0x100],
    [0x0842D898, 0x06015280, 0x80],
    [0x0842D998, 0x06015380, 0x40],
    [0x0842DA18, 0x06015400, 0x100],
    [0x0842DC18, 0x06015600, 0x80],
    [0x0842DD18, 0x06015700, 0x40],
    [0x0842DD98, 0x06015780, 0x100],
    [0x0842DF98, 0x06015980, 0x80],
    [0x0842E098, 0x06015A80, 0x40],
  ] },
  // arena 8
  { layout: 6, copies: [
    [0x08457078, 0x06000000, 0x2000],
    [0x0845B078, 0x0600E000, 0x800],
    [0x08455738, 0x06004000, 0x3A0],
    [0x08455E78, 0x0600F000, 0x800],
    [0x08455538, 0x05000000, 0x100],
    [0x08454A78, 0x05000340, 0x10],
    [0x08454A98, 0x05000360, 0x10],
    [0x08454AB8, 0x06014D00, 0x100],
    [0x08454CB8, 0x06014F00, 0x80],
    [0x08454DB8, 0x06015000, 0x40],
    [0x08454E38, 0x06015080, 0x100],
    [0x08455038, 0x06015280, 0x80],
    [0x08455138, 0x06015380, 0x40],
    [0x084551B8, 0x06015400, 0x100],
    [0x084553B8, 0x06015600, 0x80],
    [0x084554B8, 0x06015700, 0x40],
  ] },
  // arena 9
  { layout: 10, copies: [
    [0x08472278, 0x06000000, 0x120],
    [0x084724B8, 0x0600E000, 0x800],
    [0x08470A78, 0x06004000, 0x300],
    [0x08471078, 0x0600F000, 0x800],
    [0x08470878, 0x05000000, 0x100],
    [0x084734B8, 0x05000340, 0x10],
    [0x084734D8, 0x06014D00, 0x100],
    [0x084736F8, 0x06014F00, 0x80],
    [0x08473818, 0x06015000, 0x40],
  ] },
  // arena 10
  { layout: 8, copies: [
    [0x08465AF8, 0x06000000, 0x9C0],
    [0x08466E78, 0x0600E000, 0x800],
    [0x08461EF8, 0x06004000, 0x1500],
    [0x084648F8, 0x0600F000, 0x800],
    [0x08461CF8, 0x05000000, 0x100],
    [0x08461238, 0x05000340, 0x10],
    [0x08461258, 0x05000360, 0x10],
    [0x08461278, 0x06014D00, 0x100],
    [0x08461478, 0x06014F00, 0x80],
    [0x08461578, 0x06015000, 0x40],
    [0x084615F8, 0x06015080, 0x100],
    [0x084617F8, 0x06015280, 0x80],
    [0x084618F8, 0x06015380, 0x40],
    [0x08461978, 0x06015400, 0x100],
    [0x08461B78, 0x06015600, 0x80],
    [0x08461C78, 0x06015700, 0x40],
  ] },
  // arena 11
  { layout: 7, copies: [
    [0x0845C278, 0x06004000, 0x1FE0],
    [0x08460238, 0x0600F000, 0x800],
    [0x0845C078, 0x05000000, 0x100],
  ] },
];

/**
 * 0x0800FDC8: an arena's pictures, maps and colours copied to the video hardware, then its layers set. Each case of
 * the original's switch is one entry of ARENAS; the switch's middle is in 0x0801085E and 0x08010E0C, and its last case
 * ends in 0x08010F10.
 */
export function loadArena(c, arena) {
  arena &= 0xFF;
  write8(c, ARENA, arena);
  if (arena <= 11) {
    const { layout, copies } = ARENAS[arena];
    for (const [from, to, count] of copies) copy16(c, from, to, count);
    // 0x08010F1C: the number kept
    write8(c, ARENA_LAYOUT, layout);
  }
  setArenaLayers(c);
}

/** 0x08010F1E: layers 2 and 3 as every arena has them. */
export function setArenaLayers(c) {
  for (const [layer, charBase, screenBase] of [[2, 0, 28], [3, 1, 30]]) {
    clearLayer(c, layer);
    layerBits(c, layer, 0x8000);
    layerBits(c, layer, layer);
    layerBits(c, layer, 0x80);
    layerCharBase(c, layer, charBase);
    layerScreenBase(c, layer, screenBase);
  }
}

// For each arena of 0x0801103C's switch: its limits, the lists' lengths, where each list is, and what 0x08011C2C leaves.
// An arena with nothing in a list has that list's place as null, and its length 0.
const SHAPES = [
  { limits: [0x1300, -0x1300, 0x1300, -0x1300], counts: [70, 70, 24], lists: [0x08070B62, 0x08070BEE, 0x08070C34, 0x08070CC2], done: 3 },
  { limits: [0xD00, -0xD00, 0xD00, -0xD00], counts: [56, 56, 8], lists: [0x0807062A, 0x0807069A, 0x080706D2, 0x08070744], done: 3 },
  { limits: [0xF00, -0xF00, 0xF00, -0xF00], counts: [64, 64, 24], lists: [0x0806FFBA, 0x0807003A, 0x0807007A, 0x080700FC], done: 3 },
  { limits: [0xF00, -0xF00, 0xF00, -0xF00], counts: [72, 72, 32], lists: [0x080702C2, 0x08070352, 0x0807039A, 0x0807042C], done: 3 },
  { limits: [0x1300, -0x1300, 0x1300, -0x1300], counts: [80, 80, 20], lists: [0x0807046E, 0x0807050E, 0x0807055E, 0x08070600], done: 3 },
  { limits: [0x1800, -0x1800, 0xC00, -0xC00], counts: [64, 64, 32], lists: [0x08070756, 0x080707D6, 0x08070816, 0x08070898], done: 3 },
  { limits: [0xC00, -0xC00, 0xC00, -0xC00], counts: [32, 32, 16], lists: [0x08070E58, 0x08070E98, 0x08070EB8, 0x08070EFA], done: 3 },
  { limits: [0x1F00, -0x1F00, 0x700, -0x700], counts: [72, 72, 20], lists: [0x0807012E, 0x080701BE, 0x08070206, 0x08070298], done: 4 },
  { limits: [0x1100, -0x1100, 0x1100, -0x1100], counts: [40, 40, 28], lists: [0x080708DA, 0x0807092A, 0x08070952, 0x080709A4], done: 3 },
  { limits: [0x1000, -0x1000, 0x1000, -0x1000], counts: [64, 64, 16], lists: [0x08070CF4, 0x08070D74, 0x08070DB4, 0x08070E36], done: 3 },
  { limits: [0x1F00, -0x1F00, 0x700, -0x700], counts: [68, 68, 20], lists: [0x080709E2, 0x08070A6A, 0x08070AAE, 0x08070B38], done: 4 },
  { limits: [0x1300, -0x1300, 0x1300, -0x1300], counts: [0, 0, 0], lists: [null, null, 0x080709DE, 0x080709E0], done: 3 },
];

/**
 * 0x0801103C: an arena's limits and its lists of points, walls and floors, read from the cartridge. The rest of its
 * switch is in 0x080110F0, and 0x08011C2C is its end.
 */
export function loadArenaShape(c, arena) {
  arena &= 0xFF;
  if (arena > 11) return;
  const { limits, counts: [points, walls, floors], lists: [pointList, wallList, lookList, floorList], done } = SHAPES[arena];
  write16(c, LIMIT_A_HIGH, limits[0]);
  write16(c, LIMIT_A_LOW, limits[1]);
  write16(c, LIMIT_B_HIGH, limits[2]);
  write16(c, LIMIT_B_LOW, limits[3]);
  write8(c, POINT_COUNT, points);
  write8(c, WALL_COUNT, walls);
  write8(c, FLOOR_COUNT, floors);
  for (let i = 0; i < points; i++) write16(c, POINTS + i * 2, read16(c, pointList + i * 2));
  for (let i = 0; i < walls; i++) write8(c, WALL_POINTS + i, read8(c, wallList + i));
  for (let i = 0; i < walls; i++) write16(c, WALL_LOOKS + i * 2, read16(c, lookList + i * 2));
  for (let i = 0; i < floors; i++) write16(c, FLOORS + i * 2, read16(c, floorList + i * 2));
  write8(c, SHAPE_DONE, done);
}

/** The 16 bytes of a queued sprite as the four words the original passes in r0 to r3. */
function queueSprite(c, s) {
  fn08017f00(c,
    ((s.x & 0xFFFF) | (s.y << 16)) >>> 0,
    ((s.height & 0xFFFF) | (s.depth << 16)) >>> 0,
    ((s.tile & 0xFFFF) | ((s.byte10 & 0xFF) << 16) | ((s.matrix & 0xFF) << 24)) >>> 0,
    ((s.colours & 0xFF) | ((s.shape & 0xFF) << 8) | ((s.byte14 & 0xFF) << 16) | ((s.flip & 0xFF) << 24)) >>> 0);
}

/**
 * The first half of 0x08011C7C: each wall that's in view queued as a stretched sprite, from the points the camera has
 * just placed. The original never writes three of the sprite's bytes here, so they keep what its last call left on
 * the stack: after 0x0800F9C0 and 0x0800F3C4, as in a fight's every frame, two are 0 and one is 8, the top byte of
 * the address 0x0800F3C4 returns to. A frame that skips 0x0800F9C0 leaves others, which aren't worked out here.
 */
function drawWalls(c) {
  const sprite = { x: 0, y: 0, height: 0, depth: 0, tile: 0, byte10: 0, matrix: 0, colours: 0, shape: 0, byte14: 0, flip: 8 };
  for (let i = 0; i < read8(c, POINT_COUNT); i = (i + 2) & 0xFF) {
    const x = SCREEN_POINTS + i * 2, y = SCREEN_POINTS + (i + 1) * 2;
    fn0801816c(c, x, y, reads16(c, POINTS + i * 2), reads16(c, POINTS + (i + 1) * 2));
    fn08018204(c, x, y, reads16(c, x), reads16(c, y));
  }
  const screenX = n => SCREEN_POINTS + n * 2;
  for (let i = 0; i < read8(c, WALL_COUNT); i = (i + 2) & 0xFF) {
    const a = read8(c, WALL_POINTS + i), b = read8(c, WALL_POINTS + i + 1);
    const middleX = (reads16(c, screenX(a)) + reads16(c, screenX(b))) >> 1;
    const middleY = (reads16(c, screenX(a + 1)) + reads16(c, screenX(b + 1))) >> 1;
    const height = read16(c, CAMERA_HEIGHT);
    const y = middleY - (((height << 16) >> 17) + 32);
    sprite.x = middleX - 32;
    sprite.y = y & 0xFFFF;
    if ((((middleX + 32) << 16) >>> 0) > 0x01300000) continue;
    const top = (y << 16) >> 16;
    if (top > read8(c, SCREEN_BOTTOM) || top < read8(c, SCREEN_TOP) - 64) continue;
    if (reads16(c, screenX(a)) >= reads16(c, screenX(b))) continue;
    sprite.shape = 0;
    sprite.depth = (y + height) & 0xFFFF;
    sprite.matrix = read8(c, MATRIX_COUNT);
    const look = read16(c, WALL_LOOKS + i * 2);
    sprite.tile = look * 28 + 616;
    sprite.colours = read8(c, WALL_LOOKS + (i + 1) * 2) + 10;
    const difference = read16(c, screenX(b)) - read16(c, screenX(a));
    let across = difference & 0xFFFF;
    let down = (read16(c, screenX(b + 1)) - read16(c, screenX(a + 1))) & 0xFFFF;
    const wide = (difference << 16) >> 16;
    // a short wall takes a smaller sprite, its picture further on
    if (wide <= 15) {
      sprite.x = middleX - 8;
      across = (wide << 2) & 0xFFFF;
      down = (down << 2) & 0xFFFF;
      sprite.shape = 2;
      sprite.tile = look * 28 + 640;
    } else if (wide <= 31) {
      sprite.x = middleX - 16;
      across = (wide << 1) & 0xFFFF;
      down = (down << 1) & 0xFFFF;
      sprite.shape = 1;
      sprite.tile = look * 28 + 632;
    }
    across = (across << 16) >> 16;
    const lean = reads16(c, CAMERA_HEIGHT) << 3;
    const first = divArm(across, 8192) & 0xFFFF;
    const second = (-divArm(lean, divArm(across, down << 16))) & 0xFFFF;
    const third = divArm(reads16(c, CAMERA_HEIGHT) << 3, 65536) << 16;
    queueSprite(c, sprite);
    fn08017f34(c, first, (second | third) >>> 0);
  }
}

/** `count` 16-bit colours from `table`, starting at its entry `from` and `step` entries apart, into the buffer `to` from its place `at`. */
function colourRun(c, to, at, table, from, count, step = 1) {
  for (let i = 0; i < count; i++) write16(c, to + (at + i) * 2, read16(c, table + (from + i * step) * 2));
}

/** * The second half of 0x08011C7C, which goes on in 0x080120C8, 0x080122DC and 0x08012468: this arena's moving colours,
 * a step each frame.
 */
function moveColours(c) {
  if (read8(c, COLOURS_MOVE) === 0) return;
  const arena = read8(c, ARENA);
  write8(c, COLOUR_FRAME, read8(c, COLOUR_FRAME) + 1);
  if (read8(c, COLOUR_FRAME) >= read8(c, COLOUR_FRAMES + arena)) write8(c, COLOUR_FRAME, 0);
  const frame = read8(c, COLOUR_FRAME);
  switch (arena) {
    case 0:
      // the two tables run backward, from the 13th colour down to the second
      for (let i = 0; i < 12; i++) {
        write16(c, COLOURS_A + (12 - i) * 2, read16(c, 0x080710D2 + ((frame >> 2) + i) * 2));
      }
      for (let i = 0; i < 12; i++) {
        write16(c, COLOURS_B + (12 - i) * 2, read16(c, 0x08071102 + ((frame >> 2) + i) * 2));
      }
      copy16(c, COLOURS_A, PALETTE_1A0, 16);
      copy16(c, COLOURS_B, PALETTE_1C0, 16);
      break;
    case 1:
      colourRun(c, COLOURS_A, 0, 0x0807104A, frame >> 1, 12);
      colourRun(c, COLOURS_A, 12, 0x0807107A, frame >> 1, 4, 2);
      copy16(c, COLOURS_A, PALETTE_1C0, 16);
      break;
    case 3:
      colourRun(c, COLOURS_A, 0, 0x08070F66, frame, 16);
      colourRun(c, COLOURS_B, 0, 0x08070FA6, frame, 16);
      copy16(c, COLOURS_A, PALETTE_1A0, 16);
      copy16(c, COLOURS_B, PALETTE_1C0, 16);
      break;
    case 4:
      colourRun(c, COLOURS_A, 0, 0x08070FE6, frame >> 2, 5);
      colourRun(c, COLOURS_A, 5, 0x08070FFA, frame >> 2, 5);
      colourRun(c, COLOURS_A, 10, 0x0807100E, frame >> 4, 2);
      colourRun(c, COLOURS_A, 12, 0x08071022, frame >> 3, 2);
      colourRun(c, COLOURS_A, 14, 0x08071036, frame >> 4, 2);
      copy16(c, COLOURS_A, PALETTE_1C0, 16);
      break;
    case 6:
    case 7:
      colourRun(c, COLOURS_A, 0, 0x08070F26, frame >> 1, 16);
      copy16(c, COLOURS_A, PALETTE_1C0, 16);
      break;
    case 9:
      write16(c, COLOURS_A, 0);
      colourRun(c, COLOURS_A, 1, 0x08071132, frame >> 1, 15);
      copy16(c, COLOURS_A, PALETTE_002, 16);
      break;
    case 11:
      write16(c, COLOURS_A, 0);
      colourRun(c, COLOURS_A, 1, 0x080710BA, frame >> 2, 6);
      for (let i = 7; i < 16; i++) write16(c, COLOURS_A + i * 2, 0);
      copy16(c, COLOURS_A, PALETTE_060, 16);
      break;
    default:
  }
}

/** 0x08011C7C: the arena's walls queued, and its moving colours moved. */
export function drawArena(c) {
  drawWalls(c);
  moveColours(c);
}

/**
 * 0x0800F9C0, which the code map splits at its switch's second case, 0x0800FA68: each thing in the arena placed by the
 * camera, each of its parts in view queued as a sprite, and then its new pictures asked for.
 */
export function drawArenaThings(c) {
  // the original's sprite lives on its stack: a part it doesn't draw queues the last one again, and the first such
  // part of all queues what the stack held before, taken as nothing here
  const sprite = { x: 0, y: 0, height: 0, depth: 0, tile: 0, byte10: 0, matrix: 0, colours: 0, shape: 0, byte14: 0, flip: 0 };
  let depth = 0;
  for (let n = 0; n < THING_COUNT; n++) {
    const thing = THINGS + n * THING_SIZE;
    if (read16(c, thing + THING_KIND) === 0) continue;
    const x = thing + THING_X, y = thing + THING_Y;
    fn0801816c(c, x, y, reads16(c, thing + THING_AT_X), reads16(c, thing + THING_AT_Y));
    fn08018204(c, x, y, reads16(c, x), reads16(c, y));
    const left = read16(c, x), top = read16(c, y);
    switch (read8(c, thing + THING_SIZE_KIND)) {
      case 0: write16(c, x, left - 8); write16(c, y, top - 8); depth = (top - 1) & 0xFFFF; break;
      case 1: write16(c, x, left - 16); write16(c, y, top - 8); depth = (top - 1) & 0xFFFF; break;
      case 2: write16(c, x, left - 8); write16(c, y, top - 16); depth = (top - 2) & 0xFFFF; break;
      case 3: write16(c, x, left - 16); write16(c, y, top - 16); depth = (top - 2) & 0xFFFF; break;
      case 4: write16(c, x, left - 4); write16(c, y, top - 4); depth = top; break;
      default:
    }
    const placedX = reads16(c, x), placedY = reads16(c, y);
    if ((((placedX + 64) << 16) >>> 0) > 0x01300000) continue;
    const row = placedY - reads16(c, thing + THING_HEIGHT);
    if (row > read8(c, SCREEN_BOTTOM) || row < read8(c, SCREEN_TOP) - 64) continue;
    faceCamera(c, thing);
    const parts = () => read8(c, KIND_PARTS + read16(c, thing + THING_KIND));
    for (let part = 0; part < parts(); part = (part + 1) & 0xFF) {
      const picture = read8(c, thing + part);
      if (picture <= 26 && part <= 3) {
        const offset = read16(c, thing + THING_PART_X + part * 2);
        const flip = read8(c, thing + THING_FLIP);
        sprite.x = flip === 0 ? placedX + offset : placedX - offset;
        sprite.y = (placedY + read16(c, thing + THING_PART_Y + part * 2)) & 0xFFFF;
        sprite.height = read16(c, thing + THING_HEIGHT);
        sprite.byte10 = 3;
        sprite.depth = depth;
        sprite.flip = flip;
        sprite.matrix = 0;
        sprite.tile = (picture << 4) + 176;
        const colours = read8(c, thing + THING_COLOURS);
        sprite.colours = colours === 255 ? read8(c, thing + THING_OWNER) : colours === 254 ? 4 : colours + 5;
        sprite.shape = read8(c, thing + THING_SIZE_KIND) + 30;
        sprite.byte14 = 0;
      }
      queueSprite(c, sprite);
    }
  }
  write8(c, THINGS_DRAWN, 0);
  sendThingPictures(c);
}

/** Inside 0x0800F9C0: a thing turns to the side the camera sees it from, by the way it's facing. */
function faceCamera(c, thing) {
  const facing = read8(c, thing + THING_FACING);
  const base = read8(c, thing + THING_BASE_FLIP);
  const front = facing === 4 || facing === 7 || facing === 1;
  const back = facing === 6 || facing === 9 || facing === 3;
  const low = ((facing - 1) & 0xFF) <= 2, high = ((facing - 7) & 0xFF) <= 2;
  let flip = -1;
  switch (read8(c, VIEW)) {
    case 0: if (front) flip = base; else if (back) flip = base ^ 1; break;
    case 1: if (front) flip = base ^ 1; else if (back) flip = base; break;
    case 2: if (low) flip = base; else if (high) flip = base ^ 1; break;
    case 3: if (low) flip = base ^ 1; else if (high) flip = base; break;
    default:
  }
  if (flip >= 0) write8(c, thing + THING_FLIP, flip);
}

/** 0x0800F3C4, with its shared end at 0x0800F512: the pictures of each thing's parts that changed asked for. */
export function sendThingPictures(c) {
  for (let n = 0; n < THING_COUNT; n++) {
    const thing = THINGS + n * THING_SIZE;
    if (read16(c, thing + THING_KIND) === 0) continue;
    const parts = () => read8(c, KIND_PARTS + read16(c, thing + THING_KIND));
    for (let part = 0; part < parts(); part = (part + 1) & 0xFF) {
      const wanted = thing + THING_PICTURES + part * 2;
      if (read16(c, wanted) === NOTHING_NEW) continue;
      const owner = read8(c, thing + THING_OWNER);
      const first = ((read8(c, SETUP + OWNER_CHARACTER + owner) - 9) & 0xFF) <= 7 || read8(c, SETUP + OWNER_OTHER + owner) !== 0;
      const kind = read8(c, thing + THING_SIZE_KIND);
      if (kind <= 4) queuePicture(c, first ? PICTURES_ONE : PICTURES_TWO, PICTURE_BYTES[kind], read8(c, thing + part), read16(c, wanted));
      write16(c, wanted, NOTHING_NEW);
    }
  }
}

/**
 * 0x080204B8: a thing's picture asked for at the next V-blank, in the queue 0x0802036C fills. The original keeps its
 * kind and its numbers in the queue, and 0x08020244 works out the copy from them when it comes to it; here the copy is
 * worked out now, the same way, since core.js's queue holds copies already worked out. At most 32 a frame.
 */
export function queuePicture(c, from, bytes, place, picture) {
  if (c.copies.length > 31) return;
  c.copies.push([
    0x06011600 + ((place & 0xFF) << 9),
    from + (picture & 0xFFFF) * 32,
    // CpuFastSet copies words in eights
    ((((bytes & 0xFFFF) >> 3) + 7) & ~7) * 4,
  ]);
}

export { loadArena as fn0800fdc8 };
export { setArenaLayers as fn08010f1e };
export { loadArenaShape as fn0801103c };
export { drawArena as fn08011c7c };
export { drawArenaThings as fn0800f9c0 };
export { sendThingPictures as fn0800f3c4 };
export { queuePicture as fn080204b8 };
