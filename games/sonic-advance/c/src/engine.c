// The engine the Sonic Advance games are built on, translated from gba/engine.js (which follows SAT-R's src/core.c,
// src/task.c, src/sprite.c, src/background.c and src/malloc_vram.c): the list of tasks run once a frame in order of
// priority, the copies of the display registers they write and the V-blank that puts them in the hardware, the queue
// of graphics copied to VRAM in the V-blank, the background maps copied there, the heap the sprites' tiles are given
// room in, the sprites' OAM entries sorted by their order, the H-blank DMA that changes a register from one line to
// the next, and the keys with their auto-repeat.
//
// A frame is engine_run(): the keys are read, the tasks run, and the V-blank does its work, which the original does
// in its main loop (EngineMainLoop). The kit then draws the frame, with the H-blank DMA between its lines.

#include "sa.h"

#define MAX_TASKS 128
#define GFX_QUEUE 32
#define BG_QUEUE 16
#define OAM_ENTRIES 128
#define OAM_ORDERS 32
#define COPY_CHUNK 1024
#define OBJ_VRAM_SIZE 0x8000
#define HEAP_SEGMENT 0x80
#define HEAP_START (0x14000 - 112 * 32)
#define HEAP_SEGMENTS 156
#define VRAM_SIZE 0x18000

Engine e;
// In IWRAM the sprites' colours (gObjPalette) come right after the H-blank buffers, and the window effects (lines.c)
// can write a line past the end of the second, into the first two colours.
static uint8_t iwram[2 * HBLANK_BUFFER + 0x200] __attribute__((aligned(4)));

static Graphics *gfxQueue[GFX_QUEUE];
// gBgSprites: the sprites shown as a layer's map (sprite.c), written in the next V-blank
static Sprite *bgSprites[32];
static unsigned numBgSprites;
static Background *bgQueue[BG_QUEUE];
static unsigned gfxCursor, gfxIndex, bgCursor, bgIndex;

// --- tasks (task.c): a fixed pool of 128, the first two the list's ends --------------------------------------------
static uint8_t orderStart[OAM_ORDERS], orderEnd[OAM_ORDERS];
static uint16_t heap[OBJ_VRAM_SIZE / HEAP_SEGMENT];
static int lagging, copiesLate;   // frames the next screen update takes up, on top of its own
static Task pool[MAX_TASKS], *freeTasks[MAX_TASKS];
static unsigned numTasks;
static Task *head, *tail, *nextTask;
static void dummy(Task *t) { (void)t; }

void engine_init(void) {
  memset(&e, 0, sizeof e);
  e.dispCnt = 0x80;
  e.bgAffine[0].pa = e.bgAffine[0].pd = e.bgAffine[1].pa = e.bgAffine[1].pd = 0x100;
  e.hblank = iwram;
  e.objPalette = (uint16_t *)(iwram + 2 * HBLANK_BUFFER);
  for (int i = 0; i < OAM_ENTRIES * 4; i++) e.oamBuffer[i] = e.oamMalloc[i] = 0x200;
  memset(e.firstRepeat, 20, 10);
  memset(e.nextRepeat, 8, 10);
  memset(orderStart, 0xFF, sizeof orderStart); memset(orderEnd, 0xFF, sizeof orderEnd);
  memset(heap, 0, sizeof heap);
  memset(pool, 0, sizeof pool);
  lagging = copiesLate = 0;
  numBgSprites = 0;
  for (int i = 0; i < MAX_TASKS; i++) freeTasks[i] = &pool[i];
  numTasks = 0;
  head = freeTasks[numTasks++];
  tail = freeTasks[numTasks++];
  head->main = dummy; head->next = tail;
  tail->main = dummy; tail->priority = 0xFFFF; tail->prev = head;
}

/** TaskCreate: a task running `main(task)` each frame, put after every task of the same or lower priority. */
Task *create_task(TaskMain main, void *data, uint16_t priority, uint16_t flags, TaskMain dtor) {
  if (numTasks >= MAX_TASKS) return NULL;
  Task *t = freeTasks[numTasks++];
  t->main = main; t->dtor = dtor; t->priority = priority; t->flags = flags; t->data = data; t->parent = e.curTask;
  for (Task *slow = head, *fast = head->next; fast; slow = fast, fast = fast->next) {
    if (fast->priority > priority) { fast->prev = t; t->next = slow->next; t->prev = slow; slow->next = t; break; }
  }
  return t;
}

/** TaskDestroy: a task already destroyed, or one of the list's ends, stays as it is. */
void destroy_task(Task *t) {
  if (!t || t->flags & TASK_DESTROY_DISABLED || !t->prev || !t->next) return;
  if (t->dtor) t->dtor(t);
  if (t == nextTask) nextTask = t->next;
  t->prev->next = t->next; t->next->prev = t->prev;
  freeTasks[--numTasks] = t;
  t->parent = t->prev = NULL; t->main = dummy; t->priority = 0; t->flags = 0; t->data = NULL;
}

/** TasksDestroyInPriorityRange: the tasks from the first of priority `lo` or more, up to one of `hi` or more. */
void destroy_tasks(uint16_t lo, uint16_t hi) {
  for (Task *cur = head; cur; cur = cur->next) {
    if (cur->priority < lo) continue;
    while (cur && cur->priority < hi) {
      Task *prev = cur;
      cur = prev->next;
      if (prev != head && prev != tail) destroy_task(prev);
    }
    break;
  }
}

// a task keeping the CPU busy for whole frames (the flash's erase or write)
static struct { int frames; void (*then)(void); Task *task, *next; } stall;
static int stalling;
static void run_tasks(Task *from) {
  int paused = e.flags & FLAGS_PAUSED;
  for (Task *t = from; t; t = nextTask) {
    nextTask = t->next;
    e.curTask = t;
    if (!(t->flags & TASK_INACTIVE) && (!paused || t->flags & TASK_RUNS_PAUSED)) t->main(t);
    if (stalling) { stall.next = nextTask; break; }
  }
  e.curTask = nextTask = NULL;
}
/**
 * The running task keeps the CPU busy here for `frames` frames, with the interrupts off: no V-blank, so the screen
 * stays as it was and the frame count stops. Then `then()` goes on with the task's code, the tasks after it run, and
 * the frame ends with its V-blank. The keys aren't read again until the next frame.
 */
void engine_stall(int frames, void (*then)(void)) {
  stalling = 1;
  stall.frames = frames; stall.then = then; stall.task = e.curTask; stall.next = NULL;
}

/**
 * The screen update at the end of this frame (its V-blank's copies) is too much for one frame: the next `frames`
 * frames do nothing but count (VBlankIntr still runs), and the tasks run again after them. With `late`, the copy of
 * the backgrounds' maps is what takes the time: the registers, palettes and graphics of this frame's V-blank are
 * written and shown, and the maps come in the last of the frames after it.
 */
void engine_lag(int frames, int late) { lagging = frames; copiesLate = late; }

/** A sprite whose frame the next V-blank writes as a layer's map (DisplaySprite_BG). */
void queue_sprite_map(Sprite *s) { if (numBgSprites < 32) bgSprites[numBgSprites++] = s; }
/** Drops the sprites a screen showed as a layer's map, as a screen that doesn't use them starts. */
void clear_bg_sprites(void) { numBgSprites = 0; }

// --- copies to VRAM ------------------------------------------------------------------------------------------------
/** ADD_TO_GRAPHICS_QUEUE: `g` is copied in the next V-blank, as it is then. */
void queue_graphics(Graphics *g) { gfxQueue[gfxIndex] = g; gfxIndex = (gfxIndex + 1) % GFX_QUEUE; }
/** Drops what the queues hold, as screens do when they start. */
void clear_queues(void) { gfxCursor = gfxIndex; bgCursor = bgIndex; }
void queue_background(Background *bg) { bgQueue[bgIndex] = bg; bgIndex = (bgIndex + 1) % BG_QUEUE; }

// DmaCopy16 of `bytes` bytes from the ROM (or `from`) into VRAM
static void copy16(uint32_t src, uint32_t dest, uint32_t bytes, const uint8_t *from) {
  uint32_t n = bytes & ~1u;
  if (dest >= VRAM_SIZE) return;
  if (dest + n > VRAM_SIZE) n = VRAM_SIZE - dest;
  if (from) { memcpy(gba_vram + dest, from + src, n); return; }
  if (src >= gba_rom_size) return;
  if (src + n > gba_rom_size) n = gba_rom_size - src;
  memcpy(gba_vram + dest, gba_rom + src, n);
}
// ProcessVramGraphicsCopyQueue: 1 KB at a time, each entry's size counted down to 0
void engine_copy_graphics(void) {
  while (gfxCursor != gfxIndex) {
    Graphics *g = gfxQueue[gfxCursor];
    for (uint32_t offset = 0; g->size > 0; offset += COPY_CHUNK) {
      if (g->size > COPY_CHUNK) { copy16(g->src + offset, g->dest + offset, COPY_CHUNK, g->ram); g->size -= COPY_CHUNK; }
      else { copy16(g->src + offset, g->dest + offset, g->size, g->ram); g->size = 0; }
    }
    gfxCursor = (gfxCursor + 1) % GFX_QUEUE;
  }
}

static void put_vram16(uint32_t halfword, uint16_t v) {
  halfword &= 0xFFFF;
  if (halfword < VRAM_SIZE / 2) { gba_vram[halfword * 2] = (uint8_t)v; gba_vram[halfword * 2 + 1] = (uint8_t)(v >> 8); }
}
// sub_8004010: a rectangle of a layer's map filled with one entry, [first column, first row, last column, last row];
// a last column of 0xFF fills whole rows up to the last row, not including it (on a text layer, 32 entries a row, or
// 64 on a layer two blocks tall), a last row of 0xFF does the same on a rotating layer
static void fill_maps(void) {
  for (int bg = 0; bg < 4; bg++) {
    uint16_t value = e.mapFill[bg].value;
    uint8_t *rect = e.mapFill[bg].rect;
    if (rect[1] == rect[3] && rect[0] == rect[2]) continue;
    uint32_t cnt = e.bgCnt[bg], base = (cnt & 0x1F00) << 3;
    if (bg > 1 && (e.dispCnt & 3)) {
      uint32_t rowBytes = (0x100000u << (cnt >> 14)) >> 16, at = base + rect[0];
      uint16_t v = value | (value << 8);
      if (rect[3] == 0xFF) {
        uint32_t to = at + rowBytes * rect[1], n = (uint32_t)((int)(rect[3] - rect[1]) * (int)rowBytes / 2);
        for (uint32_t i = 0; i < n; i++) put_vram16((to >> 1) + i, v);
      } else {
        for (int r = rect[1]; r <= rect[3]; r++) {
          uint32_t to = at + rowBytes * r, n = ((rect[2] - rect[0] + 1) >> 1) >> 1;
          for (uint32_t i = 0; i < n; i++) put_vram16((to >> 1) + i, v);
        }
      }
    } else {
      uint32_t at = base + rect[0] * 2, tile = (((cnt >> 14) - 2) & 0xFF) <= 1 ? 64 : 32;
      if (rect[2] == 0xFF) {
        uint32_t to = at + tile * 2 * rect[1];
        int n = (rect[3] - rect[1]) * (int)tile;
        for (int i = 0; i < n; i++) put_vram16((to >> 1) + i, value);
      } else {
        for (int r = rect[1]; r <= rect[3]; r++) {
          uint32_t to = at + tile * 2 * r;
          for (int i = 0; i < rect[2] - rect[0] + 1; i++) put_vram16((to >> 1) + i, value);
        }
      }
    }
    memset(rect, 0, 4);
  }
}
// sub_8002B20, for the backgrounds that aren't a stage's map: each row of the map's rectangle at (unk1E, unk20),
// targetTilesX by targetTilesY, to the layer's map at (unk22, unk24), flipped if the flags say so; on a text layer two
// blocks wide the part of a row past column 32 goes to the next block
static void put_vram_byte16(uint32_t at, uint32_t v) {
  if (at + 1 < VRAM_SIZE) { gba_vram[at] = (uint8_t)v; gba_vram[at + 1] = (uint8_t)(v >> 8); }
}
static void copy_backgrounds(void) {
  while (bgCursor != bgIndex) {
    Background *bg = bgQueue[bgCursor];
    bgCursor = (bgCursor + 1) % BG_QUEUE;
    // scrolled background copies (0x20) and stage maps (0x40) aren't in C yet
    if (bg->flags & 0x60) continue;
    int id = bg->flags & 3, size = e.bgCnt[id] >> 14;
    int affine = id >= 2 && (e.dispCnt & 3) != 0;
    int bytes = affine ? 1 : 2, stride = (affine ? 0x10 << size : 32) * bytes;
    int nextBlock = !affine && (size == 1 || size == 3) ? 0x800 : 0;
    int rowSrc = bg->xTiles * bytes, w = bg->targetTilesX;
    uint32_t dest = bg->layoutVram + bg->unk24 * stride + bg->unk22 * bytes;
    if (bg->flags & 0x180) {
      // flipped: entries read from the row's end (0x100), rows from the bottom (0x80)
      int flipRows = bg->flags & 0x80, mirror = bg->flags & 0x100;
      uint32_t xor = (mirror ? 0x400 : 0) | (flipRows ? 0x800 : 0);
      int32_t src = bg->layout + ((flipRows ? bg->unk20 + bg->targetTilesY - 1 : bg->unk20) * bg->xTiles) * bytes
        + (mirror ? bg->unk1E + w - 1 : bg->unk1E) * bytes;
      for (int r = 0; r < bg->targetTilesY; r++) {
        for (int k = 0; k < w; k++) put_vram_byte16(dest + k * 2, rom_u16(mirror ? src - k * 2 : src + k * 2) ^ xor);
        dest += stride;
        src += flipRows ? -rowSrc : rowSrc;
      }
    } else {
      uint32_t src = bg->layout + bg->unk20 * bg->xTiles * bytes + bg->unk1E * bytes;
      int left = 32 - bg->unk22, right = w + bg->unk22 - 32;
      for (int r = 0; r < bg->targetTilesY; r++) {
        if ((size & 1) && bytes == 2 && left > 0 && right > 0) {
          copy16(src, dest, left * 2, NULL);
          copy16(src + left * 2, dest + nextBlock, right * 2, NULL);
        } else copy16(src, dest, w * bytes, NULL);
        dest += stride;
        src += rowSrc;
      }
    }
    bg->prevScrollX = bg->scrollX; bg->prevScrollY = bg->scrollY;
  }
}

// --- OAM (sprite.c: OamMalloc, ProcessOamBuffers) ------------------------------------------------------------------
static uint32_t firstPaused;   // gOamFirstPausedIndex
/** OamMalloc: the index of a new entry of `order` (0 in front, 31 at the back) in oamMalloc, or -1 if OAM is full. */
int alloc_oam(uint32_t order) {
  if (order > 31) order = 31;
  if (e.oamFreeIndex > OAM_ENTRIES - 1) return -1;
  int i = (int)e.oamFreeIndex;
  e.oamMalloc[i * 4 + 3] = 0xFF;
  if (orderStart[order] == 0xFF) orderStart[order] = (uint8_t)i;
  else e.oamMalloc[orderEnd[order] * 4 + 3] = (uint16_t)i;
  orderEnd[order] = (uint8_t)i;
  e.oamFreeIndex++;
  return i;
}
static void hide_oam(uint32_t i) { e.oamBuffer[i * 4] = e.oamBuffer[i * 4 + 1] = e.oamBuffer[i * 4 + 2] = 0x200; }
static void process_oam(void) {
  uint32_t dst = 0;
  for (int order = 0; order < OAM_ORDERS; order++) {
    for (int i = s8(orderStart[order]); i != -1; i = s8(e.oamMalloc[i * 4 + 3])) {
      e.oamBuffer[dst * 4] = e.oamMalloc[i * 4]; e.oamBuffer[dst * 4 + 1] = e.oamMalloc[i * 4 + 1]; e.oamBuffer[dst * 4 + 2] = e.oamMalloc[i * 4 + 2];
      dst++;
    }
  }
  // paused, the entries between this frame's and the ones moved to the end are hidden; on the first frame paused,
  // this frame's go to the end, last first, and the rest are hidden. Only the three attributes move.
  if (e.flags & FLAGS_PAUSED) for (uint32_t i = e.oamFreeIndex; i < firstPaused; i++) hide_oam(i);
  else if (e.flags & FLAGS_PAUSE_GAME) {
    for (uint32_t k = 0; k < e.oamFreeIndex; k++) memmove(&e.oamBuffer[(OAM_ENTRIES - 1 - k) * 4], &e.oamBuffer[(e.oamFreeIndex - 1 - k) * 4], 3 * 2);
    firstPaused = OAM_ENTRIES - e.oamFreeIndex;
    for (uint32_t i = 0; i < firstPaused; i++) hide_oam(i);
  } else {
    firstPaused = 0;
    // the entries no sprite took this frame are hidden, as the original's OAM buffer holds no leftovers
    for (uint32_t i = dst; i < OAM_ENTRIES; i++) hide_oam(i);
  }
  e.oamFreeIndex = 0;
  memset(orderStart, 0xFF, sizeof orderStart); memset(orderEnd, 0xFF, sizeof orderEnd);
}

// --- the sprites' VRAM heap (malloc_vram.c) ------------------------------------------------------------------------
// 156 segments of 4 tiles from 0x13200; an allocation's first entry holds how many segments it takes, 0 is free
/** VramMalloc: a VRAM offset for `tiles` tiles of sprite graphics, or HEAP_END if there is no room. */
uint32_t vram_malloc(uint32_t tiles) {
  uint32_t segments = (tiles + 3) / 4;
  for (uint32_t i = 0; i < HEAP_SEGMENTS; i++) {
    if (heap[i] == 0) {
      uint32_t j = 0;
      for (; j < segments; j++) {
        if (i + j >= HEAP_SEGMENTS) return HEAP_END;
        if (heap[i + j] != 0) break;
      }
      if (j == segments) { heap[i] = (uint16_t)segments; return HEAP_START + i * HEAP_SEGMENT; }
    } else i = (heap[i] - 1 + i) & 0xFFFF;
  }
  return HEAP_END;
}
/** Puts every heap segment back: a new act starts with the whole sprite heap free. */
void vram_reset(void) { memset(heap, 0, sizeof heap); }
/** VramFree */
void vram_free(uint32_t dest) {
  if (dest == HEAP_END) return;
  uint32_t i = ((int32_t)(dest - HEAP_START) / HEAP_SEGMENT) & 0xFFFF;
  if (i < OBJ_VRAM_SIZE / HEAP_SEGMENT) heap[i] = 0;
}

// --- the H-blank DMA -------------------------------------------------------------------------------------------------
/** Where the tasks write this frame's line-by-line values (gBgOffsetsHBlankPrimary), as a byte offset in e.hblank. */
void set_hblank_copy(uint32_t target, uint32_t size) { e.flags |= FLAGS_HBLANK_COPY; e.hblankTarget = target; e.hblankSize = size; }
static void copy_hblank_line(uint32_t target, uint32_t at, uint32_t size) {
  for (uint32_t k = 0; k < size; k += 2) {
    if (at + k + 1 < sizeof iwram) gba_write(target + k, (uint16_t)(e.hblank[at + k] | e.hblank[at + k + 1] << 8));
  }
}
static void copy_hblank_entry(uint32_t at) { copy_hblank_line(e.hblankTarget, at, e.hblankSize); }
// this frame's H-blank DMA: where it starts reading
static struct { int on; uint32_t at, target, size; } hdma;
static uint32_t hdmaAt;

// --- keys (core.c: GetInput) ---------------------------------------------------------------------------------------
static void read_keys(void) {
  e.input = e.keys & 0x3FF;
  e.pressed = (e.input ^ e.prevInput) & e.input;
  e.released = (e.input ^ e.prevInput) & e.prevInput;
  e.prevInput = e.input;
  e.repeated = e.pressed;
  for (int i = 0; i < 10; i++) {
    if (!(e.input & (1 << i))) e.repeatCounters[i] = e.firstRepeat[i];
    else if (e.repeatCounters[i] > 0) e.repeatCounters[i]--;
    else { e.repeated |= 1 << i; e.repeatCounters[i] = e.nextRepeat[i]; }
  }
}

// --- the V-blank (VBlankIntr, UpdateScreenDma, ClearOamBufferDma) ------------------------------------------------
static void vblank(void) {
  hdma.on = 0;
  if (e.flagsPreVBlank & FLAGS_HBLANK_COPY) {
    copy_hblank_entry(e.primary);
    hdma.on = 1; hdma.at = e.primary + e.hblankSize; hdma.target = e.hblankTarget; hdma.size = e.hblankSize;
  } else e.hblankTarget = 0;
  e.frameCount++;

  gba_write(REG_DISPCNT, e.dispCnt);
  for (int i = 0; i < 4; i++) gba_write(REG_BG0CNT + i * 2, e.bgCnt[i]);
  if (e.flags & FLAGS_UPDATE_BG_PALETTES) { memcpy(gba_pal, e.bgPalette, 512); e.flags ^= FLAGS_UPDATE_BG_PALETTES; }
  if (e.flags & FLAGS_UPDATE_OBJ_PALETTES) { memcpy(gba_pal + 256, e.objPalette, 512); e.flags ^= FLAGS_UPDATE_OBJ_PALETTES; }
  for (int i = 0; i < 6; i++) gba_write(REG_WIN0H + i * 2, e.winRegs[i]);
  gba_write(REG_BLDCNT, e.bldCnt); gba_write(REG_BLDALPHA, e.bldAlpha); gba_write(REG_BLDY, e.bldY);
  for (int i = 0; i < 8; i++) gba_write(REG_BG0HOFS + i * 2, e.bgScroll[i]);
  for (int i = 0; i < 2; i++) {
    const Affine *a = &e.bgAffine[i];
    unsigned at = REG_BG2PA + i * 0x10;
    gba_write(at, (uint16_t)a->pa); gba_write(at + 2, (uint16_t)a->pb); gba_write(at + 4, (uint16_t)a->pc); gba_write(at + 6, (uint16_t)a->pd);
    gba_write(at + 8, (uint16_t)a->x); gba_write(at + 10, (uint16_t)((uint32_t)a->x >> 16));
    gba_write(at + 12, (uint16_t)a->y); gba_write(at + 14, (uint16_t)((uint32_t)a->y >> 16));
  }
  if (e.flags & FLAGS_HBLANK_COPY) copy_hblank_entry(e.primary);
  process_oam();
  memcpy(gba_oam, e.oamBuffer, sizeof e.oamBuffer);
  engine_copy_graphics();
  fill_maps();
  for (unsigned i = 0; i < numBgSprites; i++) write_sprite_map(bgSprites[i]);
  numBgSprites = 0;
  if (!copiesLate) copy_backgrounds();

  // ClearOamBufferDma, which the original skips while the game is paused
  if (!(e.flags & FLAGS_PAUSE_GAME)) {
    if (!(e.flags & FLAGS_KEEP_HBLANK_BUFFER)) e.primary = e.primary ? 0 : HBLANK_BUFFER;
    e.flags &= ~FLAGS_HBLANK_COPY;
    for (int i = 0; i < OAM_ENTRIES * 4; i++) e.oamBuffer[i] = 0x200;
  }
  if (e.flags & FLAGS_PAUSE_GAME) e.flags |= FLAGS_PAUSED;
  else e.flags &= ~FLAGS_PAUSED;
}

/** One frame: the keys, the tasks and the V-blank. Then the kit draws it. */
void engine_run(void) {
  if (lagging) {
    lagging--;
    e.frameCount++;
    if (!lagging && copiesLate) { copiesLate = 0; copy_backgrounds(); }
    return;
  }
  if (stalling) {
    if (--stall.frames > 0) return;
    void (*then)(void) = stall.then;
    Task *task = stall.task, *next = stall.next;
    stalling = 0;
    e.curTask = task;
    then();
    e.curTask = NULL;
    if (next) run_tasks(next);
  } else {
    read_keys();
    run_tasks(head);
  }
  if (stalling) return;
  e.flagsPreVBlank = e.flags;
  vblank();
}

// the H-blank DMA between the lines as the kit draws the frame: after each line, the next line's values
static void hblank_line(int y) {
  (void)y;
  copy_hblank_line(hdma.target, hdmaAt, hdma.size);
  hdmaAt += hdma.size;
}
/** Sets the kit's drawing of this frame up, with the H-blank DMA its V-blank started. */
void engine_draw_setup(void) {
  hdmaAt = hdma.at;
  gba_on_hblank(hdma.on ? hblank_line : NULL);
}
