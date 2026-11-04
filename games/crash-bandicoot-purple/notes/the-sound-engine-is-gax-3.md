# The game's sound engine is GAX 3, with songs of its own: the kit's engine plays none of it.

About: the whole game; The sound engine; The copyright screen and the logos; logos; 0x0803407C; 0x080342A4; 0x08042AD4; 0x08043618; 0x08045B98

Proof: #394; logos

0x08042AD4 writes the word 0x47415833, which spells GAX3, at the start of its memory. A frame of it runs from an interrupt at scanline 53 (0x080344EC), so a main loop that loses a frame doesn't hold it up, and the V-blank (0x080434F8) starts the buffer it made, so it's heard a frame later. It mixes one signed 8-bit stream, sent to both sides at full level, at 15,769 Hz for the first song, 264 samples a frame. `src/sound/gax.js` rewrites what the first screens use. With it, `logos` matches on every frame of The copyright screen and the logos, and a look at 6,000 frames of the same song found the sound the same except at frames 543 to 546 and 554 to 556, where the title screen, not ported yet, plays a sound effect. Echoes, back-and-forth loops, moving loops and songs other than the first have run in no comparison yet.
