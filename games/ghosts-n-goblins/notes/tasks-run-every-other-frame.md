# The game runs up to eight tasks in rounds, one round every other frame, and V-blank does all the drawing and sound.

About: the whole game; game-start

Proof: #1005; game-start

The original's last bank holds a small kernel. Each task has its own stack: sub_C2BC starts one from the table at $C3CC, sub_C336 hands the processor to the next ready task, sub_C313 puts the running task to sleep for a number of V-blanks, sub_C2FA ends it and sub_C303 stops another. A task's state is at $02 plus its number, $80 ready and $C0 asleep, and $00 is the task that's running. When every task has had a turn the processor waits at $C39C until $4E, which V-blank counts up, reaches $CD, which is 2, so the game's rules run 30 times a second. The tasks are the title screen (2, $C3DC), the game (4, $C8C4), the view (6, $E68C), Arthur (8, $DA71), the objects (10, $F367), the sprites (12, $F34F) and the tiles (14, $E569).

The V-blank interrupt at $C0F0 is the only code that writes to the PPU and the sound registers. It sends the sprites from $0200 or $0300, a frame each, writes what the tasks left in the lists at $0720, $07A6 and $07D8, or else 32 of the colour attributes kept at $0400, sets the scroll from $3D and $3E, reads the buttons and runs the sound.

Some routines wait inside a task for V-blank to count a frame, at $C0E8, $C688 and $CA5A, and no other task runs until then. The Dreamport keeps each task as a function that says how it leaves the processor, and its work memory matched the proof's emulator's, byte for byte, at every frame of game-start but those of the note late-rounds-catch-the-sprites.
