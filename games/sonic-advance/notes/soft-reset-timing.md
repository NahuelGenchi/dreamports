# The soft reset happens one frame before its buttons show, and the title's first frame after it loads its maps late.

About: soft-reset-menu; The title screen

Proof: #87

In the original, `VBlankIntr` checks A, B, Start and Select at the end of each frame, so it sees the buttons of the frame after it. The screen is already white (forced blank) on the frame before the recording shows the buttons first held. A port that checks the buttons at the start of its own frame resets one frame late, so it needs the next frame's buttons ahead of time. `FLAGS_8000` stops the reset: it is set during the SEGA logo until its wipe ends and around save writes, where interrupts are off anyway.

After the reset, `GameInit` starts the title screen with its music because `EngineInit` sets `FLAGS_SKIP_INTRO` from the four held buttons in `gInput`. The first title frame shows the layers on with their tile graphics loaded but the tilemaps not yet copied, because the screen's first update overruns the V-blank. The tasks then skip one frame (lag). Deferring all copies instead gives a plain backdrop and does not match; deferring only the background maps matches exactly. `soft-reset-menu`, `soft-reset-act` and `soft-reset-logos` match every frame, pictures and sound. The special stage and ending resets are not covered by a recording.
