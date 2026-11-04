# A story scene is a script of videos and pages, and the title's first layer brings in its last column's tiles first.

About: The story's opening scene; story-opening; 0x0801CEBC; 0x0802D3E8; 0x08036400; 0x0801AC0C

Proof: #322; story-opening

0x0801CEBC builds the scene: the display, the script, the text and the arrow. The script's commands of kind 7 go to the text, and a list at 0x08076CF0 waits for A, then ends or shows the next page. In `story-opening` every picture up to frame 2350 matches with each video's load time and a limit of 3,380 bytes for slow frames, both measured against mGBA. That limit is a measure, not a rule the code has, and at frame 2351 smaller frames still differ. A scene's sprites use tile 512 on, and their colour slots start from 15 again each frame.

0x0801AC0C keeps as many columns as the screen's map has blocks across, so the first layer's extra column at -1 reads the same as column 15, which brings that column's tiles into video memory first. It shows only as leftovers in the bitmap on the scene's first frame.

The sound differs from frame 1338 on, at first by 11 dB around 8,000 Hz, where the original has more. Changing how a back-and-forth loop turns, or keeping sound effects over the song's start, leaves that first difference where it is. Having a one-shot wave read on past its end takes away frames 1338 to 1340 and 1356 to 1358, which follow the hits on channel 4, but the original's instructions don't read that way, so it isn't in.
