// An emulator of a console that was never made, driven as any libretro core is, so that the tools' way of running other
// consoles (tools/libretro/host.c) can be tested on any computer with nothing from anyone else. Its "cartridge" is the
// text MADEUP, then a colour for each button, then, if it chooses its own screen, a width and a height. Each frame fills its
// screen, 64 x 48 unless the cartridge chooses another, with shades of the cartridge's colour for the button held, draws a
// bar that moves a pixel a frame, and plays a square wave while a button is held. Like a real console, what it works out in a
// frame shows and sounds in the next. It counts frames in its work memory, which a recording's start point can set. Right
// halves its sound's rate, and Left puts it back, as a Nintendo 64's game chooses its own. Up shows the console's 64 x 48, and
// Down the cartridge's own screen again, as a Mega Drive's game can change its screen between one part and the next.
//
// It also has a walker nobody sees, for the route finder's test (lib/explore.h): only numbers in its work memory, which
// change no picture and no sound. A moves it a step along, B a step back, and Start hops, for 8 frames. A wall at step 20
// stops it unless it's off the ground, and from step 40 to step 43 there's a pit, where a walker on the ground is lost
// and moves no more. Its memory holds the step in [1], how many frames of a hop are left in [2] and whether it's lost in [3].
// Like any core, it can copy its state out and take it back.

#include <math.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define WIDTH 64
#define HEIGHT 48
#define MOST 256   // as wide or as tall as a cartridge can choose, which is also how far apart its rows are kept
#define RATE 44100
#define FPS 50

struct game_info { const char* path; const void* data; size_t size; const char* meta; };
struct system_info { const char* name; const char* version; const char* extensions; bool needsPath; bool blockExtract; };
struct av_info { unsigned baseWidth, baseHeight, maxWidth, maxHeight; float aspect; double fps, sampleRate; };

static bool (*environment)(unsigned, void*);
static void (*videoRefresh)(const void*, unsigned, unsigned, size_t);
static size_t (*audioBatch)(const int16_t*, size_t);
static void (*inputPoll)(void);
static int16_t (*inputState)(unsigned, unsigned, unsigned, unsigned);

static uint16_t colours[8];
static uint16_t screen[MOST * MOST];
static unsigned ownWidth = WIDTH, ownHeight = HEIGHT, width = WIDTH, height = HEIGHT, shownWidth = WIDTH, shownHeight = HEIGHT;
static uint32_t memory[16];   // [0], the frame count, and the walker's step, hop and loss in [1], [2] and [3]
#define WALL 20
#define PIT_FROM 40
#define PIT_TO 44
static uint32_t phase;
static unsigned rate = RATE;
static int16_t sound[(RATE / FPS) * 2];

void retro_set_environment(bool (*callback)(unsigned, void*)) { environment = callback; }
void retro_set_video_refresh(void (*callback)(const void*, unsigned, unsigned, size_t)) { videoRefresh = callback; }
void retro_set_audio_sample(void (*callback)(int16_t, int16_t)) { (void) callback; }
void retro_set_audio_sample_batch(size_t (*callback)(const int16_t*, size_t)) { audioBatch = callback; }
void retro_set_input_poll(void (*callback)(void)) { inputPoll = callback; }
void retro_set_input_state(int16_t (*callback)(unsigned, unsigned, unsigned, unsigned)) { inputState = callback; }
void retro_set_controller_port_device(unsigned port, unsigned device) { (void) port; (void) device; }
void retro_init(void) {
	int format = 2;   // RGB565
	environment(10, &format);
}
void retro_get_system_info(struct system_info* info) {
	memset(info, 0, sizeof *info);
	info->name = "made up";
	info->version = "1";
	info->extensions = "mu";
}
void retro_get_system_av_info(struct av_info* info) {
	memset(info, 0, sizeof *info);
	info->baseWidth = ownWidth;
	info->baseHeight = ownHeight;
	info->maxWidth = info->maxHeight = MOST;
	info->fps = FPS;
	info->sampleRate = RATE;
}
bool retro_load_game(const struct game_info* game) {
	if (!game || !game->data || game->size < 6 + 16 || memcmp(game->data, "MADEUP", 6)) return false;
	memcpy(colours, (const char*) game->data + 6, 16);
	if (game->size >= 6 + 16 + 4) {
		uint16_t size[2];
		memcpy(size, (const char*) game->data + 6 + 16, 4);
		if (!size[0] || !size[1] || size[0] > MOST || size[1] > MOST) return false;
		ownWidth = width = shownWidth = size[0];
		ownHeight = height = shownHeight = size[1];
	}
	return true;
}
void* retro_get_memory_data(unsigned id) { return id == 2 ? memory : NULL; }
size_t retro_get_memory_size(unsigned id) { return id == 2 ? sizeof memory : 0; }

void retro_run(void) {
	inputPoll();
	videoRefresh(screen, shownWidth, shownHeight, MOST * 2);
	audioBatch(sound, rate / FPS);
	// libretro's Right and Left, by their numbers there. Only this notice says so: asked again, it answers as it did at first
	unsigned wanted = inputState(0, 1, 0, 7) ? RATE / 2 : inputState(0, 1, 0, 6) ? RATE : rate;
	if (wanted != rate) {
		struct av_info info;
		retro_get_system_av_info(&info);
		info.sampleRate = rate = wanted;
		environment(32, &info);
	}
	int pressed = -1;
	// libretro's A, B and START, by their numbers there
	if (inputState(0, 1, 0, 8)) pressed = 1;
	else if (inputState(0, 1, 0, 0)) pressed = 2;
	else if (inputState(0, 1, 0, 3)) pressed = 3;
	// libretro's Up and Down, by their numbers there
	if (inputState(0, 1, 0, 4)) width = WIDTH, height = HEIGHT;
	else if (inputState(0, 1, 0, 5)) width = ownWidth, height = ownHeight;
	uint16_t colour = colours[pressed < 0 ? 0 : pressed];
	uint32_t bar = memory[0] % width;
	for (unsigned y = 0; y < height; y++) for (unsigned x = 0; x < width; x++) screen[y * MOST + x] = x == bar ? colours[4] : colour ^ (y % 12);
	shownWidth = width;
	shownHeight = height;
	// the walker, which nothing above looks at
	if (!memory[3]) {
		if (memory[2]) memory[2]--;
		else if (inputState(0, 1, 0, 3)) memory[2] = 8;
		uint32_t step = memory[1] + (inputState(0, 1, 0, 8) ? 1 : 0) - (inputState(0, 1, 0, 0) && memory[1] ? 1 : 0);
		if (step == WALL && memory[1] < WALL && !memory[2]) step = memory[1];
		memory[1] = step;
		if (step >= PIT_FROM && step < PIT_TO && !memory[2]) memory[3] = 1;
	}
	for (unsigned i = 0; i < rate / FPS; i++) {
		// 440 Hz, half as loud as the mix goes
		int16_t value = pressed < 0 ? 0 : (phase * 440 * 2 / rate) % 2 ? 16384 : -16384;
		sound[i * 2] = sound[i * 2 + 1] = value;
		phase++;
	}
	memory[0]++;
}

// its whole state, for a tool that copies it out and brings it back: everything a frame reads that the one before wrote
struct state { uint16_t screen[MOST * MOST]; unsigned width, height, shownWidth, shownHeight, rate; uint32_t memory[16], phase; int16_t sound[(RATE / FPS) * 2]; };
size_t retro_serialize_size(void) { return sizeof(struct state); }
bool retro_serialize(void* data, size_t size) {
	if (size < sizeof(struct state)) return false;
	struct state* state = data;
	memcpy(state->screen, screen, sizeof screen);
	memcpy(state->memory, memory, sizeof memory);
	memcpy(state->sound, sound, sizeof sound);
	state->width = width, state->height = height, state->shownWidth = shownWidth, state->shownHeight = shownHeight, state->rate = rate, state->phase = phase;
	return true;
}
bool retro_unserialize(const void* data, size_t size) {
	if (size < sizeof(struct state)) return false;
	const struct state* state = data;
	memcpy(screen, state->screen, sizeof screen);
	memcpy(memory, state->memory, sizeof memory);
	memcpy(sound, state->sound, sizeof sound);
	width = state->width, height = state->height, shownWidth = state->shownWidth, shownHeight = state->shownHeight, rate = state->rate, phase = state->phase;
	return true;
}
