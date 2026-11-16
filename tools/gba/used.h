// The cartridge's data the game used, for gameplay proven (tools/lib/played.mjs): the cartridge in cells of 32 bytes,
// each with the stretches of frames something of it was used in. The programs that run the original include this, the
// one-console one (original.c) and the linked one (linked.c), so both write the same records, each three 32-bit words:
// the cell's number, and the first and last frame of a stretch.
//
// Data is used when the game reads it and does anything with it but copy it into its work RAM. What it copies there, or
// has the BIOS unpack there, is followed, and counts only once it's read from there and used. Every read and write the
// processor, the BIOS and DMA make goes through the watchers below, which follow the data into the work RAM, each
// console's by itself, as linked consoles each have a memory of their own. The cells are counted together: one counts
// in a frame when any console used it then.
//
// usedOpen(path, romSize) starts it, usedWatch(cpu) puts the watchers on a console, usedFrame(frame) says which frame is
// being played, usedEndFrame() closes what a frame left read, and usedClose() writes what's still open.

#ifndef DP_USED_H
#define DP_USED_H

#include <mgba/core/core.h>
#include <mgba/internal/arm/arm.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define CELL 32
#define EWRAM_BYTES 0x40000
#define IWRAM_BYTES 0x8000
#define USED_CONSOLES 4
static struct {
	FILE* file;
	long frame;
	uint32_t romSize;
	uint32_t* start;       // for each cell, the stretch of frames it's in the middle of
	long* last;
} content;
// what each console's watchers keep
struct usedBy {
	struct ARMCore* cpu;
	uint32_t* from;        // for each byte of the work RAM, external then internal, where in the cartridge it came from, +1, or 0
	struct ARMMemory memory;                   // the emulator's own reads and writes
	void (*swi16)(struct ARMCore*, int);
	void (*swi32)(struct ARMCore*, int);
	// the last thing read, until what's done with it shows whether it was used or copied
	uint32_t pending[4], value;
	int size;
	// while the BIOS unpacks from the cartridge into the work RAM: what it read and where it wrote
	int unpacking;
	uint32_t readLow, readHigh, wroteLow, wroteHigh;
};
static struct usedBy usedConsoles[USED_CONSOLES];
static int usedCount;

static struct usedBy* usedOf(struct ARMCore* cpu) {
	for (int i = 0; i < usedCount; i++) if (usedConsoles[i].cpu == cpu) return &usedConsoles[i];
	return &usedConsoles[0];
}

static void cellUsed(uint32_t offset) {
	uint32_t cell = offset / CELL;
	if (content.last[cell] == content.frame) return;
	if (content.last[cell] != content.frame - 1) {
		if (content.last[cell] >= 0) {
			uint32_t record[3] = { cell, content.start[cell], (uint32_t) content.last[cell] };
			fwrite(record, 4, 3, content.file);
		}
		content.start[cell] = (uint32_t) content.frame;
	}
	content.last[cell] = content.frame;
}

// where a byte of memory came from in the cartridge, +1: the cartridge itself, or what the work RAM holds of it
static uint32_t* ramFrom(struct usedBy* c, uint32_t address) {
	if (address >> 24 == 2) return &c->from[address & (EWRAM_BYTES - 1)];
	if (address >> 24 == 3) return &c->from[EWRAM_BYTES + (address & (IWRAM_BYTES - 1))];
	return NULL;
}
static uint32_t cameFrom(struct usedBy* c, uint32_t address) {
	if (address >> 24 >= 8 && address >> 24 <= 13) {
		uint32_t offset = address & 0x01FFFFFF;
		return offset < content.romSize ? offset + 1 : 0;
	}
	uint32_t* from = ramFrom(c, address);
	return from ? *from : 0;
}

// what was read last was used after all
static void usePending(struct usedBy* c) {
	for (int i = 0; i < c->size; i++) if (c->pending[i]) cellUsed(c->pending[i] - 1);
	c->size = 0;
}

static void wasRead(struct usedBy* c, uint32_t address, uint32_t value, int size) {
	usePending(c);
	if (c->unpacking) {
		uint32_t from = cameFrom(c, address);
		if (from && address >> 24 >= 8) {
			if (from - 1 < c->readLow) c->readLow = from - 1;
			if (from - 1 + size - 1 > c->readHigh) c->readHigh = from - 1 + size - 1;
		}
		return;
	}
	int any = 0;
	for (int i = 0; i < size; i++) any |= (c->pending[i] = cameFrom(c, address + i)) != 0;
	if (!any) return;
	c->value = value;
	c->size = size;
}

static void wasWritten(struct usedBy* c, uint32_t address, uint32_t value, int size) {
	uint32_t* to = ramFrom(c, address);
	uint32_t mask = size == 4 ? 0xFFFFFFFF : (1u << size * 8) - 1;
	// what was just read, written as it is into the work RAM: a copy, which is followed there
	int copy = to && c->size == size && (c->value & mask) == (value & mask);
	if (to) {
		if (c->unpacking) {
			if (address < c->wroteLow) c->wroteLow = address;
			if (address + size - 1 > c->wroteHigh) c->wroteHigh = address + size - 1;
		}
		for (int i = 0; i < size; i++) {
			uint32_t* each = ramFrom(c, address + i);
			if (each) *each = copy ? c->pending[i] : 0;
		}
	}
	if (copy) c->size = 0;
	else if (c->size == size && (c->value & mask) == (value & mask)) usePending(c);   // written elsewhere: used
}

static uint32_t watchLoad32(struct ARMCore* cpu, uint32_t address, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	uint32_t value = c->memory.load32(cpu, address, cycles);
	wasRead(c, address & ~3u, value, 4);
	return value;
}
static uint32_t watchLoad16(struct ARMCore* cpu, uint32_t address, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	uint32_t value = c->memory.load16(cpu, address, cycles);
	wasRead(c, address & ~1u, value, 2);
	return value;
}
static uint32_t watchLoad8(struct ARMCore* cpu, uint32_t address, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	uint32_t value = c->memory.load8(cpu, address, cycles);
	wasRead(c, address, value, 1);
	return value;
}
static void watchStore32(struct ARMCore* cpu, uint32_t address, int32_t value, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	wasWritten(c, address & ~3u, (uint32_t) value, 4);
	c->memory.store32(cpu, address, value, cycles);
}
static void watchStore16(struct ARMCore* cpu, uint32_t address, int16_t value, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	wasWritten(c, address & ~1u, (uint16_t) value, 2);
	c->memory.store16(cpu, address, value, cycles);
}
static void watchStore8(struct ARMCore* cpu, uint32_t address, int8_t value, int* cycles) {
	struct usedBy* c = usedOf(cpu);
	wasWritten(c, address, (uint8_t) value, 1);
	c->memory.store8(cpu, address, value, cycles);
}

// a BIOS call. One that unpacks data of the cartridge into the work RAM (BitUnPack to Diff16bitUnFilter, 0x10 to
// 0x18) leaves each byte it wrote coming from as far through what it read as the byte is through what it wrote
static void watchSwi(struct ARMCore* cpu, int number, void (*swi)(struct ARMCore*, int), int immediate) {
	struct usedBy* c = usedOf(cpu);
	uint32_t source = cpu->gprs[0], target = cpu->gprs[1];
	usePending(c);
	if (number < 0x10 || number > 0x18 || !ramFrom(c, target) || source >> 24 < 8 || source >> 24 > 13) {
		swi(cpu, immediate);
		usePending(c);
		return;
	}
	c->unpacking = 1;
	c->readLow = c->wroteLow = 0xFFFFFFFF;
	c->readHigh = c->wroteHigh = 0;
	swi(cpu, immediate);
	c->unpacking = 0;
	if (c->readLow > c->readHigh || c->wroteLow > c->wroteHigh) return;
	uint64_t read = c->readHigh - c->readLow + 1, wrote = c->wroteHigh - c->wroteLow + 1;
	for (uint32_t i = 0; i < wrote; i++) {
		uint32_t* to = ramFrom(c, c->wroteLow + i);
		if (to) *to = c->readLow + (uint32_t) (i * read / wrote) + 1;
	}
}
static void watchSwi16(struct ARMCore* cpu, int immediate) { watchSwi(cpu, immediate & 0xFF, usedOf(cpu)->swi16, immediate); }
static void watchSwi32(struct ARMCore* cpu, int immediate) { watchSwi(cpu, immediate >> 16 & 0xFF, usedOf(cpu)->swi32, immediate); }

static void usedOpen(const char* path, uint32_t romSize) {
	content.file = fopen(path, "wb");
	if (!content.file) { fprintf(stderr, "Can't write %s\n", path); exit(2); }
	content.romSize = romSize;
	uint32_t cells = content.romSize / CELL + 1;
	content.start = calloc(cells, sizeof(uint32_t));
	content.last = malloc(cells * sizeof(long));
	for (uint32_t i = 0; i < cells; i++) content.last[i] = -1;
}

// the watchers on one console, which keeps its own account of what its work RAM holds
static void usedWatch(struct ARMCore* cpu) {
	if (usedCount == USED_CONSOLES) { fprintf(stderr, "Too many consoles to watch\n"); exit(2); }
	struct usedBy* c = &usedConsoles[usedCount++];
	c->cpu = cpu;
	c->from = calloc(EWRAM_BYTES + IWRAM_BYTES, sizeof(uint32_t));
	c->memory = cpu->memory;
	cpu->memory.load32 = watchLoad32;
	cpu->memory.load16 = watchLoad16;
	cpu->memory.load8 = watchLoad8;
	cpu->memory.store32 = watchStore32;
	cpu->memory.store16 = watchStore16;
	cpu->memory.store8 = watchStore8;
	c->swi16 = cpu->irqh.swi16;
	c->swi32 = cpu->irqh.swi32;
	cpu->irqh.swi16 = watchSwi16;
	cpu->irqh.swi32 = watchSwi32;
}

static void usedFrame(long frame) { content.frame = frame; }

// what a frame left read on any console was used in it
static void usedEndFrame(void) {
	if (!content.file) return;
	for (int i = 0; i < usedCount; i++) usePending(&usedConsoles[i]);
}

static void usedClose(void) {
	if (!content.file) return;
	usedEndFrame();
	for (uint32_t cell = 0; cell < content.romSize / CELL + 1; cell++) {
		if (content.last[cell] < 0) continue;
		uint32_t record[3] = { cell, content.start[cell], (uint32_t) content.last[cell] };
		fwrite(record, 4, 3, content.file);
	}
	fclose(content.file);
	content.file = NULL;
}

#endif
