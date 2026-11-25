// The original's side of the Nintendo DS's function check: one function of a game's code, run in melonDS's own
// processors. The build is melonDS's own, from the source the proof tools fetch for the reference emulator at the
// commit tools/consoles.mjs fixes, with this file beside it (original.mjs). A function of the ARM9's program or of one
// of its overlays runs in melonDS's ARM946E-S, and one of the ARM7's in its ARM7TDMI, in ARM or in Thumb code: the
// classes ARMv5 and ARMv4, their own loop, Execute, and every instruction as melonDS's interpreter has it. So the
// reference is the processors that the proof's own emulator runs every game on.
//
// What a processor sees here is the console's main memory and nothing else: its 4 MB at 0x02000000, seen again every
// 4 MB up to 0x02FFFFFF, read and written through melonDS's own console. The ARM9's two fast memories are off, as they
// are before a game turns them on, and its protection unit with them. A function that reads or writes anywhere else,
// the fast memories' places, the memory the two processors share at 0x03000000, the ARM7's own, the hardware's
// registers, the video memory or the BIOS, stops there, and so does one that runs anywhere else, as one that calls the
// BIOS does, or that uses the system control coprocessor.
//
// A processor is stopped before each instruction by the one change the tools' patch makes to melonDS's loop
// (../libretro/melonds.patch, DreamportsStep), which is where what ran is noted and where a call ends.
//
// It's kept running and told what to do on its standard input, in little-endian words, and answers on its standard
// output:
//
//   'I' image      the memory every call starts from: 4 MB, the console's main memory. Answers 'k'.
//   'C' call       runs a function from that memory with some of it changed: the function's address, how many bytes
//                  long it is, how many instructions it may run, its kind, 1 for Thumb code with 2 added for the
//                  ARM7's, r0 to r14, the flags, and the changes, a count and then each one's address, bytes (1, 2 or
//                  4) and value. A call ends when the processor comes back to where r14 pointed as it started.
//                  Answers how it ended, the words below, and then the memory every call starts from is as it was.
//   'Q'            ends the program.
//
// What a call answers, in words but for the bytes of what ran and of the memory:
//   end        0 came back, 1 ran out of instructions, 2 ran where the check can't follow, 3 read or wrote where the
//              check has no memory, 4 used a coprocessor
//   detail     the address it went to, or read or wrote
//   pc         where it was when it ended
//   steps      how many instructions it ran
//   status     1 when it left the processor's mode or its interrupt bits other than they were
//   17 words   r0 to r15 as it left them, and the status register
//   span / 2   one byte for each two bytes of the function: 1 when an instruction there ran, 2 when its condition
//   bytes      held, which for a branch is when it went to its target, and 4 when it didn't, for a Thumb conditional
//              branch and for every ARM instruction with a condition
//   reads      a count, then each place it read, the first time: address, bytes and the value it read. The bytes have
//              0x100 added when the instruction read from beside itself, by its own address, as a value kept after a
//              function's code is read
//   chunks     a count, then each 256 bytes of the image it wrote: where they are, in 256s, and the bytes as it left
//              them
//
// This file is built into melonDS on the contributor's computer and is never published as a program. melonDS is under
// the GNU General Public License, version 3 or later, and so is what's built from it.

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <optional>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "ARM.h"
#include "Args.h"
#include "NDS.h"
#include "Platform.h"

using namespace melonDS;

#include "computer.h"

namespace melonDS { extern bool (*DreamportsStep)(u32 processor); }

enum { RAM = 0x400000, CHUNK = 256, CHUNKS = RAM / CHUNK, MOST_READS = 1024 };
enum { RUNNING = -1, END_BACK, END_STEPS, END_ELSEWHERE, END_MEMORY, END_COPROCESSOR };
// the mode a game's code runs in, system, with interrupts as the call was given them: on
static const u32 MODE = 0x1F, KEPT_STATUS = 0xDF;

static std::unique_ptr<NDS> console;
static std::vector<u8> base(RAM);
static u8 dirty[CHUNKS];
static std::vector<u32> touched;

// the call being run
static ARM* cpu;
static int ended;
static u32 detail, steps, limit, start, span, back, stopped_at;
static std::vector<u8> ran;
static bool in_data;
static u32 reads[MOST_READS][3], read_count;

static bool in_memory(u32 address) { return address >> 24 == 0x02; }
static u32 current(void) { return cpu->R[15] - (cpu->CPSR & 0x20 ? 2 : 4); }

static void mark(u32 address) {
	u32 chunk = (address & (RAM - 1)) / CHUNK;
	if (!dirty[chunk]) {
		dirty[chunk] = 1;
		touched.push_back(chunk);
	}
}

// a read or a write the check has no memory for ends the call: the instruction it's in is let finish, with nothing
// read and nothing written, and the processor is stopped before the next
static bool there(u32 address) {
	if (in_memory(address)) return true;
	if (in_data && ended == RUNNING) {
		ended = END_MEMORY;
		detail = address;
		stopped_at = cpu->R[15] - (cpu->CPSR & 0x20 ? 4 : 8);
	}
	return false;
}

// the places a call read already, by address and size, kept as a small open table so a loop that reads a lot doesn't
// look through every one each time
enum { SEEN = 4 * MOST_READS };
static u32 seen_key[SEEN];
static u8 seen_used[SEEN];

static bool seen_before(u32 address, u32 bytes) {
	u32 key = address ^ bytes << 30, at = (key * 2654435761u) >> 20 & (SEEN - 1);
	while (seen_used[at]) {
		if (seen_key[at] == key) return true;
		at = (at + 1) & (SEEN - 1);
	}
	seen_used[at] = 1;
	seen_key[at] = key;
	return false;
}

// whether the instruction being run reads from beside itself: Thumb's ldr from pc, and ARM's loads whose base is pc
static bool beside(void) {
	u32 code = cpu->CurInstr;
	if (cpu->CPSR & 0x20) return (code & 0xF800) == 0x4800;
	return (code >> 16 & 15) == 15 && ((code & 0x0C000000) == 0x04000000 || (code & 0x0E000090) == 0x00000090);
}

static void note(u32 address, u32 bytes, u32 value) {
	if (ended != RUNNING || !in_memory(address)) return;
	address = 0x02000000 | (address & (RAM - 1));
	if (read_count >= MOST_READS || seen_before(address, bytes)) return;
	reads[read_count][0] = address;
	reads[read_count][1] = bytes | (beside() ? 0x100 : 0);
	reads[read_count++][2] = value;
}

// A processor of melonDS's with the two things the check asks of it: each read of data is noted, and what it reads
// and writes is the console's main memory, through melonDS's own console, or the end of the call. Everything else,
// the loop, the instructions, the pipeline and the exceptions, is the class's own.
template <class Processor>
struct Watched : Processor {
	Watched(NDS& nds) : Processor(nds, std::nullopt, false) {}

	void DataRead8(u32 addr, u32* val) override { in_data = true; *val = 0; Processor::DataRead8(addr, val); in_data = false; note(addr, 1, *val); }
	void DataRead16(u32 addr, u32* val) override { in_data = true; *val = 0; Processor::DataRead16(addr, val); in_data = false; note(addr & ~1u, 2, *val); }
	void DataRead32(u32 addr, u32* val) override { in_data = true; *val = 0; Processor::DataRead32(addr, val); in_data = false; note(addr & ~3u, 4, *val); }
	void DataRead32S(u32 addr, u32* val) override { in_data = true; *val = 0; Processor::DataRead32S(addr, val); in_data = false; note(addr & ~3u, 4, *val); }
	void DataWrite8(u32 addr, u8 val) override { in_data = true; Processor::DataWrite8(addr, val); in_data = false; }
	void DataWrite16(u32 addr, u16 val) override { in_data = true; Processor::DataWrite16(addr, val); in_data = false; }
	void DataWrite32(u32 addr, u32 val) override { in_data = true; Processor::DataWrite32(addr, val); in_data = false; }
	void DataWrite32S(u32 addr, u32 val) override { in_data = true; Processor::DataWrite32S(addr, val); in_data = false; }

protected:
	u8 BusRead8(u32 addr) override { return there(addr) ? Processor::BusRead8(addr) : 0; }
	u16 BusRead16(u32 addr) override { return there(addr) ? Processor::BusRead16(addr) : 0; }
	u32 BusRead32(u32 addr) override { return there(addr) ? Processor::BusRead32(addr) : 0; }
	void BusWrite8(u32 addr, u8 val) override { if (there(addr)) { mark(addr); Processor::BusWrite8(addr, val); } }
	void BusWrite16(u32 addr, u16 val) override { if (there(addr)) { mark(addr); Processor::BusWrite16(addr, val); } }
	void BusWrite32(u32 addr, u32 val) override { if (there(addr)) { mark(addr); Processor::BusWrite32(addr, val); } }
};

static Watched<ARMv5>* arm9;
static Watched<ARMv4>* arm7;

static void end(int how, u32 what, u32 pc) {
	ended = how;
	detail = what;
	stopped_at = pc;
}

// Before each instruction melonDS's loop runs: where a call stops that's back, has run too long, or runs outside the
// console's main memory, and where what runs of the function is noted, with whether its condition holds, by the
// processor's own word on it.
static bool step(u32) {
	if (ended != RUNNING) return true;
	bool thumb = cpu->CPSR & 0x20;
	u32 pc = current();
	if (pc == back) { end(END_BACK, 0, pc); return true; }
	if (!in_memory(pc)) { end(END_ELSEWHERE, pc, pc); return true; }
	if (steps >= limit) { end(END_STEPS, 0, pc); return true; }
	u32 code = thumb ? cpu->NextInstr[0] & 0xFFFF : cpu->NextInstr[0];
	u32 condition = thumb ? ((code & 0xF000) == 0xD000 ? code >> 8 & 15 : 0xE) : code >> 28;
	bool holds = condition >= 0xE || cpu->CheckCondition(condition);
	if (!thumb && holds && condition != 0xF && ((code & 0x0E000000) == 0x0C000000 || (code & 0x0F000000) == 0x0E000000)) {
		end(END_COPROCESSOR, pc, pc);
		return true;
	}
	steps++;
	u32 offset = (0x02000000 | (pc & (RAM - 1))) - start;
	if (offset < span) {
		ran[offset / 2] |= 1;
		if (condition < 0xE) ran[offset / 2] |= holds ? 2 : 4;
	}
	return false;
}

static bool take(void* to, size_t bytes) { return fread(to, 1, bytes, stdin) == bytes; }
static u32 word(void) {
	u8 b[4];
	if (!take(b, 4)) exit(0);
	return b[0] | b[1] << 8 | (u32) b[2] << 16 | (u32) b[3] << 24;
}
static void say(u32 value) {
	u8 b[4] = { (u8) value, (u8) (value >> 8), (u8) (value >> 16), (u8) (value >> 24) };
	fwrite(b, 1, 4, stdout);
}

static void call(void) {
	start = word();
	span = word();
	limit = word();
	u32 kind = word();
	u32 registers[16];
	for (int i = 0; i < 16; i++) registers[i] = word();
	// the memory as every call starts from it, where the last one left it otherwise
	for (u32 chunk : touched) {
		memcpy(console->MainRAM + chunk * CHUNK, base.data() + chunk * CHUNK, CHUNK);
		dirty[chunk] = 0;
	}
	touched.clear();
	u32 changes = word();
	for (u32 i = 0; i < changes; i++) {
		u32 address = word(), bytes = word(), value = word();
		if (!in_memory(address)) continue;
		for (u32 n = 0; n < bytes; n++) {
			mark(address + n);
			console->MainRAM[(address + n) & (RAM - 1)] = (u8) (value >> (8 * n));
		}
	}
	// what the changes wrote is part of what the call starts from, not of what it left, though it's put back after
	std::vector<u32> changed = touched;
	for (u32 chunk : touched) dirty[chunk] = 0;
	touched.clear();

	bool seven = kind & 2;
	cpu = seven ? (ARM*) arm7 : (ARM*) arm9;
	ended = RUNNING;
	detail = steps = stopped_at = 0;
	in_data = false;
	read_count = 0;
	memset(seen_used, 0, sizeof seen_used);
	ran.assign(span / 2 + 1, 0);
	back = registers[14] & ~1u;

	// the processor as the console starts it, then in the mode a game's code runs in, with the registers given
	cpu->Reset();
	u32 before = cpu->CPSR;
	cpu->CPSR = (registers[15] & 0xF0000000) | MODE;
	cpu->UpdateMode(before, cpu->CPSR);
	for (int i = 0; i < 15; i++) cpu->R[i] = registers[i];
	cpu->JumpTo(start | (kind & 1));
	cpu->Cycles = 0;
	u32 status = cpu->CPSR & KEPT_STATUS;

	DreamportsStep = step;
	for (int turn = 0; ended == RUNNING; turn++) {
		if (seven) {
			console->ARM7Timestamp = 0;
			console->ARM7Target = UINT64_MAX / 2;
			arm7->Execute<CPUExecuteMode::Interpreter>();
		} else {
			console->ARM9Timestamp = 0;
			console->ARM9Target = UINT64_MAX / 2;
			arm9->Execute<CPUExecuteMode::Interpreter>();
		}
		// a processor that left its loop without being stopped has halted, which nothing here wakes
		if (ended == RUNNING && turn) end(END_ELSEWHERE, current(), current());
	}
	DreamportsStep = nullptr;

	say((u32) ended);
	say(detail);
	say(stopped_at);
	say(steps);
	say((cpu->CPSR & KEPT_STATUS) != status ? 1 : 0);
	for (int i = 0; i < 16; i++) say(cpu->R[i]);
	say(cpu->CPSR);
	fwrite(ran.data(), 1, span / 2, stdout);
	say(read_count);
	for (u32 i = 0; i < read_count; i++) for (int j = 0; j < 3; j++) say(reads[i][j]);
	say((u32) touched.size());
	for (u32 chunk : touched) {
		say(chunk);
		fwrite(console->MainRAM + chunk * CHUNK, 1, CHUNK, stdout);
	}
	fflush(stdout);
	// and what was changed for this call is put back before the next too
	for (u32 chunk : changed) mark(chunk * CHUNK);
}

int main(void) {
#ifdef _WIN32
	_setmode(_fileno(stdin), _O_BINARY);
	_setmode(_fileno(stdout), _O_BINARY);
#endif
	// the console as the reference emulator makes it (melonds/libretro.cpp): the interpreter, with melonDS's free BIOS
	NDSArgs args;
	args.JIT = std::nullopt;
	console = std::make_unique<NDS>(std::move(args), nullptr);
	console->Reset();
	if (console->MainRAMMask != RAM - 1) {
		fprintf(stderr, "the console's main memory isn't 4 MB\n");
		return 1;
	}
	// its two processors again, as the check watches them, on the same console: each as it is after the console's
	// reset, the ARM9 with its fast memories and its protection unit off
	arm9 = new Watched<ARMv5>(*console);
	arm7 = new Watched<ARMv4>(*console);
	cpu = arm9;
	ended = END_BACK;
	arm9->CP15Reset();
	arm9->Reset();
	cpu = arm7;
	arm7->Reset();
	memcpy(base.data(), console->MainRAM, RAM);
	for (;;) {
		int command = getchar();
		if (command == EOF || command == 'Q') return 0;
		if (command == 'I') {
			if (!take(base.data(), RAM)) return 1;
			memcpy(console->MainRAM, base.data(), RAM);
			memset(dirty, 0, sizeof dirty);
			touched.clear();
			putchar('k');
			fflush(stdout);
		} else if (command == 'C') {
			call();
		} else {
			fprintf(stderr, "unknown command %d\n", command);
			return 1;
		}
	}
}
