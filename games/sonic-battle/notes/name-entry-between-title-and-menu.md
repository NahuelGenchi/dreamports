# The name entry sits between the title screen and the main menu, 133 frames long in the menu recording.

About: The main menu; menu

Proof: #193

Start on the title screen fades to black and hands over to 0x08036560, the name entry, which asks for a name before the menu's own initializer 0x08039e20 runs. The name entry isn't ported, so the recording `menu` skips the original's frames 779 to 911 with A at frame 850 and Start at 860: a name and its fade. The Dreamport's frame 779 is then the original's frame 912, the menu's first frame, and frames 779 and 780 match there while 781, the first frame with colour, still differs.
