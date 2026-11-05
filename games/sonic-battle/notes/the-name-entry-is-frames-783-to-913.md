# With no saved name, the name entry starts at frame 783, waits for the player, and ends 23 black frames after its fade.

About: The name entry, at the first start; The main menu; first-start; 0x08036560; 0x08039e20

Proof: #462; #465; first-start

Start on the title screen at frame 747 hands over to 0x08036560, which runs at frame 780. The screen stays black until 782, so the part's first frame is 783. It waits for the player: left alone it hadn't moved on by frame 2999, and A alone or Start alone doesn't leave it, as Start needs a letter first. A at 790 and Start at 800 came too early and did nothing. With A at 850 and Start at 860 the screen is black from 891 to 913 and the menu's initializer 0x08039e20 runs at 910. With A at 1000 and Start at 1010 the same black is 1041 to 1062, so its length can differ by a frame. In `first-start`, with Start at 1412, it ends at 1465. The last frame moves with the press, and The main menu's first is the frame after it. Start keeps the name at 0x03002170 in work RAM, and 0x08036560 goes straight to 0x08039e20 when the halfword there isn't 0: writing 1 there at frame 775 ran the initializer at 781, with the screen black until 784. So a player with a saved name goes from the title to the menu. Frames 779 to 782 are black in both, and The title screen's part stops at 778.
