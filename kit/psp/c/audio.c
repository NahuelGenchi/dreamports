// The sound channels, as the system gives them to a game (sceAudio) and as the emulator in the proof tools mixes them:
// eight channels, each a queue of samples a game hands over a block at a time, with its two volumes already applied,
// and every 64 samples' time the console takes 64 from each queue and adds them up, 44,100 a second. A thread that
// hands a block to a channel that still has some waits until what was there has gone.
//
// Everything a game gives the channels in a frame is its sound list, hashed in the order given the way the proof tools
// hash what the original gives them in its emulator (tools/libretro/ppsspp.patch): each block handed over as its
// channel, its two volumes, its format, how many samples and their bytes, and each block of 64 the console mixes.
// The blocks are what makes the time a block is handed over part of the list.

#include "psp-kit.h"

#define CHANNELS 8
#define BLOCK 64
#define SAMPLE_MOST 65472
// what a queue can hold, in 16-bit values: the emulator's
#define QUEUE_ROOM (32768 * 8)
// a block of 64 samples in the processor's cycles, cut to a whole number as the emulator cuts it
#define BLOCK_CYCLES ((int)((int64_t)PSP_CYCLES_A_SECOND * BLOCK / CONSOLE_SOUND_RATE))

struct channel {
  int reserved, format, left, right;
  uint32_t count;
  int16_t *queue;
  uint32_t head, size;
  struct { SceUID thread; int left; } waiting[16];
  int waiting_count;
};
static struct channel channels[CHANNELS];

// what was mixed in the frame, for the proof tools, and what hasn't been played yet, for a player
#define HEARD_ROOM (BLOCK * 64)
static int16_t heard[HEARD_ROOM * 2];
static uint32_t heard_pairs;
#define PLAY_ROOM 16384
static int16_t playing[PLAY_ROOM * 2];
static uint32_t play_head, play_size;
static uint32_t list_hash = 0x811C9DC5, list_count;

static void listed(uint8_t kind, const void *data, size_t length) {
  const uint8_t *bytes = data;
  list_hash = (list_hash ^ kind) * 0x01000193u;
  for (size_t i = 0; i < length; i++) list_hash = (list_hash ^ bytes[i]) * 0x01000193u;
  list_count++;
}
uint32_t audio_list_hash(void) { return list_hash; }
uint32_t audio_list_count(void) { return list_count; }
void audio_frame_starts(void) {
  list_hash = 0x811C9DC5;
  list_count = 0;
  heard_pairs = 0;
}
const int16_t *audio_heard(uint32_t *pairs) {
  *pairs = heard_pairs;
  return heard;
}
int audio_take(float *left, float *right, int count) {
  int taken = 0;
  for (; taken < count && play_size; taken++) {
    left[taken] = playing[play_head * 2] / 32768.0f;
    right[taken] = playing[play_head * 2 + 1] / 32768.0f;
    play_head = (play_head + 1) % PLAY_ROOM;
    play_size--;
  }
  return taken;
}

static int16_t clamped(int value) { return value > 32767 ? 32767 : value < -32768 ? -32768 : (int16_t)value; }
static void push(struct channel *channel, int16_t value) {
  if (channel->size == QUEUE_ROOM) return;
  channel->queue[(channel->head + channel->size++) % QUEUE_ROOM] = value;
}

// wakes the threads whose wait on `channel` is over, `step` samples nearer than it was
static void wake(struct channel *channel, int result, int step) {
  int woke = 0;
  for (int i = 0; i < channel->waiting_count; i++) {
    channel->waiting[i].left -= step;
    int waits = thread_waits(channel->waiting[i].thread, WAIT_AUDIO);
    if (channel->waiting[i].left > 0 && waits) continue;
    if (waits) {
      thread_wake(channel->waiting[i].thread, result == 0 ? (int)thread_wait_value(channel->waiting[i].thread) : PSP_ERROR_AUDIO_NOT_RESERVED);
      woke = 1;
    }
    for (int j = i--; j + 1 < channel->waiting_count; j++) channel->waiting[j] = channel->waiting[j + 1];
    channel->waiting_count--;
  }
  if (woke) thread_reschedule();
}

static void mix(uint64_t data, int late) {
  (void)data;
  clock_schedule(BLOCK_CYCLES - late, mix, 0);
  int32_t sum[BLOCK * 2];
  int first = 1;
  for (int c = 0; c < CHANNELS; c++) {
    struct channel *channel = &channels[c];
    if (!channel->reserved) continue;
    wake(channel, 0, BLOCK);
    if (!channel->size) continue;
    uint32_t taken = channel->size < BLOCK * 2 ? channel->size : BLOCK * 2;
    for (uint32_t i = 0; i < taken; i++) {
      int16_t value = channel->queue[(channel->head + i) % QUEUE_ROOM];
      if (first) sum[i] = value;
      else sum[i] += value;
    }
    if (first) for (uint32_t i = taken; i < BLOCK * 2; i++) sum[i] = 0;
    channel->head = (channel->head + taken) % QUEUE_ROOM;
    channel->size -= taken;
    first = 0;
  }
  if (first) __builtin_memset(sum, 0, sizeof sum);
  int16_t block[BLOCK * 2];
  // what leaves the console is kept within 16 bits, the lowest of them left out as the emulator leaves it out
  for (int i = 0; i < BLOCK * 2; i++) block[i] = sum[i] < -32767 ? -32767 : sum[i] > 32767 ? 32767 : (int16_t)sum[i];
  listed('M', block, sizeof block);
  if (heard_pairs + BLOCK <= HEARD_ROOM) {
    __builtin_memcpy(heard + heard_pairs * 2, block, sizeof block);
    heard_pairs += BLOCK;
  }
  for (int i = 0; i < BLOCK; i++) {
    if (play_size == PLAY_ROOM) {
      play_head = (play_head + 1) % PLAY_ROOM;
      play_size--;
    }
    uint32_t at = (play_head + play_size++) % PLAY_ROOM;
    playing[at * 2] = block[i * 2];
    playing[at * 2 + 1] = block[i * 2 + 1];
  }
}

void audio_power(void) {
  for (int c = 0; c < CHANNELS; c++) {
    int16_t *queue = channels[c].queue ? channels[c].queue : kit_alloc(QUEUE_ROOM * sizeof(int16_t));
    channels[c] = (struct channel){ .queue = queue };
  }
  heard_pairs = play_head = play_size = 0;
  audio_frame_starts();
  clock_schedule(BLOCK_CYCLES, mix, 0);
}

// hands the channel's block over, from `address`: what the call answers, with the thread put to wait, and `waits`
// set, when `blocking` and the channel still has samples
static int enqueue(int number, uint32_t address, int blocking, int *waits) {
  struct channel *channel = &channels[number];
  int answer = (int)channel->count;
  if (channel->size > 0) {
    if (!blocking) return PSP_ERROR_AUDIO_CHANNEL_BUSY;
    *waits = 1;
    if (channel->waiting_count == 16) __builtin_trap();
    channel->waiting[channel->waiting_count].thread = thread_current();
    channel->waiting[channel->waiting_count++].left = (int)(channel->size / 2);
    thread_wait(WAIT_AUDIO, number + 1, (uint32_t)answer);
  }
  if (address == 0) return answer;
  uint32_t values = channel->count * (channel->format == PSP_AUDIO_STEREO ? 2 : 1);
  const uint8_t *from = psp_memory(address);
  uint32_t about[5] = { (uint32_t)number, (uint32_t)channel->left, (uint32_t)channel->right, (uint32_t)channel->format, channel->count };
  listed('Q', about, sizeof about);
  if (!from || !psp_memory(address + (values - 1) * 2)) return answer;
  if (channel->format == PSP_AUDIO_STEREO || channel->format == PSP_AUDIO_MONO) listed('S', from, values * 2);
  // a volume is a product shifted fifteen bits, kept within 16, but for the full volume, which changes nothing
  int same = channel->left == PSP_AUDIO_VOLUME_MAX && channel->right == PSP_AUDIO_VOLUME_MAX && channel->format == PSP_AUDIO_STEREO;
  for (uint32_t i = 0; i < values; i++) {
    int16_t sample = (int16_t)(from[i * 2] | from[i * 2 + 1] << 8);
    if (channel->format == PSP_AUDIO_STEREO) push(channel, same ? sample : clamped((sample * ((i & 1 ? channel->right : channel->left) << 1)) >> 16));
    else if (channel->format == PSP_AUDIO_MONO) {
      push(channel, clamped((sample * (channel->left << 1)) >> 16));
      push(channel, clamped((sample * (channel->right << 1)) >> 16));
    }
  }
  return answer;
}

static int checked(int number) {
  if ((uint32_t)number >= CHANNELS) return PSP_ERROR_AUDIO_INVALID_CHANNEL;
  if (!channels[number].reserved) return PSP_ERROR_AUDIO_CHANNEL_NOT_INIT;
  return 0;
}

int sceAudioChReserve(int number, int samples, int format) {
  call_starts();
  if (number < 0) {
    number = -1;
    for (int free = CHANNELS - 1; free > 0; free--) {
      if (!channels[free].reserved) { number = free; break; }
    }
    if (number < 0) return thread_done(PSP_ERROR_AUDIO_NO_CHANNELS);
  }
  if (number >= CHANNELS) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  if ((samples & 63) != 0 || samples == 0 || (uint32_t)samples > SAMPLE_MOST) return thread_done(PSP_ERROR_AUDIO_NOT_ALIGNED);
  if (format != PSP_AUDIO_MONO && format != PSP_AUDIO_STEREO) return thread_done(PSP_ERROR_AUDIO_INVALID_FORMAT);
  if (channels[number].reserved) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  channels[number].count = (uint32_t)samples;
  channels[number].format = format;
  channels[number].reserved = 1;
  channels[number].left = channels[number].right = 0;
  return thread_done(number);
}
int sceAudioChRelease(int number) {
  call_starts();
  if ((uint32_t)number >= CHANNELS) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  if (!channels[number].reserved) return thread_done(PSP_ERROR_AUDIO_CHANNEL_NOT_INIT);
  wake(&channels[number], PSP_ERROR_AUDIO_NOT_RESERVED, 0x7FFFFFFF);
  int16_t *queue = channels[number].queue;
  channels[number] = (struct channel){ .queue = queue };
  return thread_done(0);
}
int sceAudioSetChannelDataLen(int number, int samples) {
  call_starts();
  int error = checked(number);
  if (error) return thread_done(error);
  if ((samples & 63) != 0 || samples == 0 || (uint32_t)samples > SAMPLE_MOST) return thread_done(PSP_ERROR_AUDIO_NOT_ALIGNED);
  channels[number].count = (uint32_t)samples;
  return thread_done(0);
}
int sceAudioChangeChannelConfig(int number, int format) {
  call_starts();
  if ((uint32_t)number >= CHANNELS) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  if (!channels[number].reserved) return thread_done(PSP_ERROR_AUDIO_NOT_RESERVED);
  channels[number].format = format;
  return thread_done(0);
}
int sceAudioChangeChannelVolume(int number, int left, int right) {
  call_starts();
  if ((uint32_t)left > 0xFFFF || (uint32_t)right > 0xFFFF) return thread_done(PSP_ERROR_AUDIO_INVALID_VOLUME);
  if ((uint32_t)number >= CHANNELS) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  if (!channels[number].reserved) return thread_done(PSP_ERROR_AUDIO_NOT_RESERVED);
  channels[number].left = left;
  channels[number].right = right;
  return thread_done(0);
}

static int output(int number, int left, int right, uint32_t address, int blocking, int panned) {
  call_starts();
  if (left > 0xFFFF || right > 0xFFFF || (panned && blocking && (left < 0 || right < 0))) return thread_done(PSP_ERROR_AUDIO_INVALID_VOLUME);
  int error = checked(number);
  if (error) return thread_done(error);
  if (left >= 0) channels[number].left = left;
  if (right >= 0) channels[number].right = right;
  int waits = 0, answer = enqueue(number, address, blocking, &waits);
  return waits ? thread_answer(answer) : thread_done(answer);
}
int sceAudioOutput(int number, int volume, uint32_t address) { return output(number, volume, volume, address, 0, 0); }
int sceAudioOutputBlocking(int number, int volume, uint32_t address) { return output(number, volume, volume, address, 1, 0); }
int sceAudioOutputPanned(int number, int left, int right, uint32_t address) { return output(number, left, right, address, 0, 1); }
int sceAudioOutputPannedBlocking(int number, int left, int right, uint32_t address) { return output(number, left, right, address, 1, 1); }
int sceAudioGetChannelRestLen(int number) {
  call_starts();
  if ((uint32_t)number >= CHANNELS) return thread_done(PSP_ERROR_AUDIO_INVALID_CHANNEL);
  return thread_done((int)(channels[number].size / 2));
}
