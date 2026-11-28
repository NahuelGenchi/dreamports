// The spin dash, its dust and what the camera does in the air, in C.
#include "stage_init.h"
#include "sprite.h"

struct MP2KPlayerState;
void m4aMPlayImmInit(struct MP2KPlayerState *mplayInfo);
void m4aMPlayPitchControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, s16 pitch);

/** A player of the stage's sound, and the song each sound is, as the cartridge lists them. */
struct SpindashMPlayEntry {
  /* 0x00 */ struct MP2KPlayerState *info;
  /* 0x04 */ void *track;
  /* 0x08 */ u8 unk8;
  /* 0x0A */ u16 unkA;
};

struct SpindashSongEntry {
  /* 0x00 */ const void *header;
  /* 0x04 */ u16 ms;
  /* 0x06 */ u16 me;
};

extern const struct SpindashMPlayEntry gStageMPlayTable[];
extern const struct SpindashSongEntry gStageSongTable[];
// how fast a spin dash lets go, by how far it was revved: on land and under water
extern const s16 gUnknown_084A7084[];
extern const s16 gUnknown_084A7096[];

void PlayerSetHeight(struct StagePlayer *p, s32 height);
void PlayerClampToStageBounds(struct StagePlayer *p);
void PlayerFloorCollision(struct StagePlayer *p);
void PlayerUpdateAirInput(struct StagePlayer *p);
void PlayerUpdateAirTimer(struct StagePlayer *p);
struct Task *PlayerCreateSpindashDust(void);
void Task_SpindashDust(void);
void TaskDestructor_SpindashDust(struct Task *t);

/** PlayerCreateSpindashDust, 0x08040614: the dust a spin dash kicks up, a sprite task of its own. */
struct Task *PlayerCreateSpindashDust(void) {
  struct Task *t = TaskCreate(CODE(Task_SpindashDust), sizeof(struct Sprite), 0x4001, 0, CODE(TaskDestructor_SpindashDust));
  struct Sprite *s = TASK_DATA(t);

  s->graphics.dest = VramMalloc(20);
  s->graphics.size = 0;
  s->graphics.anim = 746;
  s->variant = 0;
  s->prevVariant = 0xFF;
  s->oamFlags = 0x200;
  s->qAnimDelay = 0;
  s->animSpeed = 16;
  s->palId = 0;
  s->frameFlags = 0x2000;
  return t;
}

/** PlayerCheckJump, 0x08044070: the spin dash: crouched, the jump button starts it; while down is held each press revs it
 *  higher and the rev falls slowly away; let go, the player rolls off at the speed it reached. Then the edges of the
 *  level and the floor. */
s32 PlayerCheckJump(struct StagePlayer *p) {
  if (!(p->moveState & 0x400)) {
    if ((s8)p->unk40 != 2 || !(p->unk3A & gUnknown_030060E0[0])) {
      return 0;
    }

    p->unk40 = 6;
    m4aSongNumStart(109);
    PlayerCreateSpindashDust();
    p->moveState |= 0x400;
#ifdef MATCHING
    {
      // the rev starts from a zero of its own, as the console's compiler wrote it, where this one would store the
      // register the test above left at zero
      s16 none;
      asm("mov %0, #0" : "=r"(none));
      p->unk16 = none;
    }
#else
    p->unk16 = 0;
#endif
    PlayerSetHeight(p, 9);
    p->unkE = 6;
    p->unkF = 9;
  } else {
    if (!(p->unk38 & 0x80)) {
      s32 speed;

      p->moveState &= ~0x400;
      speed = !(p->moveState & 0x2000) ? gUnknown_084A7084[(s16)p->unk16 >> 8] : gUnknown_084A7096[(s16)p->unk16 >> 8];

      if (p->playerId == 0) {
        gStageCamera.unk1C = 10;
      }

      if (p->moveState & 1) {
        speed = -speed;
      }

      p->speedGroundX = speed;
      p->moveState |= 4;
      m4aSongNumStart(110);
      p->unk40 = 5;
    } else {
      s16 rev = p->unk16;
      s16 before = rev;

      if (before != 0) {
        rev = before - ((rev << 3) >> 8);
        if (rev <= 0) {
          rev = 0;
        }
      }

      if ((s8)p->unk40 != 7) {
        p->unk40 = 6;
      }

      if (p->unk3A & gUnknown_030060E0[0]) {
        struct MP2KPlayerState *info;

        m4aSongNumStart(109);
        info = gStageMPlayTable[gStageSongTable[109].ms].info;
        m4aMPlayImmInit(info);
        m4aMPlayPitchControl(info, 0xFFFF, rev & ~0x7F);

        if (gGameMode != 6) {
          if (p->character == 0 || p->character == 2) {
            p->unk40 = 7;
          }
        }

        rev += 0x200;
        rev = rev > 0x800 ? rev : 0x800;
      }
      p->unk16 = rev;
    }

    PlayerUpdateAirInput(p);
    PlayerUpdateAirTimer(p);
  }

  PlayerClampToStageBounds(p);
  PlayerFloorCollision(p);
  return 1;
}

/** PlayerUpdateAirInput, 0x08047238: the main player keeps the camera from looking up or down a while. */
void PlayerUpdateAirInput(struct StagePlayer *p) {
  if (p->playerId == 0) {
    p->unk15 = 120;
  }
}

/** PlayerUpdateAirTimer, 0x0804724C: for the main player, the camera's look up or down eases back to the middle, two
 *  pixels a frame. */
void PlayerUpdateAirTimer(struct StagePlayer *p) {
  if (p->playerId == 0) {
    if (gStageCamera.unk22 > 0) {
      gStageCamera.unk22 -= 2;
    } else if (gStageCamera.unk22 < 0) {
      gStageCamera.unk22 += 2;
    }
  }
}
