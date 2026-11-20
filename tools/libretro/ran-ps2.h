// What ran of the original on the PlayStation 2, and what it read of its disc, as Play! tells it with the tools' change
// to it (play.patch, Source/DreamportsWatch.h). The program that drives the emulators includes this after ran.h
// (host.c), and writes the same files as the NES's and the Game Boy Advance's, for the same tools (lib/played.mjs).
//
// Play! compiles the console's code a block at a time, a block running from where something jumps to the instruction
// after a branch's delay slot, and every instruction of a block runs whenever it does: as each block ends, the
// emulator says so, with which way its branch went. That's every instruction of the EE, the IOP and both vector units.
// A block's words are those it was compiled from, so code loaded over other code at the same address starts anew.
//
// A place is a processor and an address in its own memory: on the EE and the IOP, as the processor runs it with the
// top three bits left out, which is where it is in their memory, and on a vector unit, where it is in the unit's code
// memory. FUNCTIONS, a file, lists where the code map's functions are, as ran.h reads it, with the processor in the
// fourth word's second byte (0 the EE, 1 the IOP, 2 vector unit 0, 3 vector unit 1): a function runs when its first
// instruction does, with the first word of its fifth and sixth when its fourth word's first byte says it has them. The
// tools list the functions of the program the disc boots there, the EE's: what else a disc holds is at addresses of
// its own, and is found from what ran (lib/played.mjs).
//
// DP_PLAYED's records are ran.h's five words, with the processor in the second byte of the third word: the address, its
// word (the lower instruction of a vector unit's pair), what happened, and the first and last frame of a stretch of
// frames. DP_CONTENT, when it's set, names a file for the disc's sectors read, each 2048 bytes of the disc's data,
// whichever way the game read it: three 32-bit words a record, the sector, and the first and last frame of a stretch of
// frames it was read in.
//
// DP_MODULES, when it's set, names a file for each module the IOP loads, which it puts wherever it has room: four
// 32-bit words, the frame, where the module's bytes start in the IOP's memory and where they end, and the FNV-1a hash of
// its bytes as its file holds them, the one stretch it loads, which says which module it is (ps2/ledger.mjs). What ran
// there before starts anew.
//
// DP_WHY, as the Game Boy Advance's program reads it (../gba/original.c): two files, the addresses of the EE's
// conditional branches asked about, a 32-bit word each, and where to write what each went by, each time it ran. Every
// instruction of the EE then tells the tools what the registers hold before it runs, and each register's value is
// followed to where it came from: a load names where it read, LUI, or an ADDIU or ORI from $zero, a number in the code,
// and anything else worked out from more than one thing. A branch compares its two registers, or zero, and one that
// tests what SLT, SLTI, SLTU or SLTIU left, against zero, says what those compared.
//
// For the route finder's search (host.c's `route`, tools/route.mjs): DP_UNPLAYED, when it's set, names a file of what's
// left to play of the EE's code, 32 bits each, an instruction's address plus 0 when it has never run, 1 when its branch
// has never been taken and 2 when it has never not been, and the search can look for any of it: the value at
// 0xFFFF0000, which no console has, is then how many of those happened in the frame just played. With DP_TARGET,
// "ADDRESS WHAT" (the address in hexadecimal, and 0, 1 or 2 as above), it counts that one thing alone. The value at
// 0xFFFF0004 is how many V-blanks the console has passed, which goes back with a saved state.

#ifndef DP_LIBRETRO_RAN_PS2_H
#define DP_LIBRETRO_RAN_PS2_H

static void* readAll(const char* path, size_t* size);

struct dpBlock;
// the core's dreamports_watch: what to tell of a block that ran, of an instruction about to, of a sector read and of a
// module the IOP loaded
typedef void (*ps2Watch)(void (*)(struct dpBlock*, uint32_t), void (*)(struct dpBlock*, uint32_t, const void*), void (*)(uint32_t), void (*)(uint32_t, uint32_t, uint32_t));

struct dpBlock {
	uint32_t processor, begin, count, step, branch;
	int32_t seen[3];   // the last frame, plus one, in which it ran, its branch was taken, and it wasn't
	uint32_t spare[4];
	uint32_t words[];
};

#define PS2_PROCESSORS 4
#define PS2_EE 0
#define PS2_IOP 1

// each processor's memory that code runs in: how much of it, and how many bytes a place is
static const uint32_t PS2_CODE_BYTES[PS2_PROCESSORS] = { 0x02000000, 0x00200000, 0x1000, 0x4000 };
static const uint32_t PS2_CODE_MASK[PS2_PROCESSORS] = { 0x1FFFFFFF, 0x1FFFFFFF, 0xFFF, 0x3FFF };

struct ps2Place { uint32_t record; uint32_t function; uint8_t inside; };

static struct {
	struct ps2Place* places[PS2_PROCESSORS];   // for each word, or each pair on a vector unit, of each processor's code
	FILE* contentFile;
	FILE* modulesFile;
	int32_t* sectorLast;   // for each sector, the last frame it was read in, plus one, and when its stretch began
	uint32_t* sectorStart;
	size_t sectors;
	int whyWatching;
} ps2;

static uint32_t ps2Index(uint32_t processor, uint32_t address) {
	uint32_t at = address & PS2_CODE_MASK[processor];
	if (at >= PS2_CODE_BYTES[processor]) return UINT32_MAX;
	return at / (processor < 2 ? 4 : 8);
}

static struct ps2Place* ps2PlaceOf(uint32_t processor, uint32_t address) {
	uint32_t index = ps2Index(processor, address);
	if (index == UINT32_MAX) return NULL;
	if (!ps2.places[processor]) ps2.places[processor] = calloc(PS2_CODE_BYTES[processor] / (processor < 2 ? 4 : 8), sizeof(struct ps2Place));
	return &ps2.places[processor][index];
}

// a record of what ran at a place, new when the place now holds another word than the record's
static struct ranPlayed* ps2Played(struct ps2Place* place, uint32_t processor, uint32_t address, uint32_t word) {
	if (place->record && ran.list[place->record - 1].code == word) return &ran.list[place->record - 1];
	if (ran.count == ran.room) {
		ran.room = ran.room ? ran.room * 2 : 1 << 14;
		ran.list = realloc(ran.list, ran.room * sizeof(struct ranPlayed));
	}
	struct ranPlayed* new = &ran.list[ran.count++];
	new->place = address & PS2_CODE_MASK[processor];
	new->code = word;
	new->processor = processor;
	for (int what = 0; what < HAPPENINGS; what++) new->last[what] = -1;
	place->record = (uint32_t) ran.count;
	return new;
}

// What the emulator calls as a block ends: every instruction of it ran, but a likely branch's delay slot when it wasn't
// taken, and a vector unit's pair after a delay slot with its E bit when it wasn't
static void ps2BlockRan(struct dpBlock* block, uint32_t taken) {
	int way = !block->branch ? -1 : taken ? TAKEN : NOT_TAKEN;
	int32_t now = (int32_t) ran.frame + 1;
	int first = block->seen[RAN] != now, wayFirst = way >= 0 && block->seen[way] != now;
	if (!first && !wayFirst) return;
	block->seen[RAN] = now;
	if (way >= 0) block->seen[way] = now;
	// a likely branch's delay slot runs only when it's taken, and a vector unit's pair after a delay slot with its E bit
	// only when its branch isn't, its word kept after the block's
	uint32_t count = block->count - (block->branch == 2 && way == NOT_TAKEN ? 1 : 0) + (block->branch == 3 && way == NOT_TAKEN ? 1 : 0);
	for (uint32_t i = 0; i < count; i++) {
		uint32_t address = block->begin + i * block->step;
		struct ps2Place* place = ps2PlaceOf(block->processor, address);
		if (!place) {
			if (first) ran.elsewhere++;
			continue;
		}
		if (first) {
			if (place->function) {
				struct ranFunction* f = &ran.functions[place->function - 1];
				if (!f->hasWord || f->word == block->words[i]) ranStarted(f, 0, 0);
			}
			if (!place->inside) ran.outside++;
		}
		if (!ran.playedFile) continue;
		struct ranPlayed* played = ps2Played(place, block->processor, address, block->words[i]);
		ranHappened(played, RAN);
		if (i == block->count - 2 && way >= 0) ranHappened(played, way);
	}
}

static void ps2SectorRead(uint32_t sector) {
	if (!ps2.contentFile) return;
	if (sector >= ps2.sectors) {
		size_t size = ((size_t) sector / 0x10000 + 1) * 0x10000;
		ps2.sectorLast = realloc(ps2.sectorLast, size * sizeof(int32_t));
		ps2.sectorStart = realloc(ps2.sectorStart, size * sizeof(uint32_t));
		memset(ps2.sectorLast + ps2.sectors, 0, (size - ps2.sectors) * sizeof(int32_t));
		ps2.sectors = size;
	}
	int32_t now = (int32_t) ran.frame + 1, last = ps2.sectorLast[sector];
	if (last == now) return;
	if (last != now - 1) {
		if (last) {
			uint32_t record[3] = { sector, ps2.sectorStart[sector], (uint32_t) last - 1 };
			fwrite(record, 4, 3, ps2.contentFile);
		}
		ps2.sectorStart[sector] = (uint32_t) ran.frame;
	}
	ps2.sectorLast[sector] = now;
}

// the IOP has loaded a module: where, and which, and the code that was there is gone
static void ps2ModuleLoaded(uint32_t base, uint32_t end, uint32_t hash) {
	if (ps2.places[PS2_IOP]) {
		for (uint32_t at = base & ~3u; at < end; at += 4) {
			uint32_t index = ps2Index(PS2_IOP, at);
			if (index != UINT32_MAX) ps2.places[PS2_IOP][index].record = 0;
		}
	}
	if (!ps2.modulesFile) return;
	uint32_t record[4] = { (uint32_t) ran.frame, base & PS2_CODE_MASK[PS2_IOP], end & PS2_CODE_MASK[PS2_IOP], hash };
	fwrite(record, 4, 4, ps2.modulesFile);
}

// What a branch went by, for DP_WHY: where each register's value came from, and what SLT and its kin compared
#define PS2_WHY_EACH 24
#define PS2_WHY_SLOTS (1u << 18)
#define PS2_FROM_MEMORY 1
#define PS2_FROM_CODE 2
#define PS2_CHANGED 4
struct ps2Came { uint32_t address, kind; };
struct ps2Compared { int valid; uint32_t pc, a, b; struct ps2Came fromA, fromB; };
static struct {
	FILE* file;
	uint32_t* targets;
	size_t targetCount;
	uint8_t* sets;
	uint32_t (*more)[3];
	uint32_t (*records)[12];
	size_t count;
	// for the EE and the IOP: where each register came from, what it held before the last instruction, which registers
	// that instruction wrote, and for a register SLT and its kin wrote, what they compared
	struct { struct ps2Came from[32]; struct ps2Compared compared[32]; uint32_t last[32]; uint32_t wrote; int have; } cpu[2];
	struct { int valid; uint32_t pc, address, a, b; struct ps2Came fromA, fromB; } pending[2];
} ps2why;

static int ps2ByAddress(const void* a, const void* b) { return (*(const uint32_t*) a > *(const uint32_t*) b) - (*(const uint32_t*) a < *(const uint32_t*) b); }

static void ps2WhyOpen(const char* asked) {
	char list[4096], path[4096];
	size_t size;
	if (sscanf(asked, "%4095s %4095[^\n]", list, path) != 2 || !(ps2why.file = fopen(path, "wb"))) { fprintf(err, "DP_WHY takes a file of branches and a file to write\n"); exit(2); }
	ps2why.targets = readAll(list, &size);
	ps2why.targetCount = size / 4;
	qsort(ps2why.targets, ps2why.targetCount, 4, ps2ByAddress);
	ps2why.sets = calloc(ps2why.targetCount + 1, 1);
	ps2why.more = calloc(ps2why.targetCount + 1, sizeof(*ps2why.more));
	ps2why.records = calloc(PS2_WHY_SLOTS, sizeof(*ps2why.records));
	for (int c = 0; c < 2; c++) ps2why.cpu[c].from[0] = (struct ps2Came) { 0, PS2_FROM_CODE };
	ps2.whyWatching = 1;
}

// what a register worked out from others comes from: one followed from memory when nothing else from memory went in,
// a number in the code when everything was, and nowhere that's followed otherwise
static struct ps2Came ps2WorkedOut(const struct ps2Came* sources, int count, int moves) {
	int fromMemory = 0, unknown = 0;
	struct ps2Came result = { 0, PS2_FROM_CODE };
	for (int i = 0; i < count; i++) {
		if ((sources[i].kind & 3) == PS2_FROM_MEMORY) { fromMemory++; result = sources[i]; }
		else if (!(sources[i].kind & 3)) unknown++;
	}
	if (unknown || fromMemory > 1) return (struct ps2Came) { 0, 0 };
	if (fromMemory && !moves) result.kind |= PS2_CHANGED;
	return result;
}

// How an instruction about to run changes where its registers come from, and what it compares
static void ps2WhyStep(struct dpBlock* block, uint32_t position, const void* registers) {
	if (block->processor > PS2_IOP) return;
	int c = (int) block->processor;
	const uint32_t* regs = registers;   // 128 bits a register, its lowest 32 first
	uint32_t value[32];
	for (int r = 0; r < 32; r++) value[r] = regs[r * 4];
	// a register that changed with no instruction of the processor's own writing it, as a call to the system leaves
	// one, came from nowhere that's followed
	if (ps2why.cpu[c].have) {
		for (int r = 1; r < 32; r++) {
			if (value[r] != ps2why.cpu[c].last[r] && !(ps2why.cpu[c].wrote >> r & 1)) {
				ps2why.cpu[c].from[r] = (struct ps2Came) { 0, 0 };
				ps2why.cpu[c].compared[r].valid = 0;
			}
		}
	}
	memcpy(ps2why.cpu[c].last, value, sizeof(value));
	ps2why.cpu[c].have = 1;
	ps2why.cpu[c].wrote = 0;
	uint32_t pc = block->begin + position * 4, w = block->words[position];
	uint32_t op = w >> 26, rs = w >> 21 & 31, rt = w >> 16 & 31, rd = w >> 11 & 31, funct = w & 63, sa = w >> 6 & 31;
	int32_t imm = (int16_t) (w & 0xFFFF);
	struct ps2Came* from = ps2why.cpu[c].from;
	int to = -1;
	struct ps2Came result = { 0, 0 };
	struct ps2Compared compared = { 0 };

	// a branch asked about: what it compares, kept until its block ends and says which way it went
	if (ps2why.targetCount && bsearch(&pc, ps2why.targets, ps2why.targetCount, 4, ps2ByAddress)) {
		int against = -1, alone = -1;
		if (op == 0x04 || op == 0x05 || op == 0x14 || op == 0x15) {
			if (rt == 0 && ps2why.cpu[c].compared[rs].valid) alone = (int) rs;
			else if (rs == 0 && ps2why.cpu[c].compared[rt].valid) alone = (int) rt;
			else against = (int) rt;
		} else if (op == 0x01 || op == 0x06 || op == 0x07 || op == 0x16 || op == 0x17) against = 0;
		if (alone >= 0) {
			const struct ps2Compared* by = &ps2why.cpu[c].compared[alone];
			ps2why.pending[c] = (typeof(ps2why.pending[c])) { 1, by->pc, pc, by->a, by->b, by->fromA, by->fromB };
		} else if (against >= 0) {
			ps2why.pending[c] = (typeof(ps2why.pending[c])) { 1, pc, pc, value[rs], value[against], from[rs], from[against] };
		} else {
			ps2why.pending[c] = (typeof(ps2why.pending[c])) { 1, pc, pc, 0, 0, { 0, 0 }, { 0, 0 } };
		}
	}

	switch (op) {
	case 0x00: {
		if (!w) return;
		// SLL, SRL, SRA and the 64-bit shifts by a number: a shift by nothing moves
		if (funct == 0x00 || funct == 0x02 || funct == 0x03 || funct == 0x38 || funct == 0x3A || funct == 0x3B || funct == 0x3C || funct == 0x3E || funct == 0x3F) {
			to = (int) rd;
			result = ps2WorkedOut(&from[rt], 1, sa == 0 && funct < 0x38);
		} else if (funct == 0x21 || funct == 0x20 || funct == 0x2D || funct == 0x2C || funct == 0x25 || funct == 0x26 || funct == 0x23 || funct == 0x22 || funct == 0x2F || funct == 0x2E) {
			// ADDU, ADD, DADDU, DADD, OR, XOR, SUBU, SUB, DSUBU, DSUB: with $zero on the right, a move
			struct ps2Came sources[2] = { from[rs], from[rt] };
			to = (int) rd;
			if (rt == 0) result = ps2WorkedOut(&from[rs], 1, 1);
			else if (rs == 0 && funct != 0x23 && funct != 0x22 && funct != 0x2F && funct != 0x2E) result = ps2WorkedOut(&from[rt], 1, 1);
			else result = ps2WorkedOut(sources, 2, 0);
		} else if (funct == 0x24 || funct == 0x27) {
			struct ps2Came sources[2] = { from[rs], from[rt] };
			to = (int) rd;
			result = ps2WorkedOut(sources, 2, 0);
		} else if (funct == 0x2A || funct == 0x2B) {
			// SLT, SLTU
			to = (int) rd;
			compared = (struct ps2Compared) { 1, pc, value[rs], value[rt], from[rs], from[rt] };
		} else if (funct == 0x09) {
			// JALR leaves where it returns to, a number of the code's
			to = (int) rd;
			result = (struct ps2Came) { 0, PS2_FROM_CODE };
		} else if (funct != 0x08 && funct != 0x0C && funct != 0x0D && funct != 0x0F && funct != 0x11 && funct != 0x13 && funct != 0x1A && funct != 0x1B && funct != 0x1E && funct != 0x1F && !(funct >= 0x30 && funct <= 0x36)) {
			to = (int) rd;
		}
		break;
	}
	case 0x01:
		// BLTZAL, BGEZAL and their likely kin leave where they return to
		if (rt >= 0x10 && rt <= 0x13) { to = 31; result = (struct ps2Came) { 0, PS2_FROM_CODE }; }
		break;
	case 0x03:
		to = 31;
		result = (struct ps2Came) { 0, PS2_FROM_CODE };
		break;
	case 0x08: case 0x09: case 0x18: case 0x19: case 0x0C: case 0x0D: case 0x0E:
		// ADDI, ADDIU, DADDI, DADDIU, ANDI, ORI, XORI: from $zero a number in the code, and adding nothing moves
		to = (int) rt;
		result = rs == 0 ? (struct ps2Came) { 0, PS2_FROM_CODE } : ps2WorkedOut(&from[rs], 1, imm == 0 && op != 0x0C);
		break;
	case 0x0A: case 0x0B:
		// SLTI, SLTIU
		to = (int) rt;
		compared = (struct ps2Compared) { 1, pc, value[rs], (uint32_t) imm, from[rs], { 0, PS2_FROM_CODE } };
		break;
	case 0x0F:
		to = (int) rt;
		result = (struct ps2Came) { 0, PS2_FROM_CODE };
		break;
	case 0x20: case 0x24: case 0x21: case 0x25: case 0x23: case 0x27: case 0x37: case 0x1E: {
		// LB, LBU, LH, LHU, LW, LWU, LD, LQ: read from memory, its first four bytes at most compared
		uint32_t bytes = op == 0x20 || op == 0x24 ? 1 : op == 0x21 || op == 0x25 ? 2 : 4, address = value[rs] + (uint32_t) imm;
		if (op == 0x1E) address &= ~15u;
		to = (int) rt;
		result = (struct ps2Came) { address, PS2_FROM_MEMORY | bytes << 8 };
		break;
	}
	case 0x22: case 0x26: case 0x1A: case 0x1B: case 0x1C:
		// LWL, LWR, LDL, LDR, which merge, and the multimedia instructions
		to = op == 0x1C ? (int) rd : (int) rt;
		break;
	case 0x10: case 0x11: case 0x12:
		// what moves from a coprocessor to a register: MFC, CFC, and QMFC2
		if (rs == 0 || rs == 1 || rs == 2) to = (int) rt;
		break;
	default:
		break;
	}
	if (to > 0) {
		from[to] = result;
		ps2why.cpu[c].compared[to] = compared;
		ps2why.cpu[c].wrote |= 1u << to;
	}
}

// a branch asked about has gone a way: one record more of what it went by
static void ps2WhyWent(struct dpBlock* block, int way) {
	int c = (int) block->processor;
	if (c > PS2_IOP || !ps2why.pending[c].valid) return;
	uint32_t branchAt = block->begin + (block->count - 2) * 4;
	if (ps2why.pending[c].address != branchAt) return;
	ps2why.pending[c].valid = 0;
	uint32_t pc = branchAt, frame = (uint32_t) ran.frame;
	uint32_t* asked = bsearch(&pc, ps2why.targets, ps2why.targetCount, 4, ps2ByAddress);
	if (!asked) return;
	size_t which = (size_t) (asked - ps2why.targets);
	uint32_t record[12] = { ps2why.pending[c].pc, ps2why.pending[c].a, ps2why.pending[c].b, ps2why.pending[c].fromA.address, ps2why.pending[c].fromA.kind, ps2why.pending[c].fromB.address, ps2why.pending[c].fromB.kind, (uint32_t) way, 1, frame, pc, 0 };
	uint32_t hash = pc * 2654435761u;
	for (int i = 0; i < 8; i++) hash = (hash ^ record[i]) * 16777619u;
	for (uint32_t slot = hash & (PS2_WHY_SLOTS - 1), tried = 0; tried < PS2_WHY_SLOTS; slot = (slot + 1) & (PS2_WHY_SLOTS - 1), tried++) {
		uint32_t* held = ps2why.records[slot];
		if (held[8] && held[10] == pc && !memcmp(held, record, 8 * sizeof(uint32_t))) { held[8]++; return; }
		if (held[8]) continue;
		if (ps2why.sets[which] < PS2_WHY_EACH && ps2why.count < PS2_WHY_SLOTS / 2) {
			memcpy(held, record, sizeof(record));
			ps2why.sets[which]++;
			ps2why.count++;
			return;
		}
		break;
	}
	if (!ps2why.more[which][0] && !ps2why.more[which][1]) ps2why.more[which][2] = frame;
	ps2why.more[which][way == TAKEN ? 0 : 1]++;
}

// The search for what hasn't been played: which of each word of the EE's memory is wanted, a bit for running and one
// for each way of a branch, or the one thing aimed at, and how many of them happened in the frame being played
static struct {
	uint8_t* wanted;
	int aimed, what;
	uint32_t target, untouched;
} ps2search;

// a block ran: each thing of it that's wanted has happened. A block with nothing wanted is known as one after its first time
static void ps2SearchRan(struct dpBlock* block, uint32_t taken) {
	if (block->processor != PS2_EE || block->spare[0] == 1) return;
	int way = !block->branch ? -1 : taken ? TAKEN : NOT_TAKEN, any = 0;
	uint32_t count = block->count - (block->branch == 2 && way == NOT_TAKEN ? 1 : 0);
	if (ps2search.aimed) {
		uint32_t at = (ps2search.target - block->begin) / 4;
		if (ps2search.target < block->begin || at >= block->count) { block->spare[0] = 1; return; }
		if (ps2search.what == RAN ? at < count : at == block->count - 2 && way == ps2search.what) ps2search.untouched++;
		return;
	}
	for (uint32_t i = 0; i < block->count; i++) {
		uint32_t index = ps2Index(PS2_EE, block->begin + i * 4);
		uint8_t wanted = index == UINT32_MAX ? 0 : ps2search.wanted[index];
		if (!wanted) continue;
		any = 1;
		if (i < count && wanted & 1 << RAN) ps2search.untouched++;
		if (i == block->count - 2 && way >= 0 && wanted & 1 << way) ps2search.untouched++;
	}
	if (!any) block->spare[0] = 1;
}

/** Starts the search's count, before the game loads, with the core's `watch`. Whether anything was asked for. */
static int ps2SearchOpen(ps2Watch watch) {
	const char* unplayed = getenv("DP_UNPLAYED");
	const char* target = getenv("DP_TARGET");
	unsigned address, what;
	if (target && sscanf(target, "%x %u", &address, &what) == 2 && what < HAPPENINGS) {
		ps2search.aimed = 1;
		ps2search.target = address & PS2_CODE_MASK[PS2_EE];
		ps2search.what = (int) what;
	} else if (unplayed) {
		size_t size;
		uint32_t* list = readAll(unplayed, &size);
		ps2search.wanted = calloc(PS2_CODE_BYTES[PS2_EE] / 4, 1);
		for (size_t i = 0; list && i < size / 4; i++) {
			uint32_t index = ps2Index(PS2_EE, list[i] & ~3u);
			if (index != UINT32_MAX && (list[i] & 3) < HAPPENINGS) ps2search.wanted[index] |= (uint8_t) (1 << (list[i] & 3));
		}
		free(list);
	} else return 0;
	watch(ps2SearchRan, NULL, NULL, NULL);
	return 1;
}

static void startsBlockRan(uint32_t begin, uint32_t count);   // starts.h

static void ps2Ran(struct dpBlock* block, uint32_t taken) {
	if (ps2.whyWatching && block->branch) ps2WhyWent(block, taken ? TAKEN : NOT_TAKEN);
	// a function's start as play reaches it, for the function check's memories of play (starts.h)
	if (block->processor == PS2_EE) startsBlockRan(block->begin, block->count);
	ps2BlockRan(block, taken);
}

/** Starts it, before the game loads: `watch` is the core's dreamports_watch. The functions of FUNCTIONS go to their
 *  places, each processor's own (ran.h has read them). */
static void ps2Open(ps2Watch watch, const uint32_t* functions) {
	for (size_t i = 0; i < ran.functionCount; i++) {
		uint32_t address = functions[i * 6], size = functions[i * 6 + 1], marks = functions[i * 6 + 3], processor = marks >> 8 & 0xFF;
		if (processor >= PS2_PROCESSORS || !size) continue;
		uint32_t unit = processor < 2 ? 4 : 8;
		for (uint32_t at = 0; at < size; at += unit) {
			struct ps2Place* place = ps2PlaceOf(processor, address + at);
			if (!place) break;
			place->inside = 1;
			if (!at) place->function = (uint32_t) i + 1;
		}
		// a function that counts only with its first word there
		ran.functions[i].hasWord = (marks & 0xFF) != 0;
		ran.functions[i].word = functions[i * 6 + 4];
	}
	const char* content = getenv("DP_CONTENT");
	if (content && !(ps2.contentFile = fopen(content, "wb"))) ranCant(content);
	const char* modules = getenv("DP_MODULES");
	if (modules && !(ps2.modulesFile = fopen(modules, "wb"))) ranCant(modules);
	if (getenv("DP_WHY")) ps2WhyOpen(getenv("DP_WHY"));
	watch(ps2Ran, ps2.whyWatching ? ps2WhyStep : NULL, ps2.contentFile ? ps2SectorRead : NULL, ps2ModuleLoaded);
}

static void ps2Close(void) {
	if (ps2.modulesFile) fclose(ps2.modulesFile);
	if (ps2.contentFile) {
		for (size_t sector = 0; sector < ps2.sectors; sector++) {
			if (!ps2.sectorLast[sector]) continue;
			uint32_t record[3] = { (uint32_t) sector, ps2.sectorStart[sector], (uint32_t) ps2.sectorLast[sector] - 1 };
			fwrite(record, 4, 3, ps2.contentFile);
		}
		fclose(ps2.contentFile);
	}
	if (ps2why.file) {
		for (uint32_t slot = 0; slot < PS2_WHY_SLOTS; slot++) if (ps2why.records[slot][8]) fwrite(ps2why.records[slot], 4, 12, ps2why.file);
		for (size_t i = 0; i < ps2why.targetCount; i++) {
			for (int way = 0; way < 2; way++) {
				if (!ps2why.more[i][way]) continue;
				uint32_t record[12] = { 0, 0, 0, 0, 0, 0, 0, way ? NOT_TAKEN : TAKEN, ps2why.more[i][way], ps2why.more[i][2], ps2why.targets[i], 1 };
				fwrite(record, 4, 12, ps2why.file);
			}
		}
		fclose(ps2why.file);
	}
}

#endif
