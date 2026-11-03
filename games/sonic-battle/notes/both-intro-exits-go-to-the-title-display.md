# Both of the intro's exits go to the title display (0x0803e1b0), not to a fade to 0x08036560.

About: The intro; The title screen; 0x0803d860; 0x0803dd14; 0x0803e1b0

Proof: #191; #192; logos-and-intro; title

0x0803d860 looks at the keys held and, on Start, sets the next callback to 0x0803e1b0, the title display. 0x0803dd14 does the same at its last frame, and on Start held. The fade to 0x08036560 is the title display's own Start, after its frame 80, not the intro's. In the Dreamport, intro.js hands both exits over to title.js; the title's Start fades the palette out, and the name screen at 0x08036560 and the 600-frame attract mode at 0x0801c930 are not ported yet.
