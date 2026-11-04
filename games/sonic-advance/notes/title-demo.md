# The original starts its first demo at frame 4378, and no task runs after the one that makes its act.

About: The title screen; title-demos; title-demos-cut-short

Proof: #115; #117; #94

In a run with only A pressed at frame 150, the original starts its first demo at frame 4378. `Task_SwitchToDemoInit` destroys its own task before it makes the act, so no other task runs on that frame, where the course select's act runs those after it. The first press on the tape is read on the frame after, and the act's music starts at once, without the fade in that the course select's has. The HUD's first frame shows the white zero, as on a start from the character select. The Title screen's part stays proven with Start pressed, frames 902 to 1252 of `neo-green-hill-act-1`.

Its fade to white shows only where nothing else has the blend. In `title-demos` Secret Base's spotlights and Ice Mountain's snow, which write it each frame, leave no fade at all, and a title card holding lets it show until the card ends and clears it, as `title-demos-cut-short` shows. Start ends the spotlights on the same frame. With no fade the first frame after is black at the SEGA logo and white at the title screen. What's left: Secret Base's first frame shows the act's tiles half loaded, 308 to 428 pixels; the pixels along its beams that `secret-base-through-the-course-select` already has; single frames under Ice Mountain's water; and 21 to 481 pixels on the last frame when there's no fade, as the next screen clears video memory while that frame is drawn.
