# Any character reaches any level in the original through its course select, with one value set for that character.

About: amy-casino-paradise; amy-x-zone; tails-x-zone; knuckles-x-zone

Proof: #90; amy-casino-paradise; amy-x-zone

`unlockedLevels` holds a 16-bit number for each character, from 0x03005168, so Amy's is at 0x0300516E. Set to a level at frame 9 of the stretch, A in the character select opens the course select, where Down moves one level. With the Dreamport's address giving `level` and `character`, the act then lines up, and most of it matches. What follows the start isn't the game: about 25 frames of sound differ, as the Dreamport's main menu music runs out where the original's course select has its own, and the HUD's first frame differs, as the original draws a tile from before the font on it. Casino Paradise's HUD starts from 20, Ice Mountain's and Angel Island's from 58 and Egg Rocket's from 4, for all the characters tried, in `levels.js` as `hudFlash`.
