# The logos' sky is rewritten while the screen draws it, so most of each frame shows the next frame's lines.

About: The SEGA and Sonic Team logos; logos

Proof: #301; logos

Sky and meadow are one list of line registers (0x080A201C), which the H-blank copies to BG2PA and on, and the task writes it just after the V-blank, while the top of the screen is already being drawn. So lines 0 to 5 of each frame show that frame's list and every line from 6 on shows the next frame's, with no list written if the next frame writes none. On the frames before the runners' pictures change, every third, the work before it takes longer, so line 6 shows the old list too, except on the frames `NOT_LATER` in `src/logos.js` lists. Those can't be worked out from the code: which frames they are moves with the sound engine's work as well, and the two logos have different ones, so they come from comparing every frame with `prove`.

A Dreamport has no way to know a press before its frame, so the last frame before Start skips Sonic Team's logo still shows the next list, where the original's task never writes it. No recording covers that frame.
