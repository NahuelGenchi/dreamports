// The player's disc (disc.h): its layout, which the page gives before the game starts, and the last few megabytes of
// its sectors, which the page fetches from the player's file as the game asks for them. Nothing here calls the page:
// the page asks dp_disc_wanted after each call it makes, fetches what's wanted, and hands it over, and a game that
// can't go on without it pauses partway through its frame until the page calls dp_step again (kit_pause, pause.c).

#include "disc.h"
#include "kit.h"
#include "page.h"

// the sectors kept: 4 MB of them, about 1,800 of a CD's or 2,000 of a DVD's, as runs the page fetched, in a ring
#define CACHE_BYTES (4u << 20)
#define RUNS 64
// what's asked for at least when a sector isn't there, as a game reads on from where it read
#define READ_ON 64
// what the drive will want soon, besides what the game waits for
#define WANTS 8

static int kind;
static uint32_t sectors, layer_break, sector_size;
static kit_track tracks[99];
static int track_count;

static uint8_t *cache;
static uint32_t slots, next_slot;
static struct { uint32_t lba, count, slot; } runs[RUNS];
static int run_count;
static struct { uint32_t lba, count; } wants[WANTS];
static int want_count;
// where the page writes the first of what's wanted, once it has asked
static uint32_t given_slot, given_count;

static void stop(void) { __builtin_trap(); }

int kit_disc_kind(void) { return kind; }
uint32_t kit_disc_sectors(void) { return sectors; }
uint32_t kit_disc_layer_break(void) { return layer_break; }
int kit_disc_track_count(void) { return track_count; }
const kit_track *kit_disc_track(int number) { return number >= 1 && number <= track_count ? &tracks[number - 1] : 0; }

// sector `lba` where it's kept, or 0 when it isn't
static const uint8_t *kept(uint32_t lba) {
  for (int i = run_count - 1; i >= 0; i--) {
    if (lba >= runs[i].lba && lba - runs[i].lba < runs[i].count) return cache + (size_t)(runs[i].slot + lba - runs[i].lba) * sector_size;
  }
  return 0;
}
static int wanted(uint32_t lba) {
  for (int i = 0; i < want_count; i++) if (lba >= wants[i].lba && lba - wants[i].lba < wants[i].count) return 1;
  return 0;
}
// `count` sectors from `lba`, no more than the disc has or half of what's kept
static uint32_t fits(uint32_t lba, uint32_t count) {
  if (count > sectors - lba) count = sectors - lba;
  if (count > slots / 2) count = slots / 2;
  return count;
}

/** Asks the page for `count` sectors from `lba`, first of all when the game waits for them. */
static void want(uint32_t lba, uint32_t count, int first) {
  if (lba >= sectors || !count || wanted(lba)) return;
  count = fits(lba, count);
  if (first) {
    if (want_count == WANTS) want_count--;
    for (int i = want_count; i > 0; i--) wants[i] = wants[i - 1];
    wants[0].lba = lba;
    wants[0].count = count;
    want_count++;
    given_count = 0;
  } else if (want_count < WANTS) {
    wants[want_count].lba = lba;
    wants[want_count].count = count;
    want_count++;
  }
}

uint32_t kit_disc_read(uint32_t lba, uint32_t count, uint32_t from, uint32_t size, uint8_t *to) {
  if (!kind) return 0;
  if (from > sector_size || size > sector_size - from) stop();
  uint32_t done = 0;
  while (done < count && lba + done < sectors && lba + done >= lba) {
    const uint8_t *sector = kept(lba + done);
    if (!sector) {
      uint32_t rest = count - done;
      want(lba + done, rest > READ_ON ? rest : READ_ON, 1);
      // the page fetches them, and the game goes on from here, in the same frame
      kit_pause();
      continue;
    }
    __builtin_memcpy(to + (size_t)done * size, sector + from, size);
    done++;
  }
  return done;
}

void kit_disc_ahead(uint32_t lba, uint32_t count) {
  if (kind && lba < sectors && !kept(lba)) want(lba, count, 0);
}

static uint8_t bcd(uint32_t n) { return (uint8_t)((n / 10) << 4 | n % 10); }
static void time_at(uint8_t *at, uint32_t frames) {
  at[0] = bcd(frames / 4500);
  at[1] = bcd(frames / 75 % 60);
  at[2] = bcd(frames % 75);
}
void kit_disc_q(uint32_t lba, uint8_t q[12]) {
  const kit_track *track = track_count ? &tracks[0] : 0;
  for (int i = 0; i < track_count; i++) if (lba + tracks[i].pregap >= tracks[i].first) track = &tracks[i];
  int lead_out = lba >= sectors;
  q[0] = (uint8_t)((track && track->type == KIT_TRACK_AUDIO && !lead_out ? 0x00 : 0x40) | 0x01);
  q[1] = lead_out ? 0xAA : bcd(track ? track->number : 1);
  uint32_t first = lead_out ? sectors : track ? track->first : 0;
  q[2] = lba < first ? 0 : 1;
  time_at(q + 3, lba < first ? first - lba : lba - first);
  q[6] = 0;
  time_at(q + 7, lba + 150);
  // the CRC of 16 bits over the ten before it, inverted
  uint32_t crc = 0;
  for (int i = 0; i < 10; i++) {
    crc ^= (uint32_t)q[i] << 8;
    for (int bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  crc = ~crc & 0xFFFF;
  q[10] = (uint8_t)(crc >> 8);
  q[11] = (uint8_t)crc;
}

// what the page calls

/** The disc's kind, how many sectors it has and where its second layer starts, before the game starts: the room for
 *  its sectors is made here, and its tracks follow, a call each. */
EXPORT("dp_disc") void dp_disc(int disc_kind, uint32_t count, uint32_t second_layer) {
  kind = disc_kind;
  sectors = count;
  layer_break = second_layer;
  sector_size = kind == KIT_DISC_CD ? 2352 : 2048;
  slots = CACHE_BYTES / sector_size;
  if (!cache) cache = kit_alloc(CACHE_BYTES);
  track_count = run_count = want_count = 0;
  next_slot = given_count = 0;
}
EXPORT("dp_disc_track") void dp_disc_track(int number, int type, uint32_t first, uint32_t pregap, uint32_t count) {
  if (track_count == 99) return;
  kit_track *track = &tracks[track_count++];
  track->number = (uint8_t)number;
  track->type = (uint8_t)type;
  track->first = first;
  track->pregap = pregap;
  track->sectors = count;
}
/** How many sectors the page is asked for now, from dp_disc_wanted_lba, or 0. */
EXPORT("dp_disc_wanted") uint32_t dp_disc_wanted(void) { return want_count ? wants[0].count : 0; }
EXPORT("dp_disc_wanted_lba") uint32_t dp_disc_wanted_lba(void) { return want_count ? wants[0].lba : 0; }
/** Where the page writes them, as the drive reads them whole, one after another; and that they're there. */
EXPORT("dp_disc_buffer") uint8_t *dp_disc_buffer(void) {
  if (!want_count) return 0;
  uint32_t count = wants[0].count;
  if (next_slot + count > slots) next_slot = 0;
  given_slot = next_slot;
  given_count = count;
  next_slot += count;
  // what was kept where they go is let go
  int kept_runs = 0;
  for (int i = 0; i < run_count; i++) {
    if (runs[i].slot + runs[i].count <= given_slot || runs[i].slot >= given_slot + count) runs[kept_runs++] = runs[i];
  }
  run_count = kept_runs;
  return cache + (size_t)given_slot * sector_size;
}
EXPORT("dp_disc_have") void dp_disc_have(void) {
  if (!want_count || !given_count) return;
  if (run_count == RUNS) {
    for (int i = 1; i < RUNS; i++) runs[i - 1] = runs[i];
    run_count--;
  }
  runs[run_count].lba = wants[0].lba;
  runs[run_count].count = given_count;
  runs[run_count].slot = given_slot;
  run_count++;
  for (int i = 1; i < want_count; i++) wants[i - 1] = wants[i];
  want_count--;
  given_count = 0;
  // what was wanted soon and is now kept isn't asked for again
  int still = 0;
  for (int i = 0; i < want_count; i++) if (!kept(wants[i].lba)) wants[still++] = wants[i];
  want_count = still;
}
/** Whether the game is paused partway through its frame, for something the page is fetching. */
EXPORT("dp_paused") int dp_paused(void) { return kit_frame_paused(); }
