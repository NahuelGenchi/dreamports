// The RSP's vector unit: 32 registers of eight 16-bit lanes, the accumulator of 48 bits a lane behind them, and the
// flags its comparisons leave, VCO, VCC and VCE. An instruction takes its second operand whole or with lanes picked by
// its element, and writes its result to a register and the accumulator's low lanes, as the console's does. Its loads
// and stores move bytes between data memory and a register's sixteen, the lanes' highest byte first.
//
// Every sum is cxd4's, the RSP the proof tools' emulator runs, on the paths it's built with there, so a proof can
// compare the two lane for lane: where cxd4 and the console's documentation part, cxd4's is kept. VABS of -32768 gives
// 32767 whatever the sign beside it, VMRG leaves the flags, LFV, LWV and SWV do nothing and VMULQ, VMACQ, VRNDP and
// VRNDN write zero. Followed from cxd4 by Iconoclast, in libretro/parallel-n64 at
// 2d90e20fa140b104d810bc0ea289f6f382e5086a (mupen64plus-rsp-cxd4/vu and su.c), dedicated to the public domain under CC0.

#include "n64-kit.h"

static int16_t vr[32][8];
// the accumulator's high, middle and low 16 bits of each lane
static int16_t acc_h[8], acc_m[8], acc_l[8];
// VCO's not-equal and carry, VCC's clip and compare, and VCE, a lane each, 0 or 1
static int16_t ne[8], co[8], clip[8], comp[8], vce[8];
// the divide's input, held between VRCPH and VRCPL, its result, and whether the last was a high half
static int32_t div_in, div_out;
static int div_high;
// the console's reciprocal and inverse square root tables, made as it makes them
static uint16_t reciprocals[512], square_roots[512];

static uint32_t isqrt(uint64_t n) {
  uint64_t low = 0, high = 1u << 23;
  while (low < high) {
    uint64_t middle = (low + high + 1) / 2;
    if (middle * middle <= n) low = middle;
    else high = middle - 1;
  }
  return (uint32_t)low;
}

void vu_power(void) {
  for (int v = 0; v < 32; v++) for (int i = 0; i < 8; i++) vr[v][i] = 0;
  for (int i = 0; i < 8; i++) acc_h[i] = acc_m[i] = acc_l[i] = ne[i] = co[i] = clip[i] = comp[i] = vce[i] = 0;
  div_in = div_out = div_high = 0;
  for (uint32_t i = 0; i < 512; i++) {
    reciprocals[i] = i == 0 ? 0xFFFF : (uint16_t)((((uint64_t)1 << 34) / (i + 512) + 1) >> 8);
    // the largest b from 2^17 for which ab^2 is under 2^44, halved
    uint64_t a = (i + 512) >> (i & 1);
    uint32_t b = isqrt((((uint64_t)1 << 44) - 1) / a);
    if (b < (1u << 17)) b = 1u << 17;
    square_roots[i] = (uint16_t)(b >> 1);
  }
}

// a register's bytes, 0 to 15, lane 0's high byte first
static uint8_t byte_of(int v, int b) {
  uint16_t lane = (uint16_t)vr[v][(b >> 1) & 7];
  return b & 1 ? (uint8_t)lane : (uint8_t)(lane >> 8);
}
static void set_byte(int v, int b, uint8_t value) {
  uint16_t lane = (uint16_t)vr[v][(b >> 1) & 7];
  vr[v][(b >> 1) & 7] = (int16_t)(b & 1 ? (lane & 0xFF00) | value : (lane & 0x00FF) | value << 8);
}

// the accumulator's middle and high lanes as one signed number, clamped to 16 bits
static int16_t clamp_middle(int i) {
  int below = acc_h[i] < -1 || (acc_h[i] < 0 && acc_m[i] >= 0);
  int above = acc_h[i] > 0 || (acc_h[i] == 0 && acc_m[i] < 0);
  return below ? -32768 : above ? 32767 : acc_m[i];
}
// the same with no sign: below zero as zero, and above 32767 as 0xFFFF where its middle lane shows it, as cxd4 has it
static int16_t clamp_unsigned(int i) {
  int16_t clamped = clamp_middle(i);
  int16_t result = clamped < 0 ? 0 : clamped;
  return clamped > acc_m[i] ? -1 : result;
}
// the low lane, or 0 or 0xFFFF where the middle and high clamp
static int16_t clamp_low(int i) {
  int16_t clamped = clamp_middle(i);
  return clamped != acc_m[i] ? (int16_t)(clamped ^ 0x8000) : acc_l[i];
}

static void clear_flags(void) {
  for (int i = 0; i < 8; i++) ne[i] = co[i] = 0;
}

// the divide, as the console's does it, from its tables
static void divide(int32_t data, int square_root, int high) {
  if (!high) data = data < 0 ? -data : data;
  else if (data < 0) data = data >= -32768 ? -data : ~data;
  uint32_t address = (uint32_t)data;
  int shift = 0;
  if (data == 0) {
    shift = high ? 0 : 16;
    address <<= shift;
  } else {
    while (!(address & 0x80000000u)) address <<= 1, shift++;
  }
  address = (address >> 22) & 0x1FF;
  uint32_t entry;
  if (square_root) entry = square_roots[(address & 0x1FE) | (shift & 1)];
  else entry = reciprocals[address];
  shift ^= 31;
  shift >>= square_root;
  div_out = (int32_t)((0x40000000u | entry << 14) >> shift);
  if (div_in == 0) div_out = 0x7FFFFFFF;
  else if (div_in == -32768) div_out = -0x10000;
  else if (div_in < 0) div_out = ~div_out;
}

// VCO, VCC and VCE as a scalar register reads them
static uint16_t flags_read(int which) {
  uint16_t value = 0;
  for (int i = 0; i < 8; i++) {
    if (which == 0) value |= (uint16_t)(co[i] << i | ne[i] << (i + 8));
    else if (which == 1) value |= (uint16_t)(comp[i] << i | clip[i] << (i + 8));
    else value |= (uint16_t)(vce[i] << i);
  }
  return value;
}
static void flags_write(int which, uint16_t value) {
  for (int i = 0; i < 8; i++) {
    if (which == 0) co[i] = value >> i & 1, ne[i] = value >> (i + 8) & 1;
    else if (which == 1) comp[i] = value >> i & 1, clip[i] = value >> (i + 8) & 1;
    else vce[i] = value >> i & 1;
  }
}

// One computational instruction on `s` and `t`, `t` with its lanes picked: its result into `d`.
static void compute(uint32_t word, const int16_t *s, const int16_t *t, int16_t *d) {
  uint32_t function = word & 63, e = word >> 21 & 15, vt = word >> 16 & 31, de = word >> 11 & 31, vd = word >> 6 & 31;
  switch (function) {
  case 0x00: case 0x01: // VMULF, VMULU
    for (int i = 0; i < 8; i++) {
      int64_t product = (int64_t)s[i] * t[i] * 2 + 32768;
      acc_l[i] = (int16_t)product, acc_m[i] = (int16_t)(product >> 16), acc_h[i] = (int16_t)-(product < 0);
      d[i] = function ? clamp_unsigned(i) : clamp_middle(i);
    }
    break;
  case 0x04: // VMUDL
    for (int i = 0; i < 8; i++) {
      acc_l[i] = (int16_t)(((uint32_t)(uint16_t)s[i] * (uint16_t)t[i]) >> 16), acc_m[i] = acc_h[i] = 0;
      d[i] = acc_l[i];
    }
    break;
  case 0x05: case 0x06: // VMUDM, VMUDN
    for (int i = 0; i < 8; i++) {
      int32_t product = function == 0x05 ? s[i] * (int32_t)(uint16_t)t[i] : (int32_t)(uint16_t)s[i] * t[i];
      acc_l[i] = (int16_t)product, acc_m[i] = (int16_t)(product >> 16), acc_h[i] = (int16_t)-(acc_m[i] < 0);
      d[i] = function == 0x05 ? acc_m[i] : acc_l[i];
    }
    break;
  case 0x07: // VMUDH
    for (int i = 0; i < 8; i++) {
      int32_t product = s[i] * t[i];
      acc_l[i] = 0, acc_m[i] = (int16_t)product, acc_h[i] = (int16_t)(product >> 16);
      d[i] = clamp_middle(i);
    }
    break;
  case 0x08: case 0x09: // VMACF, VMACU
    for (int i = 0; i < 8; i++) {
      int32_t product = s[i] * t[i];
      uint32_t sum = (uint16_t)acc_l[i] + (((uint32_t)product << 1) & 0xFFFF);
      acc_l[i] = (int16_t)sum;
      sum = (sum >> 16) + (uint16_t)(product >> 15);
      sum += (uint16_t)acc_m[i];
      acc_m[i] = (int16_t)sum;
      acc_h[i] = (int16_t)(acc_h[i] - (product < 0) + (int32_t)(sum >> 16));
      d[i] = function == 0x08 ? clamp_middle(i) : clamp_unsigned(i);
    }
    break;
  case 0x0C: // VMADL
    for (int i = 0; i < 8; i++) {
      uint32_t product = (uint32_t)(uint16_t)s[i] * (uint16_t)t[i];
      uint32_t sum = (uint16_t)(product >> 16) + (uint32_t)(uint16_t)acc_l[i];
      acc_l[i] = (int16_t)sum;
      sum = (sum >> 16) + (uint16_t)acc_m[i];
      acc_m[i] = (int16_t)sum;
      acc_h[i] = (int16_t)(acc_h[i] + (int32_t)(sum >> 16));
      d[i] = clamp_low(i);
    }
    break;
  case 0x0D: case 0x0E: // VMADM, VMADN
    for (int i = 0; i < 8; i++) {
      int32_t product = function == 0x0D ? s[i] * (int32_t)(uint16_t)t[i] : (int32_t)(uint16_t)s[i] * t[i];
      uint32_t sum = ((uint32_t)product & 0xFFFF) + (uint16_t)acc_l[i];
      acc_l[i] = (int16_t)sum;
      sum = (sum >> 16) + (uint32_t)(product >> 16);
      sum += (uint16_t)acc_m[i];
      acc_m[i] = (int16_t)sum;
      acc_h[i] = (int16_t)(acc_h[i] + (int32_t)(sum >> 16));
      d[i] = function == 0x0D ? clamp_middle(i) : clamp_low(i);
    }
    break;
  case 0x0F: // VMADH
    for (int i = 0; i < 8; i++) {
      int32_t product = s[i] * t[i];
      uint32_t sum = (uint32_t)(uint16_t)acc_m[i] + (uint16_t)product;
      acc_m[i] = (int16_t)(acc_m[i] + (int16_t)product);
      acc_h[i] = (int16_t)(acc_h[i] + (int32_t)(sum >> 16) + (product >> 16));
      d[i] = clamp_middle(i);
    }
    break;
  case 0x10: case 0x11: // VADD, VSUB, with the carry in, clamped
    for (int i = 0; i < 8; i++) {
      int32_t sum = function == 0x10 ? s[i] + t[i] + co[i] : s[i] - t[i] - co[i];
      acc_l[i] = (int16_t)sum;
      d[i] = sum < -32768 ? -32768 : sum > 32767 ? 32767 : acc_l[i];
    }
    clear_flags();
    break;
  case 0x13: // VABS
    for (int i = 0; i < 8; i++) {
      int sign = (s[i] > 0) - (s[i] < 0);
      acc_l[i] = (int16_t)((int16_t)(t[i] * sign) - (t[i] == -32768));
      d[i] = acc_l[i];
    }
    break;
  case 0x14: // VADDC
    for (int i = 0; i < 8; i++) {
      uint32_t sum = (uint32_t)(uint16_t)s[i] + (uint16_t)t[i];
      acc_l[i] = (int16_t)sum, d[i] = acc_l[i], ne[i] = 0, co[i] = (int16_t)(sum >> 16);
    }
    break;
  case 0x15: // VSUBC
    for (int i = 0; i < 8; i++) {
      int32_t difference = (int32_t)(uint16_t)s[i] - (uint16_t)t[i];
      acc_l[i] = (int16_t)(s[i] - t[i]), d[i] = acc_l[i], ne[i] = s[i] != t[i], co[i] = difference < 0;
    }
    break;
  case 0x1D: { // VSAR: a third of the accumulator
    const int16_t *third = e == 8 ? acc_h : e == 9 ? acc_m : e == 10 ? acc_l : 0;
    for (int i = 0; i < 8; i++) d[i] = third ? third[i] : 0;
    break;
  }
  case 0x20: case 0x23: // VLT, VGE
    for (int i = 0; i < 8; i++) {
      int equal = s[i] == t[i] && (function == 0x20 ? ne[i] & co[i] : !(ne[i] & co[i]));
      comp[i] = (int16_t)((function == 0x20 ? s[i] < t[i] : s[i] > t[i]) || equal);
      acc_l[i] = comp[i] ? s[i] : t[i], d[i] = acc_l[i];
    }
    for (int i = 0; i < 8; i++) ne[i] = co[i] = clip[i] = 0;
    break;
  case 0x21: case 0x22: // VEQ, VNE
    for (int i = 0; i < 8; i++) {
      comp[i] = (int16_t)(function == 0x21 ? s[i] == t[i] && !ne[i] : s[i] != t[i] || ne[i]);
      acc_l[i] = function == 0x21 ? t[i] : s[i], d[i] = acc_l[i];
    }
    for (int i = 0; i < 8; i++) ne[i] = co[i] = clip[i] = 0;
    break;
  case 0x24: // VCL
    for (int i = 0; i < 8; i++) {
      uint16_t b = (uint16_t)s[i], c = (uint16_t)t[i];
      int equal = ne[i] ^ 1, sign = co[i];
      c = (uint16_t)((c ^ (uint16_t)-sign) + sign);
      int16_t difference = (int16_t)(b - c);
      int under = (int32_t)b + (uint16_t)t[i] - 65536 < 0, zero = difference == 0;
      int greater = (zero || under) && vce[i], lesser = ((zero && under) && !vce[i]) || greater;
      greater = b >= c;
      int16_t le = equal && sign ? (int16_t)lesser : comp[i];
      int16_t ge = equal && !sign ? (int16_t)greater : clip[i];
      int pick = sign ? le : ge;
      acc_l[i] = pick ? (int16_t)c : s[i], d[i] = acc_l[i];
      clip[i] = ge, comp[i] = le;
    }
    for (int i = 0; i < 8; i++) ne[i] = co[i] = vce[i] = 0;
    break;
  case 0x25: // VCH
    for (int i = 0; i < 8; i++) {
      int16_t most = t[i] == -32768 ? -1 : 0, sign = (s[i] ^ t[i]) < 0 ? -1 : 0;
      int16_t c = (int16_t)(t[i] ^ sign);
      vce[i] = (int16_t)((s[i] == c) & sign);
      c = (int16_t)(c - (sign & ~most));
      int equal = ((s[i] == c) & ~most) | vce[i];
      int16_t ge = (int16_t)(sign | s[i]) >= t[i];
      int16_t one = (int16_t)((uint16_t)sign >> 15);
      int16_t le = one ? (int16_t)((int16_t)(c - s[i]) >= 0) : (int16_t)(t[i] < 0);
      comp[i] = one ? le : ge;
      acc_l[i] = comp[i] ? c : s[i], d[i] = acc_l[i];
      clip[i] = ge, comp[i] = le, ne[i] = (int16_t)(equal ^ 1), co[i] = one;
    }
    break;
  case 0x26: // VCR
    for (int i = 0; i < 8; i++) {
      int16_t sign = (s[i] ^ t[i]) < 0 ? -1 : 0;
      int16_t le = t[i] <= (int16_t)~(s[i] & sign), ge = (int16_t)(s[i] | sign) >= t[i];
      int16_t c = (int16_t)(t[i] ^ sign);
      acc_l[i] = (sign ? le : ge) ? c : s[i], d[i] = acc_l[i];
      clip[i] = ge, comp[i] = le;
    }
    for (int i = 0; i < 8; i++) ne[i] = co[i] = vce[i] = 0;
    break;
  case 0x27: // VMRG
    for (int i = 0; i < 8; i++) acc_l[i] = comp[i] ? s[i] : t[i], d[i] = acc_l[i];
    break;
  case 0x28: case 0x29: case 0x2A: case 0x2B: case 0x2C: case 0x2D: // VAND, VNAND, VOR, VNOR, VXOR, VNXOR
    for (int i = 0; i < 8; i++) {
      int16_t value = function < 0x2A ? s[i] & t[i] : function < 0x2C ? s[i] | t[i] : s[i] ^ t[i];
      acc_l[i] = (int16_t)(function & 1 ? ~value : value), d[i] = acc_l[i];
    }
    break;
  case 0x30: case 0x31: case 0x32: case 0x34: case 0x35: case 0x36: { // VRCP, VRCPL, VRCPH, VRSQ, VRSQL, VRSQH
    int square_root = function >= 0x34, kind = function & 3;
    int16_t input = vr[vt][e & 7];
    for (int i = 0; i < 8; i++) acc_l[i] = t[i];
    if (kind == 2) {
      div_in = (int32_t)((uint32_t)(uint16_t)input << 16);
      vr[vd][de & 7] = (int16_t)(div_out >> 16);
      div_high = 1;
    } else {
      if (kind == 0 || !div_high) div_in = input;
      else div_in |= (uint16_t)input;
      divide(div_in, square_root, kind == 1 && div_high);
      vr[vd][de & 7] = (int16_t)div_out;
      div_high = 0;
    }
    for (int i = 0; i < 8; i++) d[i] = vr[vd][i];
    break;
  }
  case 0x33: // VMOV
    for (int i = 0; i < 8; i++) acc_l[i] = t[i];
    vr[vd][de & 7] = acc_l[e & 7];
    for (int i = 0; i < 8; i++) d[i] = vr[vd][i];
    break;
  case 0x37: // VNOP
    for (int i = 0; i < 8; i++) d[i] = vr[vd][i];
    break;
  default: // reserved, and those cxd4 doesn't have, which write zero
    for (int i = 0; i < 8; i++) d[i] = 0;
  }
}

void vu_cop2(uint32_t word, uint32_t *sr) {
  uint32_t op = word >> 21 & 31, rt = word >> 16 & 31, rd = word >> 11 & 31, e = word >> 7 & 15;
  switch (op) {
  case 0x00: // MFC2: two bytes from byte e, the second round the register
    sr[rt] = (uint32_t)(int32_t)(int16_t)(byte_of(rd, e) << 8 | byte_of(rd, (e + 1) & 15));
    return;
  case 0x02: sr[rt] = (uint32_t)(int32_t)(int16_t)flags_read(rd & 3); return; // CFC2
  case 0x04: // MTC2: two bytes to byte e, the second only inside the register
    set_byte((int)rd, (int)e, (uint8_t)(sr[rt] >> 8));
    if (e < 15) set_byte(rd, e + 1, (uint8_t)sr[rt]);
    return;
  case 0x06: flags_write(rd & 3, (uint16_t)sr[rt]); return; // CTC2
  }
  if (op < 0x10) return;
  // the second operand's lanes, as its element picks them
  int element = (int)(op & 15);
  uint32_t vt = word >> 16 & 31;
  int16_t t[8], s[8], d[8];
  for (int i = 0; i < 8; i++) {
    int lane = element < 2 ? i : element < 4 ? (i & 6) + (element & 1) : element < 8 ? (i & 4) + (element & 3) : element & 7;
    t[i] = vr[vt][lane];
    s[i] = vr[rd][i];
  }
  compute(word, s, t, d);
  for (int i = 0; i < 8; i++) vr[word >> 6 & 31][i] = d[i];
}

// data memory a vector load or store reaches, round its 4 KB
static uint8_t *dmem(uint32_t address) { return &n64_sp_mem[address & 0xFFF]; }

// a vector load or store's parts: its register, element and address, its offset scaled by the size it moves
static void operands(uint32_t word, const uint32_t *sr, int *v, int *e, uint32_t *address, int *kind) {
  int offset = (int)(word & 0x7F);
  if (offset & 0x40) offset -= 0x80;
  *kind = (int)(word >> 11 & 31);
  static const int scale[12] = { 1, 2, 4, 8, 16, 16, 8, 8, 16, 16, 16, 16 };
  *v = (int)(word >> 16 & 31);
  *e = (int)(word >> 7 & 15);
  *address = (sr[word >> 21 & 31] + (uint32_t)(offset * (*kind < 12 ? scale[*kind] : 1))) & 0xFFF;
}

void vu_load(uint32_t word, const uint32_t *sr) {
  int v, e, kind;
  uint32_t address;
  operands(word, sr, &v, &e, &address, &kind);
  switch (kind) {
  case 0: case 1: case 2: case 3: { // LBV, LSV, LLV, LDV: 1, 2, 4 or 8 bytes from byte e, as far as the register goes
    int bytes = 1 << kind;
    for (int i = 0; i < bytes && e + i < 16; i++) set_byte(v, e + i, *dmem(address + (uint32_t)i));
    break;
  }
  case 4: { // LQV: to the end of the 16 bytes the address is in, from an even address as cxd4 takes it
    uint32_t start = address & ~1u;
    for (uint32_t i = 0; (start & 15) + i < 16 && e + (int)i < 16; i++) set_byte(v, e + (int)i, *dmem(start + i));
    break;
  }
  case 5: { // LRV: the bytes before the address in its 16, into the register's last lanes, as cxd4 takes them
    uint32_t start = address & ~1u, count = start & 15, block = start & ~15u;
    for (uint32_t i = 0; i < count; i++) set_byte(v, (int)(16 - count + i), *dmem(block + i));
    break;
  }
  case 6: case 7: // LPV, LUV: a byte a lane, into its high bits or the next ones down
    if (kind == 7 && e) address += e <= 8 ? (uint32_t)(8 - e) : (uint32_t)(24 - e);
    for (int i = 0; i < 8; i++) vr[v][i] = (int16_t)(*dmem(address + (uint32_t)i) << (kind == 6 ? 8 : 7));
    break;
  case 8: // LHV: every other byte, a lane each
    for (int i = 0; i < 8; i++) vr[v][i] = (int16_t)(*dmem(address + (uint32_t)(2 * i)) << 7);
    break;
  case 11: // LTV: a lane of each of eight registers, as cxd4 takes them
    if (v & 7) break;
    for (int i = 0; i < 8; i++) vr[v + i][(i - e / 2) & 7] = (int16_t)(*dmem(address + (uint32_t)(2 * i)) << 8 | *dmem(address + (uint32_t)(2 * i) + 1));
    break;
  }
}

void vu_store(uint32_t word, const uint32_t *sr) {
  int v, e, kind;
  uint32_t address;
  operands(word, sr, &v, &e, &address, &kind);
  switch (kind) {
  case 0: case 1: case 2: case 3: { // SBV, SSV, SLV, SDV: from byte e, round the register
    int bytes = 1 << kind;
    for (int i = 0; i < bytes; i++) *dmem(address + (uint32_t)i) = byte_of(v, (e + i) & 15);
    break;
  }
  case 4: { // SQV: to the end of the 16 bytes the address is in, as cxd4 has it
    if (e) for (uint32_t i = 0; i < 16 - address % 16; i++) *dmem(address + i) = byte_of(v, (int)((e + i) & 15));
    if (address & 1) break;
    for (uint32_t i = 0; (address & 15) + i < 16; i++) *dmem(address + i) = byte_of(v, (int)i);
    break;
  }
  case 5: { // SRV: the register's last lanes, before the address in its 16
    uint32_t start = address & ~1u, count = start & 15, block = start & ~15u;
    for (uint32_t i = 0; i < count; i++) *dmem(block + i) = byte_of(v, (int)(16 - count + i));
    break;
  }
  case 6: // SPV: each lane's high byte, as cxd4 has it, only from element 0
    if (e) break;
    for (int i = 0; i < 8; i++) *dmem(address + (uint32_t)i) = (uint8_t)(vr[v][i] >> 8);
    break;
  case 7: // SUV: each lane shifted by 7, and those after the wrap by 8
    for (int i = e; i < e + 8; i++) *dmem(address + (uint32_t)(i - e)) = (uint8_t)(vr[v][i & 7] >> ((i & 15) < 8 ? 7 : 8));
    break;
  case 8: // SHV
    for (int i = 0; i < 8; i++) *dmem(address + (uint32_t)(2 * i)) = (uint8_t)(vr[v][i] >> 7);
    break;
  case 9: { // SFV: four lanes, the first or last, a byte every four
    if (e != 0 && e != 8) break;
    uint32_t at = address & 0xFF3;
    for (int i = 0; i < 4; i++) *dmem(at + (uint32_t)(4 * i)) = (uint8_t)(vr[v][i + e / 2] >> 7);
    break;
  }
  case 11: // STV: a lane of each of eight registers, as cxd4 has it
    if ((e & 1) || (v & 7) || (address & 15)) break;
    for (int i = 0; i < 8; i++) {
      int16_t lane = vr[v + (e / 2 + i) % 8][i];
      *dmem(address + (uint32_t)(2 * i)) = (uint8_t)(lane >> 8), *dmem(address + (uint32_t)(2 * i) + 1) = (uint8_t)lane;
    }
    break;
  }
}
