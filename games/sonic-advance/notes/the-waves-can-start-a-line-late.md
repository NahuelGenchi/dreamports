# The water's waves can start a line late, on stage clock values only the console's timing explains.

About: sonic-ice-mountain-act-2; sonic-ice-mountain; Ice Mountain Zone act 1

Proof: #741; #1175; sonic-ice-mountain-act-2; sonic-ice-mountain

As in the Ice Mountain title demo (a-demo-can-be-late-on-the-same-frames.md), on stage clock value 1334 of `sonic-ice-mountain-act-2` the water's line is on the screen and its waves start a line below it: the line itself keeps the background's scroll the V-blank wrote, with the colours under water, and the wave table goes on from the line after. Starting the H-blank DMA one H-blank later made the frame match. VCountIntr_8011ACC copies the colours under water before it sets the DMA up, so it looks as if, on those frames, it finishes after the line's H-blank, which depends on what the game is doing when the interrupt comes and is not counted here. `LATE_WAVES` in `c/src/water.c` keeps the values, measured from the original, by act.

Act 1 has the same two cases (#1175), measured from `sonic-ice-mountain` the same way: the waves start a line late on stage clock values 2656, 2666, 2707, 4145 and 6364, and the interrupt comes after the screen's last line on 4094, 4162 and 6374, where the water's line is within a few lines of the screen's bottom. With them the act's 6,981 frames all match.
