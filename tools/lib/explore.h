// The route finder's search (tools/route.mjs), the same for every console: the program that runs a console's original
// includes this and gives it the few things the emulator can do (struct ex_machine), and it finds the buttons that take the
// game from where a list of presses left it to a goal. tools/gba/original.c runs it in mGBA and tools/libretro/host.c in
// any libretro core.
//
// It never plays from the start twice. It keeps a copy of the console's state at every new place the game reaches, a
// place being a cell of a grid over a few of the game's own values, such as where the character is. Then, again and
// again, it picks a place, brings its state back, holds some buttons for a few frames and keeps whatever new places that
// reaches, each with the buttons that led there from the place before. Places nobody has tried much, and the newest
// ones, are picked most, so it spreads out like water until a frame meets the goal. That is the search known as
// Go-Explore, which needs nothing of the game but those values. A place keeps more than one state when the game says
// what tells two of them apart, such as how fast the character is moving: what can be done from a place often depends
// on the speed it was reached with, and speed is built up over ground that was reached long before. And a place can keep
// a few states from later on, for what can only be done there after a wait.
//
// What to search for comes in a text file, a word and its numbers to a line (lib/route.mjs writes it):
//   prefix FILE         the buttons that lead to where the search starts, as the program's BUTTONS has them
//   sets FILE           the values to write to the work memory on the way, as the program's SETS has them, or -
//   archive FILE        where it keeps what it has found, and reads it from when the file is there, to go on
//   out FILE            where the buttons to the goal go, as BUTTONS has them, from the search's first frame
//   value ADDRESS BYTES SIGNED
//                       a value in the work memory: its place, 1, 2 or 4 bytes, and 1 when it can be negative
//   value-found FROM TO STEP MARK MARKBYTES POINTER POINTERBYTES BASE OFFSET BYTES SIGNED
//                       a value in memory the game hands out as it goes, found by something beside it: the first place
//                       from FROM to TO, STEP apart, that holds MARK, and from there POINTER bytes on, the POINTERBYTES
//                       that say where its record is, counted from BASE, and the value OFFSET into that. With
//                       POINTERBYTES 0 the record is where MARK is. While nothing holds MARK the value is -1
//   cell VALUE SIZE     a side of the grid: the value, by its place in this file, and how much of it one cell covers
//   apart VALUE SIZE    what tells two states of one place apart, the same way: a place keeps one state for each
//   wait FRAMES STATES  a place also keeps a state for each stretch of FRAMES frames after the search first reached it,
//                       up to STATES of them, so that it can wait there for what only comes later, such as a platform
//                       that moves
//   lost GROUP VALUE OP NUMBER
//                       play that can't go on, such as a life lost: every line of one GROUP holding at once
//   goal GROUP VALUE OP NUMBER
//                       where to get to, the same way. OP is 0 =, 1 !=, 2 <, 3 <=, 4 >, 5 >=, 6 has a bit of, 7 has no bit of
//   buttons MASK        a set of buttons the search may hold, one line each
//   seed N, seconds N, stale N, megabytes N
//                       its dice, and when to give up: after that long, after that many tries with nothing new and 60 more
//                       for each place it has reached, or
//                       when its copies take that much memory
//   threads N           how many consoles search at the same time, each on a thread of its own, sharing what they find.
//                       With 1, the same seed finds the same route every time
//
// It prints a line of numbers every two seconds (`at SECONDS tries N frames N places N states N megabytes N newest V…`),
// and ends with `goal FRAMES`, the frames from the search's start to the goal, or `stopped WHY`. The archive has no
// state in it, only buttons and the game's values at each place, so it's small, and going on from one plays it again.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
typedef HANDLE ex_thread;
typedef CRITICAL_SECTION ex_lock;
#define exLockInit(lock) InitializeCriticalSection(lock)
#define exLockTake(lock) EnterCriticalSection(lock)
#define exLockGive(lock) LeaveCriticalSection(lock)
#define exRest() Sleep(50)
static double exNow(void) { return GetTickCount64() / 1000.0; }
#else
#include <pthread.h>
typedef pthread_t ex_thread;
typedef pthread_mutex_t ex_lock;
#define exLockInit(lock) pthread_mutex_init(lock, NULL)
#define exLockTake(lock) pthread_mutex_lock(lock)
#define exLockGive(lock) pthread_mutex_unlock(lock)
#define exRest() nanosleep(&(struct timespec) { 0, 50000000 }, NULL)
static double exNow(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return now.tv_sec + now.tv_nsec / 1e9;
}
#endif

/** What the search needs of an emulator, each with the `console` it's of: a frame with these buttons held, its state's
 *  size, a copy of it out and in, a value of the work memory (0 when the address isn't in it), and a value written there,
 *  on the way to where the search starts. */
struct ex_machine {
	void* console;
	void (*frame)(void* console, uint32_t buttons);
	size_t stateSize;
	void (*save)(void* console, void* to);
	void (*load)(void* console, const void* from);
	int (*read)(void* console, uint32_t address, uint32_t bytes, uint32_t* value);
	void (*set)(void* console, uint32_t address, uint32_t bytes, uint32_t value);
};

#define EX_VALUES 24
#define EX_SIDES 6
#define EX_CONDITIONS 32
#define EX_BUTTONS 64
#define EX_THREADS 32
// a try holds buttons for stretches of these many frames, and goes on until it has found nothing new for a while, one of
// EX_PATIENCE frames, so that what it started has time to end, such as a jump that lands somewhere new. Never past EX_TRY
static const int EX_STRETCHES[] = { 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64 };
static const int EX_PATIENCE[] = { 24, 48, 90, 180 };
#define EX_TRY 600
// the newest places, which are picked most: this many, and EX_NEWEST_EACH more for each thread
#define EX_NEWEST 32
#define EX_NEWEST_EACH 8
// a place whose tries all ended in play that can't go on, this many in a row, gives way to the next arrival, and so does
// one a try found in its last EX_FALL frames before play couldn't go on, such as on the way down a pit
#define EX_DOOMED 6
#define EX_FALL 90

struct ex_value { int found; uint32_t address, bytes, isSigned, from, to, step, mark, markBytes, pointer, pointerBytes, base, offset; };
struct ex_condition { int group, value, op; int64_t number; };
struct ex_node { int32_t parent; uint32_t count, first, frames, held; int64_t values[EX_VALUES]; uint8_t* state; uint32_t stateBytes; };
// a state a place keeps, and a place, with the states it keeps by their numbers
struct ex_cell { int64_t key[EX_SIDES + 1]; int32_t node; uint32_t place, chosen, deaths; };
struct ex_place { uint32_t* cells; uint32_t count, room, chosen, doomed, first; };
// one console searching: its emulator, its dice and room for what a try needs
struct ex_worker { struct ex_machine machine; uint64_t dice; uint8_t* scratch; uint32_t pending[EX_TRY + 64]; struct { size_t cell; int at; } made[EX_TRY + 64]; ex_thread thread; };

static struct ex_value exValues[EX_VALUES];
static int exValueCount;
static struct { int value; int64_t size; } exSides[EX_SIDES];
static int exSideCount, exPlaceSides;   // the grid's sides come first, then what tells a place's states apart
static int exKeySides;                  // and last, when a place keeps states from later on, how much later
static long exWaitFrames, exWaitStates;
static struct ex_condition exLost[EX_CONDITIONS], exGoal[EX_CONDITIONS];
static int exLostCount, exGoalCount;
static struct { uint32_t mask; double tried, found; } exButtons[EX_BUTTONS];
static int exButtonCount;
static char exPrefix[512], exSets[512] = "-", exArchive[512], exOut[512];
static double exSeconds = 600, exMegabytes = 1500;
static long exStale = 20000;
static uint64_t exSeed = 0x9E3779B97F4A7C15ull;
static int exThreads = 1;

// what the consoles share, which only the one holding exShared touches
static ex_lock exShared;
static struct ex_node* exNodes;
static size_t exNodeCount, exNodeRoom;
static uint32_t* exPool;
static size_t exPoolCount, exPoolRoom;
static struct ex_cell* exCells;
static size_t exCellCount, exCellRoom;
static int32_t* exTable;
static size_t exTableSize;
static struct ex_place* exPlaces;
static size_t exPlaceCount, exPlaceRoom;
static int32_t* exPlaceTable;
static size_t exPlaceTableSize;
static size_t exStateBytes;  // what the copies take now
static long exTries, exFrames, exSinceNew;
static int32_t exGoalNode = -1;
static volatile int exOver;
static uint8_t* exRoot;      // the state the search starts from, which every other is kept as its difference from
static size_t exStateSize;

// where it says how far it has got, and what went wrong: the program's own, unless the program keeps those for something else
static FILE* exSaid;
static FILE* exErrors;

static void exFail(const char* what) {
	fprintf(exErrors ? exErrors : stderr, "%s\n", what);
	exit(2);
}

static uint64_t exRoll(uint64_t* dice) {
	*dice ^= *dice >> 12;
	*dice ^= *dice << 25;
	*dice ^= *dice >> 27;
	return *dice * 0x2545F4914F6CDD1Dull;
}
static double exChance(uint64_t* dice) { return (exRoll(dice) >> 11) * (1.0 / 9007199254740992.0); }

// a state as its difference from the first: runs of 8 bytes that are the same, then those that differ, turn about
static uint8_t* exPack(const uint8_t* state, uint32_t* bytes) {
	size_t words = exStateSize / 8, room = 4096, used = 0;
	uint8_t* out = malloc(room);
	size_t at = 0;
	while (at < words) {
		uint32_t same = 0, differ = 0;
		while (at + same < words && !memcmp(state + (at + same) * 8, exRoot + (at + same) * 8, 8)) same++;
		while (at + same + differ < words && memcmp(state + (at + same + differ) * 8, exRoot + (at + same + differ) * 8, 8)) differ++;
		if (used + 8 + differ * 8 > room) {
			room = (used + 8 + differ * 8) * 2;
			out = realloc(out, room);
		}
		memcpy(out + used, &same, 4);
		memcpy(out + used + 4, &differ, 4);
		memcpy(out + used + 8, state + (at + same) * 8, (size_t) differ * 8);
		used += 8 + (size_t) differ * 8;
		at += same + differ;
	}
	// the few bytes after the last whole 8, as they are
	size_t rest = exStateSize - words * 8;
	out = realloc(out, used + rest + 1);
	memcpy(out + used, state + words * 8, rest);
	*bytes = (uint32_t) (used + rest);
	return out;
}

static void exUnpack(const uint8_t* packed, uint8_t* state) {
	size_t words = exStateSize / 8, at = 0, used = 0;
	memcpy(state, exRoot, exStateSize);
	while (at < words) {
		uint32_t same, differ;
		memcpy(&same, packed + used, 4);
		memcpy(&differ, packed + used + 4, 4);
		memcpy(state + (at + same) * 8, packed + used + 8, (size_t) differ * 8);
		used += 8 + (size_t) differ * 8;
		at += same + differ;
	}
	memcpy(state + words * 8, packed + used, exStateSize - words * 8);
}

static int64_t exExtend(uint32_t value, uint32_t bytes, uint32_t isSigned) {
	if (!isSigned || bytes == 4) return isSigned ? (int64_t) (int32_t) value : (int64_t) value;
	return bytes == 1 ? (int64_t) (int8_t) value : (int64_t) (int16_t) value;
}

// the game's values now. One the game keeps in memory it hands out as it goes is -1 while nothing holds its mark
static void exRead(const struct ex_machine* machine, int64_t* values) {
	for (int i = 0; i < exValueCount; i++) {
		const struct ex_value* v = &exValues[i];
		uint32_t raw = 0, address = v->address;
		values[i] = -1;
		if (v->found) {
			int here = 0;
			for (uint32_t at = v->from; at < v->to && !here; at += v->step) {
				if (machine->read(machine->console, at, v->markBytes, &raw) && raw == v->mark) {
					here = 1;
					address = at;
				}
			}
			if (!here) continue;
			if (v->pointerBytes) {
				if (!machine->read(machine->console, address + v->pointer, v->pointerBytes, &raw)) continue;
				address = v->base + raw;
			}
			address += v->offset;
		}
		if (machine->read(machine->console, address, v->bytes, &raw)) values[i] = exExtend(raw, v->bytes, v->isSigned);
		else if (!v->found) exFail("The search can only read the console's work memory, and one of the game's values isn't in it.");
	}
}

// whether every line of one group holds
static int exHolds(const struct ex_condition* list, int count, const int64_t* values) {
	for (int i = 0; i < count; i++) {
		if (i && list[i].group == list[i - 1].group) continue;
		int all = 1;
		for (int k = i; k < count && list[k].group == list[i].group && all; k++) {
			int64_t v = values[list[k].value], n = list[k].number;
			switch (list[k].op) {
			case 0: all = v == n; break;
			case 1: all = v != n; break;
			case 2: all = v < n; break;
			case 3: all = v <= n; break;
			case 4: all = v > n; break;
			case 5: all = v >= n; break;
			case 6: all = (v & n) != 0; break;
			default: all = (v & n) == 0; break;
			}
		}
		if (all) return 1;
	}
	return 0;
}

// a state's key but for how late it is, which only the places can say (exLateness)
static void exKey(const int64_t* values, int64_t* key) {
	for (int i = 0; i < exSideCount; i++) {
		int64_t v = values[exSides[i].value], size = exSides[i].size;
		key[i] = v >= 0 ? v / size : -((-v + size - 1) / size);
	}
	key[exSideCount] = 0;
}

static uint64_t exHash(const int64_t* key, int sides) {
	uint64_t hash = 0xCBF29CE484222325ull;
	for (int i = 0; i < sides; i++) hash = (hash ^ (uint64_t) key[i]) * 0x100000001B3ull, hash ^= hash >> 29;
	return hash;
}

// where a state with this key is, or would go, among the states
static int32_t* exSlot(const int64_t* key) {
	size_t at = exHash(key, exKeySides) & (exTableSize - 1);
	while (exTable[at] >= 0 && memcmp(exCells[exTable[at]].key, key, sizeof(int64_t) * exKeySides)) at = (at + 1) & (exTableSize - 1);
	return &exTable[at];
}

// and where its place is, or would go, among the places: a place's key is its first state's, as far as the grid goes
static int32_t* exPlaceSlot(const int64_t* key) {
	size_t at = exHash(key, exPlaceSides) & (exPlaceTableSize - 1);
	while (exPlaceTable[at] >= 0 && memcmp(exCells[exPlaces[exPlaceTable[at]].cells[0]].key, key, sizeof(int64_t) * exPlaceSides)) at = (at + 1) & (exPlaceTableSize - 1);
	return &exPlaceTable[at];
}

static void exGrowTable(void) {
	exTableSize = exTableSize ? exTableSize * 2 : 4096;
	exTable = realloc(exTable, exTableSize * sizeof(int32_t));
	for (size_t i = 0; i < exTableSize; i++) exTable[i] = -1;
	for (size_t i = 0; i < exCellCount; i++) *exSlot(exCells[i].key) = (int32_t) i;
}

static void exGrowPlaceTable(void) {
	exPlaceTableSize = exPlaceTableSize ? exPlaceTableSize * 2 : 4096;
	exPlaceTable = realloc(exPlaceTable, exPlaceTableSize * sizeof(int32_t));
	for (size_t i = 0; i < exPlaceTableSize; i++) exPlaceTable[i] = -1;
	for (size_t i = 0; i < exPlaceCount; i++) *exPlaceSlot(exCells[exPlaces[i].cells[0]].key) = (int32_t) i;
}

// a node: the buttons held since its parent and the game's values there, with its state, packed, when it stands for a place
static int32_t exAddNode(int32_t parent, const uint32_t* buttons, uint32_t count, uint32_t frames, const int64_t* values, uint8_t* state, uint32_t stateBytes) {
	if (exNodeCount == exNodeRoom) {
		exNodeRoom = exNodeRoom ? exNodeRoom * 2 : 4096;
		exNodes = realloc(exNodes, exNodeRoom * sizeof *exNodes);
	}
	if (exPoolCount + count > exPoolRoom) {
		exPoolRoom = (exPoolCount + count) * 2 + 4096;
		exPool = realloc(exPool, exPoolRoom * sizeof *exPool);
	}
	struct ex_node* node = &exNodes[exNodeCount];
	node->parent = parent;
	node->count = count;
	node->first = (uint32_t) exPoolCount;
	node->frames = frames;
	node->held = count ? buttons[count - 1] : parent >= 0 ? exNodes[parent].held : 0;
	memcpy(node->values, values, sizeof node->values);
	if (count) memcpy(exPool + exPoolCount, buttons, count * sizeof *exPool);
	exPoolCount += count;
	node->state = state;
	node->stateBytes = state ? stateBytes : 0;
	exStateBytes += node->stateBytes;
	return (int32_t) exNodeCount++;
}

// how often a state's tries ended in play that can't go on, kept with how many of its place's states are given up on
static void exSetDeaths(size_t cell, uint32_t deaths) {
	struct ex_place* place = &exPlaces[exCells[cell].place];
	place->doomed += (deaths >= EX_DOOMED) - (exCells[cell].deaths >= EX_DOOMED);
	exCells[cell].deaths = deaths;
}

// how late a frame reaches its place, in the key's last side: which stretch of the wait after the search first got there
static void exLateness(int64_t* key, uint32_t frames) {
	if (!exWaitStates || !exPlaceTableSize) return;
	int32_t place = *exPlaceSlot(key);
	if (place < 0 || frames <= exPlaces[place].first) return;
	int64_t late = (frames - exPlaces[place].first) / exWaitFrames;
	key[exSideCount] = late < exWaitStates ? late : exWaitStates;
}

// whether a frame that reached this state after this many frames would be kept: a new one, a sooner way to one, or one
// that takes the place of a way that led nowhere. *cell is the state, or -1 for a new one. It finishes the key
static int exWanted(int64_t* key, uint32_t frames, int32_t* cell) {
	exLateness(key, frames);
	if (exCellCount * 2 >= exTableSize) exGrowTable();
	*cell = *exSlot(key);
	return *cell < 0 || frames < exNodes[exCells[*cell].node].frames || exCells[*cell].deaths >= EX_DOOMED;
}

// Keeps what a frame reached, with its state, which is the caller's no more. Returns the state's number, or -1 when
// another got there first and the state is thrown away, with *isNew 2 for a place never reached before, 1 for a new
// state of a place, and *node its node.
static int32_t exArrive(int32_t parent, const uint32_t* buttons, uint32_t count, uint32_t frames, const int64_t* values, uint8_t* state, uint32_t stateBytes, int* isNew, int32_t* node) {
	int64_t key[EX_SIDES + 1];
	int32_t at;
	exKey(values, key);
	*isNew = 0;
	if (!exWanted(key, frames, &at)) {
		free(state);
		return -1;
	}
	if (at < 0) {
		if (exCellCount == exCellRoom) {
			exCellRoom = exCellRoom ? exCellRoom * 2 : 4096;
			exCells = realloc(exCells, exCellRoom * sizeof *exCells);
		}
		at = (int32_t) exCellCount++;
		memset(&exCells[at], 0, sizeof *exCells);
		memcpy(exCells[at].key, key, sizeof key);
		*exSlot(key) = at;
		// its place, which is new when this is the first state there
		if (exPlaceCount * 2 >= exPlaceTableSize) exGrowPlaceTable();
		int32_t* slot = exPlaceSlot(key);
		*isNew = *slot < 0 ? 2 : 1;
		if (*slot < 0) {
			if (exPlaceCount == exPlaceRoom) {
				exPlaceRoom = exPlaceRoom ? exPlaceRoom * 2 : 4096;
				exPlaces = realloc(exPlaces, exPlaceRoom * sizeof *exPlaces);
			}
			memset(&exPlaces[exPlaceCount], 0, sizeof *exPlaces);
			exPlaces[exPlaceCount].first = frames;
			*slot = (int32_t) exPlaceCount++;
		}
		struct ex_place* place = &exPlaces[*slot];
		if (place->count == place->room) {
			place->room = place->room ? place->room * 2 : 4;
			place->cells = realloc(place->cells, place->room * sizeof *place->cells);
		}
		place->cells[place->count++] = (uint32_t) at;
		exCells[at].place = (uint32_t) *slot;
	} else {
		struct ex_node* old = &exNodes[exCells[at].node];
		exStateBytes -= old->stateBytes;
		free(old->state);
		old->state = NULL;
		old->stateBytes = 0;
		exSetDeaths((size_t) at, 0);
	}
	*node = exCells[at].node = exAddNode(parent, buttons, count, frames, values, state, stateBytes);
	return at;
}

// A state to try from. First its place: one of the newest most of the time, or any, and the less tried the likelier.
// Then one of the place's states, the less tried and the less often fatal the likelier.
static size_t exChoose(uint64_t* dice) {
	size_t best = 0, window = EX_NEWEST + EX_NEWEST_EACH * (size_t) exThreads;
	for (int tries = 0; tries < 64; tries++) {
		size_t newest = exPlaceCount < window ? exPlaceCount : window;
		int fresh = exChance(dice) < 0.6;
		best = fresh ? exPlaceCount - 1 - exRoll(dice) % newest : exRoll(dice) % exPlaceCount;
		// a place whose every state led nowhere is hardly worth a try
		double weight = 1.0 / (1.0 + (fresh ? 0.25 : 1.0) * exPlaces[best].chosen);
		if (exChance(dice) < (exPlaces[best].doomed == exPlaces[best].count ? weight / 50 : weight)) break;
	}
	const struct ex_place* place = &exPlaces[best];
	size_t state = place->cells[0];
	for (int tries = 0; tries < 16; tries++) {
		state = place->cells[exRoll(dice) % place->count];
		if (exChance(dice) < 1.0 / (1.0 + exCells[state].chosen + 4.0 * exCells[state].deaths)) break;
	}
	return state;
}

// the next buttons to hold: the ones held now half the time, or else a set that has found the most for its frames
static int exPick(uint64_t* dice, uint32_t held) {
	if (exChance(dice) < 0.5) for (int i = 0; i < exButtonCount; i++) if (exButtons[i].mask == held) return i;
	double total = 0, weights[EX_BUTTONS];
	for (int i = 0; i < exButtonCount; i++) total += weights[i] = (exButtons[i].found + 1) / (exButtons[i].tried / 64 + 4);
	double at = exChance(dice) * total;
	for (int i = 0; i < exButtonCount; i++) if ((at -= weights[i]) < 0) return i;
	return exButtonCount - 1;
}

// One try: from a place's state, buttons held a stretch at a time, keeping every new place on the way.
static void exTry(struct ex_worker* worker) {
	struct ex_machine* machine = &worker->machine;
	uint32_t* pending = worker->pending;
	exLockTake(&exShared);
	size_t start = exChoose(&worker->dice);
	int32_t last = exCells[start].node;
	exUnpack(exNodes[last].state, worker->scratch);
	uint32_t since = 0, frames = exNodes[last].frames, held = exNodes[last].held;
	exCells[start].chosen++;
	exPlaces[exCells[start].place].chosen++;
	exTries++;
	exSinceNew++;
	exLockGive(&exShared);
	machine->load(machine->console, worker->scratch);
	int64_t values[EX_VALUES] = { 0 }, key[EX_SIDES + 1];
	int found = 0, total = 0, made = 0, lastFound = 0;
	int patience = EX_PATIENCE[exRoll(&worker->dice) % (sizeof EX_PATIENCE / sizeof *EX_PATIENCE)];
	while (total < EX_TRY && total - lastFound < patience && !exOver) {
		int length = EX_STRETCHES[exRoll(&worker->dice) % (sizeof EX_STRETCHES / sizeof *EX_STRETCHES)], ran = 0;
		exLockTake(&exShared);
		int set = exPick(&worker->dice, held);
		exLockGive(&exShared);
		held = exButtons[set].mask;
		for (int f = 0; f < length; f++) {
			machine->frame(machine->console, held);
			pending[since++] = held;
			frames++;
			total++;
			ran++;
			exRead(machine, values);
			int lost = exHolds(exLost, exLostCount, values), goal = !lost && exHolds(exGoal, exGoalCount, values), wanted = 0;
			int32_t at = -1;
			exKey(values, key);
			exLockTake(&exShared);
			if (lost) {
				// only a try that found nothing counts against the place it started from, and the places found on the way
				// down are no places to start from
				if (!found) exSetDeaths(start, exCells[start].deaths + 1);
				for (int i = 0; i < made; i++) if (worker->made[i].at > total - EX_FALL) exSetDeaths(worker->made[i].cell, EX_DOOMED);
			} else if (goal) {
				if (exGoalNode < 0) exGoalNode = exAddNode(last, pending, since, frames, values, NULL, 0);
			} else wanted = exWanted(key, frames, &at);
			if (lost || goal) {
				exFrames += ran;
				exButtons[set].tried += ran;
				exLockGive(&exShared);
				return;
			}
			exLockGive(&exShared);
			if (!wanted) continue;
			// its state is copied and packed with the others free to go on, then kept if nobody got there meanwhile
			uint32_t bytes;
			machine->save(machine->console, worker->scratch);
			uint8_t* state = exPack(worker->scratch, &bytes);
			int isNew;
			int32_t node;
			exLockTake(&exShared);
			at = exArrive(last, pending, since, frames, values, state, bytes, &isNew, &node);
			if (at >= 0) {
				last = node;
				since = 0;
				if (isNew) {
					// a new state keeps the try going, and only a new place counts as something found
					lastFound = total;
					worker->made[made].cell = (size_t) at;
					worker->made[made++].at = total;
				}
				if (isNew == 2) {
					found++;
					exButtons[set].found++;
					exSinceNew = 0;
				}
			}
			exLockGive(&exShared);
		}
		exLockTake(&exShared);
		exFrames += ran;
		exButtons[set].tried += ran;
		if (found) exSetDeaths(start, 0);
		exLockGive(&exShared);
	}
}

#ifdef _WIN32
static DWORD WINAPI exWork(LPVOID worker) {
#else
static void* exWork(void* worker) {
#endif
	while (!exOver) exTry(worker);
	return 0;
}

static void exWrite32(FILE* file, uint32_t value) { fwrite(&value, 4, 1, file); }

// What it has found, with no state in it: each node's parent, its buttons since and the game's values there. Only the
// nodes that stand for a state now, and the ones on the way to them, are kept, so going on from it plays no more than it needs.
static void exSaveArchive(void) {
	char path[600];
	snprintf(path, sizeof path, "%s.new", exArchive);
	FILE* file = fopen(path, "wb");
	if (!file) exFail("The search can't write its archive.");
	// each kept node's new number, parents before children as they are now
	int32_t* number = malloc((exNodeCount ? exNodeCount : 1) * sizeof *number);
	for (size_t i = 0; i < exNodeCount; i++) number[i] = -1;
	number[0] = 0;
	for (size_t i = 0; i <= exCellCount; i++) {
		int32_t node = i < exCellCount ? exCells[i].node : exGoalNode;
		for (; node > 0 && number[node] < 0; node = exNodes[node].parent) number[node] = 0;
	}
	uint32_t count = 0, pool = 0;
	for (size_t i = 0; i < exNodeCount; i++) {
		if (number[i] < 0) continue;
		number[i] = (int32_t) count++;
		pool += exNodes[i].count;
	}
	fwrite("DPRT", 1, 4, file);
	exWrite32(file, 1);
	exWrite32(file, (uint32_t) exValueCount);
	exWrite32(file, count);
	exWrite32(file, pool);
	exWrite32(file, (uint32_t) (exGoalNode >= 0 ? number[exGoalNode] : -1));
	uint32_t first = 0;
	for (size_t i = 0; i < exNodeCount; i++) {
		const struct ex_node* node = &exNodes[i];
		if (number[i] < 0) continue;
		exWrite32(file, (uint32_t) (node->parent >= 0 ? number[node->parent] : -1));
		exWrite32(file, node->count);
		exWrite32(file, first);
		exWrite32(file, node->frames);
		fwrite(node->values, sizeof(int64_t), exValueCount, file);
		first += node->count;
	}
	for (size_t i = 0; i < exNodeCount; i++) if (number[i] >= 0) fwrite(exPool + exNodes[i].first, 4, exNodes[i].count, file);
	free(number);
	fclose(file);
	remove(exArchive);
	if (rename(path, exArchive)) exFail("The search can't write its archive.");
}

// Plays an archive again from the search's first state, node by node, so each place has its state once more. A goal
// that an old node already meets is found on the way.
static void exLoadArchive(struct ex_worker* worker, FILE* file) {
	struct ex_machine* machine = &worker->machine;
	uint32_t head[5];
	char magic[4];
	if (fread(magic, 1, 4, file) != 4 || memcmp(magic, "DPRT", 4) || fread(head, 4, 5, file) != 5 || head[0] != 1 || head[1] != (uint32_t) exValueCount) {
		exFail("The search's archive is of another kind: --fresh starts again.");
	}
	uint32_t count = head[2], pool = head[3];
	struct { int32_t parent; uint32_t count, first, frames; }* rows = malloc((count ? count : 1) * sizeof *rows);
	int64_t unused[EX_VALUES];
	for (uint32_t i = 0; i < count; i++) {
		if (fread(&rows[i], 4, 4, file) != 4 || fread(unused, sizeof(int64_t), exValueCount, file) != (size_t) exValueCount) exFail("The search's archive is cut short: --fresh starts again.");
	}
	uint32_t* buttons = malloc((pool ? pool : 1) * 4);
	if (fread(buttons, 4, pool, file) != pool) exFail("The search's archive is cut short: --fresh starts again.");
	// the last node each one leads to, after which its state isn't needed for this
	int32_t* lastChild = malloc((count ? count : 1) * sizeof *lastChild);
	int32_t* now = malloc((count ? count : 1) * sizeof *now);
	uint8_t** states = calloc(count ? count : 1, sizeof *states);
	for (uint32_t i = 0; i < count; i++) lastChild[i] = -1;
	for (uint32_t i = 1; i < count; i++) {
		if (rows[i].parent < 0 || (uint32_t) rows[i].parent >= i || (size_t) rows[i].first + rows[i].count > pool) exFail("The search's archive is damaged: --fresh starts again.");
		lastChild[rows[i].parent] = (int32_t) i;
	}
	now[0] = 0;
	int64_t values[EX_VALUES] = { 0 };
	for (uint32_t i = 1; i < count && exGoalNode < 0; i++) {
		int32_t parent = rows[i].parent;
		uint32_t bytes;
		if (parent == 0) memcpy(worker->scratch, exRoot, exStateSize);
		else exUnpack(states[parent], worker->scratch);
		machine->load(machine->console, worker->scratch);
		const uint32_t* held = buttons + rows[i].first;
		for (uint32_t f = 0; f < rows[i].count && exGoalNode < 0; f++) {
			machine->frame(machine->console, held[f]);
			exFrames++;
			exRead(machine, values);
			if (exHolds(exGoal, exGoalCount, values)) exGoalNode = exAddNode(now[parent], held, f + 1, rows[parent].frames + f + 1, values, NULL, 0);
		}
		if (exGoalNode >= 0) break;
		machine->save(machine->console, worker->scratch);
		int isNew;
		int32_t node;
		// a node that stands for no place now is still a step on the way to others
		uint8_t* packed = exPack(worker->scratch, &bytes);
		if (exArrive(now[parent], held, rows[i].count, rows[i].frames, values, packed, bytes, &isNew, &node) < 0) {
			node = exAddNode(now[parent], held, rows[i].count, rows[i].frames, values, NULL, 0);
		}
		now[i] = node;
		if (lastChild[i] >= 0) states[i] = exPack(worker->scratch, &bytes);
		if (parent && lastChild[parent] == (int32_t) i) {
			free(states[parent]);
			states[parent] = NULL;
		}
	}
	for (uint32_t i = 0; i < count; i++) free(states[i]);
	free(states);
	free(now);
	free(lastChild);
	free(buttons);
	free(rows);
}

static void exWriteRoute(void) {
	size_t frames = 0;
	for (int32_t node = exGoalNode; node > 0; node = exNodes[node].parent) frames += exNodes[node].count;
	uint32_t* route = malloc((frames ? frames : 1) * 4);
	size_t at = frames;
	for (int32_t node = exGoalNode; node > 0; node = exNodes[node].parent) {
		at -= exNodes[node].count;
		memcpy(route + at, exPool + exNodes[node].first, exNodes[node].count * 4);
	}
	FILE* file = fopen(exOut, "wb");
	if (!file) exFail("The search can't write the route.");
	fwrite(route, 4, frames, file);
	fclose(file);
	free(route);
}

static void exReadSpec(const char* path) {
	FILE* file = fopen(path, "r");
	if (!file) exFail("The search can't read what to search for.");
	char word[64];
	while (fscanf(file, "%63s", word) == 1) {
		long long n[11];
		if (!strcmp(word, "prefix")) { if (fscanf(file, "%511s", exPrefix) != 1) break; }
		else if (!strcmp(word, "sets")) { if (fscanf(file, "%511s", exSets) != 1) break; }
		else if (!strcmp(word, "archive")) { if (fscanf(file, "%511s", exArchive) != 1) break; }
		else if (!strcmp(word, "out")) { if (fscanf(file, "%511s", exOut) != 1) break; }
		else if (!strcmp(word, "value") && exValueCount < EX_VALUES && fscanf(file, "%lld %lld %lld", &n[0], &n[1], &n[2]) == 3) {
			exValues[exValueCount++] = (struct ex_value) { .address = (uint32_t) n[0], .bytes = (uint32_t) n[1], .isSigned = (uint32_t) n[2] };
		} else if (!strcmp(word, "value-found") && exValueCount < EX_VALUES && fscanf(file, "%lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld", &n[0], &n[1], &n[2], &n[3], &n[4], &n[5], &n[6], &n[7], &n[8], &n[9], &n[10]) == 11) {
			exValues[exValueCount++] = (struct ex_value) { .found = 1, .from = (uint32_t) n[0], .to = (uint32_t) n[1], .step = (uint32_t) (n[2] > 0 ? n[2] : 1), .mark = (uint32_t) n[3], .markBytes = (uint32_t) n[4],
				.pointer = (uint32_t) n[5], .pointerBytes = (uint32_t) n[6], .base = (uint32_t) n[7], .offset = (uint32_t) n[8], .bytes = (uint32_t) n[9], .isSigned = (uint32_t) n[10] };
		} else if ((!strcmp(word, "cell") || !strcmp(word, "apart")) && exSideCount < EX_SIDES && fscanf(file, "%lld %lld", &n[0], &n[1]) == 2 && n[1] > 0) {
			if (word[0] == 'c' && exPlaceSides != exSideCount) exFail("The grid's sides come before what tells a place's states apart.");
			exSides[exSideCount].value = (int) n[0];
			exSides[exSideCount++].size = n[1];
			if (word[0] == 'c') exPlaceSides = exSideCount;
		} else if (!strcmp(word, "wait") && fscanf(file, "%lld %lld", &n[0], &n[1]) == 2 && n[0] > 0 && n[1] >= 0 && n[1] <= 64) {
			exWaitFrames = (long) n[0];
			exWaitStates = (long) n[1];
		} else if ((!strcmp(word, "lost") || !strcmp(word, "goal")) && fscanf(file, "%lld %lld %lld %lld", &n[0], &n[1], &n[2], &n[3]) == 4) {
			int isGoal = word[0] == 'g';
			int* count = isGoal ? &exGoalCount : &exLostCount;
			if (*count == EX_CONDITIONS) exFail("That's more conditions than the search takes.");
			(isGoal ? exGoal : exLost)[(*count)++] = (struct ex_condition) { .group = (int) n[0], .value = (int) n[1], .op = (int) n[2], .number = n[3] };
		} else if (!strcmp(word, "buttons") && exButtonCount < EX_BUTTONS && fscanf(file, "%lld", &n[0]) == 1) exButtons[exButtonCount++].mask = (uint32_t) n[0];
		else if (!strcmp(word, "seed") && fscanf(file, "%lld", &n[0]) == 1) exSeed ^= (uint64_t) n[0] * 0xD6E8FEB86659FD93ull + 1;
		else if (!strcmp(word, "seconds") && fscanf(file, "%lld", &n[0]) == 1) exSeconds = (double) n[0];
		else if (!strcmp(word, "stale") && fscanf(file, "%lld", &n[0]) == 1 && n[0] > 0) exStale = (long) n[0];
		else if (!strcmp(word, "megabytes") && fscanf(file, "%lld", &n[0]) == 1) exMegabytes = (double) n[0];
		else if (!strcmp(word, "threads") && fscanf(file, "%lld", &n[0]) == 1 && n[0] >= 1 && n[0] <= EX_THREADS) exThreads = (int) n[0];
		else exFail("The search can't read what to search for: a line of it is of no kind it knows.");
	}
	fclose(file);
	for (int i = 0; i < exSideCount; i++) if (exSides[i].value < 0 || exSides[i].value >= exValueCount) exFail("A side of the grid names a value that isn't there.");
	for (int i = 0; i < exLostCount; i++) if (exLost[i].value < 0 || exLost[i].value >= exValueCount) exFail("A condition names a value that isn't there.");
	for (int i = 0; i < exGoalCount; i++) if (exGoal[i].value < 0 || exGoal[i].value >= exValueCount) exFail("A condition names a value that isn't there.");
	exKeySides = exSideCount + 1;
	if (!exPlaceSides || !exGoalCount || !exButtonCount || !exPrefix[0] || !exArchive[0] || !exOut[0]) exFail("The search needs a grid, a goal, buttons to hold, the way there and where to write.");
}

static void* exReadAll(const char* path, size_t* size) {
	*size = 0;
	if (!strcmp(path, "-")) return NULL;
	FILE* file = fopen(path, "rb");
	if (!file) exFail("The search can't read one of its files.");
	fseek(file, 0, SEEK_END);
	long length = ftell(file);
	fseek(file, 0, SEEK_SET);
	void* data = malloc(length ? length : 1);
	if (length && fread(data, 1, length, file) != (size_t) length) exFail("The search can't read one of its files.");
	fclose(file);
	*size = length;
	return data;
}

// a line of where it has got to, with the game's values at a node
static void exSay(double started, int32_t node) {
	fprintf(exSaid, "at %.0f tries %ld frames %ld places %zu states %zu megabytes %.0f newest", exNow() - started, exTries, exFrames, exPlaceCount, exCellCount, exStateBytes / 1048576.0);
	for (int i = 0; i < exValueCount; i++) fprintf(exSaid, " %lld", (long long) exNodes[node].values[i]);
	fprintf(exSaid, "\n");
	// with nobody left to read it, as when the tool that started it was stopped, it stops too
	if (fflush(exSaid)) exit(0);
}

/**
 * Runs the search a file describes and returns 0. `first` is a machine that has just been switched on, `another`
 * makes one more of the same, for each thread after the first, or is NULL for an emulator there can be only one of, and
 * `buttonBytes` is how many bytes each frame's buttons take in the files, 2 or 4.
 */
static int exploreRoute(struct ex_machine first, struct ex_machine (*another)(void), const char* specPath, int buttonBytes) {
	if (!exSaid) exSaid = stdout;
	exReadSpec(specPath);
	if (!another) exThreads = 1;
	exLockInit(&exShared);
	exStateSize = first.stateSize;
	struct ex_worker* workers = calloc(exThreads, sizeof *workers);
	for (int i = 0; i < exThreads; i++) {
		workers[i].machine = i ? another() : first;
		workers[i].dice = exSeed + (uint64_t) i * 0xA24BAED4963EE407ull;
		workers[i].scratch = malloc(exStateSize);
		if (workers[i].machine.stateSize != exStateSize) exFail("Two consoles of the search keep states of different sizes.");
	}
	// the way there, from power-on, with the values it writes on the way
	struct ex_machine* machine = &workers[0].machine;
	size_t prefixSize, setsSize;
	uint8_t* prefix = exReadAll(exPrefix, &prefixSize);
	uint32_t* sets = exReadAll(exSets, &setsSize);
	size_t prefixFrames = prefixSize / buttonBytes, setCount = setsSize / 16, nextSet = 0;
	uint32_t held = 0;
	for (size_t frame = 0; frame < prefixFrames; frame++) {
		for (; nextSet < setCount && sets[nextSet * 4] == (uint32_t) frame; nextSet++) machine->set(machine->console, sets[nextSet * 4 + 1], sets[nextSet * 4 + 2], sets[nextSet * 4 + 3]);
		held = 0;
		memcpy(&held, prefix + frame * buttonBytes, buttonBytes);
		machine->frame(machine->console, held);
	}
	exRoot = malloc(exStateSize);
	machine->save(machine->console, exRoot);
	int64_t values[EX_VALUES] = { 0 };
	exRead(machine, values);
	if (exHolds(exGoal, exGoalCount, values)) {
		fprintf(exSaid, "stopped there\n");
		fflush(exSaid);
		return 0;
	}
	// the first node is where the search starts, with the buttons the way there ended on still held
	int isNew;
	int32_t node;
	uint32_t bytes;
	uint8_t* packed = exPack(exRoot, &bytes);
	exArrive(-1, NULL, 0, 0, values, packed, bytes, &isNew, &node);
	exNodes[0].held = held;
	double started = exNow(), said = started, kept = started;
	FILE* before = fopen(exArchive, "rb");
	if (before) {
		exLoadArchive(&workers[0], before);
		fclose(before);
		fprintf(exSaid, "resumed places %zu frames %ld\n", exPlaceCount, exFrames);
		fflush(exSaid);
		started = exNow();
	}
	const char* why = NULL;
	if (exGoalNode < 0) {
#ifdef _WIN32
		for (int i = 0; i < exThreads; i++) workers[i].thread = CreateThread(NULL, 0, exWork, &workers[i], 0, NULL);
#else
		for (int i = 0; i < exThreads; i++) if (pthread_create(&workers[i].thread, NULL, exWork, &workers[i])) exFail("The search can't start a thread.");
#endif
		while (!why) {
			exRest();
			double now = exNow();
			exLockTake(&exShared);
			if (exGoalNode >= 0) why = "goal";
			else if (now - started >= exSeconds) why = "seconds";
			else if (exSinceNew >= exStale + (long) exPlaceCount * 60) why = "stale";
			else if (exStateBytes / 1048576.0 >= exMegabytes) why = "megabytes";
			if (!why && now - said >= 2) {
				exSay(started, exCells[exPlaces[exPlaceCount - 1].cells[0]].node);
				said = now;
			}
			if (!why && now - kept >= 30) {
				exSaveArchive();
				kept = exNow();
			}
			exLockGive(&exShared);
		}
		exOver = 1;
#ifdef _WIN32
		for (int i = 0; i < exThreads; i++) WaitForSingleObject(workers[i].thread, INFINITE);
#else
		for (int i = 0; i < exThreads; i++) pthread_join(workers[i].thread, NULL);
#endif
	}
	exSay(started, exGoalNode >= 0 ? exGoalNode : exCells[exPlaces[exPlaceCount - 1].cells[0]].node);
	exSaveArchive();
	if (exGoalNode >= 0) {
		exWriteRoute();
		fprintf(exSaid, "goal %u\n", exNodes[exGoalNode].frames);
	} else {
		fprintf(exSaid, "stopped %s\n", why);
	}
	fflush(exSaid);
	return 0;
}
