// Neo Green Hill act 1's enemies: the Kiki, Buzzer, GamiGami, Rhinotank and KeroKero, with the coconuts and shots
// they throw. Translated from the JavaScript version's engine/enemies.js and rom/entities.js (the original's kiki.c,
// buzzer.c, gamigami.c, rhinotank.c and kerokero.c), in the style of the act's other enemies.

#include "enemies.h"

enum {
  ANIM_KIKI = 401, ANIM_COCONUT_PIECE = 402, ANIM_BUZZER = 403, ANIM_GAMIGAMI = 404,
  ANIM_RHINOTANK = 405, ANIM_KEROKERO = 406, ANIM_COCONUT = 408, ANIM_BUZZER_SHOT = 409, ANIM_GAMIGAMI_SHOT = 410,
  ORDER_EFFECT = 18,
};
enum {
  KIKI_VAR_BOB = 1, KIKI_VAR_THROW = 2,
  BUZZER_VAR_FLY = 0, BUZZER_VAR_SHOOT = 1, BUZZER_VAR_TURN = 2,
  GAMI_VAR_WALK = 0, GAMI_VAR_CLAWS = 1,
  RHINO_VAR_DRIVE = 0, RHINO_VAR_REV = 1, RHINO_VAR_TURN = 2,
  KERO_VAR_JUMP = 0, KERO_VAR_CROAK = 1,
};
enum { Z_BUZZER_PATROL, Z_BUZZER_TURN, Z_BUZZER_SHOOT };
enum { Z_RHINO_PATROL, Z_RHINO_TURN, Z_RHINO_REV };
enum { Z_KERO_IDLE, Z_KERO_JUMP, Z_KERO_CROAK };
enum { EFFECT_COCONUT, EFFECT_COCONUT_PIECE, EFFECT_BUZZER_SHOT, EFFECT_GAMI_SHOT };
enum { SHOT_PRIORITY = 0x9000 };
// the coconut and the two shots draw from fixed places in sprite VRAM (vram_hardcoded.h), shared by all of their kind; a
// coconut's piece takes 16 tiles from the heap, whatever its frames need (CreateKikiProjectilePiece)
enum { COCONUT_PIECE_TILES = 16 };

typedef struct {
  Object o;
  int spawnX, spawnY, x, y, d0, d1, d2, d3;
  int kind, vel, off, yoff, t, tops, throwing, shot, right, tackle, state, vy, cd, croakIndex, n;
  int turnNext, turnRight, shootNext;
} Enemy;

typedef struct {
  Object o;
  int kind, x, y;
  // the coconut
  int x0, y0, vx, vy, acc, bounces, resting, rest;
  // the Buzzer's shot
  int qx, qy;
  // the GamiGami's shot
  int x4, dx;
} Effect;

static int iof(double v) { return (int)__builtin_floor(v); }
static int cos1024(int a) { return SINE[(a + 256) & 1023]; }
static int sin1024(int a) { return SINE[a & 1023]; }

// --- the enemies -----------------------------------------------------------------------------------------------------------
static void start(Enemy *e, int anim, int variant, int restart) {
  Sprite *s = &e->o.sprite;
  if (!restart && s->graphics.anim == anim && s->variant == variant) return;
  s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant;
  s->prevAnim = 0xFFFF;
  s->prevVariant = 0xFF;
}

// --- the coconut, its pieces, the Buzzer's shot and the GamiGami's ------------------------------------------------------------
static Effect *effect_new(int kind) {
  Effect *f = OBJECT_NEW(Effect);
  if (!f) return NULL;
  f->kind = kind;
  return f;
}

static void add_piece(int x, int y);

static int coconut_run(ActTask *t) {
  Effect *f = (Effect *)t->data;
  if (!f->resting) {
    f->vy = s16(f->vy + 40);
    f->acc = s16(f->acc + f->vx);
    f->x = f->x0 + f->acc / 40;   // the BIOS divide, rounding toward 0 as C's does
    f->y = s16(f->y + (f->vy >> 8));
    if (f->vy > 0) {
      int d = terrain_tile_floor(f->x, f->y, ENEMY_LAYER, 8);
      if (d < 0) {
        f->y += d;
        if (!f->bounces) { f->vy = -(f->vy >> 2); f->bounces++; }
        else { f->resting = 1; f->rest = 0; f->vy = 0; }
      }
    }
  } else if (f->rest++ >= 0x60) {
    // it leaves its pieces
    add_piece(f->x, f->y);
    return 0;
  }
  if (enemy_projectile(&f->o.sprite, f->x, f->y)) {
    // it breaks on him, and its pieces show
    add_piece(f->x, f->y);
    return 0;
  }
  sprite_step(&f->o.sprite);
  object_draw(&f->o.sprite, f->x, f->y);
  return 1;
}

static int piece_run(ActTask *t) {
  Effect *f = (Effect *)t->data;
  enemy_projectile(&f->o.sprite, f->x, f->y);
  // the original ends the piece on its animation's end frame, before drawing it
  if (sprite_step(&f->o.sprite)) return 0;
  object_draw(&f->o.sprite, f->x, f->y);
  return 1;
}

static int buzzer_shot_run(ActTask *t) {
  Effect *f = (Effect *)t->data;
  f->qx += f->vx;
  f->qy += f->vy;
  f->x = f->qx >> 8;
  f->y = f->qy >> 8;
  enemy_projectile(&f->o.sprite, f->x, f->y);
  int sx = f->x - cam_x(), sy = f->y - cam_y();
  if ((uint16_t)(sx + 40) > 320 || sy + 40 < 0 || sy > 200) return 0;
  sprite_step(&f->o.sprite);
  object_draw(&f->o.sprite, f->x, f->y);
  return 1;
}

static int gami_shot_run(ActTask *t) {
  Effect *f = (Effect *)t->data;
  f->x4 += f->dx;
  f->x = f->x4 >> 2;
  f->vy += 40;
  f->y += f->vy >> 8;
  enemy_projectile(&f->o.sprite, f->x, f->y);
  int sx = f->x - cam_x(), sy = f->y - cam_y();
  if ((uint16_t)(sx + 20) > 276 || sy + 20 < 0 || sy > 240) return 0;
  sprite_step(&f->o.sprite);
  object_draw(&f->o.sprite, f->x, f->y);
  return 1;
}

static void add_piece(int x, int y) {
  Effect *p = effect_new(EFFECT_COCONUT_PIECE);
  if (!p) return;
  p->x = x; p->y = y;
  object_sprite_at(&p->o.sprite, vram_malloc(COCONUT_PIECE_TILES), ANIM_COCONUT_PIECE, 0, ORDER_EFFECT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&p->o.sprite);
  object_task(&p->o, piece_run, PRIORITY_OBJECTS);
}

// a coconut: toward where Sonic is, up to 1.5 px a frame, a bounce, a 96-frame rest, then its pieces
static void add_coconut(int x, int y) {
  Effect *f = effect_new(EFFECT_COCONUT);
  if (!f) return;
  int px = enemy_sonic_x();
  int vx = px < x ? -((x - px) * 400 / 800) : (px - x) * 400 / 800;
  if (vx < -60) vx = -60;
  if (vx > 60) vx = 60;
  f->x = f->x0 = x; f->y = f->y0 = y;
  f->vx = vx; f->vy = -512; f->acc = 0; f->bounces = 0; f->resting = 0; f->rest = 0;
  object_sprite_at(&f->o.sprite, OBJ_VRAM + VRAM_KIKI_SHOT, ANIM_COCONUT, 0, ORDER_EFFECT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&f->o.sprite);
  object_task(&f->o, coconut_run, PRIORITY_OBJECTS);
}

// sub_8004418: an angle (1024 a turn) from a distance, linear within each eighth of a turn
static int octant_angle(int a, int b) {
  static const int ARR[8] = { 1, 0, 2, 3, 6, 7, 5, 4 };
  int index = 0;
  if (a <= 0) { a = -a; index = 4; }
  if (b <= 0) { b = -b; index += 2; }
  int frac;
  if (a >= b) frac = b * 128 / a;
  else { index++; frac = a * 128 / b; }
  if (ARR[index] & 1) frac = 128 - frac;
  return (frac + ARR[index] * 128) & 1023;
}

// the Buzzer's shot: straight at where Sonic was, about 1.68 px a frame, on through him
static void add_buzzer_shot(int x, int y) {
  Effect *f = effect_new(EFFECT_BUZZER_SHOT);
  if (!f) return;
  int a = octant_angle(enemy_sonic_y() - y, enemy_sonic_x() - x);
  f->vx = cos1024(a) / 38;
  f->vy = sin1024(a) / 38;
  f->qx = x * 256; f->qy = y * 256;
  f->x = x; f->y = y;
  object_sprite_at(&f->o.sprite, OBJ_VRAM + VRAM_BUZZER_SHOT, ANIM_BUZZER_SHOT, 0, ORDER_EFFECT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&f->o.sprite);
  object_task(&f->o, buzzer_shot_run, SHOT_PRIORITY);
}

// the GamiGami's shot: 1.5 px a frame sideways, thrown up and falling through everything
static void add_gami_shot(int x4, int dx, int y) {
  Effect *f = effect_new(EFFECT_GAMI_SHOT);
  if (!f) return;
  f->x4 = x4; f->dx = dx;
  f->x = x4 >> 2; f->y = y; f->vy = -512;
  object_sprite_at(&f->o.sprite, OBJ_VRAM + VRAM_GAMIGAMI_SHOT, ANIM_GAMIGAMI_SHOT, 0, 9, ENEMY_PRIORITY, 0, 0);
  sprite_step(&f->o.sprite);
  object_task(&f->o, gami_shot_run, PRIORITY_SONIC);
}

// --- the enemies' moves ------------------------------------------------------------------------------------------------------
static int gone(Enemy *e, int x, int y) { return enemy_gone(e->spawnX, e->spawnY, x, y); }

// Kiki (kiki.c): climbs its tree 1 px a frame and throws a coconut on every second visit to the top
static int kiki_run(ActTask *t) {
  Enemy *e = (Enemy *)t->data;
  Sprite *s = &e->o.sprite;
  int wasThrowing = e->throwing;
  if (!e->throwing) {
    e->yoff = s8(e->yoff + e->vel);
    int top = e->d1 * 8;
    if (e->yoff <= top) {
      e->tops = (e->tops + 1) & 0xFF;
      e->vel = 1;
      if (!(e->tops & 1)) { e->t = 0; start(e, ANIM_KIKI, KIKI_VAR_THROW, 0); e->throwing = 1; }
    } else if (e->yoff >= top + e->d3 * 8) e->vel = -1;
  }
  e->x = e->spawnX;
  e->y = e->spawnY + e->yoff;
  if (enemy_attack(s, e->x, e->y)) { e->o.slot->gone = 1; return 0; }
  if (gone(e, e->x, e->y)) return 0;
  enemy_flip_x(s, !(enemy_sonic_x() < e->x));
  // the throw counts from the frame after the top, and ends on its 15th, before its animation does
  if (wasThrowing && ++e->t > 14) {
    e->throwing = 0;
    start(e, ANIM_KIKI, KIKI_VAR_BOB, 0);
    add_coconut((s->frameFlags & SPRITE_X_FLIP) ? e->x - 18 : e->x + 8, e->y - 8);
  }
  sprite_step(s);
  // facing right, it is drawn 8 px left of its box (kiki.c)
  object_draw(s, e->x - ((s->frameFlags & SPRITE_X_FLIP) ? 8 : 0), e->y);
  return 1;
}

// Buzzer (buzzer.c): flies back and forth 1 px a frame, stopping once a leg to shoot at the wedge below it
static int buzzer_run(ActTask *t) {
  Enemy *e = (Enemy *)t->data;
  Sprite *s = &e->o.sprite;
  // its bounds and its shot are decided after it is drawn, so the change shows on the next frame
  if (e->turnNext) {
    e->turnNext = 0; e->vel = e->turnRight ? 256 : -256;
    start(e, ANIM_BUZZER, BUZZER_VAR_TURN, 1); e->state = Z_BUZZER_TURN; enemy_flip_x(s, e->turnRight);
  }
  if (e->shootNext) { e->shootNext = 0; start(e, ANIM_BUZZER, BUZZER_VAR_SHOOT, 1); e->t = 0; e->state = Z_BUZZER_SHOOT; }
  if (e->state == Z_BUZZER_PATROL) e->off += e->vel;
  e->x = e->spawnX + (e->off >> 8);
  e->y = e->spawnY;
  if (e->state == Z_BUZZER_SHOOT && ++e->t == 10) add_buzzer_shot(e->x, e->y + 6);
  // it leaves by where it has flown to, not by where it started (buzzer.c tests worldX with its flight added)
  if (enemy_gone(e->x, e->y, e->x, e->y)) return 0;
  if (enemy_attack(s, e->x, e->y)) { e->o.slot->gone = 1; return 0; }
  if (e->state == Z_BUZZER_PATROL) {
    if ((e->off >> 8) <= e->d0 * 8) {
      e->turnNext = 1; e->turnRight = 1;
    } else if ((e->off >> 8) >= (e->d0 + e->d2) * 8) {
      e->turnNext = 1; e->turnRight = 0;
    } else if (!e->shot) {
      int px = enemy_sonic_x(), py = enemy_sonic_y();
      if (e->y <= py && e->y + 96 >= py) {
        int dy = py - e->y, dx = e->x - px;
        int hi = s16(dx * 17 / 10), lo = s16(dx * 10 / 17);
        // `frameFlags &= X_FLIP` where `&` was meant: the original also clears the sprite's priority
        s->frameFlags &= ~SPRITE_PRIORITY;
        if (s->frameFlags & SPRITE_X_FLIP) { hi = -hi; lo = -lo; }
        if (hi >= dy && lo <= dy) e->shootNext = 1;
      }
    }
  } else if (e->state == Z_BUZZER_SHOOT) {
    if (e->t >= 30) { start(e, ANIM_BUZZER, BUZZER_VAR_FLY, 1); e->state = Z_BUZZER_PATROL; e->shot = 1; }
  } else e->shot = 0;
  int ended = sprite_step(s);
  if (e->state == Z_BUZZER_TURN && ended) { start(e, ANIM_BUZZER, BUZZER_VAR_FLY, 0); e->state = Z_BUZZER_PATROL; }
  object_draw(s, e->x, e->y);
  return 1;
}

// GamiGami (gamigami.c): walks 0.625 px a frame and, at each end, raises its claws for 19 frames, firing two
// shots on the 15th. It follows the ground, and its sprite never turns round.
static int gamigami_run(ActTask *t) {
  Enemy *e = (Enemy *)t->data;
  Sprite *s = &e->o.sprite;
  if (!e->tackle) e->off += e->vel;   // `tackle` here is the JavaScript's `turning`
  int x = e->spawnX + e->off / 256;
  int y = e->spawnY - 6 + e->yoff;
  e->x = x; e->y = y;
  if (e->tackle && ++e->t == 15) {
    // the right one first; both run after Sonic, from this frame
    add_gami_shot((x + 14) * 4, 6, y - 20);
    add_gami_shot((x - 14) * 4, -6, y - 20);
  }
  if (gone(e, x, y)) return 0;
  if (enemy_attack(s, x, y)) { e->o.slot->gone = 1; return 0; }
  e->yoff += terrain_tile_floor(x, y, e->d3 ? 1 : 0, 8);
  if (!e->tackle) {
    if (e->off / 256 <= e->d0 * 8) {
      if (!e->right) { e->vel = 160; e->t = 0; e->right = 1; start(e, ANIM_GAMIGAMI, GAMI_VAR_CLAWS, 0); e->tackle = 1; }
    } else if (e->off / 256 >= (e->d0 + e->d2) * 8) {
      if (e->right) { e->vel = -160; e->t = 0; e->right = 0; start(e, ANIM_GAMIGAMI, GAMI_VAR_CLAWS, 0); e->tackle = 1; }
    }
  } else if (e->t > 18) { start(e, ANIM_GAMIGAMI, GAMI_VAR_WALK, 0); e->tackle = 0; }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

// Rhinotank (rhinotank.c): drives 0.625 px a frame, slides round at each end, and charges at 3 px a frame when
// Sonic is within 80 px in front of it
static int rhinotank_run(ActTask *t) {
  Enemy *e = (Enemy *)t->data;
  Sprite *s = &e->o.sprite;
  if (e->state == Z_RHINO_PATROL) e->off += e->vel;
  int x = e->spawnX + (e->state == Z_RHINO_PATROL ? e->off / 256 : (e->off >> 8));
  int y = e->spawnY + e->yoff;
  e->x = x; e->y = y;
  if (gone(e, x, y)) return 0;
  if (enemy_attack(s, x, y)) { e->o.slot->gone = 1; return 0; }
  e->yoff += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
  if (e->state == Z_RHINO_PATROL) {
    int px = enemy_sonic_x(), py = enemy_sonic_y();
    // at either end it turns if it faces that way; facing away it doesn't look for Sonic that frame
    if ((e->off >> 8) <= (e->d0 + 1) * 8) {
      if (!(s->frameFlags & SPRITE_X_FLIP)) {
        if (e->tackle) e->off += 768;
        e->t = 0; e->vel = 160; start(e, ANIM_RHINOTANK, RHINO_VAR_TURN, 0); e->state = Z_RHINO_TURN;
      }
    } else if ((e->off >> 8) >= (e->d0 + e->d2 - 1) * 8) {
      if (s->frameFlags & SPRITE_X_FLIP) {
        if (e->tackle) e->off -= 768;
        e->t = 0; e->vel = -160; start(e, ANIM_RHINOTANK, RHINO_VAR_TURN, 0); e->state = Z_RHINO_TURN;
      }
    } else if (!e->tackle && y - 32 <= py && y + 8 >= py
      && ((s->frameFlags & SPRITE_X_FLIP) ? (x <= px && x + 80 >= px) : (x - 80 <= px && x >= px))) {
      e->tackle = 1; e->t = 0; e->vel = (s->frameFlags & SPRITE_X_FLIP) ? 768 : -768;
      start(e, ANIM_RHINOTANK, RHINO_VAR_REV, 0); e->state = Z_RHINO_REV;
    }
  } else if (e->state == Z_RHINO_TURN) {
    // it slides on the old way, slowing down and coming back a little at the end
    int k = cos1024(e->t * 21) / (e->tackle ? 32 : 64);
    e->off += (s->frameFlags & SPRITE_X_FLIP) ? k : -k;
    if (++e->t == 24) {
      start(e, ANIM_RHINOTANK, RHINO_VAR_DRIVE, 0);
      e->off += e->vel;
      e->vel = (s->frameFlags & SPRITE_X_FLIP) ? -160 : 160;
      enemy_flip_x(s, !(s->frameFlags & SPRITE_X_FLIP));
      e->tackle = 0;
      e->state = Z_RHINO_PATROL;
    }
  } else if (++e->t == 25) {
    start(e, ANIM_RHINOTANK, RHINO_VAR_DRIVE, 0);
    e->state = Z_RHINO_PATROL;
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

// KeroKero (kerokero.c): jumps 1 px a frame toward Sonic when he is within 80 px on the side it faces, at any
// height, and croaks now and then. Sitting, its animation doesn't run, so it shows one frame.
static const int CROAK_STEPS[8] = { 54, 43, 34, 32, 12, 100, 25, 32 };

static int kerokero_run(ActTask *t) {
  Enemy *e = (Enemy *)t->data;
  Sprite *s = &e->o.sprite;
  int px = enemy_sonic_x();
  if (e->state == Z_KERO_JUMP) {
    e->vy += 64;
    e->yoff += e->vy / 256;
    e->off += (s->frameFlags & SPRITE_X_FLIP) ? 256 : -256;
  }
  int x = e->spawnX + (e->off >> 8);
  int y = e->spawnY + e->yoff;
  e->x = x; e->y = y;
  if (gone(e, x, y)) return 0;
  if (e->state == Z_KERO_IDLE) e->n = s16(e->n + 1);
  if (enemy_attack(s, x, y)) { e->o.slot->gone = 1; return 0; }
  int d = terrain_tile_floor(x, y, e->d3 ? 1 : 0, 8);
  int step = 1;
  if (e->state == Z_KERO_IDLE) {
    e->yoff += d;
    enemy_flip_x(s, px > e->spawnX + (e->off >> 8));
    if (e->n > 250) { e->cd = 0; e->n -= 250; start(e, ANIM_KEROKERO, KERO_VAR_CROAK, 0); e->state = Z_KERO_CROAK; }
    else if (e->cd != 0) e->cd--;
    else if (((s->frameFlags & SPRITE_X_FLIP) && (e->off >> 8) <= (e->d0 + e->d2 - 8) * 8 && x <= px && x + 80 >= px)
      || (!(s->frameFlags & SPRITE_X_FLIP) && (e->off >> 8) >= (e->d0 + 8) * 8 && x - 80 <= px && x >= px)) {
      e->vy = -1280;
      start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 0);
      e->n = s16(e->n + CROAK_STEPS[e->croakIndex]);
      e->croakIndex = (e->croakIndex + 1) & 7;
      e->state = Z_KERO_JUMP;
    }
    step = 0;   // idle: no UpdateSpriteAnimation, as the JavaScript's idle branch
  } else if (e->state == Z_KERO_JUMP) {
    if (d <= 0) {
      e->cd = 5;
      e->yoff += d;
      // the original shows a croak frame, then starts the jump again; only the jump's first frame is kept
      start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 1);
      e->state = Z_KERO_IDLE;
      enemy_flip_x(s, px > e->spawnX + (e->off >> 8));
    }
  } else {
    e->yoff += d;
    if (++e->cd > 60) { e->cd = 0; start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 0); e->state = Z_KERO_IDLE; }
  }
  if (step) sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

// --- the spawns ---------------------------------------------------------------------------------------------------------------
static Enemy *enemy_new(Slot *slot, int kind) {
  Enemy *e = OBJECT_NEW(Enemy);
  if (!e) return NULL;
  EnemyData d = enemy_data(&slot->e);
  e->o.slot = slot;
  e->o.x = slot->e.x;
  e->spawnX = slot->e.x; e->spawnY = slot->e.y;
  e->d0 = d.d0; e->d1 = d.d1; e->d2 = d.d2; e->d3 = d.d3;
  e->kind = kind;
  return e;
}

ActTask *kiki_spawn(Slot *slot) {
  Enemy *e = enemy_new(slot, 0);
  if (!e) return NULL;
  e->vel = 1;
  enemy_sprite(&e->o.sprite, ANIM_KIKI, KIKI_VAR_BOB, KIKI_VAR_THROW, ENEMY_ORDER);
  return object_task(&e->o, kiki_run, PRIORITY_OBJECTS);
}

ActTask *buzzer_spawn(Slot *slot) {
  Enemy *e = enemy_new(slot, 1);
  if (!e) return NULL;
  Sprite *s = &e->o.sprite;
  e->vel = -256;
  // it turns to Sonic once its sprite is set and before its first step, so the turn stays (CreateEntity_Buzzer)
  object_sprite(s, ANIM_BUZZER, BUZZER_VAR_FLY, BUZZER_VAR_TURN, ENEMY_ORDER, ENEMY_PRIORITY, 0, 0);
  if (enemy_sonic_x() >= e->spawnX) { e->vel = 256; enemy_flip_x(s, 1); }
  sprite_step(s);
  return object_task(&e->o, buzzer_run, PRIORITY_OBJECTS);
}

ActTask *gamigami_spawn(Slot *slot) {
  Enemy *e = enemy_new(slot, 2);
  if (!e) return NULL;
  e->vel = -160;
  if (enemy_sonic_x() >= e->spawnX) { e->vel = 160; e->right = 1; }
  enemy_sprite(&e->o.sprite, ANIM_GAMIGAMI, GAMI_VAR_WALK, GAMI_VAR_CLAWS, ENEMY_ORDER);
  return object_task(&e->o, gamigami_run, PRIORITY_OBJECTS);
}

ActTask *rhinotank_spawn(Slot *slot) {
  Enemy *e = enemy_new(slot, 3);
  if (!e) return NULL;
  e->vel = -160;
  enemy_sprite(&e->o.sprite, ANIM_RHINOTANK, RHINO_VAR_DRIVE, RHINO_VAR_TURN, ENEMY_ORDER);
  return object_task(&e->o, rhinotank_run, PRIORITY_OBJECTS);
}

ActTask *kerokero_spawn(Slot *slot) {
  Enemy *e = enemy_new(slot, 4);
  if (!e) return NULL;
  enemy_sprite(&e->o.sprite, ANIM_KEROKERO, KERO_VAR_JUMP, KERO_VAR_CROAK, ENEMY_ORDER);
  return object_task(&e->o, kerokero_run, PRIORITY_OBJECTS);
}

