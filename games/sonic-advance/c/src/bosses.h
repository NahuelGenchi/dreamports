// What the bosses share: the arena's camera bounds, the screen's shake, a part flying off, the debris and explosions a beaten
// boss throws, the Egg Mobile's escape, Sonic against a boss, the boss music and the capsule that ends a zone's second act.
// Declared for the boss files (eggpress.c) and translated from the JavaScript version's engine/bosses.js, screenshake.js,
// capsule.js and sound/music.js (the original's bosses_misc.c, bosses_egg_mobile.c, nuts_and_bolts_task.c, screen_shake.c,
// collision_3.c and music_manager.c).

#ifndef SA_BOSSES_H
#define SA_BOSSES_H

#include "enemies.h"

/** What Sonic and a boss did to each other: nothing, he hit it, or it hurt him (EHit). */
enum { HIT_NONE, HIT_ENEMY, HIT_PLAYER };

// the screen's shake (CreateScreenShake): its flags, and its task's place just before the camera's (0xF00)
enum {
  SHAKE_POSITIVE = 0x1, SHAKE_NEGATIVE = 0x2, SHAKE_RANDOM = 0x10, SHAKE_EVEN_FRAMES = 0x20,
  SHAKE_HORIZONTAL = 0x40, SHAKE_VERTICAL = 0x80,
  PRIORITY_SHAKE = 0xEFF,
};

// the music manager's boss states (gMusicManagerState.unk1): the boss song starts, or stops for the stage's song
enum { BOSS_MUSIC_START = 0x10, BOSS_MUSIC_END = 0x30 };

/** A part of a boss flying off (sub_80168F0): made with the original's defaults, which its maker then changes. */
typedef struct {
  Object o;
  Transform tf;
  int x, y;            // in the act (unk3C, unk3E)
  int vx, vy;          // 1/256 px a frame (qUnk44, qUnk46)
  int spin, grow;      // the turn and the change of scale a frame (unk42, unk48)
  int frames;          // left to run (unk40)
} BossPart;

/** The task of a block that starts with an Object, with its own end, which must call object_end. */
ActTask *boss_task(Object *o, ActRun run, ActEnd end, int priority);
/** Puts a sprite at a point on the screen and shows it, while the frame is drawn. */
void boss_display(Sprite *s, int sx, int sy);
/** gOamMatrixIndex: the next rotation matrix of the frame, from 4, as the camera's task leaves it. */
int boss_matrix(void);

/** Bosses_SetCamBounds: the arena's edges in the act; the camera closes in on them 1 px a frame. */
void boss_cam_bounds(int minY, int maxY, int minX, int maxX);
/** CreateScreenShake: `amplitude` (1/256 px) falls by `fade` a frame, the wave turns `step` of 1024 a frame, for `frames`
 *  frames (-1 for as long as it lasts). */
void boss_shake(int amplitude, int fade, int step, int frames, int flags);
BossPart *boss_part(int x, int y, int tiles, int anim, int variant);
/** sub_8017540: an explosion at (qx, qy) in 1/256 px. */
void boss_explosion(int qx, int qy);
/** A piece of debris and an explosion from (x, y), falling `ay`/256 px a frame faster each frame. */
void boss_debris(int x, int y, int ay);
/** CreatePostBossEggMobile: Eggman flies off from (x, y). */
void boss_egg_mobile(int x, int y);
/** CreatePreBossCameraPan: the top and bottom edges close in on `minY` and `maxY` 1 px a frame. */
void boss_cam_pan(int minY, int maxY);
/** Coll_Player_Boss: Sonic's attack on the boss's box 0 hits it, his body on it is hurt. */
int boss_hit(const Sprite *s, int x, int y);
/** sub_800BFEC: the sprite's box 1 on Sonic's body hurts him. */
int boss_hurt(const Sprite *s, int x, int y);
/** Coll_Player_Bosses_2_6: Sonic on the boss's sprite at (x, y). */
int boss_hit26(const Sprite *s, int x, int y);
/** The music manager's boss state, acted on in this frame's run of the manager. */
void boss_music(int state);
/** CreateBossCapsule: the capsule rises from the beaten boss at (x, y) (capsule.c). */
void boss_capsule(int x, int y);

#endif
