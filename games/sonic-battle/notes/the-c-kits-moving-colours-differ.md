# The C kit's moving colours differ where the JavaScript kit's match.

About: A fight's opening; fight-opening; 0x08011c7c

Proof: #626; fight-opening

The C version of the fight's opening matches 394 of 400 frames of `fight-opening`. At frames 56, 104, 120, 136, 144 and 160 the arena's moving colours differ, while the console holds the same registers, colours, sprites and VRAM. The JavaScript version, drawn by the JavaScript kit, matches every frame. The C kit's `gba_draw_frame` and `kit/gba/video.js`'s `drawFrame` are meant to draw the same, and `npm run test:c-kit` passes.
