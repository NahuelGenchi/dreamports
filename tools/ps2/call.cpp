// The original's side of the PlayStation 2's function check: one function of a game's program run by itself in Play!'s
// own processor code. The build compiles Play!'s EE, IOP and vector unit code (MA_EE, MA_MIPSIV, COP_FPU, COP_VU, MA_VU
// and their blocks) and its code generator, CodeGen, as their makers wrote them, from the source the proof tools fetch
// for the reference emulator at the commit tools/consoles.mjs fixes, beside this file, which stands in for the rest of
// the emulator (original.mjs). So the reference is the code every PlayStation 2 game is proven on in `prove`, run as the
// emulator runs it, a block at a time, with the console's float rounding.
//
// It runs one of three processors, named as the program starts:
//
//   ee   the main processor, the R5900: its 128-bit registers, MMI, the FPU and vector unit 0 in macro mode (COP2). It
//        sees the console's 32 MB at 0x00000000, with its mirrors at 0x20000000, 0x30100000, 0x80000000 and
//        0xA0000000; the scratchpad's 16 KB at 0x70000000; the hardware's registers at 0x10000000 (64 KB); the vector
//        units' memories at 0x11000000 (micro and data memory of unit 0, then of unit 1); the GS's registers at
//        0x12000000 (8 KB); and the IOP's 2 MB at 0x1C000000, each where the console's wiring has them.
//   iop  the second processor, an R3000A: its 2 MB at 0x00000000, mirrored to 8 MB and at 0x80000000 and 0xA0000000,
//        its scratchpad's 1 KB at 0x1F800000, the hardware's registers at 0x1F801000 (60 KB) and the SPU2's at
//        0x1F900000 (2 KB).
//   vu1  vector unit 1, running a microprogram from its micro memory, with its 16 KB of data memory, until its E bit.
//        Each packet it sends the GS with XGKICK is kept, as the GIF read it out of the data memory then.
//
// The hardware's registers are kept as memory, so a store to one is kept and a read gives what was kept there. A
// function that goes anywhere else, reads or writes where no halfword, word, doubleword or quadword starts (which the
// console stops at, where the emulator reads across), calls the console's kernel, starts a vector unit or runs out of
// instructions stops there, with why.
//
// It's kept running and told what to do on its standard input, in little-endian words, and answers on its standard
// output:
//
//   'I' image   the memory every call starts from: IMAGE bytes, laid out as the regions below say. Answers 'k'.
//   'C' call    runs a function from that memory with some of it changed: where it starts, how many bytes long it is,
//               how many instructions it may run, its registers (REGISTERS words, in the order of struct below), and
//               the changes, a count and then each one's address, bytes (1, 2 or 4) and value, and the addresses to
//               watch for, a count and then each. On the EE and the IOP a call ends when the processor comes back to
//               where ra pointed as it started; on vector unit 1 at its E bit. Answers how it ended, the words below,
//               and then the memory every call starts from is as it was.
//   'Q'         ends the program.
//
// What a call answers, in words but for the bytes of what ran and of the memory:
//   end         0 came back, 1 ran out of instructions, 2 an exception, 3 went where the check can't follow, 4 went into
//               the kernel's memory, 5 read or wrote where none of its size starts, 6 started a vector unit's
//               microprogram, 7 called the kernel with SYSCALL
//   detail      the exception, the address it went to or reached, or the kernel call's number, from v1
//   pc          where it was when it ended
//   steps       how many instructions it ran (pairs, on vector unit 1)
//   hardware    how many reads and writes went to the hardware's registers
//   flags       1 when vector unit 0's registers changed in an EE call
//   registers   REGISTERS words, as it left them
//   span / 4    one byte for each instruction of the function (span / 8 on vector unit 1): 1 when it ran, 2 when a
//   bytes       branch there went to its target, 4 when it went on past it
//   reads       a count, then each place it read, the first time: address, bytes and the value it read; on vector unit
//               1 none, as its own memory is read directly
//   chunks      a count, then each 256 bytes of the image it wrote: where they are, in 256s, and the bytes as it left
//               them
//   kicks       a count, then each packet sent by XGKICK: its address in the data memory, its length in bytes, and
//               its bytes, on vector unit 1 only
//   starts      a count, then, for each address watched for, its 1st, 3rd, 9th start and so on by threes, as the
//               processor reached it: the address, which start it was, how many instructions had run, the registers
//               as they were, and the image's 4 KB pages written since the start before, a count and then each one's
//               number and bytes; the first has every page that isn't zeros. It's how a made-up program's play gives
//               the memories a function really starts from (twin-memories.mjs)

#include <algorithm>
#include <cfenv>
#include <csetjmp>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <memory>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "MIPS.h"
#include "COP_SCU.h"
#include "COP_FPU.h"
#include "FpUtils.h"
#include "MemoryUtils.h"
#include "MA_MIPSIV.h"
#include "GenericMipsExecutor.h"
#include "ee/COP_VU.h"
#include "ee/MA_EE.h"
#include "ee/MA_VU.h"
#include "ee/EeBasicBlock.h"
#include "ee/VuExecutor.h"
#include "ee/VUShared.h"

enum Kind { EE, IOP, VU1 };
enum { END_BACK, END_STEPS, END_EXCEPTION, END_ELSEWHERE, END_KERNEL, END_MISALIGNED, END_VU, END_SYSCALL };
enum { CHUNK = 256, MOST_READS = 1024, PAGE = 4096 };

// Where each memory of a processor is in the image: its place there, its address as the processor sees it, its size.
struct Region { uint32 at, address, bytes; bool hardware; };
static const Region EE_REGIONS[] = {
    {0x00000000, 0x00000000, 0x02000000, false}, // the console's memory
    {0x02000000, 0x1C000000, 0x00200000, false}, // the IOP's memory
    {0x02200000, 0x70000000, 0x00004000, false}, // the scratchpad
    {0x02210000, 0x10000000, 0x00010000, true},  // the hardware's registers
    {0x02220000, 0x11000000, 0x00001000, false}, // vector unit 0's micro memory
    {0x02224000, 0x11004000, 0x00001000, false}, // and its data memory
    {0x02228000, 0x11008000, 0x00004000, false}, // vector unit 1's micro memory
    {0x0222C000, 0x1100C000, 0x00004000, false}, // and its data memory
    {0x02230000, 0x12000000, 0x00002000, true},  // the GS's registers
};
static const Region IOP_REGIONS[] = {
    {0x00000000, 0x00000000, 0x00200000, false}, // the IOP's memory
    {0x00200000, 0x1F800000, 0x00000400, false}, // its scratchpad
    {0x00201000, 0x1F801000, 0x0000F000, true},  // the hardware's registers
    {0x00300000, 0x1F900000, 0x00000800, true},  // the SPU2's, as far from the scratchpad as the console has them
};
static const Region VU1_REGIONS[] = {
    {0x00000000, 0x00000000, 0x00004000, false}, // the data memory
    {0x00004000, 0x00000000, 0x00004000, false}, // the micro memory, which holds the program and isn't read as data
};
static const uint32 EE_IMAGE = 0x02232000, IOP_IMAGE = 0x00300800, VU1_IMAGE = 0x00008000;

// The registers a call is given and leaves, as words, in this order.
struct EeRegisters {
  uint32 gpr[32][4];                 // r0 to r31, 128 bits each, the lowest word first
  uint32 hi[2], lo[2], hi1[2], lo1[2]; // hi and lo, and the upper halves MMI's own multiplies use
  uint32 sa;                         // the shift amount
  uint32 fpr[32], fpuAccumulator, fcsr;
  uint32 vf[32][4], acc[4], vi[16];  // vector unit 0's, as COP2 sees them
  uint32 q, i, p, r, status, mac, clip, divide;
};
struct IopRegisters {
  uint32 gpr[32], hi, lo;
};
struct VuRegisters {
  uint32 vf[32][4], acc[4], vi[16];
  uint32 q, i, p, r, status, mac, clip, divide;
  uint32 top, itop;                  // what the VIF says of the double buffer, read with XTOP and XITOP
};

static Kind kind;
static const Region *regions;
static size_t regionCount;
static uint32 imageSize;
static uint8 *base, *image;
static std::vector<uint8> dirty;
static jmp_buf out;
static uint32 ended, detail, steps, hardware, readCount;
static uint32 reads[MOST_READS][3];
static std::vector<uint8> readBefore;
static std::vector<uint32> readMarked;
static uint32 top, itop;
static std::vector<std::pair<uint32, std::vector<uint8>>> kicks;
static bool codeWritten;
static std::vector<uint8> codePages;
// the image's pages written since the last start kept, and those that aren't zeros as every call starts
static std::vector<uint8> pageWritten, pageHeld;
struct Start {
  uint32 address, number, steps;
  std::vector<uint32> registers;
  std::vector<std::pair<uint32, std::vector<uint8>>> pages;
};

[[noreturn]] static void stop(uint32 how, uint32 what) {
  ended = how;
  detail = what;
  longjmp(out, 1);
}

// Where an EE address is, as the console's wiring and the kernel's own TLB entries take it: in kernel mode,
// 0x80000000 and 0xA0000000 are the physical addresses, and in user mode the low half is, with the main memory again
// at 0x20100000 and 0x30100000 and the scratchpad at 0x70000000.
static uint32 eePhysical(uint32 address) {
  if(address >= 0x70000000u && address < 0x70004000u) return address;
  if(address >= 0x80000000u && address < 0xC0000000u) return address & 0x1FFFFFFFu;
  if(address < 0x20000000u) return address;
  if(address >= 0x20100000u && address < 0x22000000u) return address - 0x20000000u;
  if(address >= 0x30100000u && address < 0x32000000u) return address - 0x30000000u;
  stop(END_ELSEWHERE, address);
}

static uint32 iopPhysical(uint32 address) {
  if(address >= 0x80000000u && address < 0xC0000000u) address &= 0x1FFFFFFFu;
  if(address < 0x00800000u) return address & 0x001FFFFFu;
  if(address < 0x20000000u) return address;
  stop(END_ELSEWHERE, address);
}

// where an address of `bytes` bytes is in the image, or the end of the call
static uint32 place(uint32 address, uint32 bytes) {
  if(address & (bytes - 1)) stop(END_MISALIGNED, address);
  uint32 physical = kind == EE ? eePhysical(address) : kind == IOP ? iopPhysical(address) : address;
  for(size_t n = 0; n < regionCount; n++) {
    const Region &r = regions[n];
    if(physical >= r.address && physical - r.address < r.bytes) {
      if(r.hardware) hardware++;
      return r.at + physical - r.address;
    }
  }
  stop(END_ELSEWHERE, address);
}

static void wrote(uint32 at, uint32 bytes) {
  for(uint32 c = at / CHUNK; c <= (at + bytes - 1) / CHUNK; c++) dirty[c] = 1;
  pageWritten[at / PAGE] = pageWritten[(at + bytes - 1) / PAGE] = 1;
  if(!codePages.empty() && codePages[at >> 12]) codeWritten = true;
}

// the first time a call reads a place, what it read there, in whole words
static void noteRead(uint32 address, uint32 at, uint32 bytes) {
  for(uint32 i = 0; i < bytes; i += 4) {
    uint32 size = bytes < 4 ? bytes : 4, n = at + i;
    if(readBefore[n]) continue;
    for(uint32 k = 0; k < size; k++) readBefore[n + k] = 1;
    readMarked.push_back(n);
    if(readCount == MOST_READS) continue;
    uint32 value = 0;
    memcpy(&value, image + n, size);
    reads[readCount][0] = address + i;
    reads[readCount][1] = size;
    reads[readCount][2] = value;
    readCount++;
  }
}

static uint32 load(uint32 address, uint32 bytes) {
  uint32 at = place(address, bytes), value = 0;
  memcpy(&value, image + at, bytes);
  noteRead(address, at, bytes);
  return value;
}

static void store(uint32 address, uint32 bytes, uint32 value) {
  uint32 at = place(address, bytes);
  memcpy(image + at, &value, bytes);
  wrote(at, bytes);
}

// What the emulator's processors call for every access to memory that isn't their own (MemoryUtils.cpp's, which this
// file takes the place of), with the address as the processor sees it.
static void kick(uint32 address);
uint32 MemoryUtils_GetByteProxy(CMIPS *, uint32 address) { return load(address, 1); }
uint32 MemoryUtils_GetHalfProxy(CMIPS *, uint32 address) { return load(address, 2); }
uint32 MemoryUtils_GetWordProxy(CMIPS *, uint32 address) {
  if(kind == VU1) {
    // what the VIF says of the double buffer, the only words a microprogram reads outside its own memory
    if(address == 0x8400) return top;
    if(address == 0x8420) return itop;
    stop(END_ELSEWHERE, address);
  }
  return load(address, 4);
}
uint64 MemoryUtils_GetDoubleProxy(CMIPS *, uint32 address) {
  uint32 at = place(address, 8);
  uint64 value;
  memcpy(&value, image + at, 8);
  noteRead(address, at, 8);
  return value;
}
uint128 MemoryUtils_GetQuadProxy(CMIPS *, uint32 address) {
  // the quadword the address is in: the console leaves its low four bits out
  address &= ~0x0Fu;
  uint32 at = place(address, 16);
  uint128 value;
  memcpy(&value, image + at, 16);
  noteRead(address, at, 16);
  return value;
}
void MemoryUtils_SetByteProxy(CMIPS *, uint32 value, uint32 address) { store(address, 1, value); }
void MemoryUtils_SetHalfProxy(CMIPS *, uint32 value, uint32 address) { store(address, 2, value); }
void MemoryUtils_SetWordProxy(CMIPS *, uint32 value, uint32 address) {
  if(kind == VU1) {
    if(address == 0x8410) kick(value);
    else stop(END_ELSEWHERE, address);
    return;
  }
  store(address, 4, value);
}
void MemoryUtils_SetDoubleProxy(CMIPS *, uint64 value, uint32 address) {
  uint32 at = place(address, 8);
  memcpy(image + at, &value, 8);
  wrote(at, 8);
}
void MemoryUtils_SetQuadProxy(CMIPS *, const uint128 &value, uint32 address) {
  address &= ~0x0Fu;
  uint32 at = place(address, 16);
  memcpy(image + at, &value, 16);
  wrote(at, 16);
}

// A packet sent to the GS by XGKICK: from the quadword the address names, tag after tag, to the one that ends the
// packet, going round to the start of the data memory past its end, as Play!'s GIF reads it (Vpu.cpp, GIF.cpp).
static void kick(uint32 address) {
  uint32 at = (address & 0x3FF) * 16, from = at;
  std::vector<uint8> bytes;
  for(;;) {
    uint64 tag;
    memcpy(&tag, image + at, 8);
    uint32 loops = tag & 0x7FFF, registers = (tag >> 60) & 0xF, format = (tag >> 58) & 3;
    bool last = (tag >> 15) & 1;
    if(!registers) registers = 16;
    uint32 quadwords = 1 + (format == 0 ? loops * registers : format == 1 ? (loops * registers + 1) / 2 : loops);
    for(uint32 q = 0; q < quadwords; q++) {
      bytes.insert(bytes.end(), image + at, image + at + 16);
      at = (at + 16) & 0x3FFF;
    }
    if(last || bytes.size() >= 0x4000) break;
  }
  kicks.push_back({from, std::move(bytes)});
}

// The emulator's way of running a processor a block at a time, with each block made as the emulator makes it and then
// left unlinked from the next, so each comes back here and the check sees which ran and where each went.
template <typename Base>
class Stepper : public Base {
public:
  using Base::Base;
  // runs the block at `address` and gives where it began and ended
  std::pair<uint32, uint32> Run(uint32 address) {
    auto block = this->FindBlockStartingAt(address);
    if(block->IsEmpty()) {
      this->PartitionFunction(address);
      block = this->FindBlockStartingAt(address);
      this->OrphanBlock(block);
    }
    block->Execute();
    return {block->GetBeginAddress(), block->GetEndAddress()};
  }
};

// The EE's blocks, as the emulator makes them for a game with no settings of its own in its GameConfig.xml, which is
// every game as the tools run the emulator: it looks for that file in its resources folder, and the tools give it none.
class EeStepper : public Stepper<CGenericMipsExecutor<BlockLookupTwoWay>> {
public:
  EeStepper(CMIPS &context) : Stepper(context, 0x20000000, BLOCK_CATEGORY_PS2_EE) {}

protected:
  BasicBlockPtr BlockFactory(CMIPS &context, uint32 start, uint32 end) override {
    auto block = std::make_shared<CEeBasicBlock>(context, start, end, m_blockCategory);
    block->Compile();
    return block;
  }
};
using IopStepper = Stepper<CGenericMipsExecutor<BlockLookupOneWay>>;
using VuStepper = Stepper<CVuExecutor>;

static void readExactly(void *to, size_t size) {
  if(fread(to, 1, size, stdin) != size) exit(0);
}

static uint32 word() {
  uint32 value;
  readExactly(&value, 4);
  return value;
}

static void say(const void *from, size_t size) { fwrite(from, 1, size, stdout); }
static void sayWord(uint32 value) { say(&value, 4); }

// a branch's or a jump's way on: its target, or MIPS_INVALID_PC when it goes through a register
static uint32 targetOf(CMIPS &cpu, uint32 address) {
  uint32 opcode = cpu.m_pMemoryMap->GetInstruction(address);
  if(cpu.m_pArch->IsInstructionBranch(&cpu, address, opcode) != MIPS_BRANCH_NORMAL) return MIPS_INVALID_PC;
  return cpu.m_pArch->GetInstructionEffectiveAddress(&cpu, address, opcode);
}

static void setVu(CMIPS &cpu, const uint32 (*vf)[4], const uint32 *acc, const uint32 *vi, const uint32 *rest) {
  memcpy(cpu.m_State.nCOP2, vf, 32 * 16);
  cpu.m_State.nCOP2[0].nV0 = cpu.m_State.nCOP2[0].nV1 = cpu.m_State.nCOP2[0].nV2 = 0;
  cpu.m_State.nCOP2[0].nV3 = 0x3F800000;
  memcpy(&cpu.m_State.nCOP2A, acc, 16);
  for(int n = 0; n < 16; n++) cpu.m_State.nCOP2VI[n] = n ? vi[n] & 0xFFFF : 0;
  cpu.m_State.nCOP2Q = cpu.m_State.pipeQ.heldValue = rest[0];
  cpu.m_State.pipeQ.counter = 0;
  cpu.m_State.nCOP2I = rest[1];
  cpu.m_State.nCOP2P = cpu.m_State.pipeP.heldValue = rest[2];
  cpu.m_State.pipeP.counter = 0;
  cpu.m_State.nCOP2R = rest[3];
  VUShared::ResetFlagPipelineImmediate(VUShared::g_pipeInfoSticky, &cpu, rest[4]);
  VUShared::ResetFlagPipelineImmediate(VUShared::g_pipeInfoMac, &cpu, rest[5]);
  VUShared::ResetFlagPipelineImmediate(VUShared::g_pipeInfoClip, &cpu, rest[6]);
  cpu.m_State.nCOP2DF = rest[7];
}

static void getVu(CMIPS &cpu, uint32 (*vf)[4], uint32 *acc, uint32 *vi, uint32 *rest) {
  memcpy(vf, cpu.m_State.nCOP2, 32 * 16);
  memcpy(acc, &cpu.m_State.nCOP2A, 16);
  for(int n = 0; n < 16; n++) vi[n] = cpu.m_State.nCOP2VI[n];
  rest[0] = cpu.m_State.nCOP2Q;
  rest[1] = cpu.m_State.nCOP2I;
  rest[2] = cpu.m_State.nCOP2P;
  rest[3] = cpu.m_State.nCOP2R;
  rest[4] = cpu.m_State.nCOP2SF;
  rest[5] = cpu.m_State.nCOP2MF;
  rest[6] = cpu.m_State.nCOP2CF;
  rest[7] = cpu.m_State.nCOP2DF;
}

int main(int argc, char **argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  if(argc != 2 || (strcmp(argv[1], "ee") && strcmp(argv[1], "iop") && strcmp(argv[1], "vu1"))) {
    fprintf(stderr, "Name the processor: ee, iop or vu1.\n");
    return 2;
  }
  kind = !strcmp(argv[1], "ee") ? EE : !strcmp(argv[1], "iop") ? IOP : VU1;
  regions = kind == EE ? EE_REGIONS : kind == IOP ? IOP_REGIONS : VU1_REGIONS;
  regionCount = kind == EE ? std::size(EE_REGIONS) : kind == IOP ? std::size(IOP_REGIONS) : std::size(VU1_REGIONS);
  imageSize = kind == EE ? EE_IMAGE : kind == IOP ? IOP_IMAGE : VU1_IMAGE;
  const uint32 registerWords = (kind == EE ? sizeof(EeRegisters) : kind == IOP ? sizeof(IopRegisters) : sizeof(VuRegisters)) / 4;
  base = static_cast<uint8 *>(calloc(imageSize, 1));
  image = static_cast<uint8 *>(aligned_alloc(16, imageSize));
  dirty.assign(imageSize / CHUNK + 1, 0);
  readBefore.assign(imageSize + 16, 0);
  codePages.assign(imageSize / 0x1000 + 1, 0);
  pageWritten.assign(imageSize / PAGE + 1, 0);
  pageHeld.assign(imageSize / PAGE + 1, 0);

  // the emulator's processor thread runs with floats cut towards zero and those below normal taken as zero
  fesetround(FE_TOWARDZERO);
  FpUtils::SetDenormalHandlingMode();

  // The EE and the IOP look a page of memory up before some of their loads and stores, as the emulator gives them a
  // table of pages; this one has none in it, so every access comes to the functions above.
  auto cpu = std::make_unique<CMIPS>(MEMORYMAP_ENDIAN_LSBF, kind != VU1);
  CMA_EE eeArch;
  CMA_MIPSIV iopArch(MIPS_REGSIZE_32);
  CMA_VU vuArch(0x3FFF);
  CCOP_SCU scu(kind == EE ? MIPS_REGSIZE_64 : MIPS_REGSIZE_32);
  CCOP_FPU fpu(MIPS_REGSIZE_64);
  CCOP_VU cop2(MIPS_REGSIZE_64);
  cpu->m_pAddrTranslator = CMIPS::TranslateAddress64;
  if(kind == EE) {
    cpu->m_pArch = &eeArch;
    cpu->m_pCOP[0] = &scu;
    cpu->m_pCOP[1] = &fpu;
    cpu->m_pCOP[2] = &cop2;
    cpu->m_pMemoryMap->InsertInstructionMap(0x00000000, 0x01FFFFFF, image, 0);
    cpu->m_vuMem = image + 0x02224000;
    cpu->m_executor = std::make_unique<EeStepper>(*cpu);
  } else if(kind == IOP) {
    cpu->m_pArch = &iopArch;
    cpu->m_pCOP[0] = &scu;
    for(uint32 mirror = 0; mirror < 4; mirror++) cpu->m_pMemoryMap->InsertInstructionMap(mirror * 0x200000, mirror * 0x200000 + 0x1FFFFF, image, mirror);
    cpu->m_executor = std::make_unique<IopStepper>(*cpu, 0x00800000, BLOCK_CATEGORY_PS2_IOP);
  } else {
    cpu->m_pArch = &vuArch;
    cpu->m_pMemoryMap->InsertInstructionMap(0x0000, 0x3FFF, image + 0x4000, 0);
    cpu->m_vuMem = image;
    cpu->m_executor = std::make_unique<VuStepper>(*cpu, 0x4000);
  }

  std::vector<uint32> given(registerWords), left(registerWords);
  for(;;) {
    int command = getchar();
    if(command == EOF || command == 'Q') return 0;
    if(command == 'I') {
      readExactly(base, imageSize);
      memcpy(image, base, imageSize);
      for(uint32 page = 0; page < imageSize / PAGE; page++) {
        pageHeld[page] = 0;
        for(uint32 n = 0; n < PAGE && !pageHeld[page]; n += 8) pageHeld[page] = *reinterpret_cast<const uint64 *>(base + page * PAGE + n) != 0;
      }
      cpu->m_executor->Reset();
      std::fill(codePages.begin(), codePages.end(), 0);
      putchar('k');
      fflush(stdout);
      continue;
    }
    if(command != 'C') {
      fprintf(stderr, "Unknown command %d.\n", command);
      return 1;
    }
    uint32 start = word(), span = word(), limit = word();
    readExactly(given.data(), registerWords * 4);
    uint32 count = word();
    std::vector<uint32> changes(count * 3);
    if(count) readExactly(changes.data(), count * 12);
    std::vector<uint32> watch(word());
    if(!watch.empty()) readExactly(watch.data(), watch.size() * 4);
    std::vector<Start> starts;
    std::vector<std::pair<uint32, uint32>> started;
    std::fill(pageWritten.begin(), pageWritten.end(), 0);
    // how long an instruction is: two words of a pair on a vector unit
    static uint32 unit;
    unit = kind == VU1 ? 8 : 4;
    std::vector<uint8> ran(span / unit, 0);

    ended = END_BACK;
    detail = steps = hardware = readCount = 0;
    for(uint32 n : readMarked) memset(&readBefore[n], 0, 4);
    readMarked.clear();
    kicks.clear();
    if(codeWritten) {
      cpu->m_executor->Reset();
      std::fill(codePages.begin(), codePages.end(), 0);
      codeWritten = false;
    }
    cpu->Reset();
    uint32 flags = 0;
    // the changes, as a store of the caller's would make them, outside the call
    for(uint32 n = 0; n < count; n++) {
      uint32 address = changes[n * 3], bytes = changes[n * 3 + 1], value = changes[n * 3 + 2];
      if(!setjmp(out)) {
        uint32 at = place(address, bytes);
        memcpy(image + at, &value, bytes);
        wrote(at, bytes);
      }
    }
    hardware = 0;
    uint32 back = 0;
    if(kind == EE) {
      auto *r = reinterpret_cast<const EeRegisters *>(given.data());
      memcpy(cpu->m_State.nGPR, r->gpr, sizeof r->gpr);
      memset(&cpu->m_State.nGPR[0], 0, 16);
      memcpy(cpu->m_State.nHI, r->hi, 8);
      memcpy(cpu->m_State.nLO, r->lo, 8);
      memcpy(cpu->m_State.nHI1, r->hi1, 8);
      memcpy(cpu->m_State.nLO1, r->lo1, 8);
      cpu->m_State.nSA = r->sa;
      memcpy(cpu->m_State.nCOP1, r->fpr, sizeof r->fpr);
      cpu->m_State.nCOP1A = r->fpuAccumulator;
      cpu->m_State.nFCSR = r->fcsr;
      setVu(*cpu, r->vf, r->acc, r->vi, &r->q);
      back = r->gpr[31][0];
    } else if(kind == IOP) {
      auto *r = reinterpret_cast<const IopRegisters *>(given.data());
      for(int n = 1; n < 32; n++) cpu->m_State.nGPR[n].nV0 = r->gpr[n];
      cpu->m_State.nHI[0] = r->hi;
      cpu->m_State.nLO[0] = r->lo;
      back = r->gpr[31];
    } else {
      auto *r = reinterpret_cast<const VuRegisters *>(given.data());
      setVu(*cpu, r->vf, r->acc, r->vi, &r->q);
      top = r->top;
      itop = r->itop;
      cpu->m_State.pipeTime = 0;
      cpu->m_State.savedNextBlockIntRegIdx = 0;
    }
    cpu->m_State.nPC = start;

    // the registers as the processor holds them, as the words a call is given them in
    auto held = [&](std::vector<uint32> &words) {
      if(kind == EE) {
        auto *r = reinterpret_cast<EeRegisters *>(words.data());
        memcpy(r->gpr, cpu->m_State.nGPR, sizeof r->gpr);
        memcpy(r->hi, cpu->m_State.nHI, 8);
        memcpy(r->lo, cpu->m_State.nLO, 8);
        memcpy(r->hi1, cpu->m_State.nHI1, 8);
        memcpy(r->lo1, cpu->m_State.nLO1, 8);
        r->sa = cpu->m_State.nSA;
        memcpy(r->fpr, cpu->m_State.nCOP1, sizeof r->fpr);
        r->fpuAccumulator = cpu->m_State.nCOP1A;
        r->fcsr = cpu->m_State.nFCSR;
        getVu(*cpu, r->vf, r->acc, r->vi, &r->q);
      } else if(kind == IOP) {
        auto *r = reinterpret_cast<IopRegisters *>(words.data());
        for(int n = 0; n < 32; n++) r->gpr[n] = cpu->m_State.nGPR[n].nV0;
        r->hi = cpu->m_State.nHI[0];
        r->lo = cpu->m_State.nLO[0];
      } else {
        auto *r = reinterpret_cast<VuRegisters *>(words.data());
        getVu(*cpu, r->vf, r->acc, r->vi, &r->q);
        r->top = top;
        r->itop = itop;
      }
    };
    // a start watched for: its registers, and the pages written since the one before, or every page that holds
    // anything for the first
    auto keepStart = [&](uint32 address, uint32 number) {
      Start kept{address, number, steps, std::vector<uint32>(registerWords), {}};
      held(kept.registers);
      // what the processor writes of a unit's data memory goes straight there, so its pages are looked at
      uint32 own = kind == EE ? 0x02224000 : 0, ownSize = kind == EE ? 0x1000 : kind == VU1 ? 0x4000 : 0;
      for(uint32 at = own; at < own + ownSize; at += PAGE) if(memcmp(image + at, base + at, PAGE)) pageWritten[at / PAGE] = 1;
      for(uint32 page = 0; page < imageSize / PAGE; page++) {
        if(!(pageWritten[page] || (starts.empty() && pageHeld[page]))) continue;
        kept.pages.push_back({page, std::vector<uint8>(image + page * PAGE, image + (page + 1) * PAGE)});
        pageWritten[page] = 0;
      }
      starts.push_back(std::move(kept));
    };

    if(!setjmp(out)) {
      for(;;) {
        uint32 pc = cpu->m_State.nPC;
        if(kind != VU1 && pc == back) break;
        for(uint32 address : watch) {
          if(address != pc) continue;
          auto found = std::find_if(started.begin(), started.end(), [&](const auto &each) { return each.first == pc; });
          if(found == started.end()) found = started.insert(started.end(), {pc, 0});
          uint32 number = ++found->second, power = number;
          while(power % 3 == 0) power /= 3;
          if(power == 1) keepStart(pc, number);
          break;
        }
        if(steps >= limit) stop(END_STEPS, 0);
        // the code it can run: the console's memory above the kernel's, or the IOP's, or the unit's micro memory
        if(kind == EE && (pc < 0x00080000u || pc >= 0x02000000u)) stop(pc < 0x00080000u ? END_KERNEL : END_ELSEWHERE, pc);
        if(kind == IOP && pc >= 0x00800000u) stop(END_ELSEWHERE, pc);
        if(kind == VU1 && pc >= 0x4000u) stop(END_ELSEWHERE, pc);
        // a block's quota runs out after one pass, so a block that branches back to its own start, which the emulator
        // runs again inside itself while it has quota left, comes back here each time round as well; what it does is
        // the same either way, as nothing of a block's own start keeps anything
        cpu->m_State.cycleQuota = 1;
        std::pair<uint32, uint32> block;
        if(kind == EE) block = static_cast<EeStepper *>(cpu->m_executor.get())->Run(pc);
        else if(kind == IOP) block = static_cast<IopStepper *>(cpu->m_executor.get())->Run(pc);
        else block = static_cast<VuStepper *>(cpu->m_executor.get())->Run(pc);
        auto [begin, end] = block;
        for(uint32 page = (begin & 0x1FFFFFFFu) >> 12; page <= (end & 0x1FFFFFFFu) >> 12 && page < codePages.size(); page++) codePages[page] = 1;
        steps += (end - begin) / unit + 1;
        uint32 next = cpu->m_State.nPC;
        // what of the function's own code ran, and where its branch went
        for(uint32 address = begin; address <= end; address += unit) {
          if(address >= start && address - start < span) ran[(address - start) / unit] |= 1;
        }
        // the block's branch: the last instruction but its delay slot, or the last when the emulator left a branch in a
        // delay slot to the next block
        auto isBranch = [&](uint32 address) {
          return address >= begin && cpu->m_pArch->IsInstructionBranch(cpu.get(), address, cpu->m_pMemoryMap->GetInstruction(address)) == MIPS_BRANCH_NORMAL;
        };
        uint32 branch = MIPS_INVALID_PC, onward = 0;
        if(kind == VU1) {
          if(end >= begin + 12 && isBranch(end - 12)) branch = end - 12, onward = end + 4;
        } else if(end >= begin + 4 && isBranch(end - 4)) {
          branch = end - 4, onward = end + 4;
        } else if(isBranch(end)) {
          branch = end, onward = end + 4;
        }
        if(branch != MIPS_INVALID_PC && branch >= start && branch - start < span) {
          uint32 target = targetOf(*cpu, branch);
          if(target != MIPS_INVALID_PC) {
            if(next == target) ran[(branch - start) / unit] |= 2;
            if(next == onward) ran[(branch - start) / unit] |= 4;
            // a likely branch that didn't go doesn't run the instruction after it
            if(kind == EE && next != target && branch == end - 4) {
              uint32 opcode = cpu->m_pMemoryMap->GetInstruction(branch), op = opcode >> 26, rt = (opcode >> 16) & 0x1F, rs = (opcode >> 21) & 0x1F;
              bool likely = (op >= 0x14 && op <= 0x17) || (op == 1 && (rt == 2 || rt == 3 || rt == 0x12 || rt == 0x13)) || ((op >= 0x10 && op <= 0x12) && rs == 8 && (rt & 2));
              if(likely && end - start < span) ran[(end - start) / unit] &= ~1;
            }
          }
        }
        if(codeWritten) {
          cpu->m_executor->Reset();
          std::fill(codePages.begin(), codePages.end(), 0);
          codeWritten = false;
        }
        uint32 exception = cpu->m_State.nHasException & ~MIPS_EXCEPTION_STATUS_QUOTADONE;
        cpu->m_State.nHasException = 0;
        if(exception == MIPS_EXCEPTION_NONE || exception == MIPS_EXCEPTION_IDLE || exception == MIPS_EXCEPTION_CHECKPENDINGINT) continue;
        if(kind == VU1 && exception == MIPS_EXCEPTION_VU_EBIT) break;
        // the T and D bits stop a unit only when the EE asks for it, which nothing does here
        if(kind == VU1 && (exception == MIPS_EXCEPTION_VU_TBIT || exception == MIPS_EXCEPTION_VU_DBIT)) continue;
        if(exception == MIPS_EXCEPTION_SYSCALL) stop(END_SYSCALL, cpu->m_State.nGPR[3].nV0);
        if(exception == MIPS_EXCEPTION_VU_CALLMS) stop(END_VU, cpu->m_State.callMsAddr);
        stop(END_EXCEPTION, exception);
      }
    }
    if(kind == EE || kind == VU1) {
      // what the processor wrote in a unit's data memory without asking for it, as its own memory
      uint32 from = kind == EE ? 0x02224000 : 0, size = kind == EE ? 0x1000 : 0x4000;
      for(uint32 c = 0; c < size / CHUNK; c++) {
        if(memcmp(image + from + c * CHUNK, base + from + c * CHUNK, CHUNK)) dirty[(from + c * CHUNK) / CHUNK] = 1;
      }
    }

    held(left);
    if(kind == EE) {
      auto *r = reinterpret_cast<const EeRegisters *>(left.data());
      auto *was = reinterpret_cast<const EeRegisters *>(given.data());
      bool integers = false;
      for(int n = 1; n < 16; n++) integers |= (r->vi[n] & 0xFFFF) != (was->vi[n] & 0xFFFF);
      if(integers || memcmp(r->vf[1], was->vf[1], 31 * 16) || memcmp(r->acc, was->acc, 16) || r->q != was->q || r->i != was->i || r->p != was->p || r->r != was->r) flags |= 1;
    }

    uint32 header[6] = {ended, detail, cpu->m_State.nPC, steps, hardware, flags};
    say(header, sizeof header);
    say(left.data(), registerWords * 4);
    say(ran.data(), ran.size());
    sayWord(readCount);
    say(reads, readCount * 12);
    uint32 chunks = 0;
    for(size_t c = 0; c < dirty.size(); c++) chunks += dirty[c];
    sayWord(chunks);
    for(uint32 c = 0; c < dirty.size(); c++) {
      if(!dirty[c]) continue;
      sayWord(c);
      say(image + c * CHUNK, CHUNK);
      memcpy(image + c * CHUNK, base + c * CHUNK, std::min<uint32>(CHUNK, imageSize - c * CHUNK));
      dirty[c] = 0;
    }
    sayWord(static_cast<uint32>(kicks.size()));
    for(const auto &[from, bytes] : kicks) {
      sayWord(from);
      sayWord(static_cast<uint32>(bytes.size()));
      say(bytes.data(), bytes.size());
    }
    sayWord(static_cast<uint32>(starts.size()));
    for(const auto &kept : starts) {
      sayWord(kept.address);
      sayWord(kept.number);
      sayWord(kept.steps);
      say(kept.registers.data(), registerWords * 4);
      sayWord(static_cast<uint32>(kept.pages.size()));
      for(const auto &[page, bytes] : kept.pages) {
        sayWord(page);
        say(bytes.data(), PAGE);
      }
    }
    fflush(stdout);
  }
}
