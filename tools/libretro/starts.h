// A function's start as play reaches it, for the function check's memories of play on the PlayStation 2
// (../ps2/twin-memories.mjs): the EE's registers as they were and the console's memory then, which is what the game
// really gave the function. The program that drives the emulators includes this (host.c), for a core that tells of
// each block it runs and says where it keeps the console's registers and memory, as the PlayStation 2's does with the
// tools' patch (play.patch, ran-ps2.h).
//
// DP_STARTS names a file of the EE's addresses to watch for, 32 bits each. Each time the EE is about to run one of
// them, its 1st, 3rd, 9th time and so on by threes, a record goes to the same name with ".out": the address, which
// start it is and the frame, the EE's registers as the function check's 327 words (../ps2/original.mjs, EE_REGISTERS),
// and then every 4 KB page of the EE's memories written since the record before, a count and then each one's number
// and bytes. The first record has every page that isn't zeros. A page's number is its place in the function check's
// image of the EE (../ps2/original.mjs, KINDS.ee): the console's 32 MB from 0, the IOP's memory from 0x2000, the
// scratchpad at 0x2200, and the vector units' memories at 0x2220, 0x2224, 0x2228 and 0x222C. The hardware's registers
// and the GS's, which the image has too, aren't memory in the emulator, and no page of them is written.
//
// A start is known as the block before it ends: the emulator then holds where it goes next and every register as the
// function will find them, the return address a call left in ra among them.

#ifndef DP_LIBRETRO_STARTS_H
#define DP_LIBRETRO_STARTS_H

enum { STARTS_PAGE = 4096, STARTS_WORDS = 327, STARTS_NOWHERE = 1 };

// the EE's memories in the image's order: which of the core's memories, its address there, its pages and its first
// page in the image
static const struct { uint32_t memory, address, pages, first; } STARTS_MEMORIES[] = {
	{ 0, 0x00000000, 0x2000, 0x0000 }, { 1, 0x00000000, 0x0200, 0x2000 }, { 0, 0x70000000, 0x0004, 0x2200 },
	{ 0, 0x11000000, 0x0001, 0x2220 }, { 0, 0x11004000, 0x0001, 0x2224 }, { 0, 0x11008000, 0x0004, 0x2228 }, { 0, 0x1100C000, 0x0004, 0x222C },
};
enum { STARTS_MEMORY_COUNT = sizeof STARTS_MEMORIES / sizeof STARTS_MEMORIES[0], STARTS_PAGES = 0x2230 };

static struct {
	const uint32_t* (*registers)(uint32_t* next);
	const uint8_t* (*memory)(uint32_t memory, uint32_t address, uint32_t bytes);
	uint32_t* watched;   // the addresses, in order
	uint32_t* counts;    // how many times each has started
	size_t count;
	uint64_t* hashes;    // each page as it was last written out, hashed, 0 for one that was all zeros
	uint32_t frame;
	FILE* out;
} starts;

// a page's hash, never 0 unless it holds nothing: FNV-1a over its 64-bit words
static uint64_t startsHash(const uint8_t* page) {
	uint64_t hash = 0xCBF29CE484222325ull, any = 0;
	for (size_t i = 0; i < STARTS_PAGE; i += 8) {
		uint64_t word;
		memcpy(&word, page + i, 8);
		any |= word;
		hash = (hash ^ word) * 0x100000001B3ull;
	}
	return any ? hash | 1 : 0;
}

/** Starts it when DP_STARTS asks, with the core's `registers` and `memory`, each null when the core doesn't say:
 *  whether it's watching. */
static int startsOpen(const uint32_t* (*registers)(uint32_t*), const uint8_t* (*memory)(uint32_t, uint32_t, uint32_t)) {
	const char* spec = getenv("DP_STARTS");
	if (!spec) return 0;
	if (!registers || !memory) {
		fprintf(err, "The core doesn't say what the console holds as a function starts: npm run dp -- setup builds it again, with the tools' change to it.\n");
		exit(2);
	}
	size_t size;
	starts.watched = readAll(spec, &size);
	starts.count = size / 4;
	char path[4096];
	snprintf(path, sizeof path, "%s.out", spec);
	if (!starts.watched || !(starts.out = fopen(path, "wb"))) {
		fprintf(err, "Can't read or write what DP_STARTS asks for\n");
		exit(2);
	}
	// in order, to be found by halves
	for (size_t i = 1; i < starts.count; i++) {
		for (size_t k = i; k && starts.watched[k - 1] > starts.watched[k]; k--) {
			uint32_t swap = starts.watched[k];
			starts.watched[k] = starts.watched[k - 1];
			starts.watched[k - 1] = swap;
		}
	}
	starts.counts = calloc(starts.count ? starts.count : 1, 4);
	starts.hashes = calloc(STARTS_PAGES, 8);
	starts.registers = registers;
	starts.memory = memory;
	return 1;
}

/** A block of the EE's ran: when it goes on to an address watched for, on one of its starts that are kept, the record
 *  of it is written. `begin` and `count` are the block's first address and how many instructions it has. */
static void startsBlockRan(uint32_t begin, uint32_t count) {
	if (!starts.out) return;
	uint32_t next = STARTS_NOWHERE;
	const uint32_t* words = starts.registers(&next);
	// with no jump waiting, the instruction after the block
	if (next == STARTS_NOWHERE) next = begin + count * 4;
	next &= 0x1FFFFFFFu;
	size_t low = 0, high = starts.count;
	while (low < high) {
		size_t middle = (low + high) / 2;
		if (starts.watched[middle] < next) low = middle + 1;
		else high = middle;
	}
	if (low == starts.count || starts.watched[low] != next) return;
	uint32_t number = ++starts.counts[low], power = number;
	while (power % 3 == 0) power /= 3;
	if (power != 1) return;
	uint32_t header[3] = { next, number, starts.frame };
	fwrite(header, 4, 3, starts.out);
	fwrite(words, 4, STARTS_WORDS, starts.out);
	// the pages written since the last record: their count first, which is known only once each has been looked at
	long countAt = ftell(starts.out);
	uint32_t pages = 0;
	fwrite(&pages, 4, 1, starts.out);
	for (size_t m = 0; m < STARTS_MEMORY_COUNT; m++) {
		const uint8_t* bytes = starts.memory(STARTS_MEMORIES[m].memory, STARTS_MEMORIES[m].address, STARTS_MEMORIES[m].pages * STARTS_PAGE);
		if (!bytes) continue;
		for (uint32_t p = 0; p < STARTS_MEMORIES[m].pages; p++) {
			uint32_t page = STARTS_MEMORIES[m].first + p;
			uint64_t hash = startsHash(bytes + (size_t) p * STARTS_PAGE);
			if (hash == starts.hashes[page]) continue;
			starts.hashes[page] = hash;
			fwrite(&page, 4, 1, starts.out);
			fwrite(bytes + (size_t) p * STARTS_PAGE, 1, STARTS_PAGE, starts.out);
			pages++;
		}
	}
	long end = ftell(starts.out);
	fseek(starts.out, countAt, SEEK_SET);
	fwrite(&pages, 4, 1, starts.out);
	fseek(starts.out, end, SEEK_SET);
}

/** A frame ended: the next is counted from here. */
static void startsFrame(uint32_t frame) {
	starts.frame = frame;
}

static void startsClose(void) {
	if (starts.out) fclose(starts.out);
}

#endif
