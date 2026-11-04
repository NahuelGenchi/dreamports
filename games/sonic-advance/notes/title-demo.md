# The original starts its first demo at frame 4378, and no task runs after the one that makes its act.

About: The title screen; title-demos; title-demos-cut-short

Proof: #115; #117; #94; title-demos; title-demos-cut-short

In a run with only A pressed at frame 150, the first demo starts at frame 4378. `Task_SwitchToDemoInit` destroys its own task before it makes the act, so no other task runs on that frame. The tape's first press is read on the next, and the music starts at once, with no fade in. The HUD's first frame shows the white zero. The Title screen's part stays proven by frames 902 to 1252 of `neo-green-hill-act-1`.

Its fade to white shows only where nothing else has the blend. Secret Base's spotlights and Ice Mountain's snow, which write it each frame, leave no fade at all, and a title card holding lets it show until the card ends and clears it. Start ends the spotlights on the same frame. With no fade the next frame is black at the SEGA logo and white at the title screen, and the last picture shows what the next screen clears at once: tiles 0 and 1 of the layers' video memory, and before the title screen those of the sprites', the player's. The music stops on that picture too.

Secret Base's demo opens with a picture the others hide under their fade. Its layers' maps are new and its background's map and tiles are still what the screens before left: the title logo's tiles as the map, and the last demo's background as the tiles. Where all of them are clear the backdrop shows, the one thing not darkened. Reading that needs the screens' video memory carried across each demo. Its next picture has the background at scroll 0, 0.
