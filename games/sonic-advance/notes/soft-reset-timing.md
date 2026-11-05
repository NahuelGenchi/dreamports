# The soft reset happens one frame before its buttons show, and the title's first frame after it loads its maps late.

About: soft-reset-menu; The title screen

Proof: #87

`VBlankIntr` checks A, B, Start and Select at the end of each frame, so it sees the next frame's buttons, and the screen is already white the frame before they show. A port checking at the start of its frame resets a frame late, so it needs the next frame's buttons ahead. `FLAGS_8000` stops the reset during the SEGA logo and around save writes.

After the reset, `EngineInit` sets `FLAGS_SKIP_INTRO` from the four held buttons, so the title starts with its music. Its first frame has the tile graphics loaded but not the tilemaps, as the screen's first update overruns the V-blank, and the tasks skip a frame. Deferring only the background maps matches exactly.

A start point is where the game opens, so a reset from `?special` goes to the title. That start point keeps a save nowhere, written as the language screen leaves it, so the title follows as in the original.

`soft-reset-menu`, `-act`, `-logos` and `-special-stage` match every frame, pictures and sound, and `soft-reset-normal-ending` matches from well before its reset at frame 9500 into the title. A reset at frame 9300 differs in that frame's sound, the original's louder near 250 Hz. The likely cause, not shown yet, is that the original's square and noise channels sound on until `m4aSoundInit`, which `EngineInit` runs after its VRAM, OAM and palette fills, while the kit silences them at once.
