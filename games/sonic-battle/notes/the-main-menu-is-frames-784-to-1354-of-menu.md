# The main menu is frames 784 to 1354 of `menu`, reached with a saved name, and its display comes a frame after its song.

About: The main menu; menu; 0x08039e20; 0x08036560; 0x0803a0f8

Proof: #193; menu

With a name at 0x03002170 from frame 778, the original goes from the title's fade through 0x08036560 to the initializer 0x08039e20 and shows black until frame 783. The recording's stretch of one frame at 778 writes that name, as the name entry's own frames can't be skipped any other way, so the Dreamport's frames from there on are the original's a frame later. 0x08039e20's decompressing runs past a V-blank: the original's song lines up two frames after the title's fade, and its display and its first nodes a frame after that. A at 1300 fades to black by 1331, and the next mode's screen starts at 1355, which isn't ported. 0x0803a0f8 reads only A, left and right, so B does nothing on this screen. The name entry's route leaves other bytes in VRAM, which the menu's pictures can read, so this part is proven from a start point until the name entry is ported.
