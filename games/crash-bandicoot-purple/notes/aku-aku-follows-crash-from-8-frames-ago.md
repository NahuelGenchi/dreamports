# Aku Aku floats after where Crash was 8 frames ago, which is why it's off screen for the first 8 frames of a level.

About: Crash on foot; first-hub-standing; 0x08000B94; 0x08000A2C; 0x08021BD0

Proof: #493; first-hub-standing

0x08000A2C clears a list of 8 places, and 0x08000B94 reads the oldest each frame, so Aku Aku starts near the map's corner until Crash's own places reach it. Its place adds a sine at 0x08047B2C by the count at 0x0200762C, and it picks one of four pictures by the random numbers at 0x02000000 every 8 frames. Both values are set by the start point of `first-hub-standing`, as the Dreamport has no path yet to reach them from power-on. 0x08021BD0 draws it after Crash or before him by which way it moved.
