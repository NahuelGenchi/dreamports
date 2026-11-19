// The EE's 128-bit integer instructions, the multimedia ones its manual calls MMI, for a twin of the original's EE code
// (kit/ps2/c/README.md): a function for each, named after it, that gives what it writes to rd and keeps HI, LO and SA
// as the console does. A GPR, HI and LO are 128 bits here, an ee_quad. The instructions that use only a GPR's low 64
// bits, MADD, MULT1, DIV1, PLZCW and the like, take and give those 64 bits as a uint64_t, which a signed number
// converts to and from with its bits as they are, and leave the GPR's high 64 bits alone. Arguments come in the order
// the instruction's assembly names its registers, so `psllvw rd, rt, rs` is `rd = ee_psllvw(rt, rs)`.
//
// Each does what Sony's EE Core Instruction Set Manual says and what Play!'s EE does (Source/ee/MA_EE.cpp), which is
// what a twin is proven against, bit for bit: saturation, sign extension, where products and quotients land in HI and
// LO, and division by zero. Where Play! departs from the manual, the function does what Play! does and says so.
// Play!'s release builds skip eight of them as unknown instructions, PMADDW, PMSUBW, PMSUBH, PADSBH, PMADDUW, PDIVUW,
// PMFHL.SLW and PMTHL.LW: these follow the manual, so a twin that uses one can't match Play! there.

#ifndef DREAMPORTS_PS2_MMI_H
#define DREAMPORTS_PS2_MMI_H

#include "ps2.h"

/** A 128-bit register as lanes of 16 bytes, 8 halfwords, 4 words or 2 doublewords, each with or without a sign. Lane 0
 *  is the lowest, the one LQ loads from the lowest address, so the lanes are the console's on a little-endian computer,
 *  which every one the kit builds for is. */
typedef union {
  uint8_t b[16]; int8_t sb[16]; uint16_t h[8]; int16_t sh[8];
  uint32_t w[4]; int32_t sw[4]; uint64_t d[2]; int64_t sd[2];
} ee_quad;
_Static_assert(sizeof(ee_quad) == 16, "an ee_quad is 128 bits");
_Static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "an ee_quad's lanes need a little-endian computer");

/** The EE's HI and LO, 128 bits each (mmi.c). Their low 64 bits are the HI and LO of MULT, DIV, MADD, MFHI and MFLO,
 *  their high 64 bits HI1 and LO1, of MULT1, DIV1, MADD1, MFHI1 and MFLO1, and the parallel instructions use all four
 *  words of each. */
extern ee_quad ee_hi, ee_lo;
/** SA, the shift amount QFSRV funnels by, kept in bits as Play! keeps it: MTSAB makes it a number of bytes times 8 and
 *  MTSAH a number of halfwords times 16. */
extern uint32_t ee_sa;

// what the functions share, which a twin doesn't need: a word as the 64 bits it becomes sign-extended, a number held
// between two others, and a word's leading bits that are the same as its sign, less one, as PLZCW counts them
static inline uint64_t mmi_sext32(uint32_t value) { return (uint64_t)(int64_t)(int32_t)value; }
static inline int64_t mmi_clamp(int64_t value, int64_t low, int64_t high) {
  return value < low ? low : value > high ? high : value;
}
static inline uint32_t mmi_lzc(uint32_t value) {
  uint32_t same = (value & 0x80000000u) ? ~value : value;
  return same ? (uint32_t)__builtin_clz(same) - 1 : 31;
}

// A word multiplied into HI and LO's 64-bit half `lane`, LO getting the product's low word and HI its high one, each
// sign-extended, as MULT does: it gives the whole product. MADD adds the product to, or takes it from, the 64-bit
// number HI and LO's words there make, and gives the sum. A division puts the quotient in LO and the remainder in HI,
// sign-extended: by zero LO is 1 for a negative dividend and -1 otherwise, or always -1 unsigned, and HI the dividend,
// and 0x80000000 by -1 is 0x80000000 with nothing left over, as Play! and the console do.
static inline uint64_t mmi_product(uint32_t a, uint32_t b, int is_signed) {
  return is_signed ? (uint64_t)((int64_t)(int32_t)a * (int32_t)b) : (uint64_t)a * b;
}
static inline void mmi_set(int lane, uint64_t value) {
  ee_lo.d[lane] = mmi_sext32((uint32_t)value);
  ee_hi.d[lane] = mmi_sext32((uint32_t)(value >> 32));
}
static inline uint64_t mmi_mult(int lane, uint32_t a, uint32_t b, int is_signed) {
  uint64_t product = mmi_product(a, b, is_signed);
  mmi_set(lane, product);
  return product;
}
static inline uint64_t mmi_madd(int lane, uint32_t a, uint32_t b, int is_signed, int subtract) {
  uint64_t held = ((uint64_t)ee_hi.w[lane * 2] << 32) | ee_lo.w[lane * 2], product = mmi_product(a, b, is_signed);
  uint64_t sum = subtract ? held - product : held + product;
  mmi_set(lane, sum);
  return sum;
}
static inline void mmi_div(int lane, uint32_t a, uint32_t b, int is_signed) {
  uint32_t quotient, remainder;
  if (!b) {
    quotient = is_signed && (int32_t)a < 0 ? 1 : 0xFFFFFFFFu;
    remainder = a;
  } else if (is_signed && a == 0x80000000u && b == 0xFFFFFFFFu) {
    quotient = 0x80000000u;
    remainder = 0;
  } else if (is_signed) {
    quotient = (uint32_t)((int32_t)a / (int32_t)b);
    remainder = (uint32_t)((int32_t)a % (int32_t)b);
  } else {
    quotient = a / b;
    remainder = a % b;
  }
  ee_lo.d[lane] = mmi_sext32(quotient);
  ee_hi.d[lane] = mmi_sext32(remainder);
}
// The halfword multiplies put halfword j's product in a word of LO or HI: LO's words 0 and 1, HI's 0 and 1, LO's 2 and
// 3, then HI's 2 and 3. PMFHL.LH and PMFHL.SH read those eight words back in that order.
static inline uint32_t *mmi_slot(int j) { return ((j >> 1) & 1 ? &ee_hi : &ee_lo)->w + ((j & 1) | (j >> 2) << 1); }

// MMI0: sums and differences that wrap, comparisons that give all ones or none, and the largest of two, with a sign

static inline ee_quad ee_paddw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] += rt.w[i];
  return rs;
}
static inline ee_quad ee_psubw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] -= rt.w[i];
  return rs;
}
static inline ee_quad ee_pcgtw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] = rs.sw[i] > rt.sw[i] ? 0xFFFFFFFFu : 0;
  return rs;
}
static inline ee_quad ee_pmaxw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) if (rt.sw[i] > rs.sw[i]) rs.w[i] = rt.w[i];
  return rs;
}
static inline ee_quad ee_paddh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = (uint16_t)(rs.h[i] + rt.h[i]);
  return rs;
}
static inline ee_quad ee_psubh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = (uint16_t)(rs.h[i] - rt.h[i]);
  return rs;
}
static inline ee_quad ee_pcgth(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = rs.sh[i] > rt.sh[i] ? 0xFFFF : 0;
  return rs;
}
static inline ee_quad ee_pmaxh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) if (rt.sh[i] > rs.sh[i]) rs.h[i] = rt.h[i];
  return rs;
}
static inline ee_quad ee_paddb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = (uint8_t)(rs.b[i] + rt.b[i]);
  return rs;
}
static inline ee_quad ee_psubb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = (uint8_t)(rs.b[i] - rt.b[i]);
  return rs;
}
static inline ee_quad ee_pcgtb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = rs.sb[i] > rt.sb[i] ? 0xFF : 0;
  return rs;
}

// sums and differences held to the lane's range, with a sign
static inline ee_quad ee_paddsw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.sw[i] = (int32_t)mmi_clamp((int64_t)rs.sw[i] + rt.sw[i], INT32_MIN, INT32_MAX);
  return rs;
}
static inline ee_quad ee_psubsw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.sw[i] = (int32_t)mmi_clamp((int64_t)rs.sw[i] - rt.sw[i], INT32_MIN, INT32_MAX);
  return rs;
}
static inline ee_quad ee_paddsh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.sh[i] = (int16_t)mmi_clamp(rs.sh[i] + rt.sh[i], INT16_MIN, INT16_MAX);
  return rs;
}
static inline ee_quad ee_psubsh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.sh[i] = (int16_t)mmi_clamp(rs.sh[i] - rt.sh[i], INT16_MIN, INT16_MAX);
  return rs;
}
static inline ee_quad ee_paddsb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.sb[i] = (int8_t)mmi_clamp(rs.sb[i] + rt.sb[i], INT8_MIN, INT8_MAX);
  return rs;
}
static inline ee_quad ee_psubsb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.sb[i] = (int8_t)mmi_clamp(rs.sb[i] - rt.sb[i], INT8_MIN, INT8_MAX);
  return rs;
}

// PEXTL interleaves the low halves of rt and rs, rt's lane first; PPAC packs the even lanes of rt into the low half and
// those of rs into the high one, dropping the odd lanes
static inline ee_quad ee_pextlw(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 2; i++) rd.w[i * 2] = rt.w[i], rd.w[i * 2 + 1] = rs.w[i];
  return rd;
}
static inline ee_quad ee_ppacw(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 2; i++) rd.w[i] = rt.w[i * 2], rd.w[i + 2] = rs.w[i * 2];
  return rd;
}
static inline ee_quad ee_pextlh(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 4; i++) rd.h[i * 2] = rt.h[i], rd.h[i * 2 + 1] = rs.h[i];
  return rd;
}
static inline ee_quad ee_ppach(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 4; i++) rd.h[i] = rt.h[i * 2], rd.h[i + 4] = rs.h[i * 2];
  return rd;
}
static inline ee_quad ee_pextlb(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 8; i++) rd.b[i * 2] = rt.b[i], rd.b[i * 2 + 1] = rs.b[i];
  return rd;
}
static inline ee_quad ee_ppacb(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 8; i++) rd.b[i] = rt.b[i * 2], rd.b[i + 8] = rs.b[i * 2];
  return rd;
}
/** PEXT5: each word's low halfword, a colour of 5 bits each for red, green and blue and one for alpha, as a word of 8
 *  bits each, the 5 at the top of each byte. */
static inline ee_quad ee_pext5(ee_quad rt) {
  for (int i = 0; i < 4; i++) {
    uint32_t x = rt.w[i];
    rt.w[i] = (x & 0x1F) << 3 | (x & 0x3E0) << 6 | (x & 0x7C00) << 9 | (x & 0x8000) << 16;
  }
  return rt;
}
/** PPAC5: each word of 8 bits a colour back to 5 bits each and one for alpha, in the word's low halfword, its high
 *  halfword zero. */
static inline ee_quad ee_ppac5(ee_quad rt) {
  for (int i = 0; i < 4; i++) {
    uint32_t x = rt.w[i];
    rt.w[i] = (x & 0x80000000u) >> 16 | (x & 0xF80000) >> 9 | (x & 0xF800) >> 6 | (x & 0xF8) >> 3;
  }
  return rt;
}

// MMI1: the size of a number, the 0x80000000 or 0x8000 that has none as the largest there is, and equality and the
// smaller of two
static inline ee_quad ee_pabsw(ee_quad rt) {
  for (int i = 0; i < 4; i++) rt.w[i] = rt.w[i] == 0x80000000u ? 0x7FFFFFFFu : rt.sw[i] < 0 ? 0 - rt.w[i] : rt.w[i];
  return rt;
}
static inline ee_quad ee_pceqw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] = rs.w[i] == rt.w[i] ? 0xFFFFFFFFu : 0;
  return rs;
}
static inline ee_quad ee_pminw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) if (rt.sw[i] < rs.sw[i]) rs.w[i] = rt.w[i];
  return rs;
}
/** PADSBH: rt's low four halfwords taken from rs's and its high four added to them, wrapping. Play! skips it. */
static inline ee_quad ee_padsbh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = (uint16_t)(i < 4 ? rs.h[i] - rt.h[i] : rs.h[i] + rt.h[i]);
  return rs;
}
static inline ee_quad ee_pabsh(ee_quad rt) {
  for (int i = 0; i < 8; i++) rt.h[i] = rt.h[i] == 0x8000 ? 0x7FFF : (uint16_t)(rt.sh[i] < 0 ? -rt.sh[i] : rt.sh[i]);
  return rt;
}
static inline ee_quad ee_pceqh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = rs.h[i] == rt.h[i] ? 0xFFFF : 0;
  return rs;
}
static inline ee_quad ee_pminh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) if (rt.sh[i] < rs.sh[i]) rs.h[i] = rt.h[i];
  return rs;
}
static inline ee_quad ee_pceqb(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = rs.b[i] == rt.b[i] ? 0xFF : 0;
  return rs;
}

// sums and differences held to the lane's range with no sign, so a difference below zero is zero; PEXTU interleaves
// the high halves of rt and rs, rt's lane first
static inline ee_quad ee_padduw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] = (uint32_t)mmi_clamp((int64_t)rs.w[i] + rt.w[i], 0, UINT32_MAX);
  return rs;
}
static inline ee_quad ee_psubuw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rs.w[i] = (uint32_t)mmi_clamp((int64_t)rs.w[i] - rt.w[i], 0, UINT32_MAX);
  return rs;
}
static inline ee_quad ee_pextuw(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 2; i++) rd.w[i * 2] = rt.w[i + 2], rd.w[i * 2 + 1] = rs.w[i + 2];
  return rd;
}
static inline ee_quad ee_padduh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = (uint16_t)mmi_clamp(rs.h[i] + rt.h[i], 0, UINT16_MAX);
  return rs;
}
static inline ee_quad ee_psubuh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 8; i++) rs.h[i] = (uint16_t)mmi_clamp(rs.h[i] - rt.h[i], 0, UINT16_MAX);
  return rs;
}
static inline ee_quad ee_pextuh(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 4; i++) rd.h[i * 2] = rt.h[i + 4], rd.h[i * 2 + 1] = rs.h[i + 4];
  return rd;
}
static inline ee_quad ee_paddub(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = (uint8_t)mmi_clamp(rs.b[i] + rt.b[i], 0, UINT8_MAX);
  return rs;
}
static inline ee_quad ee_psubub(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 16; i++) rs.b[i] = (uint8_t)mmi_clamp(rs.b[i] - rt.b[i], 0, UINT8_MAX);
  return rs;
}
static inline ee_quad ee_pextub(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 8; i++) rd.b[i * 2] = rt.b[i + 8], rd.b[i * 2 + 1] = rs.b[i + 8];
  return rd;
}
/** QFSRV: the 256 bits rs and rt make, rs the high half, shifted right by SA and cut to the low 128. Play! shifts by
 *  whole bytes, SA's bits 6 to 3, which is all MTSAB, MTSAH and MTSA can set. */
static inline ee_quad ee_qfsrv(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  int skip = (int)((ee_sa & 0x7F) >> 3);
  for (int i = 0; i < 16; i++) rd.b[i] = i + skip < 16 ? rt.b[i + skip] : rs.b[i + skip - 16];
  return rd;
}

// MMI2 and MMI3's multiplies and divisions of words, in the even words of rs and rt: each lane's product, sum or
// quotient goes to HI and LO's 64-bit half of the same lane as MULT, MADD and DIV put theirs (mmi_mult), and rd gets
// the whole 64-bit product or sum

static inline ee_quad ee_pmultw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = mmi_mult(i, rs.w[i * 2], rt.w[i * 2], 1);
  return rs;
}
static inline ee_quad ee_pmultuw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = mmi_mult(i, rs.w[i * 2], rt.w[i * 2], 0);
  return rs;
}
/** PMADDW, PMSUBW and PMADDUW: the products added to, or taken from, the 64-bit numbers in HI and LO's words 0 and 2.
 *  Play! skips all three; these follow the manual. */
static inline ee_quad ee_pmaddw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = mmi_madd(i, rs.w[i * 2], rt.w[i * 2], 1, 0);
  return rs;
}
static inline ee_quad ee_pmsubw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = mmi_madd(i, rs.w[i * 2], rt.w[i * 2], 1, 1);
  return rs;
}
static inline ee_quad ee_pmadduw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = mmi_madd(i, rs.w[i * 2], rt.w[i * 2], 0, 0);
  return rs;
}
/** PDIVW and PDIVUW write no GPR, only HI and LO. Play! skips PDIVUW; it follows the manual. */
static inline void ee_pdivw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) mmi_div(i, rs.w[i * 2], rt.w[i * 2], 1);
}
static inline void ee_pdivuw(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) mmi_div(i, rs.w[i * 2], rt.w[i * 2], 0);
}
/** PDIVBW: each word of rs divided by rt's lowest halfword, with signs, each quotient to LO's word of the same lane and
 *  each remainder to HI's, as a division of words does it (mmi_div). It writes no GPR. */
static inline void ee_pdivbw(ee_quad rs, ee_quad rt) {
  int32_t by = rt.sh[0];
  for (int i = 0; i < 4; i++) {
    int32_t a = rs.sw[i];
    if (!by) {
      ee_lo.w[i] = a < 0 ? 1 : 0xFFFFFFFFu;
      ee_hi.w[i] = (uint32_t)a;
    } else if (a == INT32_MIN && by == -1) {
      ee_lo.w[i] = 0x80000000u;
      ee_hi.w[i] = 0;
    } else {
      ee_lo.w[i] = (uint32_t)(a / by);
      ee_hi.w[i] = (uint32_t)(a % by);
    }
  }
}

// The halfword multiplies, with signs: each product goes to the word of LO or HI that mmi_slot names, alone, added or
// taken away, and rd gets LO's and HI's words 0 and 2. Every sum wraps at 32 bits.
static inline ee_quad mmi_halfwords(ee_quad rs, ee_quad rt, int how) {
  for (int j = 0; j < 8; j++) {
    uint32_t product = (uint32_t)(rs.sh[j] * rt.sh[j]), *slot = mmi_slot(j);
    *slot = how > 0 ? *slot + product : how < 0 ? *slot - product : product;
  }
  ee_quad rd = {.w = {ee_lo.w[0], ee_hi.w[0], ee_lo.w[2], ee_hi.w[2]}};
  return rd;
}
static inline ee_quad ee_pmulth(ee_quad rs, ee_quad rt) { return mmi_halfwords(rs, rt, 0); }
static inline ee_quad ee_pmaddh(ee_quad rs, ee_quad rt) { return mmi_halfwords(rs, rt, 1); }
/** PMSUBH, which Play! skips, follows the manual. */
static inline ee_quad ee_pmsubh(ee_quad rs, ee_quad rt) { return mmi_halfwords(rs, rt, -1); }
// PHMADH and PHMSBH: each word's two halfword products, the high plus or minus the low, wrapping, to rd's word of the
// same lane and to LO's word 0, HI's word 0, LO's word 2 and HI's word 2. Play! makes LO's and HI's words 1 and 3 zero.
static inline ee_quad mmi_pairs(ee_quad rs, ee_quad rt, int subtract) {
  for (int i = 0; i < 4; i++) {
    uint32_t high = (uint32_t)(rs.sh[i * 2 + 1] * rt.sh[i * 2 + 1]), low = (uint32_t)(rs.sh[i * 2] * rt.sh[i * 2]);
    rs.w[i] = subtract ? high - low : high + low;
  }
  ee_lo.w[0] = rs.w[0], ee_hi.w[0] = rs.w[1], ee_lo.w[2] = rs.w[2], ee_hi.w[2] = rs.w[3];
  ee_lo.w[1] = ee_hi.w[1] = ee_lo.w[3] = ee_hi.w[3] = 0;
  return rs;
}
static inline ee_quad ee_phmadh(ee_quad rs, ee_quad rt) { return mmi_pairs(rs, rt, 0); }
static inline ee_quad ee_phmsbh(ee_quad rs, ee_quad rt) { return mmi_pairs(rs, rt, 1); }

// shifts of each word in rs's and rt's even words by a number in the other's, rt's word shifted by rs's low 5 bits,
// and the 32 bits that gives sign-extended to the lane's 64
static inline ee_quad ee_psllvw(ee_quad rt, ee_quad rs) {
  for (int i = 0; i < 2; i++) rt.d[i] = mmi_sext32(rt.w[i * 2] << (rs.w[i * 2] & 31));
  return rt;
}
static inline ee_quad ee_psrlvw(ee_quad rt, ee_quad rs) {
  for (int i = 0; i < 2; i++) rt.d[i] = mmi_sext32(rt.w[i * 2] >> (rs.w[i * 2] & 31));
  return rt;
}
static inline ee_quad ee_psravw(ee_quad rt, ee_quad rs) {
  for (int i = 0; i < 2; i++) rt.d[i] = mmi_sext32((uint32_t)(rt.sw[i * 2] >> (rs.w[i * 2] & 31)));
  return rt;
}

// all of HI or LO to a GPR and back
static inline ee_quad ee_pmfhi(void) { return ee_hi; }
static inline ee_quad ee_pmflo(void) { return ee_lo; }
static inline void ee_pmthi(ee_quad rs) { ee_hi = rs; }
static inline void ee_pmtlo(ee_quad rs) { ee_lo = rs; }

// bitwise sums of all 128 bits
static inline ee_quad ee_pand(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] &= rt.d[i];
  return rs;
}
static inline ee_quad ee_por(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] |= rt.d[i];
  return rs;
}
static inline ee_quad ee_pxor(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] ^= rt.d[i];
  return rs;
}
static inline ee_quad ee_pnor(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 2; i++) rs.d[i] = ~(rs.d[i] | rt.d[i]);
  return rs;
}

// lanes moved about: PINTH interleaves rt's low four halfwords with rs's high four, PINTEH rt's even halfwords with
// rs's, rt's first; PCPYLD makes rt's low doubleword rd's low one and rs's its high one, PCPYUD rs's high doubleword
// rd's low one and rt's its high one. The rest work in each 64-bit half of rt on its own: PEXEH swaps halfwords 0 and
// 2, PEXCH 1 and 2, PREVH turns the four around and PCPYH copies halfword 0 to all four, while PEXEW swaps rt's words 0
// and 2, PEXCW 1 and 2, and PROT3W turns words 0 to 2 round by one, word 1 to word 0.
static inline ee_quad ee_pinth(ee_quad rs, ee_quad rt) {
  ee_quad rd;
  for (int i = 0; i < 4; i++) rd.h[i * 2] = rt.h[i], rd.h[i * 2 + 1] = rs.h[i + 4];
  return rd;
}
static inline ee_quad ee_pinteh(ee_quad rs, ee_quad rt) {
  for (int i = 0; i < 4; i++) rt.h[i * 2 + 1] = rs.h[i * 2];
  return rt;
}
static inline ee_quad ee_pcpyld(ee_quad rs, ee_quad rt) {
  rt.d[1] = rs.d[0];
  return rt;
}
static inline ee_quad ee_pcpyud(ee_quad rs, ee_quad rt) {
  rt.d[0] = rs.d[1];
  return rt;
}
static inline ee_quad mmi_halfword_order(ee_quad rt, int h0, int h1, int h2, int h3) {
  ee_quad rd;
  for (int i = 0; i < 8; i += 4) {
    rd.h[i] = rt.h[i + h0], rd.h[i + 1] = rt.h[i + h1], rd.h[i + 2] = rt.h[i + h2], rd.h[i + 3] = rt.h[i + h3];
  }
  return rd;
}
static inline ee_quad ee_pexeh(ee_quad rt) { return mmi_halfword_order(rt, 2, 1, 0, 3); }
static inline ee_quad ee_pexch(ee_quad rt) { return mmi_halfword_order(rt, 0, 2, 1, 3); }
static inline ee_quad ee_prevh(ee_quad rt) { return mmi_halfword_order(rt, 3, 2, 1, 0); }
static inline ee_quad ee_pcpyh(ee_quad rt) { return mmi_halfword_order(rt, 0, 0, 0, 0); }
static inline ee_quad ee_pexew(ee_quad rt) { return (ee_quad){.w = {rt.w[2], rt.w[1], rt.w[0], rt.w[3]}}; }
static inline ee_quad ee_pexcw(ee_quad rt) { return (ee_quad){.w = {rt.w[0], rt.w[2], rt.w[1], rt.w[3]}}; }
static inline ee_quad ee_prot3w(ee_quad rt) { return (ee_quad){.w = {rt.w[1], rt.w[2], rt.w[0], rt.w[3]}}; }

// The MMI class's own: MADD and MADDU, and MADD1, MADDU1, MULT1, MULTU1, DIV1 and DIVU1 on HI1 and LO1, with words
// from rs's and rt's low 64 bits, and rd, where the instruction has one, getting LO or LO1's 64 bits

/** MADD: rs's and rt's low words multiplied, with their signs, and added to the 64-bit number HI's and LO's low words
 *  make; LO and HI get its halves sign-extended, and rd gets LO. It's ee_mmi_madd as ee_madd is the FPU's MADD.S
 *  (ps2.h). */
static inline uint64_t ee_mmi_madd(uint64_t rs, uint64_t rt) {
  mmi_madd(0, (uint32_t)rs, (uint32_t)rt, 1, 0);
  return ee_lo.d[0];
}
static inline uint64_t ee_maddu(uint64_t rs, uint64_t rt) {
  mmi_madd(0, (uint32_t)rs, (uint32_t)rt, 0, 0);
  return ee_lo.d[0];
}
static inline uint64_t ee_madd1(uint64_t rs, uint64_t rt) {
  mmi_madd(1, (uint32_t)rs, (uint32_t)rt, 1, 0);
  return ee_lo.d[1];
}
static inline uint64_t ee_maddu1(uint64_t rs, uint64_t rt) {
  mmi_madd(1, (uint32_t)rs, (uint32_t)rt, 0, 0);
  return ee_lo.d[1];
}
static inline uint64_t ee_mult1(uint64_t rs, uint64_t rt) {
  mmi_mult(1, (uint32_t)rs, (uint32_t)rt, 1);
  return ee_lo.d[1];
}
static inline uint64_t ee_multu1(uint64_t rs, uint64_t rt) {
  mmi_mult(1, (uint32_t)rs, (uint32_t)rt, 0);
  return ee_lo.d[1];
}
static inline void ee_div1(uint64_t rs, uint64_t rt) { mmi_div(1, (uint32_t)rs, (uint32_t)rt, 1); }
static inline void ee_divu1(uint64_t rs, uint64_t rt) { mmi_div(1, (uint32_t)rs, (uint32_t)rt, 0); }
static inline uint64_t ee_mfhi1(void) { return ee_hi.d[1]; }
static inline uint64_t ee_mflo1(void) { return ee_lo.d[1]; }
static inline void ee_mthi1(uint64_t rs) { ee_hi.d[1] = rs; }
static inline void ee_mtlo1(uint64_t rs) { ee_lo.d[1] = rs; }
/** PLZCW: for each of rs's low two words, how many bits after its top one are the same as it, 0 to 31. */
static inline uint64_t ee_plzcw(uint64_t rs) {
  return (uint64_t)mmi_lzc((uint32_t)(rs >> 32)) << 32 | mmi_lzc((uint32_t)rs);
}

// PMFHL and PMTHL: LO's and HI's words to rd and back, LO's word first in each pair. PMFHL.LW takes words 0 and 2,
// PMFHL.UW words 1 and 3.
static inline ee_quad ee_pmfhl_lw(void) { return (ee_quad){.w = {ee_lo.w[0], ee_hi.w[0], ee_lo.w[2], ee_hi.w[2]}}; }
static inline ee_quad ee_pmfhl_uw(void) { return (ee_quad){.w = {ee_lo.w[1], ee_hi.w[1], ee_lo.w[3], ee_hi.w[3]}}; }
/** PMFHL.SLW: the 64-bit numbers HI's and LO's words 0, then 2, make, each held to a word's range with its sign and
 *  sign-extended to rd's doubleword. Play! skips it; this follows the manual. */
static inline ee_quad ee_pmfhl_slw(void) {
  ee_quad rd;
  for (int i = 0; i < 2; i++) {
    int64_t value = (int64_t)(((uint64_t)ee_hi.w[i * 2] << 32) | ee_lo.w[i * 2]);
    rd.sd[i] = mmi_clamp(value, INT32_MIN, INT32_MAX);
  }
  return rd;
}
/** PMFHL.LH: the low halfword of each of the eight words the halfword multiplies fill (mmi_slot), in that order. */
static inline ee_quad ee_pmfhl_lh(void) {
  ee_quad rd;
  for (int j = 0; j < 8; j++) rd.h[j] = (uint16_t)*mmi_slot(j);
  return rd;
}
/** PMFHL.SH: those eight words each held to a halfword's range with its sign. As Play! does it, a pair's low word that
 *  is negative and in range keeps all its bits, and they fill the pair's high halfword with ones: the manual, and so
 *  the console, keeps the high halfword's own value there. */
static inline uint32_t mmi_held(uint32_t word) {
  // as Play! holds it: 0x7FFF above the range, 0x8000 below it, and a word in it as it is, sign bits and all
  int32_t value = (int32_t)word;
  return value > INT16_MAX ? 0x7FFF : value < INT16_MIN ? 0x8000 : word;
}
static inline ee_quad ee_pmfhl_sh(void) {
  ee_quad rd;
  for (int i = 0; i < 4; i++) rd.w[i] = mmi_held(*mmi_slot(i * 2)) | mmi_held(*mmi_slot(i * 2 + 1)) << 16;
  return rd;
}
/** PMTHL.LW: rs's words to LO's word 0, HI's word 0, LO's word 2 and HI's word 2, the others as they were. Play! skips
 *  it; this follows the manual. */
static inline void ee_pmthl_lw(ee_quad rs) {
  ee_lo.w[0] = rs.w[0], ee_hi.w[0] = rs.w[1], ee_lo.w[2] = rs.w[2], ee_hi.w[2] = rs.w[3];
}

// shifts of each halfword or word by the instruction's own amount, its low 4 bits for halfwords and 5 for words
static inline ee_quad ee_psllh(ee_quad rt, int sa) {
  for (int i = 0; i < 8; i++) rt.h[i] = (uint16_t)(rt.h[i] << (sa & 15));
  return rt;
}
static inline ee_quad ee_psrlh(ee_quad rt, int sa) {
  for (int i = 0; i < 8; i++) rt.h[i] = (uint16_t)(rt.h[i] >> (sa & 15));
  return rt;
}
static inline ee_quad ee_psrah(ee_quad rt, int sa) {
  for (int i = 0; i < 8; i++) rt.h[i] = (uint16_t)(rt.sh[i] >> (sa & 15));
  return rt;
}
static inline ee_quad ee_psllw(ee_quad rt, int sa) {
  for (int i = 0; i < 4; i++) rt.w[i] <<= sa & 31;
  return rt;
}
static inline ee_quad ee_psrlw(ee_quad rt, int sa) {
  for (int i = 0; i < 4; i++) rt.w[i] >>= sa & 31;
  return rt;
}
static inline ee_quad ee_psraw(ee_quad rt, int sa) {
  for (int i = 0; i < 4; i++) rt.w[i] = (uint32_t)(rt.sw[i] >> (sa & 31));
  return rt;
}

// SA, which QFSRV shifts by: MTSAB sets it to the bytes rs's low 4 bits and the immediate's give exclusive-ored,
// MTSAH to the halfwords their low 3 bits give, and MTSA and MFSA move it to and from a GPR as a number of bytes, as
// Play! does. Play!'s MFSA writes only rd's low 32 bits and leaves the 32 above them as they were, where the console
// writes all 64, and its MTSA keeps only rs's low 4 bits.
static inline void ee_mtsab(uint64_t rs, int imm) { ee_sa = (((uint32_t)rs & 15) ^ ((uint32_t)imm & 15)) << 3; }
static inline void ee_mtsah(uint64_t rs, int imm) { ee_sa = (((uint32_t)rs & 7) ^ ((uint32_t)imm & 7)) << 4; }
static inline void ee_mtsa(uint64_t rs) { ee_sa = ((uint32_t)rs & 15) << 3; }
static inline uint32_t ee_mfsa(void) { return ee_sa >> 3; }

#endif
