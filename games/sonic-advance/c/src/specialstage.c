// A special stage, translated from special/stage.js (SAT-R's src/game/sa1/special_stage/main.c: CreateSpecialStage and
// its tasks): the tunnel the character flies down, what they meet in it (specialobjects.c), and how the stage goes:
// four seconds of the title card with the character held still, then the checkpoint and the goal, each with its rings
// target. Short of it at the checkpoint, or at the goal, the stage fades out to the results; with the goal's, to the
// Chaos Emerald's scene.
//
// The tunnel is four quarters of one picture on layer 2 (the others flipped), 16 frames of it running by at the
// character's speed, over the background on layer 3; both move against the character's place, by up to 32 and 4 px.
// The stage's own colours run on two palette animations.

#include "special.h"

Special sp;

// what the original keeps in IWRAM from one special stage to the next, as nothing sets it again: the character's bob
// and sprite, the depths and matrices of the last frame and the animations loaded
static SpPlayer keptPlayer;
static int16_t keptDepths[16];
static int8_t keptMatrices[32];
static uint16_t keptLoaded[32];
static int keptMade;

#define START 240
#define END_WAIT 0x1A4
#define SE3 3
// the tunnel: its four quarters, 19 x 14 tiles each, around the middle of layer 2's map, the others flipped across, down
// and both; and the background on layer 3
enum { TILEMAP_BACKGROUND = 54, TILEMAP_TUNNEL = 55 };
static const uint16_t QUARTERS[4][4] = { { 0xC01A, 0x2, 136, 32 }, { 0xC39A, 0x9A, 0, 0 }, { 0xC800, 0x11A, 0, 0 }, { 0xCB80, 0x19A, 0, 0 } };
#define MIDDLE_X 0x88
#define MIDDLE_Y 0x20
#define PALETTE_ANIMS 0x340   // the stages' palette animations, one a stage, two variants each

static Background quarters[4], back;
static Sprite paletteSprites[2];

static void start_music(Task *t);
static void pause_menu(Task *t);
static void create_tunnel(void);
static int stage_target(int i) { return (int)rom_u16(OFFSET_SPECIAL_STAGE + 0x14C + sp.index * 4 + i * 2); }

/** CreateSpecialStage: the stage of spStageIndex, after the fall into it. */
void sp_stage_create(void) {
  if (!keptMade) {
    // the character's sprite as the console's start leaves its memory
    sprite_init(&keptPlayer.s);
    keptPlayer.s.prevAnim = 0; keptPlayer.s.prevVariant = 0; keptPlayer.s.animSpeed = 0;
    keptPlayer.s.hitboxes[0].index = 0;
    keptMade = 1;
  }
  sp_read_tables();
  memset(&sp, 0, sizeof sp);
  sp.index = spStageIndex;
  sp.targets[0] = stage_target(0); sp.targets[1] = stage_target(1);
  sp.layout = rom_ptr(OFFSET_SPECIAL_LAYOUTS + sp.index * 4);
  sp.paletteAnim = PALETTE_ANIMS + sp.index;
  sp.target = sp.targets[0];
  // SetPlayerControls with the save's button setting: A jumps and B attacks, or the other way round
  if (spGame.btnConfig == 1) { sp.jump = KEY_B; sp.attack = KEY_A; } else { sp.jump = KEY_A; sp.attack = KEY_B; }
  sp.player = &keptPlayer; sp.depths = keptDepths; sp.matrices = keptMatrices; sp.loaded = keptLoaded;
  // the count the rings counter blinks by starts at what its task's memory held (specialhud.c): at the stage's start the
  // line the fall's last streak was on (specialintro.c)
  sp.hudBlink = spStreaksLeft;
  sp.se3 = -1;
  sp_objects_reset();
  // (the original also takes Sonic's speed shoes away here; the act gives him a new start when he comes back)
  // sub_802D158
  create_task(start_music, NULL, 0x1000, 0, NULL);
  create_task(pause_menu, NULL, 0x1000, 0, NULL);
  sp_player_create();
  sp_spawner_create();
  create_tunnel();
  sp_rings_create();
  sp_title_card_create(1);
}

static void holding(Task *t);
static void watch(Task *t);
static void checkpoint_wait(Task *t);
static void goal_wait(Task *t);
static void fade_out(Task *t);

// Task_SpStageInitializeSomethingAndStartMusic: the music, and the character held still through the title card
static void start_music(Task *t) {
  sp.checkpoint.kind = 0; sp.checkpoint.timer = START; sp.checkpoint.blend = 0;
  t->main = holding;
  play_song(SONG_SPECIAL_STAGE);
}

// Task_802D238
static void holding(Task *t) {
  if (--sp.checkpoint.timer > 0) return;
  t->main = watch;
  sp.player->flags &= ~SP_FLAG_STILL;
  sp_clear_shared();
}

// Task_80299B0: the checkpoint or the goal reached: the character glides back to the middle, held still, for 420
// frames, and the message if they haven't enough rings
static void watch(Task *t) {
  SpPlayer *p = sp.player;
  if (sp.checkpoint.kind == SP_CHECKPOINT) {
    sp.checkpoint.timer = END_WAIT;
    p->flags |= SP_FLAG_STILL;
    p->end = SP_END_CHECKPOINT;
    t->main = checkpoint_wait;
    if (sp.targets[0] > sp.collected) sp_message_create(SP_MESSAGE_NOT_ENOUGH_RINGS);
  }
  if (sp.checkpoint.kind == SP_GOAL) {
    sp.checkpoint.timer = END_WAIT;
    p->flags |= SP_FLAG_STILL;
    p->end = SP_END_GOAL;
    t->main = goal_wait;
    if (sp.targets[1] > sp.collected) sp_message_create(SP_MESSAGE_NOT_ENOUGH_RINGS);
  }
}

// sub_8029A50: on, or the end
static void checkpoint_wait(Task *t) {
  if (--sp.checkpoint.timer > 0) return;
  if (sp.targets[0] <= sp.collected) {
    sp.checkpoint.kind = 0;
    sp.player->flags &= ~SP_FLAG_STILL;
    sp_clear_shared();
    t->main = watch;
  } else {
    sp.stageFlags |= 0x20;
    t->main = fade_out;
  }
}

// sub_802D274
static void goal_wait(Task *t) {
  if (--sp.checkpoint.timer > 0) return;
  sp.stageFlags |= 0x20;
  t->main = fade_out;
}

// Task_8029AC4: a fade to white over 64 frames, then the emerald's scene if the goal's target was reached, the results
// otherwise
static void fade_out(Task *t) {
  (void)t;
  sp.checkpoint.blend += 0x40;
  e.bldCnt = 0x3F9F;
  e.bldAlpha = 0;
  e.bldY = (uint16_t)I8(sp.checkpoint.blend);
  if (sp.checkpoint.blend < 0x1000) return;
  e.bldAlpha = 0x10;
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  e.bldCnt |= 0x3F1F;
  if (sp.checkpoint.kind == SP_CHECKPOINT) sp_results_create(0);
  else if (sp.target <= sp.collected) sp_emerald_scene_create();
  else sp_results_create(0);
}

// sub_802D680: Start opens the pause menu (specialpause.c), unless the stage is ending (gStageFlags 0x20) or a demo
// plays (0x40). Opened while there is no rings counter (before the stage's first, or in the checkpoint's title card),
// its task's memory is where the next counter's task is made, and its sign's y is left where the counter's blink count
// is (specialhud.c); with the counter running, other tasks have used that memory by then.
static void pause_menu(Task *t) {
  (void)t;
  int flags = sp.stageFlags;
  if (!(flags & 0x20) && (e.pressed & KEY_START) && !(flags & 0x40)) {
    sp_pause_menu_create();
    if (!sp_hud_runs()) sp.hudBlink = SP_SIGN_Y;
  }
}

// the layers' scroll: the tunnel by the whole move, the background by an eighth of it, in tiles
static void scroll(void) {
  int x = MIDDLE_X - sp.bg.x, y = MIDDLE_Y + sp.bg.y;
  e.bgScroll[6] = (uint16_t)((x < 0 ? x + 7 : x) >> 3); e.bgScroll[7] = (uint16_t)((y < 0 ? y + 7 : y) >> 3);
  e.bgScroll[4] = (uint16_t)x; e.bgScroll[5] = (uint16_t)y;
}

static void tunnel_start(Task *t);
static void tunnel(Task *t);
static void palette_step(Task *t);

// sub_8029B74: the layers, the tunnel and its task, and the stage's two palette animations
static void create_tunnel(void) {
  e.dispCnt = 0x1C40;
  e.bgCnt[1] = 0x201; e.bgCnt[2] = 0x5806; e.bgCnt[3] = 0x1C0B;
  sp.bg.x = 0; sp.bg.y = 0;
  scroll();
  for (int i = 0; i < 4; i++) {
    Background *b = &quarters[i];
    background_init(b);
    b->graphics.dest = 0x4000; b->layoutVram = QUARTERS[i][0]; b->tilemapId = TILEMAP_TUNNEL;
    b->targetTilesX = 19; b->targetTilesY = 14; b->flags = QUARTERS[i][1];
    b->scrollX = (int16_t)QUARTERS[i][2]; b->scrollY = (int16_t)QUARTERS[i][3];
    b->prevScrollX = 0x7FFF; b->prevScrollY = 0x7FFF;
  }
  background_init(&back);
  back.graphics.dest = 0x8000; back.layoutVram = 0xE000; back.tilemapId = TILEMAP_BACKGROUND;
  back.targetTilesX = 32; back.targetTilesY = 32; back.flags = 3; back.prevScrollX = 0x7FFF; back.prevScrollY = 0x7FFF;
  for (int i = 0; i < 4; i++) draw_background(&quarters[i]);
  draw_background(&back);
  create_task(tunnel_start, NULL, 0x1200, 0, NULL);
  // the big lights across, then the small diagonal ones
  for (int variant = 0; variant < 2; variant++) {
    Sprite *s = &paletteSprites[variant];
    sprite_init(s);
    s->graphics.dest = 0; s->graphics.anim = (uint16_t)sp.paletteAnim; s->variant = (uint8_t)variant;
    create_task(palette_step, s, 0x2000, 0, NULL);
  }
}

// Task_802D2BC
static void tunnel_start(Task *t) {
  e.bldCnt = 0; e.bldY = 0;
  sp.bg.frame = 0; sp.bg.unk13 = 8;
  tunnel(t);
  t->main = tunnel;
}

// sub_8029CDC: the tunnel moved against the character's place, and its frame on by their speed
static void tunnel(Task *t) {
  (void)t;
  const SpPlayer *p = sp.player;
  sp.bg.x = s16(-(sp_div(p->x, 134) * 32) >> 8);
  sp.bg.y = s16(-(sp_div(p->y, 94) << 5) >> 8);
  if (sp.bg.y < -0x20) sp.bg.y = -0x20;
  if (sp.bg.y > 0x20) sp.bg.y = 0x20;
  if (sp.bg.x < -0x20) sp.bg.x = -0x20;
  if (sp.bg.x > 0x20) sp.bg.x = 0x20;
  scroll();
  sp.bg.frame = ((p->speed >> 9) + sp.bg.frame) & 0x3F;
  for (int i = 0; i < 4; i++) quarters[i].tilemapId = (uint16_t)(TILEMAP_TUNNEL + (sp.bg.frame >> 2));
  quarters[0].flags &= ~0x8;
  for (int i = 0; i < 4; i++) draw_background(&quarters[i]);
}

// Task_StagePaletteLoader: the animation's colours into the backgrounds' palette, until it ends
static void palette_step(Task *t) {
  if (update_sprite((Sprite *)t->data, 1) == 0) destroy_task(t);
}

// --- the stage's sounds (stage.js createMusic) ---------------------------------------------------------------------
// The bumper trick's jingle (CreateSpStageTrickSoundTask) stops the music and plays on the third sound effects' player,
// and when it has ended brings the music back where it stopped, fading in. The jingle doesn't start again over itself.

/** A song, noting the one the third sound effects' player last started (the act's sounds aren't counted). */
void sp_play(int song) {
  if (gba_sound_song_player(song) == SE3) sp.se3 = song;
  play_song(song);
}
/** A sound effect, off while the trick jingle plays. */
void sp_se(int song) { if (!sp.muted) sp_play(song); }

static struct { int frames, length; } jingle;
static void jingle_wait(Task *t);
// Task_CallSpStageTrickTask, then Task_SpStageTrick from the next frame
static void jingle_start(Task *t) { t->main = jingle_wait; }
static void jingle_wait(Task *t) {
  if (++jingle.frames < jingle.length) return;
  int bgm = gba_sound_song_player(SONG_SPECIAL_STAGE);
  gba_sound_start_or_continue(SONG_SPECIAL_STAGE);
  gba_sound_volume(bgm, 0xFF, 4);
  gba_sound_fade_in(bgm, 4);
  destroy_task(t);
  sp.muted = 0;
}

/** The bumper trick's jingle. */
void sp_trick_jingle(void) {
  gba_sound_stop_player(gba_sound_song_player(SONG_SPECIAL_STAGE));
  if (sp.se3 == SONG_SPECIAL_STAGE_TRICK) return;
  static int length = -1;
  if (length < 0) length = gba_sound_song_frames(SE3, SONG_SPECIAL_STAGE_TRICK);
  jingle.frames = 0; jingle.length = length;
  create_task(jingle_start, &jingle, 0x3000, 0, NULL);
  sp.muted = 0xFF;
  sp.se3 = SONG_SPECIAL_STAGE_TRICK;
  gba_sound_start_on(SE3, SONG_SPECIAL_STAGE_TRICK);
}
