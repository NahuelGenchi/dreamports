// The PlayStation 2's kit in C, on what every console's kit in C shares (kit/c/README.md). A game writes the console's
// graphics chip, the GS, as its original does, and does its float sums as the console's processor, the EE, does them.
// What it writes each frame is its draw list, which is what a 3D game is proven by (docs/STANDARD.md), and the kit draws
// that list for the page (kit/ps2/c/README.md).

#ifndef DREAMPORTS_PS2_H
#define DREAMPORTS_PS2_H

#include "console.h"

// the GS's registers a game writes, by their numbers
enum {
  GS_PRIM = 0x00, GS_RGBAQ = 0x01, GS_ST = 0x02, GS_UV = 0x03, GS_XYZF2 = 0x04, GS_XYZ2 = 0x05, GS_TEX0_1 = 0x06,
  GS_TEX0_2 = 0x07, GS_CLAMP_1 = 0x08, GS_CLAMP_2 = 0x09, GS_FOG = 0x0A, GS_XYZF3 = 0x0C, GS_XYZ3 = 0x0D,
  GS_TEX1_1 = 0x14, GS_TEX1_2 = 0x15, GS_TEX2_1 = 0x16, GS_TEX2_2 = 0x17, GS_XYOFFSET_1 = 0x18, GS_XYOFFSET_2 = 0x19,
  GS_PRMODECONT = 0x1A, GS_PRMODE = 0x1B, GS_TEXCLUT = 0x1C, GS_SCANMSK = 0x22, GS_MIPTBP1_1 = 0x34, GS_MIPTBP1_2 = 0x35,
  GS_MIPTBP2_1 = 0x36, GS_MIPTBP2_2 = 0x37, GS_TEXA = 0x3B, GS_FOGCOL = 0x3D, GS_TEXFLUSH = 0x3F, GS_SCISSOR_1 = 0x40,
  GS_SCISSOR_2 = 0x41, GS_ALPHA_1 = 0x42, GS_ALPHA_2 = 0x43, GS_DIMX = 0x44, GS_DTHE = 0x45, GS_COLCLAMP = 0x46,
  GS_TEST_1 = 0x47, GS_TEST_2 = 0x48, GS_PABE = 0x49, GS_FBA_1 = 0x4A, GS_FBA_2 = 0x4B, GS_FRAME_1 = 0x4C,
  GS_FRAME_2 = 0x4D, GS_ZBUF_1 = 0x4E, GS_ZBUF_2 = 0x4F, GS_BITBLTBUF = 0x50, GS_TRXPOS = 0x51, GS_TRXREG = 0x52,
  GS_TRXDIR = 0x53, GS_HWREG = 0x54, GS_SIGNAL = 0x60, GS_FINISH = 0x61, GS_LABEL = 0x62,
};
// where the EE sees the GS's privileged registers, which say what the screen shows, and its status, interrupts and the
// way its bus faces: each is 64 bits, written as two halves
enum {
  GS_PMODE = 0x12000000, GS_SMODE2 = 0x12000020, GS_DISPFB1 = 0x12000070, GS_DISPLAY1 = 0x12000080, GS_DISPFB2 = 0x12000090,
  GS_DISPLAY2 = 0x120000A0, GS_BGCOLOR = 0x120000E0, GS_CSR = 0x12001000, GS_IMR = 0x12001010, GS_BUSDIR = 0x12001040,
  GS_SIGLBLID = 0x12001080,
};

/** Writes one of the GS's registers, as a GIF packet's address and data does. */
void gs_write(uint8_t reg, uint64_t value);
/** Sends the GS a picture's data, `length` bytes, as a GIF packet in IMAGE mode does. */
void gs_image(const void *data, uint32_t length);
/** Takes the next `length` bytes of the picture TRXDIR = 1 started moving out of the GS's memory, as a DMA transfer from
 *  VIF1 does once BUSDIR is 1: each pixel's bits after the last's, as a picture moved in has them, and 0 past its end. */
void gs_read_image(void *data, uint32_t length);
/** Writes half of a privileged register: the 32 bits at `address`, the low half at the register's own or the high 4 on. */
void gs_screen(uint32_t address, uint32_t value);
/** Reads half of a privileged register the console lets the EE read: CSR, IMR or SIGLBLID, the low half at the
 *  register's own address or the high 4 on. CSR has SIGNAL, FINISH, HSINT and VSINT as the GS left them, FIELD and its
 *  revision. */
uint32_t gs_screen_read(uint32_t address);
/** The function the GS's interrupt calls, as a game's handler for INTC_GS does on the console, or NULL for none: once
 *  SIGNAL or FINISH is written, or a V-blank starts, each with its bit set in CSR and not masked in IMR. */
void gs_on_interrupt(void (*handler)(void));
/** Paints the page's picture with what the screen shows of the framebuffer, at the console's size. For game_draw. */
void gs_show(void);

/** Sends the GIF everything in `bytes` bytes of packets, as a DMA transfer to it does: each tag's registers become
 *  the GS's writes. */
void gif_send(const void *data, uint32_t bytes);
/** Sends the GIF one packet, to the tag that ends it, of `most` bytes at most, as a vector unit's XGKICK does, and gives
 *  how many bytes it was. */
uint32_t gif_packet(const void *data, uint32_t most);

// The EE's memories and what its code reaches at an address (bus.c), for a game whose functions are twins of its
// original's: the DMA controller, the VIF and the GIF take what it writes to their registers as the console's do, and
// run then and there, so the GS gets the original's writes in the original's order (kit/ps2/c/README.md).
#define PS2_RAM_SIZE (32u << 20)
#define PS2_SCRATCHPAD_SIZE (16u << 10)
/** The scratchpad, 16 KB, at 0x70000000 for the EE's code. The EE's main memory is ee_memory(), below: a DMA address is
 *  an offset into it, as on the console, or into the scratchpad when its top bit is set, so a game builds its DMA chains
 *  there and gives the controller their offsets. */
uint8_t *ps2_scratchpad(void);
/** What the EE's code reads and writes at an address: main memory, the scratchpad, the vector units' memories, and
 *  the registers of the DMA controller, the VIF, the GIF and the GS's screen. An address the kit has nothing at reads 0. */
uint32_t ps2_read32(uint32_t address);
void ps2_write32(uint32_t address, uint32_t value);
uint64_t ps2_read64(uint32_t address);
void ps2_write64(uint32_t address, uint64_t value);
/** 128 bits at once, as SQ and LQ move them, which is how the VIF's and the GIF's FIFOs are written. */
void ps2_read128(uint32_t address, void *value);
void ps2_write128(uint32_t address, const void *value);

// where the EE sees them: each DMA channel's registers, from the channel's address, and the controller's own
enum {
  DMA_VIF0 = 0x10008000, DMA_VIF1 = 0x10009000, DMA_GIF = 0x1000A000, DMA_FROM_IPU = 0x1000B000, DMA_TO_IPU = 0x1000B400,
  DMA_SIF0 = 0x1000C000, DMA_SIF1 = 0x1000C400, DMA_SIF2 = 0x1000C800, DMA_FROM_SPR = 0x1000D000, DMA_TO_SPR = 0x1000D400,
  DMA_CHCR = 0x00, DMA_MADR = 0x10, DMA_QWC = 0x20, DMA_TADR = 0x30, DMA_ASR0 = 0x40, DMA_ASR1 = 0x50, DMA_SADR = 0x80,
  D_CTRL = 0x1000E000, D_STAT = 0x1000E010, D_PCR = 0x1000E020, D_SQWC = 0x1000E030, D_RBSR = 0x1000E040,
  D_RBOR = 0x1000E050, D_STADR = 0x1000E060, D_ENABLER = 0x1000F520, D_ENABLEW = 0x1000F590,
};
// the VIFs', the GIF's and their FIFOs, and the vector units' memories
enum {
  VIF0_STAT = 0x10003800, VIF0_FBRST = 0x10003810, VIF0_ERR = 0x10003820, VIF0_MARK = 0x10003830, VIF0_CYCLE = 0x10003840,
  VIF0_MODE = 0x10003850, VIF0_NUM = 0x10003860, VIF0_MASK = 0x10003870, VIF0_CODE = 0x10003880, VIF0_ITOPS = 0x10003890,
  VIF0_ITOP = 0x100038D0, VIF0_R0 = 0x10003900, VIF0_C0 = 0x10003940,
  VIF1_STAT = 0x10003C00, VIF1_FBRST = 0x10003C10, VIF1_ERR = 0x10003C20, VIF1_MARK = 0x10003C30, VIF1_CYCLE = 0x10003C40,
  VIF1_MODE = 0x10003C50, VIF1_NUM = 0x10003C60, VIF1_MASK = 0x10003C70, VIF1_CODE = 0x10003C80, VIF1_ITOPS = 0x10003C90,
  VIF1_BASE = 0x10003CA0, VIF1_OFST = 0x10003CB0, VIF1_TOPS = 0x10003CC0, VIF1_ITOP = 0x10003CD0, VIF1_TOP = 0x10003CE0,
  VIF1_R0 = 0x10003D00, VIF1_C0 = 0x10003D40,
  GIF_CTRL = 0x10003000, GIF_MODE = 0x10003010, GIF_STAT = 0x10003020,
  VIF0_FIFO = 0x10004000, VIF1_FIFO = 0x10005000, GIF_FIFO = 0x10006000,
  VU0_CODE = 0x11000000, VU0_DATA = 0x11004000, VU1_CODE = 0x11008000, VU1_DATA = 0x1100C000,
};

// The EE's floats, as its FPU works them out (ee.c): each result exact and then cut towards zero, where a computer
// rounds to the nearest, with no infinity or NaN, the largest float on overflow, tiny floats as zero, and the FPU's flags
// in ee_fcsr. A sum done with a plain + lands a last bit away, and a turning model's corner is a sixteenth of a pixel
// out within a hundred frames, so a twin of the EE's code does its float sums with these.
float ee_add(float a, float b);
float ee_sub(float a, float b);
float ee_mul(float a, float b);
/** A division, cut the same way. By zero it gives the largest float there is, with the sign the two make. */
float ee_div(float a, float b);
/** The square root of a float taken without its sign, cut the same way. */
float ee_sqrt(float value);
/** RSQRT.S: a over the square root of b, worked out at once and cut once. */
float ee_rsqrt(float a, float b);
/** The accumulator, which ADDA.S, SUBA.S, MULA.S, MADDA.S and MSUBA.S set, and MADD.S and MSUB.S add a product to. */
extern float ee_acc;
float ee_adda(float a, float b);
float ee_suba(float a, float b);
float ee_mula(float a, float b);
float ee_madd(float a, float b);
float ee_msub(float a, float b);
float ee_madda(float a, float b);
float ee_msuba(float a, float b);
float ee_abs(float value);
float ee_neg(float value);
float ee_max(float a, float b);
float ee_min(float a, float b);
/** C.F.S, C.EQ.S, C.LT.S and C.LE.S: each sets FCSR's C bit, which BC1T and BC1F test, and gives it. */
int ee_c_f(void);
int ee_c_eq(float a, float b);
int ee_c_lt(float a, float b);
int ee_c_le(float a, float b);
/** A float as a whole number, what's after its point dropped, as the EE's CVT.W.S makes it, the largest there is with
 *  its sign for one too large. */
int32_t ee_to_int(float value);
/** A whole number as a float, cut to 24 bits as CVT.S.W cuts it. */
float ee_from_int(int32_t value);
/** The FPU's control and status register, FCSR, as CFC1 reads it: the condition bit C, and overflow, underflow,
 *  division by zero and invalid, each with the sticky bit that keeps it until the game clears it with CTC1. */
extern uint32_t ee_fcsr;
enum {
  EE_FCSR_C = 1 << 23, EE_FCSR_I = 1 << 17, EE_FCSR_D = 1 << 16, EE_FCSR_O = 1 << 15, EE_FCSR_U = 1 << 14,
  EE_FCSR_SI = 1 << 6, EE_FCSR_SD = 1 << 5, EE_FCSR_SO = 1 << 4, EE_FCSR_SU = 1 << 3,
};

// The console's memory, for a game that keeps it where the console does, for the proof tools to compare after every
// frame (ps2.c): `memory` is PS2_EE, PS2_IOP or PS2_SPU2, `address` where the stretch starts in that memory, as the
// console's own addresses go (main memory from 0, the scratchpad at 0x70000000, vector unit 1's data at 0x1100C000),
// `size` its bytes, and `at` where the game keeps them.
enum { PS2_EE, PS2_IOP, PS2_SPU2 };
void ps2_console_memory(uint32_t memory, uint32_t address, uint32_t size, void *at);

// The vector units (vu.c). A program on one runs from its code memory as the console runs it, started by the VIF's
// MSCAL or by VCALLMS, with its floats on the EE's rules. A vector is four floats, x, y, z and w, or the same bits as
// whole numbers. `dest` names the fields an instruction writes, as its bits do: VU_X | VU_Y, VU_XYZW.
typedef union { float f[4]; int32_t i[4]; uint32_t u[4]; } vu_vector;
enum { VU_X = 8, VU_Y = 4, VU_Z = 2, VU_W = 1, VU_XYZ = 14, VU_XYZW = 15 };

/** Vector unit 0's registers as the EE's code reaches them in macro mode: VF0 to VF31 with QMFC2 and QMTC2, and VI0 to
 *  VI15, the status, MAC and clip flags, R, I, Q, TPC, CMSAR0, FBRST, VPU_STAT and CMSAR1 with CFC2 and CTC2, by their
 *  numbers. Writing CMSAR1 starts vector unit 1 there. */
vu_vector *vu0_vf(int reg);
uint32_t vu0_cfc2(int reg);
void vu0_ctc2(int reg, uint32_t value);
/** One COP2 macro instruction of vector unit 0's, VADD.xyz to VCALLMS, as the original's 32-bit word encodes it. */
void vu0_macro(uint32_t instruction);
/** Whether vector unit 0 or 1 is running a program, as VPU_STAT and BC2T see it. */
int vu_running(int unit);

// For a unit's program written again in C, an instruction a line: the upper instructions' sums on whole vectors, on the
// fields `dest` names, with the same rules and no flags. ADD, SUB, MUL, and MADD and MSUB with the accumulator:
void vu_add(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest);
void vu_sub(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest);
void vu_mul(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest);
void vu_madd(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest);
void vu_msub(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest);
// the same with one float for every field, as ADDx, MULq, MADDw, MULi and the like take one field, Q or I. The same
// functions write the accumulator, as ADDA, MULA and MADDA do, when `fd` is it
void vu_addf(vu_vector *fd, const vu_vector *fs, float with, int dest);
void vu_subf(vu_vector *fd, const vu_vector *fs, float with, int dest);
void vu_mulf(vu_vector *fd, const vu_vector *fs, float with, int dest);
void vu_maddf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest);
void vu_msubf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest);
/** FTOI0, 4, 12 and 15: floats as whole numbers with `bits` bits after the point. ITOF is the other way. */
void vu_ftoi(vu_vector *ft, const vu_vector *fs, int bits, int dest);
void vu_itof(vu_vector *ft, const vu_vector *fs, int bits, int dest);

// The IOP, the console's second processor, for twins of a game's own IOP modules (iop.c): its memory, 4 MB as the
// emulator has it, and its hardware as a module's loads and stores reach it, at the addresses the module uses. The
// sound chip, the SPU2, is there from 0x1F900000, both its cores as the emulator mixes them (spu2.c), and the DMA
// channels that move sound to it, 4 for core 0 at 0x1F8010C0 and 7 for core 1 at 0x1F801500. What the chip is given
// each frame is the frame's sound list, which a PlayStation 2 game's sound is proven by, with its samples.
uint8_t *iop_memory(void);
void iop_write8(uint32_t address, uint8_t value);
void iop_write16(uint32_t address, uint16_t value);
void iop_write32(uint32_t address, uint32_t value);
uint8_t iop_read8(uint32_t address);
uint16_t iop_read16(uint32_t address);
uint32_t iop_read32(uint32_t address);
/** Lets `ee_ticks` of the EE's clock pass within the frame, the sound chip mixing what's due in them and the SIF's
 *  packets reaching the EE, for a game whose IOP code writes the chip later in a frame than as it starts. Time past the
 *  frame's end is dropped. ps2_time_to_slice lets it pass to the end of the emulator's slice of 4,800 ticks, which is
 *  when the IOP runs: what the EE does as it waits for the IOP. ps2_ee_time is the EE's ticks since power-on. */
void ps2_time_pass(uint32_t ee_ticks);
void ps2_time_to_slice(void);
uint64_t ps2_ee_time(void);

// The SIF, between the EE and the IOP (sif.c), as the emulator has it. The EE's memory, 32 MB, which the SIF reads what
// the EE sends from and writes the IOP's replies into, at the EE's own addresses. The EE kernel's SIF calls: SifSetDma,
// giving the transfer's id, SifDmaStat, iSifSetDChain (from_interrupt 1) or SifSetDChain, SifGetReg and SifSetReg. And
// what the EE runs as each of the IOP's packets arrives, its DMA channel 5's handler, which says it took it with
// sif_set_dchain(1); with none, the EE's code waits for the packet in its memory and says so itself.
uint8_t *ee_memory(void);
typedef struct { uint32_t from, to, size, flags; } sif_transfer;
uint32_t sif_set_dma(const sif_transfer *transfers, uint32_t count);
int32_t sif_dma_stat(uint32_t id);
void sif_set_dchain(int from_interrupt);
uint32_t sif_get_reg(uint32_t which);
void sif_set_reg(uint32_t which, uint32_t value);
void sif_ee_handler(void (*handler)(void));
/** An RPC server on the IOP, as a twin of a game's module registers one (sceSifRegisterRpc): called with the call's
 *  number, its arguments and where its answer goes, in the EE's memory. It gives 1 for the answer to go back now, or 0
 *  for the server to give it later with sif_call_reply, with what goes in the EE's place for it. */
typedef int sif_server(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size);
void sif_register_server(uint32_t id, sif_server *serve);
/** A server as a game's own module registers it, its twin's function called as the module's is: with the call's
 *  number, the IOP address of its buffer, where the call's arguments were copied, and their size, giving the IOP address
 *  of its answer. It runs when the IOP next does, at the end of the EE's slice. A number the kit already answers stays
 *  the kit's, as in the emulator. */
typedef uint32_t sif_rpc(uint32_t number, uint32_t buffer, uint32_t size);
void sif_register_rpc(uint32_t id, sif_rpc *function, uint32_t buffer);
int sif_server_registered(uint32_t id);
void sif_call_reply(uint32_t id, const void *data);

// The IOP's kernel, as the kit answers it (iop-bios.c). A Dreamport's twin of a game's own IOP module, started when the
// EE has the loader load it, by the name its file gives itself or the path it's loaded from, with its argc and argv.
// A thread a module makes that waits for each V-blank's start runs when the IOP first runs in each frame, at the end
// of the EE's first slice.
typedef int iop_start(int argc, char **argv);
void iop_module_twin(const char *name, iop_start *start);
void iop_each_vblank(void (*thread)(void));

// The disc drive (cdvd.c). A game's EE code reaches it through the IOP's RPC servers, which the kit answers as the
// emulator does, through the SIF. ps2_disc_sectors reads `count` sectors' 2048 bytes of data from `lba`, as the drive
// gives them, for a game's start, which the console's loader does for it, and for twins of IOP code that read the disc
// themselves. A game that reads its disc runs under kit_run (kit.h), in game_start and game_step alike.
void ps2_disc_sectors(uint32_t lba, uint32_t count, uint8_t *to);

#endif
