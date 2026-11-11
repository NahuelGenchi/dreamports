// What the enemies share: reading an entity's data bytes, the range an enemy goes out of, Sonic against an enemy or a shot, and
// what a defeat leaves behind. Declared for the enemy files (hanabii.c, slot.c, pierrot.c) and translated from the JavaScript
// version's engine/enemies.js (the helpers at its top) and engine/defeat.js (the original's collision_3.c, dust_cloud.c,
// enemy_defeat_score.c and trapped_animals.c).

#ifndef SA_ENEMIES_H
#define SA_ENEMIES_H

#include "objects.h"
#include "terrain.h"

enum {
  ENEMY_TILE = 8,            // the data bytes count in tiles
  ENEMY_ORDER = 18,          // the OAM order of an enemy's sprite
  ENEMY_PRIORITY = 2,        // behind the front layer's tiles
  ENEMY_LAYER = 1,           // the layer the enemies' floor probes read
  ENEMY_SHOT_PRIORITY = 0x3000,   // a shot's task runs after Sonic's
};

/** Q8.8 to pixels, rounding down. */
static inline int enemy_i(int v) { return v >> 8; }
/** Sonic's centre, in whole pixels. */
static inline int enemy_sonic_x(void) { return (int)__builtin_floor(act.player.x); }
static inline int enemy_sonic_y(void) { return (int)__builtin_floor(act.player.y); }

/** The entity's data bytes: d0 and d1 signed, d2 and d3 not. */
typedef struct { int d0, d1, d2, d3; } EnemyData;
EnemyData enemy_data(const Entity *e);

/** An enemy goes when both its spawn point and its place are out of range around the camera. */
int enemy_gone(int spawnX, int spawnY, int x, int y);
/** Whether the save's difficulty is easy while the act is in `zone`: some enemies are made only on Normal in one zone. */
int enemy_left_out_on_easy(int zone);

/** An enemy's sprite for the animation `anim` (variants first to last): it has run its script once, so its hitbox is set from
 *  the first frame. */
void enemy_sprite(Sprite *s, int anim, int first, int last, int order);
/** Turns the sprite to face left or right from the next animation step on. */
void enemy_flip_x(Sprite *s, int flip);

/** Sonic against the enemy's first hitbox, at (x, y) (Coll_Player_Enemy_Attack): his attack box defeats it, bouncing him up if
 *  he was falling; his body defeats it while he is invincible and otherwise hurts him. True when the enemy is defeated. */
int enemy_attack(const Sprite *s, int x, int y);
/** A shot on Sonic's body (Coll_Player_Projectile): hurts him. True on any touch, hurt or not. */
int enemy_projectile(const Sprite *s, int x, int y);
/** What a defeat leaves at (x, y): the dust, the next animal and the points. */
void enemy_defeat(int x, int y);
/** The act starts: the next animal is the first. */
void enemies_start(void);

// the kinds
ActTask *kiki_spawn(Slot *slot);            // 0
ActTask *buzzer_spawn(Slot *slot);          // 1
ActTask *gamigami_spawn(Slot *slot);        // 2
ActTask *rhinotank_spawn(Slot *slot);       // 3
ActTask *kerokero_spawn(Slot *slot);        // 4
ActTask *senbon_spawn(Slot *slot);          // 5
ActTask *hanabii_spawn(Slot *slot);         // 8
ActTask *slot_machine_spawn(Slot *slot);    // 9
ActTask *pierrot_spawn(Slot *slot);         // 10
ActTask *leon_spawn(Slot *slot);            // 11
ActTask *wamu_spawn(Slot *slot);            // 13
ActTask *tentou_spawn(Slot *slot);          // 6
ActTask *mole_spawn(Slot *slot);            // 15
ActTask *egg_hammer_tank_intro_spawn(Slot *slot);   // 21
ActTask *egg_hammer_tank_spawn(Slot *slot);         // 22
ActTask *egg_press_spawn(Slot *slot);       // 23
ActTask *fireball_spawn(Slot *slot);        // 7
ActTask *yukimaru_spawn(Slot *slot);        // 16
ActTask *yukimaru_wall_spawn(Slot *slot);   // 17
ActTask *kuraa_spawn(Slot *slot);           // 19
ActTask *egg_spider_spawn(Slot *slot);      // 25
ActTask *egg_ball_spawn(Slot *slot);        // 24
ActTask *pen_spawn(Slot *slot);             // 20
ActTask *drisame_spawn(Slot *slot);         // 18

#endif
