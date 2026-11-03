# The sound engine runs at 10,512 Hz, not the 13,379 that its fourth rate looks like.

About: the whole game; The SEGA and Sonic Team logos

Proof: #190; logos; logos-skipped

m4aSoundInit (0x08048FB8) sets the engine's fourth rate at start-up, and m4aSoundMode(0x9300E800), which follows it, keeps that rate: eight DirectSound channels, master volume 14, no reverb. Read through the decompilation's own samples-per-frame table, a fourth rate means 13,379 Hz, 224 samples a frame. At that rate every sound plays about a quarter too fast: the logos' song starts one frame early and ends nine frames early, and `logos` frames 234 to 238 and 241 to 252 come out quieter than the original, the whole spectrum down together. At 10,512 Hz, 176 samples a frame, `logos` and `logos-skipped` match every frame, picture and sound. The kit's soundMode takes the rate in Hz, so the game's mode gives 10512.
