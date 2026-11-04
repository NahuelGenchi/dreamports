// A level's lines of collision, kept in a tree of boxes, as the original has them, rewritten from its own instructions.
// Each function is named by its address in the USA copy.

const CARTRIDGE = 0x08000000;

/** The kinds of line (0x08037ED4's first argument), by what meets them: floors, that can be jumped through from below, and others. */
export const FLOOR_THROUGH = 4, FLOOR = 3, WALL_ON_LEFT = 1, WALL_ON_RIGHT = 2, CEILING = 5;

// the tree at an address in the cartridge: each node a box, its lines and up to four nodes inside it
function readNode(rom, address) {
  const at = address - CARTRIDGE, i32 = n => rom.view.getInt32(at + n, true);
  const lines = [], list = rom.u32(at + 20) - CARTRIDGE;
  for (let n = 0, count = rom.u32(at + 16); n < count; n++) {
    const from = list + n * 24, s32 = k => rom.view.getInt32(from + k, true);
    lines.push({ x1: s32(0), y1: s32(4), x2: s32(8), y2: s32(12), kind: s32(16), extra: rom.u32(from + 20) });
  }
  const inside = [];
  for (let n = 0; n < 4; n++) {
    const child = rom.u32(at + 24 + n * 4);
    if (child) inside.push(readNode(rom, child));
  }
  return { x1: i32(0), y1: i32(4), x2: i32(8), y2: i32(12), lines, inside };
}

/** 0x0803817C: a level's collision, from the word its definition keeps at 20. */
export const readCollision = (rom, address) => readNode(rom, address);

// 0x0800025C
const divide = (a, b) => Math.trunc(a / b);

// 0x08037D3C: whether a line crosses a box, cutting it down to the box a side at a time
function crosses(box, line) {
  let { x1, y1, x2, y2 } = line;
  if (x1 > box.x2 || x2 < box.x1) return false;
  const outside = (x, y) => (y > box.y2 ? 1 : y < box.y1 ? 2 : 0) | (x > box.x2 ? 4 : x < box.x1 ? 8 : 0);
  let a = outside(x1, y1), b = outside(x2, y2);
  for (;;) {
    if (a & b) return false;
    if (!(a | b)) return true;
    const side = a || b;
    let x, y;
    if (side & 1) { y = box.y2; x = x1 + divide(Math.imul(box.y2 - y1, x2 - x1), y2 - y1); }
    else if (side & 2) { y = box.y1; x = x1 + divide(Math.imul(box.y1 - y1, x2 - x1), y2 - y1); }
    else if (side & 4) { x = box.x2; y = y1 + divide(Math.imul(box.x2 - x1, y2 - y1), x2 - x1); }
    else { x = box.x1; y = y1 + divide(Math.imul(box.x1 - x1, y2 - y1), x2 - x1); }
    if (side === a) { x1 = x; y1 = y; a = outside(x, y); }
    else { x2 = x; y2 = y; b = outside(x, y); }
  }
}

// 0x08037ED4
function search(node, kind, box, into) {
  if (box.x1 > node.x2 || node.x1 > box.x2 || box.y1 > node.y2 || node.y1 > box.y2) return;
  for (const line of node.lines) if (line.kind === kind && crosses(box, line)) into.push(line);
  for (const child of node.inside) search(child, kind, box, into);
}

/** 0x080380C8: the lines of a kind crossing a box given in eighths of a pixel, added to `into`, and how many. */
export function findLines(tree, kind, x, y, w, h, into = []) {
  const before = into.length;
  search(tree, kind, { x1: x >> 8, y1: y >> 8, x2: (x + w) >> 8, y2: (y + h) >> 8 }, into);
  return into.length - before;
}

/** 0x080382A8 with its last argument 0, and 0x08038258: the point of a line over or under a place. */
export function pointAbove(line, x, y) {
  const across = line.x2 - line.x1, down = line.y2 - line.y1;
  if (across === 0) return { x: line.x1 << 8, y };
  if (down === 0) return { x, y: line.y1 << 8 };
  const slope = divide(down * 65536, across), px = x >> 8;
  if (px >= line.x1 && px <= line.x2) return { x, y: (line.y1 << 8) + (Math.imul(slope, x - (line.x1 << 8)) >> 16) };
  return { x, y };
}

/** 0x080382A8 with its last argument 1, and 0x080381F0: the point of a line beside a place. */
export function pointBeside(line, x, y) {
  const across = line.x2 - line.x1, down = line.y2 - line.y1;
  if (across === 0) return { x: line.x1 << 8, y };
  if (down === 0) return { x, y: line.y1 << 8 };
  const slope = divide(down * 65536, across), py = y >> 8;
  if ((py >= line.y1 && py <= line.y2) || (py <= line.y1 && py >= line.y2)) {
    return { x: (line.x1 << 8) + divide((y - (line.y1 << 8)) * 65536, slope), y };
  }
  return { x, y };
}

/** 0x080381B4: whether a point is within a line's box. */
export function within(line, x, y) {
  const px = x >> 8, py = y >> 8;
  return line.x1 <= px && line.x2 >= px && Math.min(line.y1, line.y2) <= py && Math.max(line.y1, line.y2) >= py;
}
