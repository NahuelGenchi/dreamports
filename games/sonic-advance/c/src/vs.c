// What the VS menus' screens share (modeselect.c and the screens after it), translated from the JavaScript version's
// front/heartbeat.js and the helpers each of its VS screens repeats: their sprites and pictures, the link's heartbeat,
// leaving the link, and the save's records of the other players.

#include "sa.h"

#define HEARTBEATS 0xB5   // LINK_HEARTBEAT: frames a GBA of the round may go unheard

/** A sprite of a VS screen: its animation from the start, at normal speed. */
void vs_sprite(Sprite *s, uint16_t anim, uint32_t dest, int x, int y, uint16_t oamFlags, int variant, uint32_t frameFlags) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->x = (int16_t)x;
  s->y = (int16_t)y;
  s->oamFlags = oamFlags;
  s->variant = (uint8_t)variant;
  s->frameFlags = frameFlags;
}

/** A picture of a VS screen: tilemap `tilemapId`, `w` × `h` tiles, into the map at `layoutVram`. */
void vs_background(Background *bg, uint16_t tilemapId, uint32_t layoutVram, uint16_t w, uint16_t h) {
  background_init(bg);
  bg->layoutVram = layoutVram;
  bg->tilemapId = tilemapId;
  bg->targetTilesX = w;
  bg->targetTilesY = h;
}

/** Layer `bg`'s map cleared in the next V-blank, its rows up to `lastRow` (gBgSprites_Unknown1 and 2). */
void vs_clear_map(int bg, uint8_t lastRow) {
  e.mapFill[bg].value = 0;
  e.mapFill[bg].rect[0] = 0; e.mapFill[bg].rect[1] = 0; e.mapFill[bg].rect[2] = 0xFF; e.mapFill[bg].rect[3] = lastRow;
}

/** Who plays, a bit for each GBA: as the parent's Start said, or this GBA alone before it. */
int vs_connections(void) { return ctx.vsLink.set ? ctx.vsLink.connections : 1; }

/** Every GBA's heartbeat starts again, as each VS screen does as it starts. */
void vs_reset_missing(void) { memset(ctx.missing, 0, sizeof ctx.missing); }

/**
 * LINK_HEARTBEAT: a GBA of the round not heard from for 181 frames in a row is a lost link, which ends the screen with
 * the link error. Every connected GBA is counted, up to the first that isn't one. True when the link was lost.
 */
int vs_link_lost(void) {
  int flags = link_flags(), connections = vs_connections();
  for (int i = 0; i < PLAYERS_MAX && connections >> i & 1; i++) {
    if (!(flags & (1 << i))) {
      if (ctx.missing[i]++ >= HEARTBEATS) {
        destroy_tasks(0, 0xFFFF);
        clear_queues();
        create_link_error();
        return 1;
      }
    } else ctx.missing[i] = 0;
  }
  return 0;
}

/** MultiSioStop, MultiSioInit(0) and the packet sent cleared: the GBA leaves the link. */
void vs_leave_link(void) {
  link_enable(0);
  set_kind(link_send(), 0);
}

/** The save's record of the player in GBA `i`'s place: its id, name, wins, losses and draws, or NULL. */
const uint8_t *vs_record(int i) {
  int at = ctx.vsLink.set ? ctx.vsLink.records[i] : 0xFF;
  return at < 10 ? SAVE_MULTIPLAYER_SCORES + at * 16 : NULL;
}

/** The name of the player in GBA `i`'s place, eight characters: this GBA's own, or another's from its record. */
const uint8_t *vs_name(int i) {
  static const uint8_t none[8];
  if (i == link_id()) return SAVE_PLAYER_NAME;
  const uint8_t *record = vs_record(i);
  return record ? record + 4 : none;
}
