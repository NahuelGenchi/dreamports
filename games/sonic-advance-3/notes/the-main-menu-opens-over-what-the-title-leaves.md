# The main menu's first frame is drawn with registers the title screen left, and its page task starts a frame later.

About: The main menu

Proof: #304

The menu's setup task runs on its first frame, and the page's own task on the second, so the first frame is black. Four registers it never writes show what the title screen left: layer 2's reference point (BG2X is -0x9400 and BG2Y -0x800), window 1's range (0xFF), the windows' inside layers (0x37) and the blend's alpha (0x1F). With window 0's inside layers at 0 instead of 0x37, the first frames showed the backdrop's colour and not black. `main.js` sets them for the start point.

The buttons' shaking is one list the next frame's task rewrites while the screen is drawn, but here every line of a frame shows that frame's own values, with no tear.
