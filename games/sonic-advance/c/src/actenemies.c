// Neo Green Hill act 1's enemies in C: the Kiki, Buzzer, GamiGami, Rhinotank and KeroKero, their coconuts and
// shots, and the dust, freed animals and points a defeat leaves. Translated from the JavaScript version's
// engine/enemies.js, engine/defeat.js and rom/entities.js, in the style of act.c and actrings.c.
//
// Each enemy keeps its spawn point and works its place out from it every frame. It leaves once its spawn point
// and its current place are both outside the camera's range (x−128..x+368, y−128..y+288), and a defeated one
// stays gone until the act starts over. A defeat leaves a dust cloud (407), then the next Neo Green Hill animal
// (445 otter, 450 koala, 449 kangaroo), then its points (709), and plays song 138.

#include "act.h"
#include "actobjects.h"
#include "actenemies.h"

// the enemy table after the item boxes in the USA copy (rom/versions.js)
#define OFFSET_ENEMIES 0x0B8024

#define ENEMY_REGION 256
#define ENEMY_MAX 64
#define EFFECT_MAX 16
#define ENEMY_RL_MAX 0x4000

// the enemy kinds of Neo Green Hill act 1 (enemies.js KIKI..KEROKERO)
enum { KIND_KIKI, KIND_BUZZER, KIND_GAMIGAMI, KIND_RHINOTANK, KIND_KEROKERO };

// animations (rom/extract.js ENEMY_ANIMATIONS and the freed animals)
enum {
  ANIM_KIKI = 401, ANIM_COCONUT_PIECE = 402, ANIM_BUZZER = 403, ANIM_GAMIGAMI = 404,
  ANIM_RHINOTANK = 405, ANIM_KEROKERO = 406, ANIM_DUST = 407, ANIM_COCONUT = 408,
  ANIM_BUZZER_SHOT = 409, ANIM_GAMIGAMI_SHOT = 410, ANIM_SCORE = 709,
  ANIM_OTTER = 445, ANIM_KOALA = 450, ANIM_KANGAROO = 449,
};

// the variants the scripts name: kikiBob then kikiThrow, and so on (rom/extract.js)
enum {
  KIKI_VAR_BOB = 1, KIKI_VAR_THROW = 2,
  BUZZER_VAR_FLY = 0, BUZZER_VAR_SHOOT = 1, BUZZER_VAR_TURN = 2,
  GAMI_VAR_WALK = 0, GAMI_VAR_CLAWS = 1,
  RHINO_VAR_DRIVE = 0, RHINO_VAR_REV = 1, RHINO_VAR_TURN = 2,
  KERO_VAR_JUMP = 0, KERO_VAR_CROAK = 1,
};

// each enemy's state machine (enemies.js)
enum { Z_BUZZER_PATROL, Z_BUZZER_TURN, Z_BUZZER_SHOOT };
enum { Z_RHINO_PATROL, Z_RHINO_TURN, Z_RHINO_REV };
enum { Z_KERO_IDLE, Z_KERO_JUMP, Z_KERO_CROAK };

// the effects: a coconut and its pieces, two kinds of shot, the dust, a freed animal's moves and the points
enum { EFFECT_COCONUT, EFFECT_COCONUT_PIECE, EFFECT_BUZZER_SHOT, EFFECT_GAMI_SHOT, EFFECT_DUST, EFFECT_ANIMAL, EFFECT_SCORE };
enum { ANIMAL_SITS, ANIMAL_HOPS };

// the act's player states (act.c): spin and bounce carry his attack box
enum { ENEMY_PS_SPIN = 6, ENEMY_PS_BOUNCE = 12 };

typedef struct {
  int spawnX, spawnY;
  int8_t d0, d1;
  uint8_t d2, d3;
  int kind;
  int live, gone;
  Sprite s;
  int x, y;
  int flipX, animStep;
  // the kinds' own clocks and offsets, as the JavaScript keeps them
  int vel, off, yoff, t, tops, throwing, shot, right, tackle, state, vy, cd, croakIndex, n;
  int turnNext, turnRight, shootNext;   // the Buzzer's changes show on the frame after the decision
} Enemy;

typedef struct {
  int active, kind, animStep, flipX;
  int born;                  // the tick it was made on, for the defeat effects whose tasks start next frame
  Sprite s;
  int x, y;
  // the coconut
  int x0, y0, vx, vy, acc, bounces, resting, rest;
  // the Buzzer's shot
  int qx, qy;
  // the GamiGami's shot
  int x4, dx;
  // the points
  int dy, holding;
  // the freed animal
  int moves, fall, animalVx, inAir, bouncing;
} Effect;

static Enemy en_list[ENEMY_MAX];
static int en_count;
static int en_regionsX, en_regionsY;   // the region grid the scan's edges clamp to
static int en_prevX, en_prevY, en_hasPrev;   // the camera the last strip scan saw
static Effect en_effects[EFFECT_MAX];
static uint8_t en_rl[ENEMY_RL_MAX];
static int en_hit, en_attack_hit;
static int en_chain, en_animal, en_was_air;
static int tilesKiki, tilesCoconut, tilesPiece, tilesBuzzer, tilesBuzzerShot, tilesGami, tilesGamiShot;
static int tilesRhino, tilesKero, tilesDust, tilesScore, tilesOtter, tilesKoala, tilesKangaroo;

// --- small helpers -----------------------------------------------------------------------------------------------
static int en_floor(double v) { return (int)__builtin_floor(v); }
static int en_player_x(void) { return en_floor(act.player.x); }
static int en_player_y(void) { return en_floor(act.player.y); }
static int en_fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
static int en_max2(int a, int b) { return a > b ? a : b; }
static int en_cos(int a) { return SINE[(a + 256) & 1023]; }
static int en_sin(int a) { return SINE[a & 1023]; }

// en_gone: the spawn point and the current place are both outside the camera's range
static int en_off_display(int wx, int wy, int camX, int camY) {
  return wx > camX + 368 || wx < camX - 128 || wy > camY + 288 || wy < camY - 128;
}
static int en_off_cam(int sx, int sy) {
  return (uint16_t)(sx + 128) > 496 || sy + 128 < 0 || sy > 288;
}
static int en_gone(const Enemy *e, int x, int y, int camX, int camY) {
  return en_off_display(e->spawnX, e->spawnY, camX, camY) && en_off_cam(x - camX, y - camY);
}

// --- the tiles an animation loads (the GetTiles command) ---------------------------------------------------------
// The heap takes whole segments of four tiles, so each sprite gets the most tiles any of its script's frames loads.
static uint32_t en_script(uint16_t anim, int variant) {
  uint32_t table = rom_ptr(sprites.anims + (uint32_t)anim * 4);
  if (!table) return 0;
  return rom_ptr(table + (uint32_t)variant * 4);
}

static int en_script_tiles(uint16_t anim, int variant) {
  uint32_t script = en_script(anim, variant);
  int most = 0, cursor = 0;
  if (!script) return 0;
  for (int step = 0; step < 4096; step++) {
    int32_t id = rom_s32(script + (uint32_t)cursor * 4);
    if (id >= 0) { cursor += 2; continue; }
    switch (id) {
      case -1: {   // GetTiles: index and count
        uint32_t count = rom_u32(script + (uint32_t)cursor * 4 + 8);
        if (count > 64) count = 64;
        if ((int)count > most) most = (int)count;
        cursor += 3;
        break;
      }
      case -2: case -6: case -8: cursor += 3; break;
      case -3: case -4: return most;      // a jump back or the end: every frame has been seen
      case -5: case -7: case -11: case -12: cursor += 2; break;
      case -9: {   // SetIdAndVariant: carry on in the animation it names
        anim = (uint16_t)rom_u16(script + (uint32_t)cursor * 4 + 4);
        variant = (int)rom_u16(script + (uint32_t)cursor * 4 + 6);
        script = en_script(anim, variant);
        if (!script) return most;
        cursor = 0;
        break;
      }
      case -10: cursor += 4; break;
      default: return most;
    }
  }
  return most;
}

/** The most tiles an animation script loads in a frame, for a sprite that is not an enemy (act.c's dust). */
int en_animation_tiles(uint16_t anim, int variant) { return en_script_tiles(anim, variant); }

static void en_load_tiles(void) {
  tilesKiki = en_max2(en_script_tiles(ANIM_KIKI, KIKI_VAR_BOB), en_script_tiles(ANIM_KIKI, KIKI_VAR_THROW));
  if (tilesKiki < 1) tilesKiki = 20;
  tilesCoconut = en_script_tiles(ANIM_COCONUT, 0);
  if (tilesCoconut < 1) tilesCoconut = 4;
  tilesPiece = en_script_tiles(ANIM_COCONUT_PIECE, 0);
  if (tilesPiece < 1) tilesPiece = 16;
  tilesBuzzer = en_max2(en_max2(en_script_tiles(ANIM_BUZZER, BUZZER_VAR_FLY), en_script_tiles(ANIM_BUZZER, BUZZER_VAR_SHOOT)),
    en_script_tiles(ANIM_BUZZER, BUZZER_VAR_TURN));
  if (tilesBuzzer < 1) tilesBuzzer = 20;
  tilesBuzzerShot = en_script_tiles(ANIM_BUZZER_SHOT, 0);
  if (tilesBuzzerShot < 1) tilesBuzzerShot = 4;
  tilesGami = en_max2(en_script_tiles(ANIM_GAMIGAMI, GAMI_VAR_WALK), en_script_tiles(ANIM_GAMIGAMI, GAMI_VAR_CLAWS));
  if (tilesGami < 1) tilesGami = 30;
  tilesGamiShot = en_script_tiles(ANIM_GAMIGAMI_SHOT, 0);
  if (tilesGamiShot < 1) tilesGamiShot = 4;
  tilesRhino = en_max2(en_max2(en_script_tiles(ANIM_RHINOTANK, RHINO_VAR_DRIVE), en_script_tiles(ANIM_RHINOTANK, RHINO_VAR_REV)),
    en_script_tiles(ANIM_RHINOTANK, RHINO_VAR_TURN));
  if (tilesRhino < 1) tilesRhino = 20;
  tilesKero = en_max2(en_script_tiles(ANIM_KEROKERO, KERO_VAR_JUMP), en_script_tiles(ANIM_KEROKERO, KERO_VAR_CROAK));
  if (tilesKero < 1) tilesKero = 20;
  tilesDust = en_script_tiles(ANIM_DUST, 0);
  if (tilesDust < 1) tilesDust = 8;
  tilesScore = en_max2(en_max2(en_max2(en_script_tiles(ANIM_SCORE, 0), en_script_tiles(ANIM_SCORE, 1)),
    en_max2(en_script_tiles(ANIM_SCORE, 2), en_script_tiles(ANIM_SCORE, 3))), en_script_tiles(ANIM_SCORE, 4));
  if (tilesScore < 1) tilesScore = 2;
  tilesOtter = en_script_tiles(ANIM_OTTER, 0);
  if (tilesOtter < 1) tilesOtter = 4;
  tilesKoala = en_script_tiles(ANIM_KOALA, 0);
  if (tilesKoala < 1) tilesKoala = 4;
  tilesKangaroo = en_script_tiles(ANIM_KANGAROO, 0);
  if (tilesKangaroo < 1) tilesKangaroo = 4;
}

// --- the enemy grid (rom/entities.js) ----------------------------------------------------------------------------
static int en_rl_size;

/** The GBA BIOS's RLUnComp: 0x30, then the size, runs and literal blocks. */
static int en_rl_decompress(uint32_t at) {
  uint32_t header = rom_u32(at);
  if ((header & 0xFF) != 0x30) return 0;
  uint32_t size = header >> 8, n = 0;
  if (size > sizeof en_rl) size = sizeof en_rl;
  at += 4;
  while (n < size) {
    uint32_t flag = rom_u8(at++);
    if (flag & 0x80) { uint32_t b = rom_u8(at++); for (uint32_t k = (flag & 0x7F) + 3; k > 0 && n < size; k--) en_rl[n++] = (uint8_t)b; }
    else for (uint32_t k = (flag & 0x7F) + 1; k > 0 && n < size; k--) en_rl[n++] = (uint8_t)rom_u8(at++);
  }
  return (int)size;
}

static uint32_t en_u32at(int at) {
  return (uint32_t)en_rl[at] | (uint32_t)en_rl[at + 1] << 8 | (uint32_t)en_rl[at + 2] << 16 | (uint32_t)en_rl[at + 3] << 24;
}

// --- the tiles around a point (engine/terrain.js columnHeight and tileFloor) --------------------------------------
static uint16_t en_tile_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = en_fdiv(tx, 12), my = en_fdiv(ty, 12), lx = tx - mx * 12, ly = ty - my * 12;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + (uint32_t)my * c->levelX + (uint32_t)mx);
  return (uint16_t)rom_u16(c->metatiles + (id * 144u + (uint32_t)ly * 12u + (uint32_t)lx) * 2u);
}
static int en_signed4(int v) { return v & 8 ? v - 16 : v; }
static int en_flip_height(int v) { return v == 0 || v == 8 ? v : v > 0 ? v - 8 : v + 8; }
static int en_platform_tile(int tile) {
  return (rom_u16(act.stage.collision.flags + (uint32_t)(tile >> 3) * 2u) >> ((tile & 7) * 2)) & 1;
}
static int en_column_height(int px, int py, int layer) {
  const Collision *c = &act.stage.collision;
  if (c->width < 1 || c->height < 1) return 0;
  if (px < 0) px = 0;
  if (py < 0) py = 0;
  if (px >= c->width) px = c->width - 1;
  if (py >= c->height) py = c->height - 1;
  uint16_t entry = en_tile_entry(layer, px >> 3, py >> 3), tile = entry & 0x3FF;
  int col = px & 7;
  if (entry & 0x400) col = 7 - col;
  int v = en_signed4(rom_u8(c->heights + (uint32_t)tile * 8u + (uint32_t)col) >> 4);
  if (v == -8) v = 8;
  if ((layer & 0x80) && en_platform_tile(tile)) v = 0;
  return entry & 0x800 ? en_flip_height(v) : v;
}
/** tileFloor: the distance to the floor within the tile holding y, negative inside it. */
static int en_tile_floor(int x, int y, int layer) {
  int v = en_column_height(x, y, layer), r = y & 7;
  if (v == 0) return 8 - r;
  if (v == 8) return -1 - r;
  return v > 0 ? v - 1 - r : v + r;
}

// --- the sprites -------------------------------------------------------------------------------------------------
static void en_make_sprite(Sprite *s, int anim, int variant, int order, int tiles, int flipX, int prime) {
  sprite_init(s);
  if (tiles < 1) tiles = 1;
  s->graphics.dest = vram_malloc((uint32_t)tiles);
  s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant;
  s->animSpeed = 0x10;
  s->palId = 0;
  s->oamFlags = (uint16_t)(order << 6);
  s->frameFlags = (uint16_t)((2 << 12) | (flipX ? SPRITE_X_FLIP : 0));
  if (prime) update_sprite(s, 0);   // sprite(): the first frame's hitboxes are set at once
}

// startAnim: switching to another animation always starts it again; the same one carries on unless `restart`
static void en_start(Enemy *e, int anim, int variant, int restart) {
  if (!restart && e->s.graphics.anim == anim && e->s.variant == variant) return;
  e->s.graphics.anim = (uint16_t)anim;
  e->s.variant = (uint8_t)variant;
  e->s.prevAnim = 0xFFFF;
  e->s.prevVariant = 0xFF;
}

// --- collision (engine/collide.js overlap, engine/defeat.js attackTest and projectileTest) -------------------------
static int en_box_on(const Hitbox *hb) {
  return hb->index >= 0 && (hb->left || hb->top || hb->right || hb->bottom);
}
static int en_box_touch(int x, int y, const Hitbox *hb, int l, int t, int r, int b) {
  int l0 = x + hb->left, r0 = x + hb->right, t0 = y + hb->top, b0 = y + hb->bottom;
  return ((l0 <= l && r0 >= l) || (l0 >= l && r >= l0)) && ((t0 <= t && b0 >= t) || (t0 >= t && b >= t0));
}

static int en_player_attacking(void) {
  return act.player.curled || act.player.state == ENEMY_PS_SPIN || act.player.state == ENEMY_PS_BOUNCE;
}

// the player's boxes: his body is ±6 wide and ±offsetY tall; his attack box is slot 1, which act.c doesn't keep,
// so it is taken as this same box while he is curled or in an attack state
static void en_player_box(int *l, int *t, int *r, int *b) {
  int px = en_player_x(), py = en_player_y(), oy = act.player.offsetY;
  *l = px - 6; *r = px + 6; *t = py - oy; *b = py + oy;
}

static void en_effect_free(Effect *f);
void en_add_dust(int x, int y, int delay);
static void en_add_animal(int x, int y);
static void en_add_score(int x, int y, int chain);

// Coll_Player_Enemy_Attack: the attack box destroys the enemy; the body hurts Sonic, or destroys it while he is
// invincible. Returns 1 when the enemy was defeated.
static int en_attack_test(Enemy *e, int x, int y) {
  Hitbox *hb = &e->s.hitboxes[0];
  if (!en_box_on(hb) || act.player.dead) return 0;
  int l, t, r, b;
  if (en_player_attacking()) {
    // Coll_Player_Enemy_Attack reads the sprite's attack box (slot 1), not the body
    if (!act_player_attack_box(&l, &t, &r, &b)) return 0;
    // the sprite's boxes are relative to his centre; the collision test wants them in the act
    int px = en_player_x(), py = en_player_y();
    l += px; t += py; r += px; b += py;
    if (!en_box_touch(x, y, hb, l, t, r, b)) return 0;
    en_attack_hit = 1;
  } else {
    en_player_box(&l, &t, &r, &b);
    if (!en_box_touch(x, y, hb, l, t, r, b)) return 0;
    // an item box's invincibility destroys the enemy; blinking from the last hit leaves it alone; otherwise his
    // body is hurt, by the same Coll_DamagePlayer the objects use
    if (!objects_player_invincible()) {
      if (act.player.invulnerable <= 0) en_hit = 1;
      return 0;
    }
  }
  e->live = 0;
  e->gone = 1;
  vram_free(e->s.graphics.dest);
  en_add_dust(x, y, 1);
  en_add_animal(x, y);
  play_song(138);
  int before = act.score;
  int chain = en_chain < 5 ? en_chain : 4;
  static const int SCORES[5] = { 100, 200, 400, 800, 1000 };
  act.score += SCORES[chain];
  if (act.score / 50000 != before / 50000) {
    act.lives = act.lives < 255 ? act.lives + 1 : 255;
    play_song(307);   // the 1-up jingle
  }
  en_add_score(x, y, chain);
  if (en_chain < 4) en_chain++;
  return 1;
}

// Coll_Player_Projectile: a shot on Sonic's body hurts him; returns 1 on any touch, hurt or not
static int en_projectile_test(Effect *f, int x, int y) {
  Hitbox *hb = &f->s.hitboxes[0];
  if (!en_box_on(hb) || act.player.dead) return 0;
  int l, t, r, b;
  en_player_box(&l, &t, &r, &b);
  if (!en_box_touch(x, y, hb, l, t, r, b)) return 0;
  if (act.player.invulnerable <= 0 && !objects_player_invincible()) en_hit = 1;
  return 1;
}

// --- effects -----------------------------------------------------------------------------------------------------
static Effect *en_effect_new(int kind) {
  for (int i = 0; i < EFFECT_MAX; i++) {
    if (en_effects[i].active) continue;
    Effect *f = &en_effects[i];
    memset(f, 0, sizeof *f);
    f->active = 1;
    f->kind = kind;
    f->animStep = 1;
    f->born = (kind == EFFECT_ANIMAL || kind == EFFECT_SCORE) ? act.tick : -1;
    return f;
  }
  return NULL;
}

static void en_effect_free(Effect *f) {
  vram_free(f->s.graphics.dest);
  f->active = 0;
}

// a coconut: toward where Sonic is, up to 1.5 px a frame, a bounce, a 96-frame rest, then its pieces
static void en_add_coconut(int x, int y) {
  Effect *f = en_effect_new(EFFECT_COCONUT);
  if (!f) return;
  int px = en_player_x();
  int vx = px < x ? -bios_div((x - px) * 400, 800) : bios_div((px - x) * 400, 800);
  if (vx < -60) vx = -60;
  if (vx > 60) vx = 60;
  f->x = f->x0 = x;
  f->y = f->y0 = y;
  f->vx = vx;
  f->vy = -512;
  f->acc = 0;
  f->bounces = 0;
  f->resting = 0;
  f->rest = 0;
  en_make_sprite(&f->s, ANIM_COCONUT, 0, 18, tilesCoconut, 0, 1);
}

// what is left of a coconut: it hurts Sonic for the 15 frames it shows
static void en_add_piece(int x, int y) {
  Effect *f = en_effect_new(EFFECT_COCONUT_PIECE);
  if (!f) return;
  f->x = x;
  f->y = y;
  en_make_sprite(&f->s, ANIM_COCONUT_PIECE, 0, 18, tilesPiece, 0, 1);
}

// sub_8004418: an angle (1024 a turn) from a distance, linear within each eighth of a turn
static int en_octant_angle(int a, int b) {
  static const int ARR[8] = { 1, 0, 2, 3, 6, 7, 5, 4 };
  int index = 0;
  if (a <= 0) { a = -a; index = 4; }
  if (b <= 0) { b = -b; index += 2; }
  int frac;
  if (a >= b) frac = bios_div(b * 128, a);
  else { index++; frac = bios_div(a * 128, b); }
  if (ARR[index] & 1) frac = 128 - frac;
  return (frac + ARR[index] * 128) & 1023;
}

// the Buzzer's shot: straight at where Sonic was, about 1.68 px a frame, on through him
static void en_add_buzzer_shot(int x, int y) {
  Effect *f = en_effect_new(EFFECT_BUZZER_SHOT);
  if (!f) return;
  int a = en_octant_angle(en_player_y() - y, en_player_x() - x);
  f->vx = bios_div(en_cos(a), 38);
  f->vy = bios_div(en_sin(a), 38);
  f->qx = x * 256;
  f->qy = y * 256;
  f->x = x;
  f->y = y;
  en_make_sprite(&f->s, ANIM_BUZZER_SHOT, 0, 18, tilesBuzzerShot, 0, 1);
}

// the GamiGami's shot: 1.5 px a frame sideways, thrown up and falling through everything
static void en_add_gami_shot(int x4, int dx, int y) {
  Effect *f = en_effect_new(EFFECT_GAMI_SHOT);
  if (!f) return;
  f->x4 = x4;
  f->dx = dx;
  f->x = x4 >> 2;
  f->y = y;
  f->vy = -512;
  en_make_sprite(&f->s, ANIM_GAMIGAMI_SHOT, 0, 9, tilesGamiShot, 0, 1);
}

// CreateDustCloud: it runs its animation once and stays where it appeared
void en_add_dust(int x, int y, int delay) {
  Effect *f = en_effect_new(EFFECT_DUST);
  if (!f) return;
  f->x = x;
  f->y = y;
  en_make_sprite(&f->s, ANIM_DUST, 0, 15, tilesDust, 0, 0);
  if (delay) f->born = act.tick;   // an enemy's defeat dust starts on the next frame
}

// the freed animal, in its zone's turn: the otter and koala sit once they land, the kangaroo hops away left
static void en_add_animal(int x, int y) {
  Effect *f = en_effect_new(EFFECT_ANIMAL);
  if (!f) return;
  int index = en_animal;
  en_animal = (en_animal + 1) % 3;
  int anim = index == 0 ? ANIM_OTTER : index == 1 ? ANIM_KOALA : ANIM_KANGAROO;
  int tiles = index == 0 ? tilesOtter : index == 1 ? tilesKoala : tilesKangaroo;
  f->moves = index == 2 ? ANIMAL_HOPS : ANIMAL_SITS;
  f->x = x * 256;
  f->y = y * 256;
  f->fall = -1024;   // ANIMAL_HOP: 4 px a frame up
  f->animalVx = f->moves == ANIMAL_HOPS ? 1 : 0;
  f->inAir = 42;
  f->bouncing = 0;
  en_make_sprite(&f->s, anim, 0, 17, tiles, 0, 0);
}

// the points: they rise 1 px a frame for 60 frames, stay 30 more, and go
static void en_add_score(int x, int y, int chain) {
  Effect *f = en_effect_new(EFFECT_SCORE);
  if (!f) return;
  f->x = f->x0 = x;
  f->y = f->y0 = y;
  f->dy = 0;
  f->holding = 0;
  en_make_sprite(&f->s, ANIM_SCORE, chain, 0, tilesScore, 0, 1);
}

static void en_update_coconut(Effect *f) {
  if (!f->resting) {
    f->vy = s16(f->vy + 40);
    f->acc = s16(f->acc + f->vx);
    f->x = f->x0 + bios_div(f->acc, 40);
    f->y = s16(f->y + (f->vy >> 8));
    if (f->vy > 0) {
      int d = en_tile_floor(f->x, f->y, 1);
      if (d < 0) {
        f->y += d;
        if (!f->bounces) { f->vy = -(f->vy >> 2); f->bounces++; }
        else { f->resting = 1; f->rest = 0; f->vy = 0; }
      }
    }
  } else if (f->rest++ >= 0x60) {
    en_add_piece(f->x, f->y);
    en_effect_free(f);
    return;
  }
  if (en_projectile_test(f, f->x, f->y)) {
    en_add_piece(f->x, f->y);
    en_effect_free(f);
  }
}

static void en_update_effect(Effect *f, int camX, int camY) {
  switch (f->kind) {
    case EFFECT_COCONUT:
      en_update_coconut(f);
      break;
    case EFFECT_COCONUT_PIECE:
      en_projectile_test(f, f->x, f->y);
      break;
    case EFFECT_BUZZER_SHOT: {
      f->qx += f->vx;
      f->qy += f->vy;
      f->x = f->qx >> 8;
      f->y = f->qy >> 8;
      en_projectile_test(f, f->x, f->y);
      int sx = f->x - camX, sy = f->y - camY;
      if ((uint16_t)(sx + 40) > 320 || sy + 40 < 0 || sy > 200) en_effect_free(f);
      break;
    }
    case EFFECT_GAMI_SHOT: {
      f->x4 += f->dx;
      f->x = f->x4 >> 2;
      f->vy += 40;
      f->y += f->vy >> 8;
      en_projectile_test(f, f->x, f->y);
      int sx = f->x - camX, sy = f->y - camY;
      if ((uint16_t)(sx + 20) > 276 || sy + 20 < 0 || sy > 240) en_effect_free(f);
      break;
    }
    case EFFECT_ANIMAL: {
      f->fall += 48;
      f->y += f->fall;
      f->x += f->animalVx;
      if (f->inAir > 0) f->inAir--;
      else {
        int d = en_tile_floor(f->x >> 8, f->y >> 8, 1);
        if (d <= 0) {
          f->y += d * 256;
          if (f->moves == ANIMAL_HOPS) {
            f->fall = -1024;
            if (!f->bouncing) f->animalVx = -512;   // 2 px a frame away left
            f->bouncing = 1;
          } else f->fall = 0;
        }
      }
      int sx = (f->x >> 8) - camX, sy = (f->y >> 8) - camY;
      if (sx < -32 || sx > 272 || sy + 32 < 0 || sy > 192) en_effect_free(f);
      break;
    }
    case EFFECT_SCORE:
      if (!f->holding) {
        f->dy++;
        f->y = f->y0 - f->dy;
        if (f->dy >= 60) { f->holding = 1; f->dy = 0; f->y = f->y0 - 60; }
      } else {
        f->dy++;
        if (f->dy > 30) en_effect_free(f);
        else f->y = f->y0 - 60;
      }
      break;
    default:
      break;   // the dust only runs its animation
  }
}

// --- the enemies -------------------------------------------------------------------------------------------------
static void en_leave(Enemy *e) {
  e->live = 0;
  vram_free(e->s.graphics.dest);
}

static void en_spawn(Enemy *e) {
  e->live = 1;
  e->gone = 0;
  e->x = e->spawnX;
  e->y = e->spawnY;
  e->flipX = 0;
  e->animStep = 1;
  switch (e->kind) {
    case KIND_KIKI:
      e->vel = 1; e->yoff = 0; e->tops = 0; e->t = 0; e->throwing = 0;
      en_make_sprite(&e->s, ANIM_KIKI, KIKI_VAR_BOB, 18, tilesKiki, 0, 1);
      break;
    case KIND_BUZZER:
      e->off = 0; e->shot = 0; e->t = 0; e->state = Z_BUZZER_PATROL;
      e->turnNext = e->turnRight = e->shootNext = 0;
      if (en_player_x() >= e->spawnX) { e->vel = 256; e->flipX = 1; }
      else e->vel = -256;
      en_make_sprite(&e->s, ANIM_BUZZER, BUZZER_VAR_FLY, 18, tilesBuzzer, e->flipX, 1);
      break;
    case KIND_GAMIGAMI:
      e->vel = -160; e->off = 0; e->yoff = 0; e->t = 0; e->right = 0; e->tackle = 0;
      if (en_player_x() >= e->spawnX) { e->vel = 160; e->right = 1; }
      en_make_sprite(&e->s, ANIM_GAMIGAMI, GAMI_VAR_WALK, 18, tilesGami, 0, 1);
      break;
    case KIND_RHINOTANK:
      e->vel = -160; e->off = 0; e->yoff = 0; e->t = 0; e->tackle = 0; e->state = Z_RHINO_PATROL;
      en_make_sprite(&e->s, ANIM_RHINOTANK, RHINO_VAR_DRIVE, 18, tilesRhino, 0, 1);
      break;
    case KIND_KEROKERO:
      e->off = 0; e->yoff = 0; e->vy = 0; e->cd = 0; e->croakIndex = 0; e->n = 0; e->state = Z_KERO_IDLE;
      en_make_sprite(&e->s, ANIM_KEROKERO, KERO_VAR_JUMP, 18, tilesKero, 0, 1);
      break;
    default:
      e->live = 0;
      break;
  }
}

// Kiki (kiki.c): climbs its tree 1 px a frame and throws a coconut on every second visit to the top
static void en_run_kiki(Enemy *e, int camX, int camY) {
  int wasThrowing = e->throwing;
  if (!e->throwing) {
    e->yoff = s8(e->yoff + e->vel);
    int top = e->d1 * 8;
    if (e->yoff <= top) {
      e->tops = (e->tops + 1) & 0xFF;
      e->vel = 1;
      if (!(e->tops & 1)) { e->t = 0; en_start(e, ANIM_KIKI, KIKI_VAR_THROW, 0); e->throwing = 1; }
    } else if (e->yoff >= top + e->d3 * 8) e->vel = -1;
  }
  e->x = e->spawnX;
  e->y = e->spawnY + e->yoff;
  if (en_attack_test(e, e->x, e->y)) return;
  if (en_gone(e, e->x, e->y, camX, camY)) { en_leave(e); return; }
  e->flipX = !(en_player_x() < e->x);
  // the throw counts from the frame after the top, and ends on its 15th, before its animation does
  if (wasThrowing && ++e->t > 14) {
    e->throwing = 0;
    en_start(e, ANIM_KIKI, KIKI_VAR_BOB, 0);
    en_add_coconut(e->flipX ? e->x - 18 : e->x + 8, e->y - 8);
  }
  e->animStep = 1;
}

// Buzzer (buzzer.c): flies back and forth 1 px a frame, stopping once a leg to shoot at the wedge below it
static void en_run_buzzer(Enemy *e, int camX, int camY) {
  // its bounds and its shot are decided after it is drawn (buzzer.c), so the change shows on the next frame
  if (e->turnNext) {
    e->turnNext = 0; e->vel = e->turnRight ? 256 : -256;
    en_start(e, ANIM_BUZZER, BUZZER_VAR_TURN, 1); e->state = Z_BUZZER_TURN; e->flipX = e->turnRight;
  }
  if (e->shootNext) { e->shootNext = 0; en_start(e, ANIM_BUZZER, BUZZER_VAR_SHOOT, 1); e->t = 0; e->state = Z_BUZZER_SHOOT; }
  if (e->state == Z_BUZZER_PATROL) e->off += e->vel;
  e->x = e->spawnX + (e->off >> 8);
  e->y = e->spawnY;
  if (e->state == Z_BUZZER_SHOOT && ++e->t == 10) en_add_buzzer_shot(e->x, e->y + 6);
  if (en_off_display(e->x, e->y, camX, camY) && en_off_cam(e->x - camX, e->y - camY)) { en_leave(e); return; }
  if (en_attack_test(e, e->x, e->y)) return;
  if (e->state == Z_BUZZER_PATROL) {
    if ((e->off >> 8) <= e->d0 * 8) {
      e->turnNext = 1; e->turnRight = 1;
    } else if ((e->off >> 8) >= (e->d0 + e->d2) * 8) {
      e->turnNext = 1; e->turnRight = 0;
    } else if (!e->shot) {
      int px = en_player_x(), py = en_player_y();
      if (e->y <= py && e->y + 96 >= py) {
        int dy = py - e->y, dx = e->x - px;
        int hi = s16(bios_div(dx * 17, 10)), lo = s16(bios_div(dx * 10, 17));
        // `frameFlags &= X_FLIP` where `&` was meant: the original also clears the sprite's priority
        e->s.frameFlags &= ~SPRITE_PRIORITY;
        if (e->flipX) { hi = -hi; lo = -lo; }
        if (hi >= dy && lo <= dy) e->shootNext = 1;
      }
    }
    e->animStep = 1;
  } else if (e->state == Z_BUZZER_SHOOT) {
    if (e->t >= 30) { en_start(e, ANIM_BUZZER, BUZZER_VAR_FLY, 1); e->state = Z_BUZZER_PATROL; e->shot = 1; }
    e->animStep = 1;
  } else {
    e->shot = 0;   // the turn's end is seen in the animation, in enemies_draw
    e->animStep = 1;
  }
}

// GamiGami (gamigami.c): walks 0.625 px a frame and, at each end, raises its claws for 19 frames, firing two
// shots on the 15th. It follows the ground, and its sprite never turns round.
static void en_run_gamigami(Enemy *e, int camX, int camY) {
  if (!e->tackle) e->off += e->vel;   // `tackle` here is the JavaScript's `turning`
  int x = e->spawnX + bios_div(e->off, 256);
  int y = e->spawnY - 6 + e->yoff;
  e->x = x;
  e->y = y;
  if (e->tackle && ++e->t == 15) {
    // the right one first; both run after Sonic, from this frame
    en_add_gami_shot((x + 14) * 4, 6, y - 20);
    en_add_gami_shot((x - 14) * 4, -6, y - 20);
  }
  if (en_gone(e, x, y, camX, camY)) { en_leave(e); return; }
  if (en_attack_test(e, x, y)) return;
  e->yoff += en_tile_floor(x, y, e->d3 ? 1 : 0);
  if (!e->tackle) {
    if (bios_div(e->off, 256) <= e->d0 * 8) {
      if (!e->right) { e->vel = 160; e->t = 0; e->right = 1; en_start(e, ANIM_GAMIGAMI, GAMI_VAR_CLAWS, 0); e->tackle = 1; }
    } else if (bios_div(e->off, 256) >= (e->d0 + e->d2) * 8) {
      if (e->right) { e->vel = -160; e->t = 0; e->right = 0; en_start(e, ANIM_GAMIGAMI, GAMI_VAR_CLAWS, 0); e->tackle = 1; }
    }
  } else if (e->t > 18) { en_start(e, ANIM_GAMIGAMI, GAMI_VAR_WALK, 0); e->tackle = 0; }
  e->animStep = 1;
}

// Rhinotank (rhinotank.c): drives 0.625 px a frame, slides round at each end, and charges at 3 px a frame when
// Sonic is within 80 px in front of it
static void en_run_rhinotank(Enemy *e, int camX, int camY) {
  if (e->state == Z_RHINO_PATROL) e->off += e->vel;
  int x = e->spawnX + (e->state == Z_RHINO_PATROL ? bios_div(e->off, 256) : (e->off >> 8));
  int y = e->spawnY + e->yoff;
  e->x = x;
  e->y = y;
  if (en_gone(e, x, y, camX, camY)) { en_leave(e); return; }
  if (en_attack_test(e, x, y)) return;
  e->yoff += en_tile_floor(x, y, 1);
  if (e->state == Z_RHINO_PATROL) {
    int px = en_player_x(), py = en_player_y();
    // at either end it turns if it faces that way; facing away it doesn't look for Sonic that frame
    if ((e->off >> 8) <= (e->d0 + 1) * 8) {
      if (!e->flipX) {
        if (e->tackle) e->off += 768;
        e->t = 0; e->vel = 160; en_start(e, ANIM_RHINOTANK, RHINO_VAR_TURN, 0); e->state = Z_RHINO_TURN;
      }
    } else if ((e->off >> 8) >= (e->d0 + e->d2 - 1) * 8) {
      if (e->flipX) {
        if (e->tackle) e->off -= 768;
        e->t = 0; e->vel = -160; en_start(e, ANIM_RHINOTANK, RHINO_VAR_TURN, 0); e->state = Z_RHINO_TURN;
      }
    } else if (!e->tackle && y - 32 <= py && y + 8 >= py
      && (e->flipX ? (x <= px && x + 80 >= px) : (x - 80 <= px && x >= px))) {
      e->tackle = 1; e->t = 0; e->vel = e->flipX ? 768 : -768;
      en_start(e, ANIM_RHINOTANK, RHINO_VAR_REV, 0); e->state = Z_RHINO_REV;
    }
  } else if (e->state == Z_RHINO_TURN) {
    // it slides on the old way, slowing down and coming back a little at the end
    int k = bios_div(en_cos(e->t * 21), e->tackle ? 32 : 64);
    e->off += e->flipX ? k : -k;
    if (++e->t == 24) {
      en_start(e, ANIM_RHINOTANK, RHINO_VAR_DRIVE, 0);
      e->off += e->vel;
      e->vel = e->flipX ? -160 : 160;
      e->flipX = !e->flipX;
      e->tackle = 0;
      e->state = Z_RHINO_PATROL;
    }
  } else if (++e->t == 25) {
    en_start(e, ANIM_RHINOTANK, RHINO_VAR_DRIVE, 0);
    e->state = Z_RHINO_PATROL;
  }
  e->animStep = 1;
}

// KeroKero (kerokero.c): jumps 1 px a frame toward Sonic when he is within 80 px on the side it faces, at any
// height, and croaks now and then. Sitting, its animation doesn't run, so it shows one frame.
static const int CROAK_STEPS[8] = { 54, 43, 34, 32, 12, 100, 25, 32 };

static void en_run_kerokero(Enemy *e, int camX, int camY) {
  int px = en_player_x();
  if (e->state == Z_KERO_JUMP) {
    e->vy += 64;
    e->yoff += bios_div(e->vy, 256);
    e->off += e->flipX ? 256 : -256;
  }
  int x = e->spawnX + (e->off >> 8);
  int y = e->spawnY + e->yoff;
  e->x = x;
  e->y = y;
  if (en_gone(e, x, y, camX, camY)) { en_leave(e); return; }
  if (e->state == Z_KERO_IDLE) e->n = s16(e->n + 1);
  if (en_attack_test(e, x, y)) return;
  int d = en_tile_floor(x, y, e->d3 ? 1 : 0);
  if (e->state == Z_KERO_IDLE) {
    e->yoff += d;
    e->flipX = px > e->spawnX + (e->off >> 8);
    if (e->n > 250) { e->cd = 0; e->n -= 250; en_start(e, ANIM_KEROKERO, KERO_VAR_CROAK, 0); e->state = Z_KERO_CROAK; }
    else if (e->cd != 0) e->cd--;
    else if ((e->flipX && (e->off >> 8) <= (e->d0 + e->d2 - 8) * 8 && x <= px && x + 80 >= px)
      || (!e->flipX && (e->off >> 8) >= (e->d0 + 8) * 8 && x - 80 <= px && x >= px)) {
      e->vy = -1280;
      en_start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 0);
      e->n = s16(e->n + CROAK_STEPS[e->croakIndex]);
      e->croakIndex = (e->croakIndex + 1) & 7;
      e->state = Z_KERO_JUMP;
    }
    e->animStep = 0;   // idle: no UpdateSpriteAnimation, as the JavaScript's idle branch
    return;
  }
  if (e->state == Z_KERO_JUMP) {
    if (d <= 0) {
      e->cd = 5;
      e->yoff += d;
      // the original shows a croak frame, then starts the jump again; only the jump's first frame is kept
      en_start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 1);
      e->state = Z_KERO_IDLE;
      e->flipX = px > e->spawnX + (e->off >> 8);
    }
  } else {
    e->yoff += d;
    if (++e->cd > 60) { e->cd = 0; en_start(e, ANIM_KEROKERO, KERO_VAR_JUMP, 0); e->state = Z_KERO_IDLE; }
  }
  e->animStep = 1;
}

static void en_run(Enemy *e, int camX, int camY) {
  switch (e->kind) {
    case KIND_KIKI: en_run_kiki(e, camX, camY); break;
    case KIND_BUZZER: en_run_buzzer(e, camX, camY); break;
    case KIND_GAMIGAMI: en_run_gamigami(e, camX, camY); break;
    case KIND_RHINOTANK: en_run_rhinotank(e, camX, camY); break;
    case KIND_KEROKERO: en_run_kerokero(e, camX, camY); break;
    default: en_leave(e); break;
  }
}

// --- the interface -----------------------------------------------------------------------------------------------
void enemies_init(int level) {
  enemies_reset();
  memset(en_list, 0, sizeof en_list);
  en_count = 0;
  en_load_tiles();
  en_rl_size = en_rl_decompress(rom_ptr(OFFSET_ENEMIES + (uint32_t)level * 4));
  if (!en_rl_size) return;
  int regionsX = (int)en_u32at(4), regionsY = (int)en_u32at(8);
  if (regionsX <= 0 || regionsY <= 0 || regionsX * regionsY > 4096) return;
  en_regionsX = regionsX; en_regionsY = regionsY;
  for (int r = 0; r < regionsX * regionsY; r++) {
    uint32_t offset = en_u32at(12 + r * 4);
    if (!offset || offset > (uint32_t)en_rl_size) continue;
    int rx = r % regionsX, ry = r / regionsX;
    for (int at = 4 + (int)offset; at + 6 < en_rl_size && en_rl[at] != 0xFF && en_count < ENEMY_MAX; at += 7) {
      int kind = en_rl[at + 2];
      if (kind > KIND_KEROKERO) continue;
      Enemy *e = &en_list[en_count++];
      e->spawnX = en_rl[at] * 8 + rx * ENEMY_REGION;
      e->spawnY = en_rl[at + 1] * 8 + ry * ENEMY_REGION;
      e->kind = kind;
      e->d0 = (int8_t)en_rl[at + 3];
      e->d1 = (int8_t)en_rl[at + 4];
      e->d2 = en_rl[at + 5];
      e->d3 = en_rl[at + 6];
    }
  }
}

void enemies_reset(void) {
  en_prevX = en_prevY = 0; en_hasPrev = 0;
  for (int i = 0; i < en_count; i++) {
    if (en_list[i].live) vram_free(en_list[i].s.graphics.dest);
    en_list[i].live = 0;
    en_list[i].gone = 0;
  }
  for (int i = 0; i < EFFECT_MAX; i++) {
    if (en_effects[i].active) vram_free(en_effects[i].s.graphics.dest);
    en_effects[i].active = 0;
  }
  en_chain = 0;
  en_animal = 0;
  en_was_air = 0;
  en_hit = 0;
  en_attack_hit = 0;
}

// the enemies in the rectangle, as SpawnMapEntities scans their region's enemies after its item boxes
static void en_scan(int x0, int x1, int y0, int y1) {
  for (int i = 0; i < en_count; i++) {
    Enemy *e = &en_list[i];
    if (!e->live && !e->gone && e->spawnX >= x0 && e->spawnX <= x1 && e->spawnY >= y0 && e->spawnY <= y1) en_spawn(e);
  }
}
// CamCoord's clamps: below 0 to 0, past the grid to its last pixel
static int en_clamp_x(int v) { return v < 0 ? 0 : v > en_regionsX * 256 - 1 ? en_regionsX * 256 - 1 : v; }
static int en_clamp_y(int v) { return v < 0 ? 0 : v > en_regionsY * 256 - 1 ? en_regionsY * 256 - 1 : v; }

void enemies_update(int camX, int camY) {
  en_hit = 0;
  en_attack_hit = 0;
  // p.chain clears on landing (player.js land), which the points count from
  if (en_was_air && !act.player.air) en_chain = 0;
  en_was_air = act.player.air;
  // spawn the ones whose spawn point the camera's range now holds, scanning the strips it uncovered as the
  // entities manager does (Task_8008DCC): everything on the first frame, then the strip uncovered sideways and down
  if (!en_hasPrev || (camX - en_prevX > 248 || en_prevX - camX > 248) || (camY - en_prevY > 208 || en_prevY - camY > 208)) {
    en_scan(en_clamp_x(camX - 128), en_clamp_x(camX + 368), en_clamp_y(camY - 128), en_clamp_y(camY + 288));
    en_prevX = camX; en_prevY = camY; en_hasPrev = 1;
  } else {
    int ax0 = camX > en_prevX ? en_prevX + 368 : camX - 128;
    int ax1 = camX > en_prevX ? camX + 368 : en_prevX - 128;
    int by0 = camY > en_prevY ? en_prevY + 288 : camY - 128;
    int by1 = camY > en_prevY ? camY + 288 : en_prevY - 128;
    if (camX != en_prevX && ax0 != ax1) en_scan(en_clamp_x(ax0), en_clamp_x(ax1), en_clamp_y(camY - 128), en_clamp_y(camY + 288));
    if (camY != en_prevY && by0 != by1) en_scan(en_clamp_x(camX - 128), en_clamp_x(camX + 368), en_clamp_y(by0), en_clamp_y(by1));
    en_prevX = camX; en_prevY = camY;
  }
  // then run every live one, then its shots and the effects
  for (int i = 0; i < en_count; i++) if (en_list[i].live) en_run(&en_list[i], camX, camY);
  for (int i = 0; i < EFFECT_MAX; i++) {
    if (!en_effects[i].active || en_effects[i].born == act.tick) continue;
    en_update_effect(&en_effects[i], camX, camY);
  }
}

static void en_draw_effect(Effect *f, int camX, int camY) {
  // the draw runs after the frame's tick moves on, so the tick it was made on is the one before this
  if (f->born == act.tick - 1) return;
  int wx = f->x, wy = f->y;
  if (f->kind == EFFECT_ANIMAL) { wx = f->x >> 8; wy = f->y >> 8; }
  f->s.frameFlags &= (uint16_t)~(SPRITE_X_FLIP | SPRITE_Y_FLIP);
  int more = update_sprite(&f->s, 0);
  if (f->kind == EFFECT_COCONUT_PIECE && !more) { en_effect_free(f); return; }
  if (f->s.graphics.dest != HEAP_END) {
    f->s.x = (int16_t)(wx - camX);
    f->s.y = (int16_t)(wy - camY);
    display_sprite(&f->s);
  }
  // the dust cloud shows its last frame and goes (defeat.js dustCloud)
  if (f->kind == EFFECT_DUST && !more) en_effect_free(f);
}

void enemies_draw(int camX, int camY) {
  for (int i = 0; i < en_count; i++) {
    Enemy *e = &en_list[i];
    if (!e->live) continue;
    int wx = e->x, wy = e->y;
    if (e->kind == KIND_KIKI && e->flipX) wx -= 8;   // facing right it is drawn 8 px left of its box
    e->s.frameFlags = (uint16_t)((e->s.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (e->flipX ? SPRITE_X_FLIP : 0));
    int more = 1;
    if (e->animStep) more = update_sprite(&e->s, 0);
    if (e->s.graphics.dest != HEAP_END) {
      e->s.x = (int16_t)(wx - camX);
      e->s.y = (int16_t)(wy - camY);
      display_sprite(&e->s);
    }
    // the Buzzer's turn ends when its animation does, after the last turn frame is drawn
    if (e->kind == KIND_BUZZER && e->state == Z_BUZZER_TURN && e->animStep && !more) {
      en_start(e, ANIM_BUZZER, BUZZER_VAR_FLY, 0);
      e->state = Z_BUZZER_PATROL;
      e->shot = 0;
    }
  }
  for (int i = 0; i < EFFECT_MAX; i++) if (en_effects[i].active) en_draw_effect(&en_effects[i], camX, camY);
}

int enemies_player_hit(void) { return en_hit; }
int enemies_player_attack_hit(void) { return en_attack_hit; }
