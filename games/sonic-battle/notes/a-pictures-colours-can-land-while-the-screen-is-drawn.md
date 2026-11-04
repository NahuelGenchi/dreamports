# A Mini-games picture's colours can land while the screen is drawn, and how far down depends on that frame's sound.

About: The mini-games; mini-games-open; 0x08031e68

Proof: #508; mini-games-open

Every other picture in `mini-games-open` matches, but three frames differ. On frame 1360 the top line of the picture has the old colours, and on frame 1600 the top seven lines do, as 0x08031e68 unpacks the tiles and then the palette while the screen is reached. Frame 1601 differs because the frame's scroll missed that V-blank, BG3VOFS being 50 in the original and 49 in the Dreamport. The same press, from the second entry to the third with a new row, shows none of this at frame 1280 and all of it at frame 1600, with the same screen before it, so what's left to differ between them is how long the sound engine's V-blank work took, which the kit doesn't measure. In `mini-games-menu`, with only the first entry open, every frame matches.
