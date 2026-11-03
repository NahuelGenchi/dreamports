# Start goes to the title display from the intro's pictures but through a fade to 0x08036560 from its animation.

About: The intro; The title screen

Proof: #191

0x0803d860 looks at the keys held and, on Start, sets the next callback to 0x0803e1b0, the title display. 0x0803dd14 looks at the keys just pressed and, on Start after its frame 80, plays song 404 and goes through a fade (0x0803e6e8) to 0x08036560 instead. Neither place is ported after the intro yet: the screen stays black there, and the title display is #192.
