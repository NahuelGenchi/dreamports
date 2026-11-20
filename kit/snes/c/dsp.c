// The Super Nintendo's sound chip, its DSP: eight voices, each playing a sample from the sound processor's memory in
// the console's own compressed form (BRR), at a pitch, through an envelope and a volume each side, with noise, one
// voice's output bending the next one's pitch, and an echo through a filter of eight steps, mixed into one sample a
// side every 32 of the sound processor's cycles. It runs as the console's does, a cycle at a time, each of the 32 doing
// its own part of the work for one voice or another, so what a voice plays depends on when its registers were written
// to the cycle.
//
// This is Shay Green's DSP of snes_spc 0.9.0 (http://www.slack.net/~ant/, GNU Lesser General Public License 2.1 or
// later, Copyright (C) 2007 Shay Green), written again in C, as Snes9x runs it, the reference emulator the proof tools
// run the original on (github.com/libretro/snes9x at fae2fea08f74180759ef540ee94259213f503480, apu/bapu/dsp/): with
// its gaussian interpolation, which the console's chip has and Snes9x uses unless told otherwise, the echo in the
// sound processor's memory, and Snes9x's registers as the sound processor reads them back, which start as the chip's
// own values while those it plays from start at zero. Snes9x's other filters, its volume for each voice and its echo
// kept apart aren't here: the console has none of them. The names are Shay Green's, so the two read side by side.

#include "snes-kit.h"

enum { VOICES = 8, REGISTERS = 128, BRR_BUF = 12, BRR_BLOCK = 9, ECHO_HIST = 8 };
enum { ENV_RELEASE, ENV_ATTACK, ENV_DECAY, ENV_SUSTAIN };
// the registers the voices share, and each voice's own, at its number times 16 on
enum {
  R_MVOLL = 0x0C, R_MVOLR = 0x1C, R_EVOLL = 0x2C, R_EVOLR = 0x3C, R_KON = 0x4C, R_KOFF = 0x5C, R_FLG = 0x6C, R_ENDX = 0x7C,
  R_EFB = 0x0D, R_PMON = 0x2D, R_NON = 0x3D, R_EON = 0x4D, R_DIR = 0x5D, R_ESA = 0x6D, R_EDL = 0x7D, R_FIR = 0x0F,
};
enum { V_VOLL, V_VOLR, V_PITCHL, V_PITCHH, V_SRCN, V_ADSR0, V_ADSR1, V_GAIN, V_ENVX, V_OUTX };

// the registers' values as the chip powers on
static const uint8_t INITIAL[REGISTERS] = {
  0x45,0x8B,0x5A,0x9A,0xE4,0x82,0x1B,0x78,0x00,0x00,0xAA,0x96,0x89,0x0E,0xE0,0x80,
  0x2A,0x49,0x3D,0xBA,0x14,0xA0,0xAC,0xC5,0x00,0x00,0x51,0xBB,0x9C,0x4E,0x7B,0xFF,
  0xF4,0xFD,0x57,0x32,0x37,0xD9,0x42,0x22,0x00,0x00,0x5B,0x3C,0x9F,0x1B,0x87,0x9A,
  0x6F,0x27,0xAF,0x7B,0xE5,0x68,0x0A,0xD9,0x00,0x00,0x9A,0xC5,0x9C,0x4E,0x7B,0xFF,
  0xEA,0x21,0x78,0x4F,0xDD,0xED,0x24,0x14,0x00,0x00,0x77,0xB1,0xD1,0x36,0xC1,0x67,
  0x52,0x57,0x46,0x3D,0x59,0xF4,0x87,0xA4,0x00,0x00,0x7E,0x44,0x00,0x4E,0x7B,0xFF,
  0x75,0xF5,0x06,0x97,0x10,0xC3,0x24,0xBB,0x00,0x00,0x7B,0x7A,0xE0,0x60,0x12,0x0F,
  0xF7,0x74,0x1C,0xE5,0x39,0x3D,0x73,0xC1,0x00,0x00,0x7A,0xB3,0xFF,0x4E,0x7B,0xFF,
};

// the chip's gaussian curve, which each sample a voice plays is made from four of its decoded ones by
static const short GAUSS[512] = {
     0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
     1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   2,   2,   2,   2,   2,
     2,   2,   3,   3,   3,   3,   3,   4,   4,   4,   4,   4,   5,   5,   5,   5,
     6,   6,   6,   6,   7,   7,   7,   8,   8,   8,   9,   9,   9,  10,  10,  10,
    11,  11,  11,  12,  12,  13,  13,  14,  14,  15,  15,  15,  16,  16,  17,  17,
    18,  19,  19,  20,  20,  21,  21,  22,  23,  23,  24,  24,  25,  26,  27,  27,
    28,  29,  29,  30,  31,  32,  32,  33,  34,  35,  36,  36,  37,  38,  39,  40,
    41,  42,  43,  44,  45,  46,  47,  48,  49,  50,  51,  52,  53,  54,  55,  56,
    58,  59,  60,  61,  62,  64,  65,  66,  67,  69,  70,  71,  73,  74,  76,  77,
    78,  80,  81,  83,  84,  86,  87,  89,  90,  92,  94,  95,  97,  99, 100, 102,
   104, 106, 107, 109, 111, 113, 115, 117, 118, 120, 122, 124, 126, 128, 130, 132,
   134, 137, 139, 141, 143, 145, 147, 150, 152, 154, 156, 159, 161, 163, 166, 168,
   171, 173, 175, 178, 180, 183, 186, 188, 191, 193, 196, 199, 201, 204, 207, 210,
   212, 215, 218, 221, 224, 227, 230, 233, 236, 239, 242, 245, 248, 251, 254, 257,
   260, 263, 267, 270, 273, 276, 280, 283, 286, 290, 293, 297, 300, 304, 307, 311,
   314, 318, 321, 325, 328, 332, 336, 339, 343, 347, 351, 354, 358, 362, 366, 370,
   374, 378, 381, 385, 389, 393, 397, 401, 405, 410, 414, 418, 422, 426, 430, 434,
   439, 443, 447, 451, 456, 460, 464, 469, 473, 477, 482, 486, 491, 495, 499, 504,
   508, 513, 517, 522, 527, 531, 536, 540, 545, 550, 554, 559, 563, 568, 573, 577,
   582, 587, 592, 596, 601, 606, 611, 615, 620, 625, 630, 635, 640, 644, 649, 654,
   659, 664, 669, 674, 678, 683, 688, 693, 698, 703, 708, 713, 718, 723, 728, 732,
   737, 742, 747, 752, 757, 762, 767, 772, 777, 782, 787, 792, 797, 802, 806, 811,
   816, 821, 826, 831, 836, 841, 846, 851, 855, 860, 865, 870, 875, 880, 884, 889,
   894, 899, 904, 908, 913, 918, 923, 927, 932, 937, 941, 946, 951, 955, 960, 965,
   969, 974, 978, 983, 988, 992, 997,1001,1005,1010,1014,1019,1023,1027,1032,1036,
  1040,1045,1049,1053,1057,1061,1066,1070,1074,1078,1082,1086,1090,1094,1098,1102,
  1106,1109,1113,1117,1121,1125,1128,1132,1136,1139,1143,1146,1150,1153,1157,1160,
  1164,1167,1170,1174,1177,1180,1183,1186,1190,1193,1196,1199,1202,1205,1207,1210,
  1213,1216,1219,1221,1224,1227,1229,1232,1234,1237,1239,1241,1244,1246,1248,1251,
  1253,1255,1257,1259,1261,1263,1265,1267,1269,1270,1272,1274,1275,1277,1279,1280,
  1282,1283,1284,1286,1287,1288,1290,1291,1292,1293,1294,1295,1296,1297,1297,1298,
  1299,1300,1300,1301,1302,1302,1303,1303,1303,1304,1304,1304,1304,1304,1305,1305,
};

// a sum kept to 16 bits, as the chip keeps it
#define CLAMP16(io) do { if ((int16_t)(io) != (io)) (io) = ((io) >> 31) ^ 0x7FFF; } while (0)

struct voice {
  int buf[BRR_BUF * 2];   // decoded samples, twice over so the four read never wrap
  int buf_pos;            // where the next four are decoded
  int interp_pos;         // where it is in the sample, 0x1000 a whole sample
  int brr_addr;           // the BRR block it's in
  int brr_offset;         // where in the block it decodes next
  uint8_t *regs;          // its registers
  int vbit;               // its bit in the registers with one for each voice
  int kon_delay;          // the samples left of its start
  int env_mode;
  int env;                // its envelope
  int hidden_env;         // the envelope as GAIN's mode 7 reads it
  uint8_t t_envx_out;
};

static struct {
  // the registers the chip plays from, and those the sound processor reads back
  uint8_t regs[REGISTERS], external[REGISTERS];
  // the echo's last 8 samples a side, twice over, and where the oldest is
  int echo_hist[ECHO_HIST * 2][2];
  int echo_hist_pos;
  int every_other_sample, kon, noise, counter, echo_offset, echo_length, phase;
  int new_kon;
  uint8_t endx_buf, envx_buf, outx_buf;
  // what one cycle reads for the next, as the chip carries it
  int t_pmon, t_non, t_eon, t_dir, t_koff;
  int t_brr_next_addr, t_adsr0, t_brr_header, t_brr_byte, t_srcn, t_esa, t_echo_enabled;
  int t_dir_addr, t_pitch, t_output, t_looped, t_echo_ptr;
  int t_main_out[2], t_echo_out[2], t_echo_in[2];
  struct voice voices[VOICES];
  uint8_t *ram;
} m;

#define REG(n) m.regs[R_##n]
#define VREG(r, n) (r)[V_##n]
#define XVREG(r, n) (m.external + ((r) - m.regs))[V_##n]

//// Interpolation

static int interpolate(const struct voice *v) {
  // the curve's points for where it is between two samples, forwards and mirrored
  int offset = v->interp_pos >> 4 & 0xFF;
  const short *fwd = GAUSS + 255 - offset, *rev = GAUSS + offset;
  const int *in = &v->buf[(v->interp_pos >> 12) + v->buf_pos];
  int out = (fwd[0] * in[0]) >> 11;
  out += (fwd[256] * in[1]) >> 11;
  out += (rev[256] * in[2]) >> 11;
  out = (int16_t)out;
  out += (rev[0] * in[3]) >> 11;
  CLAMP16(out);
  return out & ~1;
}

//// Counters, which the envelopes and the noise step on, each at its rate

enum { SIMPLE_COUNTER_RANGE = 2048 * 5 * 3 };
static const unsigned COUNTER_RATES[32] = {
  SIMPLE_COUNTER_RANGE + 1, // never
  2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1,
};
static const unsigned COUNTER_OFFSETS[32] = {
  1, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 0, 0,
};

static void run_counters(void) {
  if (--m.counter < 0) m.counter = SIMPLE_COUNTER_RANGE - 1;
}
static unsigned read_counter(int rate) {
  return ((unsigned)m.counter + COUNTER_OFFSETS[rate]) % COUNTER_RATES[rate];
}

//// Envelope

static void run_envelope(struct voice *v) {
  int env = v->env;
  if (v->env_mode == ENV_RELEASE) {
    if ((env -= 0x8) < 0) env = 0;
    v->env = env;
    return;
  }
  int rate, env_data = VREG(v->regs, ADSR1);
  if (m.t_adsr0 & 0x80) {
    // ADSR
    if (v->env_mode >= ENV_DECAY) {
      env--;
      env -= env >> 8;
      rate = env_data & 0x1F;
      if (v->env_mode == ENV_DECAY) rate = (m.t_adsr0 >> 3 & 0x0E) + 0x10;
    } else {
      rate = (m.t_adsr0 & 0x0F) * 2 + 1;
      env += rate < 31 ? 0x20 : 0x400;
    }
  } else {
    // GAIN
    env_data = VREG(v->regs, GAIN);
    int mode = env_data >> 5;
    if (mode < 4) {
      env = env_data * 0x10;
      rate = 31;
    } else {
      rate = env_data & 0x1F;
      if (mode == 4) {
        env -= 0x20;
      } else if (mode < 6) {
        env--;
        env -= env >> 8;
      } else {
        env += 0x20;
        if (mode > 6 && (unsigned)v->hidden_env >= 0x600) env += 0x8 - 0x20;
      }
    }
  }
  // the sustain level
  if ((env >> 8) == (env_data >> 5) && v->env_mode == ENV_DECAY) v->env_mode = ENV_SUSTAIN;
  v->hidden_env = env;
  // as unsigned, so going below zero in a linear decrease counts too
  if ((unsigned)env > 0x7FF) {
    env = env < 0 ? 0 : 0x7FF;
    if (v->env_mode == ENV_ATTACK) v->env_mode = ENV_DECAY;
  }
  if (!read_counter(rate)) v->env = env;
}

//// BRR, the samples' compressed form: blocks of 9 bytes, a header and sixteen 4-bit samples

static void decode_brr(struct voice *v) {
  // the four nybbles in 0xABCD order
  int nybbles = m.t_brr_byte * 0x100 + m.ram[(v->brr_addr + v->brr_offset + 1) & 0xFFFF];
  const int header = m.t_brr_header;
  int *pos = &v->buf[v->buf_pos];
  if ((v->buf_pos += 4) >= BRR_BUF) v->buf_pos = 0;
  for (int *end = pos + 4; pos < end; pos++, nybbles <<= 4) {
    int s = (int16_t)nybbles >> 12;
    const int shift = header >> 4;
    if (shift <= 12) s = (int)((unsigned)s << shift) >> 1;
    else s &= ~0x7FF;
    // the filter, from the last two samples
    const int filter = header & 0x0C, p1 = pos[BRR_BUF - 1], p2 = pos[BRR_BUF - 2] >> 1;
    if (filter >= 8) {
      s += p1;
      s -= p2;
      if (filter == 8) {
        s += p2 >> 4;
        s += (p1 * -3) >> 6;
      } else {
        s += (p1 * -13) >> 7;
        s += (p2 * 3) >> 4;
      }
    } else if (filter) {
      s += p1 >> 1;
      s += (-p1) >> 5;
    }
    CLAMP16(s);
    s = (int16_t)(s * 2);
    pos[BRR_BUF] = pos[0] = s;
  }
}

//// What the chip does at cycles 27 to 30 of the 32, besides the voices

static void misc_27(void) { m.t_pmon = REG(PMON) & 0xFE; }
static void misc_28(void) {
  m.t_non = REG(NON);
  m.t_eon = REG(EON);
  m.t_dir = REG(DIR);
}
static void misc_29(void) {
  // a key-on is cleared 63 cycles after it was last read
  if ((m.every_other_sample ^= 1) != 0) m.new_kon &= ~m.kon;
}
static void misc_30(void) {
  if (m.every_other_sample) {
    m.kon = m.new_kon;
    m.t_koff = REG(KOFF);
  }
  run_counters();
  if (!read_counter(REG(FLG) & 0x1F)) {
    int feedback = (m.noise << 13) ^ (m.noise << 14);
    m.noise = (feedback & 0x4000) ^ (m.noise >> 1);
  }
}

//// The voices: each one's work in nine parts, on nine of the 32 cycles

static void voice_V1(struct voice *v) {
  m.t_dir_addr = (m.t_dir * 0x100 + m.t_srcn * 4) & 0xFFFF;
  m.t_srcn = VREG(v->regs, SRCN);
}
static void voice_V2(struct voice *v) {
  // the sample's start, or its loop when it has started, from the directory
  const uint8_t *entry = &m.ram[m.t_dir_addr];
  if (!v->kon_delay) entry += 2;
  m.t_brr_next_addr = entry[0] | entry[1] << 8;
  m.t_adsr0 = VREG(v->regs, ADSR0);
  m.t_pitch = VREG(v->regs, PITCHL);
}
static void voice_V3a(struct voice *v) { m.t_pitch += (VREG(v->regs, PITCHH) & 0x3F) << 8; }
static void voice_V3b(struct voice *v) {
  m.t_brr_byte = m.ram[(v->brr_addr + v->brr_offset) & 0xFFFF];
  m.t_brr_header = m.ram[v->brr_addr];
}
static void voice_V3c(struct voice *v) {
  // the pitch bent by the voice before's output
  if (m.t_pmon & v->vbit) m.t_pitch += ((m.t_output >> 5) * m.t_pitch) >> 10;
  if (v->kon_delay) {
    // ready to decode from the sample's start at the next
    if (v->kon_delay == 5) {
      v->brr_addr = m.t_brr_next_addr;
      v->brr_offset = 1;
      v->buf_pos = 0;
      m.t_brr_header = 0;
    }
    // no envelope while it starts, and no decoding until its last three samples
    v->env = 0;
    v->hidden_env = 0;
    v->interp_pos = 0;
    if (--v->kon_delay & 3) v->interp_pos = 0x4000;
    m.t_pitch = 0;
  }
  int output = interpolate(v);
  if (m.t_non & v->vbit) output = (int16_t)(m.noise * 2);
  m.t_output = (output * v->env) >> 11 & ~1;
  v->t_envx_out = (uint8_t)(v->env >> 4);
  // silent at once at the sample's end or the chip's reset
  if (REG(FLG) & 0x80 || (m.t_brr_header & 3) == 1) {
    v->env_mode = ENV_RELEASE;
    v->env = 0;
  }
  if (m.every_other_sample) {
    if (m.t_koff & v->vbit) v->env_mode = ENV_RELEASE;
    if (m.kon & v->vbit) {
      v->kon_delay = 5;
      v->env_mode = ENV_ATTACK;
    }
  }
  if (!v->kon_delay) run_envelope(v);
}
static void voice_V3(struct voice *v) {
  voice_V3a(v);
  voice_V3b(v);
  voice_V3c(v);
}

static void voice_output(const struct voice *v, int ch) {
  int amp = (m.t_output * (int8_t)VREG(v->regs, VOLL + ch)) >> 7;
  m.t_main_out[ch] += amp;
  CLAMP16(m.t_main_out[ch]);
  if (m.t_eon & v->vbit) {
    m.t_echo_out[ch] += amp;
    CLAMP16(m.t_echo_out[ch]);
  }
}
static void voice_V4(struct voice *v) {
  m.t_looped = 0;
  if (v->interp_pos >= 0x4000) {
    decode_brr(v);
    if ((v->brr_offset += 2) >= BRR_BLOCK) {
      // the next block, or the loop's at the sample's end
      v->brr_addr = (v->brr_addr + BRR_BLOCK) & 0xFFFF;
      if (m.t_brr_header & 1) {
        v->brr_addr = m.t_brr_next_addr;
        m.t_looped = v->vbit;
      }
      v->brr_offset = 1;
    }
  }
  v->interp_pos = (v->interp_pos & 0x3FFF) + m.t_pitch;
  // kept from getting too far ahead, as pitch bending can
  if (v->interp_pos > 0x7FFF) v->interp_pos = 0x7FFF;
  voice_output(v, 0);
}
static void voice_V5(struct voice *v) {
  voice_output(v, 1);
  // ENDX, OUTX and ENVX don't change if they were written a cycle or two before
  int endx_buf = REG(ENDX) | m.t_looped;
  if (v->kon_delay == 5) endx_buf &= ~v->vbit;
  m.endx_buf = (uint8_t)endx_buf;
}
static void voice_V6(struct voice *v) {
  (void)v;
  m.outx_buf = (uint8_t)(m.t_output >> 8);
}
static void voice_V7(struct voice *v) {
  REG(ENDX) = m.endx_buf;
  m.external[R_ENDX] = m.endx_buf;
  m.envx_buf = v->t_envx_out;
}
static void voice_V8(struct voice *v) {
  VREG(v->regs, OUTX) = m.outx_buf;
  XVREG(v->regs, OUTX) = m.outx_buf;
}
static void voice_V9(struct voice *v) {
  VREG(v->regs, ENVX) = m.envx_buf;
  XVREG(v->regs, ENVX) = m.envx_buf;
}
// the parts most cycles do, for three voices at once, in the chip's order
static void voice_V7_V4_V1(struct voice *v) {
  voice_V7(v);
  voice_V1(v + 3);
  voice_V4(v + 1);
}
static void voice_V8_V5_V2(struct voice *v) {
  voice_V8(v);
  voice_V5(v + 1);
  voice_V2(v + 2);
}
static void voice_V9_V6_V3(struct voice *v) {
  voice_V9(v);
  voice_V6(v + 1);
  voice_V3(v + 2);
}

//// Echo, in the sound processor's memory from ESA on, EDL times 2 KB of it

// where the echo's sample for a side is, and the history's sample `i` for the filter, 0 the oldest
#define ECHO_PTR(ch) (&m.ram[m.t_echo_ptr + (ch) * 2])
#define ECHO_FIR(i) (m.echo_hist[m.echo_hist_pos + (i)])
#define CALC_FIR(i, ch) ((ECHO_FIR((i) + 1)[ch] * (int8_t)m.regs[R_FIR + (i) * 0x10]) >> 6)

static void echo_read(int ch) {
  const uint8_t *at = ECHO_PTR(ch);
  int s = (int16_t)(at[0] | at[1] << 8);
  ECHO_FIR(0)[ch] = ECHO_FIR(8)[ch] = s >> 1;
}
static void echo_22(void) {
  if (++m.echo_hist_pos >= ECHO_HIST) m.echo_hist_pos = 0;
  m.t_echo_ptr = (m.t_esa * 0x100 + m.echo_offset) & 0xFFFF;
  echo_read(0);
  int l = CALC_FIR(0, 0), r = CALC_FIR(0, 1);
  m.t_echo_in[0] = l;
  m.t_echo_in[1] = r;
}
static void echo_23(void) {
  int l = CALC_FIR(1, 0) + CALC_FIR(2, 0), r = CALC_FIR(1, 1) + CALC_FIR(2, 1);
  m.t_echo_in[0] += l;
  m.t_echo_in[1] += r;
  echo_read(1);
}
static void echo_24(void) {
  int l = CALC_FIR(3, 0) + CALC_FIR(4, 0) + CALC_FIR(5, 0), r = CALC_FIR(3, 1) + CALC_FIR(4, 1) + CALC_FIR(5, 1);
  m.t_echo_in[0] += l;
  m.t_echo_in[1] += r;
}
static void echo_25(void) {
  int l = m.t_echo_in[0] + CALC_FIR(6, 0), r = m.t_echo_in[1] + CALC_FIR(6, 1);
  l = (int16_t)l;
  r = (int16_t)r;
  l += (int16_t)CALC_FIR(7, 0);
  r += (int16_t)CALC_FIR(7, 1);
  CLAMP16(l);
  CLAMP16(r);
  m.t_echo_in[0] = l & ~1;
  m.t_echo_in[1] = r & ~1;
}
static int echo_output(int ch) {
  int out = (int16_t)((m.t_main_out[ch] * (int8_t)m.regs[R_MVOLL + ch * 0x10]) >> 7) + (int16_t)((m.t_echo_in[ch] * (int8_t)m.regs[R_EVOLL + ch * 0x10]) >> 7);
  CLAMP16(out);
  return out;
}
static void echo_26(void) {
  // the left side's output, kept for the next cycle so both sides come out together
  m.t_main_out[0] = echo_output(0);
  int l = m.t_echo_out[0] + (int16_t)((m.t_echo_in[0] * (int8_t)REG(EFB)) >> 7);
  int r = m.t_echo_out[1] + (int16_t)((m.t_echo_in[1] * (int8_t)REG(EFB)) >> 7);
  CLAMP16(l);
  CLAMP16(r);
  m.t_echo_out[0] = l & ~1;
  m.t_echo_out[1] = r & ~1;
}
static void echo_27(void) {
  int l = m.t_main_out[0], r = echo_output(1);
  m.t_main_out[0] = 0;
  m.t_main_out[1] = 0;
  if (REG(FLG) & 0x40) l = r = 0;
  apu_sample((int16_t)l, (int16_t)r);
}
static void echo_28(void) { m.t_echo_enabled = REG(FLG); }
static void echo_write(int ch) {
  if (!(m.t_echo_enabled & 0x20)) {
    uint8_t *at = ECHO_PTR(ch);
    at[0] = (uint8_t)m.t_echo_out[ch];
    at[1] = (uint8_t)(m.t_echo_out[ch] >> 8);
  }
  m.t_echo_out[ch] = 0;
}
static void echo_29(void) {
  m.t_esa = REG(ESA);
  if (!m.echo_offset) m.echo_length = (REG(EDL) & 0x0F) * 0x800;
  m.echo_offset += 4;
  if (m.echo_offset >= m.echo_length) m.echo_offset = 0;
  echo_write(0);
  m.t_echo_enabled = REG(FLG);
}
static void echo_30(void) { echo_write(1); }

//// Timing: the work of each of the 32 cycles a sample takes

static void cycle(int phase) {
  struct voice *v = m.voices;
  switch (phase) {
  case 0: voice_V5(v); voice_V2(v + 1); break;
  case 1: voice_V6(v); voice_V3(v + 1); break;
  case 2: voice_V7_V4_V1(v); break;
  case 3: voice_V8_V5_V2(v); break;
  case 4: voice_V9_V6_V3(v); break;
  case 5: voice_V7_V4_V1(v + 1); break;
  case 6: voice_V8_V5_V2(v + 1); break;
  case 7: voice_V9_V6_V3(v + 1); break;
  case 8: voice_V7_V4_V1(v + 2); break;
  case 9: voice_V8_V5_V2(v + 2); break;
  case 10: voice_V9_V6_V3(v + 2); break;
  case 11: voice_V7_V4_V1(v + 3); break;
  case 12: voice_V8_V5_V2(v + 3); break;
  case 13: voice_V9_V6_V3(v + 3); break;
  case 14: voice_V7_V4_V1(v + 4); break;
  case 15: voice_V8_V5_V2(v + 4); break;
  case 16: voice_V9_V6_V3(v + 4); break;
  case 17: voice_V1(v); voice_V7(v + 5); voice_V4(v + 6); break;
  case 18: voice_V8_V5_V2(v + 5); break;
  case 19: voice_V9_V6_V3(v + 5); break;
  case 20: voice_V1(v + 1); voice_V7(v + 6); voice_V4(v + 7); break;
  // voice 0's V2 after voice 7's V5, which both use what's read of the next sample's start
  case 21: voice_V8(v + 6); voice_V5(v + 7); voice_V2(v); break;
  case 22: voice_V3a(v); voice_V9(v + 6); voice_V6(v + 7); echo_22(); break;
  case 23: voice_V7(v + 7); echo_23(); break;
  case 24: voice_V8(v + 7); echo_24(); break;
  case 25: voice_V3b(v); voice_V9(v + 7); echo_25(); break;
  case 26: echo_26(); break;
  case 27: misc_27(); echo_27(); break;
  case 28: misc_28(); echo_28(); break;
  case 29: misc_29(); echo_29(); break;
  case 30: misc_30(); voice_V3c(v); echo_30(); break;
  default: voice_V4(v); voice_V1(v + 2); break;
  }
}

void dsp_run(uint32_t cycles) {
  while (cycles--) {
    cycle(m.phase);
    m.phase = (m.phase + 1) & 31;
  }
}

//// Setup, and the registers as the sound processor reaches them at $F2 and $F3

void dsp_power(uint8_t *ram) {
  for (size_t i = 0; i < sizeof m; i++) ((uint8_t *)&m)[i] = 0;
  m.ram = ram;
  for (int i = 0; i < REGISTERS; i++) m.external[i] = INITIAL[i];
  // the two the chip plays from that don't start at zero, as Snes9x has them, and the chip's reset with its sound off
  m.regs[0x42] = 0x01;
  m.regs[0x52] = 0x01;
  m.regs[R_FLG] = 0xE0;
  for (int i = 0; i < VOICES; i++) {
    struct voice *v = &m.voices[i];
    v->brr_offset = 1;
    v->vbit = 1 << i;
    v->regs = &m.regs[i * 0x10];
  }
  m.new_kon = REG(KON);
  m.t_dir = REG(DIR);
  m.t_esa = REG(ESA);
  m.noise = 0x4000;
  m.echo_hist_pos = 0;
  m.every_other_sample = 1;
}

uint8_t dsp_read(uint8_t address) { return m.external[address & 0x7F]; }

void dsp_write(uint8_t address, uint8_t value) {
  address &= 0x7F;
  m.regs[address] = value;
  m.external[address] = value;
  switch (address & 0x0F) {
  case V_ENVX: m.envx_buf = value; break;
  case V_OUTX: m.outx_buf = value; break;
  case 0x0C:
    if (address == R_KON) m.new_kon = value;
    // ENDX is cleared, whatever is written
    if (address == R_ENDX) {
      m.endx_buf = 0;
      m.regs[R_ENDX] = 0;
    }
    break;
  }
}
