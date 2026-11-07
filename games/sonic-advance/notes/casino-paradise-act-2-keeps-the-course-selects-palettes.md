# Casino Paradise act 2 keeps the sprite palettes and scrolls the course select and its card leave.

About: Casino Paradise Zone act 2; the whole game

Proof: #981; #968; #973

The sprite palettes 2 to 15 at the act's first frame are the course select's and its title card's leftovers; the act itself sets none of them before its objects spawn. A start point that leaves out the course select leaves the menus' palettes there, so the first frame differs by 154 colours even where the stage's own palette matches. The card loads sprite palette 15 with its name graphics, and the character select's course select row loads palette 3.

The act's first frame also keeps the scroll the screen before it left: the proof's first frame shows BG1VOFS 3, BG2HOFS 0, BG3HOFS 224 and BG3VOFS 214 in the original. The act's own background update (StageBgUpdate_Zone3Acts12) first changes them on the next frame, so the camera's first act frame only sets it going.

The HUD's font and face tiles come from the sprite VRAM heap after the course select's sprites, so the course select's tiles have to be freed before the HUD is made for the OAM tile numbers to land where the original's do.

With the course select and the card's palette in place, The recording of the act first differs at frame 2100: 16,714 pixels, the right side of the background and the HUD face, with no palette differences left.
