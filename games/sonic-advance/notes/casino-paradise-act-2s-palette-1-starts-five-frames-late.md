# Casino Paradise act 2's palette 1 begins five frames later than the start point's card leaves it.

About: Casino Paradise Zone act 2

Proof: #1046; sonic-casino-paradise-act-2

The start point's card frames step the act's palette animations by hand in `act.c` (`pre_run`). Palette 1, the striped columns' colours, is animation 818's D6 to D9, each held 16 frames. At the act's first frame the original holds D9 four frames longer than the Dreamport did, so the columns' colours matched on twelve frames of every sixteen from the moment they first showed: frames 5161 to 5164 of `sonic-casino-paradise-act-2` were 70 pixels at the screen's right edge, and the same four frames of every sixteen after them. Starting `paletteAnims[2].wait` five frames further on (5 × 256) made each of them match, and every frame of the recording with them.

The list's animation numbers are the decompilation's: animation 817's script in the USA copy is D2 to D5 at palette 3, 818's D6 to D9 at palette 1, and 819's DA and after at palette 5.
