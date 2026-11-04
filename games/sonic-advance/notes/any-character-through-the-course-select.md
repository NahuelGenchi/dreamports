# Any character reaches any level through the course select, with one value set for that character in the original.

About: The course select; amy-casino-paradise; amy-x-zone; tails-x-zone; knuckles-x-zone

Proof: #90; amy-casino-paradise; amy-x-zone

`unlockedLevels` holds a 16-bit number for each character, from 0x03005168, so Amy's is at 0x0300516E. Set to a level at frame 9 of a stretch of `onlyInOriginal` for the character select, and with `unlocked` and `character` in the Dreamport's address, both open the course select with that many rows, where Down moves one level and A starts it. Each Right in the character select adds 20 frames to the stretch, as it does on the way to the act. Most of the act then matches: `amy-x-zone` and `amy-secret-base-act-2` on every frame. Tails' HUD differs on its first frame there, by 118 pixels, which Amy's, Knuckles' and Sonic's don't.
