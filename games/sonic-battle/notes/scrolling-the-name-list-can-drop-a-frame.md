# Scrolling the name list changes the picture partway through a frame, and later scrolls fall a frame behind.

About: The name entry, at the first start; first-start; 0x08036350; 0x080368dc; 0x08020978

Proof: #465

A recording that scrolled the list, by Down held at the grid's last row from frame 960 and then Up, differed from the original in the Dreamport's scroll only. Frames 982, 989 and 996, the seventh-frame repeats of the held Down, each differ by a few pixels in one letter, such as 18 from 193,120 to 198,128, while `prove --state` finds everything the console holds the same, so the picture differs in how it's drawn. From frame 1101, after Up scrolled the list back, every other frame differs by the background's scroll, which moves every other frame, and that stays until the screen ends, as if the original had lost a frame. This fits 0x08036350, which clears the grid's tiles and draws all 60 letters a pixel row at a time, taking most of a frame or more, so the display reaches letters not drawn yet, and a redraw past the next V-blank costs a frame. That reading isn't measured. The Dreamport draws the grid at once and loses no frame, so `first-start` stays off the list's scroll, moving the cursor with no scroll, and the scroll isn't proven.
