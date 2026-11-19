// The VIFs: what feeds the vector units (ps2.h). VIF0 feeds vector unit 0 and VIF1 vector unit 1, each taking a stream
// of 32-bit VIF codes and their data from its DMA channel or its FIFO: UNPACK puts data in the unit's memory in any of
// its formats, through the mask, the row and the column, adding the row or keeping a running sum as STMOD says, written
// and skipped as STCYCL says; MPG puts a program in its code memory; MSCAL, MSCALF and MSCNT start a program; FLUSHE
// waits for it to end. VIF1 also double-buffers what it unpacks, with BASE, OFFSET and TOPS, sends packets to the GIF as
// PATH2 with DIRECT and DIRECTHL, masks PATH3 with MSKPATH3, and waits for the GIF with FLUSH and FLUSHA.
//
// It follows Play!, the console's emulator the proof tools run (Source/ee/Vif.cpp, Vif1.cpp), down to how a command whose
// data runs over the end of one transfer goes on in the next, and to when a program MSCAL starts runs: at the next
// command that has to wait for it, or once the transfer's data is all read, so the UNPACKs after an MSCAL are in the
// unit's memory before it runs. A program runs to its end then and there (vu.c). As on the console, MPG waits for the
// program before it to end.

#include "ps2-kit.h"

#define QWORD 16
#define FIFO_ROOM 256

enum {
  NOP = 0x00, STCYCL = 0x01, OFFSET = 0x02, BASE = 0x03, ITOP = 0x04, STMOD = 0x05, MSKPATH3 = 0x06, MARK = 0x07,
  FLUSHE = 0x10, FLUSH = 0x11, FLUSHA = 0x13, MSCAL = 0x14, MSCALF = 0x15, MSCNT = 0x17, STMASK = 0x20, STROW = 0x30,
  STCOL = 0x31, MPG = 0x4A, DIRECT = 0x50, DIRECTHL = 0x51,
};
enum { STAT_VPS = 3, STAT_VEW = 1 << 2, STAT_MRK = 1 << 6, STAT_DBF = 1 << 7, STAT_VIS = 1 << 10, STAT_INT = 1 << 11, STAT_ER0 = 1 << 12, STAT_ER1 = 1 << 13, STAT_FDR = 1 << 23 };
enum { MASK_DATA, MASK_ROW, MASK_COL, MASK_NONE };
enum { MODE_OFFSET = 1, MODE_DIFFERENCE = 2 };

// What a VIF reads from: a transfer's memory, from `next` to `end`, through a quadword it has read in, of which `used`
// bytes are gone. A transfer whose first quadword is its DMA tag skips that tag's first half.
struct stream { const uint8_t *source; uint32_t next, end, used, tag; uint8_t buffer[QWORD]; };

struct vif {
  int unit;
  uint32_t stat, err, mark, cycle, mode, num, mask, code, itops, itop, row[4], col[4];
  uint32_t read_tick, write_tick, waiting;
  int32_t pending;
  // VIF1's double buffer, and what's been read of a DIRECT's quadword that a transfer cut in two
  uint32_t base, ofst, tops, top, direct_used;
  uint8_t direct[QWORD];
  struct stream stream;
  uint8_t fifo[FIFO_ROOM];
  uint32_t fifo_used;
};
static struct vif vifs[2] = { { .unit = 0, .pending = -1, .stream.used = QWORD }, { .unit = 1, .pending = -1, .stream.used = QWORD } };

static uint32_t available(const struct stream *s) { return (s->end - s->next) + (QWORD - s->used); }
static void refill(struct stream *s) {
  if (s->used < QWORD) return;
  __builtin_memcpy(s->buffer, s->source + s->next, QWORD);
  s->next += QWORD;
  s->used = 0;
  if (s->tag) s->tag = 0, s->used = 8;
}
static void read(struct stream *s, void *into, uint32_t size) {
  uint8_t *to = into;
  while (size) {
    refill(s);
    uint32_t part = size < QWORD - s->used ? size : QWORD - s->used;
    __builtin_memcpy(to, s->buffer + s->used, part);
    to += part, s->used += part, size -= part;
  }
}
static uint32_t read_word(struct stream *s) {
  uint32_t value;
  read(s, &value, 4);
  return value;
}
static void align_word(struct stream *s) {
  uint8_t dummy[4];
  if (s->used & 3) read(s, dummy, 4 - (s->used & 3));
}
// where DIRECT's data starts, read in place, and moving past what the GIF took of it
static const uint8_t *in_place(const struct stream *s) { return s->used == QWORD ? s->source + s->next : s->source + s->next - QWORD + s->used; }
static void advance(struct stream *s, uint32_t size) {
  if (s->used == 0) size -= QWORD, s->used = QWORD;
  s->next += size;
  if (s->used != QWORD) __builtin_memcpy(s->buffer, s->source + s->next - QWORD, QWORD);
}

static int vu_busy(struct vif *v) { return !vu_ready(v->unit); }

// as a program starts: the ITOP it reads is ITOPS, and VIF1's TOP is TOPS, which then turns to the other buffer
static void prepare(struct vif *v) {
  v->itop = v->itops;
  if (v->unit == 1) {
    v->top = v->tops;
    v->tops = v->stat & STAT_DBF ? v->base : v->base + v->ofst;
    v->stat ^= STAT_DBF;
  }
}
static void start_now(struct vif *v, uint32_t address) {
  if (vu_busy(v)) {
    v->stat |= STAT_VEW;
    return;
  }
  prepare(v);
  vu_start(v->unit, address);
}
// MSCAL's program runs once the VIF has to wait for it, so the UNPACKs after it come first (Play!'s Vif.cpp)
static void start_later(struct vif *v, uint32_t address) {
  if (vu_busy(v)) {
    v->stat |= STAT_VEW;
    return;
  }
  prepare(v);
  v->pending = (int32_t)address;
}
static int run_pending(struct vif *v) {
  if (v->pending < 0) return 0;
  vu_start(v->unit, (uint32_t)v->pending);
  v->pending = -1;
  return 1;
}

static uint32_t sign_or_zero(uint32_t value, int bits, int usn) {
  if (usn) return value;
  uint32_t top = 1u << (bits - 1);
  return (value ^ top) - top;
}

// one value of an UNPACK's format into the four words it makes, or 0 when the data isn't all there yet
static int unpack_value(struct stream *s, uint32_t format, int usn, uint32_t out[4]) {
  static const uint8_t sizes[4] = { 4, 2, 1, 2 };
  uint32_t fields = (format >> 2) + 1, size = sizes[format & 3], need = (format & 3) == 3 ? 2 : fields * size;
  out[0] = out[1] = out[2] = out[3] = 0;
  if (available(s) < need) return 0;
  if ((format & 3) == 3) {
    // V4-5: a 16-bit colour, five bits each of red, green and blue and one of alpha
    uint16_t value;
    read(s, &value, 2);
    out[0] = (value & 0x1Fu) << 3, out[1] = (value >> 5 & 0x1Fu) << 3, out[2] = (value >> 10 & 0x1Fu) << 3, out[3] = (value >> 15 & 1u) << 7;
    return 1;
  }
  uint8_t bytes[16];
  read(s, bytes, need);
  for (uint32_t i = 0; i < fields; i++) {
    uint32_t value = 0;
    __builtin_memcpy(&value, bytes + i * size, size);
    out[i] = size == 4 ? value : sign_or_zero(value, (int)size * 8, usn);
  }
  // a single value fills all four
  if (fields == 1) out[1] = out[2] = out[3] = out[0];
  return 1;
}

static void unpack(struct vif *v, uint32_t address) {
  struct stream *s = &v->stream;
  uint8_t *memory = vu_data(v->unit);
  uint32_t size = vu_data_size(v->unit), cl = v->cycle & 0xFF, wl = v->cycle >> 8 & 0xFF;
  uint32_t format = v->code >> 24 & 0xF, masked = v->code >> 28 & 1, usn = v->code >> 14 & 1, mode = v->mode & 3;
  if (!wl) wl = UINT32_MAX, cl = 0;
  int skipping = cl >= wl;
  if (v->num == (v->code >> 16 & 0xFF)) v->read_tick = v->write_tick = 0;
  uint32_t left = v->num ? v->num : 256, all = (v->code >> 16 & 0xFF) ? v->code >> 16 & 0xFF : 256, done = all - left;
  // going on with an UNPACK a transfer cut in two: from where it got to
  address += cl > wl ? cl * (done / wl) + done % wl : done;
  address = (address * QWORD) & (size - 1);
  while (left) {
    uint32_t value[4];
    int write = 0;
    if (skipping) {
      if (v->read_tick < wl) {
        if (!unpack_value(s, format, (int)usn, value)) break;
        write = 1;
      }
    } else {
      // filling: past CL a cycle's writes take nothing from the data
      if (v->write_tick < cl && !unpack_value(s, format, (int)usn, value)) break;
      if (v->write_tick >= cl) value[0] = value[1] = value[2] = value[3] = 0;
      write = 1;
    }
    if (write) {
      uint32_t *to = (uint32_t *)(void *)(memory + address), column = v->write_tick > 3 ? 3 : v->write_tick;
      for (int i = 0; i < 4; i++) {
        uint32_t op = masked ? (v->mask >> (column * 8 + i * 2)) & 3 : MASK_DATA;
        if (op == MASK_DATA) {
          if (mode == MODE_OFFSET) value[i] += v->row[i];
          else if (mode == MODE_DIFFERENCE) value[i] += v->row[i], v->row[i] = value[i];
          to[i] = value[i];
        } else if (op == MASK_ROW) {
          to[i] = v->row[i];
        } else if (op == MASK_COL) {
          to[i] = v->col[column];
        }
      }
      left--;
    }
    v->write_tick = v->write_tick + 1 < wl ? v->write_tick + 1 : wl;
    v->read_tick = v->read_tick + 1 < cl ? v->read_tick + 1 : cl;
    if (skipping ? v->read_tick == cl : v->write_tick == wl) v->read_tick = v->write_tick = 0;
    address = (address + QWORD) & (size - 1);
  }
  if (left) {
    v->stat = (v->stat & ~STAT_VPS) | 1;
  } else {
    align_word(s);
    v->stat &= ~STAT_VPS;
  }
  v->num = left & 0xFF;
}

static void mpg(struct vif *v) {
  struct stream *s = &v->stream;
  // a program goes in only once the one before has ended
  if (run_pending(v) || vu_busy(v)) {
    v->stat |= STAT_VEW;
    return;
  }
  uint32_t left = (v->num ? v->num : 256) * 8, all = ((v->code >> 16 & 0xFF) ? v->code >> 16 & 0xFF : 256) * 8;
  uint32_t size = available(s) < left ? available(s) : left, code_size = vu_code_size(v->unit);
  uint32_t at = ((v->code & 0xFFFF) * 8 + (all - left)) & (code_size - 1);
  uint8_t *code = vu_code(v->unit);
  for (uint32_t i = 0; i < size; i++) read(s, code + ((at + i) & (code_size - 1)), 1);
  v->num = (v->num - size / 8) & 0xFF;
  if (!v->num && size) v->stat &= ~STAT_VPS;
  else v->stat = (v->stat & ~STAT_VPS) | 1;
}

static void fill(struct vif *v, uint32_t *into, uint32_t count) {
  while (v->num && available(&v->stream)) into[count - v->num] = read_word(&v->stream), v->num--;
  if (v->num) v->stat = (v->stat & ~STAT_VPS) | 1;
  else v->stat &= ~STAT_VPS;
}

static void direct(struct vif *v) {
  struct stream *s = &v->stream;
  uint32_t size = available(s);
  if (size) {
    if (v->direct_used || size < QWORD) {
      // what's there of a quadword, kept until the rest of it comes
      uint32_t part = size < QWORD - v->direct_used ? size : QWORD - v->direct_used;
      read(s, v->direct + v->direct_used, part);
      v->direct_used += part;
      size -= part;
      if (v->direct_used == QWORD && gif_path_packets(2, v->direct, QWORD, 0, QWORD)) {
        v->code = (v->code & 0xFFFF0000) | ((v->code - 1) & 0xFFFF);
        v->direct_used = 0;
      }
    }
    if (!v->direct_used) {
      uint32_t whole = (v->code & 0xFFFF) * QWORD < (size & ~15u) ? (v->code & 0xFFFF) * QWORD : size & ~15u;
      uint32_t sent = gif_path_packets(2, in_place(s), whole, 0, whole);
      if (sent) advance(s, sent);
      v->code = (v->code & 0xFFFF0000) | (((v->code & 0xFFFF) - sent / QWORD) & 0xFFFF);
    }
  }
  if (v->code & 0xFFFF) v->stat = (v->stat & ~STAT_VPS) | 1;
  else v->stat &= ~STAT_VPS;
}

// FLUSHE, and on VIF1 FLUSH and FLUSHA: wait for the program, as the GIF here has always sent what it had
static int flush(struct vif *v) {
  if (vu_busy(v)) v->stat |= STAT_VEW;
  else v->stat &= ~STAT_VEW;
  if (run_pending(v)) {
    v->stat |= STAT_VEW;
    return 1;
  }
  return 0;
}

static void command(struct vif *v) {
  uint32_t cmd = v->code >> 24 & 0x7F, imm = v->code & 0xFFFF;
  if (cmd >= 0x60) {
    uint32_t address = imm & 0x3FF;
    if (v->unit == 1 && (imm & 0x8000)) address += v->tops;
    unpack(v, address);
    return;
  }
  int vif1 = v->unit == 1;
  switch (cmd) {
  case NOP: break;
  case STCYCL: v->cycle = imm; break;
  case OFFSET:
    if (!vif1) goto unknown;
    v->ofst = imm & 0x3FF, v->stat &= ~STAT_DBF, v->tops = v->base;
    break;
  case BASE:
    if (!vif1) goto unknown;
    v->base = imm & 0x3FF;
    break;
  case ITOP:
    if (run_pending(v)) {
      v->stat |= STAT_VEW;
      return;
    }
    v->itops = imm & 0x3FF;
    break;
  case STMOD: v->mode = imm & 3; break;
  case MSKPATH3:
    if (!vif1) goto unknown;
    gif_mask_path3((imm & 0x8000) != 0);
    break;
  case MARK: v->mark = imm, v->stat |= STAT_MRK; break;
  case FLUSHE: flush(v); break;
  case FLUSH: case FLUSHA:
    if (!vif1) goto unknown;
    flush(v);
    break;
  case MSCAL:
    if (run_pending(v)) {
      v->stat |= STAT_VEW;
      return;
    }
    start_later(v, imm * 8);
    break;
  case MSCALF:
    if (run_pending(v)) {
      v->stat |= STAT_VEW;
      return;
    }
    start_now(v, imm * 8);
    break;
  case MSCNT:
    if (run_pending(v)) {
      v->stat |= STAT_VEW;
      return;
    }
    start_now(v, vu_stopped_at(v->unit));
    break;
  case STMASK: fill(v, &v->mask, 1); break;
  case STROW: fill(v, v->row, 4); break;
  case STCOL: fill(v, v->col, 4); break;
  case MPG: mpg(v); break;
  case DIRECT: case DIRECTHL:
    if (!vif1) goto unknown;
    if (run_pending(v)) {
      v->stat |= STAT_VEW;
      return;
    }
    direct(v);
    break;
  default:
  unknown:
    v->stat |= STAT_ER1;
    break;
  }
}

static void process(struct vif *v) {
  struct stream *s = &v->stream;
  while (available(s)) {
    if (v->stat & STAT_VPS) {
      // a command still waiting for its data
      command(v);
      if ((v->stat & STAT_VPS) && available(s)) break;
      continue;
    }
    if (v->stat & STAT_VEW) {
      if (vu_busy(v)) break;
      v->stat &= ~STAT_VEW;
      command(v);
      continue;
    }
    if (v->stat & STAT_VIS) break;
    v->code = read_word(s);
    // a code with its interrupt bit stalls the VIF after it, until the EE's code lets it go on with FBRST
    if (v->code >> 31) {
      if ((v->code >> 24 & 0x7F) != MARK) v->stat |= STAT_VIS;
      v->stat |= STAT_INT;
    }
    uint32_t cmd = v->code >> 24 & 0x7F;
    v->num = cmd == STMASK ? 1 : cmd == STROW || cmd == STCOL ? 4 : v->code >> 16 & 0xFF;
    command(v);
  }
  if (!available(s)) run_pending(v);
}

uint32_t vif_receive(int unit, uint32_t address, uint32_t qwc, int tag) {
  struct vif *v = &vifs[unit];
  if ((v->stat & STAT_VEW) && vu_busy(v)) return 0;
  struct stream *s = &v->stream;
  s->source = address & 0x80000000 ? ps2_scratchpad() : ee_memory();
  s->next = address & (address & 0x80000000 ? PS2_SCRATCHPAD_SIZE - 1 : PS2_RAM_SIZE - 1);
  s->end = s->next + qwc * QWORD;
  s->tag = (uint32_t)tag;
  refill(s);
  process(v);
  return qwc - (s->end - s->next) / QWORD;
}

uint32_t vif1_top(void) { return vifs[1].top; }
uint32_t vif_itop(int unit) { return vifs[unit].itop; }

uint32_t vif_read(uint32_t address) {
  struct vif *v = &vifs[address >= VIF1_STAT];
  switch (address & 0x3F0) {
  case 0x000: {
    if ((v->stat & STAT_VEW) && (v->code >> 24 & 0x7F) == FLUSHE && !vu_busy(v)) v->stat &= ~STAT_VEW;
    // stalled by an interrupt bit, a VIF says it's decoding
    return v->stat & STAT_VIS ? (v->stat & ~STAT_VPS) | 2 : v->stat;
  }
  case 0x020: return v->err;
  case 0x030: return v->mark;
  case 0x040: return v->cycle;
  case 0x050: return v->mode;
  case 0x060: return v->num;
  case 0x070: return v->mask;
  case 0x080: return v->code;
  case 0x090: return v->itops;
  case 0x0A0: return v->base;
  case 0x0B0: return v->ofst;
  case 0x0C0: return v->tops;
  case 0x0D0: return v->itop;
  case 0x0E0: return v->top;
  case 0x100: case 0x110: case 0x120: case 0x130: return v->row[(address >> 4) & 3];
  case 0x140: case 0x150: case 0x160: case 0x170: return v->col[(address >> 4) & 3];
  default: return 0;
  }
}

void vif_write(uint32_t address, uint32_t value) {
  if (address >= VIF0_FIFO && address < VIF1_FIFO + 0x1000) {
    struct vif *v = &vifs[address >= VIF1_FIFO];
    if (v->fifo_used == FIFO_ROOM) return;
    __builtin_memcpy(v->fifo + v->fifo_used + (address & 0xC), &value, 4);
    // the fourth word of a quadword sends it in
    if ((address & 0xC) != 0xC) return;
    v->fifo_used += QWORD;
    struct stream *s = &v->stream;
    s->source = v->fifo, s->next = 0, s->end = v->fifo_used, s->tag = 0;
    refill(s);
    process(v);
    uint32_t left = s->end - s->next;
    __builtin_memmove(v->fifo, v->fifo + v->fifo_used - left, left);
    v->fifo_used = left;
    return;
  }
  struct vif *v = &vifs[address >= VIF1_STAT];
  switch (address & 0x3F0) {
  case 0x000:
    if (v->unit == 1) v->stat = (v->stat & ~STAT_FDR) | (value & STAT_FDR);
    break;
  case 0x010:
    if (value & 1) v->code = 0, v->stat = 0, v->num = 0;
    // STC: the stalls and errors are cleared, and the VIF goes on
    if (value & 8) v->stat &= ~(STAT_VIS | STAT_INT | STAT_ER0 | STAT_ER1 | 0x300);
    break;
  case 0x020: v->err = value; break;
  case 0x030: v->mark = value, v->stat &= ~STAT_MRK; break;
  default: break;
  }
}
