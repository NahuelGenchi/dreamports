// Chao Hunt, the VS mode's round, for one GBA of the link, translated from the JavaScript version's engine/chaohunt.js
// (SAT-R decompilation: the multiplayer parts of src/game/shared/stage/stage.c, player.c, stage_ui_z.c and
// mp_event_mgr.c). Every GBA runs the whole stage for itself and sees the others only through the link (link.c). Its
// first stage, Forest Chao Garden (level 14), is Neo Green Hill's sky and sea with the zone's palette animations.

#include "objects.h"
#include "chaohunt.h"

void draw_sky_and_sea(int camX, int camY);

// StageInit_ForestChaoGarden: Neo Green Hill's two palette animations, then 820's variants 1 and 0, and act 1's song
static const int PALETTES_A[] = { 814, 815, 820, 820 };
static const int VARIANTS_A[] = { 0, 0, 1, 0 };

const Level ACT_CHAO_HUNT_A = {
  .song = 12, .hudFlash = 90, LEVEL_PALETTES(PALETTES_A), .paletteVariants = VARIANTS_A,
  .bgCnt = 0x1D0B,   // 256 × 256, priority 3, map 29 (0xE800), character base 2
  .drawBackground = draw_sky_and_sea,
};

// gSpawnPositions_Modes_4_and_5: four start places for each multiplayer stage, right after the per-level table
enum { OFFSET_SPAWNS = 0x4A6DEC, LEVELS_IN_TABLE = 18 };

Round hunt;

int chaohunt_active(void) { return hunt.active; }

void chaohunt_spawn(int level, int player, int32_t *x, int32_t *y) {
  uint32_t at = OFFSET_SPAWNS + LEVELS_IN_TABLE * 4 + (uint32_t)(level - LEVEL_CHAO_HUNT_A) * 16 + (uint32_t)player * 4;
  *x = rom_s16(at);
  *y = rom_s16(at + 2);
}

static void events_start(void);
void chaohunt_setup(void) {
  events_start();
  // AllocateCharacterStageGfx: in a round Sonic's own sprite loads neither tiles nor colours; his player's task does
  act.player.sprite.frameFlags |= SPRITE_KEEP_PALETTE | SPRITE_KEEP_TILES;
  int32_t x, y;
  chaohunt_spawn(act.stage.level, hunt.id, &x, &y);
  for (int i = 0; i < PLAYERS_MAX; i++) hunt.ranks[i] = -1;
  // every player's task starts where this GBA's own player starts, until its packets come in
  // and an arrow toward each other player
  for (int i = 0; i < hunt.count; i++) {
    mp_player_create(i, x, y);
    if (i != hunt.id) mp_indicator_create(i);
  }
  hunt.itemEffect = 0x80;
  // three minutes on a clock running down (GameStageStart)
  act.courseTime = 3 * 3600;
  act.timerReversed = 1;
}

void chaohunt_card_end(void) {
  for (int i = 0; i < PLAYERS_MAX; i++) mpPlayers[i].state &= ~2u;
  act.player.invulnerable = 120;
  hunt.itemEffect &= ~0x80;
  mp_hud_create();
}

void chaohunt_finish(void) {
  hunt.over = 1;
}

/** The VS menus have chosen the round: Chao Hunt's `level`, with the Chao at place `chao`. */
void chaohunt_start(int level, int chao) {
  memset(&hunt, 0, sizeof hunt);
  hunt.active = 1;
  hunt.id = link_id();
  hunt.count = link_count();
  hunt.chaoPlace = chao;
  // the seed the parent's Start handed every GBA in the mode select
  hunt.random = ctx.vsLink.seed;
  // each GBA plays the character its player picked in the VS character select
  ctx.character = ctx.vsLink.characters[hunt.id] & 3;
  ctx.partner = 0;
  act_active = 1;
  act_hold_black();
  // the VS screen's task ends itself as it asks for the round: the stage starts from the next frame
  act_queue(level, -1, 0);
}

// --- the room events (mp_event_mgr.c, mp_event_recv_mgr.c) -------------------------------------------------------------
// Things one player does that matter to the others go one at a time. A GBA queues them (16 slots of 8 bytes, never cleared,
// so a short event leaves the bytes of the one before it in its slot), sends the next once every other GBA has acknowledged
// the last by flipping its bit 0x1000 << id in their flags, and toggles its own bit with each new one. A receiving GBA
// handles an event when the sender's bit differs from its own copy, then flips its copy as the acknowledgement.

enum { QUEUE = 16, EVENT_SIZE = 6, KIND_STAGE = 0x1000, ITEM_TURN = 0x1FF, ITEM_GENERATION = 0xFFF, CONFUSION_TIME = 600 };
enum { EVENT_PLATFORM = 1, EVENT_MYSTERY_BOX = 5, EVENT_ITEM = 6, EVENT_GOAL = 7, EVENT_CHAO = 9, SE_CHAO_HUH = 163 };
static uint8_t queue[QUEUE][8];
static int written, sent;

static uint16_t flags_of(const uint8_t *packet) { return (uint16_t)(packet[8] | packet[9] << 8); }

void chaohunt_send_event(int type, int a, int b, int c, int d) {
  uint8_t *slot = queue[written];
  slot[0] = (uint8_t)type;
  if (type == EVENT_PLATFORM || type == EVENT_MYSTERY_BOX) { slot[1] = (uint8_t)a; slot[2] = (uint8_t)b; slot[3] = (uint8_t)c; slot[4] = (uint8_t)d; }
  else if (type == EVENT_ITEM) slot[1] = (uint8_t)a;
  else if (type == EVENT_CHAO) { slot[1] = (uint8_t)a; slot[2] = (uint8_t)b; }
  written = (written + 1) & (QUEUE - 1);
}

static void events_start(void) { memset(queue, 0, sizeof queue); written = sent = 0; }

int chaohunt_queue_empty(void) { return written == sent; }

// what another player's room event does on this GBA
static void receive_event(const uint8_t *ev, int from) {
  MpPlayer *own = &mpPlayers[hunt.id];
  switch (ev[0]) {
    case EVENT_MYSTERY_BOX: entities_set_d1(ev[1], ev[2], ev[3], ev[4]); break;
    case EVENT_ITEM:
      if ((own->state & 1) || act.player.dead || hunt.ranks[hunt.id] != -1) break;
      if (ev[1] == 0) { hunt.itemEffect |= 0x40; hunt.confusion = CONFUSION_TIME; }
      break;
    case EVENT_GOAL: break;
    case EVENT_CHAO:
      mpPlayers[from].state &= ~(0x10000u << ev[1]);
      mpPlayers[ev[2]].state |= 0x10000u << ev[1];
      play_song(SE_CHAO_HUH);
      break;
    default: break;
  }
}

void chaohunt_receive(void) {
  uint8_t *send = link_send();
  for (int i = 0; i < hunt.count; i++) {
    if (i == hunt.id) continue;
    const uint8_t *r = link_slot(i);
    if (!r) continue;
    uint16_t bit = (uint16_t)(0x1000 << i), mine = flags_of(send);
    if (packet_kind(r) == KIND_STAGE && (flags_of(r) & bit) != (mine & bit)) {
      if (r[0xE] > 0 && r[0xE] < 10) receive_event(r + 0xE, i);
      mine ^= bit;
      send[8] = (uint8_t)mine; send[9] = (uint8_t)(mine >> 8);
    }
  }
}

void chaohunt_send(void) {
  uint8_t *send = link_send();
  uint16_t bit = (uint16_t)(0x1000 << hunt.id), mine = flags_of(send) & bit;
  for (int i = 0; i < hunt.count; i++) {
    const uint8_t *r = link_slot(i);
    if (!r) return;
    if (packet_kind(r) == KIND_STAGE && (mine == 0) != !(flags_of(r) & bit)) return;
  }
  if (written == sent) memset(send + 0xE, 0, EVENT_SIZE);
  else {
    memcpy(send + 0xE, queue[sent], EVENT_SIZE);
    sent = (sent + 1) & (QUEUE - 1);
    uint16_t f = flags_of(send) ^ bit;
    send[8] = (uint8_t)f; send[9] = (uint8_t)(f >> 8);
  }
}

// the stage's frames since it started move the shared random numbers on every 512, and with them the mystery boxes' turn
// (its generation every 4096)
void chaohunt_clock(void) {
  int t = act.tick + 1;
  if ((t & ITEM_TURN) == 0) {
    hunt.random = hunt.random * 0x196225u + 0x3C6EF35Fu;
    if ((t & ITEM_GENERATION) == 0) hunt.itemTurn = (hunt.itemTurn & 0xF) | ((((hunt.itemTurn >> 4) + 1) << 4) & 0xF0);
    hunt.itemTurn = (hunt.itemTurn & 0xF8) | (int)(hunt.random & 7);
  }
}
