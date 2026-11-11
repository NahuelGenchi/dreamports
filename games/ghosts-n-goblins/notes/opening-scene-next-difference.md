# The opening scene matches to frame 728, and Satan taking the princess, from frame 729, isn't ported yet.

About: game-start

Proof: #1005; game-start

After Start the screen is black from frame 103, shows whose turn it is from 133 to 224, and is black again to 396 while the stage's tiles, colours and first screen go to the PPU. The opening scene starts at frame 397 with its music, sound 9. Satan's object, kind $34 at $EDA2, waits 80 rounds, plays sound $27 from frame 555, shows in flashes from 559, while the picture's mask at $39 turns the stage dark each time he shows, beats his wings from 619 and flies to the princess from 683.

Every frame to 728 matches, picture and sound. At 729 Satan has the princess: his code goes on at $EE51 and $EE90, Arthur's task at $E500 has him jump after them, and the tiles' task starts its first list. The rounds also grow longer than a frame there, as the note late-rounds-catch-the-sprites says. The recording ends at 729 frames for that reason. What follows the scene in the game's task, at $CF70, isn't ported either.
