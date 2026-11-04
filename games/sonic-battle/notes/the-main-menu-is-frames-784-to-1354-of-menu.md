# The main menu is frames 1466 to 2018 of `first-start`, and 784 to 1354 of `menu` with a saved name.

About: The main menu; menu; first-start; 0x08039e20; 0x08036560; 0x0803a0f8

Proof: #193; #465; menu; first-start

With a name at 0x03002170 from frame 778, the original goes from the title's fade through 0x08036560 to the initializer 0x08039e20 and shows black until frame 783. The recording's stretch of one frame at 778 writes that name, and the Dreamport's address gives it the same, so the Dreamport's frames from there on are the original's a frame later. 0x08039e20's decompressing runs past a V-blank: the original's song lines up two frames after the title's fade, and its display and its first nodes a frame after that. In `menu`, A at 1300 fades to black by 1331, and the next mode's screen starts at 1355, which isn't ported. In `first-start`, which comes through the name entry, A at 1982 reaches the next mode's screen at 2019, 18 frames sooner after the press than in `menu`. Why isn't known yet. 0x0803a0f8 reads only A, left and right, so B does nothing on this screen. The part is proven from power-on by `first-start`, and `menu` keeps the saved name's way there proven too.
