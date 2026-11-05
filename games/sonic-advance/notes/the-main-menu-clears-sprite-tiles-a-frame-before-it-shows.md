# The main menu coming back clears the sprites' first tiles, and the picture before the leave already shows it.

About: Time Attack; The main menu; time-attack-menu

Proof: #550

CreateMainMenu with 1 fills 128 bytes with zeros from the end of the third layer's tiles, which runs past the end of the layer's video memory into the first 64 bytes of the sprites' tiles. When B leaves the Time Attack menu, the original's picture shows those tiles cleared 15 frames after B, one frame before the main menu is made, with the rest of the screen as it was. The Dreamport clears them with the leave, so the menu does it a frame early to match.
