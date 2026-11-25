// The Nintendo DS's cartridge slot and the cartridge in it (kit/nds/c/README.md), as melonDS, the reference emulator,
// has them (its NDSCart.cpp and NDSCart/CartCommon.cpp) once a game has been started directly: the cartridge already
// taking its last way of commands, whose encryption melonDS leaves out, as only a real cartridge reader would need it.
// Each processor has its own side of the slot, its control, its command and its two words of data, and the one
// EXMEMCNT gives the slot to talks to the cartridge, which reads the player's copy (kit_copy) 4 bytes at a time with
// the command B7, or gives its chip's number with B8. A transfer takes the time melonDS gives it, by the slot's speed and
// its two gaps, a word coming every 4 bytes' time while there's room for it, and ends as the last is read, with its
// interrupt. Each processor's side is told apart by `seven`.

#include "nds.h"
#include "nds-kit.h"
#include "kit.h"

#define NEVER UINT64_MAX

typedef struct {
  uint16_t spicnt;
  uint32_t romcnt;
  uint8_t command[8];
  uint32_t pos, len, data[2];
  int at_cpu, at_cart, count, late;
  uint64_t next;   // when the next word comes, or when a transfer with no data ends
  int ending;
} nds_slot;

static nds_slot slots[2];
static uint16_t exmemcnt[2];
static int owner;               // the processor the slot is given to, by EXMEMCNT's bit 11
static uint32_t size, mask, chip_id, address;
static uint8_t taken[8];        // the command the cartridge has

void nds_cart_power(void) {
  for (int p = 0; p < 2; p++) {
    nds_slot *s = &slots[p];
    *s = (nds_slot){ 0 };
    // the reset let go of, as melonDS's direct start leaves it
    s->romcnt = 1u << 29;
    s->next = NEVER;
  }
  // as melonDS's direct start sets them: the slot the ARM7's
  exmemcnt[0] = exmemcnt[1] = 0xE880;
  owner = 1;
  size = 1;
  while (size < kit_copy_size) size <<= 1;
  mask = size - 1;
  chip_id = 0xC2 | (size >= 0x100000 && size <= 0x8000000 ? ((size >> 20) - 1) << 8 : (0x100 - (size >> 28)) << 8);
  address = 0;
  for (int i = 0; i < 8; i++) taken[i] = 0;
}

static uint8_t rom(uint32_t at) { return at < kit_copy_size ? kit_copy[at] : 0; }

// 4 bytes of the cartridge, within a page of 0x1000 bytes, as melonDS's ROMRead32
static uint32_t read_word(void) {
  uint32_t high = address & mask & ~0xFFFu, low = address & 0xFFF, word = 0;
  for (int i = 0; i < 4; i++) {
    word |= (uint32_t)rom(high | low) << (8 * i);
    low = (low + 1) & 0xFFF;
  }
  address = high | low;
  return word;
}

static void cartridge_start(const uint8_t *command) {
  for (int i = 0; i < 8; i++) taken[i] = command[i];
  if (taken[0] == 0xB7) {
    address = ((uint32_t)taken[1] << 24 | (uint32_t)taken[2] << 16 | (uint32_t)taken[3] << 8 | taken[4]) & mask;
    // below 0x8000 a retail cartridge gives the same 0x200 bytes again
    if (address < 0x8000) address = 0x8000 + (address & 0x1FF);
  }
}

static uint32_t cartridge_word(void) {
  if (taken[0] == 0xB7) return read_word();
  if (taken[0] == 0xB8) return chip_id;
  return 0;
}

static uint32_t cycle(nds_slot *s) { return s->romcnt & (1u << 27) ? 8 : 5; }

static void end_transfer(int seven) {
  nds_slot *s = &slots[seven];
  s->romcnt &= ~(1u << 31);
  s->pos = s->len = 0;
  s->next = NEVER;
  if (s->spicnt & (1u << 14)) nds_irq_raise(seven, 19);
}

static void advance(nds_slot *s, uint64_t now) {
  if (s->pos >= s->len) { s->next = NEVER; return; }
  uint32_t delay = 4 + (s->pos & 0x1FF ? 0 : (s->romcnt >> 16) & 0x3F);
  s->next = now + (uint64_t)cycle(s) * delay, s->ending = 0;
}

// a word comes from the cartridge into the side's two words
static void receive(int seven, uint64_t at) {
  nds_slot *s = &slots[seven];
  s->data[s->at_cart] = owner == seven ? cartridge_word() : 0xFFFFFFFF;
  s->at_cart ^= 1;
  s->count++;
  s->pos += 4;
  s->romcnt |= 1u << 23;
  if (s->count < 2) advance(s, at);
  else s->late = 1, s->next = NEVER;
}

void nds_cart_run(int seven, uint64_t now) {
  nds_slot *s = &slots[seven];
  while (s->next <= now) {
    uint64_t at = s->next;
    if (s->ending) end_transfer(seven);
    else receive(seven, at);
  }
}

uint64_t nds_cart_next(int seven) { return slots[seven].next; }

static uint32_t read_data(int seven, uint64_t now) {
  nds_slot *s = &slots[seven];
  uint32_t word = s->data[s->at_cpu];
  if (s->romcnt & (1u << 30)) return word;
  s->at_cpu ^= 1;
  if (s->count > 0) s->count--;
  s->romcnt &= ~(1u << 23);
  if (s->pos < s->len) {
    if (s->late) {
      s->late = 0;
      advance(s, now);
    }
  } else if (!s->count) end_transfer(seven);
  else s->romcnt |= 1u << 23;
  return word;
}

// a write of the side's control, as melonDS's WriteROMCnt: a transfer starts as bit 31 goes on, with the slot on and
// in the cartridge's mode
static void write_romcnt(int seven, uint64_t now, uint32_t value, uint32_t bits) {
  nds_slot *s = &slots[seven];
  value &= bits;
  uint32_t start = value & ~s->romcnt & (1u << 31);
  s->romcnt = (s->romcnt & (~bits | 0x20800000u)) | (value & 0xFF7F7FFFu);
  if (!(s->spicnt & (1u << 15)) || (s->spicnt & (1u << 13)) || !start) return;
  // writing to the cartridge isn't here yet
  if (s->romcnt & (1u << 30)) nds_not_yet();
  uint32_t data = (s->romcnt >> 24) & 7;
  data = data == 7 ? 4 : data ? 0x100u << data : 0;
  s->pos = 0, s->len = data;
  if (owner == seven) cartridge_start(s->command);
  s->at_cpu = s->at_cart = s->count = s->late = 0;
  uint32_t delay = 8 + (s->romcnt & 0x1FFF) + (data ? (s->romcnt >> 16) & 0x3F : 0);
  if (!data) s->next = now + (uint64_t)cycle(s) * delay, s->ending = 1;
  else s->next = now + (uint64_t)cycle(s) * (delay + 4), s->ending = 0;
}

static void write_exmemcnt(int seven, uint32_t value, uint32_t bits) {
  value &= bits;
  if (seven) {
    if (bits & 0xFF) exmemcnt[1] = (uint16_t)((exmemcnt[1] & 0xFF80) | (value & 0x7F));
    return;
  }
  exmemcnt[0] = (uint16_t)((exmemcnt[0] & (~bits | 0x6000)) | (value & 0x88FF));
  exmemcnt[1] = (uint16_t)((exmemcnt[0] & 0xFF80) | (exmemcnt[1] & 0x7F));
  owner = (exmemcnt[0] >> 11) & 1;
}

int nds_cart_read(int seven, uint64_t now, uint32_t address_, int bytes, uint32_t *value) {
  nds_slot *s = &slots[seven];
  if (address_ == 0x04100010) {
    if (bytes != 4) nds_not_yet();
    nds_cart_run(seven, now);
    *value = read_data(seven, now);
    return 1;
  }
  if (address_ == 0x04000204 || address_ == 0x04000205) {
    *value = bytes == 1 ? (exmemcnt[seven] >> (8 * (address_ & 1))) & 0xFF : exmemcnt[seven];
    return 1;
  }
  if (address_ < 0x040001A0 || address_ >= 0x040001A8) return 0;
  nds_cart_run(seven, now);
  if (address_ < 0x040001A4) {
    // the save memory's serial bus isn't here yet, but for its control
    if (address_ >= 0x040001A2 && bytes < 4) nds_not_yet();
    *value = bytes == 1 ? (s->spicnt >> (8 * (address_ & 1))) & 0xFF : s->spicnt;
    return 1;
  }
  uint32_t shift = 8 * (address_ & 3);
  *value = bytes == 4 ? s->romcnt : bytes == 2 ? (s->romcnt >> shift) & 0xFFFF : (s->romcnt >> shift) & 0xFF;
  return 1;
}

int nds_cart_write(int seven, uint64_t now, uint32_t address_, uint32_t value, int bytes) {
  nds_slot *s = &slots[seven];
  if (address_ == 0x04000204 || address_ == 0x04000205) {
    uint32_t bits = bytes == 1 ? 0xFFu << (8 * (address_ & 1)) : 0xFFFF;
    write_exmemcnt(seven, bytes == 1 ? value << (8 * (address_ & 1)) : value, bits);
    return 1;
  }
  if (address_ == 0x04100010) {
    // a word written for the cartridge counts only in a transfer that writes, which isn't here yet
    if (s->romcnt & (1u << 30)) nds_not_yet();
    return 1;
  }
  if (address_ < 0x040001A0 || address_ >= 0x040001BC) return 0;
  nds_cart_run(seven, now);
  if (address_ < 0x040001A4) {
    if (address_ >= 0x040001A2 || (bytes == 4 && (value >> 16))) nds_not_yet();
    uint32_t bits = bytes == 1 ? 0xFFu << (8 * (address_ & 1)) : 0xFFFF;
    uint32_t shifted = (bytes == 1 ? value << (8 * (address_ & 1)) : value) & bits;
    s->spicnt = (uint16_t)((s->spicnt & (~bits | 0x0080)) | (shifted & 0xE043));
    return 1;
  }
  if (address_ < 0x040001A8) {
    uint32_t shift = 8 * (address_ & 3), bits = bytes == 4 ? 0xFFFFFFFFu : bytes == 2 ? 0xFFFFu << shift : 0xFFu << shift;
    write_romcnt(seven, now, value << shift, bits);
    return 1;
  }
  if (address_ < 0x040001B0) {
    for (int i = 0; i < bytes; i++) s->command[(address_ - 0x040001A8 + i) & 7] = (uint8_t)(value >> (8 * i));
    return 1;
  }
  // the encryption's seeds, which melonDS keeps for nothing but its log
  return 1;
}
