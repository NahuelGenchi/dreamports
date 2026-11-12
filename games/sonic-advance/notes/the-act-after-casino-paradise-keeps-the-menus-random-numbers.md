# The act after Casino Paradise act 2 goes on with the menus' random numbers, and a start point opens only its first act.

About: Casino Paradise Zone act 2; Ice Mountain Zone act 1; sonic-casino-paradise-act-2

Proof: #739; #1186; sonic-casino-paradise-act-2; sonic-secret-base-act-2

The original has one gPseudoRandom for the whole game. The C keeps two sequences, the act's own and the menus' (`sharedRandom` rows such as Casino Paradise draw from the menus'), so the next act after GoToNextLevel now goes on from whichever one the act before drew from (`next_act` in `act.c`). Ice Mountain's snow after Casino Paradise act 2 depends on it.

A start point used to open the next act as it opened its own, past the title card: Ice Mountain act 1 began without its card, at frame 12442 of `sonic-casino-paradise-act-2`. The start point now applies to the first act it starts only (`fromStartPoint`), and the hand-over matches up to the card.

After the card, the rings and the snow in Ice Mountain act 1 used to be one animation step off on some frames when it came after Casino Paradise act 2, so the recording ended at 12441. Since #1186 the hand-over runs as the original's does: the rings' task and the palette animations run once on the frame that makes the act, and the stage's background update starts a frame before the camera. The recording now plays on to frame 12821, through the card and into the act, and every frame matches.
