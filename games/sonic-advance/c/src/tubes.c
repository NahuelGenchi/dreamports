// Casino Paradise's tubes: the track (kind 106) and the tube junction (kind 107). Translated from the JavaScript version's
// engine/pipes.js (the original's track.c) and engine/junctions.js (107.c). The pipe entrances and exits (kinds 110 and 111) are in
// pipes.c; the air corners (112) are Cosmic Angel's and are not here.
//
// A track takes Sonic, curled up, along a straight stretch; the step of the chain holding him is act.player.track. A junction catches
// him where tubes meet, circles him and sends him off with a fresh press of a way out.

#include "objects.h"
#include "terrain.h"

enum { TUBE_TRACK = 106, TUBE_JUNCTION = 107 };
enum {
  PRIORITY_TRACK = 0x2000,
  SE_SPRING = 170, SE_TUBE = 202,
  STANDING_OFFSET_Y = 14,   // his standing height, curled up or not
  TRACK_NEAR = 10,          // how close to a track's start Sonic must be for it to take him
  JUNCTION_REACH = 10,
  AWAY_FRAMES = 20,         // the frames a junction leaves him alone after sending him off
  CARRY_MASK = 0xFF,        // a track's frame count wraps as a byte
  TURN = 1024, TURN_STEP = 4, ANGLE_SCALE = 8,   // the junction's circle: a turn of 1024, 4 a frame, 8 times that into the sine table
  OUT_SPEED = 9, DIAGONAL_RIGHT_X = 7, DIAGONAL_RIGHT_Y = 8, DIAGONAL_LEFT_X = -9, DIAGONAL_LEFT_Y = 7,
  WAY_COUNT = 4,
};

// the original divides by the frame count as it is; a count of 0 would be a division by zero here
static int div_frames(int a, int b) { return b ? a / b : 0; }
static double wrap16(double v) { return (int16_t)(int32_t)(int64_t)v; }

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

typedef struct {
  Object o;
  int held;
  // a track: its frame count, and where it put him a frame ago (1/256 px)
  int k;
  double prevX, prevY;
  // a junction: the frames left of leaving him alone, and his angle around it
  int away, angle;
} Tube;

static Tube *tube_new(Slot *slot) {
  Tube *tb = OBJECT_NEW(Tube);
  if (!tb) return NULL;
  tb->o.slot = slot;
  tb->o.x = slot->e.x;
  tb->o.sprite.graphics.dest = HEAP_END;   // no sprite: a tube is drawn in the level's tiles
  return tb;
}

// --- the track (Task_Track) --------------------------------------------------------------------------------------------------
// d0 and d1 tiles across and down, in d2 frames, as step d3. It takes Sonic when he is alive, within 10 px of its start, and on
// no step of a chain at or past its own (step 0 takes him whatever holds him). It leaves him in the air at its end; it only goes
// off screen while it holds no one.

// curled up and held, standing tall: his feet stay where they were
static void hold(Player *p) {
  p->carried = 1; p->state = PS_SPIN;
  sensors_set_offset_y(p, STANDING_OFFSET_Y);
}

// one frame of a carry along a straight stretch, from (x, y) by (dx, dy) in `steps` frames: the speeds are what he moved since
// the last frame this stretch moved him (from 0 on its first use, so wild). True once he is at its end.
static int carry(Player *p, Tube *tb, int x, int y, int dx, int dy, int steps) {
  int qx = (x + div_frames(tb->k * dx, steps)) * 256, qy = (y + div_frames(tb->k * dy, steps)) * 256;
  p->x = qx / 256.0; p->y = qy / 256.0;
  p->ysp = wrap16(qy - tb->prevY) / 256;
  p->gsp = p->xsp = wrap16(qx - tb->prevX) / 256;
  tb->k = (tb->k + 1) & CARRY_MASK;
  tb->prevX = qx; tb->prevY = qy;
  return (int)__builtin_floor(p->x) == x + dx && (int)__builtin_floor(p->y) == y + dy;
}

static int track_run(ActTask *t) {
  Tube *tb = (Tube *)t->data;
  const Entity *e = &tb->o.slot->e;
  Player *p = &act.player;
  int dx = s8(e->d[0]) * 8, dy = s8(e->d[1]) * 8, steps = e->d[2], step = e->d[3];
  if (tb->held) {
    if (p->dead) { p->carried = 0; tb->held = 0; }
    else if (act.player.track != step) tb->held = 0;   // the next step has him
    else if (carry(p, tb, e->x, e->y, dx, dy, steps)) { p->carried = 0; p->air = 1; tb->held = 0; }
    else { cancel(p); p->facing = 1; hold(p); }
  } else if (!p->dead && (act.player.track < step || step == 0)
    && __builtin_abs((int)__builtin_floor(p->x) - e->x) <= TRACK_NEAR && __builtin_abs((int)__builtin_floor(p->y) - e->y) <= TRACK_NEAR) {
    tb->k = 0;
    cancel(p);
    p->curled = 1;
    p->x = e->x; p->y = e->y;
    p->xsp = p->ysp = p->gsp = 0;
    hold(p);
    play_song(SE_TUBE);
    tb->held = 1;
    act.player.track = step;
  }
  if (!tb->held && off_cam(e->x, e->y)) return 0;
  return 1;
}

ActTask *tube_track_spawn(Slot *slot) {
  Tube *tb = tube_new(slot);
  return tb ? object_task(&tb->o, track_run, PRIORITY_TRACK | slot->e.d[3]) : NULL;
}

// --- the junction (kind 107) -------------------------------------------------------------------------------------------------
// Where tubes meet, Sonic's centre coming within 10 px of the junction catches him there, curled up and still, with the spring's
// sound. From the next frame he circles it, 4 px out and a turn every 32 frames, until a fresh press of a way out (his pressed
// directions, from his last frame) sends him off from its middle at 9 px a frame. d0 picks the ways out:
// 0: right, or else down, circling 4 px above the middle; 1: right, down and right at (7, 8), or left, down and left at (-9, 7);
// 2: right; 3: down. After sending him off it leaves him alone for 20 frames.

// the way out a fresh press picks, as a speed, or 0 for none; and how far above the middle he circles
static int way_out(int d0, int pressed, double *xsp, double *ysp) {
  switch (d0) {
    case 0:
      if (pressed & DPAD_RIGHT) { *xsp = OUT_SPEED; *ysp = 0; return 1; }
      if (pressed & DPAD_DOWN) { *xsp = 0; *ysp = OUT_SPEED; return 1; }
      return 0;
    case 1:
      if (pressed & DPAD_RIGHT) { *xsp = DIAGONAL_RIGHT_X; *ysp = DIAGONAL_RIGHT_Y; return 1; }
      if (pressed & DPAD_LEFT) { *xsp = DIAGONAL_LEFT_X; *ysp = DIAGONAL_LEFT_Y; return 1; }
      return 0;
    case 2:
      if (pressed & DPAD_RIGHT) { *xsp = OUT_SPEED; *ysp = 0; return 1; }
      return 0;
    default:
      if (pressed & DPAD_DOWN) { *xsp = 0; *ysp = OUT_SPEED; return 1; }
      return 0;
  }
}
static int circle_up(int d0) { return d0 == 0 ? 4 : 0; }

static int junction_run(ActTask *t) {
  Tube *tb = (Tube *)t->data;
  const Entity *e = &tb->o.slot->e;
  Player *p = &act.player;
  int d0 = s8(e->d[0]);
  if (p->dead) {
    // nothing
  } else if (tb->held) {
    double xsp, ysp;
    int out = way_out(d0, p->pressedDirs, &xsp, &ysp);
    tb->angle += TURN_STEP;
    if (tb->angle > TURN) tb->angle -= TURN;
    int a = (tb->angle * ANGLE_SCALE) & 0x3FF;
    p->x = e->x + (SINE[a + 256] / 16) / 256.0;
    p->y = e->y - circle_up(d0) + (SINE[a] / 16) / 256.0;
    player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
    p->state = PS_SPIN;
    sensors_set_offset_y(p, STANDING_OFFSET_Y);
    p->curled = 1; p->air = 1; p->carried = 1;
    if (out) {
      p->x = e->x; p->y = e->y;
      tb->away = AWAY_FRAMES;
      tb->held = 0;
      p->carried = 0;
      p->rotation = 0;
      p->xsp = xsp; p->ysp = ysp; p->gsp = p->xsp;
    }
  } else if (tb->away > 0) tb->away--;
  else {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (px >= e->x - JUNCTION_REACH && px <= e->x + JUNCTION_REACH && py >= e->y - JUNCTION_REACH && py <= e->y + JUNCTION_REACH) {
      p->curled = 1; p->carried = 1;
      tb->angle = 0;
      p->x = e->x; p->y = e->y;
      p->xsp = 0; p->ysp = 0; p->gsp = 0;
      sensors_set_offset_y(p, STANDING_OFFSET_Y);
      play_song(SE_SPRING);
      tb->held = 1;
    }
  }
  if (!tb->held && off_cam(e->x, e->y)) return 0;
  return 1;
}

ActTask *tube_junction_spawn(Slot *slot) {
  if (s8(slot->e.d[0]) < 0 || s8(slot->e.d[0]) >= WAY_COUNT) return NULL;   // no such junction
  Tube *tb = tube_new(slot);
  return tb ? object_task(&tb->o, junction_run, PRIORITY_OBJECTS) : NULL;
}
