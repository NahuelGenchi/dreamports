// Neo Green Hill act 1's enemies, their shots and what a defeat leaves behind, translated from the JavaScript
// version's engine/enemies.js, engine/defeat.js and rom/entities.js.

#ifndef SA_ACTENEMIES_H
#define SA_ACTENEMIES_H

/** Reads the act's enemy grid and clears everything it left from the last time. */
void enemies_init(int level);
/** Clears the enemies, shots and effects, as the act does when it starts over. */
void enemies_reset(void);
/** Spawns the enemies in the camera's range, then runs them and their shots for this frame. */
void enemies_update(int camX, int camY);
/** Draws every live enemy, shot and effect at its place on the screen. */
void enemies_draw(int camX, int camY);
/** 1 when a body or a shot hurt the player this frame, 0 otherwise. */
int enemies_player_hit(void);
// CreateDustCloud at a place (the effects pool the enemies, item boxes and boulders share).
void en_add_dust(int x, int y, int delay);
/** 1 when the player's attack box destroyed an enemy this frame, 0 otherwise. */
int enemies_player_attack_hit(void);

#endif

/** The most tiles an animation script loads in a frame (the sprite heap's size for it). */
int en_animation_tiles(uint16_t anim, int variant);
