# A new game's save holds the picture for 11 frames and starts the song again.

About: The load save game screen; load-save; 0x08016A78; 0x080163D4; 0x0801BE8C; 0x08001BA0

Proof: #319; load-save

A on a line with no game in it goes to 0x08016A78, whose 0x080163D4 writes a save, and 0x0801BE8C stops the song and the H-blank's DMA around the writing, then starts the same song from its start. In `load-save` the original's picture is the same from frame 1101 to frame 1111, with the fade to white only starting at frame 1112, and the whole of the streaks' layer takes the scroll of its last line for those frames, as nothing is left to change it line by line. The sound is silent until the song starts again at frame 1110. Those 11 frames are measured against mGBA. B goes straight to the fade, with none of this, as `load-save-back` shows. The screen takes 4 frames to load in `load-save` and `load-save-back`, and in `title-screen` and `title-screen-a`, with Start or A pressed at frames 540, 900 and 2000, but 5 with Start pressed at frame 560, the one press tried that doesn't fit, whose cause isn't known. The lines' text for a slot holding a game (0x0802C8F8) is left out, as this Dreamport writes no saves yet.
