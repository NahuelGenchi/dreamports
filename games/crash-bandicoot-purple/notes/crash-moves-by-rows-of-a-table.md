# Crash's speeds come in rows of a table, across and down, and what shows on screen is judged by the last frame's camera.

About: Crash on foot; crash-on-foot; 0x08023030; 0x08021E74; 0x0800F568; 0x08007B4C; 0x08038520

Proof: #312; crash-on-foot

Each row at 0x080777C0 holds a speed, how fast it changes and where it stops, across then down, and 0x080002D8 steps a speed toward its stop before he moves. 0x0800F568 then meets the lines in the tree the level's definition keeps at 20: up, down, left and right, in that order, from the box of the last frame. The camera looks 26 pixels the way he faces and 26 above him, and changes that by no more than 0x115 and 181 a frame. 0x08004A48 tests an actor against 0x0803AB4C's rectangle, which only moves once all the actors have run, so a fruit shows a frame later than its place on the new screen would say.
