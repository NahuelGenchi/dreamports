# Leaving the VS mode select, the first layer's first tile is cleared a few lines into the picture.

About: vs-mode-select

Proof: #562; vs-mode-select

As when leaving the Time Attack menu, CreateMainMenu's zero fill shows one frame before the main menu is made, in the sprites' first tiles and also in the first layer's first tile. The Dreamport has both cleared when the frame starts, and frame 2831 then differs in the 64 pixels of the first four lines above that tile (0,0 to 15,3), with the memory the same. The original may clear the first layer's tile a few lines into the frame; that is not checked.
