# mGBA counts a square's time since its last step against its current pitch, so a note after a slow silence starts on time

About: the sound hardware; kit/gba/sound/apu.js; reading a sound that differs

Proof: #299

The sound library stops a square by writing only the top of its pitch register as zero, which leaves it silent at a much slower pitch. The kit used to count down that slow step and only then take the new pitch, so a note could hold one level for up to about 90 samples as it started. On Sonic Advance 3's language screen, with nothing else playing, that added enough low sound to make 9 frames around three cursor sounds differ, around 250 Hz. mGBA's GBAudioRun compares the time since the last step with the pitch it has now, so the note's steps start at once. With sound/apu.js doing the same, all 599 frames of first-start match, and Sonic Advance's and Sonic Battle's recordings give the results they gave before. The kit's samples are still taken every 256 cycles at another point of the wave than mGBA's, so a short high note can show one more or one fewer high sample each wave.
