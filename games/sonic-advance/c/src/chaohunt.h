// Chao Hunt, the VS mode's round (chaohunt.c): what the act asks of it.

#ifndef SA_CHAOHUNT_H
#define SA_CHAOHUNT_H

#include "sa.h"
#include "player.h"

typedef struct {
  int active;      // a round is being played (gGameMode 4)
  int id, count;   // this GBA's number on the link, and how many play
  int chaoPlace;   // the Chao's place among the stage's eight, as the link handed it
  int itemEffect;  // gPlayer.itemEffect: 0x80 while the title card holds him (teleporting), 0x20 invisible, 0x40 confused
  int charRings[PLAYERS_MAX];   // gMultiplayerCharRings: the Chao each player holds
  int ranks[PLAYERS_MAX];       // gMultiplayerRanks: each player's result, -1 while the round runs
  int over;                     // the clock has run out
  int whiteDone;                // the round's end has whitened the screen: the results screen comes next
  uint32_t random;              // gMultiplayerPseudoRandom: the players' shared random numbers
  int itemTurn;                 // gRandomItemBox: which mystery item box shows (low 3 bits) and its generation (high 4)
  int invisibleTimer;           // itemEffect20Timer: frames of invisibility left
  int confusion;                // timerConfusion: frames of confusion left
} Round;

// a player as the round sees it (MultiplayerPlayer)
typedef struct {
  int made, id;
  Sprite s;
  Transform tf;
  int x, y;            // pos
  int dx, dy;          // unk44, unk48: how far its last packet moved it
  int16_t qvx, qvy;    // unk66, unk68: that in 1/256 px, 0 after a jump of more than 64 px
  uint16_t flags;      // unk54: its packet's flags
  uint8_t items;       // unk57: its packet's item effects
  uint32_t state;      // unk5C: 1 out of the round, 2 the title card still running, 4 carried, 0x10000 << n carrying Chao n
  int wait;            // unk60: frames before it can be touched again
  int missed;          // unk61: frames since its last packet
  int standsOn;        // unk64: which player it stands on
  int offsetY;         // unk58[0]
} MpPlayer;

extern MpPlayer mpPlayers[PLAYERS_MAX];
void mp_player_create(int id, int x, int y);
void mp_players_run(void);
void mp_players_stop(void);
void mp_send(const Player *p, int fresh);
/** gOamMatrixIndex: the next rotation matrix in this frame for a round's sprites turned through the hardware. */
int mp_next_matrix(void);
// the arrows toward the other players (mphud.c)
void mp_indicator_create(int id);
void mp_indicators_run(void);
void mp_indicators_stop(void);
// the HUD, made as the card ends (mphud.c)
void mp_hud_create(void);
void mp_hud_run(void);
void mp_hud_stop(void);
// the round's end (mphud.c)
void mp_finish_start(void);
void mp_results_run(void);
int mp_finish_run(void);
void mp_finish_display(void);
void mp_finish_stop(void);
/** The title card's end: the players can be touched, Sonic blinks for two seconds, and the HUD appears. */
void chaohunt_card_end(void);
/** CreateRoomEvent: an event for the other GBAs, queued until each has heard the one before (mp_event_mgr.c). */
void chaohunt_send_event(int type, int a, int b, int c, int d);
/** Whether every queued event is out. */
int chaohunt_queue_empty(void);
/** Task_MultiplayerEventMgr_Receive (priority 1) and _Send (0xFFFE), at the frame's start and end. */
void chaohunt_receive(void);
void chaohunt_send(void);
/** Task_GameStage's shared random numbers and item turn, every frame before the clock. */
void chaohunt_clock(void);
/** The clock has run out: the round is over (CreateMultiplayerFinishTransition). */
void chaohunt_finish(void);

extern Round hunt;

/** Whether the act is a round of Chao Hunt. */
int chaohunt_active(void);
/** Player `player`'s start place in multiplayer stage `level`. */
void chaohunt_spawn(int level, int player, int32_t *x, int32_t *y);
/** The stage's multiplayer init: a task for every player, Sonic waiting out the title card. */
void chaohunt_setup(void);
/** Starts the round the VS menus chose. */
void chaohunt_start(int level, int chao);

/** The round's results screen (mpresults.c), and the continue screen after it (vscontinue.c). */
void create_vs_results(void);
void create_vs_continue(void);

#endif
