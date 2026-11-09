// fighters.js in C: a fight's fighters as they load and draw, rewritten from the original's instructions, with the
// decompilation's src/unknown_080007fc.c as a guide: their records and colours, the frames of their animations copied to
// VRAM, the four sprites and the shadow each one queues, and the effects they start.

#include "game.h"

#define CHARACTER_ SETUP + 20
#define OTHER_COLOURS SETUP + 24
#define THE_PLAYER 0x03001380u
#define LINKED 0x0300138Cu
#define FACING_ 0x03001370u

#define FIGHTER_SIZE 252
#define COLOURS_ 0x03001D0Cu
#define SPRITE_PALETTES 0x05000200u
#define TILES 0x06010000u

#define CHOICES 0x030013B0u
#define CHOICE_SIZE 156
#define COLOUR_SET 150
#define COLOUR_SET_SIZE 27
#define SPARE_COLOURS 0x0847AA18u

#define SHEET_9 0x08787D18u
#define FRAME_BYTES 1152

#define ANIM_ID 0x030030F8u
#define ANIM_SET 0x03003120u
#define ANIM_COUNT 0x03003108u
#define ANIM_CURSOR 0x03003110u
#define ANIM_OFFSET_X 0x03003100u
#define ANIM_OFFSET_Y 0x03003118u
#define ANIM_SCRIPTS 0x08ED68A8u

#define EFFECTS 0x030017D0u
#define EFFECT_SIZE 68
#define EFFECT_COUNT_ 12
#define SLOTS_ 0x030028C0u
#define SLOT_COUNT 27
#define LAST_EFFECT 0x03002684u
#define EFFECT_SIZES 0x0806B414u

#define BRAINS 0x03003DB0u
#define BRAIN_SIZE 24
#define LEVEL 0x03003E10u
#define SEED 0x0300019Cu

static uint32_t fighter(int i) { return FIGHTERS + (uint32_t)i * FIGHTER_SIZE; }
static uint32_t coloursOf(int i) { return COLOURS_ + (uint32_t)i * FIGHTER_SIZE; }
static uint32_t brain(int i) { return BRAINS + (uint32_t)i * BRAIN_SIZE; }

static const uint32_t SHEETS[9][2] = {
  {0x0847AFD8, 0x08787D18}, {0x08528418, 0x08835158}, {0x084CADF8, 0x087D7B38},
  {0x0858D838, 0x0889A578}, {0x085F3E58, 0x08900B98}, {0x08636478, 0x089431B8},
  {0x086F6AB8, 0x08A037F8}, {0x08681A98, 0x0898E7D8}, {0x087336D8, 0x08A40418},
};

static const uint32_t CHARACTER_COLOURS[9] = {
  0x0847AFB8, 0x085283F8, 0x084CADD8, 0x0858D818, 0x085F3E38, 0x08636458, 0x086F6A98, 0x08681A78, 0x087336B8,
};
#define COLOURS_19 0x087822D8u
#define COLOURS_9_10 0x08787CF8u
#define COLOURS_12_TO_16 0x0847AB78u
#define COLOURS_17_18 0x0847AB58u

void chosenColours(int i) {
  uint32_t choice = CHOICES + (uint32_t)i * CHOICE_SIZE;
  uint32_t set = (uint32_t)read8(choice + COLOUR_SET) * COLOUR_SET_SIZE + choice;
  for (int n = 3; n <= 13; n++) {
    int from = n <= 6 ? 93 : n <= 10 ? 94 : 95;
    uint8_t row = read8(set + from);
    write16(coloursOf(i) + n * 2, read16(SPARE_COLOURS + ((uint32_t)row * 16 + n) * 2));
  }
}

void loadColours(void) {
  for (int i = 0; i < 4; i++) {
    uint8_t who = read8(CHARACTER_ + i), other = read8(OTHER_COLOURS + i);
    uint32_t to = coloursOf(i);
    if (who <= 10 || who == 19) {
      if (other == 0) {
        if (who <= 8) copy16(CHARACTER_COLOURS[who], to, 16);
        else if (who == 19) copy16(COLOURS_19, to, 16);
        if (who == 9 || who == 10) {
          copy16(COLOURS_9_10, to, 16);
          uint32_t choice = CHOICES + (uint32_t)i * CHOICE_SIZE;
          uint8_t row = read8(choice + read8(choice + COLOUR_SET) * COLOUR_SET_SIZE + 89);
          write16(fighter(i) + 232, read16(SPARE_COLOURS + ((uint32_t)row * 16 + 14) * 2));
          write16(fighter(i) + 234, read16(SPARE_COLOURS + ((uint32_t)row * 16 + 15) * 2));
          chosenColours(i);
        }
      } else if (other == 1) {
        copy16(COLOURS_9_10, to, 16);
        write16(to + 28, read16(SPARE_COLOURS + 28 + (uint32_t)i * 32));
        write16(to + 30, read16(SPARE_COLOURS + 30 + (uint32_t)i * 32));
      } else copy16(COLOURS_12_TO_16, to, 16);
    } else if (who >= 12 && who <= 16) copy16(COLOURS_12_TO_16, to, 16);
    else if (who == 17 || who == 18) copy16(COLOURS_17_18, to, 16);
  }
}

void showColours(int i, int character, int flash) {
  uint32_t f = fighter(i), to = SPRITE_PALETTES + (uint32_t)i * 32;
  write8(f + 196, (uint8_t)character);
  uint16_t state = read16(f + 20);
  if ((flash & 0xFF) != 0 && (g.vblanks & 4) != 0 && state != 254 && state != 255) {
    write16(to, 0);
    for (int n = 1; n <= 15; n++) {
      uint16_t v = read16(coloursOf(i) + n * 2);
      int a = ((v >> 10) & 31) * 2; if (a > 31) a = 31;
      int b = ((v >> 5) & 31) * 2; if (b > 31) b = 31;
      int d = (v & 31) * 3; if (d > 31) d = 31;
      write16(to + n * 2, (uint16_t)((a << 10) | (b << 5) | d));
    }
    write8(f + 150, 1);
  } else copy16(coloursOf(i), to, 16);
}

void resetFighter(int i) {
  uint32_t f = fighter(i);
  static const uint8_t bytes0[] = {
    36, 16, 17, 18, 50, 143, 142, 145, 146, 159, 102, 107, 106, 108, 112, 109, 110, 113, 126, 185, 186, 187, 192, 28, 29,
    30, 199, 156, 157, 158, 138, 188, 190, 172, 198, 151, 244,
  };
  static const uint16_t halves0[] = {
    32, 34, 38, 40, 42, 44, 46, 48, 52, 160, 162, 96, 98, 100, 104, 194, 24, 26, 54, 62, 56, 64, 58, 66, 60, 68, 166, 168,
    170, 174, 176, 240, 242,
  };
  for (unsigned n = 0; n < sizeof bytes0; n++) write8(f + bytes0[n], 0);
  for (unsigned n = 0; n < sizeof halves0 / sizeof halves0[0]; n++) write16(f + halves0[n], 0);
  static const uint8_t words0[] = {180, 72, 76, 80, 84, 116, 120};
  for (unsigned n = 0; n < sizeof words0; n++) write32(f + words0[n], 0);
  for (int n = 0; n <= 9; n++) write8(f + 128 + n, 0);
  write16(f + 20, 6);
  write8(f + 37, 4);
  write16(f + 4, 80);
  write16(f + 10, 80);
  write8(f + 184, 2);
  write16(f + 164, 0xFFF);
  write8(f + 124, 255);
  write8(f + 125, 255);
  write8(f + 191, (uint8_t)read16(0x03001B28));
  write8(f + 23, read8(f + 196));
  write8(f + 127, 15);
  write32(f + 180, read32(f + 180) & 0xFFBFFFFF);
  int player = (int)read32(THE_PLAYER);
  if (read8(LINKED) == 0 || i == player || (i == player + 2 && read8(0x0300163C + i) != 0)) write8(f + 199, 12);
}

void clearFighterCounters(int i) {
  uint32_t at = 0x03001B30 + (uint32_t)i * 64;
  write8(at + 60, 0);
  for (int n = 0; n <= 9; n++) {
    write16(at + n * 2, 0);
    write16(at + 20 + n * 2, 0);
    write16(at + 40 + n * 2, 0);
  }
  for (int n = 0; n < 4; n++) write16(fighter(n) + 200, 0);
}

void resetFighters(void) {
  for (int i = 0; i < 4; i++) clearFighterCounters(i);
  write16(0x03001B28, 100);
  for (int i = 0; i < 4; i++) resetFighter(i);
  uint32_t places = 0x0806B2FC + (uint32_t)read8(0x03002CB0) * 16;
  for (int i = 0; i < 4; i++) {
    uint32_t f = fighter(i);
    static const uint8_t zeroBytes[] = {147, 149, 150, 144, 154, 155, 141, 236};
    for (unsigned n = 0; n < sizeof zeroBytes; n++) write8(f + zeroBytes[n], 0);
    write16(f + 152, 0);
    write16(f + 238, 0);
    uint16_t x = read16(places + (uint32_t)i * 4), y = read16(places + (uint32_t)i * 4 + 2);
    write16(f, x);
    write16(f + 6, x);
    write16(f + 2, y);
    write16(f + 8, y);
    int even = (i & 1) == 0;
    write8(f + 36, even ? 6 : 4);
    write8(f + 37, even ? 6 : 4);
    write8(f + 16, even ? 1 : 0);
    write8(f + 18, even ? 1 : 0);
  }
}

void loadFighterFrames(void) {
  for (int i = 0; i < 4; i++) {
    if (read8(CHARACTER_ + i) == 255) continue;
    uint32_t f = fighter(i);
    uint8_t character = read8(f + 196);
    uint32_t sheet = f + 248;
    if (read8(OTHER_COLOURS + i) == 0) {
      if (character <= 8) write32(sheet, SHEETS[character][0]);
      else if (character == 19) write32(sheet, 0x087822F8);
      else if (character == 10 || (character >= 12 && character <= 16)) write32(sheet, SHEET_9);
      else if (character == 17 || character == 18) write32(sheet, SHEETS[7][0]);
      else {
        uint8_t copied = read8(CHOICES + (uint32_t)i * CHOICE_SIZE + reads8(f + 22));
        if (copied <= 8) write32(sheet, SHEETS[copied][1]);
        else if (copied <= 11) write32(sheet, SHEET_9);
        else if (copied >= 20 && copied <= 28) write32(sheet, SHEETS[copied - 20][1]);
      }
    } else if (character <= 8) write32(sheet, SHEETS[character][1]);
    if (read8(f + 149) & 1) showColours(i, read8(f + 196), 1);
    else if (read8(f + 150) != 0) {
      showColours(i, read8(f + 196), 0);
      write8(f + 150, 0);
    }
    if (read8(SETUP + 135) != 0) {
      write8(f + 147, 0);
      write8(f + 149, 0);
      showColours(i, read8(f + 196), 0);
      write8(f + 150, 0);
    }
  }
  for (int i = 0; i < 4; i++) {
    uint16_t asked = read16(fighter(i) + 164);
    if (asked != 0xFFF) queueFighterFrame(read32(fighter(i) + 248), i, asked);
  }
  for (int i = 0; i < 4; i++) write16(fighter(i) + 164, 0xFFF);
}

void startFighterEffects(void) {
  for (int i = 0; i < 4; i++) {
    uint32_t f = fighter(i);
    uint16_t effect = read16(f + 170);
    if (effect == 0 || read8(CHARACTER_ + i) == 255) continue;
    uint8_t mode = read8(f + 36);
    int16_t reach = read16(f + 166);
    int32_t dx = 0, dy = 0;
    if (mode == 4) dx = reach;
    else if (mode == 6) dx = -reach;
    else if (mode == 8) dy = reach;
    else if (mode == 2) dy = -reach;
    else if (mode <= 9) {
      uint8_t facing = read8(f + 16), way = read8(f + 159);
      int sign = facing == 0 ? 1 : -1;
      if (way == 0) dx = sign * reach;
      else if (way == 1) dx = -sign * reach;
      else if (way == 2) dy = sign * reach;
      else if (way == 3) dy = -sign * reach;
    }
    startEffect(effect, mode, s16(s16(dx) + read16(f)), s16(s16(dy) + read16(f + 2)),
      s16(read16(f + 168) + read16(f + 4)), 0, 0, 0, read8(f + 172), i, read8(f + 149));
    write8(f + 172, 0);
    write16(f + 170, 0);
  }
}

void drawFighters(int count) {
  uint16_t height = 0, palette = 0, flip = 0;
  int player = (int)read32(THE_PLAYER);
  for (int i = 0; i < (count & 0xFF); i++) {
    uint32_t f = fighter(i);
    uint16_t state = read16(f + 20);
    uint8_t other = read8(f + 23);
    int hidden = state == 254 || (state == 255 && i != player) || (other == 2 && state == 278 && i != player)
      || (other == 3 && state == 0x115 && i != player) || read8(CHARACTER_ + i) == 255;
    if (!hidden) {
      int x, y;
      viewFromArena(reads16(f), reads16(f + 2), &x, &y);
      screenFromView(x, y, &x, &y);
      uint16_t depth = u16(y - 6), shadowX = u16(x - 16), shadowY = u16(y - 4);
      uint8_t facing = read8(f + 16);
      if (facing == 0) {
        x = s16(x - (read16(f + 160) + 24));
        y = s16(read16(f + 162) - 40 + y);
      } else if (facing == 1) {
        x = s16(x + (read16(f + 160) - 24));
        y = s16(read16(f + 162) - 40 + y);
      }
      write16(f + 12, (uint16_t)x);
      write16(f + 14, (uint16_t)(y - read16(f + 4)));
      int top = read8(0x030016D0) - 64, bottom = read8(0x030017C0);
      int across = u16(x + 64) <= 304, lifted = reads16(f + 14);
      if (across && lifted <= bottom && lifted >= top) {
        palette = (uint16_t)i;
        flip = read8(f + 16);
        height = read16(f + 4);
        uint16_t tile = (uint16_t)(i * 36);
        uint32_t word3 = (uint32_t)palette | ((uint32_t)flip << 24);
        if (flip == 0) {
          queueSprite(u16(x) | ((uint32_t)u16(y) << 16), height | ((uint32_t)depth << 16), tile, word3 | (11u << 8));
          queueSprite(u16(x) | ((uint32_t)u16(y + 32) << 16), height | ((uint32_t)depth << 16), tile + 16, word3 | (12u << 8));
          queueSprite(u16(x + 32) | ((uint32_t)u16(y) << 16), height | ((uint32_t)depth << 16), tile + 24, word3 | (13u << 8));
          queueSprite(u16(x + 32) | ((uint32_t)u16(y + 32) << 16), height | ((uint32_t)depth << 16), tile + 32, word3 | (14u << 8));
        } else if (flip == 1) {
          queueSprite(u16(x) | ((uint32_t)u16(y) << 16), height | ((uint32_t)depth << 16), tile + 24, word3 | (13u << 8));
          queueSprite(u16(x) | ((uint32_t)u16(y + 32) << 16), height | ((uint32_t)depth << 16), tile + 32, word3 | (14u << 8));
          queueSprite(u16(x + 16) | ((uint32_t)u16(y) << 16), height | ((uint32_t)depth << 16), tile, word3 | (11u << 8));
          queueSprite(u16(x + 16) | ((uint32_t)u16(y + 32) << 16), height | ((uint32_t)depth << 16), tile + 16, word3 | (12u << 8));
        }
      }
      if (across && y <= bottom && y >= top && read16(f + 20) != 255) {
        int16_t over = reads16(f + 4), ground = reads16(f + 52);
        int size = over < ground + 20 ? 0 : over < ground + 40 ? 1 : over < ground + 60 ? 2 : 3;
        height = read16(f + 52);
        palette = 4;
        queueSprite(u16(shadowX) | ((uint32_t)u16(shadowY) << 16), height | ((uint32_t)depth << 16),
          (uint16_t)(size * 8 + 144), (uint32_t)palette | (20u << 8) | ((uint32_t)flip << 24));
      }
    }
    write8(f + 17, read8(f + 16));
    write8(f + 16, read8(f + 18));
    int remote = read16(f + 20) == 55 && read8(LINKED) != 0 && i != player
      && !(i == player + 2 && read8(0x0300163C + i) != 0);
    if (remote) continue;
    uint8_t mode = read8(f + 36), view = read8(FACING_);
    if (view == 0 || view == 1) {
      if (mode == 4 || mode == 7 || mode == 1) write8(f + 18, view);
      else if (mode == 6 || mode == 9 || mode == 3) write8(f + 18, view ^ 1);
    } else if (view == 2 || view == 3) {
      if (mode >= 1 && mode <= 3) write8(f + 18, view - 2);
      else if (mode >= 7 && mode <= 9) write8(f + 18, 3 - view);
    }
  }
  loadFighterFrames();
}

void followFighterTarget(int i) {
  if ((i & 0xFF) > 3) return;
  uint32_t f = fighter(i);
  uint8_t partner = read8(f + 125);
  int known = partner <= 3;
  uint32_t p = known ? fighter(partner) : 0;
  if (read8(f + 110) != 0) {
    if (known) {
      write16(0x03001374, (reads16(f) + reads16(p)) >> 1);
      write16(0x03001B24, (reads16(f + 2) + reads16(p + 2)) >> 1);
    }
    write16(0x03002100, read16(f + 4) << 1);
  } else {
    if (read8(f + 112) != 0) {
      if (known) {
        uint32_t higher = reads16(f + 4) > reads16(p + 4) ? f : p;
        write16(0x03002100, read16(higher + 4) << 1);
      }
    } else write16(0x03002100, read16(f + 4) << 1);
    write16(0x03001374, read16(f));
    write16(0x03001B24, read16(f + 2));
  }
  int16_t angle = cameraAngle();
  if (u16(angle - 0x400) > 0x1800) write8(FACING_, 0);
  else if (u16(angle - 0x401) <= 0x7FE) write8(FACING_, 2);
  else if (u16(angle - 0xC01) <= 0x7FE) write8(FACING_, 1);
  else if (u16(angle - 0x1401) <= 0x7FE) write8(FACING_, 3);
}

int stepAnimation(int set, int id, int loops, int tiles, int player) {
  int two = player * 2;
  int character = set & 0xFF;
  int copying = character == 9;
  if (copying) character = read8(CHOICES + (uint32_t)player * CHOICE_SIZE + slotOfAnimation(id));
  uint32_t script = read32(ANIM_SCRIPTS + (uint32_t)slotOfAnimation(id) * 4 + (uint32_t)character * 280);
  if (read16(ANIM_ID + two) != u16(id) || read8(ANIM_SET + player) != character || reads16(ANIM_COUNT + two) == 0) {
    write16(ANIM_ID + two, (uint16_t)id);
    write8(ANIM_SET + player, (uint8_t)character);
    write16(ANIM_COUNT + two, 0);
    write16(ANIM_CURSOR + two, 0);
    write16(ANIM_OFFSET_X + two, 0);
    write16(ANIM_OFFSET_Y + two, 0);
  }
  #define COUNTED() do { write16(ANIM_COUNT + two, read16(ANIM_COUNT + two) + 1); return 1; } while (0)
  if (reads16(ANIM_COUNT + two) < 0) COUNTED();
  #define WORD() read32(script + (uint32_t)read16(ANIM_CURSOR + two) * 4)
  while ((WORD() >> 16) != 0xFFF0) {
    write16(ANIM_CURSOR + two, read16(ANIM_CURSOR + two) + 1);
    if (read16(ANIM_CURSOR + two) > 254) return 255;
  }
  if ((WORD() & 0xFFFF) != reads16(ANIM_COUNT + two)) COUNTED();
  g.cycles += 160;
  write16(ANIM_CURSOR + two, read16(ANIM_CURSOR + two) + 1);
  if ((WORD() >> 16) == 0xFFF0) COUNTED();
  for (;;) {
    uint32_t command = WORD();
    uint32_t kind = command >> 16, value = command & 0xFFFF;
    if (kind == 0x1100) write16(ANIM_OFFSET_X + two, (uint16_t)value);
    else if (kind == 0x1200) write16(ANIM_OFFSET_Y + two, (uint16_t)value);
    else if (kind == 0x00F0 || kind == 0xFFFE) {
      int restarted = reads16(ANIM_COUNT + two) != 0;
      write16(ANIM_CURSOR + two, 0);
      write16(ANIM_COUNT + two, (uint16_t)(1 - (loops & 0xFF)));
      return restarted ? 0 : 255;
    } else if (kind == 0x0100) {
      // the original's default path for this command, whose work no other script here spends
      g.cycles += 270;
    } else if (kind == 0x1000) {
      g.cycles += 270;
      int other = read8(OTHER_COLOURS + player) != 0 || copying;
      uint32_t sheet = 0;
      int row = character >= 20 ? character - 20 : character;
      if (row <= 8 && character <= 28) sheet = SHEETS[row][other ? 1 : 0];
      else if (character == 9 || character == 10) sheet = SHEET_9;
      int frame = s16(value);
      if (character == 1 && u16(id) == 19) {
        write16(ANIM_OFFSET_X + two, read16(0x08055800 + (uint32_t)(frame * 2) - 0x158) - 8);
        write16(ANIM_OFFSET_Y + two, read16(0x0805587E + (uint32_t)(frame * 2) - 0x158));
      } else if (character == 1 && u16(id) == 20) {
        write16(ANIM_OFFSET_X + two, read16(0x08055994 + (uint32_t)(frame * 2) - 0x1D8) - 8);
        write16(ANIM_OFFSET_Y + two, read16(0x080559D8 + (uint32_t)(frame * 2) - 0x1D8));
      } else if (character == 2 && u16(id) == 21) {
        write16(ANIM_OFFSET_X + two, read16(0x080576E8 + (uint32_t)(frame * 2) - 0x170));
      }
      queueFrameAtTile(sheet, tiles, (int)value);
    }
    write16(ANIM_CURSOR + two, read16(ANIM_CURSOR + two) + 1);
    if (read16(ANIM_CURSOR + two) > 254) return 255;
    if ((WORD() >> 16) == 0xFFF0) COUNTED();
  }
  #undef WORD
  #undef COUNTED
}

int slotOfAnimation(int id) {
  uint16_t animation = u16(id);
  if (animation > 0x235) return 0;
  return read16(read32(0x0800B0BC + (uint32_t)animation * 4)) & 0xFF;
}

void clearEffect(int n) {
  uint32_t e = EFFECTS + (uint32_t)(n & 0xFF) * EFFECT_SIZE;
  for (int slot = 0; slot < 4; slot++) {
    uint8_t held = read8(e + slot);
    if (held != 255) write8(SLOTS_ + held, 0);
    write8(e + slot, 255);
  }
  write8(e + 52, 255);
  static const uint8_t zeroBytes[] = {4, 64, 5, 6, 16, 17, 24, 51, 65, 66};
  for (unsigned i = 0; i < sizeof zeroBytes; i++) write8(e + zeroBytes[i], 0);
  static const uint8_t zeroHalves[] = {8, 10, 12, 14, 58, 60, 62, 18, 20, 22, 34, 42, 36, 44, 38, 46, 40, 48, 56};
  for (unsigned i = 0; i < sizeof zeroHalves; i++) write16(e + zeroHalves[i], 0);
  static const uint8_t ffHalves[] = {26, 28, 30, 32};
  for (unsigned i = 0; i < sizeof ffHalves; i++) write16(e + ffHalves[i], 0xFFFF);
  write8(e + 53, 8);
  write8(e + 50, 1);
}

void clearEffects(void) {
  for (int n = 0; n < EFFECT_COUNT_; n++) clearEffect(n);
  for (int slot = 0; slot < SLOT_COUNT; slot++) write8(SLOTS_ + slot, 0);
  write8(LAST_EFFECT, 0);
}

void startEffect(int effect, int mode, int x, int y, int height, int a, int b, int d, int e, int owner, int f) {
  uint16_t id = u16(effect);
  int who = owner & 0xFF;
  uint32_t sizes = EFFECT_SIZES + id;
  for (int n = read8(LAST_EFFECT); n <= 11; n++) {
    uint32_t r = EFFECTS + (uint32_t)n * EFFECT_SIZE;
    if (read16(r + 56) != 0) continue;
    int taken = 0;
    for (int slot = 0; slot <= 27 - read8(sizes);) {
      if (read8(SLOTS_ + slot) == 0) {
        write8(r + taken, (uint8_t)slot);
        write8(SLOTS_ + slot, 1);
        taken = (taken + 1) & 0xFF;
      }
      int need = read8(sizes);
      if (taken == need) slot = (28 - need) & 0xFF;
      slot = (slot + 1) & 0xFF;
    }
    write8(r + 52, 255);
    write8(r + 4, 0);
    write8(r + 5, read8(fighter(who) + 16));
    write8(r + 6, 0);
    write16(r + 8, (uint16_t)a);
    write16(r + 10, (uint16_t)b);
    write16(r + 12, (uint16_t)d);
    write16(r + 14, 0);
    write16(r + 58, (uint16_t)x);
    write16(r + 60, (uint16_t)y);
    write16(r + 62, (uint16_t)height);
    static const uint8_t zeroBytes[] = {16, 17, 24, 54, 55, 66};
    for (unsigned i = 0; i < sizeof zeroBytes; i++) write8(r + zeroBytes[i], 0);
    static const uint8_t zeroHalves[] = {18, 20, 22, 34, 42, 36, 44, 38, 46, 40, 48};
    for (unsigned i = 0; i < sizeof zeroHalves; i++) write16(r + zeroHalves[i], 0);
    static const uint8_t ffHalves[] = {26, 28, 30, 32};
    for (unsigned i = 0; i < sizeof ffHalves; i++) write16(r + ffHalves[i], 0xFFFF);
    write8(r + 50, read8(sizes));
    write8(r + 53, (uint8_t)who);
    write8(r + 51, (uint8_t)e);
    write16(r + 56, id);
    write8(r + 64, (uint8_t)mode);
    write8(r + 65, (uint8_t)f);
    write8(LAST_EFFECT, (uint8_t)n);
    break;
  }
  uint32_t THE_COUNT = 0x0800C704;
  if (id >= 38 && id - 38 <= 207 && read32(0x0800C3C4 + (uint32_t)(id - 38) * 4) == THE_COUNT) {
    write16(SETUP + 58 + who * 2, read16(SETUP + 58 + who * 2) + 1);
  }
}

void loadSharedSprites(void) {
  copy16(0x0847AB98, 0x05000280, 0x10);
  copy16(0x0847ABB8, 0x06011200, 0x80);
  copy16(0x0847ACB8, 0x06011300, 0x80);
  copy16(0x0847ADB8, 0x06011400, 0x80);
  copy16(0x0847AEB8, 0x06011500, 0x80);
}

void clearChoices(int i) {
  uint32_t at = CHOICES + (uint32_t)(i & 0xFF) * CHOICE_SIZE;
  for (int n = 0; n <= 68; n++) write8(at + n, 9);
}

void zeroQueue(void) {
  for (uint32_t at = 0; at < 128 * 16; at += 4) write32(0x030033E0 + at, 0);
}

void clearHudRecords(void) {
  write8(0x030030D0 + 36, 0);
  for (int n = 0; n <= 63; n++) {
    uint32_t at = 0x03002CD0 + (uint32_t)n * 16;
    write16(at, 0); write16(at + 2, 0); write16(at + 6, 0); write16(at + 8, 0);
    write8(at + 12, 0);
    write8(at + 13, 0);
  }
}

void clearBrainFlags(void) {
  for (int n = 0; n < 8; n++) write8(0x03003D88 + n, 0);
}

int32_t randomNumber(void) {
  uint32_t next = read32(SEED) * 0x14FA05u + 0xC0AFu;
  write32(SEED, next);
  return (int32_t)next;
}

int rollChance(int chance) {
  uint32_t roll = ((uint32_t)(randomNumber() & 0xFFFF) * 100) >> 16;
  return roll > (uint32_t)chance ? 0 : 1;
}

void resetBrain(int i) { brainReset(i); }

void restartBrain(int i) {
  uint32_t number = (uint32_t)randomNumber();
  uint16_t base = read16(0x08071250 + (uint32_t)read8(LEVEL) * 2);
  write16(brain(i & 0xFF) + 10, (uint16_t)(base + (((number & 0xFFF) * base) >> 12)));
  resetBrain(i);
}

static int32_t arcTan(int i) {
  int32_t a = -((i * i) >> 14);
  int32_t b = ((0xA9 * a) >> 14) + 0x390;
  static const int32_t next[6] = {0x91C, 0xFB6, 0x16AA, 0x2081, 0x3651, 0xA2F9};
  for (int n = 0; n < 6; n++) b = ((b * a) >> 14) + next[n];
  return (i * b) >> 16;
}

uint16_t arcTan2(int x, int y) {
  if (y == 0) return x >= 0 ? 0 : 0x8000;
  if (x == 0) return y >= 0 ? 0x4000 : 0xC000;
  #define OVER(n, d) ((int32_t)((uint32_t)(n) * 16384u) / (d))
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return (uint16_t)(arcTan(OVER(y, x)) & 0xFFFF); }
    else if (-x >= y) return (uint16_t)((arcTan(OVER(y, x)) + 0x8000) & 0xFFFF);
    return (uint16_t)((0x4000 - arcTan(OVER(x, y))) & 0xFFFF);
  }
  if (x <= 0) { if (-x > -y) return (uint16_t)((arcTan(OVER(y, x)) + 0x8000) & 0xFFFF); }
  else if (x >= -y) return (uint16_t)(arcTan(OVER(y, x)) & 0xFFFF);
  return (uint16_t)((0xC000 - arcTan(OVER(x, y))) & 0xFFFF);
  #undef OVER
}

int wayToTarget(int i) {
  int who = i & 0xFF;
  uint32_t offset = (uint32_t)read8(brain(who) + 15) * 2 + (uint32_t)who * FIGHTER_SIZE;
  uint16_t angle = arcTan2(reads16(FIGHTERS + 54 + offset), reads16(FIGHTERS + 62 + offset));
  return read8(0x08ED8AD4 + (uint32_t)(angle >> 12));
}

void setBrainLevel(int level) { write8(LEVEL, (uint8_t)level); }

void queueFrameAtTile(uint32_t sheet, int tile, int frame) {
  queueCopy(TILES + (uint32_t)u16(tile) * 32, sheet + (uint32_t)u16(frame) * FRAME_BYTES, FRAME_BYTES);
}

void queueFighterFrame(uint32_t sheet, int slot, int frame) {
  queueCopy(TILES + (uint32_t)(slot & 0xFF) * FRAME_BYTES, sheet + (uint32_t)u16(frame) * FRAME_BYTES, FRAME_BYTES);
}
