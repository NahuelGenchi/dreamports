# The sound library's 15-frame counter is out of step after a character select the start point skips, unless the start names its frames.

About: The character select; the GBA kit's sound in C; only

Proof: #1783; #1041; sonic-ice-mountain

The original keeps its sound library's `SoundInfo` at 0x02001400, so its 15-frame counter, `c15`, is the byte at 0x0200140A, which `route --at` reads with a value added to `route.json` for the look. It counts down from 14 once for each SoundMain, from frame 6, and misses the 14 frames the logos load in, 183 to 196. The Dreamport in C does the same, and the two agree at every frame up to the main menu.

A start point with `unlocked` and no `select` skips the character select, which the original still plays, as the recording's `onlyInOriginal` stretch: 166 frames for Sonic and Amy, 146 for Knuckles, 126 for Tails or a save with every character. Its sound engine runs through them. `front_start_game` makes up for them only when the start names them as `only`, and thirty recordings didn't, so their counters ran 1, 6 or 11 frames apart from there on, which is those counts modulo 15. With `only` added the counters agree at every frame sampled, and `sonic-ice-mountain` keeps all 9,400 frames the same.

Still apart after that, as measured the same way: 10 frames after a soft reset, 5 to 10 from a start point that opens at an act or a special stage, and 2 in `options-menu` by frame 2643. Tiny Chao Garden's engine keeps its own `SoundInfo` elsewhere, so 0x0200140A says nothing of it.
