# Leaving the Time Attack lobby for the title screen, the title's clear of the first tiles lands mid-picture, at line 29.

About: Time Attack; time-attack-lobby-title

Proof: #761; time-attack-lobby-title

CreateTitleScreen clears the first layer's first tile and the sprites' first two tiles with a DMA. Coming from the lobby, it runs while the lobby's last frame is being drawn, so lines 0 to 28 of that picture show the tiles as they were and lines 29 on show them cleared (the green bars beside the lobby's box on frame 3331). The C clears them from an H-blank callback after line 28 (`title_clear_lands` in `c/src/timeattacklobby.c`). Leaving the Time Attack menu or the VS menu for the main menu, the same kind of clear shows on the whole picture before (`c/src/timeattack.c`, `c/src/modeselect.c`).
