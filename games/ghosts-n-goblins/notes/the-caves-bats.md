# The cave's bats hang from its ceiling until Arthur is below, then drop to his height and fly at him in a wave.

About: Stage 3: The cave; stage-3-begins

Proof: #992; stage-3-begins

Kind $0A, sub_04_B45B, is the third stage's bat. The stage's list hangs six at a time along the ceiling, 32 pixels apart. Hanging, a bat waits while Arthur isn't lower than it, and lets go in a round where its own number times 4 plus the game's count of rounds ($83) is a multiple of 32: flag $02, heading down, at speed $18. Within 16 lines above Arthur's height it turns to fly at him, flag $04, at speed $10 plus $D2 across and $0C plus $D2 up or down, two rounds each way, by its count. Out of the view a bat that has let go is gone. One hit kills it, for 100 points, falling the way the weapon went.

From the third stage on, the stage's start ($D1B5) sends V-blank 32 bytes of tiles to the picture's memory at $0680, from $CD6D, or $CD4D from the fifth stage. And a hidden pick-up there checks Arthur's place at $BB72: from $0AF8 on, one left on a screen before $0B is gone.

With nothing pressed, stage-3-begins shows zombies, ported for the first stage, coming out of the cave's ground too.
