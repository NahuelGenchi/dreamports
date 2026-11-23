# The sound library's 15-frame counter slips at a character select the start point skips without naming its frames.

About: The character select; sonic-ice-mountain

Proof: #1783; #1041; sonic-ice-mountain

The original's `SoundInfo` is at 0x02001400, so its 15-frame counter, `c15`, is the byte at 0x0200140A, which `route --at` reads. It counts down from 14 once a SoundMain, from frame 6, and misses the 14 frames the logos load in, 183 to 196. The C does the same, and the two agree up to the main menu.

A start point with `unlocked` and no `select` skips the character select, which the original still plays as the recording's `onlyInOriginal` stretch: 166 frames for Sonic and Amy, 146 for Knuckles, 126 for Tails or a save with every character. `front_start_game` makes up for them only when the start names them as `only`. Thirty recordings didn't, and ran 1, 6 or 11 frames apart from there on. With `only` the counters agree at every frame sampled.

`tails-x-zone` is left without it: in step, its frames 2739 and 2740 differ by sound alone, around 8,000 Hz on the left, 12.2 steps against 3.2, 11.7 dB apart, where they matched 6 frames out. `sonic-the-moon` is too, as with it frame 22073 differs in JavaScript.

Still apart: 10 frames after a soft reset, 5 to 10 from a start point at an act or a special stage, 2 in `options-menu` by frame 2643. Tiny Chao Garden's engine keeps its own `SoundInfo` elsewhere.
