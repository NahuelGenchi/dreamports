# A demo plays the same presses each time, so what the console's timing does to it comes on the same frames.

About: title-demos; title-demos-cut-short

Proof: #94; title-demos; title-demos-cut-short

The original's fourth demo, Knuckles in Ice Mountain, has two things no task's code explains, both on the same stage clock values in `title-demos` and in a run that reaches it sooner. On values 1199, 1263, 1264 and 1265 the water's waves start a line later than the water line, and the wave table is read a line later below it: taking one line off the table's index made all four frames match. The water's VCount interrupt is what starts them, so it looks as if it comes late there, though that was not measured. On value 1786 OAM's entry 124 holds attribute values 0, 0x200 and 0x200 at the end of the frame, which is an 8 × 8 sprite at the screen's corner, showing tile 512 in palette 0. Tile 512 holds the moving spring's tile at (0, 40) in its frame. Why that entry is set wasn't found. `src/engine/demo.js` keeps both as lists of stage clock values, measured from the original, and they hold for this demo only.
