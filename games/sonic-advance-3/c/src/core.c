// Sonic Advance 3's engine, written from how the original does it, as the JavaScript version's core.js is: tasks, the
// graphics queue, the OAM's orders, and the screen update a frame ends with. A frame is core_step(): the keys and the
// tasks (EngineMainLoop), then what the V-blank copies (UpdateScreenDma, ClearOamBufferDma).

#include "core.h"

// The frames from power-on to the first frame the game shows, with the screen white (forced blank) all along: clearing
// the memory, starting the sound engine and looking at the save. None of it shows; only how long it takes does, which
// is the console's timing, as mGBA measures it.
#define START_UP_FRAMES 8

#define OAM_ENTRIES 128
#define OAM_ORDERS 32
#define MAX_TASKS 64
#define MAX_GRAPHICS 64
#define MAX_BACKGROUNDS 8
#define COPY_CHUNK 1024

Core c;

static Task taskPool[MAX_TASKS];
static uint8_t taskUsed[MAX_TASKS];
// the tasks in the order they run, and the one to run after the one running
static Task *tasks[MAX_TASKS];
static int taskCount;
static Task *nextTask;

typedef struct { uint32_t src, dest, size; } Graphics;
static Graphics graphics[MAX_GRAPHICS];
static int graphicsCount;

typedef struct { uint32_t layout, layoutVram; uint16_t xTiles, targetTilesX, targetTilesY, flags; } QueuedBackground;
static QueuedBackground backgrounds[MAX_BACKGROUNDS];
static int backgroundCount;

// each entry's three attributes, and in its fourth half-word the next entry of the same order (0xFF: the last)
uint16_t oam_malloc[OAM_ENTRIES * 4];
static uint8_t orderStart[OAM_ORDERS], orderEnd[OAM_ORDERS];
static uint32_t oamFree;

static int task_index(const Task *t) {
  for (int i = 0; i < taskCount; i++) if (tasks[i] == t) return i;
  return -1;
}

/** 0x080BCB6C, TaskCreate: a task running `main(task)` each frame, after every task of the same or lower priority. */
Task *create_task(TaskMain main, void *data, uint16_t priority) {
  int slot = 0;
  while (slot < MAX_TASKS && taskUsed[slot]) slot++;
  if (slot == MAX_TASKS || taskCount == MAX_TASKS) return NULL;
  taskUsed[slot] = 1;
  Task *t = &taskPool[slot];
  t->main = main;
  t->data = data;
  t->priority = priority;
  int at = 0;
  while (at < taskCount && tasks[at]->priority <= priority) at++;
  for (int i = taskCount; i > at; i--) tasks[i] = tasks[i - 1];
  tasks[at] = t;
  taskCount++;
  return t;
}

/** 0x080BCC04, TaskDestroy */
void destroy_task(Task *t) {
  int at = task_index(t);
  if (at < 0) return;
  if (t == nextTask) nextTask = at + 1 < taskCount ? tasks[at + 1] : NULL;
  for (int i = at; i < taskCount - 1; i++) tasks[i] = tasks[i + 1];
  taskCount--;
  taskUsed[t - taskPool] = 0;
}

/** ADD_TO_GRAPHICS_QUEUE: `size` bytes from `src` in the ROM copied to `dest` in VRAM in the next V-blank. */
void queue_graphics(uint32_t src, uint32_t dest, uint32_t size) {
  if (graphicsCount == MAX_GRAPHICS) return;
  graphics[graphicsCount++] = (Graphics){ src, dest, size };
}

void queue_background(uint32_t layout, uint16_t xTiles, uint32_t layoutVram, uint16_t targetTilesX, uint16_t targetTilesY,
                      uint16_t flags) {
  if (backgroundCount == MAX_BACKGROUNDS) return;
  backgrounds[backgroundCount++] = (QueuedBackground){ layout, layoutVram, xTiles, targetTilesX, targetTilesY, flags };
}

// what goes past the end of video memory is lost, as when the sprites' heap had no room
static void copy16(uint32_t src, uint32_t dest, uint32_t bytes) {
  bytes &= ~1u;
  if (dest + bytes > sizeof gba_vram || src + bytes > gba_rom_size) return;
  memcpy(gba_vram + dest, gba_rom + src, bytes);
}

// ProcessVramGraphicsCopyQueue, COPY_CHUNK at a time in the original, which comes to the same here
static void copy_graphics(void) {
  for (int i = 0; i < graphicsCount; i++) {
    const Graphics *g = &graphics[i];
    for (uint32_t offset = 0; offset < g->size; offset += COPY_CHUNK) {
      uint32_t left = g->size - offset;
      copy16(g->src + offset, g->dest + offset, left < COPY_CHUNK ? left : COPY_CHUNK);
    }
  }
  graphicsCount = 0;
}

// sa2__sub_8002B20: each row of the map's rectangle to the layer's map. On a text layer two blocks wide the part of a
// row past column 32 goes to the next block, and a rotating layer's map has a byte for each tile
static void copy_backgrounds(void) {
  for (int i = 0; i < backgroundCount; i++) {
    const QueuedBackground *bg = &backgrounds[i];
    if ((bg->flags & 3) >= 2 && (c.dispCnt & 3)) {
      for (int row = 0; row < bg->targetTilesY; row++)
        copy16(bg->layout + row * bg->xTiles, bg->layoutVram + row * (0x10u << (c.bgCnt[bg->flags & 3] >> 14)), bg->targetTilesX);
      continue;
    }
    int size = c.bgCnt[bg->flags & 3] >> 14;
    uint32_t nextBlock = size == 1 || size == 3 ? 0x800 : 0, w = bg->targetTilesX;
    uint32_t src = bg->layout, dest = bg->layoutVram;
    for (int row = 0; row < bg->targetTilesY; row++) {
      uint32_t left = w < 32 ? w : 32;
      copy16(src, dest, left * 2);
      if (w > 32) copy16(src + left * 2, dest + nextBlock, (w - left) * 2);
      dest += 64;
      src += bg->xTiles * 2u;
    }
  }
  backgroundCount = 0;
}

/** OamMalloc: the index of a new entry of `order` (0 in front, 31 at the back), or -1 if OAM is full. */
int alloc_oam(uint32_t order) {
  if (order > 31) order = 31;
  if (oamFree > OAM_ENTRIES - 1) return -1;
  uint32_t i = oamFree++;
  oam_malloc[i * 4 + 3] = 0xFF;
  if (orderStart[order] == 0xFF) orderStart[order] = (uint8_t)i;
  else oam_malloc[orderEnd[order] * 4 + 3] = (uint16_t)i;
  orderEnd[order] = (uint8_t)i;
  return (int)i;
}

// ProcessOamBuffers
static void process_oam(void) {
  int to = 0;
  for (int order = 0; order < OAM_ORDERS; order++) {
    for (unsigned i = orderStart[order]; i != 0xFF; i = oam_malloc[i * 4 + 3]) {
      for (int k = 0; k < 3; k++) c.oamBuffer[to * 4 + k] = oam_malloc[i * 4 + k];
      to++;
    }
  }
  oamFree = 0;
  memset(orderStart, 0xFF, sizeof orderStart);
  memset(orderEnd, 0xFF, sizeof orderEnd);
}

// GetInput
static void read_keys(uint16_t held) {
  c.input = held & 0x3FF;
  c.pressed = (c.input ^ c.prevInput) & c.input;
  c.released = (c.input ^ c.prevInput) & c.prevInput;
  c.prevInput = c.input;
  c.repeated = c.pressed;
  for (int i = 0; i < 10; i++) {
    if (!(c.input & (1 << i))) c.repeatCounters[i] = c.firstRepeat[i];
    else if (c.repeatCounters[i] > 0) c.repeatCounters[i]--;
    else {
      c.repeated |= 1 << i;
      c.repeatCounters[i] = c.nextRepeat[i];
    }
  }
}

static void fill_oam_buffer(void) {
  for (int i = 0; i < OAM_ENTRIES * 4; i++) c.oamBuffer[i] = 0x200;
}

// UpdateScreenDma and ClearOamBufferDma
static void vblank(void) {
  gba_write(REG_DISPCNT, c.dispCnt);
  for (int i = 0; i < 4; i++) gba_write(REG_BG0CNT + i * 2, c.bgCnt[i]);
  if (c.flags & FLAGS_UPDATE_BG_PALETTES) {
    memcpy(gba_pal, c.bgPalette, sizeof c.bgPalette);
    c.flags ^= FLAGS_UPDATE_BG_PALETTES;
  }
  if (c.flags & FLAGS_UPDATE_OBJ_PALETTES) {
    memcpy(gba_pal + 256, c.objPalette, sizeof c.objPalette);
    c.flags ^= FLAGS_UPDATE_OBJ_PALETTES;
  }
  for (int i = 0; i < 6; i++) gba_write(REG_WIN0H + i * 2, c.winRegs[i]);
  gba_write(REG_BLDCNT, c.bldCnt);
  gba_write(REG_BLDALPHA, c.bldAlpha);
  gba_write(REG_BLDY, c.bldY);
  for (int i = 0; i < 8; i++) gba_write(REG_BG0HOFS + i * 2, c.bgScroll[i]);
  process_oam();
  memcpy(gba_oam, c.oamBuffer, sizeof c.oamBuffer);
  copy_graphics();
  copy_backgrounds();
  fill_oam_buffer();
}

/** The engine as power-on leaves it, with the screen white (forced blank) until the game shows it. */
void core_init(void) {
  memset(&c, 0, sizeof c);
  c.dispCnt = 0x80;
  fill_oam_buffer();
  memset(c.firstRepeat, 20, sizeof c.firstRepeat);
  memset(c.nextRepeat, 8, sizeof c.nextRepeat);
  for (int i = 0; i < OAM_ENTRIES * 4; i++) oam_malloc[i] = 0x200;
  memset(orderStart, 0xFF, sizeof orderStart);
  memset(orderEnd, 0xFF, sizeof orderEnd);
  c.startUp = START_UP_FRAMES;
  c.language = 1;
  gba_write(REG_DISPCNT, 0x80);
}

/** One frame, with `held` the keys down: the start-up, then the keys, the tasks and the V-blank. */
void core_step(uint16_t held) {
  if (c.startUp > 0 && --c.startUp > 0) return;
  if (c.main) {
    void (*main)(void) = c.main;
    c.main = NULL;
    main();
  }
  read_keys(held);
  // TasksExec: the next task is fixed before each one runs, so a task made just after the one running waits for the
  // next frame, and one made later in the list runs in this one
  for (Task *t = taskCount ? tasks[0] : NULL; t;) {
    int at = task_index(t);
    nextTask = at + 1 < taskCount ? tasks[at + 1] : NULL;
    t->main(t);
    t = nextTask;
  }
  c.flagsPreVBlank = c.flags;
  vblank();
}

/**
 * 0x080003B8, SetDefaultDisplaySettings: mode 0 with layer 2 and sprites, and two colours of the backgrounds' palette
 * for the debugging text it never shows.
 */
void default_display(void) {
  c.dispCnt = 0x1440;
  c.bgCnt[2] = 0x1E01;
  c.bgPalette[1] = 0x7FFF;
  c.bgPalette[17] = 0x3E0;
  c.flags |= FLAGS_UPDATE_BG_PALETTES;
}
