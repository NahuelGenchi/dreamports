// Sonic: his state, movement and animation, translated from the JavaScript version's engine/player.js and
// engine/animator.js. The characters other than Sonic, the water, the boost modes and the Sonic Advance 2 tricks are
// not here; the fields the objects will read and set (onto him, holding his controls, curling him up) are.

#ifndef SA_PLAYER_H
#define SA_PLAYER_H

#include "sa.h"

enum { LAYER_FRONT = 0, LAYER_BACK = 1 };
enum { SHIELD_NONE, SHIELD_NORMAL, SHIELD_MAGNETIC };

// the d-pad bits of the input history (the mid-air dash reads it)
enum { DPAD_LEFT = 1, DPAD_RIGHT = 2, DPAD_UP = 4, DPAD_DOWN = 8, DPAD_HISTORY = 16 };

// Sonic's character states (charState): each picks its animation of the same name (SONIC_ANIMATIONS in rom/extract.js),
// and some animations hand over to the next state when they end. The animations no state names come after them.
typedef enum {
  PS_IDLE, PS_WALK, PS_TURN, PS_BRAKE, PS_CROUCH, PS_CROUCH_END, PS_LOOK_UP, PS_LOOK_UP_END, PS_SPIN_DASH,
  PS_SPIN_DASH_REV, PS_SPIN, PS_INSTA_SHIELD, PS_AIR_DASH, PS_SPIN_ATTACK, PS_SOMERSAULT, PS_SLIDE, PS_SLIDE_END,
  PS_BACKFLIP, PS_SPRING, PS_SPRING_RISE, PS_SPRING_PEAK, PS_SPRING_FALL, PS_BOUNCE, PS_PUSH, PS_BALANCE_FORWARD,
  PS_BALANCE_BACK, PS_HURT, PS_DEAD, PS_MARBLE_TRACK,
  PS_POLE, PS_FLAG_SWING, PS_ACT_CLEAR_RUN, PS_CAROUSEL_RIDE,   // on a wall pole, swinging round a red flag, running off past the goal, riding a carousel
  PS_SWING_ROPE, PS_HOOK,   // swinging round a rope, hanging from a hook rail, a swinging hook or a crane claw
  PS_ACT_CLEAR_POSE,        // standing by an opened capsule (CHARSTATE_ACT_CLEAR_B)
  PS_HALF_PIPE_LOW, PS_HALF_PIPE_MID, PS_HALF_PIPE_HIGH,   // the three walks a half-pipe gives him
  PA_BORED, PA_RUN, PA_BRAKE_TURN,   // bored of waiting, running, and turning round after a skid
  PA_COUNT
} PlayerAnim;

// what the pad says this frame
typedef struct {
  int left, right, up, down, jump, attack, jumpPressed, attackPressed;
} PlayerInput;

typedef struct {
  double x, y, gsp, xsp, ysp;   // his centre, and his speeds in pixels a frame: along the surface, and in X and Y
  int facing;                   // 1 right, -1 left
  int state, prevState;         // PS_*, and the one his animation was last picked for
  int animName;                 // the animation shown (PS_* or PA_*)
  int rotation, rotA, rotB;     // the surface's angle (256 steps a turn), and the last the two ground sensors saw
  int layer;                    // which of the act's two collision layers he touches
  int lock;                     // frames of control lock left after slipping off a wall
  int air;                      // in the air
  int curled, pushing;          // a ball (rolling or jumping), and walking into a wall or a solid object
  int jumped, airLock;          // left the ground with the jump button, and jumped out of a roll
  int spinDashing;
  int dashAccel;                // the spin dash's charge, in 1/256 px
  int offsetY;                  // from his centre to the ground sensors
  int midAir;                   // mid-air move used this jump: 1 insta-shield, 2 dash
  int attack, attackNext;       // step of the B-button combo, and the move queued after the somersault
  int idleT;                    // frames until he gets bored
  int invulnerable, invincible, speedUp;   // frames of blinking, invincibility and speed shoes left
  int hidden;                   // left out of this frame's drawing
  int prio;                     // his sprite's priority, as his animation's commands leave it
  int dead, death, countdown;   // dead, the stage of the death (PLAYER_DEATH_*), and frames to the restart
  int chain;                    // enemies defeated since he last touched the ground
  int inverted, wasInverted;    // gravity flipped, now and when the stage clock last ran
  // what the objects set
  int shield;                   // the shield an item box gave him (SHIELD_*)
  const void *onObject;         // the solid object he stands on, if any
  int animRestart;              // an object asked for his animation to start over
  int forcedRoll, scripted, actClear, halfPipe, ignoreInput, carried, override;
  int track;                    // the step of the marble track or tube holding him (unk99[0]), NO_TRACK when none does
  int scale;                    // his size through the rotation hardware (8.8), smaller inside a marble track
  int drawRotation;             // the angle he is drawn at through the rotation hardware (1024 a turn)
  int invisible;                // hidden by an object that holds him out of sight
  int heldRight;                // while an object holds the pad, it gives him right held (the goal's run off)
  int heldLeft;                 // or left held (the walk off from a boss's capsule)
  int plainSprings;             // back from a special stage: the special springs are plain springs
  int heldDirs, pressedDirs;    // the d-pad his last frame read, and what it found newly pressed
  int jumpPressed, attackPressed;
  int held[DPAD_HISTORY], pressed[DPAD_HISTORY];
  Sprite sprite;                // his graphics, kept by the animation
} Player;

enum { PLAYER_ALIVE = 0, PLAYER_FALLING, PLAYER_GONE };
enum { NO_TRACK = 0x7F, FULL_SCALE = 0x100 };

void player_init(Player *p, int x, int y);
/** One frame of his movement, before his animation. */
void player_step(Player *p, const PlayerInput *in);
/** Picks and steps his animation after the movement, and decides whether he is drawn. */
void player_animate(Player *p, const PlayerInput *in);
void player_draw(Player *p, int camX, int camY);
/** The hooks for the objects: out of a ball and into one, keeping his feet in place. */
void player_stand_up(Player *p);
void player_curl_up(Player *p);
/** Starts the jump the course select's held A began, one frame into it. */
void player_start_jump(Player *p);
/** Touching down on the ground or an object (sub_8021BE0); the caller sets the ground speed. */
void player_land(Player *p);
/** Ends the B-button combo, the mid-air moves and the spin dash. */
void player_end_attack(Player *p);
/** Hurts him, unless he is invincible or still blinking; false when he is protected. */
int player_hurt(Player *p);
/** Knocks him aside at the given speeds, blinking as after a hit but keeping his rings. */
void player_knock_aside(Player *p, double xsp, double ysp);

#endif
