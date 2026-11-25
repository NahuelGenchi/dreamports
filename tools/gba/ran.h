// What ran of the original, for gameplay proven (tools/lib/played.mjs): every instruction, in the cartridge or the work
// RAM, and for a conditional branch each of its two ways, taken and not, each with the stretches of frames it happened
// in. The programs that run the original include this, the one-console one (original.c) and the linked one (linked.c),
// so both write the same records, each five 32-bit words: the instruction's address (+1 for Thumb), its bytes, what
// happened (0 it ran, 1 its branch was taken, 2 it wasn't), and the first and the last frame of a stretch of frames
// that each had it. An address of the work RAM that later holds other bytes starts anew.
//
// ranOpen(path) starts it, ranBefore(core, frame, &next) is called before an instruction runs and ranAfter(cpu, now,
// next, frame) after, and ranClose() writes what's still open.

#ifndef DP_RAN_H
#define DP_RAN_H

#include <mgba/core/core.h>
#include <mgba/internal/arm/arm.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

enum { RAN, TAKEN, NOT_TAKEN, HAPPENINGS };
struct played { uint32_t address, code, start[HAPPENINGS]; long last[HAPPENINGS]; };
// where code can run from, the cartridge and the two work RAMs, each with a place in the list for every halfword
static struct { uint32_t base, size; uint32_t* at; } ranPlaces[] = {
	{ 0x08000000, 0x02000000, NULL },
	{ 0x03000000, 0x00008000, NULL },
	{ 0x02000000, 0x00040000, NULL },
};
#define RAN_PLACES (sizeof ranPlaces / sizeof ranPlaces[0])
static struct { FILE* file; struct played* list; size_t count, capacity; } played;

static void ranOpen(const char* path) {
	played.file = fopen(path, "wb");
	if (!played.file) { fprintf(stderr, "Can't write %s\n", path); exit(2); }
	for (size_t i = 0; i < RAN_PLACES; i++) ranPlaces[i].at = calloc(ranPlaces[i].size / 2, sizeof(uint32_t));
}

static void writeStretch(const struct played* p, int what) {
	uint32_t record[5] = { p->address, p->code, (uint32_t) what, p->start[what], (uint32_t) p->last[what] };
	fwrite(record, 4, 5, played.file);
}

// an instruction's stretches so far, written and begun again, as when its address holds other bytes
static void endStretches(struct played* p) {
	for (int what = 0; what < HAPPENINGS; what++) {
		if (p->last[what] >= 0) writeStretch(p, what);
		p->last[what] = -1;
	}
}

// a stretch begins when nothing came before it, which is -1, and so is the frame before frame 0: so a first one at frame
// 0 begins too, and its first frame isn't left as the memory happened to hold it
static void happened(struct played* p, int what, long frame) {
	if (p->last[what] == frame) return;
	if (p->last[what] < 0 || p->last[what] != frame - 1) {
		if (p->last[what] >= 0) writeStretch(p, what);
		p->start[what] = (uint32_t) frame;
	}
	p->last[what] = frame;
}

// the instruction at `pc`, as the list has it: new the first time it runs, and begun again with other bytes there.
// NULL for an address code doesn't run from
static struct played* playedAt(struct mCore* core, uint32_t pc, int thumb) {
	size_t place = 0;
	while (place < RAN_PLACES && pc - ranPlaces[place].base >= ranPlaces[place].size) place++;
	if (place == RAN_PLACES) return NULL;
	uint32_t* at = &ranPlaces[place].at[(pc - ranPlaces[place].base) / 2];
	int ram = ranPlaces[place].base != 0x08000000;
	if (*at && !ram) return &played.list[*at - 1];
	uint32_t code = thumb ? core->rawRead16(core, pc, -1) : core->rawRead32(core, pc, -1);
	if (*at) {
		struct played* p = &played.list[*at - 1];
		if (p->code == code && p->address == (pc | (uint32_t) thumb)) return p;
		endStretches(p);
		p->address = pc | (uint32_t) thumb;
		p->code = code;
		return p;
	}
	if (played.count == played.capacity) {
		played.capacity = played.capacity ? played.capacity * 2 : 1 << 16;
		played.list = realloc(played.list, played.capacity * sizeof(struct played));
	}
	struct played* p = &played.list[played.count++];
	p->address = pc | (uint32_t) thumb;
	p->code = code;
	for (int what = 0; what < HAPPENINGS; what++) p->last[what] = -1;
	*at = (uint32_t) played.count;
	return p;
}

// whether an instruction is a conditional branch: Thumb's B<cond>, or ARM's B or BL with a condition
static int branches(uint32_t code, int thumb) {
	if (thumb) return (code & 0xF000) == 0xD000 && (code >> 8 & 0xF) < 0xE;
	return (code & 0x0E000000) == 0x0A000000 && code >> 28 < 0xE;
}

// before the instruction the processor is about to run: it ran, in this frame. Returns it when it's a conditional
// branch, with `next` the address after it, for ranAfter to say which way it went, or else NULL
static struct played* ranBefore(struct mCore* core, long frame, uint32_t* next) {
	struct ARMCore* cpu = core->cpu;
	int thumb = cpu->executionMode == MODE_THUMB;
	uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	struct played* now = playedAt(core, pc, thumb);
	if (!now) return NULL;
	happened(now, RAN, frame);
	if (!branches(now->code, thumb)) return NULL;
	*next = pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	return now;
}

// after it: a conditional branch went one of its two ways
static void ranAfter(struct ARMCore* cpu, struct played* now, uint32_t next, long frame) {
	if (!now) return;
	uint32_t pc = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	happened(now, pc == next ? NOT_TAKEN : TAKEN, frame);
}

static void ranClose(void) {
	if (!played.file) return;
	for (size_t i = 0; i < played.count; i++) endStretches(&played.list[i]);
	fclose(played.file);
	played.file = NULL;
}

#endif
