// What the Nintendo DS's two processors share beyond the main memory, and the ARM7's own memory (kit/nds/c/README.md),
// as melonDS, the reference emulator, has them (its NDS.cpp): the shared memory, 32 KB at 0x03000000, which its control
// register gives all to the ARM9, all to the ARM7 or a half to each; the ARM7's own 64 KB, which it sees at 0x03800000
// and, with none of the shared memory, at 0x03000000 too; the sync register, four bits each way; and the message queue,
// 16 words each way, with its flags, its error and its clearing. Each processor's side is told apart by `seven`.
// The queue's and the sync register's interrupts come with the interrupts: until then, a game's asking for one does
// nothing.

#include "nds.h"
#include "nds-kit.h"

static uint8_t shared[0x8000], arm7_own[0x10000];
static uint8_t wramcnt;
static uint16_t sync[2], control[2];
// each processor's queue of words it sends, 16 deep
static uint32_t queue[2][16];
static int head[2], count[2];

void nds_ipc_power(void) {
  for (int i = 0; i < 0x8000; i++) shared[i] = 0;
  for (int i = 0; i < 0x10000; i++) arm7_own[i] = 0;
  // the shared memory all the ARM7's, as the console's firmware leaves it for a game it starts
  wramcnt = 3;
  for (int p = 0; p < 2; p++) {
    sync[p] = control[p] = 0;
    head[p] = count[p] = 0;
    for (int i = 0; i < 16; i++) queue[p][i] = 0;
  }
}

// where a processor's read or write of 0x03000000 and on lands, or null where it has nothing there
static uint8_t *memory_at(int seven, uint32_t address) {
  if (seven && address >= 0x03800000) return arm7_own + (address & 0xFFFF);
  switch (wramcnt & 3) {
  case 0: return seven ? arm7_own + (address & 0xFFFF) : shared + (address & 0x7FFF);
  case 1: return seven ? shared + (address & 0x3FFF) : shared + 0x4000 + (address & 0x3FFF);
  case 2: return seven ? shared + 0x4000 + (address & 0x3FFF) : shared + (address & 0x3FFF);
  default: return seven ? shared + (address & 0x7FFF) : 0;
  }
}

static uint16_t control_read(int seven) {
  uint16_t value = control[seven];
  if (!count[seven]) value |= 0x0001;
  else if (count[seven] == 16) value |= 0x0002;
  if (!count[!seven]) value |= 0x0100;
  else if (count[!seven] == 16) value |= 0x0200;
  return value;
}

// a word from the other's queue; with the queue off or empty, the word in the place it would read next, as melonDS's
// Peek gives it, an old one or 0
static uint32_t receive(int seven) {
  int from = !seven;
  if (!(control[seven] & 0x8000)) return queue[from][head[from]];
  if (!count[from]) {
    control[seven] |= 0x4000;
    return queue[from][head[from]];
  }
  uint32_t word = queue[from][head[from]];
  head[from] = (head[from] + 1) & 15;
  count[from]--;
  return word;
}

static void send(int seven, uint32_t word) {
  if (!(control[seven] & 0x8000)) return;
  if (count[seven] == 16) { control[seven] |= 0x4000; return; }
  queue[seven][(head[seven] + count[seven]) & 15] = word;
  count[seven]++;
}

int nds_ipc_read(int seven, uint32_t address, int bytes, uint32_t *value) {
  if (address >> 24 == 0x03) {
    uint8_t *at = memory_at(seven, address & ~(uint32_t)(bytes - 1));
    *value = 0;
    if (at) for (int i = 0; i < bytes; i++) *value |= (uint32_t)at[i] << (8 * i);
    return 1;
  }
  switch (address) {
  case 0x04000180: *value = bytes == 1 ? sync[seven] & 0xFF : sync[seven]; return 1;
  case 0x04000181: *value = sync[seven] >> 8; return 1;
  case 0x04000184: *value = control_read(seven); return 1;
  case 0x04100000: *value = receive(seven); return 1;
  }
  if ((!seven && address == 0x04000247) || (seven && address == 0x04000241)) { *value = wramcnt; return 1; }
  return 0;
}

int nds_ipc_write(int seven, uint32_t address, uint32_t value, int bytes) {
  if (address >> 24 == 0x03) {
    uint8_t *at = memory_at(seven, address & ~(uint32_t)(bytes - 1));
    if (at) for (int i = 0; i < bytes; i++) at[i] = (uint8_t)(value >> (8 * i));
    return 1;
  }
  if (address == 0x04000180 || (address == 0x04000181 && bytes == 1)) {
    uint32_t out = address == 0x04000181 ? value << 8 : value;
    sync[!seven] = (uint16_t)((sync[!seven] & 0xFFF0) | ((out & 0x0F00) >> 8));
    sync[seven] = (uint16_t)((sync[seven] & 0xB0FF) | (out & 0x4F00));
    return 1;
  }
  if (address == 0x04000184 && bytes >= 2) {
    if (value & 0x0008) { head[seven] = count[seven] = 0; queue[seven][0] = 0; }
    if (value & 0x4000) control[seven] &= ~0x4000;
    control[seven] = (uint16_t)((value & 0x8404) | (control[seven] & 0x4000));
    return 1;
  }
  if (address == 0x04000188) {
    send(seven, bytes == 2 ? (value & 0xFFFF) | value << 16 : value);
    return 1;
  }
  if (!seven && address == 0x04000247 && bytes == 1) { wramcnt = value & 3; return 1; }
  return 0;
}
