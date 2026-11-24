// The screen, as the system gives it to a game (sceDisplay) and as the emulator in the proof tools shows it: a frame
// lasts 1001/60 thousandths of a second, its V-blank the last 0.7315 of them, and the screen shows 480 by 272 pixels
// of the framebuffer a game names, in whichever of the four formats it's in. A framebuffer named for the next frame
// is shown from the V-blank that follows, and that V-blank is where the page's frame ends.

#include "psp-kit.h"

// a frame and its V-blank in the processor's cycles, each cut to a whole number as the emulator cuts them
#define FRAME_MS (1001.0 / 60.0)
#define VBLANK_MS 0.7315
#define MS_TO_CYCLES(ms) ((int64_t)(PSP_CYCLES_A_SECOND * (ms) * (0.001)))
#define VBLANK_CYCLES MS_TO_CYCLES(VBLANK_MS)
#define FRAME_CYCLES MS_TO_CYCLES(FRAME_MS)
#define SHOWN_CYCLES MS_TO_CYCLES(FRAME_MS - VBLANK_MS)
#define MICROSECOND (PSP_CYCLES_A_SECOND / 1000000)

struct shown { uint32_t address; int format, line; };
static struct shown now_shown, next_shown;
static int next_waits, in_vblank, vcount;
static uint64_t frame_start;
// the threads that wait for a V-blank, each with how many more it waits for
static struct { SceUID thread; int left; } waiting[64];
static int waiting_count;

static void vblank_ends(uint64_t data, int late);
static void vblank_starts(uint64_t data, int late) {
  (void)data;
  frame_start = clock_now();
  in_vblank = 1;
  vcount++;
  clock_schedule(VBLANK_CYCLES - late, vblank_ends, 0);
  int woke = 0;
  for (int i = 0; i < waiting_count; i++) {
    if (--waiting[i].left) continue;
    if (thread_waits(waiting[i].thread, WAIT_VBLANK) == 1) {
      thread_wake(waiting[i].thread, 0);
      woke = 1;
    }
    for (int j = i--; j + 1 < waiting_count; j++) waiting[j] = waiting[j + 1];
    waiting_count--;
  }
  if (woke) thread_reschedule();
  if (next_waits) {
    now_shown = next_shown;
    next_waits = 0;
  }
  kernel_frame_ends();
}
static void vblank_ends(uint64_t data, int late) {
  (void)data;
  clock_schedule(SHOWN_CYCLES - late, vblank_starts, 0);
  in_vblank = 0;
  ctrl_vblank();
}

void display_power(void) {
  now_shown = next_shown = (struct shown){ PSP_VRAM, PSP_FORMAT_8888, 512 };
  next_waits = in_vblank = vcount = waiting_count = 0;
  frame_start = 0;
  clock_schedule(SHOWN_CYCLES, vblank_starts, 0);
}

// the running thread waits for `count` V-blanks to start, one more when the next is less than 115 microseconds away
static void wait_for_vblanks(int count) {
  int64_t into = (int64_t)(clock_now() - frame_start);
  if (FRAME_CYCLES - into <= 115 * MICROSECOND) count++;
  if (waiting_count == 64) __builtin_trap();
  waiting[waiting_count].thread = thread_current();
  waiting[waiting_count++].left = count;
  thread_wait(WAIT_VBLANK, 1, 0);
}

int sceDisplaySetMode(int mode, int width, int height) {
  call_starts();
  if (mode != 0) return thread_done(PSP_ERROR_INVALID_MODE);
  if (width != 480 || height != 272) return thread_done(PSP_ERROR_INVALID_SIZE);
  // setting the mode waits for a V-blank to start
  wait_for_vblanks(1);
  return thread_answer(0);
}

int sceDisplaySetFrameBuf(uint32_t address, int line, int format, int when) {
  call_starts();
  if (when != PSP_SETBUF_IMMEDIATE && when != PSP_SETBUF_NEXTFRAME) return thread_done(PSP_ERROR_INVALID_MODE);
  if (address != 0 && !psp_memory(address)) return thread_done(PSP_ERROR_INVALID_POINTER);
  if (address & 0xF) return thread_done(PSP_ERROR_INVALID_POINTER);
  if ((line & 0x3F) != 0 || (line == 0 && address != 0)) return thread_done(PSP_ERROR_INVALID_SIZE);
  if (format < 0 || format > PSP_FORMAT_8888) return thread_done(PSP_ERROR_INVALID_FORMAT);
  if (when == PSP_SETBUF_IMMEDIATE && (format != next_shown.format || line != next_shown.line)) return thread_done(PSP_ERROR_INVALID_MODE);
  clock_spend(290);
  struct shown asked = { address, format, line };
  if (when == PSP_SETBUF_IMMEDIATE) now_shown = next_shown = asked;
  else {
    next_shown = asked;
    next_waits = 1;
    // a new format or line is the screen's at once
    now_shown.format = format;
    now_shown.line = line;
  }
  return thread_done(0);
}

int sceDisplayGetFrameBuf(uint32_t address_to, uint32_t line_to, uint32_t format_to, int which) {
  call_starts();
  const struct shown *from = which == PSP_SETBUF_NEXTFRAME ? &next_shown : &now_shown;
  if (psp_memory(address_to)) psp_write32(address_to, from->address);
  if (psp_memory(line_to)) psp_write32(line_to, (uint32_t)from->line);
  if (psp_memory(format_to)) psp_write32(format_to, (uint32_t)from->format);
  return thread_done(0);
}

int sceDisplayWaitVblankStart(void) {
  call_starts();
  wait_for_vblanks(1);
  return thread_answer(0);
}
int sceDisplayWaitVblank(void) {
  call_starts();
  if (!in_vblank) {
    wait_for_vblanks(1);
    return thread_answer(0);
  }
  clock_spend(1110);
  return thread_answer(1);
}
int sceDisplayGetVcount(void) {
  call_starts();
  clock_spend(150);
  return thread_answer(vcount);
}
int sceDisplayIsVblank(void) {
  call_starts();
  return thread_done(in_vblank);
}

// a colour's 4, 5 or 6 bits as 8, its top bits again below them
static uint32_t from4(uint32_t v) { return v << 4 | v; }
static uint32_t from5(uint32_t v) { return v << 3 | v >> 2; }
static uint32_t from6(uint32_t v) { return v << 2 | v >> 4; }

void psp_show(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  // an address with nothing above its low 24 bits is in the video memory
  uint32_t address = (now_shown.address & 0xFF000000) == 0 ? 0x44000000 | now_shown.address : now_shown.address;
  for (int y = 0; y < SCREEN_H; y++) {
    uint32_t *to = screen + y * SCREEN_W;
    uint32_t from = address + (uint32_t)(y * now_shown.line) * (now_shown.format == PSP_FORMAT_8888 ? 4 : 2);
    const uint8_t *line = psp_memory(from);
    if (!psp_memory(address) || !line) {
      for (int x = 0; x < SCREEN_W; x++) to[x] = 0xFF000000;
      continue;
    }
    for (int x = 0; x < SCREEN_W; x++) {
      uint32_t r, g, b;
      if (now_shown.format == PSP_FORMAT_8888) {
        r = line[x * 4];
        g = line[x * 4 + 1];
        b = line[x * 4 + 2];
      } else {
        uint32_t pixel = line[x * 2] | (uint32_t)line[x * 2 + 1] << 8;
        if (now_shown.format == PSP_FORMAT_565) {
          r = from5(pixel & 31);
          g = from6(pixel >> 5 & 63);
          b = from5(pixel >> 11);
        } else if (now_shown.format == PSP_FORMAT_5551) {
          r = from5(pixel & 31);
          g = from5(pixel >> 5 & 31);
          b = from5(pixel >> 10 & 31);
        } else {
          r = from4(pixel & 15);
          g = from4(pixel >> 4 & 15);
          b = from4(pixel >> 8 & 15);
        }
      }
      to[x] = 0xFF000000 | b << 16 | g << 8 | r;
    }
  }
}
