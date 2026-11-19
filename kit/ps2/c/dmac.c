// The DMA controller (ps2.h): what moves a game's data from the EE's memory to the VIFs, to the GIF and between main
// memory and the scratchpad, as the console's does. Writing a channel's CHCR with STR set starts it, and it runs then and
// there, a quadword run at a time, to its end or to something that holds it up, such as a VIF waiting for its vector
// unit or PATH3 masked, and goes on as soon as that's gone (dmac_resume).
//
// A channel in normal mode sends QWC quadwords from MADR. In chain mode it reads a DMA tag at TADR, which says what to
// send and where the next tag is: CNT the quadwords after it, NEXT those and then the tag it points to, REF and REFS the
// quadwords it points to, CALL and RET those after it with a jump through the two places ASR0 and ASR1 keep, and END
// and REFE the last. With TTE a tag's own second half goes to the VIF or the GIF first. With TIE a tag with its IRQ bit
// set ends the chain. This is how Play!, the console's emulator the proof tools run, moves it (Source/ee/DMAC.cpp,
// Dmac_Channel.cpp), so a game's DMA chains give the GS what the original's give it, in the same order.
//
// The channels to and from the IPU and the second processor (3 to 7) keep what's written to them and move nothing here.
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"

enum { CHCR_DIR = 0x1, CHCR_TAG_HELD = 0x2, CHCR_TTE = 0x40, CHCR_TIE = 0x80, CHCR_STR = 0x100 };
enum { TAG_REFE, TAG_CNT, TAG_NEXT, TAG_REF, TAG_REFS, TAG_CALL, TAG_RET, TAG_END };
enum { DEST_CNT, DEST_CNTS, DEST_END = 7 };
enum { ENABLE_CPND = 0x10000 };
enum { STAT_MEIS = 1 << 14 };
// what was set as a chain started, and that a RET found no place to go back to
enum { FIRST_TRANSFER = 1, RETURN_AT_TOP = 2 };
enum { CHANNELS = 10, FROM_SPR = 8, TO_SPR = 9 };

struct channel { uint32_t chcr, madr, qwc, tadr, asr[2], sadr, flags; };
static struct channel ch[CHANNELS];
static uint32_t ctrl, stat, enable, pcr, sqwc, rbsr, rbor, stadr;
static int running;

static int number_of(uint32_t address) {
  static const uint32_t bases[CHANNELS] = { DMA_VIF0, DMA_VIF1, DMA_GIF, DMA_FROM_IPU, DMA_TO_IPU, DMA_SIF0, DMA_SIF1, DMA_SIF2, DMA_FROM_SPR, DMA_TO_SPR };
  for (int i = 0; i < CHANNELS; i++) if ((address & ~0xFFu) == bases[i]) return i;
  return -1;
}

static uint64_t tag_at(uint32_t address) {
  uint64_t tag;
  __builtin_memcpy(&tag, ps2_dma_memory(address), 8);
  return tag;
}

static void finished(int n) {
  ch[n].chcr &= ~CHCR_STR;
  stat |= 1u << n;
}

// the scratchpad to main memory or vector unit 0's memory, and back: what channel 8 and 9 move, a quadword run at a
// time, the scratchpad's place wrapping at its end
static uint8_t *beside_scratchpad(uint32_t address, int to) {
  if (address >= VU0_DATA && address < VU0_DATA + 0x1000) return vu_data(0) + (address & 0xFFF);
  if (!to && address >= VU1_DATA && address < VU1_DATA + 0x4000) return vu_data(1) + (address & 0x3FFF);
  return ee_memory() + (address & (PS2_RAM_SIZE - 1));
}
static uint32_t scratchpad_move(int n, uint32_t address, uint32_t qwc) {
  for (uint32_t i = 0; i < qwc; i++, address += 16) {
    uint8_t *there = beside_scratchpad(address, n == FROM_SPR), *here = ps2_scratchpad() + ch[n].sadr;
    if (n == FROM_SPR) __builtin_memcpy(there, here, 16);
    else __builtin_memcpy(here, there, 16);
    ch[n].sadr = (ch[n].sadr + 16) & (PS2_SCRATCHPAD_SIZE - 16);
  }
  // the scratchpad as the source of a stall, which holds VIF1's or the GIF's REFS tags back until it has written there
  if (n == FROM_SPR && (ctrl >> 4 & 3) == 2) stadr = address;
  return qwc;
}

// what the channel's device takes of `qwc` quadwords at `address`, the first being the tag when `tag` is set
static uint32_t send(int n, uint32_t address, uint32_t qwc, int tag) {
  switch (n) {
  case 0: return vif_receive(0, address, qwc, tag);
  // VIF1 the other way reads a picture back from the GS, into where the address points
  case 1:
    if (ch[1].chcr & CHCR_DIR) return vif_receive(1, address, qwc, tag);
    gs_read_image(ps2_dma_memory(address), qwc * 16);
    return qwc;
  case 2: return gif_receive(address, qwc, tag);
  case FROM_SPR: case TO_SPR: return scratchpad_move(n, address, qwc);
  default: return 0;
  }
}

// the ring buffer of MFIFO mode, which the scratchpad's channel fills and VIF1's or the GIF's empties
static int in_ring(int n) {
  int mode = ctrl >> 2 & 3;
  return (mode == 2 && n == 1) || (mode == 3 && n == 2);
}
static uint32_t ring_room(uint32_t madr, uint32_t qwc) {
  uint32_t size = rbsr + 16, at = madr - rbor;
  return at < size && qwc > (size - at) / 16 ? (size - at) / 16 : qwc;
}
static void ring_wrap(uint32_t *madr) {
  if (*madr == rbor + rbsr + 16) *madr = rbor;
}

static void run_normal(int n) {
  int ring = n == FROM_SPR && (ctrl >> 2 & 3) >= 2;
  // a transfer started with QWC at 0 still sends a quadword, and QWC goes below 0, as the console's does
  uint32_t qwc = ch[n].qwc ? ch[n].qwc : 1;
  if (ring) {
    ch[n].madr = (ch[n].madr & rbsr) | rbor;
    qwc = ring_room(ch[n].madr, qwc);
  }
  uint32_t sent = send(n, ch[n].madr, qwc, 0);
  ch[n].madr += sent * 16;
  ch[n].qwc = (ch[n].qwc - sent) & 0xFFFF;
  if (!ch[n].qwc) finished(n);
  if (ring) ring_wrap(&ch[n].madr);
}

// the scratchpad's channels' interleaved mode: TQWC quadwords sent, SQWC skipped, to the end
static void run_interleaved(int n) {
  uint32_t skip = sqwc & 0xFF, take = sqwc >> 16 & 0xFF;
  if (!skip || !take) {
    run_normal(n);
    return;
  }
  while (ch[n].qwc) {
    uint32_t sent = send(n, ch[n].madr, take < ch[n].qwc ? take : ch[n].qwc, 0);
    ch[n].madr += (sent + skip) * 16;
    ch[n].qwc -= sent;
  }
  finished(n);
}

static void chain_transfer(int n, int ring) {
  uint32_t id = ch[n].chcr >> 28 & 7, qwc = ch[n].qwc;
  if (ring && (id == TAG_CNT || id == TAG_END)) qwc = ring_room(ch[n].madr, qwc);
  if (qwc) {
    uint32_t sent = send(n, ch[n].madr, qwc, 0);
    ch[n].madr += sent * 16;
    ch[n].qwc -= sent;
  }
  if (ring) {
    if (id == TAG_CNT || id == TAG_END) ring_wrap(&ch[n].madr);
    ch[n].tadr = ((ch[n].tadr - rbor) & rbsr) + rbor;
    if (ch[n].tadr == ch[FROM_SPR].madr) stat |= STAT_MEIS;
  }
}

static int stalled(int n, uint32_t id) {
  int drain = ctrl >> 6 & 3;
  return ((drain == 2 && n == 1) || (drain == 3 && n == 2)) && id == TAG_REFS && ch[n].madr >= stadr;
}

static void run_chain(int n) {
  int ring = in_ring(n);
  if (stalled(n, ch[n].chcr >> 28 & 7)) return;
  if (ch[n].qwc) {
    chain_transfer(n, ring);
    if (ch[n].qwc) return;
  }
  while (ch[n].chcr & CHCR_STR) {
    if (ring && ch[n].tadr == ch[FROM_SPR].madr) break;
    if (ch[n].chcr & CHCR_TAG_HELD) {
      // a tag the device didn't take last time
      ch[n].chcr &= ~CHCR_TAG_HELD;
      if (send(n, ch[n].tadr, 1, 1) != 1) {
        ch[n].chcr |= CHCR_TAG_HELD;
        break;
      }
    } else {
      if (ch[n].qwc) break;
      if (ch[n].flags & FIRST_TRANSFER) {
        ch[n].flags &= ~FIRST_TRANSFER;
      } else {
        uint32_t id = ch[n].chcr >> 28 & 7;
        if (id == TAG_REFE || id == TAG_END || ((ch[n].chcr & CHCR_TIE) && (ch[n].chcr >> 31))) {
          finished(n);
          continue;
        }
        // a RET with nothing to go back to
        if (ch[n].flags & RETURN_AT_TOP) {
          finished(n);
          ch[n].flags &= ~RETURN_AT_TOP;
          continue;
        }
      }
      if (ch[n].chcr & CHCR_TTE && send(n, ch[n].tadr, 1, 1) != 1) {
        ch[n].chcr |= CHCR_TAG_HELD;
        break;
      }
    }
    if (!ch[n].tadr) {
      finished(n);
      continue;
    }
    uint64_t tag = tag_at(ch[n].tadr);
    uint32_t id = (uint32_t)(tag >> 28) & 7, qwc = (uint32_t)tag & 0xFFFF, address = (uint32_t)(tag >> 32) & ~15u;
    // the tag's top 16 bits are kept in CHCR's
    ch[n].chcr = (ch[n].chcr & 0xFFFF) | (uint32_t)(tag & 0xFFFF0000);
    switch (id) {
    case TAG_REFE: case TAG_REF: case TAG_REFS:
      ch[n].madr = address, ch[n].qwc = qwc, ch[n].tadr += 16;
      break;
    case TAG_CNT:
      ch[n].madr = ch[n].tadr + 16, ch[n].qwc = qwc, ch[n].tadr = ch[n].madr + qwc * 16;
      break;
    case TAG_NEXT:
      ch[n].madr = ch[n].tadr + 16, ch[n].qwc = qwc, ch[n].tadr = address;
      break;
    case TAG_CALL: {
      uint32_t asp = ch[n].chcr >> 4 & 3;
      ch[n].madr = ch[n].tadr + 16, ch[n].qwc = qwc;
      if (asp < 2) ch[n].asr[asp] = ch[n].madr + qwc * 16;
      ch[n].tadr = address;
      ch[n].chcr = (ch[n].chcr & ~0x30u) | ((asp + 1) & 3) << 4;
      break;
    }
    case TAG_RET: {
      uint32_t asp = ch[n].chcr >> 4 & 3;
      ch[n].madr = ch[n].tadr + 16, ch[n].qwc = qwc;
      if (asp) {
        ch[n].chcr = (ch[n].chcr & ~0x30u) | (asp - 1) << 4;
        ch[n].tadr = ch[n].asr[asp - 1];
      } else {
        ch[n].flags |= RETURN_AT_TOP;
      }
      break;
    }
    case TAG_END:
      ch[n].madr = ch[n].tadr + 16, ch[n].qwc = qwc;
      break;
    }
    if (stalled(n, id)) continue;
    chain_transfer(n, ring);
  }
}

// the scratchpad's channel to main memory in chain mode reads its tags from the scratchpad: each says where the
// quadwords after it go and how many
static void run_destination_chain(int n) {
  while (ch[n].chcr & CHCR_STR) {
    if (!ch[n].qwc) {
      uint64_t tag;
      __builtin_memcpy(&tag, ps2_scratchpad() + ch[n].sadr, 8);
      ch[n].sadr = (ch[n].sadr + 16) & (PS2_SCRATCHPAD_SIZE - 16);
      ch[n].madr = (uint32_t)(tag >> 32) & ~15u;
      ch[n].qwc = (uint32_t)tag & 0xFFFF;
      ch[n].chcr = (ch[n].chcr & 0xFFFF) | (uint32_t)(tag & 0xFFFF0000);
    }
    uint32_t sent = send(n, ch[n].madr, ch[n].qwc, 0);
    ch[n].madr += sent * 16;
    ch[n].qwc -= sent;
    if ((ch[n].chcr >> 28 & 7) == DEST_END) finished(n);
  }
}

static void run(int n) {
  if (!(ch[n].chcr & CHCR_STR) || (enable & ENABLE_CPND)) return;
  if (n != 0 && n != 1 && n != 2 && n != FROM_SPR && n != TO_SPR) return;
  switch (ch[n].chcr >> 2 & 3) {
  case 0: run_normal(n); break;
  case 2: run_interleaved(n); break;
  default:
    if (n == FROM_SPR) run_destination_chain(n);
    else run_chain(n);
    break;
  }
}

static void write_chcr(int n, uint32_t value) {
  // while a channel runs, a write can only stop it
  if (ch[n].chcr & CHCR_STR) {
    if (!(value & CHCR_STR)) ch[n].chcr &= ~CHCR_STR;
  } else {
    ch[n].chcr = value;
  }
  if (!(ch[n].chcr & CHCR_STR)) return;
  if (!ch[n].qwc) ch[n].flags |= FIRST_TRANSFER;
  ch[n].flags &= ~RETURN_AT_TOP;
  running++;
  run(n);
  running--;
}

void dmac_resume_channel(int n) { run(n); }

void dmac_resume(void) {
  if (running) return;
  running++;
  for (int n = 0; n < CHANNELS; n++) run(n);
  running--;
}

uint32_t dmac_read(uint32_t address) {
  int n = number_of(address);
  uint32_t offset = address & 0xFF;
  if (n >= 0) {
    // a byte or a halfword further into CHCR, as a game reads it with LB or LH
    if (offset < 0x10) return ch[n].chcr >> (offset * 8);
    switch (offset) {
    case DMA_MADR: return ch[n].madr;
    case DMA_QWC: return ch[n].qwc;
    case DMA_TADR: return ch[n].tadr;
    case DMA_ASR0: return ch[n].asr[0];
    case DMA_ASR1: return ch[n].asr[1];
    case DMA_SADR: return ch[n].sadr;
    default: return 0;
    }
  }
  switch (address) {
  case D_CTRL: return ctrl;
  case D_STAT: return stat;
  case D_PCR: return pcr;
  case D_SQWC: return sqwc;
  case D_RBSR: return rbsr;
  case D_RBOR: return rbor;
  case D_STADR: return stadr;
  case D_ENABLER: return enable;
  default: return 0;
  }
}

void dmac_write(uint32_t address, uint32_t value) {
  int n = number_of(address);
  uint32_t offset = address & 0xFF;
  if (n >= 0) {
    if (offset == 0) write_chcr(n, value);
    else if (offset == 1) write_chcr(n, (ch[n].chcr & ~0xFF00u) | (value & 0xFF) << 8);
    else if (offset == DMA_MADR) ch[n].madr = value & (n == FROM_SPR || n == TO_SPR ? 0x7FFFFFF0u : ~15u);
    else if (offset == DMA_QWC) ch[n].qwc = value & 0xFFFF;
    else if (offset == DMA_TADR) ch[n].tadr = value & ~15u;
    else if (offset == DMA_ASR0) ch[n].asr[0] = value & ~15u;
    else if (offset == DMA_ASR1) ch[n].asr[1] = value & ~15u;
    else if (offset == DMA_SADR) ch[n].sadr = value & (PS2_SCRATCHPAD_SIZE - 16);
    return;
  }
  switch (address) {
  case D_CTRL: ctrl = value; break;
  // the low half's bits are cleared by writing 1, the high half's masks turned over
  case D_STAT: stat = (stat ^ (value & 0xFFFF0000)) & ~(value & 0xFFFF); break;
  case D_PCR: pcr = value; break;
  case D_SQWC: sqwc = value; break;
  case D_RBSR: rbsr = value; break;
  case D_RBOR: rbor = value; break;
  case D_STADR: stadr = value; break;
  case D_ENABLEW: enable = value; break;
  default: break;
  }
}
