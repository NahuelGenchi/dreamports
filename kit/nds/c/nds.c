// The Nintendo DS's part of what the page calls, by name, to run a game in C (kit/c/game.js), and its two processors'
// programs side by side (kit/nds/c/README.md). The ARM9's program runs on the game's side (kit_run) and the ARM7's
// beside it (kit_run_beside), each with a time of its own in ticks of the console's clock, and before either reads or
// writes anything the other can, the one behind runs first up to the other's time, so their reads and writes happen in
// the order of their times. A frame of the proof tools runs from one V-blank's start to the next's, as a frame's
// picture and sound follow from what the programs wrote in the V-blank before it (tools/nds/melonds/libretro.cpp).
//
// The display is as melonDS draws it (its GPU_Soft.cpp and GPU2D_Soft.cpp): each engine, A and B, on the screen the
// power register's top bit puts it on, white when its display is off or blanked, black for A and white for B when the
// power register turns it off, and black when the screens are off. With its display on, an engine shows its backdrop,
// the first of its colours: its backgrounds, its sprites, 3D and the master brightness aren't drawn yet, and a game
// that turns one on stops (nds_not_yet). An engine's picture is the one its registers hold once the V-blank's writes are
// done, as the console draws it in the frame after.

#include "nds.h"
#include "nds-kit.h"
#include "kit.h"
#include "page.h"

uint8_t nds_main[0x400000];

static uint64_t t9, t7;            // each processor's time, in ticks from power-on
static uint64_t wake9, wake7;      // when a program waiting for the V-blank goes on
static uint64_t window_end;        // the end of the frame being run: the next V-blank's start
static int done9, done7;           // whether each has reached the end of the frame being run
static int frame;                  // the frame being run, -1 at power-on
static uint32_t held;              // the buttons, as console.h's bits
static int touched, touch_x, touch_y;

// the display: each engine's control, the power register, and the colours, 2 KB: A's backgrounds and sprites, then B's
static uint32_t dispcnt[2];
static uint16_t powcnt = 0x820F;
static uint8_t palette[0x800];

// the serial bus to the touch screen's chip, and the chip
static uint16_t spicnt;
static uint64_t spi_until;         // when the transfer going on ends
static uint8_t tsc_control, tsc_data;
static int tsc_position;
static uint16_t tsc_result;

static uint64_t vblank_of(int f) { return (uint64_t)f * NDS_FRAME + NDS_VBLANK; }
int nds_frame(void) { return frame; }
uint64_t nds9_now(void) { return t9; }
uint64_t nds7_now(void) { return t7; }

void nds_not_yet(void) { __builtin_trap(); }

static void arm9_entry(void) {
  game_arm9();
  for (;;) kit_wait_frame();
}

static void arm7_entry(void) {
  game_arm7();
  for (;;) {
    done7 = 1;
    kit_wait_beside();
  }
}

// the ARM7 runs until it's caught up with the ARM9, or has nothing more to do this frame
static void catch_up7(void) {
  while (!done7 && t7 < t9) kit_run_beside(arm7_entry);
}

// the ARM7, ahead of the ARM9, lets it catch up before it reads or writes
static void wait7(void) {
  while (!done9 && t7 > t9) kit_wait_beside();
}

static uint64_t next_vblank(uint64_t now) {
  int f = now < NDS_VBLANK ? 0 : (int)((now - NDS_VBLANK) / NDS_FRAME) + 1;
  return vblank_of(f);
}

void nds9_wait_vblank(uint32_t after) {
  wake9 = next_vblank(t9) + after;
  while (wake9 >= window_end) {
    done9 = 1;
    while (!done7) kit_run_beside(arm7_entry);
    kit_wait_frame();
  }
  done9 = 0;
  t9 = wake9;
}

void nds7_wait_vblank(uint32_t after) {
  wake7 = next_vblank(t7) + after;
  while (wake7 >= window_end) {
    done7 = 1;
    kit_wait_beside();
  }
  done7 = 0;
  t7 = wake7;
}

void nds9_spend(uint32_t cycles) { t9 += (cycles + 1) / 2; }
void nds7_spend(uint32_t cycles) { t7 += cycles; }

// the display's status, as either processor reads it at `now`: the V-blank's flag from line 192 to 261, the H-blank's
// for the end of each line
static uint32_t dispstat(uint64_t now) {
  uint64_t in_frame = now % NDS_FRAME;
  uint32_t line = (uint32_t)(in_frame / NDS_LINE), dot = (uint32_t)(in_frame % NDS_LINE);
  return (line >= 192 && line < 262 ? 1 : 0) | (dot >= 1584 ? 2 : 0);
}
static uint32_t vcount(uint64_t now) { return (uint32_t)((now % NDS_FRAME) / NDS_LINE); }

// the ten buttons as the console's register has them, a 0 for each held
static uint32_t keyinput(void) {
  static const uint32_t BITS[][2] = {
    { BUTTON_A, 1 }, { BUTTON_B, 2 }, { BUTTON_SELECT, 4 }, { BUTTON_START, 8 }, { BUTTON_RIGHT, 16 }, { BUTTON_LEFT, 32 },
    { BUTTON_UP, 64 }, { BUTTON_DOWN, 128 }, { BUTTON_R, 256 }, { BUTTON_L, 512 },
  };
  uint32_t bits = 0x3FF;
  for (unsigned i = 0; i < sizeof BITS / sizeof BITS[0]; i++) if (held & BITS[i][0]) bits &= ~BITS[i][1];
  return bits;
}

// X, Y, the pen and the lid, as only the ARM7 reads them: a 0 for X or Y held and for the pen down, the lid open
static uint32_t extkeyin(void) {
  uint32_t bits = 0x7F;
  if (held & BUTTON_X) bits &= ~1u;
  if (held & BUTTON_Y) bits &= ~2u;
  if (touched) bits &= ~0x40u;
  return bits;
}

// the main memory, little-endian, with its mirrors
static uint32_t main_read(uint32_t address, int bytes) {
  const uint8_t *at = nds_main + (address & 0x3FFFFF & ~(uint32_t)(bytes - 1));
  return bytes == 1 ? at[0] : bytes == 2 ? (uint32_t)(at[0] | at[1] << 8) : at[0] | at[1] << 8 | at[2] << 16 | (uint32_t)at[3] << 24;
}
static void main_write(uint32_t address, uint32_t value, int bytes) {
  uint8_t *at = nds_main + (address & 0x3FFFFF & ~(uint32_t)(bytes - 1));
  for (int i = 0; i < bytes; i++) at[i] = (uint8_t)(value >> (8 * i));
}

static uint32_t arm9_read(uint32_t address, int bytes) {
  catch_up7();
  if (address >> 24 == 0x02) return main_read(address, bytes);
  if (address >> 24 == 0x05) {
    uint32_t value = 0;
    for (int i = 0; i < bytes; i++) value |= (uint32_t)palette[(address + i) & 0x7FF] << (8 * i);
    return value;
  }
  switch (address) {
  case NDS_DISPCNT_A: return dispcnt[0];
  case NDS_DISPCNT_B: return dispcnt[1];
  case NDS_DISPSTAT: return bytes == 4 ? dispstat(t9) | vcount(t9) << 16 : dispstat(t9);
  case NDS_DISPSTAT + 2: return vcount(t9);
  case NDS_KEYINPUT: return keyinput();
  case NDS_POWCNT: return powcnt;
  }
  nds_not_yet();
  return 0;
}

static void arm9_write(uint32_t address, uint32_t value, int bytes) {
  catch_up7();
  if (address >> 24 == 0x02) { main_write(address, value, bytes); return; }
  if (address >> 24 == 0x05) {
    // the colours take halfwords and words: a byte written there is written to both bytes of its halfword
    if (bytes == 1) { value = (value & 0xFF) * 0x101; bytes = 2; address &= ~1u; }
    for (int i = 0; i < bytes; i++) palette[(address + i) & 0x7FF] = (uint8_t)(value >> (8 * i));
    return;
  }
  if (address == NDS_DISPCNT_A || address == NDS_DISPCNT_B) {
    int engine = address == NDS_DISPCNT_B;
    if (bytes == 4) dispcnt[engine] = value;
    else if (bytes == 2) dispcnt[engine] = (dispcnt[engine] & 0xFFFF0000u) | (value & 0xFFFF);
    else nds_not_yet();
    // backgrounds, sprites, windows and 3D aren't drawn yet, nor a display of the video memory or of the main memory
    if (dispcnt[engine] & 0x0000FF08u || ((dispcnt[engine] >> 16) & 3) > 1) nds_not_yet();
    return;
  }
  if (address == NDS_DISPCNT_A + 2 || address == NDS_DISPCNT_B + 2) {
    int engine = address == NDS_DISPCNT_B + 2;
    dispcnt[engine] = (dispcnt[engine] & 0xFFFF) | (value & 0xFFFF) << 16;
    if (((dispcnt[engine] >> 16) & 3) > 1) nds_not_yet();
    return;
  }
  if (address == NDS_POWCNT && bytes >= 2) { powcnt = value & 0x820F; return; }
  nds_not_yet();
}

// the touch screen's chip, given a byte over the serial bus: a control byte asks it to measure, and the two bytes after
// give the result back, 12 bits, the pixel times 16, or 0xFFF with nothing touching
static void tsc_write(uint8_t value) {
  tsc_data = tsc_position == 1 ? (tsc_result >> 5) & 0x7F : tsc_position == 2 ? (uint8_t)(tsc_result << 3) : 0;
  if (value & 0x80) {
    tsc_control = value;
    tsc_position = 1;
    switch (tsc_control & 0x70) {
    case 0x10: tsc_result = touched ? (uint16_t)(touch_y << 4) : 0xFFF; break;
    case 0x50: tsc_result = touched ? (uint16_t)(touch_x << 4) : 0; break;
    // the microphone hears nothing yet, which the chip gives as the middle of its range
    case 0x60: tsc_result = 0x800; break;
    default: tsc_result = 0xFFF;
    }
    if (tsc_control & 0x08) tsc_result &= 0x0FF0;
  } else {
    tsc_position++;
  }
}

static uint32_t arm7_read(uint32_t address, int bytes) {
  wait7();
  if (address >> 24 == 0x02) return main_read(address, bytes);
  switch (address) {
  case NDS_DISPSTAT: return bytes == 4 ? dispstat(t7) | vcount(t7) << 16 : dispstat(t7);
  case NDS_DISPSTAT + 2: return vcount(t7);
  case NDS_KEYINPUT: return keyinput();
  case NDS_EXTKEYIN: return extkeyin();
  case NDS_SPICNT: return (spicnt & ~0x80u) | (t7 < spi_until ? 0x80 : 0);
  case NDS_SPIDATA:
    if (!(spicnt & 0x8000) || t7 < spi_until) return 0;
    return ((spicnt >> 8) & 3) == 2 ? tsc_data : 0;
  }
  if (address >= 0x04000400 && address < 0x04000520) return nds_sound_read(address, bytes);
  nds_not_yet();
  return 0;
}

static void arm7_write(uint32_t address, uint32_t value, int bytes) {
  wait7();
  if (address >> 24 == 0x02) { main_write(address, value, bytes); return; }
  if (address >= 0x04000400 && address < 0x04000520) { nds_sound_write(t7, address, value, bytes); return; }
  switch (address) {
  case NDS_SPICNT:
    // turning the bus off lets the chip go
    if ((spicnt & 0x8000) && !(value & 0x8000)) tsc_position = 0;
    spicnt = (spicnt & 0x80) | (value & 0xCF03);
    if (value & 0x0400) nds_not_yet();
    return;
  case NDS_SPIDATA:
    if (!(spicnt & 0x8000) || t7 < spi_until) return;
    if (((spicnt >> 8) & 3) != 2) nds_not_yet();
    tsc_write((uint8_t)value);
    if (!(spicnt & 0x0800)) tsc_position = 0;
    spi_until = t7 + 8 * (8u << (spicnt & 3));
    return;
  case NDS_POWCNT:
    nds_sound_run(t7 + 1);
    nds_sound_powered(value & 1);
    return;
  }
  nds_not_yet();
}

uint32_t nds9_read8(uint32_t address) { return arm9_read(address, 1); }
uint32_t nds9_read16(uint32_t address) { return arm9_read(address, 2); }
uint32_t nds9_read32(uint32_t address) { return arm9_read(address, 4); }
void nds9_write8(uint32_t address, uint32_t value) { arm9_write(address, value & 0xFF, 1); }
void nds9_write16(uint32_t address, uint32_t value) { arm9_write(address, value & 0xFFFF, 2); }
void nds9_write32(uint32_t address, uint32_t value) { arm9_write(address, value, 4); }
uint32_t nds7_read8(uint32_t address) { return arm7_read(address, 1); }
uint32_t nds7_read16(uint32_t address) { return arm7_read(address, 2); }
uint32_t nds7_read32(uint32_t address) { return arm7_read(address, 4); }
void nds7_write8(uint32_t address, uint32_t value) { arm7_write(address, value & 0xFF, 1); }
void nds7_write16(uint32_t address, uint32_t value) { arm7_write(address, value & 0xFFFF, 2); }
void nds7_write32(uint32_t address, uint32_t value) { arm7_write(address, value, 4); }

/** Starts the console as the reference emulator starts a game, with its programs loaded: both run from tick 0 until
 *  each waits for the first V-blank. */
EXPORT("dp_start") void dp_start(void) {
  kit_screen(SCREEN_W, SCREEN_H);
  nds_sound_power();
  t9 = t7 = 0;
  frame = -1;
  window_end = vblank_of(0);
  done9 = done7 = 0;
  kit_run(arm9_entry);
  // the sound of the frames before the first, which nothing compares
  nds_sound_run(window_end);
  nds_sound_drop();
  frame = 0;
}

/** Runs one frame, from a V-blank's start to the next's, with the buttons in `buttons` held, a bit each in
 *  kit/consoles.js's order (console.h), and the touch the page gave (kit_touch). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  held = buttons;
  touched = kit_touch(&touch_x, &touch_y);
  window_end = vblank_of(frame + 1);
  done9 = done7 = 0;
  kit_run(arm9_entry);
  nds_sound_run(window_end);
  frame++;
}

// a colour of 15 bits as the page's pixels hold it, red in the lowest byte, each of its 5 bits widened to 8 as the
// tools read the console's 6
static uint32_t shown(uint32_t colour) {
  return 0xFF000000u | (colour >> 10 & 31) << 19 | (colour >> 5 & 31) << 11 | (colour & 31) << 3;
}

static uint32_t engine_colour(int engine) {
  if (!(powcnt & (engine ? 0x200 : 0x2))) return engine ? 0x7FFF : 0;
  if ((dispcnt[engine] & 0x80) || !((dispcnt[engine] >> 16) & 3)) return 0x7FFF;
  const uint8_t *backdrop = palette + engine * 0x400;
  return (backdrop[0] | backdrop[1] << 8) & 0x7FFF;
}

/** Draws the last frame's two screens, the upper above the lower, and gives where its words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  // engine A is on the upper screen when the power register's top bit says so
  int upper = powcnt & 0x8000 ? 0 : 1;
  uint32_t colours[2] = { engine_colour(upper), engine_colour(!upper) };
  for (int s = 0; s < 2; s++) {
    uint32_t pixel = powcnt & 1 ? shown(colours[s]) : 0xFF000000u;
    for (int i = 0; i < 256 * 192; i++) screen[s * 256 * 192 + i] = pixel;
  }
  return screen;
}

// the most samples one call gives, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_MOST / 10 + 1)
static float sound[SOUND_MAX * 2];

/** The next `count` samples of the game's sound, the left ones and then the right ones dp_sound_render_max() words
 *  on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  if (count > 0) nds_sound_take(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
