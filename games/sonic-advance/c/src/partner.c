// CPU Tails, the partner the character select's code brings along, translated from the JavaScript version's
// engine/partner.js (SAT-R decompilation, src/game/shared/stage/player.c: sub_8045DF0, Task_8045B38, Task_804597C,
// Task_8045AD8, Player_Tails_804571C, and src/game/sa1/stage/player_controls.c: sub_804D13C). He is a second player with
// Tails' moves, running just after Sonic, whose controls are Sonic's buttons of 20 frames ago with a few of the CPU's own
// touches: he goes to where Sonic is, jumps when Sonic is well above him, and flies up to him. Thrown off the bottom of the
// screen, or left far behind, he comes back flying, straight through everything, until he's over Sonic's head with room
// to land.

#include "objects.h"
#include "terrain.h"

enum {
  LATE = 20,                 // gUnknown_030060F0[20]: how many frames behind Sonic's buttons his are
  REGION = 256,              // CAM_REGION_WIDTH: how far past the screen he can go
  NEAR = 16, HIGH = 80, ABOVE = 16, BESIDE = 32, OVER_HEAD = 48,
  SE_LIFE_LOST = 119, SE_DROWNED = 192, SE_TAILS_FLYING = 120,
};
#define FALL_GRAVITY (42.0 / 256)
#define FALL_WATER_GRAVITY (12.0 / 256)

// what his task does this frame: play (Task_8045B38), fall off the screen (Task_804597C), or fly back (Task_8045AD8)
enum { PLAY, FALLEN, RETURNING };
static int task;
static PlayerInput last;                 // the buttons he read last (unk50)
static PlayerInput history[LATE + 1];    // Sonic's last frames' buttons, the newest first

static int whole(double v) { return (int)__builtin_floor(v); }

void partner_start(void) {
  memset(history, 0, sizeof history);
  task = PLAY;
  // InitializePlayer leaves him holding jump and attack, so neither is pressed until let go
  memset(&last, 0, sizeof last);
  last.jump = last.attack = 1;
  act.hasPartner = 1;
  player_init_partner(&act.partner, act.stage.spawnX, act.stage.spawnY);
}

/** Sonic's buttons this frame, or nothing while the title card or an object holds his controls (sub_804D13C). */
void partner_hear(const PlayerInput *in) {
  memmove(&history[1], &history[0], LATE * sizeof history[0]);
  memset(&history[0], 0, sizeof history[0]);
  if (!in) return;
  history[0].left = in->left; history[0].right = in->right; history[0].up = in->up; history[0].down = in->down;
  history[0].jump = in->jump; history[0].attack = in->attack;
}

// sub_8045DF0: his buttons this frame, and those pressed
static PlayerInput buttons_for(Player *p, const Player *sonic) {
  PlayerInput was = last, held = history[LATE];
  if (!((p->rotation + 0x20) & 0xC0)) {
    if (p->x + NEAR < sonic->x) {
      if (!held.down) { held.right = 1; held.left = 0; }
    } else if (p->x - NEAR > sonic->x) {
      if (!held.down) { held.left = 1; held.right = 0; }
    } else held.left = held.right = 0;
    // standing still, he turns to face the way Sonic faces
    if (!held.left && !held.right && p->gsp == 0 && !p->air && p->attack == 0 && (p->state == PS_WALK || p->state == PS_IDLE)
        && !p->actClear && !p->halfPipe && !p->spinDashing && !p->forcedRoll && !p->onObject && p->facing != sonic->facing) {
      p->facing = sonic->facing;
      p->state = PS_TURN;
    }
  }
  int jumpPressed = held.jump && !was.jump;
  int attackPressed = held.attack && !was.attack;
  int inv = sonic->inverted;
  // a is further down the act than b
  #define UNDER(a, b) (inv ? (a) < (b) : (a) > (b))
  if (!p->air) {
    if (UNDER(p->y - (inv ? -HIGH : HIGH), sonic->y)) jumpPressed = 1;
  } else if (UNDER(p->y, sonic->y + (inv ? ABOVE : -ABOVE))) {
    if (p->midAir != 0 || p->ysp > 0) {
      if (UNDER(p->y, sonic->y)) jumpPressed = 1;
    } else held.jump = 1;
  }
  #undef UNDER
  if (held.left || held.right) held.up = held.down = 0;
  last = held;
  held.jumpPressed = jumpPressed; held.attackPressed = attackPressed;
  return held;
}

// the frame he has gone off the screen or fallen out of it: flying from then on, with the drowning count started over
static void start_flying(Player *p) {
  p->state = p->water ? PS_SWIM : PS_FLY;
  p->pushing = 0;
  p->drownFrames = 60; p->drownSeconds = 30;
  task = RETURNING;
}

// Player_Tails_804571C: on the way back, along the screen's edges at the furthest, 2 px a frame across and 1 down or up to
// 48 px over Sonic's head, until he's within 32 px of there with ground not in his way. He takes Sonic's layer (and the
// original, for each frame he's on a rail, swaps Sonic's)
static void come_back(Player *p, Player *sonic) {
  const Camera *cam = &act.cam;
  int inv = sonic->inverted;
  p->layer = sonic->layer;
  if (sonic->grinding) sonic->layer ^= 1;
  p->state = p->water ? PS_SWIM : PS_FLY;
  int cx = whole(cam->x), cy = whole(cam->y);
  if (whole(p->x) < cx - REGION) p->x = cx - REGION;
  if (whole(p->x) > cx + SCREEN_W + REGION) p->x = cx + SCREEN_W + REGION;
  if (whole(p->y) < cy - REGION) p->y = cy - REGION;
  if (whole(p->y) > cy + SCREEN_H + REGION) p->y = cy + SCREEN_H + REGION;
  int px = whole(p->x), py = whole(p->y), sx = whole(sonic->x), sy = whole(sonic->y);
  int target = inv ? sy + OVER_HEAD : sy - OVER_HEAD;
  if (px - BESIDE < sx && px + BESIDE > sx && py - BESIDE < target && py + BESIDE > target && sensors_clearance(p, 0) >= 0) {
    p->pushing = 0; p->onObject = NULL; p->spinDashing = 0; p->halfPipe = 0; p->forcedRoll = 0; p->actClear = 0;
    p->jumped = 0; p->airLock = 0;
    p->midAir = 0; p->attack = 0; p->attackNext = 0; p->curled = 0; p->invisible = 0; p->dead = 0; p->ignoreInput = 0; p->carried = 0;
    p->gsp = 0; p->xsp = 0; p->ysp = 0;
    stop_song(SE_TAILS_FLYING);
    p->state = PS_FLY_LAND;
    task = PLAY;
    return;
  }
  if (px + 1 < sx) { p->x += 2; p->facing = 1; }
  else if (sx < px - 1) { p->x -= 2; p->facing = -1; }
  if (py < target) p->y += 1;
  else if (target < py) p->y -= 1;
}

// Task_8045B38 and the two tasks it hands over to: his frame's movement, returning the buttons his animation goes by.
// `card` holds him as the title card holds Sonic.
static PlayerInput partner_move(Player *p, Player *sonic, int card) {
  const Camera *cam = &act.cam;
  switch (task) {
    case PLAY: {
      if (p->dead) {
        // the frame he's found dead: he stops moving sideways, shields and timers gone, in front of the front layer
        task = FALLEN;
        p->state = PS_DEAD;
        p->xsp = 0; p->invulnerable = 2; p->shield = SHIELD_NONE; p->invincible = 0; p->speedUp = 0;
        p->pushing = 0; p->onObject = NULL; p->front = 1; p->scale = FULL_SCALE;
        stop_song(SE_TAILS_FLYING);
        play_song(p->drownSeconds < 0 ? SE_DROWNED : SE_LIFE_LOST);
        return last;
      }
      PlayerInput buttons;
      if (card) buttons = (PlayerInput){ .jump = 1, .attack = 1 };
      else if (p->ignoreInput) buttons = p->heldRight ? (PlayerInput){ .right = 1 } : p->heldLeft ? (PlayerInput){ .left = 1 } : (PlayerInput){0};
      else buttons = buttons_for(p, sonic);
      int x = whole(p->x), y = whole(p->y), cx = whole(cam->x), cy = whole(cam->y);
      if (x < cx - REGION || x > cx + SCREEN_W + REGION || y < cy - REGION || y > cy + SCREEN_H + REGION) {
        player_water_step(p);
        start_flying(p);
        p->dead = 1;
        return buttons;
      }
      player_step(p, &buttons);
      return buttons;
    }
    case FALLEN: {
      // Task_804597C: he falls through everything until he's a screen's width below the camera's top
      int y = (int)__builtin_floor(p->y * 256 + 0.5), top = whole(cam->y);
      int gone = sonic->inverted ? y <= (top - 80) * 256 : y >= (top + SCREEN_W) * 256 - 1;
      if (gone) {
        p->x = whole(cam->x) - REGION; p->y = top - REGION;
        p->front = 0; p->prio = 2; p->dead = 0;
        start_flying(p);
        return last;
      }
      p->x += p->xsp;
      p->y += sonic->inverted ? -p->ysp : p->ysp;
      p->ysp += p->water ? FALL_WATER_GRAVITY : FALL_GRAVITY;
      return last;
    }
    default:
      // Task_8045AD8
      player_water_step(p);
      come_back(p, sonic);
      return last;
  }
}

/** His task (0x3001), just after Sonic's: his movement, his animation and his tails. */
void partner_task(int card) {
  if (!act.hasPartner) return;
  Player *p = &act.partner;
  PlayerInput held = partner_move(p, &act.player, card);
  player_animate(p, &held);
  player_tails_step(p);
}
