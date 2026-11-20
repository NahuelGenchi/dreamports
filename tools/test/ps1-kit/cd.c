// The Dreamport in C of the test's CD program (made-up-ps1.mjs, madeUpCdExe), on the PlayStation's kit: it reads
// counter 0 as it starts, gives the CD drive the commands its script has for each frame just after the V-blank, and in
// its interrupt handler, as the program's does, logs each of the drive's interrupts, its answer, a sector's first bytes
// taken one at a time and the sum of its words moved by DMA, and each frame draws the last 1,024 bytes of its log and
// how long the BIOS took to hand it over. ps1-kit.mjs fills in the script and the numbers.

#include "ps1.h"

#define LOG_SIZE @LOG_SIZE@
static const uint8_t SCRIPT[] = { @SCRIPT@ };

static uint32_t vblanks, count, script, words = 512, bytes, start;
static uint8_t log_bytes[LOG_SIZE];
static uint32_t sector[2352 / 4];

static void put(uint32_t byte) {
  if (count < LOG_SIZE) log_bytes[count++] = (uint8_t)byte;
}

void game_start(void) {
  start = timer_read(0x1F801100) & 0xFFFF;
  irq_write(0x1F801074, 0);
  irq_write(0x1F801070, 0xFFFFFFFE);
  gpu_gp1(0x00000000);
  gpu_gp1(0x08000001);
  gpu_gp1(0x06C60260);
  gpu_gp1(0x07040010);
  gpu_gp1(0x05000000);
  gpu_gp1(0x03000000);
  gpu_gp0(0xE3000000);
  gpu_gp0(0xE403BD3F);
  gpu_gp0(0xE5000000);
  irq_write(0x1F801070, 0);
  irq_write(0x1F801074, 0x05);
  ps1_interrupts(1);
}

void game_step(uint32_t buttons) {
  (void)buttons;
  // the frame's commands: Setmode also says how a sector is taken, the whole 2,340 bytes or 2,048
  for (; (uint32_t)(SCRIPT[script] | SCRIPT[script + 1] << 8) == vblanks; script += 8) {
    uint8_t command = SCRIPT[script + 2], parameters = SCRIPT[script + 3];
    if (command == 0x0E) {
      words = SCRIPT[script + 4] & 0x20 ? 582 : 512;
      bytes = SCRIPT[script + 4] & 0x20 ? 12 : 0;
    }
    cd_write(CD_BASE, 0);
    for (uint8_t i = 0; i < parameters; i++) cd_write(CD_BASE + 2, SCRIPT[script + 4 + i]);
    cd_write(CD_BASE + 1, command);
  }
  gpu_gp0(0x02000000 | @BACKGROUND@);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  gpu_gp0(0x60000000 | @HANDOFF@);
  gpu_gp0(230 << 16);
  gpu_gp0(6 << 16 | (((start >> 7) & 0x7F) * 2 + 1));
  uint32_t end = count;
  for (uint32_t at = end >= 1024 ? end - 1024 : 0; at != end; at++) {
    uint32_t byte = log_bytes[at], cell = at & 1023;
    gpu_gp0(0x60800000 | (byte ^ 0xFF) << 8 | byte);
    gpu_gp0(((cell >> 5) * 7) << 16 | (cell & 31) * 10);
    gpu_gp0(6 << 16 | 9);
  }
}

void game_interrupt(void) {
  uint32_t bits = irq_read(0x1F801070) & irq_read(0x1F801074);
  irq_write(0x1F801070, ~bits);
  if (bits & 1) vblanks++;
  if (!(bits & 4)) return;
  cd_write(CD_BASE, 1);
  uint32_t interrupt = cd_read(CD_BASE + 3) & 7;
  put(0xF0 | interrupt);
  while (cd_read(CD_BASE) & 0x20) put(cd_read(CD_BASE + 1));
  if (interrupt == 1) {
    cd_write(CD_BASE, 0);
    cd_write(CD_BASE + 3, 0x80);
    for (uint32_t n = bytes; n; n--) put(cd_read(CD_BASE + 2));
    cd_dma_read(sector, words | 0x10000, 0x11000000);
    while ((cd_dma_status() & 0x01000000) && ps1_wait()) {}
  }
  cd_write(CD_BASE, 1);
  cd_write(CD_BASE + 3, 0x1F);
  cd_write(CD_BASE, 0);
  if (interrupt == 1) {
    uint32_t sum = 0;
    for (uint32_t i = 0; i < words; i++) sum += sector[i];
    for (int n = 0; n < 4; n++) put(sum >> (n * 8) & 0xFF);
  }
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int samples) { spu_sound(left, right, samples); }
