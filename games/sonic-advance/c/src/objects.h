// The act's objects: the list their tasks run in, the manager that spawns them as the camera comes near, and what every
// kind shares. Translated from the JavaScript version's engine/objects.js (the original's task.c and
// entities_manager.c). A kind of object is one C file, with a spawn function and one line in the tables in objects.c.

#ifndef SA_OBJECTS_H
#define SA_OBJECTS_H

#include "act.h"

// --- the act's task list (objects.js createTasks) ----------------------------------------------------------------
// The tasks run once a frame in order of priority, and those of one priority in the order they were made. The original
// fetches the next task before it runs the current one and puts a new task after the last of its priority, so a task made
// by the one just before its place in the list only runs from the next frame.
enum {
  PRIORITY_CAMERA = 0xF00,     // the camera's task (Task_UpdateCamera): a boss's screen shake runs just before it
  PRIORITY_OBJECTS = 0x2000,   // the rings, the entities manager and the objects it spawns
  PRIORITY_SCATTER = 0x2001,   // the rings Sonic dropped
  PRIORITY_HUD = 0x2180,       // the HUD's task, which act.c runs between the objects before and after it
  PRIORITY_SONIC = 0x3000,
  PRIORITY_ITEMS = 0x4001,     // a shield and the invincibility stars, after the music manager
};

typedef struct ActTask ActTask;
/** Runs the task for one frame; false when it ends. */
typedef int (*ActRun)(ActTask *);
typedef void (*ActEnd)(ActTask *);
struct ActTask {
  ActRun run;
  ActEnd end;        // called when the task ends, or NULL
  void *data;
  int priority, used;
  ActTask *next;
};

ActTask *act_task_add(ActRun run, ActEnd end, void *data, int priority);
/** Runs the tasks of priority `from` up to, not including, `to`. */
void act_tasks_run(int from, int to);

// --- the entities (rom/entities.js) ------------------------------------------------------------------------------
typedef struct { int x, y, kind, d[4]; } Entity;
enum { ENTITY_INTERACTABLE, ENTITY_ITEM_BOX, ENTITY_ENEMY };
/** An entity's place in its region, with the task it has made while it is near: `live` is NULL when it isn't. A defeated
 *  enemy or a broken item box is `gone` until the act starts over. */
typedef struct {
  Entity e;
  int list;
  ActTask *live;
  int gone;
} Slot;

/** A level's entity list, decompressed from the copy (rom/entities.js readGrid): the grid of 256 x 256 px regions, with
 *  each region's offset into its records, 0 when it has none. The next load overwrites the last. */
typedef struct { const uint8_t *data; int regionsX, regionsY; } Grid;
enum { REGION_SIZE = 256, MAX_REGIONS = 1024 };
/** Where the pointer tables of the lists are, in the copy. */
enum { TABLE_RINGS = 0x0B7F4C, TABLE_INTERACTABLES = 0x0B7F94, TABLE_ITEM_BOXES = 0x0B7FDC, TABLE_ENEMIES = 0x0B8024 };
int grid_load(uint32_t table, int level, Grid *grid);
/** Where region `r`'s records start in `grid.data`, or -1 for none. */
int grid_records(const Grid *grid, int r);

/** A kind's spawn function: makes its task, or NULL for none. */
typedef ActTask *(*Spawn)(Slot *slot);

// the kinds built (the interactable kinds' numbers are in their own files)
ActTask *spring_spawn(Slot *slot);
ActTask *spikes_spawn(Slot *slot);
ActTask *hiding_spikes_spawn(Slot *slot);
ActTask *platform_spawn(Slot *slot);
ActTask *item_box_spawn(Slot *slot);
ActTask *bumper_spawn(Slot *slot);
ActTask *flipper_spawn(Slot *slot);
ActTask *flipper_blue_spawn(Slot *slot);
// the marble tracks, tubes and teleport orbs hand Sonic along by the step in his `track` (player.h)
ActTask *marble_track_spawn(Slot *slot);
ActTask *tube_track_spawn(Slot *slot);
ActTask *tube_junction_spawn(Slot *slot);
ActTask *teleport_orb_spawn(Slot *slot);
ActTask *goal_spawn(Slot *slot);
ActTask *checkpoint_spawn(Slot *slot);
ActTask *red_flag_spawn(Slot *slot);
ActTask *wall_pole_spawn(Slot *slot);
ActTask *sega_letter_spawn(Slot *slot);
ActTask *balloon_spawn(Slot *slot);
ActTask *panel_gate_spawn(Slot *slot);
ActTask *conveyor_spawn(Slot *slot);
ActTask *booster_spawn(Slot *slot);
ActTask *swing_rope_spawn(Slot *slot);
ActTask *security_gate_spawn(Slot *slot);
ActTask *swinging_hook_spawn(Slot *slot);
ActTask *hook_rail_spawn(Slot *slot);
ActTask *curler_spawn(Slot *slot);
ActTask *lava_spawn(Slot *slot);
ActTask *crane_claw_spawn(Slot *slot);
ActTask *pipe_entrance_spawn(Slot *slot);
ActTask *pipe_exit_spawn(Slot *slot);
ActTask *visibility_spawn(Slot *slot);
ActTask *special_spring_spawn(Slot *slot);
ActTask *ice_block_spawn(Slot *slot);         // 95
ActTask *skating_stone_spawn(Slot *slot);     // 84
ActTask *ferris_wheel_spawn(Slot *slot);      // 91
ActTask *forced_slide_spawn(Slot *slot);      // 46
ActTask *crumbling_platform_spawn(Slot *slot);   // 24
ActTask *air_bubbles_spawn(Slot *slot);       // 94
ActTask *breakable_wall_spawn(Slot *slot);    // 114
ActTask *sinking_platform_spawn(Slot *slot);  // 85
ActTask *rising_platform_spawn(Slot *slot);   // 89
ActTask *lava_platform_spawn(Slot *slot);     // 98
ActTask *square_platform_spawn(Slot *slot);
ActTask *spiked_platform_spawn(Slot *slot);
ActTask *barrel_spawn(Slot *slot);
ActTask *bowl_spawn(Slot *slot);
ActTask *carousel_spawn(Slot *slot);
ActTask *ship_swing_spawn(Slot *slot);
ActTask *steam_exhaust_spawn(Slot *slot);
ActTask *boulder_spawn(Slot *slot);
ActTask *ramp_spawn(Slot *slot);
ActTask *waterfall_spawn(Slot *slot);
ActTask *half_pipe_spawn(Slot *slot);
ActTask *grind_rail_spawn(Slot *slot);

void entities_load(int level);
int entities_manager(ActTask *t);
ActTask *entity_spawn(Slot *slot);

void objects_start(int level, int paletteAnimations);
/** The tasks that run before Sonic's, and after him. */
void act_tasks_destroy_all(void);
/** TasksDestroyInPriorityRange: the act's tasks from priority `lo` up to `hi`. */
void act_tasks_destroy(int lo, int hi);
void objects_run_before_camera(void);
void objects_run_early(void);
/** The objects' tasks from the camera's priority up to the HUD's, and from the HUD's up to Sonic's. */
void objects_run_before_hud(void);
void objects_run_after_hud(void);
void objects_run_late(void);
/** Whether the frame is drawn: the title card's frames before the first picture aren't. */
void objects_set_drawing(int on);
int objects_drawing(void);
enum { DISPLAY_WIDTH = 240, DISPLAY_HEIGHT = 160 };

// --- what the kinds share ----------------------------------------------------------------------------------------------
static inline int cam_x(void) { return (int)__builtin_floor(act.cam.x); }
static inline int cam_y(void) { return (int)__builtin_floor(act.cam.y); }
/** IS_OUT_OF_CAM_RANGE and IS_OUT_OF_DISPLAY_RANGE on a world point. */
int off_cam(int x, int y);
int off_display(int x, int y);

/** What every kind's block starts with: the entity it came from (NULL for an effect), its sprite, and where its box is
 *  across, which Sonic reads to balance at its edge. */
typedef struct {
  Slot *slot;
  Sprite sprite;
  int x;
} Object;
enum { OBJECT_BYTES = 640 };
void *object_new(void);
#define OBJECT_NEW(type) ((void)sizeof(char[sizeof(type) <= OBJECT_BYTES ? 1 : -1]), (type *)object_new())
/** A block for a task with no sprite of its own: its sprite has no tiles to free. */
static inline void *object_plain(void *block) {
  if (block) ((Object *)block)->sprite.graphics.dest = HEAP_END;
  return block;
}
#define PLAIN_NEW(type) ((type *)object_plain(OBJECT_NEW(type)))
/** Makes the task of an object's block at the objects' priority, or at `priority`; false, with the block freed, when the
 *  list is full. */
ActTask *object_task(Object *o, ActRun run, int priority);
/** The end of an object's task: its tiles and block go and its place is free for the entity to spawn again. */
void object_end(ActTask *t);

/** Gives `s` an object's animation `anim` (variants first to last) in the OAM `order`, in front of the layers `prio`, with its
 *  own tiles. */
void object_sprite(Sprite *s, int anim, int first, int last, int order, int prio, int flipX, int flipY);
// where the kinds with fixed tiles keep them, from the start of sprite VRAM (the original's vram_hardcoded.h)
enum {
  VRAM_SPIKES = 0x1B00, VRAM_DUST_EFFECT_BRAKING = 0x2100, VRAM_BUMPER_TRI_BIG = 0x26A0, VRAM_BUMPER_TRI = 0x2B20,
  VRAM_BUMPER_TRI_2 = 0x2CA0, VRAM_BUMPER = 0x2E20,
};
/** The same, for the kinds whose tiles sit at a fixed place below the heap (vram_hardcoded.h), shared by all of that kind;
 *  vram_free leaves those places alone. */
void object_sprite_at(Sprite *s, uint32_t dest, int anim, int variant, int order, int prio, int flipX, int flipY);
void object_sprite_free(Sprite *s);
/** Starts variant `variant` over; its first frame shows on the next step. */
void sprite_start(Sprite *s, int variant);
/** Steps the animation; true on the step it has ended. */
int sprite_step(Sprite *s);
/** Puts the sprite at a world point, when the frame is drawn. */
void object_draw(Sprite *s, int x, int y);
/** Tiles of an animation's variants (the most any of them loads). */
int sprite_tiles(int anim, int first, int last);

// --- effects and what the prizes put around Sonic (effects.c, items.c) -------------------------------------------------------
/** The puff of smoke a broken item box or a defeated enemy leaves, at a world point. */
void dust_cloud(int x, int y);
/** How the four pieces of a broken block of ice or skating stone look: their two animations and the tiles each takes, the
 *  scale they start at (1/256), how much it grows a frame, and how many frames they last. */
typedef struct { int small, smallTiles, large, largeTiles, scale, grow, frames; } DebrisLook;
/** The pieces, spinning out from a world point and falling, placed around a place on screen (iceblocks.c). */
void shards_new(const DebrisLook *look, int x, int y, int sx, int sy);
/** Sonic's effects start over with the act: no brake dust on screen. */
void effects_start(void);
/** And so do the water's: no bubbles rising and no drowning music (underwater.c). */
void water_effects_start(void);
void items_shield(int shield);
void items_stars(void);

// --- the rings (rings.c) -----------------------------------------------------------------------------------------------
void rings_load(int level);
void rings_start(void);
void rings_act2_prepare(void);
void rings_start_point(void);
int rings_task(ActTask *t);
int scatter_task(ActTask *t);
void scatter_launch(int x, int y, int n, int layer, int inverted);
/** From now until the act starts again, the scattered rings also bounce off ceilings while they rise (a boss's). */
void scatter_ceilings(void);
/** A ring taken at (x, y): counted, with its sparkle and sound; ring_effect is the sparkle and sound alone. */
void ring_add(int x, int y);
void ring_effect(int x, int y);
void rings_add(int n);

// --- Sonic against an object's box (collide.c) -------------------------------------------------------------------------
// The results are the original's bits. `o` is the object, which Sonic's `onObject` names while he stands on it, and (ox, oy) is
// where its box is this frame.
enum { COLLIDE_LANDED = 0x8, COLLIDE_PUSHING = 0x20, COLLIDE_FROM_BELOW = 0x10000, COLLIDE_LEFT_FACE = 0x20000, COLLIDE_RIGHT_FACE = 0x40000 };
/** The hitbox a sprite has set in `slot`, or NULL for none. */
const Hitbox *object_box(const Sprite *s, int slot);
/** True when two boxes overlap, touching edges included (HB_COLLISION). */
int collide_overlap(int x0, int y0, const Hitbox *a, int x1, int y1, const Hitbox *b);
/** Sonic's body box, and the wider, shorter one that finds the objects beside him. */
Hitbox collide_body(const Player *p);
Hitbox collide_flank(const Player *p);
/** A solid object (Coll_Player_Platform): he lands on it, bumps it from below or is pushed out of its sides. */
int collide_platform(const void *o, int ox, int oy, const Hitbox *hb, Player *p);
/** A gate's sides (Coll_Player_Gate without its attack test): he is pushed out of them. */
int collide_gate(int ox, int oy, const Hitbox *hb, Player *p);
/** A platform he can only land on (Coll_Player_PlatformCrumbling). */
int collide_platform_top(const void *o, int ox, int oy, const Hitbox *hb, Player *p);
/** Coll_Player_SkatingStone: a platform's landing and bumping from below, with no pushing at its sides. */
int collide_skating_stone(const void *o, int ox, int oy, const Hitbox *hb, Player *p);
/** An item box (Coll_Player_Itembox). */
int collide_item_box(int ox, int oy, const Hitbox *hb, Player *p);
/** A horizontal spring's box (Coll_Player_Spring_Sideways). */
int collide_spring_side(const void *o, int ox, int oy, const Hitbox *hb, Player *p);

// --- the world's calls (world.c) -----------------------------------------------------------------------------------------
/** A hazard touched Sonic (Coll_DamagePlayer): false while he is invincible or still blinking. */
int world_damage(Player *p);
void world_add_score(int points);
void world_add_score_jingle(int points);
void world_prize(int kind);
void world_life_more(void);
/** A life more, with the 1-up jingle in place of the music. */
void world_extra_life(void);

#endif
