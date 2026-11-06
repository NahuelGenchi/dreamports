// Sonic Battle Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-battle/src/. src/main.js runs it on the page, built to WebAssembly as
// src/game.wasm (kit/gba/c/README.md).
//
// Nothing before a fight leads here yet: a recording's start point opens the fight's opening (fight.c), and the page
// starts there too. dreamportsProof.neverInPlay: the start point is the fight's own opening, which drops the fighters in,
// so no earlier screen holds them.

#include "game.h"

void startFightFromPoint(void) {
  int vblanks = (int)gba_start_number("vblanks", 0);
  int action = (int)gba_start_number("action", 0) & 0xFF;
  startFight(vblanks, action);
}

// once, with the player's copy in gba_rom: the sound engine, then the console's power-on, as core.js's createCore
// sets it up. Sonic Battle's sound is six music players, eight DirectSound channels, master volume 14, 10,512 Hz and no
// reverb (sound.js).
void game_start(void) {
  gba_write(REG_DISPCNT, 0x80);
  g.keys.timer = 15;
  g.keys.delay = 15;
  g.keys.interval = 7;
  g.language = 1;
  g.start_up = 1;
  g.callback = startFightFromPoint;
  gba_on_hblank(hblank);
  gba_sound_start_layout(0xBF71FC, 6, 8, 14, 10512, 0, 1, 84800);
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { step(keys); }
