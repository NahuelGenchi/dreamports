# A story scene is a script of videos and pages, played at the music's volume a game gives it.

About: The story's opening scene; story-opening; 0x0801CEBC; 0x08016A78; 0x0801AC0C

Proof: #322; story-opening

0x0801CEBC builds the scene: the display, the script, the text and the arrow. The script's commands of kind 7 go to the text, and a list at 0x08076CF0 waits for A, then ends or shows the next page. The buttons are read when an update starts, so a press during a frame that ran past its V-blank counts from the next update.

A game's data holds the music's volume, 128 for a new game, and 0x08016A78 gives it to the channels at 0x08034214, which takes every song after the menus down from the 200 the game starts with. It's only 3.9 dB, inside what `prove` allows, so it showed only once the rest lined up: the song really starts 4 frames before the first picture, while the first video loads.

The videos' first frames and slow frames are measured against mGBA in `story-opening`, and a frame's bytes don't decide them: one of 2,722 runs past its V-blank where one of 3,378 doesn't. While every frame is slow the main loop runs at half speed, the arrow's clock too.

0x0801AC0C keeps as many columns as the screen's map has blocks across, so the first layer's extra column at -1 reads the same as column 15, and 0x0802F8A0 places every layer twice from no tiles. Both show only as leftovers in the bitmap on the scene's first frame.
