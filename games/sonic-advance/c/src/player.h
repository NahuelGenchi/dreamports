// Sonic, Tails, Knuckles or Amy as the character played, and Tails as the CPU's partner: their state, movement and
// animation, translated from the JavaScript version's engine/player.js and engine/animator.js. The boost modes and the Sonic
// Advance 2 tricks are not here; the fields the objects will read and set (onto him, holding his controls, curling him
// up) are.

#ifndef SA_PLAYER_H
#define SA_PLAYER_H

#include "sa.h"

enum { LAYER_FRONT = 0, LAYER_BACK = 1 };
enum { CHARACTER_SONIC = 0, CHARACTER_TAILS = 1, CHARACTER_KNUCKLES = 2, CHARACTER_AMY = 3 };
// Knuckles' glide flags (w.kf.flags): not yet down, and a wall stopped him
enum { GLIDE_UP = 0x2, GLIDE_WALL = 0x20 };
// Knuckles' midAir: gliding, dropping from it, sliding after it, climbing, onto a ledge, and floating on the water
enum { KN_GLIDE = 1, KN_DROP = 2, KN_SLIDE = 3, KN_CLIMB = 4, KN_LEDGE = 5, KN_FLOAT = 9 };
// how the camera's look eases on one of his frames: left as it is (a jump off the water), once more while he glides
// (sub_8048980), and once more again while he climbs (Player_8047280)
enum { LOOK_EASE_NONE, LOOK_EASE_STILL, LOOK_EASE_GLIDE, LOOK_EASE_CLIMB };
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
  PS_GRIND, PS_GRIND_STEEP, PS_RAIL_JUMP,   // grinding down a rail, on a steep part, jumping off before its end
  PS_HANG, PS_HANG_MOVE,   // hanging from a hang bar, still and moving along it
  PS_REACT,                // taken aback as Mecha Knuckles wakes up (charState 39)
  PS_ACT_CLEAR_POSE,        // standing by an opened capsule (CHARSTATE_ACT_CLEAR_B)
  PS_HALF_PIPE_LOW, PS_HALF_PIPE_MID, PS_HALF_PIPE_HIGH,   // the three walks a half-pipe gives him
  PS_BREATHE,               // taking a breath from an air bubble (CHARSTATE_27)
  PS_FLOAT,                 // lifted by a whirlwind (CHARSTATE_37)
  PS_GRABBED,               // held in Egg X's claw
  PS_MOON_GAZE, PS_MOON_TRANSFORM, PS_MOON_FLY,   // X Zone's way to the Moon Zone
  // Tails' own: flying, turning in flight, tired out and landing as the CPU's partner (charStates 53 to 56), swimming and
  // turning under water (57 and 58), and the tail swipe (60)
  PS_FLY, PS_FLY_TURN, PS_FLY_TIRED, PS_FLY_LAND, PS_SWIM, PS_SWIM_TURN, PS_TAIL_SWIPE,
  // Knuckles' own (charStates 62 to 84): gliding and turning round in a glide (under water he swims, PS_SWIM), the drop
  // from it and its landing, the slide after it, on a wall (grabbing it, climbing, still, up and down, and up onto its
  // ledge), the punches and the uppercut, and floating on the water
  PS_GLIDE, PS_GLIDE_TURN0, PS_GLIDE_TURN1, PS_GLIDE_TURN2, PS_GLIDE_TURN3, PS_GLIDE_DROP, PS_DROP_LAND, PS_GLIDE_SLIDE,
  PS_WALL_GRAB, PS_CLIMB, PS_CLIMB_UP, PS_CLIMB_DOWN, PS_LEDGE_CLIMB, PS_LEDGE_TOP,
  PS_PUNCH1, PS_PUNCH2, PS_PUNCH3, PS_UPPERCUT, PS_WATER_FLOAT, PS_WATER_FLOAT_UP,
  // Amy's own (charStates 85 to 93): rising from a jump with no curl, the leap off her hammer, her two swings, the hammer in
  // the air and swirled down, her dive, its slam and slide, and the pose that ends it
  PS_HAMMER_RISE, PS_HAMMER_LEAP, PS_HAMMER, PS_HAMMER2, PS_HAMMER_AIR, PS_HAMMER_SWIRL, PS_DIVE, PS_DIVE_SLAM, PS_DIVE_END,
  PA_BORED, PA_RUN, PA_BRAKE_TURN,   // bored of waiting, running, and turning round after a skid
  PA_COUNT
} PlayerAnim;

// what the pad says this frame
typedef struct {
  int left, right, up, down, jump, attack, jumpPressed, attackPressed;
} PlayerInput;

typedef struct {
  int character;                // CHARACTER_*
  int cpu;                      // the CPU's partner (gPartner), whose camera, music and loop are Sonic's
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
  int midAir;                   // mid-air move used this jump: 1 insta-shield, 2 dash; Tails' flight, 2 to 31 rising after
                                // a press
  int glideShift, glideFlags;  // Knuckles' glide heading (w.kf.shift: 0 right, 0x80 left, turning between) and GLIDE_* flags
  int hammerJump;               // Amy, MOVESTATE_2000000: in the air with no hammer and no jump cap (her hammer's leap, a bounce)
  int dive;                     // Amy, MOVESTATE_4000000: her dive, with its slide (sub_80495F0)
  int waterCrossed;             // MOVESTATE_1000: he went into the water or out of it this frame
  int lookEase;                 // this frame's extra easing of the camera's look (LOOK_EASE_*), Knuckles'
  int flyTime;                  // Tails: frames of flight left, counted down every other frame (flyingDuration)
  int attack, attackNext;       // step of the B-button combo, and the move queued after the somersault
  int idleT;                    // frames until he gets bored
  int invulnerable, invincible, speedUp;   // frames of blinking, invincibility and speed shoes left
  int hidden;                   // left out of this frame's drawing
  int prio;                     // his sprite's priority, as his animation's commands leave it
  int dead, death, countdown;   // dead, the stage of the death (PLAYER_DEATH_*), and frames to the restart
  int chain;                    // enemies defeated since he last touched the ground
  int inverted, wasInverted;    // gravity flipped, now and when the stage clock last ran
  int water;                    // in the water (MOVESTATE_IN_WATER): his centre 4 px or more below its line
  int drownSeconds, drownFrames;   // seconds until he drowns, and frames until the next goes (secondsUntilDrown and
                                   // framesUntilDrownCountDecrement)
  int surfaceT;                 // frames before the next splash at the line can show (unk88)
  // what the objects set
  int shield;                   // the shield an item box gave him (SHIELD_*)
  const void *onObject;         // the solid object he stands on, if any
  int animRestart;              // an object asked for his animation to start over
  int forcedRoll, scripted, actClear, halfPipe, ignoreInput, wasIgnoreInput, carried, override;
  int grinding;                 // on a grind rail, on the layer it put him on (MOVESTATE_1000000)
  int front;                    // drawn in front of the front layer, priority 1, as on a grind rail
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
  Sprite tails;                 // Tails' tails, a second sprite shown while he is curled up (AllocateCharacterMidAirGfx)
  int tailsShift;               // the way he moves, which turns his tails (w.tf.shift)
  int tailsShown, tailsMatrix;  // his tails drawn this frame, through this rotation matrix (gOamMatrixIndex)
} Player;

enum { PLAYER_ALIVE = 0, PLAYER_FALLING, PLAYER_GONE };
enum { NO_TRACK = 0x7F, FULL_SCALE = 0x100 };

void player_init(Player *p, int x, int y);
/** Tails as InitializePlayer makes him for the CPU's partner: his sprites from the heap, the body with room for Sonic's
 *  run (ALLOC_TILES(SA1_ANIM_SONIC_RUN)) and his tails 16 tiles. */
void player_init_partner(Player *p, int x, int y);
/** Tails as his character: his tails' sprite from the heap (AllocateCharacterMidAirGfx), after the body's. */
void player_become_tails(Player *p);
void player_free(Player *p);
void player_time_up(Player *p);
/** One frame of his movement, before his animation. */
void player_step(Player *p, const PlayerInput *in);
/** Picks and steps his animation after the movement, and decides whether he is drawn. */
void player_animate(Player *p, const PlayerInput *in);
void player_draw(Player *p, int camX, int camY);
/** Knuckles on a wall, grabbing it, climbing or pulling himself up its ledge (sub_80549FC). */
int player_climbing(const Player *p);
/** Knuckles gliding or sliding on after a glide, whom an object he lands on leaves in the air (sub_800C934). */
int player_gliding(const Player *p);
/** What Amy's hammer hits (Coll_AmyHammer_Spring): one of her swings, while its attack box is out, on the object's box
 *  `hb` at (x, y). */
int player_hammer_hits(const Player *p, int x, int y, const Hitbox *hb);
/** A speed 1.5 times as fast, as the original works it out in 1/256 px: what a spring her hammer hits gives her. */
double player_hammer_speed(double v);
/** Sent back off a boss his attack box hit: the way he came, or Amy with half her speed across (Coll_Player_Enemy). */
void player_bounce_off_boss(Player *p);
/** The state an object throws her into the air with, where it curls up the others (charState 85 for 5). */
int player_thrown_state(const Player *p);
/** Amy's dive turned into its slam or its slide (MOVESTATE_4000000 with unk62), which an object she lands on leaves in the
 *  air (Coll_Player_Platform). */
int player_slamming(const Player *p);
/** Player_HandleWater: in and out of the water, and the drowning count (the start of his frame). */
void player_water_step(Player *p);
/** Tails' tails after his animation: the way they turn, and their own animation while he is curled up (sub_8024F74). */
void player_tails_step(Player *p);
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
/** A breath from an air bubble: his moves end, he uncurls, stops dead, and the drowning count starts over. */
void player_breathe(Player *p);

#endif
