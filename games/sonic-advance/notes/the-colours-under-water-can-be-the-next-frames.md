# The colours under water can be the next frame's, once the Egg Spider is beaten.

About: sonic-ice-mountain-act-2

Proof: #741; sonic-ice-mountain-act-2

After the boss of `sonic-ice-mountain-act-2` is beaten the game has little left to do each frame, and on stage clock values 13048, 13114 to 13126 and 13189 to 13201 the original's lines under the water show colours that the next frame's palette animations made. The water's interrupt copies the colours under water when its line comes, so on those frames the next frame's tasks must already have run by then, which depends on the console's timing and is not counted here. `EARLY_COLOURS` in `c/src/water.c` keeps those values, measured from the original, and on them the colours under water are taken from the next frame's palette, as `LATE_WAVES` does for the waves that start a line late (the-waves-can-start-a-line-late.md).
