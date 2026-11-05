# The main menu is the title's level with a list, and its sounds showed how a channel is kept.

About: The main menu; main-menu; 0x0801C19C; 0x0801C148; 0x08034238; 0x080454BC

Proof: #320; main-menu; main-menu-code

0x0801C19C builds the menu on the same level as the title, from the list at 0x02007CB0, which 0x0803BA1C fills from the cartridge at 0x08075E30. The two pictures of Crash come from 0x0800C34C with its last argument 0. 0x0801C148 is the menu's own update: L and R held with nothing else go to state 30, the screen for a code, and it's the one way there the menu has. A on Story Mode holds the picture for 2 frames with the whole of the streaks' layer on one scroll and the song stopped and started, as the first save does for 11, and the other three lines go straight to the fade, which `main-menu` and the recordings of each line show. Those 2 frames are measured against mGBA.

Every channel's priority starts at its lowest (0x080454BC), so a sound effect of low priority can take a channel straight after a song starts. With 0 there instead, the sound of moving on the menu, at priority -100, was never heard after the save restarted the song. 0x08034238 doesn't ask whether a sound is playing: it asks whether it's the last each channel was given, which only 0x08034268 clears, so the title's sounds repeat on every update their logo stays on that frame and fill both channels, which is why Start at frame 540 of `load-save` makes no sound of its own, at priority -200, while Start at frame 2000 of `title-screen` does.
