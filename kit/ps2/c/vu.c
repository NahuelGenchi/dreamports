// The vector units (ps2.h): their memories, their registers, and their programs, run an instruction pair at a time as
// the console runs them. A program is 64-bit instructions, each an upper one, which does a sum on four floats at once,
// and a lower one, which loads, stores, branches, divides or does a sum on whole numbers, the two run together: each
// reads the registers as they were before the pair, and when both write the same one the upper's result is kept.
//
// Their floats follow the console's rules (ee.c), and what a program can see of their pipeline is kept: a float result
// is there four cycles after its instruction, and one that reads it sooner waits; the MAC, status and clip flags read
// are as the instructions four cycles before left them; Q changes when a division ends, seven or thirteen cycles on, and
// P when an EFU sum does, and an instruction that reads either sooner gets the old one; and a conditional branch right
// after an integer sum that changed its register tests the value from before the last four instructions' changes.
// XGKICK sends a packet from vector unit 1's memory to the GIF as PATH1 once the next pair has run, and XTOP and XITOP
// read what the VIF gave the program as it started.
//
// Where the console's documentation leaves something open, these follow what two of the three emulators that know the
// console best agree on: Play!, which the proof tools run, and PCSX2's interpreter and its recompiler.
//
// Vector unit 0 also takes the EE's COP2 instructions one at a time, in macro mode, and a game that writes a unit's
// program again in C has vu_add and the rest below, on whole vectors with the same rules.
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"

// a program longer than this, as one that never ends, is stopped where it is, as Play! leaves one after as many
#define MOST_PAIRS 500000

enum { X, Y, Z, W };
static uint32_t bits_of(float value) {
  uint32_t bits;
  __builtin_memcpy(&bits, &value, 4);
  return bits;
}
static float of_bits(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

enum { ST_Z = 1, ST_S = 2, ST_U = 4, ST_O = 8, ST_I = 16, ST_D = 32 };

// something a program changes that it sees only some cycles on, applied in the order it was done
enum { SETS_MAC, SETS_CLIP, SETS_DIVISION, SETS_STICKY, SETS_Q, SETS_P };
struct event { uint64_t at; int kind; uint32_t value, more; };
#define EVENTS 32

// what each of the last four pairs did to an integer register, for a branch after them
struct changed { int reg, by_flags; uint16_t before; uint64_t cycles; };

struct unit {
  uint8_t *code, *data;
  uint32_t code_size, data_size;
  vu_vector vf[32], acc;
  uint16_t vi[16];
  uint32_t q, p, i, r, mac, status, clip, clip_issued;
  struct event events[EVENTS];
  int event_count;
  uint64_t cycle, vf_ready[32][4], vi_ready[16], q_ready, p_ready;
  uint32_t pc, stopped_at, branch_to, kick_at, cmsar0;
  int running, branching, kick_pending;
  struct changed changes[4];
};

static uint8_t code0[4096], data0[4096], code1[16384], data1[16384];
static struct unit units[2] = {
  { .code = code0, .data = data0, .code_size = 4096, .data_size = 4096 },
  { .code = code1, .data = data1, .code_size = 16384, .data_size = 16384 },
};

uint8_t *vu_code(int unit) { return units[unit].code; }
uint8_t *vu_data(int unit) { return units[unit].data; }
uint32_t vu_code_size(int unit) { return units[unit].code_size; }
uint32_t vu_data_size(int unit) { return units[unit].data_size; }
int vu_ready(int unit) { return !units[unit].running; }
int vu_running(int unit) { return units[unit].running; }
uint32_t vu_stopped_at(int unit) { return units[unit].stopped_at; }

// VF0 is always (0, 0, 0, 1) and VI0 always 0
static uint32_t vf(const struct unit *u, int reg, int field) { return reg ? u->vf[reg].u[field] : field == W ? 0x3F800000 : 0; }
static uint16_t vi(const struct unit *u, int reg) { return reg & 15 ? u->vi[reg & 15] : 0; }
static void set_vi(struct unit *u, int reg, uint32_t value) {
  if (reg & 15) u->vi[reg & 15] = (uint16_t)value;
}

static void later(struct unit *u, uint64_t at, int kind, uint32_t value, uint32_t more) {
  // kept in the order they land, those landing together in the order they were done
  if (u->event_count == EVENTS) return;
  int i = u->event_count++;
  for (; i > 0 && u->events[i - 1].at > at; i--) u->events[i] = u->events[i - 1];
  u->events[i] = (struct event){ at, kind, value, more };
}
// everything done that's landed by `now` takes its place
static void land(struct unit *u, uint64_t now) {
  int done = 0;
  for (; done < u->event_count && u->events[done].at <= now; done++) {
    const struct event *e = &u->events[done];
    switch (e->kind) {
    case SETS_MAC: u->mac = e->value, u->status = (u->status & 0xFF0) | e->more | e->more << 6; break;
    case SETS_CLIP: u->clip = e->value; break;
    case SETS_DIVISION: u->status = (u->status & ~(uint32_t)(ST_I | ST_D)) | e->value | e->value << 6; break;
    case SETS_STICKY: u->status = (u->status & 0x3F) | e->value; break;
    case SETS_Q: u->q = e->value; break;
    case SETS_P: u->p = e->value; break;
    }
  }
  for (int i = done; i < u->event_count; i++) u->events[i - done] = u->events[i];
  u->event_count -= done;
}

// a sum's MAC flag bits for one field: zero, sign, underflow and overflow, x the highest of each four
static uint32_t lane_flags(uint32_t result, uint32_t flags, int field) {
  int bit = 3 - field;
  return (!(result & 0x7F800000) ? 1u << bit : 0) | (result >> 31 ? 1u << (4 + bit) : 0) |
         (flags & FLAG_U ? 1u << (8 + bit) : 0) | (flags & FLAG_O ? 1u << (12 + bit) : 0);
}
static void sum_flags(struct unit *u, uint64_t now, uint32_t mac) {
  uint32_t zsuo = (mac & 0x000F ? ST_Z : 0) | (mac & 0x00F0 ? ST_S : 0) | (mac & 0x0F00 ? ST_U : 0) | (mac & 0xF000 ? ST_O : 0);
  later(u, now + 4, SETS_MAC, mac, zsuo);
}

enum { OP_ADD, OP_SUB, OP_MUL, OP_MADD, OP_MSUB };
static uint32_t sum(int op, uint32_t acc, uint32_t a, uint32_t b, uint32_t *flags) {
  switch (op) {
  case OP_ADD: return fpu_add(a, b, flags);
  case OP_SUB: return fpu_add(a, b ^ 0x80000000, flags);
  case OP_MUL: return fpu_mul(a, b, flags);
  case OP_MADD: return fpu_mul_add(acc, a, b, 0, flags);
  default: return fpu_mul_add(acc, a, b, 1, flags);
  }
}

// a float as a number its bits order as, for MAX and MINI, as the units compare them
static int32_t comparable(uint32_t x) { return x >> 31 ? -1 - (int32_t)(x & 0x7FFFFFFF) : (int32_t)x - 1; }

// what a pair writes to a float register, once both halves have read what they need
struct write { int reg, dest; vu_vector value; };

// The upper instruction: its sum, written to `out` or to the accumulator, with its flags four cycles on.
static void upper(struct unit *u, uint32_t op, uint64_t now, struct write *out) {
  int dest = op >> 21 & 15, ft = op >> 16 & 31, fs = op >> 11 & 31, fd = op >> 6 & 31, bc = op & 3, code = op & 0x3F;
  out->reg = 0, out->dest = 0;
  // the extra table's instructions by their number in it, and the others' as they are
  int index = code >= 0x3C ? (code & 3) | fd << 2 : -1;
  int kind = -1, to_acc = index >= 0, with = 0;   // with: 0 a whole vector, 1 a field of ft, 2 Q, 3 I
  int number = to_acc ? index : code;
  if (number < 0x10 || (number >= 0x18 && number < 0x1C)) {
    static const int kinds[8] = { OP_ADD, OP_SUB, OP_MADD, OP_MSUB, -1, -1, OP_MUL, -1 };
    kind = kinds[number >> 2], with = 1;
  } else if (number >= 0x20 && number < 0x28) {
    static const int kinds[8] = { OP_ADD, OP_MADD, OP_ADD, OP_MADD, OP_SUB, OP_MSUB, OP_SUB, OP_MSUB };
    kind = kinds[number & 7], with = number & 2 ? 3 : 2;
  } else if (number >= 0x28 && number < 0x2E && number != 0x2B) {
    static const int kinds[6] = { OP_ADD, OP_MADD, OP_MUL, -1, OP_SUB, OP_MSUB };
    kind = kinds[number - 0x28], with = 0;
  } else if (number == 0x1C || number == 0x1E) {
    kind = OP_MUL, with = number == 0x1C ? 2 : 3;
  }
  if (!to_acc && (code == 0x1D || code == 0x1F || (code >= 0x10 && code < 0x18) || code == 0x2B || code == 0x2F)) {
    // MAX and MINI, with a field of ft, I or a whole vector: no flags
    int mini = (code >= 0x14 && code < 0x18) || code == 0x1F || code == 0x2F;
    out->reg = fd, out->dest = dest;
    for (int f = 0; f < 4; f++) {
      uint32_t a = vf(u, fs, f), b = code == 0x1D || code == 0x1F ? u->i : code >= 0x2B ? vf(u, ft, f) : vf(u, ft, bc);
      out->value.u[f] = mini ? (comparable(b) > comparable(a) ? a : b) : (comparable(a) > comparable(b) ? a : b);
    }
    return;
  }
  if (to_acc && index >= 0x10 && index < 0x18) {
    // ITOF0, 4, 12, 15 and FTOI0, 4, 12, 15: no flags
    static const int shifts[4] = { 0, 4, 12, 15 };
    int shift = shifts[index & 3];
    out->reg = ft, out->dest = dest;
    for (int f = 0; f < 4; f++) {
      uint32_t flags = 0, x = vf(u, fs, f);
      if (index < 0x14) {
        uint32_t whole = fpu_from_int((int32_t)x);
        out->value.u[f] = shift ? fpu_mul(whole, (uint32_t)(127 - shift) << 23, &flags) : whole;
      } else {
        out->value.i[f] = fpu_to_int(shift ? fpu_mul(x, (uint32_t)(127 + shift) << 23, &flags) : x);
      }
    }
    return;
  }
  if (to_acc && index == 0x1D) {
    // ABS
    out->reg = ft, out->dest = dest;
    for (int f = 0; f < 4; f++) out->value.u[f] = vf(u, fs, f) & 0x7FFFFFFF;
    return;
  }
  if (to_acc && index == 0x1F) {
    // CLIP: x, y and z against w's size, six judgements put after the last issued, seen four cycles on
    uint32_t judged = fpu_clip(vf(u, fs, X), vf(u, fs, Y), vf(u, fs, Z), vf(u, ft, W));
    u->clip_issued = ((u->clip_issued << 6) | judged) & 0xFFFFFF;
    later(u, now + 4, SETS_CLIP, u->clip_issued, 0);
    return;
  }
  if ((to_acc && index == 0x2E) || (!to_acc && code == 0x2E)) {
    // OPMULA and OPMSUB: the cross product's halves, x, y and z, the w field's flags clear
    uint32_t mac = 0;
    vu_vector result = u->acc;
    for (int f = 0; f < 3; f++) {
      uint32_t flags = 0, a = vf(u, fs, (f + 1) % 3), b = vf(u, ft, (f + 2) % 3);
      result.u[f] = to_acc ? fpu_mul(a, b, &flags) : sum(OP_MSUB, u->acc.u[f], a, b, &flags);
      mac |= lane_flags(result.u[f], flags, f);
    }
    sum_flags(u, now, mac);
    if (to_acc) u->acc = result;
    else out->reg = fd, out->dest = 14, out->value = result;
    return;
  }
  if (kind < 0) return;
  uint32_t mac = 0;
  vu_vector result = { .u = { 0, 0, 0, 0 } };
  for (int f = 0; f < 4; f++) {
    if (!(dest & (8 >> f))) continue;
    uint32_t b = with == 0 ? vf(u, ft, f) : with == 1 ? vf(u, ft, bc) : with == 2 ? u->q : u->i, flags = 0;
    result.u[f] = sum(kind, u->acc.u[f], vf(u, fs, f), b, &flags);
    mac |= lane_flags(result.u[f], flags, f);
  }
  // a sum to VF0 still sets its flags
  sum_flags(u, now, mac);
  if (to_acc) {
    for (int f = 0; f < 4; f++) if (dest & (8 >> f)) u->acc.u[f] = result.u[f];
  } else {
    out->reg = fd, out->dest = dest, out->value = result;
  }
}

static void write_vf(struct unit *u, const struct write *w, uint64_t now) {
  if (!w->reg) return;
  for (int f = 0; f < 4; f++) {
    if (!(w->dest & (8 >> f))) continue;
    u->vf[w->reg].u[f] = w->value.u[f];
    u->vf_ready[w->reg][f] = now + 4;
  }
}

static uint32_t place(const struct unit *u, uint32_t quadword) { return (quadword * 16) & (u->data_size - 1); }
static uint32_t load(const struct unit *u, uint32_t at) {
  uint32_t value;
  __builtin_memcpy(&value, u->data + (at & (u->data_size - 1)), 4);
  return value;
}
static void store(struct unit *u, uint32_t at, uint32_t value) { __builtin_memcpy(u->data + (at & (u->data_size - 1)), &value, 4); }
// ILW and ILWR read one field, and with more than one named, the last
static int one_field(int dest) { return dest & 1 ? W : dest & 2 ? Z : dest & 4 ? Y : X; }
static int32_t branch_offset(uint32_t op) { return (int32_t)(op << 21) >> 21; }

// An EFU sum's value for P and how many cycles on it's there (floats.c)
static uint32_t efu(const struct unit *u, uint32_t op, uint32_t index, uint64_t *cycles) {
  static const struct { uint8_t index, which, cycles; } sums[] = {
    { 0x1C, EFU_ESADD, 11 }, { 0x3C, EFU_ERSADD, 18 }, { 0x5C, EFU_ELENG, 18 }, { 0x7C, EFU_ERLENG, 24 }, { 0x5D, EFU_ESUM, 12 },
    { 0x1E, EFU_ESQRT, 12 }, { 0x3E, EFU_ERSQRT, 18 }, { 0x5E, EFU_ERCPR, 12 }, { 0x1F, EFU_ESIN, 29 }, { 0x5F, EFU_EEXP, 44 },
    { 0x1D, EFU_EATANXY, 54 }, { 0x3D, EFU_EATANXZ, 54 }, { 0x7D, EFU_EATAN, 54 },
  };
  int fs = op >> 11 & 31, fsf = op >> 21 & 3;
  for (unsigned i = 0; i < sizeof sums / sizeof sums[0]; i++) {
    if (sums[i].index != index) continue;
    *cycles = sums[i].cycles;
    return fpu_efu(sums[i].which, vf(u, fs, X), vf(u, fs, Y), vf(u, fs, Z), vf(u, fs, W), vf(u, fs, fsf));
  }
  *cycles = 0;
  return u->p;
}

static void kick(struct unit *u) {
  if (!u->kick_pending) return;
  u->kick_pending = 0;
  uint32_t at = (u->kick_at & 0x3FF) * 16, size = u->data_size;
  at += gif_path_packet(1, u->data, size, at, size);
  // a packet that runs past the end of the memory goes on from its start
  if (at == size && gif_active_path() == 1) gif_path_packet(1, u->data, size, 0, size);
}

// The lower instruction's kind: 0x00 to 0x3F its own number, or 0x100 and its number in the extra tables, the table in
// the top two of seven bits
static int lower_kind(uint32_t op) {
  uint32_t top = op >> 25;
  if (top != 0x40) return (int)top;
  if ((op & 0x3C) == 0x3C) return 0x100 | (int)((op & 3) << 5 | (op >> 6 & 31));
  return 0x200 | (int)(op & 0x3F);
}
enum {
  LQ = 0x00, SQ = 0x01, ILW = 0x04, ISW = 0x05, IADDIU = 0x08, ISUBIU = 0x09, FCEQ = 0x10, FCSET = 0x11, FCAND = 0x12,
  FCOR = 0x13, FSSET = 0x15, FSAND = 0x16, FSOR = 0x17, FMEQ = 0x18, FMAND = 0x1A, FMOR = 0x1B, FCGET = 0x1C, B = 0x20,
  BAL = 0x21, JR = 0x24, JALR = 0x25, IBEQ = 0x28, IBNE = 0x29, IBLTZ = 0x2C, IBGTZ = 0x2D, IBLEZ = 0x2E, IBGEZ = 0x2F,
  IADD = 0x230, ISUB = 0x231, IADDI = 0x232, IAND = 0x234, IOR = 0x235,
  MOVE = 0x10C, MR32 = 0x12C, LQI = 0x10D, SQI = 0x12D, LQD = 0x14D, SQD = 0x16D, DIV = 0x10E, SQRT = 0x12E, RSQRT = 0x14E,
  WAITQ = 0x16E, MTIR = 0x10F, MFIR = 0x12F, ILWR = 0x14F, ISWR = 0x16F, RNEXT = 0x110, RGET = 0x130, RINIT = 0x150,
  RXOR = 0x170, MFP = 0x119, XTOP = 0x11A, XITOP = 0x13A, XGKICK = 0x11B, WAITP = 0x17E,
};
static int is_efu(int kind) {
  int index = kind & 0xFF;
  return (kind & 0x100) && (index & 0x1C) == 0x1C && kind != WAITP;
}

// what an instruction reads, so the pair waits for it: up to two float registers' fields and two integer registers
struct needs { int reg[2], fields[2], vi[2]; };
static void upper_needs(uint32_t op, struct needs *n) {
  int dest = op >> 21 & 15, ft = op >> 16 & 31, fs = op >> 11 & 31, fd = op >> 6 & 31, code = op & 0x3F, bc = op & 3;
  int index = code >= 0x3C ? (code & 3) | fd << 2 : -1, number = index >= 0 ? index : code;
  *n = (struct needs){ { fs, 0 }, { dest, 0 }, { 0, 0 } };
  if (index == 0x2F || (index < 0 && code >= 0x30)) n->reg[0] = 0;                             // NOP
  else if (index == 0x1F) n->fields[0] = 14, n->reg[1] = ft, n->fields[1] = 1;                  // CLIP
  else if (number == 0x2E) n->fields[0] = 14, n->reg[1] = ft, n->fields[1] = 14;                // OPMULA, OPMSUB
  else if (index >= 0x10 && index < 0x18) {}                                                    // ITOF, FTOI
  else if (index == 0x1D) {}                                                                    // ABS
  else if (number < 0x1C) n->reg[1] = ft, n->fields[1] = 8 >> bc;                               // with a field of ft
  else if (number >= 0x28) n->reg[1] = ft, n->fields[1] = dest;                                 // with a whole vector
}
static void lower_needs(uint32_t op, int kind, struct needs *n) {
  int dest = op >> 21 & 15, ft = op >> 16 & 31, fs = op >> 11 & 31, fsf = op >> 21 & 3, ftf = op >> 23 & 3;
  *n = (struct needs){ { 0, 0 }, { 0, 0 }, { 0, 0 } };
  switch (kind) {
  case LQ: case ILW: case LQI: case LQD: case ILWR: case MFIR: case JR: case JALR: case XGKICK: case FMEQ: case FMAND: case FMOR:
  case IBLTZ: case IBGTZ: case IBLEZ: case IBGEZ: case IADDIU: case ISUBIU: case IADDI:
    n->vi[0] = fs;
    break;
  case ISW: case ISWR: case IBEQ: case IBNE: case IADD: case ISUB: case IAND: case IOR: n->vi[0] = fs, n->vi[1] = ft; break;
  case SQ: case SQI: case SQD: n->reg[0] = fs, n->fields[0] = dest, n->vi[0] = ft; break;
  case MOVE: case MR32: n->reg[0] = fs, n->fields[0] = dest; break;
  case DIV: case RSQRT: n->reg[0] = fs, n->fields[0] = 8 >> fsf, n->reg[1] = ft, n->fields[1] = 8 >> ftf; break;
  case SQRT: n->reg[0] = ft, n->fields[0] = 8 >> ftf; break;
  case MTIR: case RINIT: case RXOR: n->reg[0] = fs, n->fields[0] = 8 >> fsf; break;
  default:
    if (is_efu(kind)) {
      int index = kind & 0xFF, whole = index == 0x1C || index == 0x3C || index == 0x5C || index == 0x7C || index == 0x1D || index == 0x3D || index == 0x5D;
      n->reg[0] = fs, n->fields[0] = whole ? (index == 0x5D ? 15 : 14) : 8 >> fsf;
    }
    break;
  }
}
static uint64_t ready_for(const struct unit *u, const struct needs *n, uint64_t at) {
  for (int k = 0; k < 2; k++) {
    if (n->reg[k]) for (int f = 0; f < 4; f++) if ((n->fields[k] & (8 >> f)) && u->vf_ready[n->reg[k]][f] > at) at = u->vf_ready[n->reg[k]][f];
    if ((n->vi[k] & 15) && u->vi_ready[n->vi[k] & 15] > at) at = u->vi_ready[n->vi[k] & 15];
  }
  return at;
}

// the integer register an instruction changes in a way a branch straight after it doesn't see yet, or 0, and whether
// it's a flag instruction's, which a branch does see
static int changes_unseen(int kind, uint32_t op) {
  int ft = op >> 16 & 31, fs = op >> 11 & 31, fd = op >> 6 & 31;
  switch (kind) {
  case IADD: case ISUB: case IAND: case IOR: return fd & 15;
  case IADDI: case IADDIU: case ISUBIU: case MTIR: case XTOP: case XITOP: case BAL: case JALR: return ft & 15;
  case LQI: case LQD: return fs & 15;
  case SQI: case SQD: return ft & 15;
  default: return 0;
  }
}
static int changes_seen(int kind, uint32_t op) {
  switch (kind) {
  case FSAND: case FSOR: case FMEQ: case FMAND: case FMOR: case FCGET: return op >> 16 & 15;
  case FCEQ: case FCAND: case FCOR: return 1;
  default: return 0;
  }
}

// The value of integer register `reg` a conditional branch tests: when the pair before it changed it, as it was before
// the last four cycles' changes to it, back to one a flag instruction made (Play!'s and PCSX2's recompiler's rule)
static uint16_t branch_value(const struct unit *u, int reg, int stalled) {
  reg &= 15;
  if (!reg || stalled || u->changes[0].reg != reg || u->changes[0].by_flags) return vi(u, reg);
  uint16_t value = u->changes[0].before;
  uint64_t cycles = u->changes[0].cycles;
  for (int k = 1; k < 4 && cycles < 4; k++) {
    if (u->changes[k].reg == reg) {
      if (u->changes[k].by_flags) break;
      value = u->changes[k].before;
    }
    cycles += u->changes[k].cycles;
  }
  return value;
}

// One instruction pair: what it waits for, then both halves. It gives 1 for a pair with the E bit.
static int pair(struct unit *u, int number, uint32_t lower_op, uint32_t upper_op) {
  int loi = upper_op >> 31 & 1, ends = upper_op >> 30 & 1;
  int kind = loi ? -1 : lower_kind(lower_op);
  struct needs up, low;
  upper_needs(upper_op, &up);
  if (loi) low = (struct needs){ { 0, 0 }, { 0, 0 }, { 0, 0 } };
  else lower_needs(lower_op, kind, &low);
  uint64_t now = ready_for(u, &low, ready_for(u, &up, u->cycle));
  // a division waits for the last to end, as WAITQ does, and an EFU sum for the EFU, as WAITP does, a cycle short
  if ((kind == DIV || kind == SQRT || kind == RSQRT || kind == WAITQ) && u->q_ready > now) now = u->q_ready;
  if ((is_efu(kind) || kind == WAITP) && u->p_ready > now + 1) now = u->p_ready - 1;
  int stalled = now > u->cycle;
  land(u, now);
  // a kick from the pair before goes once this one has run, or before its own XGKICK
  int kick_due = u->kick_pending;
  u->kick_pending = 0;
  uint32_t kick_due_at = u->kick_at;

  struct write from_upper, from_lower = { 0, 0, { .u = { 0, 0, 0, 0 } } };
  upper(u, upper_op, now, &from_upper);

  int ft = lower_op >> 16 & 31, fs = lower_op >> 11 & 31, fd = lower_op >> 6 & 31, dest = lower_op >> 21 & 15;
  int fsf = lower_op >> 21 & 3, ftf = lower_op >> 23 & 3;
  uint32_t next = u->pc + 8, imm12 = (lower_op & 0x7FF) | (lower_op >> 10 & 0x800), imm15 = (lower_op & 0x7FF) | (lower_op >> 10 & 0x7800);
  int unseen = loi ? 0 : changes_unseen(kind, lower_op), seen = loi ? 0 : changes_seen(kind, lower_op);
  uint16_t before = vi(u, unseen ? unseen : seen);
  int taken = 0;
  uint32_t target = 0;
  // where the instruction after a branch's delay slot is, which BAL and JALR keep, from a delay slot the branch's target
  uint32_t link = ((u->branching ? u->branch_to : next) + 8) / 8;
  switch (kind) {
  case -1: break;
  case LQ: case LQI: case LQD: {
    if (kind == LQD) set_vi(u, fs, vi(u, fs) - 1);
    uint32_t at = place(u, vi(u, fs) + (kind == LQ ? (uint32_t)branch_offset(lower_op) : 0));
    from_lower.reg = ft, from_lower.dest = dest;
    for (int f = 0; f < 4; f++) from_lower.value.u[f] = load(u, at + f * 4);
    if (kind == LQI) set_vi(u, fs, vi(u, fs) + 1);
    break;
  }
  case SQ: case SQI: case SQD: {
    if (kind == SQD) set_vi(u, ft, vi(u, ft) - 1);
    uint32_t at = place(u, vi(u, ft) + (kind == SQ ? (uint32_t)branch_offset(lower_op) : 0));
    for (int f = 0; f < 4; f++) if (dest & (8 >> f)) store(u, at + f * 4, vf(u, fs, f));
    if (kind == SQI) set_vi(u, ft, vi(u, ft) + 1);
    break;
  }
  case ILW: case ILWR:
    set_vi(u, ft, load(u, place(u, vi(u, fs) + (kind == ILW ? (uint32_t)branch_offset(lower_op) : 0)) + one_field(dest) * 4));
    if (ft & 15) u->vi_ready[ft & 15] = now + 4;
    break;
  case ISW: case ISWR: {
    uint32_t at = place(u, vi(u, fs) + (kind == ISW ? (uint32_t)branch_offset(lower_op) : 0));
    for (int f = 0; f < 4; f++) if (dest & (8 >> f)) store(u, at + f * 4, vi(u, ft));
    break;
  }
  case IADDIU: set_vi(u, ft, vi(u, fs) + imm15); break;
  case ISUBIU: set_vi(u, ft, vi(u, fs) - imm15); break;
  case IADD: set_vi(u, fd, vi(u, fs) + vi(u, ft)); break;
  case ISUB: set_vi(u, fd, vi(u, fs) - vi(u, ft)); break;
  case IADDI: set_vi(u, ft, vi(u, fs) + (uint32_t)((int32_t)(lower_op << 21) >> 27)); break;
  case IAND: set_vi(u, fd, vi(u, fs) & vi(u, ft)); break;
  case IOR: set_vi(u, fd, vi(u, fs) | vi(u, ft)); break;
  case FCEQ: set_vi(u, 1, u->clip == (lower_op & 0xFFFFFF)); break;
  case FCAND: set_vi(u, 1, (u->clip & lower_op & 0xFFFFFF) != 0); break;
  case FCOR: set_vi(u, 1, ((u->clip | lower_op) & 0xFFFFFF) == 0xFFFFFF); break;
  case FCGET: set_vi(u, ft, u->clip & 0xFFF); break;
  case FCSET:
    u->clip_issued = lower_op & 0xFFFFFF;
    later(u, now + 4, SETS_CLIP, u->clip_issued, 0);
    break;
  case FSSET: later(u, now + 4, SETS_STICKY, imm12 & 0xFC0, 0); break;
  case FSAND: set_vi(u, ft, u->status & imm12); break;
  case FSOR: set_vi(u, ft, u->status | imm12); break;
  case FMEQ: set_vi(u, ft, u->mac == vi(u, fs)); break;
  case FMAND: set_vi(u, ft, u->mac & vi(u, fs)); break;
  case FMOR: set_vi(u, ft, u->mac | vi(u, fs)); break;
  case B: taken = 1, target = next + (uint32_t)branch_offset(lower_op) * 8; break;
  case BAL: taken = 1, target = next + (uint32_t)branch_offset(lower_op) * 8, set_vi(u, ft, link); break;
  case JR: taken = 1, target = (uint32_t)vi(u, fs) * 8; break;
  case JALR: taken = 1, target = (uint32_t)vi(u, fs) * 8, set_vi(u, ft, link); break;
  case IBEQ: case IBNE: case IBLTZ: case IBGTZ: case IBLEZ: case IBGEZ: {
    int16_t a = (int16_t)branch_value(u, fs, stalled), b = (int16_t)branch_value(u, ft, stalled);
    taken = kind == IBEQ ? a == b : kind == IBNE ? a != b : kind == IBLTZ ? a < 0 : kind == IBGTZ ? a > 0 : kind == IBLEZ ? a <= 0 : a >= 0;
    target = next + (uint32_t)branch_offset(lower_op) * 8;
    break;
  }
  case MOVE: case MR32:
    from_lower.reg = ft, from_lower.dest = dest;
    for (int f = 0; f < 4; f++) from_lower.value.u[f] = vf(u, fs, kind == MR32 ? (f + 1) & 3 : f);
    break;
  case DIV: case SQRT: case RSQRT: {
    // Q, and the status flag's D and I with their sticky bits, seven or thirteen cycles on
    uint32_t flags = 0, a = vf(u, fs, fsf), b = vf(u, ft, ftf);
    uint32_t value = kind == DIV ? fpu_div(a, b, &flags) : kind == SQRT ? fpu_sqrt(b, &flags) : fpu_rsqrt(a, b, &flags);
    uint64_t at = now + (kind == RSQRT ? 13 : 7);
    later(u, at, SETS_Q, value, 0);
    later(u, at, SETS_DIVISION, (flags & FLAG_D ? ST_D : 0) | (flags & FLAG_I ? ST_I : 0), 0);
    u->q_ready = at;
    break;
  }
  case MTIR: set_vi(u, ft, vf(u, fs, fsf)); break;
  case MFIR:
    from_lower.reg = ft, from_lower.dest = dest;
    for (int f = 0; f < 4; f++) from_lower.value.i[f] = (int16_t)vi(u, fs);
    break;
  case RNEXT: case RGET:
    if (kind == RNEXT) u->r = ((u->r << 1) ^ (u->r >> 4 & 1) ^ (u->r >> 22 & 1)) & 0x7FFFFF;
    from_lower.reg = ft, from_lower.dest = dest;
    for (int f = 0; f < 4; f++) from_lower.value.u[f] = u->r | 0x3F800000;
    break;
  case RINIT: u->r = vf(u, fs, fsf) & 0x7FFFFF; break;
  case RXOR: u->r = (u->r ^ vf(u, fs, fsf)) & 0x7FFFFF; break;
  case MFP:
    from_lower.reg = ft, from_lower.dest = dest;
    for (int f = 0; f < 4; f++) from_lower.value.u[f] = u->p;
    break;
  case XTOP: set_vi(u, ft, vif1_top() & 0x3FF); break;
  case XITOP: set_vi(u, ft, vif_itop(number) & (number ? 0x3FF : 0xFF)); break;
  case XGKICK:
    if (kick_due) u->kick_pending = 1, u->kick_at = kick_due_at, kick(u), kick_due = 0;
    u->kick_pending = number == 1, u->kick_at = vi(u, fs);
    break;
  case WAITQ: case WAITP: break;
  default:
    if (is_efu(kind)) {
      uint64_t cycles;
      uint32_t value = efu(u, lower_op, (uint32_t)(kind & 0xFF), &cycles);
      later(u, now + cycles, SETS_P, value, 0);
      u->p_ready = now + cycles;
    }
    break;
  }
  // the upper's result, and the lower's unless it's to the same register
  write_vf(u, &from_upper, now);
  if (!(from_upper.dest && from_lower.reg == from_upper.reg)) write_vf(u, &from_lower, now);
  if (loi) u->i = lower_op;
  if (kick_due) {
    int pending = u->kick_pending;
    uint32_t pending_at = u->kick_at;
    u->kick_pending = 1, u->kick_at = kick_due_at;
    kick(u);
    u->kick_pending = pending, u->kick_at = pending_at;
  }
  // what this pair changed, for a branch after it
  for (int k = 3; k > 0; k--) u->changes[k] = u->changes[k - 1];
  u->changes[0] = (struct changed){ unseen ? unseen : seen, !unseen && seen, before, now - u->cycle + 1 };
  u->cycle = now + 1;
  // a branch takes effect after the pair in its delay slot
  uint32_t after = next;
  if (u->branching) after = u->branch_to, u->branching = 0;
  if (taken) u->branching = 1, u->branch_to = target & (u->code_size - 1);
  u->pc = after & (u->code_size - 1);
  return ends;
}

static int step(struct unit *u, int number) {
  uint32_t lower_op, upper_op;
  __builtin_memcpy(&lower_op, u->code + (u->pc & (u->code_size - 1)), 4);
  __builtin_memcpy(&upper_op, u->code + ((u->pc + 4) & (u->code_size - 1)), 4);
  return pair(u, number, lower_op, upper_op);
}

void vu_start(int number, uint32_t address) {
  struct unit *u = &units[number];
  u->pc = address & (u->code_size - 1);
  u->running = 1, u->branching = 0;
  for (int k = 0; k < 4; k++) u->changes[k] = (struct changed){ 0, 0, 0, 1 };
  int ending = 0;
  for (long count = 0; count < MOST_PAIRS; count++) {
    int ends = step(u, number);
    // the pair with E, and the one after it, then the program ends, everything it started done
    if (ending) {
      land(u, UINT64_MAX);
      kick(u);
      u->running = 0;
      u->stopped_at = u->pc;
      return;
    }
    ending = ends;
  }
  land(u, UINT64_MAX);
  u->running = 0;
  u->stopped_at = u->pc;
}

// ---- Vector unit 0 in macro mode: one COP2 instruction at a time, each done before the next ----

vu_vector *vu0_vf(int reg) {
  // VF0 reads as its constant
  units[0].vf[0] = (vu_vector){ .u = { 0, 0, 0, 0x3F800000 } };
  return &units[0].vf[reg & 31];
}

void vu0_macro(uint32_t instruction) {
  struct unit *u = &units[0];
  uint32_t funct = instruction & 0x3F, lower = 0x8000033C, upper = 0x000002FF;
  if (funct >= 0x3C) {
    // the extra tables: the upper instructions' first, and from VMOVE on the lower ones', each encoded as in a program
    if ((instruction >> 6 & 31) < 0x0C) upper = instruction & 0x01FFFFFF;
    else lower = 0x80000000 | (instruction & 0x01FFFFFF);
  } else if (funct >= 0x30 && funct <= 0x35) {
    // VIADD, VISUB, VIADDI, VIAND, VIOR
    lower = 0x80000000 | (instruction & 0x01FFFFC0) | funct;
  } else if (funct == 0x38 || funct == 0x39) {
    // VCALLMS and VCALLMSR
    vu_start(0, funct == 0x38 ? (instruction >> 6 & 0x7FFF) * 8 : u->cmsar0 * 8);
    return;
  } else {
    upper = instruction & 0x01FFFFFF;
  }
  pair(u, 0, lower, upper);
  // in macro mode the EE waits for each, so everything it did is there for the next
  land(u, UINT64_MAX);
  u->q_ready = u->p_ready = 0;
  for (int r = 0; r < 32; r++) for (int f = 0; f < 4; f++) u->vf_ready[r][f] = 0;
  for (int r = 0; r < 16; r++) u->vi_ready[r] = 0;
  u->cycle = 0;
  for (int k = 0; k < 4; k++) u->changes[k] = (struct changed){ 0, 0, 0, 1 };
}

uint32_t vu0_cfc2(int reg) {
  const struct unit *u = &units[0];
  if (reg < 16) return vi(u, reg);
  switch (reg) {
  case 16: return u->status;
  case 17: return u->mac;
  case 18: return u->clip;
  case 20: return u->r;
  case 21: return u->i;
  case 22: return u->q;
  case 26: return u->stopped_at / 8;
  case 27: return u->cmsar0;
  case 29: return (units[0].running ? 1 : 0) | (units[1].running ? 0x100 : 0);
  default: return 0;
  }
}

void vu0_ctc2(int reg, uint32_t value) {
  struct unit *u = &units[0];
  if (reg < 16) {
    set_vi(u, reg, value);
    return;
  }
  switch (reg) {
  case 16: u->status = (u->status & 0x3F) | (value & 0xFC0); break;
  case 18: u->clip = u->clip_issued = value & 0xFFFFFF; break;
  case 20: u->r = value & 0x7FFFFF; break;
  case 21: u->i = value; break;
  case 22: u->q = value; break;
  case 27: u->cmsar0 = value & 0xFFFF; break;
  case 31: vu_start(1, (value & 0xFFFF) * 8); break;
  default: break;
  }
}

// ---- For a program written again in C: the upper instructions' sums on whole vectors, no flags ----
#define EACH(dest) for (int i = 0; i < 4; i++) if ((dest) & (8 >> i))

static float plain(int op, float acc, float a, float b) {
  uint32_t flags = 0;
  return of_bits(sum(op, bits_of(acc), bits_of(a), bits_of(b), &flags));
}
void vu_add(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = plain(OP_ADD, 0, fs->f[i], ft->f[i]); }
void vu_sub(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = plain(OP_SUB, 0, fs->f[i], ft->f[i]); }
void vu_mul(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = plain(OP_MUL, 0, fs->f[i], ft->f[i]); }
void vu_madd(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = plain(OP_MADD, acc->f[i], fs->f[i], ft->f[i]); }
void vu_msub(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = plain(OP_MSUB, acc->f[i], fs->f[i], ft->f[i]); }
void vu_addf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = plain(OP_ADD, 0, fs->f[i], with); }
void vu_subf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = plain(OP_SUB, 0, fs->f[i], with); }
void vu_mulf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = plain(OP_MUL, 0, fs->f[i], with); }
void vu_maddf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = plain(OP_MADD, acc->f[i], fs->f[i], with); }
void vu_msubf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = plain(OP_MSUB, acc->f[i], fs->f[i], with); }

void vu_ftoi(vu_vector *ft, const vu_vector *fs, int bits, int dest) {
  // times 1, 16, 4096 or 32768, and then what's after the point dropped
  EACH(dest) ft->i[i] = fpu_to_int(bits_of(bits ? plain(OP_MUL, 0, fs->f[i], of_bits((uint32_t)(127 + bits) << 23)) : fs->f[i]));
}
void vu_itof(vu_vector *ft, const vu_vector *fs, int bits, int dest) {
  EACH(dest) ft->f[i] = bits ? plain(OP_MUL, 0, of_bits(fpu_from_int(fs->i[i])), of_bits((uint32_t)(127 - bits) << 23)) : of_bits(fpu_from_int(fs->i[i]));
}
