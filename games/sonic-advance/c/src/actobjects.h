// The act's static objects, translated from the JavaScript version's engine/objects.js and the files its objects
// come from (springs.js, spikes.js, platforms.js, boulders.js, boosters.js, checkpoints.js, itembox.js, items.js,
// goal.js, ramps.js, halfpipes.js, grindrails.js and slides.js), with their data from rom/entities.js.

#ifndef SA_ACTOBJECTS_H
#define SA_ACTOBJECTS_H

// The entities manager: reads `level`'s interactable and item box grids, and spawns the objects whose spawn
// point is in the range around the camera, in the original's order.
void objects_init(int level);
// The objects' graphics, taken once the title card has given its tiles back (LoadStageIntroGraphics' heap as the
// original has it when the first object spawns).
void objects_alloc_vram(void);
// Puts every object back as the act starts over, keeping the checkpoint that was passed.
void objects_reset(void);
// Spawns what the camera now covers, and runs every live object once. It sees Sonic where he was at the end of
// the last frame, so it runs before his own step, and may move him.
void objects_update(int camX, int camY);
// Draws every live object's sprite at its place on the screen.
void objects_draw(int camX, int camY);
// 1 when an object or spike hurt Sonic this frame, which it did itself through objects_hurt_player.
int objects_player_hit(void);
// Hurts Sonic as Coll_DamagePlayer does: a shield takes the hit, with rings he drops them, or without any he dies.
// Already called where an object or spike touches him; the act calls it for an enemy or shot that touched him.
void objects_hurt_player(void);
// 1 while an item box's invincibility, which destroys enemies that touch him instead of hurting him.
int objects_player_invincible(void);
// The item boxes' prizes that live here while they run: the shield (0 none, 1 shield, 2 magnetic shield),
// frames of invincibility left, and frames of speed shoes left. `act` has no fields for them.
void objects_player_state(int *shield, int *invincible, int *speedUp);

#endif
