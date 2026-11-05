# mGBA draws a flipped tile that a window edge cuts on both sides from the wrong column, so an edge can move pixels.

About: the display registers; rotating layers; reading a picture that differs by a few bytes

Proof: #94

mGBA draws a line in pieces, one for each window edge, and each layer again for each piece. A piece that starts partway into a tile goes through `DRAW_BACKGROUND_MODE_0_TILE_SUFFIX_16` in `software-mode0.c`. For a tile flipped sideways it fills from the piece's end backwards, starting at the tile's first column, which is only right if the piece runs to the tile's end. A piece that ends sooner shows the tile's pixels from further along, by as many columns as it stops short. Sonic Advance's Secret Base act 1 has a window edge moving over its layers every frame, and the frames it hits show one to seventeen pixels along the edge in the wrong shade. They matched once the act's renderer did the same, for each piece mGBA's `_breakWindow` makes, including its empty ones, and every frame of Sonic Advance's `title-demos` and `title-demos-cut-short` along the beams then matched. Hardware may not do this, and prove measures against mGBA.
