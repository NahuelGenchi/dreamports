# The main menu's song fades out on the options screen, its last notes right on the level prove counts as silent.

About: The options; options-song-fading; options; 0x0801f718

Proof: #208; options-song-fading; options

A on Options fades the main menu's song over about 112 frames, and nothing else plays there, so its end is compared alone. In `options-song-fading`, A at 1640 ends the fade around frame 1750, and that frame's sound differs: on the right the Dreamport measures 1.00 of a console step at 125 Hz, and the original at most 0.93 anywhere within a frame either way, the same shape about 0.6 dB apart, and a level under 1 counts as silent. Up or down on the screen stops every sound (0x0801f638), so `options`, which presses down at 1712, never reaches that fade's end, and matches on all the frames of the part. Why the Dreamport is that little louder isn't known yet, and every picture in `options-song-fading` is the same. Frame 7580 of `options` differs by its sound as well, on the main menu after a new save's name entry, past the part's last frame, by 14.3 dB at 125 Hz, which looks like `kit/gba/notes/a-slow-wave-note-can-end-a-frame-apart-in-sound.md` but hasn't been shown to be.
