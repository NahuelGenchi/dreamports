# The main menu's song starts with the display, a frame after its screen is built, or its fade ends a frame late.

About: The main menu; The options; options-song-fading; options; 0x0801f718; 0x08039e20

Proof: #208; options-song-fading; options

A on Options fades the main menu's song over about 112 frames, and nothing else plays there, so its end is compared alone. Started a frame before the display, the song ran one frame ahead of the fade, so around frame 1750 of `options-song-fading` its last notes measured 1.00 of a console step at 125 Hz on the right against the original's 0.93, either side of the level that counts as silent. Sample dumps showed the Dreamport's song going on a frame longer before the fade's stop. The song now starts in the callback that queues the display, as the screen's building runs past a V-blank in the original, and all 3292 frames of `options-song-fading` are the same, which leaves `first-start`, `menu` and `mini-games-menu` matching.

Frame 7580 of `options` still differs by its sound, on the main menu after a new save's name entry, past the part's last frame, by 17.2 dB at 125 Hz on the right. The song's first wave note starts at a different place in its wave: the original stays silent for about 19 of the wave's steps where the Dreamport stays silent for about 5, the drift `kit/gba/notes/a-slow-wave-note-can-end-a-frame-apart-in-sound.md` describes, and starting the recording 40 frames later on the sound clock moved the frame to 7449. Counting the cycles into the frame at which the library starts and stops a wave note didn't take it away and moved Sonic Advance's differing frames, and restarting the wave's step on a pitch write, as mGBA does, didn't change it, so neither is in.
