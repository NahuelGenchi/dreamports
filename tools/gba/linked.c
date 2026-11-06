// Runs the original game on two to four Game Boy Advances joined by a link cable, in mGBA's linked cores, the
// reference the proof tools compare a Dreamport's multiplayer against (tools/gba/linked.mjs), on the contributor's
// computer only. Each GBA runs the same copy from power-on with its own buttons, one set per frame, and the program
// writes what each frame shows on every screen. `npm run dp -- setup` builds it against mGBA's library.
//
// linked ROM PLAYERS FRAMES BUTTONS PICTURES STATES
//   ROM       the contributor's copy, only ever read
//   PLAYERS   how many GBAs are linked, 2 to 4
//   FRAMES    how many frames to run
//   BUTTONS   a file with the buttons held at each frame: 16 bits each, a bit per button as KEYINPUT has them, the
//             first GBA's, then the second's and so on at every frame
//   PICTURES  a file with the frames whose whole pictures to write (32 bits each, in order), or -
//   STATES    a file with the frames whose state to write, as PICTURES, or -
//
// For each frame it writes to stdout, for each GBA in turn: a hash of the picture (FNV-1a over each pixel's 15-bit
// colour, as the console has it), the picture's one colour if every pixel has it or else 0xFFFFFFFF, then the picture
// itself if PICTURES names the frame (240 x 160 pixels of 16 bits, the console's 15-bit colour), then what the
// console held as it drew the frame if STATES names it: the display registers (0x58 bytes), the colours (0x400), the
// sprites (0x400) and the video memory (0x18000), as lib/state.mjs reads them.
//
// mGBA links its cores by letting the first GBA run ahead and the others follow with the cycles it gives them
// (MultiplayerController in mGBA's Qt frontend does it with a thread for each). Here one thread runs them in turn, so
// a run is the same every time: a GBA runs until it has to wait for another, or has drawn its frame.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/lockstep.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/sio.h>
#include <mgba/internal/gba/sio/lockstep.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "on-windows.h"

#define WIDTH 240
#define HEIGHT 160
#define MAX_PLAYERS 4

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

struct player {
	struct mCore* core;
	struct GBASIOLockstepNode node;
	uint32_t video[WIDTH * HEIGHT];
	uint16_t picture[WIDTH * HEIGHT];
	uint8_t state[0x58 + 0x400 + 0x400 + 0x18000];
	uint32_t hash, plain;
	int awake;            // 0 while it waits for the first GBA (or for the cycles it gives)
	unsigned waitMask;    // the first GBA's: who it waits for
	int32_t cyclesPosted;
	int blocked;          // asked to stop at once: it is waiting
	int32_t startFrame;
	int done;
};

static struct player players[MAX_PLAYERS];
static int playerCount;
static struct GBASIOLockstep lockstep;
// the buttons, and the frame being run, so that a GBA that has drawn its frame is given the next frame's at once: one that
// waits for another may go on, past the V-blank where the game reads them
static uint16_t* allButtons;
static size_t allButtonsSize;
static long runningFrame;

static struct player* playerOf(int id) { return &players[id]; }

// the callbacks the lockstep gives the program (mLockstep), as MultiplayerController has them without the threads: a GBA
// told to wait stops at once, and one told to go on can run again
static bool lockstepSignal(struct mLockstep* l, unsigned mask) {
	(void) l;
	struct player* player = &players[0];
	bool woke = false;
	player->waitMask &= ~mask;
	if (!player->waitMask && player->awake < 1) {
		player->blocked = 0;
		player->awake = 1;
		woke = true;
	}
	return woke;
}

static bool lockstepWait(struct mLockstep* l, unsigned mask) {
	(void) l;
	struct player* player = &players[0];
	bool slept = false;
	player->waitMask |= mask;
	if (player->awake > 0) {
		player->blocked = 1;
		player->awake = 0;
		slept = true;
	}
	return slept;
}

static void lockstepAddCycles(struct mLockstep* l, int id, int32_t cycles) {
	(void) l;
	if (cycles < 0) abort();
	if (!id) {
		for (int i = 1; i < playerCount; ++i) {
			struct player* player = &players[i];
			if (player->node.d.p->mode > SIO_MULTI) continue;
			player->cyclesPosted += cycles;
			if (player->awake < 1) player->node.nextEvent += player->cyclesPosted;
			player->blocked = 0;
			player->awake = 1;
		}
	} else {
		playerOf(id)->cyclesPosted += cycles;
	}
}

static int32_t lockstepUseCycles(struct mLockstep* l, int id, int32_t cycles) {
	(void) l;
	struct player* player = playerOf(id);
	player->cyclesPosted -= cycles;
	if (player->cyclesPosted <= 0) {
		player->blocked = 1;
		player->awake = 0;
	}
	return player->cyclesPosted;
}

static int32_t lockstepUnusedCycles(struct mLockstep* l, int id) {
	(void) l;
	return playerOf(id)->cyclesPosted;
}

static void lockstepUnload(struct mLockstep* l, int id) {
	if (id) {
		struct player* player = playerOf(id);
		player->cyclesPosted = 0;
		player = &players[0];
		player->waitMask &= ~(1u << id);
		if (!player->waitMask && player->awake < 1) {
			player->blocked = 0;
			player->awake = 1;
		}
	} else {
		for (int i = 1; i < playerCount; ++i) {
			struct player* player = &players[i];
			player->cyclesPosted += ((struct GBASIOLockstep*) l)->players[0]->eventDiff;
			if (player->awake < 1) {
				player->node.nextEvent += player->cyclesPosted;
				player->blocked = 0;
				player->awake = 1;
			}
		}
	}
}

static void* readAll(const char* path, size_t* size) {
	*size = 0;
	if (!strcmp(path, "-")) return NULL;
	FILE* file = fopen(path, "rb");
	if (!file) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fseek(file, 0, SEEK_END);
	long length = ftell(file);
	fseek(file, 0, SEEK_SET);
	void* data = malloc(length ? length : 1);
	if (length && fread(data, 1, length, file) != (size_t) length) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fclose(file);
	*size = length;
	return data;
}

// the frame's picture in the console's 15-bit colour, and its hash and its one colour, if it has only one
static void draw(struct player* player) {
	player->hash = 0x811C9DC5;
	for (int i = 0; i < WIDTH * HEIGHT; i++) {
		uint32_t pixel = player->video[i];
		uint16_t colour = ((pixel >> 3) & 0x1F) | (((pixel >> 11) & 0x1F) << 5) | (((pixel >> 19) & 0x1F) << 10);
		player->picture[i] = colour;
		player->hash = (player->hash ^ colour) * 0x01000193;
		if (!i) player->plain = colour;
		else if (colour != player->plain) player->plain = 0xFFFFFFFF;
	}
}

// what the console holds as a frame ends, before its V-blank starts: what it has just drawn the frame from
static int wantState;
static void keepState(struct player* player) {
	struct GBA* gba = player->core->board;
	memcpy(player->state, gba->memory.io, 0x58);
	memcpy(player->state + 0x58, gba->video.palette, 0x400);
	memcpy(player->state + 0x458, gba->video.oam.raw, 0x400);
	memcpy(player->state + 0x858, gba->video.vram, 0x18000);
}

// runs a GBA until it has drawn its frame (and says so) or has to wait; returns whether it did any instructions
static int runPlayer(struct player* player, int untilFrame) {
	struct ARMCore* cpu = player->core->cpu;
	struct GBA* gba = player->core->board;
	int ran = 0;
	while (!player->blocked) {
		while (cpu->cycles >= cpu->nextEvent) {
			cpu->irqh.processEvents(cpu);
			if (player->blocked) return 1;
		}
		ARMRun(cpu);
		ran = 1;
		if (untilFrame && gba->video.frameCounter != player->startFrame) {
			// the frame this one ends: a GBA that waited for another may have gone on across the next frame's start, which
			// then ends the next frame as soon as it runs
			player->startFrame = gba->video.frameCounter;
			size_t next = (size_t) (runningFrame + 1) * playerCount + (player - players);
			player->core->setKeys(player->core, next < allButtonsSize / 2 ? allButtons[next] : 0);
			player->done = 1;
			draw(player);
			if (wantState) keepState(player);
			return 1;
		}
		if (!untilFrame) return 1;
	}
	return ran;
}

int main(int argc, char** argv) {
	onWindows(&argv);
	if (argc != 7) {
		fprintf(stderr, "Usage: linked ROM PLAYERS FRAMES BUTTONS PICTURES STATES\n");
		return 2;
	}
	playerCount = atoi(argv[2]);
	long frames = atol(argv[3]);
	if (playerCount < 2 || playerCount > MAX_PLAYERS) { fprintf(stderr, "Two to four GBAs can be linked\n"); return 2; }
	size_t buttonsSize, picturesSize, statesSize;
	uint16_t* buttons = readAll(argv[4], &buttonsSize);
	allButtons = buttons;
	allButtonsSize = buttonsSize;
	uint32_t* pictures = readAll(argv[5], &picturesSize);
	uint32_t* states = readAll(argv[6], &statesSize);
	size_t pictureCount = picturesSize / 4, nextPicture = 0, stateCount = statesSize / 4, nextState = 0;

	mLogSetDefaultLogger(&logger);
	GBASIOLockstepInit(&lockstep);
	mLockstepInit(&lockstep.d);
	lockstep.d.signal = lockstepSignal;
	lockstep.d.wait = lockstepWait;
	lockstep.d.addCycles = lockstepAddCycles;
	lockstep.d.useCycles = lockstepUseCycles;
	lockstep.d.unusedCycles = lockstepUnusedCycles;
	lockstep.d.unload = lockstepUnload;
	lockstep.d.context = NULL;

	for (int i = 0; i < playerCount; i++) {
		struct player* player = &players[i];
		player->core = GBACoreCreate();
		player->core->init(player->core);
		mCoreInitConfig(player->core, NULL);
		player->core->setVideoBuffer(player->core, (color_t*) player->video, WIDTH);
		if (!mCoreLoadFile(player->core, argv[1])) {
			fprintf(stderr, "mGBA can't open the copy\n");
			return 1;
		}
		player->core->reset(player->core);
		player->awake = 1;
		player->startFrame = ((struct GBA*) player->core->board)->video.frameCounter;
		GBASIOLockstepNodeCreate(&player->node);
		GBASIOLockstepAttachNode(&lockstep, &player->node);
		GBASIOSetDriver(&((struct GBA*) player->core->board)->sio, &player->node.d, SIO_MULTI);
	}

	for (long frame = 0; frame < frames; frame++) {
		while (nextState < stateCount && states[nextState] < (uint32_t) frame) nextState++;
		wantState = nextState < stateCount && states[nextState] == (uint32_t) frame;
		runningFrame = frame;
		if (frame == 0) for (int i = 0; i < playerCount; i++) players[i].core->setKeys(players[i].core, buttonsSize >= 2 * playerCount ? buttons[i] : 0);
		for (int i = 0; i < playerCount; i++) players[i].done = 0;
		for (;;) {
			int unfinished = 0, progressed = 0;
			for (int i = 0; i < playerCount; i++) {
				struct player* player = &players[i];
				if (player->done) continue;
				unfinished = 1;
				if (!player->blocked) progressed |= runPlayer(player, 1);
			}
			if (!unfinished) break;
			if (!progressed) {
				// every GBA still to draw is waiting for one that has drawn: that one goes on a little
				int moved = 0;
				for (int i = 0; i < playerCount && !moved; i++) {
					if (players[i].done && !players[i].blocked) moved = runPlayer(&players[i], 0);
				}
				if (!moved) { fprintf(stderr, "The linked GBAs wait for each other at frame %ld\n", frame); return 1; }
			}
		}
		while (nextPicture < pictureCount && pictures[nextPicture] < (uint32_t) frame) nextPicture++;
		int wantPicture = nextPicture < pictureCount && pictures[nextPicture] == (uint32_t) frame;
		for (int i = 0; i < playerCount; i++) {
			struct player* player = &players[i];
			fwrite(&player->hash, 4, 1, stdout);
			fwrite(&player->plain, 4, 1, stdout);
			if (wantPicture) fwrite(player->picture, 2, WIDTH * HEIGHT, stdout);
			if (wantState) fwrite(player->state, 1, sizeof player->state, stdout);
		}
	}
	fflush(stdout);
	for (int i = 0; i < playerCount; i++) players[i].core->deinit(players[i].core);
	return 0;
}
