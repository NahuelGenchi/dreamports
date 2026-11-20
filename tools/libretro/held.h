// What the console holds, for a core that says where it keeps it, as the PlayStation 2's does with the tools' patch
// (play.patch): its memory, hashed as every frame ends, for DP_MEMORY, and its memory cards' files, each time a frame
// changed them, for DP_SAVES. The program that drives the emulators includes this (host.c), and writes what the Game Boy
// Advance's writes (../gba/original.c), for the same tools (lib/memory.mjs, lib/saves.mjs).
//
// DP_MEMORY names a file as lib/memory.mjs writes it: the frame whose bytes to write too, or 0xFFFFFFFF, then each stretch
// as three 32-bit words, which of the console's memories (0 the EE's, 1 the IOP's, 2 the SPU2's, as the core's
// dreamports_memory numbers them), its first address there, and how many bytes. To the same name with ".out" go, for
// every frame, the FNV-1a hash of the stretches' bytes, in order, as the frame ends, 32 bits each, and after them the
// bytes at the frame asked for.
//
// DP_SAVES names a file for the memory cards each time a frame ended with other files in them than the frame before:
// the frame, how many bytes, and the bytes, to a whole word, as a cartridge's save memory is written. The cards are
// written as kit/ps2/card.js's cardBytes writes them: each entry, port 0's card then port 1's, a folder's entries in the
// order of their names' bytes, each as a letter, F for a file or D for a folder, its path as a 16-bit length and its
// bytes, "mc0/" or "mc1/" first, then for a file its length in 32 bits and its bytes. A name the core keeps with a
// character the computer can't have as %XX has it back. The cards' times aren't in it: the game reads them, so they're
// in its memory, which DP_MEMORY compares.
//
// DP_SAVE_START names a file of the cards as the game starts, written the same way, in place of cards never written: a
// player's report carries the cards their game began from (docs/REPORTS.md). Its files are put in the cards' folders
// before the game loads, and DP_SAVES then writes what changed since.
//
// The program that includes this has `err`, where it says what went wrong, and `readAll`.

#ifndef DP_LIBRETRO_HELD_H
#define DP_LIBRETRO_HELD_H

#ifndef _WIN32
#include <dirent.h>
#include <sys/stat.h>
#endif

static struct {
	const uint8_t* (*memory)(uint32_t memory, uint32_t address, uint32_t bytes);
	uint32_t* stretches;   // which memory, first address and bytes, each
	size_t count;
	uint32_t askedFrame;
	uint8_t* asked;       // the bytes at the frame asked for
	size_t askedBytes;
	FILE* out;
	const char* (*card)(uint32_t port, uint32_t* changes);
	FILE* saves;
	uint32_t changes;
	int seen;
	uint8_t* cards;       // what the cards held as the last frame that changed them ended
	size_t cardsBytes;
} holds;

static void heldCant(const char* what) {
	fprintf(err, "%s\n", what);
	exit(2);
}

/** Starts what's asked of it, with the core's `memory` and `card`, each null when the core doesn't say. */
static void heldOpen(const uint8_t* (*memory)(uint32_t, uint32_t, uint32_t), const char* (*card)(uint32_t, uint32_t*)) {
	const char* spec = getenv("DP_MEMORY");
	if (spec) {
		if (!memory) heldCant("The core doesn't say where it keeps the console's memory: npm run dp -- setup builds it again, with the tools' change to it.");
		size_t size;
		uint32_t* words = readAll(spec, &size);
		if (!words || size < 4) heldCant("DP_MEMORY names no file the tools wrote");
		holds.memory = memory;
		holds.askedFrame = words[0];
		holds.stretches = words + 1;
		holds.count = (size / 4 - 1) / 3;
		for (size_t i = 0; i < holds.count; i++) {
			uint32_t* s = holds.stretches + i * 3;
			if (!memory(s[0], s[1], s[2])) {
				fprintf(err, "The console has no memory %u with %u bytes from 0x%08X, which original.json lists under \"workMemory\".\n", s[0], s[2], s[1]);
				exit(2);
			}
			holds.askedBytes += s[2];
		}
		char path[4096];
		snprintf(path, sizeof path, "%s.out", spec);
		if (!(holds.out = fopen(path, "wb"))) heldCant("Can't write what DP_MEMORY asks for");
	}
	const char* saves = getenv("DP_SAVES");
	if (saves) {
		if (!card) heldCant("The core doesn't say where it keeps its memory cards: npm run dp -- setup builds it again, with the tools' change to it.");
		holds.card = card;
		if (!(holds.saves = fopen(saves, "wb"))) heldCant("Can't write what DP_SAVES asks for");
	}
}

// a card's entries from a folder, in the order of their names' bytes, onto `bytes`
struct heldBytes { uint8_t* data; size_t size, room; };
static void heldPut(struct heldBytes* b, const void* data, size_t size) {
	if (b->size + size > b->room) {
		b->room = (b->size + size) * 2 + 4096;
		b->data = realloc(b->data, b->room);
	}
	memcpy(b->data + b->size, data, size);
	b->size += size;
}
static int heldByName(const void* a, const void* b) { return strcmp(*(char* const*) a, *(char* const*) b); }

#ifndef _WIN32
static void heldFolder(struct heldBytes* b, const char* folder, const char* path) {
	DIR* dir = opendir(folder);
	if (!dir) return;
	char** names = NULL;
	size_t count = 0, room = 0;
	for (struct dirent* e; (e = readdir(dir));) {
		if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
		if (count == room) names = realloc(names, (room = room * 2 + 16) * sizeof(char*));
		names[count++] = strdup(e->d_name);
	}
	closedir(dir);
	qsort(names, count, sizeof(char*), heldByName);
	for (size_t i = 0; i < count; i++) {
		char host[4096], own[4096];
		snprintf(host, sizeof host, "%s/%s", folder, names[i]);
		// the name as the card has it: %XX is a character the computer's names can't hold
		size_t at = strlen(path);
		memcpy(own, path, at);
		for (const char* c = names[i]; *c && at < sizeof own - 2; c++) {
			unsigned value;
			if (c[0] == '%' && sscanf(c + 1, "%2x", &value) == 1 && c[1] && c[2]) { own[at++] = (char) value; c += 2; }
			else own[at++] = *c;
		}
		own[at] = 0;
		struct stat info;
		if (stat(host, &info)) continue;
		int isFolder = S_ISDIR(info.st_mode);
		uint16_t length = (uint16_t) at;
		heldPut(b, isFolder ? "D" : "F", 1);
		heldPut(b, &length, 2);
		heldPut(b, own, at);
		if (isFolder) {
			own[at] = '/';
			own[at + 1] = 0;
			heldFolder(b, host, own);
		} else {
			size_t size;
			uint8_t* data = readAll(host, &size);
			uint32_t size32 = (uint32_t) size;
			heldPut(b, &size32, 4);
			heldPut(b, data, size);
			free(data);
		}
		free(names[i]);
	}
	free(names);
}
#endif

#ifndef _WIN32
// a folder and those it's in, as `mkdir -p` makes them
static void heldFolders(char* path) {
	for (char* c = path + 1; *c; c++) {
		if (*c != '/') continue;
		*c = 0;
		mkdir(path, 0755);
		*c = '/';
	}
	mkdir(path, 0755);
}
#endif

/** Before the game loads: the cards it starts from, for DP_SAVE_START, with the core's `card`. */
static void heldStart(const char* (*card)(uint32_t, uint32_t*)) {
	const char* start = getenv("DP_SAVE_START");
	if (!start) return;
	if (!card) heldCant("The core doesn't say where it keeps its memory cards: npm run dp -- setup builds it again, with the tools' change to it.");
	size_t size;
	uint8_t* bytes = readAll(start, &size);
	if (!bytes) heldCant("DP_SAVE_START names no file");
#ifndef _WIN32
	uint32_t changes;
	char folders[2][4096];
	for (uint32_t port = 0; port < 2; port++) snprintf(folders[port], sizeof folders[port], "%s", card(port, &changes));
	for (size_t at = 0; at + 3 <= size;) {
		uint8_t kind = bytes[at];
		uint16_t length = (uint16_t) (bytes[at + 1] | bytes[at + 2] << 8);
		at += 3;
		if (at + length > size || length < 4 || memcmp(bytes + at, "mc", 2) || (bytes[at + 2] != '0' && bytes[at + 2] != '1') || bytes[at + 3] != '/') heldCant("DP_SAVE_START's cards aren't written as kit/ps2/card.js writes them");
		// where it goes on the computer, a character a name there can't hold written as %XX, as the core writes it
		char path[8192];
		size_t out = (size_t) snprintf(path, sizeof path, "%s", folders[bytes[at + 2] - '0']);
		for (uint16_t i = 3; i < length && out < sizeof path - 4; i++) {
			uint8_t c = bytes[at + i];
			if (c == ':' || c == '\\') out += (size_t) snprintf(path + out, sizeof path - out, "%%%02X", c);
			else path[out++] = (char) c;
		}
		path[out] = 0;
		at += length;
		if (kind == 'D') {
			heldFolders(path);
			continue;
		}
		if (kind != 'F' || at + 4 > size) heldCant("DP_SAVE_START's cards aren't written as kit/ps2/card.js writes them");
		uint32_t fileSize = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | (uint32_t) bytes[at + 3] << 24;
		at += 4;
		if (at + fileSize > size) heldCant("DP_SAVE_START's cards aren't written as kit/ps2/card.js writes them");
		char* slash = strrchr(path, '/');
		*slash = 0;
		heldFolders(path);
		*slash = '/';
		FILE* file = fopen(path, "wb");
		if (!file || fwrite(bytes + at, 1, fileSize, file) != fileSize) heldCant("Can't write the cards DP_SAVE_START gives");
		fclose(file);
		at += fileSize;
	}
#endif
	// what DP_SAVES writes is what changed since
	holds.cards = bytes;
	holds.cardsBytes = size;
}

/** As a frame ends: its memory's hash, and the cards' files when the game changed them. */
static void heldFrame(long frame) {
	if (holds.out) {
		uint32_t hash = 0x811C9DC5;
		int keep = (uint32_t) frame == holds.askedFrame;
		if (keep) holds.asked = malloc(holds.askedBytes ? holds.askedBytes : 1);
		size_t kept = 0;
		for (size_t i = 0; i < holds.count; i++) {
			const uint32_t* s = holds.stretches + i * 3;
			const uint8_t* bytes = holds.memory(s[0], s[1], s[2]);
			for (uint32_t j = 0; j < s[2]; j++) hash = (hash ^ bytes[j]) * 0x01000193;
			if (keep) memcpy(holds.asked + kept, bytes, s[2]);
			kept += s[2];
		}
		fwrite(&hash, 4, 1, holds.out);
	}
	if (holds.saves) {
		uint32_t changes;
		const char* folders[2] = { holds.card(0, &changes), NULL };
		folders[1] = holds.card(1, &changes);
		if (holds.seen && changes == holds.changes) return;
		holds.seen = 1;
		holds.changes = changes;
		struct heldBytes b = { 0 };
#ifndef _WIN32
		heldFolder(&b, folders[0], "mc0/");
		heldFolder(&b, folders[1], "mc1/");
#endif
		if (b.size == holds.cardsBytes && (!b.size || !memcmp(b.data, holds.cards, b.size))) { free(b.data); return; }
		free(holds.cards);
		holds.cards = b.data;
		holds.cardsBytes = b.size;
		uint32_t head[2] = { (uint32_t) frame, (uint32_t) b.size }, zero = 0;
		fwrite(head, 4, 2, holds.saves);
		if (b.size) fwrite(b.data, 1, b.size, holds.saves);
		fwrite(&zero, 1, (4 - b.size % 4) % 4, holds.saves);
	}
}

static void heldClose(void) {
	if (holds.out) {
		if (holds.asked) fwrite(holds.asked, 1, holds.askedBytes, holds.out);
		fclose(holds.out);
	}
	if (holds.saves) fclose(holds.saves);
}

#endif
