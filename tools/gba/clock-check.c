// Runs a cartridge in the reference emulator and the GBA kit's clock beside it (kit/gba/c/clock.c), an instruction at
// a time, as `prove` plays a frame: the events due, then one instruction. For each instruction outside the BIOS the
// clock is told what ran, as a game's C tells it, through gba_clock_run, and the time it says the instruction started
// at is compared with the emulator's. A swi goes to gba_clock_swi, which times the BIOS's own code itself. Each frame's
// end is compared too: the instruction, or the BIOS's step, it ended after, by when that started.
//
// clock-check CARTRIDGE FRAMES
//
// It stops at the program's first wait for an interrupt, or once interrupts are on, where the clock's part ends. It
// prints a line per frame, as JSON, with what the emulator's frame ended after, and one at the end: how many
// instructions were compared, how many differed, and the first that did. It exits with 1 when anything differed
// (tools/test/clock.mjs).

#include <mgba/core/core.h>
#include <mgba/gba/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/arm/arm.h>
#include <stdio.h>
#include <stdlib.h>
#include "on-windows.h"
#include "clock.h"

const uint8_t *kit_copy;
uint32_t kit_copy_size;

static struct mCore* core;
static struct GBA* gba;
static struct ARMMemory memory;

// the code the clock reads: the cartridge's, or what the program copied to memory
uint16_t check_code(uint32_t at) { return (uint16_t) core->rawRead16(core, at, -1); }

// what the instruction running reached: each address, and the registers it wrote with their values
#define MOST 64
static uint32_t reached[MOST], writes[MOST][2], reachedCount, writeCount;
static int watching;
static void reach(uint32_t address) { if (watching && !gba->performingDMA && reachedCount < MOST) reached[reachedCount++] = address; }
static void wrote(uint32_t address, uint32_t value, int bytes) {
	if (!watching || gba->performingDMA || address >> 24 != 4) return;
	for (int i = 0; i < bytes && writeCount < MOST; i += 2) { writes[writeCount][0] = address + i; writes[writeCount++][1] = (value >> (8 * i)) & 0xFFFF; }
}
static uint32_t load32(struct ARMCore* c, uint32_t a, int* cy) { reach(a); return memory.load32(c, a, cy); }
static uint32_t load16(struct ARMCore* c, uint32_t a, int* cy) { reach(a); return memory.load16(c, a, cy); }
static uint32_t load8(struct ARMCore* c, uint32_t a, int* cy) { reach(a); return memory.load8(c, a, cy); }
static void store32(struct ARMCore* c, uint32_t a, int32_t v, int* cy) { reach(a); wrote(a, (uint32_t) v, 4); memory.store32(c, a, v, cy); }
static void store16(struct ARMCore* c, uint32_t a, int16_t v, int* cy) { reach(a); wrote(a & ~1u, (uint16_t) v, 2); memory.store16(c, a, v, cy); }
static void store8(struct ARMCore* c, uint32_t a, int8_t v, int* cy) { reach(a); memory.store8(c, a, v, cy); }
static uint32_t loadMultiple(struct ARMCore* c, uint32_t a, int m, enum LSMDirection d, int* cy) { reach(a); return memory.loadMultiple(c, a, m, d, cy); }
static uint32_t storeMultiple(struct ARMCore* c, uint32_t a, int m, enum LSMDirection d, int* cy) {
	reach(a);
	uint32_t at = a;
	for (int r = 0; r < 16; r++) if (m & (1 << r)) { wrote(at, c->gprs[r], 4); at += 4; }
	return memory.storeMultiple(c, a, m, d, cy);
}

// the frames' ends, the emulator's and the clock's: the start of what each ended after
#define FRAMES 64
static uint64_t emulatorEnds[FRAMES], clockEnds[FRAMES];
static uint32_t emulatorPcs[FRAMES];
static int emulatorFrames, clockFrames;
static void clockEnded(void) { if (clockFrames < FRAMES) clockEnds[clockFrames++] = gba_clock_started(); }

int main(int argc, char** argv) {
	if (argc < 3) { fprintf(stderr, "clock-check CARTRIDGE FRAMES\n"); return 2; }
	core = GBACoreCreate();
	core->init(core);
	mCoreInitConfig(core, NULL);
	static color_t video[256 * 256];
	core->setVideoBuffer(core, video, 256);
	if (!mCoreLoadFile(core, argv[1])) { fprintf(stderr, "mGBA can't open the cartridge\n"); return 2; }
	core->reset(core);
	struct ARMCore* cpu = core->cpu;
	gba = core->board;
	memory = cpu->memory;
	cpu->memory.load32 = load32; cpu->memory.load16 = load16; cpu->memory.load8 = load8;
	cpu->memory.store32 = store32; cpu->memory.store16 = store16; cpu->memory.store8 = store8;
	cpu->memory.loadMultiple = loadMultiple; cpu->memory.storeMultiple = storeMultiple;
	kit_copy = (const uint8_t*) gba->memory.rom;
	kit_copy_size = (uint32_t) gba->memory.romSize;

	gba_clock_start();
	gba_clock_on_frame_end(clockEnded);
	int frames = atoi(argv[2]);
	// with a third argument, a frame the clock isn't told of, as a game leaves its time alone between the stretches it
	// times: the clock stops as that frame starts, and goes on from the emulator's time at the first instruction after
	// it that a jump reaches, where the cartridge's prefetch starts again
	int skip = argc > 3 ? atoi(argv[3]) : -1, skipping = 0, jumped = 0;
	long compared = 0, differ = 0;
	uint32_t firstPc = 0, firstOp = 0; uint64_t firstClock = 0, firstEmulator = 0;
	while (emulatorFrames < frames) {
		uint32_t counter = gba->video.frameCounter;
		while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
		int thumb = cpu->executionMode == MODE_THUMB;
		uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
		uint32_t op = thumb ? check_code(pc) : (uint32_t) check_code(pc) | (uint32_t) check_code(pc + 2) << 16;
		uint64_t start = (uint64_t) mTimingCurrentTime(&gba->timing);
		uint32_t r[16];
		for (int i = 0; i < 16; i++) r[i] = cpu->gprs[i];
		reachedCount = writeCount = 0;
		watching = 1;
		ARMRun(cpu);
		watching = 0;
		int ended = gba->video.frameCounter != counter;
		if (ended && emulatorFrames < FRAMES) {
			emulatorPcs[emulatorFrames] = pc;
			emulatorEnds[emulatorFrames++] = start;
		}
		// the clock is for a game's power-on, with interrupts off: the first time it waits, the game's own wait goes on
		if (cpu->halted || (gba->memory.io[0x208 >> 1] & 1)) break;
		uint32_t next = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
		if (skip >= 0) {
			int was = jumped;
			jumped = next != pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			if (!skipping && emulatorFrames == skip && !ended) { skipping = 1; gba_clock_stop(); }
			if (skipping == 1 && emulatorFrames > skip && was && pc >= 0x4000) { skipping = 2; gba_clock_resume(start); }
			if (skipping == 1) continue;
		}
		if (pc < 0x4000) continue;   // the BIOS's own code: the clock times it itself
		next |= cpu->executionMode == MODE_THUMB;
		if (thumb && (op & 0xFF00) == 0xDF00) {
			gba_clock_swi(pc, op & 0xFF, r[0], r[1], r[2], NULL);
			continue;
		}
		// as a game does: the instruction's work, which wrote these registers, then what the clock can't read from it,
		// the addresses it reached but through the pool or the stack, and what a mul multiplies by
		for (uint32_t i = 0; i < writeCount; i++) gba_clock_written(writes[i][0], (uint16_t) writes[i][1]);
		uint32_t at[MOST + 2]; int n = 0;
		if (thumb) {
			int pool = (op & 0xF800) == 0x4800, stack = (op & 0xF000) == 0x9000 || (op & 0xF600) == 0xB400;
			if (!pool && !stack) for (uint32_t i = 0; i < reachedCount; i++) at[n++] = reached[i];
			if ((op & 0xFFC0) == 0x4340) at[n++] = r[op & 7];
			gba_clock_run(pc, pc, next, at, n);
		} else {
			if (((op >> 16) & 15) != 15) for (uint32_t i = 0; i < reachedCount; i++) at[n++] = reached[i];
			gba_clock_run_arm(pc, pc, next, at, n);
		}
		compared++;
		if (gba_clock_started() != start && !differ++) { firstPc = pc; firstOp = op; firstClock = gba_clock_started(); firstEmulator = start; }
	}
	int framesDiffer = 0;
	for (int f = 0; f < emulatorFrames; f++) {
		int same = f < clockFrames && clockEnds[f] == emulatorEnds[f];
		if (!same) framesDiffer++;
		printf("{\"frame\":%d,\"pc\":%u,\"emulator\":%llu,\"clock\":%lld}\n", f, emulatorPcs[f], (unsigned long long) emulatorEnds[f], f < clockFrames ? (long long) clockEnds[f] : -1LL);
	}
	printf("{\"compared\":%ld,\"differ\":%ld,\"first\":{\"pc\":%u,\"op\":%u,\"clock\":%llu,\"emulator\":%llu},\"framesDiffer\":%d}\n",
		compared, differ, firstPc, firstOp, (unsigned long long) firstClock, (unsigned long long) firstEmulator, framesDiffer);
	core->deinit(core);
	return differ || framesDiffer ? 1 : 0;
}
