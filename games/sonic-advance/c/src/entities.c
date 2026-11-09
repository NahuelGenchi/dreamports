// The act's entities: the interactables, item boxes and enemies of its level, read from the copy, and the manager that
// spawns each as the camera comes near. Translated from the JavaScript version's rom/entities.js and the entities manager in
// engine/objects.js (createEntities).

#include "objects.h"

// --- the copy's lists (rom/entities.js rlDecompress, readGrid) -----------------------------------------------------
enum { MAX_UNPACKED = 8192, RL_HEADER = 0x30 };
static uint8_t unpacked[MAX_UNPACKED];

/** The BIOS's RLUnComp: header 0x30 with the size, then runs and literal blocks. */
static int rl_uncomp(uint32_t at) {
  uint32_t header = rom_u32(at);
  if ((header & 0xFF) != RL_HEADER) return 0;
  uint32_t size = header >> 8, n = 0, i = at + 4;
  if (size > MAX_UNPACKED) return 0;
  while (n < size) {
    uint32_t flag = rom_u8(i++);
    if (flag & 0x80) {
      uint32_t b = rom_u8(i++);
      for (uint32_t k = (flag & 0x7F) + 3; k > 0 && n < size; k--) unpacked[n++] = (uint8_t)b;
    } else {
      for (uint32_t k = (flag & 0x7F) + 1; k > 0 && n < size; k--) unpacked[n++] = (uint8_t)rom_u8(i++);
    }
  }
  return 1;
}

int grid_load(uint32_t table, int level, Grid *grid) {
  memset(grid, 0, sizeof *grid);
  if (!rl_uncomp(rom_ptr(table + (uint32_t)level * 4))) return 0;
  grid->data = unpacked;
  grid->regionsX = (int)le32(unpacked, 4);
  grid->regionsY = (int)le32(unpacked, 8);
  return grid->regionsX * grid->regionsY <= MAX_REGIONS;
}

int grid_records(const Grid *grid, int r) {
  uint32_t offset = le32(grid->data, 12 + r * 4);
  return offset ? (int)(4 + offset) : -1;
}

// --- the slots, region by region -----------------------------------------------------------------------------------------
enum { MAX_SLOTS = 2048 };
static Slot slots[MAX_SLOTS];
static uint16_t slotRegion[MAX_SLOTS];     // the region a slot is in
static uint16_t order[MAX_SLOTS];          // the slots by region, each region's in the order of its lists
static int regionFirst[MAX_REGIONS + 1];   // where each region's slots start in `order`
static int slotCount, regionsX, regionsY;
static int prevX, prevY, scanned;          // the camera the last scan saw

static void read_list(uint32_t table, int level, int list, int size) {
  Grid g;
  if (!grid_load(table, level, &g)) return;
  for (int r = 0; r < g.regionsX * g.regionsY; r++) {
    int at = grid_records(&g, r);
    if (at < 0) continue;
    for (; g.data[at] != 0xFF && slotCount < MAX_SLOTS; at += size) {
      Slot *s = &slots[slotCount];
      memset(s, 0, sizeof *s);
      s->e.x = g.data[at] * 8 + (r % g.regionsX) * REGION_SIZE;
      s->e.y = g.data[at + 1] * 8 + (r / g.regionsX) * REGION_SIZE;
      s->e.kind = g.data[at + 2];
      for (int k = 0; k < size - 3; k++) s->e.d[k] = g.data[at + 3 + k];
      s->list = list;
      slotRegion[slotCount++] = (uint16_t)r;
    }
  }
}

void entities_load(int level) {
  Grid g;
  slotCount = 0;
  regionsX = regionsY = 0;
  if (grid_load(TABLE_INTERACTABLES, level, &g)) { regionsX = g.regionsX; regionsY = g.regionsY; }
  // each region keeps its interactables, then its item boxes, then its enemies
  read_list(TABLE_INTERACTABLES, level, ENTITY_INTERACTABLE, 7);
  read_list(TABLE_ITEM_BOXES, level, ENTITY_ITEM_BOX, 3);
  read_list(TABLE_ENEMIES, level, ENTITY_ENEMY, 7);
  // a counting sort by region, which keeps the order within one
  int regions = regionsX * regionsY;
  memset(regionFirst, 0, sizeof regionFirst);
  for (int i = 0; i < slotCount; i++) regionFirst[slotRegion[i] + 1]++;
  for (int r = 0; r < regions; r++) regionFirst[r + 1] += regionFirst[r];
  static int fill[MAX_REGIONS];
  memset(fill, 0, sizeof fill);
  for (int i = 0; i < slotCount; i++) {
    int r = slotRegion[i];
    order[regionFirst[r] + fill[r]++] = (uint16_t)i;
  }
  scanned = 0;
}

// --- the manager (createEntities' manager) ---------------------------------------------------------------------------------
// CamCoord's clamps: below 0 to 0, past the grid to its last pixel
static int clamp_x(int v) { int max = regionsX * REGION_SIZE - 1; return v < 0 ? 0 : v > max ? max : v; }
static int clamp_y(int v) { int max = regionsY * REGION_SIZE - 1; return v < 0 ? 0 : v > max ? max : v; }

/** Spawns what lies in the range and isn't there yet: the regions scanned are those that start before its far edges. */
static void scan(int x0, int x1, int y0, int y1) {
  for (int ry = y0 >> 8; ry * REGION_SIZE < y1 && ry < regionsY; ry++) {
    for (int rx = x0 >> 8; rx * REGION_SIZE < x1 && rx < regionsX; rx++) {
      int r = rx + ry * regionsX;
      for (int i = regionFirst[r]; i < regionFirst[r + 1]; i++) {
        Slot *s = &slots[order[i]];
        if (s->live || s->gone || s->e.x < x0 || s->e.x > x1 || s->e.y < y0 || s->e.y > y1) continue;
        s->live = entity_spawn(s);
      }
    }
  }
}

int entities_manager(ActTask *t) {
  (void)t;
  int cx = cam_x(), cy = cam_y();
  if (!scanned || cx - prevX > 248 || prevX - cx > 248 || cy - prevY > 208 || prevY - cy > 208) {
    scan(clamp_x(cx - 128), clamp_x(cx + 368), clamp_y(cy - 128), clamp_y(cy + 288));
    scanned = 1; prevX = cx; prevY = cy;
    return 1;
  }
  // the strip uncovered sideways, the full height of the range, then the one uncovered up or down, its full width
  int ax0 = cx > prevX ? prevX + 368 : cx - 128, ax1 = cx > prevX ? cx + 368 : prevX - 128;
  int by0 = cy > prevY ? prevY + 288 : cy - 128, by1 = cy > prevY ? cy + 288 : prevY - 128;
  int a[4] = { clamp_x(ax0), clamp_x(ax1), clamp_y(cy - 128), clamp_y(cy + 288) };
  int b[4] = { clamp_x(cx - 128), clamp_x(cx + 368), clamp_y(by0), clamp_y(by1) };
  if (cx != prevX && a[0] != a[1] && a[2] != a[3]) scan(a[0], a[1], a[2], a[3]);
  if (cy != prevY && b[2] != b[3] && b[0] != b[1]) scan(b[0], b[1], b[2], b[3]);
  prevX = cx; prevY = cy;
  return 1;
}
