# Casino Paradise act 2 keeps the sprite palettes, the tiles and the scrolls the course select and its card leave.

About: Casino Paradise Zone act 2; the whole game

Proof: #981; #968; #973

The sprite palettes 2 to 15 at the act's first frame are the course select's and its title card's leftovers; the act itself sets none of them before its objects spawn. A start point that leaves out the course select leaves the menus' palettes there, so the first frame differs by 154 colours even where the stage's own palette matches. The card loads sprite palette 15 with its name graphics, and the character select's course select row loads palette 3.

The act's first frame also keeps the scroll the screen before it left: the proof's first frame shows BG1VOFS 3, BG2HOFS 0, BG2VOFS 3, BG3HOFS 0 and BG3VOFS 21 in the original. The HBlank table the act's background update makes is not copied on that frame, and the act's own update first changes the scroll on the next one.

Past the front layer's tileset, video memory still holds the card's blank tile run at 0x7D00, and the two rings the first screen shows are animation 707 at tile 232. The HUD's font and face tiles are at the original's fixed sprite VRAM addresses: the face at 0x0800 (tile 64), the ring at 0x0880 (68), the white digits at 0x0A80 (84) and the red ones at 0x0D40 (106). The zero-ring count reads two tiles the character select left at tile 20.

The recording `casino-2-opening` proves the first playable frame after the card. The frames after it need the act's rings, objects and jump, which #739's full act brings.
