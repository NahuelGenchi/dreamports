# The C kit's sound setup takes Sonic Battle's player table through the kit's setup call.

About: The SEGA and Sonic Team logos; logos; 0x08BF71FC; 0x08BF7244

Proof: #642; logos

The C kit's `gba_sound_start` finds a player table whose entries are EWRAM pointers. Sonic Battle's table is at 0x08BF71FC and its entries point into IWRAM, so the finder doesn't take it. `games/sonic-battle/c/src/main.c` sets the same layout through the kit's `dp_sound_call` with its setup call: player table 0xBF71FC, six players, eight channels, volume 14, 10,512 Hz, `voicesEndOnChip` and `soundMainAt` 84800, as `sound.js`'s `soundLayout` does. The logos' 390 frames then match the original in picture and sound.
