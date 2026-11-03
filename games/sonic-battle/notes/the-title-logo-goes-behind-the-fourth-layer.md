# The title's sprites have priority 3 and its fourth layer 1, so the pulsing logo goes behind that layer above row 125.

About: The title screen; title; 0x08017690; 0x08016b30

Proof: #192; title

0x08017690 gives the title's queued sprites priority 3, and 0x08016b30 writes that into the third word of each OAM entry. The fourth layer's BG3CNT has priority 1, so it covers the sprites where it isn't transparent, down to row 124. At scale 256 the two large affine sprites start at row 126 and never reach it, so priority 0 looks right until a pulse: their top rows then rise past row 125, and with priority 0 they show over the layer. In `title` that was 40 pixels at frame 562, and more after each fourth pulse, which is stronger. It looked like an edge of the affine drawing, moved by a pixel, and changing the matrix only made it worse. The pixels that differed were the sprite's own in the Dreamport and the layer's in the original.
