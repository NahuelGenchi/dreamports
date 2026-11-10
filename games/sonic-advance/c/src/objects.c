// The act's objects: their task list, the blocks they live in, the sprites they draw with, and the tables that say which
// kind each entity spawns as. Translated from the JavaScript version's engine/objects.js (createTasks, offCam, offDisplay,
// makeSprite, startAnim, animate, toggle, standIn and interactable).

#include "objects.h"
#include "enemies.h"

// --- the task list (createTasks) -----------------------------------------------------------------------------------
enum { MAX_ACT_TASKS = 192 };
static ActTask tasks[MAX_ACT_TASKS];
static ActTask *first, *following;   // the first task, and the one fetched before the running one

ActTask *act_task_add(ActRun run, ActEnd end, void *data, int priority) {
  ActTask *t = NULL;
  for (int i = 0; i < MAX_ACT_TASKS && !t; i++) if (!tasks[i].used) t = &tasks[i];
  if (!t) return NULL;
  t->run = run; t->end = end; t->data = data; t->priority = priority; t->used = 1;
  // after the last task of its priority
  ActTask **at = &first;
  while (*at && (*at)->priority <= priority) at = &(*at)->next;
  t->next = *at;
  *at = t;
  return t;
}

static void act_task_remove(ActTask *t) {
  for (ActTask **at = &first; *at; at = &(*at)->next) {
    if (*at == t) { *at = t->next; break; }
  }
  if (t->end) t->end(t);
  t->used = 0;
}

/** TasksDestroyAll for the act's objects: each goes as its destructor has it, freeing its sprites' VRAM. */
void act_tasks_destroy_all(void) {
  while (first) act_task_remove(first);
  following = NULL;
}

void act_tasks_run(int from, int to) {
  ActTask *t = first;
  while (t && t->priority < from) t = t->next;
  while (t && t->priority < to) {
    following = t->next;
    if (!t->run(t)) act_task_remove(t);
    t = following;
  }
  following = NULL;
}

// --- the blocks the objects live in ----------------------------------------------------------------------------------
enum { MAX_OBJECTS = 72 };
static struct { uint8_t bytes[OBJECT_BYTES] __attribute__((aligned(8))); int used; } blocks[MAX_OBJECTS];

void *object_new(void) {
  for (int i = 0; i < MAX_OBJECTS; i++) {
    if (blocks[i].used) continue;
    blocks[i].used = 1;
    memset(blocks[i].bytes, 0, OBJECT_BYTES);
    return blocks[i].bytes;
  }
  return NULL;
}

ActTask *object_task(Object *o, ActRun run, int priority) {
  ActTask *t = act_task_add(run, object_end, o, priority);
  if (!t) {
    for (int i = 0; i < MAX_OBJECTS; i++) if (blocks[i].bytes == (uint8_t *)o) blocks[i].used = 0;
    object_sprite_free(&o->sprite);
  }
  return t;
}

void object_end(ActTask *t) {
  Object *o = (Object *)t->data;
  if (o->slot) o->slot->live = NULL;
  object_sprite_free(&o->sprite);
  for (int i = 0; i < MAX_OBJECTS; i++) if (blocks[i].bytes == (uint8_t *)o) blocks[i].used = 0;
}

// --- where an object is: in range of the camera ------------------------------------------------------------------------
int off_cam(int x, int y) {
  int cx = cam_x(), cy = cam_y();
  return ((x - cx + 128) & 0xFFFF) > 496 || y - cy + 128 < 0 || y - cy > 288;
}

int off_display(int x, int y) {
  int cx = cam_x(), cy = cam_y();
  return x > cx + 368 || x < cx - 128 || y > cy + 288 || y < cy - 128;
}

// --- sprites (makeSprite, startAnim, animate) --------------------------------------------------------------------------
static int drawing;
void objects_set_drawing(int on) { drawing = on; }
int objects_drawing(void) { return drawing; }

// how many tiles an animation script loads at most: its GetTiles commands, up to its end or its jump back
static int script_tiles(uint32_t script) {
  static const int WORDS[13] = { 0, 3, 3, 2, 1, 2, 3, 2, 3, 2, 4, 2, 2 };
  int most = 0;
  for (int cur = 0, guard = 0; guard < 600; guard++) {
    uint32_t at = script + (uint32_t)cur * 4;
    int id = rom_s32(at);
    if (id >= 0) { cur += 2; continue; }
    if (id == -3 || id == -4 || id == -9) break;
    if (id == -1 && (int)rom_u32(at + 8) > most) most = (int)rom_u32(at + 8);
    cur += id >= -12 ? WORDS[-id] : 1;
  }
  return most;
}

int sprite_tiles(int anim, int first, int last) {
  int most = 0;
  for (int v = first; v <= last; v++) {
    int n = script_tiles(rom_ptr(rom_ptr(sprites.anims + (uint32_t)anim * 4) + (uint32_t)v * 4));
    if (n > most) most = n;
  }
  return most;
}

void object_sprite_at(Sprite *s, uint32_t dest, int anim, int variant, int order, int prio, int flipX, int flipY) {
  sprite_init(s);
  s->hitboxes[1].index = -1;   // no hitbox until the animation sets one
  s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant;
  s->graphics.dest = dest;
  s->oamFlags = (uint16_t)(order << 6);
  s->frameFlags = (uint32_t)prio << 12 | (flipX ? SPRITE_X_FLIP : 0) | (flipY ? SPRITE_Y_FLIP : 0);
}

void object_sprite(Sprite *s, int anim, int firstVariant, int lastVariant, int order, int prio, int flipX, int flipY) {
  object_sprite_at(s, vram_malloc((uint32_t)sprite_tiles(anim, firstVariant, lastVariant)), anim, firstVariant, order, prio, flipX, flipY);
}

void object_sprite_free(Sprite *s) {
  vram_free(s->graphics.dest);
  s->graphics.dest = HEAP_END;
}

void sprite_start(Sprite *s, int variant) {
  s->variant = (uint8_t)variant;
  s->prevVariant = 0xFF;
}

int sprite_step(Sprite *s) { return !update_sprite(s, 0); }

void object_draw(Sprite *s, int x, int y) {
  if (!drawing) return;
  s->x = (int16_t)(x - cam_x());
  s->y = (int16_t)(y - cam_y());
  display_sprite(s);
}

// --- layer toggles (toggle_player_layer.c) -----------------------------------------------------------------------------
// While a player's centre is inside one, the front one puts them on the front layer and the back one on the back layer; it
// sees where they were at the end of the last frame.
enum { TOGGLE_FRONT = 17, TOGGLE_BACK = 18 };

// a task for a kind not built yet: it does nothing but leave when its spawn point does, so that every task keeps its place
static int stand_in_run(ActTask *t) {
  Slot *slot = (Slot *)t->data;
  if (off_cam(slot->e.x, slot->e.y)) { slot->live = NULL; return 0; }
  return 1;
}
static ActTask *stand_in(Slot *slot) { return act_task_add(stand_in_run, NULL, slot, PRIORITY_OBJECTS); }

static int toggle_run(ActTask *t) {
  Slot *slot = (Slot *)t->data;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (x >= e->x && x <= e->x + e->d[2] * 8 && y >= e->y && y <= e->y + e->d[3] * 8) p->layer = e->kind == TOGGLE_FRONT ? LAYER_FRONT : LAYER_BACK;
  return stand_in_run(t);
}
static ActTask *toggle_spawn(Slot *slot) { return act_task_add(toggle_run, NULL, slot, PRIORITY_OBJECTS); }

// --- what each entity spawns as -----------------------------------------------------------------------------------------
// The interactables by their kind numbers (SAT-R's interactable table); one line a kind built, a stand-in for the rest.
static const struct { int first, last; Spawn spawn; } INTERACTABLES[] = {
  { 1, 4, spikes_spawn },
  { 5, 6, hiding_spikes_spawn },
  { 8, 15, spring_spawn },
  { TOGGLE_FRONT, TOGGLE_BACK, toggle_spawn },
  { 21, 23, platform_spawn },
  { 25, 25, platform_spawn },
  { 104, 104, platform_spawn },
  { 48, 53, bumper_spawn },
  { 54, 54, flipper_spawn },
  { 56, 56, flipper_spawn },
  { 65, 68, marble_track_spawn },
  { 71, 71, bumper_spawn },
  { 72, 72, teleport_orb_spawn },
  { 73, 73, flipper_blue_spawn },
  { 106, 106, tube_track_spawn },
  { 107, 107, tube_junction_spawn },
  { 0, 0, goal_spawn },
  { 7, 7, checkpoint_spawn },
  { 42, 42, red_flag_spawn },
  { 44, 45, wall_pole_spawn },
  { 55, 55, square_platform_spawn },
  { 57, 57, barrel_spawn },
  { 58, 58, sega_letter_spawn },
  { 59, 59, balloon_spawn },
  { 60, 60, ship_swing_spawn },
  { 61, 61, spiked_platform_spawn },
  { 62, 62, bowl_spawn },
  { 63, 64, panel_gate_spawn },
  { 69, 69, conveyor_spawn },
  { 31, 33, booster_spawn },
  { 75, 75, hook_rail_spawn },
  { 76, 76, swinging_hook_spawn },
  { 96, 96, curler_spawn },
  { 105, 105, lava_spawn },
  { 77, 77, security_gate_spawn },
  { 78, 78, swing_rope_spawn },
  { 80, 80, crane_claw_spawn },
  { 110, 110, pipe_entrance_spawn },
  { 111, 111, pipe_exit_spawn },
  { 47, 47, booster_spawn },
  { 100, 101, booster_spawn },
  { 70, 70, visibility_spawn },
  { 74, 74, carousel_spawn },
  { 79, 79, steam_exhaust_spawn },
  { 102, 102, special_spring_spawn },
};

// the enemies by their kind numbers (the ENEMIES table)
static const struct { int kind; Spawn spawn; } ENEMIES[] = {
  { 8, hanabii_spawn },
  { 9, slot_machine_spawn },
  { 10, pierrot_spawn },
  { 6, tentou_spawn },
  { 15, mole_spawn },
  { 23, egg_press_spawn },
  { 7, fireball_spawn },
};

ActTask *entity_spawn(Slot *slot) {
  int kind = slot->e.kind;
  if (slot->list == ENTITY_ITEM_BOX) return item_box_spawn(slot);
  if (slot->list == ENTITY_INTERACTABLE) {
    for (unsigned i = 0; i < sizeof INTERACTABLES / sizeof INTERACTABLES[0]; i++) {
      if (kind >= INTERACTABLES[i].first && kind <= INTERACTABLES[i].last) return INTERACTABLES[i].spawn(slot);
    }
    return stand_in(slot);
  }
  for (unsigned i = 0; i < sizeof ENEMIES / sizeof ENEMIES[0]; i++) {
    if (kind == ENEMIES[i].kind) return ENEMIES[i].spawn(slot);
  }
  return stand_in(slot);
}

// --- the act's objects, in the order the tasks make them ---------------------------------------------------------------
// the place of the stage's palette animations in the original's task list (CreatePaletteLoaderTask, 0x2000), made
// just after the entities manager: as the task after it, it lets what the manager spawns, put after the last task of
// its priority, run on the same frame, even on the frame it spawns everything in range. The animations themselves
// run as the engine's tasks (act.c)
static int palette_place(ActTask *t) { (void)t; return 1; }

void objects_start(int level, int paletteAnimations) {
  first = following = NULL;
  memset(tasks, 0, sizeof tasks);
  memset(blocks, 0, sizeof blocks);
  drawing = 1;
  effects_start();
  enemies_start();
  entities_load(level);
  rings_load(level);
  rings_start();
  act_task_add(rings_task, NULL, NULL, PRIORITY_OBJECTS);
  act_task_add(entities_manager, NULL, NULL, PRIORITY_OBJECTS);
  if (paletteAnimations) act_task_add(palette_place, NULL, NULL, PRIORITY_OBJECTS);
  act_task_add(scatter_task, NULL, NULL, PRIORITY_SCATTER);
}

void objects_run_before_camera(void) { act_tasks_run(0, PRIORITY_CAMERA); }
void objects_run_early(void) { act_tasks_run(PRIORITY_CAMERA, PRIORITY_SONIC); }
void objects_run_late(void) { act_tasks_run(PRIORITY_SONIC, 0x10000); }
