# The Mini-games waiting screen starts three frames after the palette is black, not when the fade reports black.

About: The mini-games; mini-games-lobby; 0x080284b4; 0x080325f0

Proof: mini-games-lobby

In `mini-games-lobby`, A on Soniclash at frame 2000 fades the Mini-games screen to black. The original's colours are all black by frame 2035 and its display is off (DISPCNT 0) from 2035 to 2037; the screen's first frame at 0x080284b4 is 2038, when the display comes on again. The Dreamport's fade reports black at 2034, so the waiting screen has to wait three more frames, or it appears while the original is still black.

The waiting screen also needs its own frame start: 0x08028760 walks the list with 0x0801f89c but does not add 0x080200f8 as a node, so the port adds it, or the drawn sprites and the matrix count carry over from the frame before.
