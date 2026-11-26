// The function check's side of a console whose core runs one function of its program by itself, the GameCube's in
// Dolphin with the tools' change to it (dolphin.patch, dreamports_gamecube_call): `host CORE ROM call [KEY=VALUE…]` boots the
// copy, plays CALL_FRAMES frames so its program is running, and then is told what to do on its standard input, in
// little-endian words, and answers on its standard output (tools/gamecube/original.mjs):
//
//   'I' image  the memory every call starts from: the console's memory, as many bytes as the core has, then
//              CALL_HARDWARE bytes of its hardware's registers, each highest byte first, as the console keeps them.
//              Answers 'k' and how many bytes the console's memory has.
//   'C' call   where it starts, how many bytes the function has, how many instructions it may run, CALL_STATE words of
//              registers (dolphin.patch says which), and the changes to the image it starts from: how many, then each
//              one's address, bytes (1, 2 or 4) and value. Answers how it ended, its detail, where it was, how many
//              instructions ran and whether it used the hardware's registers; the CALL_STATE words as it left them; a
//              byte for each of the function's instructions, 1 when it ran, 2 when a branch there went to its target
//              and 4 when it went on past it; the reads, how many and then each one's address, bytes and value, as two
//              words, the low one first, the first time each address is read; and the chunks, how many and then each
//              one's number, in 256s through the image, and its 256 bytes as the call left them. Memory is then the
//              image again.
//   'Q'        ends it.
//
// The program that includes this has `err`, `out`, held and the core's functions.

#ifndef DP_LIBRETRO_CALLS_H
#define DP_LIBRETRO_CALLS_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CALL_FRAMES 2
#define CALL_HARDWARE 0x10000
#define CALL_STATE 173
#define CALL_CHUNK 256
#define CALL_READS 8192
#define CALL_SEEN (1 << 16)
#define CALL_CHANGED 64

typedef int (*callFunction)(uint32_t, uint32_t, uint32_t, uint32_t*, uint8_t*, void (*)(uint32_t, uint32_t),
	void (*)(uint32_t, uint32_t, uint64_t), uint32_t*, uint32_t*, uint32_t*, uint32_t*);

static struct {
	uint32_t start, span;
	uint8_t* ran;
	uint32_t reads[CALL_READS * 4];
	uint32_t readCount;
	uint32_t seen[CALL_SEEN];
} call;

static void callRan(uint32_t address, uint32_t way) {
	if (address < call.start || address - call.start >= call.span) return;
	call.ran[(address - call.start) / 4] |= way == 1 ? 3 : way == 2 ? 5 : 1;
}

// each address read once, in a table that forgets nothing within a call
static void callRead(uint32_t address, uint32_t bytes, uint64_t value) {
	if (call.readCount == CALL_READS) return;
	uint32_t slot = (address * 2654435761u) >> 16;
	for (;;) {
		if (call.seen[slot] == address + 1) return;
		if (!call.seen[slot]) break;
		slot = (slot + 1) & (CALL_SEEN - 1);
	}
	call.seen[slot] = address + 1;
	uint32_t* r = call.reads + call.readCount++ * 4;
	r[0] = address;
	r[1] = bytes;
	r[2] = (uint32_t) value;
	r[3] = (uint32_t) (value >> 32);
}

static int callTold(uint32_t* words, size_t count) {
	return fread(words, 4, count, stdin) == count;
}

// writes `value`, `bytes` of it, highest byte first, where the console's address puts it
static void callPut(uint8_t* ram, size_t ramSize, uint8_t* hardware, uint32_t address, uint32_t bytes, uint32_t value) {
	uint8_t* at = NULL;
	if (address >= 0xCC000000 && address + bytes <= 0xCC000000 + CALL_HARDWARE) at = hardware + (address - 0xCC000000);
	else if ((address & 0x1FFFFFFF) + bytes <= ramSize) at = ram + (address & 0x1FFFFFFF);
	if (!at) return;
	for (uint32_t i = 0; i < bytes; i++) at[i] = (uint8_t) (value >> ((bytes - 1 - i) * 8));
}

static int callServe(void* library) {
	callFunction run = (callFunction) dlsym(library, "dreamports_gamecube_call");
	if (!run) {
		fprintf(err, "The core can't run one function by itself: npm run dp -- setup builds it again, with the tools' change to it.\n");
		return 2;
	}
	for (int frame = 0; frame < CALL_FRAMES; frame++) {
		held = 0;
		retro_run();
	}
	uint8_t* ram = retro_get_memory_data(MEMORY_SYSTEM_RAM);
	size_t ramSize = retro_get_memory_size(MEMORY_SYSTEM_RAM);
	if (!ram || !ramSize) {
		fprintf(err, "The core gives no memory of the console's.\n");
		return 2;
	}
	size_t imageSize = ramSize + CALL_HARDWARE;
	uint8_t* image = calloc(imageSize, 1);
	uint8_t* hardware = calloc(CALL_HARDWARE, 1);
	uint32_t* chunks = malloc((imageSize / CALL_CHUNK + 1) * 4);
	char command;
	while (fread(&command, 1, 1, stdin) == 1) {
		if (command == 'Q') break;
		if (command == 'I') {
			if (fread(image, 1, imageSize, stdin) != imageSize) return 2;
			memcpy(ram, image, ramSize);
			memcpy(hardware, image + ramSize, CALL_HARDWARE);
			uint32_t answer[2] = { 'k', (uint32_t) ramSize };
			fwrite(answer, 4, 2, out);
			fflush(out);
			continue;
		}
		if (command != 'C') {
			fprintf(err, "The check asked for %c, which the call mode doesn't know.\n", command);
			return 2;
		}
		uint32_t head[3], state[CALL_STATE], changeCount;
		if (!callTold(head, 3) || !callTold(state, CALL_STATE) || !callTold(&changeCount, 1)) return 2;
		// the chunks a change is in, which are told whatever the call leaves there, as the check lays the changes over
		// the image and the chunks over those: one the call put back as the image has it is still what it left
		uint32_t changed[CALL_CHANGED];
		uint32_t changedCount = 0;
		for (uint32_t i = 0; i < changeCount; i++) {
			uint32_t change[3];
			if (!callTold(change, 3)) return 2;
			callPut(ram, ramSize, hardware, change[0], change[1], change[2]);
			for (uint32_t end = 0; end < 2 && changedCount < CALL_CHANGED; end++) {
				uint32_t address = change[0] + (end ? change[1] - 1 : 0);
				size_t at = address >= 0xCC000000 && address < 0xCC000000 + CALL_HARDWARE ? ramSize + (address - 0xCC000000) : (address & 0x1FFFFFFF);
				if (at < imageSize) changed[changedCount++] = (uint32_t) (at / CALL_CHUNK);
			}
		}
		call.start = head[0];
		call.span = head[1];
		call.ran = calloc(call.span / 4 + 1, 1);
		call.readCount = 0;
		memset(call.seen, 0, sizeof call.seen);
		uint32_t ended[5];
		ended[0] = (uint32_t) run(head[0], 0xFFFFFFF0u, head[2], state, hardware, callRan, callRead, &ended[1], &ended[2], &ended[3], &ended[4]);
		fwrite(ended, 4, 5, out);
		fwrite(state, 4, CALL_STATE, out);
		fwrite(call.ran, 1, call.span / 4, out);
		fwrite(&call.readCount, 4, 1, out);
		fwrite(call.reads, 4, call.readCount * 4, out);
		// what the call left that the image hasn't, a chunk at a time, and then the image again
		uint32_t chunkCount = 0;
		for (size_t at = 0; at < imageSize; at += CALL_CHUNK) {
			const uint8_t* now = at < ramSize ? ram + at : hardware + (at - ramSize);
			int told = memcmp(now, image + at, CALL_CHUNK) != 0;
			for (uint32_t i = 0; i < changedCount && !told; i++) told = changed[i] == at / CALL_CHUNK;
			if (told) chunks[chunkCount++] = (uint32_t) (at / CALL_CHUNK);
		}
		fwrite(&chunkCount, 4, 1, out);
		for (uint32_t i = 0; i < chunkCount; i++) {
			size_t at = (size_t) chunks[i] * CALL_CHUNK;
			fwrite(&chunks[i], 4, 1, out);
			fwrite(at < ramSize ? ram + at : hardware + (at - ramSize), 1, CALL_CHUNK, out);
			memcpy(at < ramSize ? ram + at : hardware + (at - ramSize), image + at, CALL_CHUNK);
		}
		memcpy(hardware, image + ramSize, CALL_HARDWARE);
		free(call.ran);
		fflush(out);
	}
	return 0;
}

#endif
