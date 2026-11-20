// Runs a cartridge in the reference emulator and the GBA kit's clock beside it (kit/gba/c/clock.c), an instruction at
// a time, as `prove` plays a frame: the events due, then one instruction. For each instruction outside the BIOS the
// clock is told what ran, as a game's C tells it, through gba_clock_run, and the time it says the instruction started
// at is compared with the emulator's. A swi goes to gba_clock_swi, which times the BIOS's own code itself. Each frame's
// end is compared too: the instruction, or the BIOS's step, it ended after, by when that started.
//
// An interrupt is the clock's to take: when the emulator takes one, the clock is asked what comes before the
// instruction it interrupted (gba_clock_before), and it has to call the program's handler then, which is the emulator
// run through the BIOS's code to the handler and through the handler, each of its instructions compared as any other.
// A wait for an interrupt in the BIOS is gba_clock_swi's, which calls the handler from inside it the same way, and
// reads the halfword the handler acknowledges in from the emulator's memory.
//
// clock-check CARTRIDGE FRAMES
//
// Each line of the picture the emulator draws, as its H-blank starts, the clock has to say it's drawn then too
// (gba_clock_on_line), the same line at the same time, with the frames all timed.
//
// It prints a line per frame, as JSON, with what the emulator's frame ended after, and one at the end: how many
// instructions were compared, how many differed, and the first that did, how many interrupts the clock took, and how
// many it took that the emulator didn't or missed that it did, and how many lines each drew and how many of them
// differ. It exits with 1 when anything differed (tools/test/clock.mjs).

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
// and the words a sound's DMA reads, for its FIFO
uint32_t check_data(uint32_t at) { return (uint32_t) core->rawRead32(core, at, -1); }

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
// each by the clock's own count of frames, so one it wasn't told of leaves its place empty
static void clockEnded(void) {
	int f = (int) gba_clock_frame() - 1;
	if (f >= 0 && f < FRAMES) clockEnds[f] = gba_clock_started();
	if (f + 1 > clockFrames) clockFrames = f + 1;
}
static int runningWrong;

// the picture's lines as each was drawn, the emulator's and the clock's: which, and when
#define LINES_KEPT (FRAMES * 160)
static uint64_t emulatorLineAt[LINES_KEPT], clockLineAt[LINES_KEPT];
static int emulatorLine[LINES_KEPT], clockLine[LINES_KEPT], emulatorLines, clockLines;
static void (*drawScanline)(struct GBAVideoRenderer* renderer, int y);
static void emulatorDrew(struct GBAVideoRenderer* renderer, int y) {
	if (emulatorLines < LINES_KEPT) { emulatorLine[emulatorLines] = y; emulatorLineAt[emulatorLines++] = (uint64_t) mTimingCurrentTime(&gba->timing); }
	drawScanline(renderer, y);
}
static void clockDrew(int y) {
	if (clockLines < LINES_KEPT) { clockLine[clockLines] = y; clockLineAt[clockLines++] = gba_clock_now(); }
}

static struct ARMCore* cpu;
static int frames, skip = -1, skipping, jumped, lastCounter;
static long compared, differ, interrupts, unasked, missed;
static uint32_t firstPc, firstOp; static uint64_t firstClock, firstEmulator;
// whether the emulator has taken an interrupt the clock is being asked about, and how many handlers the clock called
static int asked, called, finished;

// One instruction of the emulator's, and the clock told of it. In the handler (`handling`), gives 1 once the
// instruction run was the handler's last: the one that goes back to the BIOS.
static int step(int handling) {
	while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
	int thumb = cpu->executionMode == MODE_THUMB;
	uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	// the emulator at its interrupt vector, and not from inside a wait or a handler: the clock takes the same one
	// before the instruction it interrupted, and runs the emulator on through the handler
	if (!handling && !asked && !thumb && pc == 0x18 && skipping != 1) {
		uint32_t interrupted = (uint32_t) cpu->gprs[ARM_LR] - 4;
		asked = 1; called = 0;
		gba_clock_before(interrupted | (uint32_t) cpu->spsr.t);
		asked = 0;
		if (!called) missed++;
		else return 0;
	}
	uint32_t op = thumb ? check_code(pc) : (uint32_t) check_code(pc) | (uint32_t) check_code(pc + 2) << 16;
	uint64_t start = (uint64_t) mTimingCurrentTime(&gba->timing);
	uint32_t r[16];
	for (int i = 0; i < 16; i++) r[i] = cpu->gprs[i];
	reachedCount = writeCount = 0;
	watching = 1;
	ARMRun(cpu);
	watching = 0;
	int ended = (int) gba->video.frameCounter != lastCounter;
	lastCounter = (int) gba->video.frameCounter;
	if (ended && emulatorFrames < FRAMES) {
		emulatorPcs[emulatorFrames] = pc;
		emulatorEnds[emulatorFrames++] = start;
	}
	uint32_t next = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	if (skip >= 0 && !handling) {
		int was = jumped;
		jumped = next != pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
		if (!skipping && emulatorFrames == skip && !ended) { skipping = 1; gba_clock_stop(); runningWrong |= gba_clock_running(); }
		if (skipping == 1 && emulatorFrames > skip && was && pc >= 0x4000) { skipping = 2; gba_clock_resume(start); runningWrong |= !gba_clock_running(); }
		if (skipping == 1) return 0;
	}
	if (pc < 0x4000) return 0;   // the BIOS's own code: the clock times it itself
	next |= cpu->executionMode == MODE_THUMB;
	if (thumb && (op & 0xFF00) == 0xDF00) {
		// a wait calls the handler from inside it, as often as the processor wakes
		int waits = (op & 0xFF) == 2 || (op & 0xFF) == 4 || (op & 0xFF) == 5, was = asked;
		if (waits) asked = 1;
		gba_clock_swi(pc, op & 0xFF, r[0], r[1], r[2], NULL);
		asked = was;
		return 0;
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
	return handling && (next & ~1u) < 0x4000;
}

// The program's handler, as the clock calls it: the emulator's way through the BIOS to it, and through it.
static void handler(void) {
	interrupts++;
	called++;
	if (!asked) { unasked++; return; }
	while (emulatorFrames < frames && !step(1)) {}
	// the frames are done, the handler not: the clock is left with nothing to wait for or take again
	if (emulatorFrames >= frames) { finished = 1; gba_clock_write16(0x04000202, 0xFFFF); }
}

// the halfword the handler acknowledges in: the emulator's, which its own BIOS writes
static uint16_t acknowledged(void) { return finished ? 0xFFFF : (uint16_t) core->rawRead16(core, 0x03007FF8, -1); }
static void acknowledge(uint16_t value) { (void) value; }

int main(int argc, char** argv) {
	if (argc < 3) { fprintf(stderr, "clock-check CARTRIDGE FRAMES\n"); return 2; }
	core = GBACoreCreate();
	core->init(core);
	mCoreInitConfig(core, NULL);
	static color_t video[256 * 256];
	core->setVideoBuffer(core, video, 256);
	if (!mCoreLoadFile(core, argv[1])) { fprintf(stderr, "mGBA can't open the cartridge\n"); return 2; }
	core->reset(core);
	cpu = core->cpu;
	gba = core->board;
	memory = cpu->memory;
	cpu->memory.load32 = load32; cpu->memory.load16 = load16; cpu->memory.load8 = load8;
	cpu->memory.store32 = store32; cpu->memory.store16 = store16; cpu->memory.store8 = store8;
	cpu->memory.loadMultiple = loadMultiple; cpu->memory.storeMultiple = storeMultiple;
	kit_copy = (const uint8_t*) gba->memory.rom;
	kit_copy_size = (uint32_t) gba->memory.romSize;

	gba_clock_start();
	gba_clock_on_frame_end(clockEnded);
	// the handler's address is the program's own, at 0x03007FFC once it's written; the made-up cartridge keeps it
	// just after its start (clock.mjs)
	gba_clock_on_interrupt(0x080000CC, handler);
	gba_clock_on_wait(acknowledged, acknowledge);
	drawScanline = gba->video.renderer->drawScanline;
	gba->video.renderer->drawScanline = emulatorDrew;
	gba_clock_on_line(clockDrew);
	frames = atoi(argv[2]);
	// with a third argument, a frame the clock isn't told of, as a game leaves its time alone between the stretches it
	// times: the clock stops as that frame starts, and goes on from the emulator's time at the first instruction after
	// it that a jump reaches, where the cartridge's prefetch starts again
	if (argc > 3) skip = atoi(argv[3]);
	lastCounter = (int) gba->video.frameCounter;
	while (emulatorFrames < frames) step(0);
	int framesDiffer = runningWrong;
	for (int f = 0; f < emulatorFrames; f++) {
		// a frame the clock wasn't told of has no end of its own to compare
		if (f == skip) continue;
		int same = f < clockFrames && clockEnds[f] == emulatorEnds[f];
		if (!same) framesDiffer++;
		printf("{\"frame\":%d,\"pc\":%u,\"emulator\":%llu,\"clock\":%lld}\n", f, emulatorPcs[f], (unsigned long long) emulatorEnds[f], f < clockFrames ? (long long) clockEnds[f] : -1LL);
	}
	// the lines, where every frame was timed: the same line drawn at the same time by both, up to the last the clock drew
	int linesDiffer = 0, firstLine = -1;
	if (skip < 0) {
		for (int i = 0; i < clockLines; i++)
			if (i >= emulatorLines || clockLine[i] != emulatorLine[i] || clockLineAt[i] != emulatorLineAt[i]) {
				if (firstLine < 0) firstLine = i;
				linesDiffer++;
			}
		if (clockLines + 160 < emulatorLines) linesDiffer++;
	}
	printf("{\"compared\":%ld,\"differ\":%ld,\"first\":{\"pc\":%u,\"op\":%u,\"clock\":%llu,\"emulator\":%llu},\"framesDiffer\":%d,\"interrupts\":%ld,\"unasked\":%ld,\"missed\":%ld,\"lines\":{\"emulator\":%d,\"clock\":%d,\"differ\":%d,\"first\":%d,\"emulatorAt\":%llu,\"clockAt\":%llu}}\n",
		compared, differ, firstPc, firstOp, (unsigned long long) firstClock, (unsigned long long) firstEmulator, framesDiffer, interrupts, unasked, missed,
		emulatorLines, clockLines, linesDiffer, firstLine, firstLine >= 0 && firstLine < emulatorLines ? (unsigned long long) emulatorLineAt[firstLine] : 0ULL, firstLine >= 0 ? (unsigned long long) clockLineAt[firstLine] : 0ULL);
	core->deinit(core);
	return differ || framesDiffer || unasked || missed || linesDiffer ? 1 : 0;
}
