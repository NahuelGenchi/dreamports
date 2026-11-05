# The intro's last scene can be drawn while a line's register values are half rewritten, so one line holds new and old.

About: The intro; intro

Proof: #302; intro

The finale (`src/finale.js`) writes its list of line registers the way the logos do (`src/runners.js`), and on some frames the screen is being drawn at the very line the work is writing. That line then takes the registers already written from the new list (BG2PA, then BG2PB, then the next ones) and the others from the old. The line the drawing reaches is usually 10 and sometimes 9, and a few frames take only the first value of line 10 from the new list, so `TORN_FRAMES` lists, by frame, the line and how many values were written. Like the logos' `NOT_LATER` they come from comparing every frame with `prove`, since the work's length moves with the sound engine's.

`prove` prints the registers the console holds when the frame ends, which include whatever the list held past the last line, so a register that differs there isn't the cause of a differing line.
