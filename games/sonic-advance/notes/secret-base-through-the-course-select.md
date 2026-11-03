# The original reaches Secret Base act 1 through its course select with one value set, and most frames then match.

About: Secret Base Zone act 1; The character select

Proof: #289

Setting `unlockedLevels[0]`, 0x03005168, to 2 at frame 1660 of the original, in the character select, makes A there open the course select, on screen from frame 1777. Its cursor starts on level 0 and moves with Down, not Right, so Down twice and A at frame 1980 ran `StageInit_Zone2Act1`, 0x0803DD44, on frame 1993. As 342 frames only the original has, at the Dreamport's frame 1651 with `level=2` in its address, that made 2,505 of 2,600 frames the same, and every picture from 1654 to 1849. Waiting 1,844 more frames in the course select, to reach the 3838 frames the Dreamport's start assumes, changed no picture. What still differs isn't explained yet, and this act was never proven before: frames 1651 and 1652 by one pixel, 1653 by 21,938, the sound until about frame 1685, and from 1850 on single frames by 1 to 93 pixels, with Sonic standing still. Holding `gCurrentLevel`, 0x0300514C, at 2 across the hand-over from the character select didn't change the level.
