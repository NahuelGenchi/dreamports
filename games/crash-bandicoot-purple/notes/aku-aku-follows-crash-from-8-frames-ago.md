# Aku Aku floats after where Crash was 8 frames ago, which is why it's off screen for the first 8 frames of a level.

About: Crash on foot; first-hub-standing; 0x08000B94; 0x08000A2C; 0x08021BD0

Proof: #493; first-hub-standing

0x08000A2C clears a list of 8 places, and 0x08000B94 reads the oldest each frame, so Aku Aku starts near the map's corner until Crash's own places reach it. Its place adds a sine at 0x08047B2C by the count at 0x0200762C, and it picks one of four pictures by the random numbers at 0x02000000 every 8 frames. Both have the values the original's way to the hub leaves them with when the level starts. 0x08021BD0 draws it after Crash or before him by which way it moved.
