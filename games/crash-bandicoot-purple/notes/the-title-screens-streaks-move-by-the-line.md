# The title screen's streaks move by the line, and its update shows in those lines a picture before the rest.

About: The title screen; title-screen; 0x08001C04; 0x08001B18; 0x08001A98; 0x0802F8A0

Proof: #317; title-screen

The title screen is a level with only its first and last layers, and no actors. 0x08001C04 gives each of the first layer's 160 lines a speed from a table, in bands of 8 lines, 0x08001B18 adds it to that line's scroll every frame, and an H-blank DMA that 0x08001A98 starts at each V-blank copies them to the scroll register. The layer's own scroll stays still. 0x0802F8A0 has the first layer keep a column more on each side, so the moving lines never show a gap. The update comes right after a V-blank, so what it writes to those lines shows in the next picture, and what it asks of the sprites and colours in the one after: a press on the title stops the lines one picture before the fade starts. `title-screen` matches only with the lines one update ahead at the first picture and the logo's clock a frame behind, both measured against mGBA. Start and A both go on, each with the same sound, as `title-screen-a` shows; left alone, the screen was still there at frame 2999.
