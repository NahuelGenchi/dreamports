// Ghosts'n Goblins Dreamport: how long each piece of the original's code takes, in the processor's cycles. This is the
// one place the game's time is written down (time.c): the game's own code says which piece it has done, by name.
// Each is the sum of the cycles of the original's instructions for that piece, taken the way the piece's name says.

// ---- the V-blank interrupt, $C0F0 (main.c, screen.c)
COST(INTERRUPT_TAKEN, 7)          // the processor's own steps into it
COST(VBLANK_TO_CONTROL, 22)       // to the write of $2000
COST(VBLANK_TO_SPRITES_PLACE, 9)  // to the write of $2003
COST(VBLANK_TO_SPRITES, 19)       // to the write of $4014,
COST(VBLANK_SPRITES_SENT, 512)    // which holds the processor while the 256 bytes go
COST(VBLANK_TO_MASK, 9)           // to the write of $2001
COST(VBLANK_LIST_NOT_READY, 6)    // a list's flag is off: $51's, and $50's
COST(VBLANK_LIST_IS_READY, 5)
COST(VBLANK_WIDE_ROWS_BEGIN, 7)   // $C11B
COST(VBLANK_WIDE_ROWS_END, 13)    // $C11F's end, to $C188
COST(VBLANK_COLUMN_BEGIN, 16)     // $C14F, with its write of $2000
COST(VBLANK_COLUMN_END, 17)       // $C15A's end, with its write of $2000
COST(VBLANK_RUN_BEGINS, 6)        // a list's next run isn't its end,
COST(VBLANK_RUN_ADDRESS, 30)      // its address goes to the PPU, and its count is read
COST(VBLANK_RUN_BYTE, 12)         // each byte to $2007,
COST(VBLANK_RUN_ENDS, 3)          // and back for the list's next run
COST(VBLANK_ROWS_BUSY, 6)         // $4F is on
COST(VBLANK_ROWS_BEGIN, 7)        // $C188 to $C18C
COST(VBLANK_ROW_BEGINS, 8)        // a row isn't the list's end,
COST(VBLANK_ROW_ADDRESS, 29)      // its address and count,
COST(VBLANK_ROW_ENDS, 29)         // and after its bytes, the PPU's address moved clear and back for the next
COST(VBLANK_ROWS_END, 18)         // the list's end mark, and the list emptied
COST(VBLANK_WROTE_SOMETHING, 7)   // $C1CF, when a list was written
COST(VBLANK_ATTRIBUTES_BEGIN, 27) // $C1CF to $C1E2, when none was
COST(VBLANK_ATTRIBUTE, 13)        // each of the 32,
COST(VBLANK_ATTRIBUTES_END, 36)   // and where the next 32 are
COST(VBLANK_SCROLL_AND_MASK, 32)  // $C209 to $C21D
COST(VBLANK_TO_PADS, 15)          // $C220 to the call
COST(PADS_BEGIN, 23)              // sub_C278 to its call of sub_C28E
COST(PAD_BEGINS, 2)
COST(PAD_BIT, 24)
COST(PAD_KEPT, 28)                // $C2A1 to $C2AF
COST(PAD_A_NOT_HELD, 9)           // and back
COST(PAD_A_NEWLY_HELD, 14)
COST(PAD_A_STILL_HELD, 19)
COST(PADS_SECOND, 7)              // $C289 to $C28C
COST(VBLANK_TO_SOUND, 12)         // $C229 to the call
COST(VBLANK_AFTER_SOUND, 19)      // $C231 to $C23B
COST(VBLANK_TASK_LOOKED_AT, 10)   // $C23D to $C241, for each of the eight,
COST(VBLANK_TASK_AWAKE, 3)        // which isn't asleep,
COST(VBLANK_TASK_SLEEPS_ON, 27)   // or is, and stays so,
COST(VBLANK_TASK_WAKES, 36)       // or wakes
COST(VBLANK_NEXT_TASK, 5)         // $C25A, and round again
COST(VBLANK_TASKS_DONE, 4)        // or not
COST(VBLANK_TO_FRAME_COUNT, 8)    // $C25E to $C263
COST(VBLANK_FRAME_NOT_COUNTED, 3) // $80 is on
COST(VBLANK_FRAME_COUNTED, 7)
COST(VBLANK_TO_INTERRUPTS_ON, 12) // $C267 to the write of $2000
COST(VBLANK_LEAVES, 25)           // and back to what it interrupted

// ---- the tasks' turns, $C2BC to $C3BB (main.c)
COST(TASK_YIELDS, 37)             // sub_C336
COST(TASK_SLEEPS, 61)             // sub_C313
COST(TASK_ENDS, 12)               // sub_C2FA
COST(TASK_STARTED, 118)           // sub_C2BC, for a task that wasn't running,
COST(TASK_ALREADY_RUNNING, 48)    // and for one that was
COST(TASK_STOPPED, 50)            // sub_C303
COST(TURNS_NO_TASK_AFTER, 8)      // $C37D after the last task
COST(TURNS_LOOK, 20)              // $C37D to $C38A
COST(TURNS_CANDIDATE, 8)          // $C38C to $C38E, for each task after the one that ran,
COST(TURNS_IS_READY, 3)           // which is ready,
COST(TURNS_IS_NOT, 4)             // or isn't,
COST(TURNS_NEXT, 3)               // with another to look at,
COST(TURNS_NONE_LEFT, 2)          // or none
COST(TURNS_ROUND_OVER, 9)         // $C395 to $C39B
COST(TURNS_ROUND_STARTS, 8)       // $C3A2 to $C3A6
COST(TURN_GIVEN, 40)              // $C3A9 to $C3BB: the task's registers and stack back
COST(LOOP_INSTRUCTION, 3)         // each instruction of the loops that wait for V-blank,
COST(LOOP_LEFT, 2)                // and the branch that leaves one
COST(GOES_ROUND, 3)               // a loop's branch back, in the same page,
COST(GOES_ON, 2)                  // and the same branch when the loop is over
COST(GOES_ROUND_FAR, 4)           // a loop's branch back into the page before
COST(CALLS, 6)                    // a call of a routine,
COST(RETURNS, 6)                  // a routine's return,
COST(JUMPS, 3)                    // and a jump

// ---- the start, $C008 (main.c)
COST(START_BEFORE_WAIT, 8)        // $C008 to $C00C
COST(START_WAIT_READ, 3)          // the wait's read of $2002 comes this far into each pass of 7 cycles,
COST(START_WAIT_PASS, 7)
COST(START_WAIT_OVER, 3)          // and the pass that sees V-blank ends 3 cycles after its read
COST(START_TO_CONTROL, 6)         // $C012 to its write of $2000,
COST(START_TO_MASK, 6)            // and of $2001
COST(START_CLEARS_MEMORY, 18028)  // $C01C to $C068: work memory from $0300 up, and then the first page, a byte at a time
COST(START_TO_SOUND_ON, 12)       // $C069 to the write of $4015
COST(START_SETTINGS, 25)          // $C073 to $C086
COST(START_TASK_CALLED, 8)        // each of the three tasks it starts
COST(START_MORE_SETTINGS, 48)     // $C096 to the call of sub_ED72
COST(START_TO_INTERRUPTS_ON, 11)  // $C0B7 to the write of $2000
COST(START_TO_TURNS, 11)          // $C0C0 to $C37D

// ---- the screen's routines (screen.c)
COST(PICTURE_GOES_OFF, 11)        // sub_F171, to the yield
COST(PICTURE_COMES_ON, 14)        // sub_F17A, and back
COST(FRESH_VIEW_BACK, 48)         // $C62F: sub_C63E, and sub_C7ED to its call for the colours
COST(FRESH_ATTRIBUTES_BEGIN, 2)   // $C7FB
COST(FRESH_ATTRIBUTE, 18)         // each of the 64, to both name tables' places
COST(FRESH_ROWS_BEGIN, 38)        // $C80B back to $C64F, sub_CA27, and the call of sub_CA2E
COST(FIRST_TABLE_ROWS, 18)        // sub_CA2E to $CA43: the first name table's rows,
COST(SECOND_TABLE_ROWS, 15)       // or $CA37: the second's
COST(FRESH_ROW_CALLED, 29)        // sub_CA63 with its call, to sub_EECF
COST(FRESH_ROWS_TO_CONTROL, 14)   // $CA49 to the write of $2000
COST(FRESH_ROWS_TO_WAIT, 8)       // $CA54 to the loop that waits
COST(FRESH_ROWS_COUNTED, 5)       // $CA5E
COST(FRESH_NO_OBJECTS, 4451)      // sub_CA96 with its call, which clears the objects a byte at a time, and the jump after
COST(LOAD_TILES_BEGINS, 3)        // sub_C0D9
COST(LOAD_TILES_GROUP, 16)        // $C0DB to sub_EECF
COST(LOAD_TILES_WAITS, 3)         // $C0E6, to the loop that waits
COST(LOAD_TILES_COUNTED, 2)       // $C0EC

// ---- starting a sound, sub_ED51 and sub_03_8383 (sound.c)
COST(SOUND_PLAY_BEGINS, 47)       // sub_ED51 to sub_03_8383
COST(SOUND_PLAY_FOUND, 98)        // $8383 to $8405: the sound's place in the list, its flags and its tempo,
COST(SOUND_PLAY_FAR, 4)           // with four more for a sound whose place is past the list's first 384 bytes
COST(SOUND_VOICE_READ, 23)        // $8406 to $8411: where a voice's part is,
COST(SOUND_VOICE_NO_PART, 3)      // which it hasn't,
COST(SOUND_VOICE_PART, 19)        // or has: sub_03_838A's call, and after it
COST(VOICE_KEPT, 24)              // sub_03_838A, and back: the voice plays something that matters more,
COST(VOICE_STARTED, 183)          // or it starts
COST(SOUND_VOICE_NEXT, 18)        // $841B to $8427
COST(SOUND_PLAY_ENDS, 34)         // $842A, and $ED8D back to the bank that asked

// ---- the title screen's task, $C3DC (title.c)
COST(SOUND_MEMORY_CLEARED, 806)   // sub_ED72 to $ED97: the voices' 80 bytes
COST(SOUND_REGISTERS_BEGIN, 4)    // sub_ED97
COST(SOUND_REGISTER_OFF, 5)       // each of the 16, to its write,
COST(SOUND_REGISTER_NEXT, 2)      // and on to the next
COST(TITLE_TO_TASKS_STOPPED, 17)  // $C3E2 to sub_CAD6
COST(GAME_TASKS_STOP_BEGINS, 2)   // sub_CAD6: the view's, Arthur's and the objects' tasks are stopped,
COST(GAME_TASK_STOPPED, 6)        // $CADB to $CADE after each
COST(TITLE_SETTINGS, 34)          // $C3EE to the call of sub_C62C
COST(TITLE_LOGO_BEGINS, 35)       // sub_C668 with its call, to $C67E
COST(TITLE_LOGO_ROW, 19)          // sub_C691 with its call, to sub_EECF
COST(TITLE_LOGO_WAITS, 5)         // $C684, to the loop that waits
COST(TITLE_LOGO_COUNTED, 5)       // $C68C
COST(TITLE_SCORE_DIGITS, 148)     // sub_C744 with its call
COST(TITLE_ROW_SET_UP, 39)        // a row's source, place and size, to sub_EECF
COST(TITLE_TWO_PLAYERS, 6)        // $C6C3 or $C702: the second player's are drawn too,
COST(TITLE_ONE_PLAYER, 8)         // or aren't, with the jump past them or the one that yields
COST(TITLE_NOT_PLAYED_YET, 6)     // $C775: no third line,
COST(TITLE_PLAYED, 5)             // or one,
COST(TITLE_THIRD_LINE, 36)        // $C779 to sub_EECF
COST(TITLE_COPYRIGHT, 46)         // sub_C7CD with its call, to sub_EECF
COST(TITLE_TILES_BEGIN, 36)       // $C40F, and sub_C0C9 to sub_C0D9
COST(START_READ, 17)              // sub_EF20 with its call
COST(TITLE_SWORD_SET, 48)         // $C424 to $C44A
COST(TITLE_START_NOT_HELD, 3)     // $C44E: on to the buttons,
COST(TITLE_START_IS_HELD, 8)      // or to the call that yields
COST(SECRET_NOT_RIGHT, 20)        // $C45B to $C4A5, in the secret's first three steps: Right isn't held,
COST(SECRET_NO_BUTTON, 27)        // or it is with neither A nor B,
COST(SECRET_STILL_HELD, 27)       // or they're still held from the step before,
COST(SECRET_STEP_TAKEN, 39)       // or a step is taken
COST(SECRET_WRONG_BEFORE, 13)     // and after them: a wrong button was pressed before,
COST(SECRET_NOTHING_HELD, 29)     // or nothing is held,
COST(SECRET_SAME_HELD, 29)        // or the same buttons still are,
COST(SECRET_RIGHT, 53)            // or the buttons are the next of the run,
COST(SECRET_WRONG, 49)            // or aren't
COST(SWORD_STAYS, 15)             // $C4A5 to $C4CE: Select isn't held,
COST(SWORD_WAITS, 16)             // or is, and its count hasn't run out,
COST(SWORD_MOVES_DOWN, 42)        // or the sword moves to the next line,
COST(SWORD_BACK_TO_TOP, 48)       // or back to the first
COST(TITLE_TIME_AND_BLINK, 92)    // $C4D1 to $C44B
COST(TITLE_START_STILL_HELD, 9)   // $C456 to the call that yields
COST(TITLE_GAME_BEGINS, 119)      // $C456 to $C53B, and from there to the call that starts the game's task,
COST(TITLE_GAME_PLAYED_BEFORE, 6) // with six more once a game has been played, when it looks at the chosen line
COST(TITLE_GAME_GOES_ON, 101)     // or $C456 by $C553 to that call: the third line, with one player

// ---- the sprites' task, $F34F and sub_04_8000 (sprites.c)
COST(SPRITES_TASK_BEGINS, 2)      // $F34F to the store of the bank,
COST(SPRITES_TASK_BANK_SET, 13)   // and to the call
COST(SPRITES_SWAP_READ, 11)       // sub_04_8089, for each of five lists: the two objects' bytes read,
COST(SPRITES_SWAP_FIRST_STORED, 8) // the first's stored,
COST(SPRITES_SWAP_FOURTH_STORED, 4) // and the fourth's
COST(SPRITES_LIST_BEGINS, 4)      // $8003 to $8007, after the swap it calls first
COST(SPRITES_OBJECT_HIDDEN, 11)   // $8007: an object that isn't shown,
COST(SPRITES_OBJECT_FIRST_BYTE, 10) // or one that is: to the write of its first byte,
COST(SPRITES_OBJECT_NEXT_BYTE, 11) // each of the next three,
COST(SPRITES_OBJECT_LISTED, 15)   // and on,
COST(SPRITES_OBJECT_PAST_PAGE, 1) // and a cycle more for the objects whose flags are in the next page of memory
COST(SPRITES_LIST_FULL, 12)       // or the object that fills the list
COST(SPRITES_LIST_END_BEGINS, 2)  // $8031
COST(SPRITES_LIST_END_READ, 2)    // each of the four bytes that end the list, to its write,
COST(SPRITES_LIST_END_BYTE, 9)    // and after
COST(SPRITES_MAKE_BEGINS, 26)     // $803C to the call
COST(SPRITES_MADE, 17)            // sub_04_80D0 at the list's end, and back
COST(SPRITES_SHAPE, 169)          // $80D0 to $813C: an object's shape, places and colours found
COST(SPRITES_POINTER_ON, 20)      // sub_04_81D6, sub_04_81DD or sub_04_81E4 called: a pointer moved on by one,
COST(SPRITES_POINTER_NEXT_PAGE, 4) // and into a new page
COST(SPRITES_TABLE_PAST_PAGE, 1)  // a table's entry whose second byte is in the next page
COST(SPRITES_SPRITE_LEFT_OUT, 13) // $813E to $81BD: a sprite the shape leaves out, and $81CC to $81A9
COST(SPRITES_SPRITE_TILE_READ, 12) // $813E to $8164: a sprite's tile read,
COST(SPRITES_SPRITE_ACROSS_READ, 21) // stored, and its place across worked out,
COST(SPRITES_SPRITE_ACROSS_STORED, 9) // and stored
COST(SPRITES_SPRITE_DOWN_READ, 15) // $8167 to $8183: its place down worked out,
COST(SPRITES_SPRITE_DOWN_STORED, 9) // and stored
COST(SPRITES_SPRITE_PAST_EDGE, 29) // either place when the sum goes past 255 and still fits,
COST(SPRITES_SPRITE_OFF_LEFT, 30)  // or doesn't,
COST(SPRITES_SPRITE_OFF_RIGHT, 8)  // or goes off the far edge
COST(SPRITES_SPRITE_COLOURS_READ, 14) // $8189 to $81A6, less its calls: its colours worked out,
COST(SPRITES_SPRITE_COLOURS_STORED, 6) // stored,
COST(SPRITES_SPRITE_NEXT, 23)     // and the list's place moved on
COST(SPRITES_SPRITE_COUNTED, 5)   // $81A9
COST(SPRITES_SKIP_JUMP, 3)        // $81CC
COST(SPRITES_SHAPE_DONE, 21)      // $81AD to $81BA
COST(SPRITES_FILL_BEGINS, 14)     // $804F to $8057
COST(SPRITES_FILL_BYTE, 9)        // $8059 to the store,
COST(SPRITES_FILL_NEXT, 29)       // the store, and on to the next
COST(SPRITES_FILL_OVER, 8)        // $8059 to $8069
COST(SPRITES_COPY_BEGINS, 9)      // $8069 to $806E
COST(SPRITES_COPY_SPRITE, 5)      // $8070: each sprite's four bytes:
COST(SPRITES_COPY_READ, 4)        // a byte read,
COST(SPRITES_COPY_STORED, 14)     // stored, and counted
COST(SPRITES_COPY_SPRITE_DONE, 10) // $8080 to $8085
COST(SPRITES_TASK_ENDS, 5)        // $F359 to the store of the bank,
COST(SPRITES_TASK_BANK_BACK, 14)  // and to the call that yields
COST(SPRITES_TASK_AGAIN, 3)       // $F364: round again

// ---- the tiles' task, $E569 (screen.c)
COST(TILES_START, 109)            // $E569 to the call that yields
COST(TILES_AGAIN, 3)              // $E665
COST(TILES_TO_BANK, 2)            // $E576, to the store of the bank
COST(TILES_BEGIN, 12)             // and to $E57F
COST(TILES_FIRST_IDLE, 5)         // $E581 to $E5ED: the first list has nothing,
COST(TILES_FIRST_ACTIVE, 3)       // or has
COST(TILES_SECOND_IDLE, 10)       // $E5ED to $E65A: nor has the second,
COST(TILES_SECOND_ACTIVE, 8)      // or it has
COST(TILES_SET_GOES_ON, 8)        // $E586 or $E5F6: a set that's partway,
COST(TILES_SECOND_SET_PAGE, 1)    // with a cycle more in the second list, whose branch crosses a page,
COST(TILES_SET_BEGINS, 50)        // or one that starts, from the tables
COST(TILES_ROW, 40)               // $E5A8 or $E618 to the call
COST(TILES_ROW_KEPT, 47)          // $E5C3 or $E633 to $E5DF or $E64F
COST(TILES_FIRST_NOT_DONE, 6)     // $E5E2 to $E65A
COST(TILES_FIRST_DONE, 13)
COST(TILES_SECOND_NOT_DONE, 3)    // $E652
COST(TILES_SECOND_DONE, 10)
COST(TILES_TO_BANK_BACK, 3)       // $E65A, to the store of the bank
COST(TILES_END, 16)               // and to the call that yields

// ---- the view's task, $E68C (scroll.c)
COST(VIEW_AGAIN, 3)               // $E76C
COST(VIEW_ACROSS, 59)             // $E68C to $E6B3
COST(VIEW_SAME_COLUMN, 3)
COST(VIEW_NEW_COLUMN, 7)
COST(VIEW_HELD_ACROSS, 6)         // $E6BB, while the stage's ends don't stop it,
COST(VIEW_BETWEEN_ENDS, 27)       // or to $E6DF, between the stage's ends,
COST(VIEW_AT_FIRST_END, 41)       // at its first, and back where it was,
COST(VIEW_AT_LAST_END, 49)        // or at its last
COST(VIEW_DOWN, 38)               // $E6DF to $E70D
COST(VIEW_DOWN_TO_SCREEN_ABOVE, 54) // or past the top of its screen,
COST(VIEW_DOWN_TO_SCREEN_BELOW, 55) // or past the bottom
COST(VIEW_HELD_DOWN, 6)           // $E70D, and the same down:
COST(VIEW_BETWEEN_TOP_AND_BOTTOM, 27)
COST(VIEW_AT_TOP, 36)
COST(VIEW_AT_BOTTOM, 44)
COST(VIEW_ROW_LOOKED_AT, 19)      // $E72D to $E73E
COST(VIEW_NO_COLUMN, 6)           // $E73E
COST(VIEW_COLUMN, 11)             // or with the call of sub_E76F
COST(VIEW_ENDS, 57)               // $E745 to the call that yields
COST(COLUMN_BEGINS, 207)          // sub_E76F to its call of sub_EA73, with sub_E945, for a view that moves right,
COST(COLUMN_BEGINS_LEFT, 206)     // or left
COST(COLUMN_ADDRESS, 79)          // sub_EA73,
COST(COLUMN_ADDRESS_SECOND_TABLE, 7) // for the second name table
COST(COLUMN_LIST_BEGINS, 45)      // $E79B to $E7B5
COST(COLUMN_BLOCK_TILES, 73)      // sub_E9AB
COST(COLUMN_STARTS_UPPER, 7)      // $E7B8, from a block's upper tile,
COST(COLUMN_STARTS_LOWER, 8)      // or its lower
COST(COLUMN_TILE_LEFT, 32)        // $E7BE or $E7D5 to the count's compare: a block's left tile,
COST(COLUMN_TILE_RIGHT, 33)       // or its right
COST(COLUMN_TILES_DONE, 4)        // the branch to $E831, across a page
COST(COLUMN_COLOURS_CALLED, 6)
COST(COLUMN_NEXT_BLOCK, 20)       // $E7EF to $E7FA
COST(COLUMN_ROUND, 3)             // $E7FD
COST(COLUMN_ENDS, 34)             // $E834 to its return
COST(BLOCK_COLOURS_FIRST_TABLE, 12) // sub_EABD: which name table's colours,
COST(BLOCK_COLOURS_SECOND_TABLE, 14)
COST(BLOCK_COLOURS, 70)           // $EACE to $EAF9
COST(BLOCK_COLOURS_TOP_LEFT, 34)  // $EAFB to its return, for each quarter of an attribute byte
COST(BLOCK_COLOURS_TOP_RIGHT, 46)
COST(BLOCK_COLOURS_BOTTOM_LEFT, 55)
COST(BLOCK_COLOURS_BOTTOM_RIGHT, 64)

// ---- the objects' task, $F367 and sub_04_9CC8 (objects.c)
COST(OBJECTS_AGAIN, 3)            // $F37C
COST(OBJECTS_BEGINS, 2)           // $F367 to the store of the bank,
COST(OBJECTS_BANK_SET, 15)        // and to $9CC8
COST(OBJECT_LOOKED_AT, 4)         // $9CCA
COST(OBJECT_PAST_PAGE, 1)         // a cycle more for the objects whose flags are in the next page of memory
COST(OBJECT_UNUSED, 3)
COST(OBJECT_USED, 35)             // $9CCD to its kind's code, through the table at $9CED
COST(OBJECT_KIND_PAST_PAGE, 1)    // a cycle more for each byte of the table's entry that's in the next page
COST(OBJECT_NEXT, 4)              // $9CE4
COST(OBJECTS_END, 11)             // $9CE9 to the store of the bank,
COST(OBJECTS_BANK_BACK, 14)       // and to the call that yields
COST(PLACE_FIRST_READ, 10)        // sub_F0BC with its call, to its first write,
COST(PLACE_NEXT_READ, 7)          // each write and the read for the next,
COST(PLACE_LAST_WRITE, 9)         // and the last, and back: the same in sub_F108, sub_F0EC and $F0FA
COST(VIEW_PLACE_FIRST_READ, 9)    // sub_F108 with its call, to its first write,
COST(VIEW_PLACE_NEXT_READ, 6)     // and each of the next
COST(APART_FIRST, 20)             // sub_F0E6 with its call, to its first write: how far apart across,
COST(APART_SCREEN, 9)             // the screens,
COST(APART_DOWN, 20)              // and by way of $F0FA, down
COST(PLACE_SCREEN_COUNTED, 5)     // sub_F0A3's two counts of a screen down
COST(OBJECT_PLACED, 13)           // sub_F181 after its three calls, to the store of its line on the screen, a write at a time,
COST(OBJECT_PLACED_OTHER_SCREEN, 16) // or on another screen than the view's, to the store of the line 16 nearer,
COST(OBJECT_PLACED_LINE_TAKEN, 6) // and on to the store of its line
COST(OBJECT_PLACED_LINE, 8)       // to the store of its place across,
COST(OBJECT_PLACED_ACROSS, 11)    // and back
COST(OBJECT_SHOWN_READ_FLAGS, 12) // sub_F321 or sub_F346, with its call, to the store of its flags,
COST(OBJECT_SHOWN_STORED, 11)     // and back
COST(OBJECT_FLAG_READ, 22)        // one of the flag tests from sub_F2E3 on, with its call,
COST(OBJECT_SHOWN_READ, 18)       // or sub_F2FF's
COST(OBJECT_IN_VIEW, 19)          // sub_F0A3 after its three calls, and back: in the view,
COST(OBJECT_OUT_OF_VIEW_DOWN, 14) // or not, down,
COST(OBJECT_OUT_OF_VIEW_ACROSS, 18) // or across
COST(PRINCESS_TURN, 27)                // $F3E9, and back
COST(PICK_UP_BEGINS, 7)           // $BA09
COST(PICK_UP_HIDES, 14)           // $BA12 to sub_F346's store of its flags,
COST(PICK_UP_OUT_OF_VIEW, 48)     // and to $BB8B, and back
COST(PICK_UP_THIRD_SET_BEFORE, 16) // more, in the third set of stages, with Arthur short of $0AF8,
COST(PICK_UP_THIRD_SET_AHEAD, 24) // or past it, with the pick-up on the 12th screen or later,
COST(PICK_UP_THIRD_SET_GONE, 19)  // or before it, to the store that makes it gone,
COST(PICK_UP_THIRD_SET_GONE_STORED, 11) // and back
COST(PICK_UP_IN_VIEW, 48)         // $BA12 to the call of sub_F68E,
COST(PICK_UP_FLASHES, 8)          // with its other colour every fourth round
COST(PICK_UP_CANNOT_BE_TOUCHED, 16) // sub_F68E when Arthur's flags say so
COST(PICK_UP_LEFT, 35)            // $BA3F to $BB6A, and back
COST(PICK_UP_BONUS, 55)           // $BA3F to sub_D902: one of the four things that only give points
COST(PICK_UP_BONUS_SOUND, 8)      // $BAC6 to sub_ED51
COST(PICK_UP_WEAPON_TAKEN, 61)   // $BA3F to sub_F708: a weapon, which Arthur holds from now on
COST(GRAVESTONE_BEGINS, 80)       // sub_04_BF0B to $BF23: a gravestone, which is never shown
COST(GRAVESTONE_OUT_OF_VIEW, 9)   // $BF26, and back,
COST(GRAVESTONE_IN_VIEW, 41)      // or to sub_F5F9
COST(GRAVESTONE_NOT_HIT, 9)       // $BF36, and back,
COST(GRAVESTONE_HIT_COUNTED, 24)  // or with a hit counted, fewer than 15
COST(HIDDEN_BEGINS, 7)            // sub_04_BB8C to $BB91: a thing that's hidden until Arthur touches it
COST(HIDDEN_OUT_OF_VIEW, 5)       // $BB97 to $BB67, with sub_F346's call apart,
COST(HIDDEN_IN_VIEW, 17)          // or to sub_F68E
COST(HIDDEN_NOT_TOUCHED, 5)       // $BBA8 to $BB67
COST(HIDDEN_TOUCHED, 3)           // or to $BBAD
COST(HIDDEN_ANY_TOUCH, 3)         // $BBB0 to $BBB9: any touch will do,
COST(HIDDEN_NEEDS_A_CROUCH, 14)   // or only a crouching Arthur's, and to $BB67 when he isn't,
COST(HIDDEN_CROUCHED_AT, 10)      // or on when he is
COST(HIDDEN_OPENS, 9)             // $BBB9 to $BBCA: it isn't the armour,
COST(HIDDEN_ARMOUR_OPENS, 17)     // or is, for an Arthur without his,
COST(HIDDEN_ARMOUR_NOT_NEEDED, 19) // or to sub_F708, for one who has it
COST(HIDDEN_BECOMES_POT, 47)      // $BBCA to sub_F099: a pot, further on and up
COST(HIDDEN_POT_FALLS, 42)        // $BBEB, with $BC81, and back
COST(HIDDEN_STAYS, 34)            // sub_04_BB67 for an object that isn't shown, in a stage that isn't of the third set, and back
COST(WAITING_OUT_OF_VIEW, 5)      // sub_04_9E32's $9E38 to $BB67, with sub_F346's call apart: an enemy waiting unseen,
COST(WAITING_IN_VIEW, 17)         // or to sub_F68E,
COST(WAITING_NOT_TOUCHED, 8)      // $9E49 to $BB67, through $9EA5,
COST(WAITING_TOUCHED, 10)         // or to the store of its flags,
COST(WAITING_STATE, 17)           // to the store of its state,
COST(WAITING_KIND, 9)             // to the store of its kind,
COST(WAITING_FLIER, 4)            // to sub_F309 for the flier,
COST(WAITING_NOT_FLIER, 5)        // or past it,
COST(WAITING_COUNT, 9)            // to the store of its count,
COST(WAITING_RIGHT, 12)           // to the store of $23 for a place to the right,
COST(WAITING_LEFT, 16)            // or to the left,
COST(WAITING_MOVED_ACROSS, 27)    // and the place across, to the store of its screen,
COST(WAITING_DOWN, 19)            // to sub_F099 for a place lower,
COST(WAITING_UP, 23)              // or higher
COST(PICK_UP_ARMOUR_TAKEN, 101)   // $BA3F to sub_F708's end, and back: the armour, in the opening scene
COST(PICK_UP_ARMOUR_SOUND, 7)     // and $BA83 to sub_ED51 outside it, more than the branch past it
COST(OBJECT_REMOVED, 42)          // sub_F708, and back, for a kind it doesn't count
COST(TOUCH_SET_UP, 11)            // sub_F68E to the first store of his half height, a write at a time,
COST(TOUCH_HEIGHT, 20)            // to its second, for an Arthur who stands,
COST(TOUCH_CROUCHING, 13)         // or one who crouches, to the store of his own,
COST(TOUCH_HEIGHT_CROUCHING, 11)  // and to the second
COST(TOUCH_BOX_SIDE, 10)          // to each next store of the box's sides
COST(TOUCH_RAISED, 22)            // standing, to the store of his place 4 lines up,
COST(TOUCH_TESTS, 12)             // and to the call of sub_F63A,
COST(TOUCH_TESTS_CROUCHING, 23)   // or crouching, to it
COST(TOUCH_ENDS, 19)              // $F6D9 to the store of his place back, standing,
COST(TOUCH_LOWERED, 14)           // and back,
COST(TOUCH_ENDS_CROUCHING, 22)    // or crouching
COST(WITHIN_SAME_SCREEN, 31)      // sub_F63A to $F65D: the two are less than half a screen apart, on one screen of the stage,
COST(WITHIN_NEXT_SCREEN, 37)      // or on two,
COST(WITHIN_SAME_SCREEN_FAR, 43)  // or they're further apart, and back: on one screen,
COST(WITHIN_NEXT_SCREEN_FAR, 46)  // on two,
COST(WITHIN_SCREENS_APART, 39)    // or on screens that aren't next to each other
COST(WITHIN_ACROSS_LEFT, 16)      // $F65D to $F670: Arthur is within the box across, left of the object's place,
COST(WITHIN_ACROSS_RIGHT, 21)     // or right of it,
COST(WITHIN_ACROSS_NOT, 31)       // or isn't, and back
COST(WITHIN_DOWN_ABOVE, 27)       // $F670, and back: within the box down, above the object's place,
COST(WITHIN_DOWN_BELOW, 32)       // or below it,
COST(WITHIN_DOWN_NOT, 31)         // or not
COST(FLASH_AFTER_HIDING, 27)      // sub_EEA8 after its call of sub_F346, and back
COST(SATAN_LEAVES, 54)            // $EDA2 to $EE98's call, once he's leaving
COST(SATAN_NOT_GONE_YET, 15)      // $EE9B, and back,
COST(SATAN_GONE, 21)              // or with his flags cleared
COST(SATAN_CARRIES, 130)          // $EDA2 to $EE7A's call, with the princess, while he's below the top of the picture,
COST(SATAN_CARRIED, 30)           // and $EE7D, and back
COST(SATAN_HIGH_ENOUGH, 133)      // or $EDA2 to $EE6D's call, once he's high enough,
COST(SATAN_LEAVING_SET, 23)       // and $EE70, with sub_F309, and back
COST(SATAN_WAITS, 92)             // $EDA2 to sub_F346's end, and back, in his first 80 rounds
COST(SATAN_COMES, 73)             // $EDA2 to $EDC4, after them,
COST(SATAN_SOUND_CALLED, 10)      // with his sound on the 80th round,
COST(SATAN_NO_SOUND, 3)           // or not
COST(SATAN_FLASHES, 117)          // $EDCB to $EDE4, to the 112th round,
COST(SATAN_FLASH_HIDDEN, 9)       // and back, hidden,
COST(SATAN_FLASH_SHOWN, 13)       // or shown, with the stage dark
COST(SATAN_BEATS_WINGS, 52)       // $EDCB to sub_F321's end, and back, to the 144th round
COST(SATAN_REACHES_HER, 92)       // $EDCB to sub_F305's end, and back: within 8 pixels above her,
COST(SATAN_REACHES_HER_FROM_BELOW, 95) // or below her
COST(SATAN_FLIES, 129)            // $EDCB to $EE46's call
COST(SATAN_HEADS, 10)             // $EE49 to sub_F03E
COST(WAY_RIGHT_AND_BELOW, 81)     // sub_EF25 to $EF99, for a place less than a screen away: to the right and not above,
COST(WAY_RIGHT_AND_ABOVE, 147)    // to the right and above,
COST(WAY_LEFT_AND_BELOW, 147)     // to the left and not above,
COST(WAY_LEFT_AND_ABOVE, 114)     // or to the left and above
COST(WAY_SCREENS_HALVED_FOR_FIRST, 29)   // $EF86: both halved while the first is a screen or more,
COST(WAY_SCREENS_HALVED_FOR_SECOND, 33)  // or the second
COST(WAY_HALVED_FOR_FIRST, 21)    // $EF99: both halved while the first is 16 or more,
COST(WAY_HALVED_FOR_SECOND, 27)   // or the second,
COST(WAY_SMALL_ENOUGH, 15)        // and on to $EFAC
COST(WAY_FOUND, 38)               // $EFAC, and back
COST(MOVE_CALLED, 6)              // sub_F03E's call of sub_EFDA, to the store of the speed, a write at a time:
COST(MOVE_TABLE_HIGH, 10)         // to the store of its table's place,
COST(MOVE_TABLE_LOW, 3)           // and its low byte,
COST(MOVE_WAY_READ, 15)           // to the store of the sign, by the way it heads,
COST(MOVE_FIRST_READ, 8)          // to the store of the table's first byte for it,
COST(MOVE_THIRD_READ, 10)         // or $F014 to the third's,
COST(MOVE_SECOND_READ, 10)        // to the store of the second, or the fourth
COST(MOVE_SIGN_SET, 3)            // the sign of a way that takes away
COST(MOVE_SPEED_READ, 3)          // $EFFF or $F026 to the store of the speed for sub_F137
COST(MOVE_WAY_FORWARD, 6)         // $EFF7 or $F01E to $EFFF or $F026: a way that adds,
COST(MOVE_WAY_BACK, 7)            // or takes away, to the store of its sign
COST(MOVE_SCALE_CALLED, 9)        // and to sub_F137
COST(MOVE_RESULT_READ, 3)         // $F006 or $F02D to the store of the screens down or across,
COST(MOVE_RESULT_STORED, 6)       // to the store of the pixels, or of the 256ths
COST(MOVE_ACROSS_BEGINS, 5)       // $F010 to the store of the next sign
COST(MOVE_FOUND, 15)              // $F037, and back
COST(SCALE_BEGINS, 32)            // sub_F137 to $F14D
COST(SCALE_BIT_SHIFTED, 25)       // each bit of the speed: $F14D to its shift out of $52,
COST(SCALE_BIT_CLEAR, 6)          // and to $F16E: one that's clear,
COST(SCALE_BIT_SET, 34)           // or set
COST(MOVE_ACROSS_PART, 9)         // $F041 to the store of the 256ths across,
COST(MOVE_ACROSS_NEXT, 12)        // to the store of the pixels, or of the screens
COST(MOVE_ADDED_ACROSS, 5)         // and to $F05A
COST(MOVE_DOWN_PART, 9)           // $F05A to the store of the 256ths down,
COST(MOVE_DOWN_PIXEL, 12)         // to the store of the pixels,
COST(MOVE_DOWN_SCREEN, 12)        // to the store of the screens in $77,
COST(MOVE_DOWN_ADDED, 7)          // and to $F075
COST(MOVE_DOWN_ONLY, 2)           // sub_F099 to the store of no 256ths,
COST(MOVE_DOWN_ONLY_JUMPS, 6)     // and to $F05A
COST(ARTHUR_SIDE, 36)             // sub_FA87 with its call: which side of an object Arthur is
COST(MOVE_SAME_SCREEN, 12)        // $F075 to $F091, on the same screen down
COST(MOVE_NEXT_SCREEN_PUTS, 13)   // or past its 240 lines, to the store of the pixels,
COST(MOVE_NEXT_SCREEN_PUT, 5)     // to the store of the screen,
COST(MOVE_OTHER_SCREEN_TAKES, 10) // or on another, to the store of the pixels
COST(MOVE_NEXT_SCREEN_DOWN, 5)    // and on to $F091
COST(MOVE_OTHER_SCREEN, 8)        // and on to $F091
COST(MOVE_ENDS, 3)                // $F091 to the store of the screen down,
COST(MOVE_ENDED, 14)              // and back

// ---- Arthur's task in a stage, $DAE4 (arthur.c), and the stage's blocks (scroll.c)
COST(BLOCK_BANK_READ, 9)          // $EA55, a write at a time: sub_EA66 with its call, to the store of the bank there was,
COST(BLOCK_BANK_KEPT, 8)          // to the store of the stage's bank,
COST(BLOCK_BANK_SET, 23)          // to sub_E945's store of the rows down,
COST(BLOCK_TOP_ROW, 11)           // to the store of the screen, on the stage's top row of screens,
COST(BLOCK_ROWS_BEGIN, 20)        // or on a row below it, to the first count of rows,
COST(BLOCK_ROW_ADDED, 14)         // each next,
COST(BLOCK_ROWS_ADDED, 12)        // and from the last to the store of the screen
COST(BLOCK_SCREEN_KEPT, 10)       // to the store of the screen's list,
COST(BLOCK_SCREEN_READ, 9)        // to the first store of its place's high byte,
COST(BLOCK_LIST_HIGH, 7)          // to the low byte's,
COST(BLOCK_LIST_LOW, 6)           // to $47's,
COST(BLOCK_SIXTEENTHS, 5)         // to $48's,
COST(BLOCK_SIXTEENTHS_HIGH, 3)    // to the first shift,
COST(BLOCK_SHIFT, 5)              // a shift or a rotation,
COST(BLOCK_LIST_TAKEN, 8)         // from the end of the last to the second store of the low byte,
COST(BLOCK_LIST_LOW_TAKEN, 9)     // to the high byte's,
COST(BLOCK_LIST_HIGH_TAKEN, 14)   // to the store of the block's column,
COST(BLOCK_COLUMN, 13)            // to its row's,
COST(BLOCK_ROW, 11)               // to the store of the block,
COST(BLOCK_READ, 14)              // to the store of the bank there was,
COST(BLOCK_BANK_BACK, 17)         // and back
COST(STAGE_BLOCK_PAST_PAGE, 1)    // a cycle more for each of sub_E945's two reads that goes into the next page
COST(ARTHUR_AGAIN, 3)             // $DB7F
COST(ARTHUR_COLOURS, 44)           // sub_DC5B or sub_DC4D, with its call: his colours, in a stage or on a ladder,
COST(ARTHUR_NO_ARMOUR_COLOURS, 6)
COST(ARTHUR_TURN_CHECKS, 98)      // $DAE7 to $DAFC
COST(ARTHUR_HELD, 2)              // $DAFC's branch taken, into the next page
COST(ARTHUR_FALL_HELD, 4)         // $E299's, and the jump to $DB65
COST(ARTHUR_IS_HIT, 49)            // or $DAE7 to $E171, when his flags say he's hit
COST(ARTHUR_HIT_BEGINS, 133)      // $E171 to sub_ED51, with his armour on
COST(ARTHUR_ARMOUR_OFF, 25)       // $E195 to sub_E1EE
COST(ARTHUR_KNOCKED_BACK, 29)     // $E1A6 to $DB65
COST(ARTHUR_DIES, 47)             // or $E171 to the call that yields, without his armour
COST(ARTHUR_DEATH_SOUND, 8)       // $E1AF to sub_ED51
COST(ARTHUR_FALLEN, 26)           // $E1B7 to the call that sleeps: his bones
COST(ARTHUR_GONE, 11)             // $E1E7 to the call that ends his task
COST(ARTHUR_TIME_IS_OVER, 14)      // $E171 to sub_ED51 by $E1C2, with the stage's time over
COST(ARTHUR_TIME_OVER_SHAPE, 20)   // $E1C7 to the call that yields
COST(ARTHUR_TIME_OVER_FALLEN, 23)  // $E1D7 to the call that sleeps, with no jump to it
COST(GROUND_LOOKED_AT, 74)        // sub_E3E3 and sub_EA2F, with their calls, less the block's
COST(ARTHUR_ON_GROUND, 3)         // $DB01
COST(ARTHUR_IN_AIR, 5)            // $DB01 to $E28E
COST(ARTHUR_NOT_THROWING, 9)      // $DB06 to $DB10
COST(ARTHUR_A_NOT_HELD, 13)       // $DB10 to $DB25: A isn't held,
COST(ARTHUR_A_STILL_HELD, 13)     // or is since before,
COST(ARTHUR_JUMPS, 20)            // or is newly: to $DDF7
COST(ARTHUR_DIRECTION, 33)        // sub_DDA1 with its call: what the direction buttons ask, and $85 cleared when B isn't held,
COST(ARTHUR_DIRECTION_B_HELD, 31) // or when it is
COST(ARTHUR_NO_DIRECTION, 12)     // $DB28 to $DB65: none
COST(ARTHUR_DIRECTION_SET, 12)    // $DB28 to $DB39: his heading
COST(ARTHUR_UP_OR_DOWN, 8)        // $DB39 to $DB40: Up or Down,
COST(ARTHUR_HELD_STILL, 3)        // which his state can stop, to $DB65
COST(ARTHUR_GOES_UP, 12)          // $DB40 to $DC6B,
COST(ARTHUR_GOES_DOWN, 11)        // or to $DD65
COST(BLOCK_AT_ARTHUR, 53)         // sub_E9CE with its call, to the block at his place,
COST(BLOCK_BELOW_ARTHUR, 49)      // or sub_EA2F, to the one 11 pixels below
COST(BLOCK_BELOW_ARTHUR_NEXT_SCREEN, 11) // sub_EA2F past the screen's 240 lines, $EA44 to $EA4B, more than the branch past it
COST(LADDER_BLOCK_BELOW_ITS, 13)  // $DC41, and back: a block before a ladder's,
COST(LADDER_BLOCK_IS, 17)         // one of a ladder's,
COST(LADDER_BLOCK_PAST_ITS, 16)   // or one after them
COST(LADDER_THERE, 3)             // and the branch after sub_DC3E or sub_DC38: a ladder,
COST(LADDER_NOT_THERE, 5)         // or none, and the jump away
COST(LADDER_NOT_HIT, 42)          // $DC7E, $DCD7 or $DD1E: sub_E014 with its call, and on,
COST(LADDER_HIT, 43)              // or to $E171
COST(CLIMB_UP_NO_BUTTON, 8)       // $DC86 to $DCB2: neither Up nor Down,
COST(CLIMB_DOWN_NO_BUTTON, 9)     // or $DCDF to $DD0B, in the next page
COST(CLIMB_TURNS_ROUND, 21)       // the other of the two: his heading, and to the other way's round
COST(CLIMB_BUTTON_HELD, 20)       // $DC86 or $DCDF to the write of his place across,
COST(CLIMB_ON_THE_MIDDLE, 11)     // and to $DCA7 or $DD00
COST(CLIMB_FALLS_OFF, 5)          // his state takes him off: to $E28E,
COST(CLIMB_GOES_ON, 3)            // or doesn't
COST(CLIMB_MOVES, 14)             // $DCAC or $DD05, with sub_DB82, to sub_F03E
COST(CLIMB_SHAPE, 48)             // sub_DDB2 with its call, to $E3B9
COST(LADDER_FOOT, 27)             // $DCCC to $DCD1, with sub_E166
COST(LADDER_DOWN_HELD, 3)         // $DD68 to $DD14, when his state holds him,
COST(LADDER_DOWN_LOOKS, 2)        // or on to sub_EA2F
COST(LADDER_DOWN_NO_LADDER, 5)    // $DD6D to $DD14: solid ground under him,
COST(LADDER_DOWN_ONTO_IT, 4)      // or a ladder's top
COST(LADDER_TOP_SHAPE, 32)        // $DD74 to $DD83: his shape half over the top,
COST(LADDER_TOP_SHAPE_NO_ARMOUR, 38) // or without armour
COST(LADDER_TOP_YIELDS, 46)       // $DD83, with sub_E4E5, to the jump that yields
COST(LADDER_TOP_WAITS, 8)         // $DD86 to $DD83: neither Up nor Down,
COST(LADDER_TOP_GOES_DOWN, 22)    // Down: to $DCD7,
COST(LADDER_TOP_GOES_UP, 25)      // or Up: $DD86 to sub_E166's write of his place down,
COST(LADDER_TOP_STOOD_UP, 11)     // and back
COST(CROUCH_JUMPS, 34)            // $DD14 to $DDF7, with sub_F32E: A is held
COST(CROUCH_NO_JUMP, 6)           // or isn't: to $DD1E
COST(CROUCH_HIT, 72)              // $DD1E to $E171, with sub_E014 and sub_F32E
COST(CROUCH_HELD_STILL, 9)        // $DD2C to $DD40, when his state holds him still,
COST(CROUCH_GOES_ON, 34)          // or to $DD36, with sub_F309
COST(CROUCH_NO_BUTTON, 8)         // $DD36 to $DD40: no direction is held,
COST(CROUCH_UP_HELD, 11)          // or Up is,
COST(CROUCH_STAYS, 12)            // or he stays down: to $DD46
COST(CROUCH_FACES_ON, 8)          // $DD46 to $DD59: neither Left nor Right,
COST(CROUCH_FACES_RIGHT, 40)      // or Right, with sub_F332,
COST(CROUCH_FACES_LEFT, 38)       // or Left, with sub_F30D
COST(CROUCH_SHAPE, 49)            // sub_DDCF with its call, to $DDF4,
COST(CROUCH_THROW_SHAPE, 103)     // or by way of sub_E079, less its end
COST(CROUCH_ENDS, 29)             // $DD40, with sub_F32E, to $DB65
COST(ARTHUR_WALKS, 3)             // $DB39 to $DB4D: Left or Right
COST(ARTHUR_STEP_LEFT, 42)        // $DB4D to $DB5D: a step of his walk, facing left,
COST(ARTHUR_STEP_RIGHT, 67)       // or right
COST(ARTHUR_THROWING, 11)         // or $DB06 to $DB65, while he throws
COST(ARTHUR_VIEW_FOLLOWS, 12)     // $DB65 and $DB96, the two calls
COST(FOLLOW_ACROSS, 59)           // sub_DBFB to $DC22
COST(FOLLOW_LEFT_NEAR, 14)        // $DC24 on, and back: within 8 pixels to the left,
COST(FOLLOW_LEFT_FAR, 18)         // further,
COST(FOLLOW_RIGHT_NEAR, 13)       // less than 7 to the right,
COST(FOLLOW_RIGHT_FAR, 20)        // or more
COST(FOLLOW_DOWN, 32)             // sub_DB99 to $DBAE
COST(FOLLOW_DOWN_NEXT_SCREEN, 14) // $DBB0, past the screen's 240 lines
COST(FOLLOW_DOWN_NEXT_SCREEN_CARRIED, 8) // or past 255, by the branch at $DBA8
COST(FOLLOW_DOWN_APART, 42)       // $DBB9 to $DBD4, on the view's own screen,
COST(FOLLOW_DOWN_SCREEN_BELOW, 14) // or on another, below, to $DBE5, more than the branch at $DBD4 taken
COST(FOLLOW_DOWN_SCREEN_ABOVE, 12) // or above
COST(FOLLOW_UP_NEAR, 17)          // $DBE5 on, and back
COST(FOLLOW_UP_FAR, 21)
COST(FOLLOW_DOWN_NEAR, 16)
COST(FOLLOW_DOWN_FAR, 23)
COST(ARTHUR_AFTER_VIEW, 8)        // $DB68 to $DB7C, with neither Left nor Right held,
COST(ARTHUR_FACES_THE_BUTTON, 49)  // or facing the way the one that's held says
COST(ARTHUR_TURN_ENDS, 6)         // the call of sub_DB8A
COST(ARTHUR_SHAPE, 112)           // sub_E35E to $E3B9, with its call,
COST(ARTHUR_SHAPE_STARTS_AGAIN, 6) // his walk's count back to 0
COST(ARTHUR_FLASH_LOOKED_AT, 31)  // and sub_E3B9, and back, when he can be touched,
COST(ARTHUR_FLASH_COUNTED, 37)    // or sub_E3B9 to $E3C6, when he can't,
COST(ARTHUR_FLASHES, 51)          // $E3C6, and back: shown every other round,
COST(ARTHUR_FLASH_OVER, 25)       // or with sub_F342: 30 rounds are over
COST(ARTHUR_FLASH_CALLED, 6)
COST(ARTHUR_BUTTONS, 39)          // sub_E01E, with its call
COST(ARTHUR_BUTTONS_BUSY, 21)     // or when his state stops it
COST(ARTHUR_B_STILL_HELD, 39)     // or with B held since before, and back
COST(ARTHUR_THROW_LOOKS, 34)      // or with B newly pressed, to $E047
COST(WEAPON_SLOT_FREE, 8)         // $E047 to $E05F: a weapon's object that's free,
COST(WEAPON_SLOT_USED, 11)        // or isn't, to $E04F
COST(WEAPON_THIRD_LOOKED_AT, 4)   // $E04F to $E053, after the second
COST(WEAPON_NO_SLOT, 3)           // $E053 to $E074: all three are flying
COST(WEAPON_THIRD_ASKED, 8)       // $E053 to $E05A
COST(WEAPON_THIRD_ALLOWED, 3)     // the dagger has a third,
COST(WEAPON_ONLY_TWO, 5)          // and the others don't
COST(THROW_NOT_MADE, 11)          // $E074, and back
COST(THROW_BEGINS, 24)            // $E05F to sub_E0BE
COST(WEAPON_MADE, 62)             // sub_E0BE to $E0E7: Arthur's place, and the weapon's shape
COST(WEAPON_IS_LANCE, 9)          // $E0E7 to $E10D: its kind, by its shape
COST(WEAPON_IS_DAGGER, 14)
COST(WEAPON_IS_TORCH, 19)
COST(WEAPON_IS_AXE, 25)
COST(WEAPON_IS_CROSS, 23)
COST(WEAPON_FACES, 34)            // $E10D to sub_F2E7: the way Arthur faces
COST(THROW_STANDING, 3)           // $E129: thrown from ten pixels up,
COST(THROW_CROUCHING, 7)          // or four
COST(WEAPON_HEIGHT, 17)           // $E12F to $E149, on Arthur's screen,
COST(WEAPON_SCREEN_ABOVE, 8)      // or, less the branch taken, $E13A to the store of its line on the screen above,
COST(WEAPON_SCREEN_ABOVE_STORED, 13) // and to the store of that screen, at $E149
COST(WEAPON_HEADING_LOOKED_AT, 7) // $E149 to $E14E
COST(WEAPON_HEADS_RIGHT, 3)       // $E14E to $E161,
COST(WEAPON_LEFT_SHAPE_KEPT, 11)  // or left, with a shape that has no other,
COST(WEAPON_LEFT_AXE, 15)         // or the axe's,
COST(WEAPON_LEFT_SHAPE_TURNED, 23) // or the shape after it
COST(THROW_SOUND, 5)              // $E161 to sub_ED51
COST(THROW_ENDS, 14)              // $E06F, and back
COST(ARTHUR_THROW_SHAPE, 122)     // sub_E35E to $E3B9 by way of sub_E079, with its call, less sub_E079's end
COST(ARTHUR_THROW_GOES_ON, 8)     // $E0B2, and back,
COST(ARTHUR_THROW_OVER, 20)       // or with the throw over, after three rounds

// ---- a weapon's turn, $EB75 and $EB84 (weapons.c)
COST(WEAPON_TURN_BEGINS, 7)       // $EB75 or $EB84 to sub_F2E3
COST(LANCE_SPEED, 7)              // $EB7D to $EB90,
COST(DAGGER_SPEED, 4)             // or $EB8C
COST(WEAPON_IN_VIEW, 3)           // $EB93 to $EB9D,
COST(WEAPON_GONE, 25)             // or with sub_F734, and back: out of the view
COST(WEAPON_NOT_SPENT, 2)         // $EBA3
COST(WEAPON_BLOCK_ABOVE, 11)      // sub_E9CA with its call, to the store of the four pixels above its place,
COST(WEAPON_BLOCK_ROW, 7)         // to the store of its screen down, or $EA50's of its pixel across,
COST(WEAPON_BLOCK_LINE, 12)       // to the store of its line,
COST(WEAPON_BLOCK_SCREEN_ABOVE, 12) // or, for four pixels above its screen's top, $E9E1 to $E9EA's store,
COST(WEAPON_BLOCK_SCREEN_ABOVE_LINE, 2) // and to $E9EC's store of the screen above, with the rest as below, a cycle less
COST(WEAPON_BLOCK_SCREEN_ACROSS, 13) // to $EA4E's store of its screen across,
COST(WEAPON_BLOCK_PLACED, 3)      // and to $EA55
COST(WEAPON_FLIES_ON, 15)         // $EBA8, and back: not a gravestone
COST(WEAPON_STOPPED_BY_D0, 13)    // $EBA8 to sub_ED51: one of a gravestone's two blocks,
COST(WEAPON_STOPPED_BY_DF, 16)    // or the other
COST(WEAPON_STOPPED, 56)          // $EBB5, with sub_F30D and sub_F305, and back
COST(WEAPON_IS_SPENT, 3)          // $EB7D, $EB8C or $EBA3 to $EBC1: it's hit something
COST(WEAPON_SPENT_COUNTED, 20)    // $EBC4 to $EBD1
COST(WEAPON_SPENT_OVER, 26)       // and after four rounds, with sub_F734, and back,
COST(WEAPON_SPENT_STAYS, 11)      // or $EBD1 to sub_F2EB
COST(WEAPON_STOPPED_SHAPE_RIGHT, 24) // $EBE2, and back: its shape against a gravestone, heading right,
COST(WEAPON_STOPPED_SHAPE_LEFT, 30)  // or left
COST(WEAPON_SPARK_SHAPE, 31)      // $EBE2 to $EC01, and back: a spark's shape
COST(AXE_COUNTED, 13)            // $ECB2 to $ECBA: the axe's rounds, after sub_F32A
COST(AXE_RISES_BY_LIST, 21)       // to sub_F099, by the list at $ED07 in its first 16,
COST(AXE_FALLS, 15)               // or eight pixels down after them
COST(AXE_SHAPE, 12)               // $ECD4 to the store of its shape,
COST(AXE_COLOURS, 7)              // to the store of its colours,
COST(AXE_COLOURS_STORED, 5)       // and to sub_E9CA
COST(AXE_NOT_SOLID, 11)           // $ECE8 to $EB90: the block above isn't solid,
COST(AXE_SOLID, 19)               // or is, and isn't a gravestone's,
COST(AXE_STOPPED_BY_D0, 9)        // or is one of a gravestone's two blocks,
COST(AXE_STOPPED_BY_DF, 12)       // or the other:
COST(AXE_STOPPED, 7)              // to the store of its rounds, and on to sub_F305

// ---- the score, sub_D8FC (flow.c)
COST(SCORE_TENS_AND_HUNDREDS, 8)  // sub_D8FC to $D902: nothing for the thousands
COST(SCORE_NOT_IN_DEMONSTRATION, 19) // sub_D902, and back
COST(SCORE_BEGINS, 14)            // sub_D902 to $D90C
COST(SCORE_FIRST_DIGIT, 16)       // each of the six digits, from the last: the first added to,
COST(SCORE_NEXT_DIGIT, 14)        // the next three,
COST(SCORE_LAST_DIGITS, 13)       // and the two that only take what's carried,
COST(SCORE_DIGIT_KEPT, 3)         // each with its branch when it's nine or less,
COST(SCORE_DIGIT_OVER_NINE, 6)    // or ten taken off
COST(SCORE_BEST_BEGINS, 2)        // $D967
COST(SCORE_BEATS_BEST, 11)        // $D969 to $D983: a digit over the best score's,
COST(SCORE_BELOW_BEST, 13)        // or under it, to $D9A6,
COST(SCORE_SAME_DIGIT, 20)        // or the same, to $D977
COST(SCORE_SAME_AS_BEST, 5)       // and all seven the same, to $D9A6
COST(SCORE_BEST_KEPT, 144)        // $D983 to $D998: the best score is this one
COST(SCORE_BEST_MARKED_ALREADY, 3)
COST(SCORE_BEST_MARKED, 20)       // $D998 to $D9A6
COST(SCORE_LIFE_LOOKED_AT, 35)    // $D9A6 to $D97B: not yet the score that gives a life
COST(SCORE_ENDS, 12)              // $D97E, and back
COST(ARTHUR_TURN_YIELDS, 43)      // $DB93 and $E4E5, to the jump that yields
COST(ARTHUR_FALL_CHECKS, 66)      // $E28E to $E29B
COST(ARTHUR_LANDS, 30)            // $E29E to $DB65, with sub_E166
COST(ARTHUR_FALLS_ON, 20)         // $E29E to the call of sub_DF3E
COST(ARTHUR_FELL_LOW, 27)         // sub_DF3E, into sub_DB99,
COST(ARTHUR_FELL_HIGH, 31)        // or back
COST(ARTHUR_FELL_NEXT_SCREEN, 15) // more, past his screen's 240 lines, onto the next ($DF49)
COST(ARTHUR_FELL_ABOVE_HALF, 9)   // $E2B5
COST(ARTHUR_FELL_BELOW_HALF, 14)  // or with its call of sub_DB99
COST(ARTHUR_FALL_STRAIGHT, 17)    // $E2C2 to $E2E1, with neither Left nor Right held,
COST(ARTHUR_FALL_TURNS, 57)       // or facing the way the one that's held says, his walk's count going on
COST(ARTHUR_STARTS_IN_STAGE, 71)  // $DA71 to $DAE4
COST(ARTHUR_SCENE_BEGINS, 62)      // $DA71 to $E4F3: the opening scene, where he sits
COST(ARTHUR_WATCHES, 10)          // $E4F9 back to $E4F3, until Satan has the princess,
COST(ARTHUR_SEES, 8)              // or on
COST(ARTHUR_JUMP_CALLED, 18)      // $E500 to sub_E1EE
COST(JUMP_BEGINS, 93)             // sub_E1EE to $E215
COST(JUMP_FACES_RIGHT, 3)         // $E215,
COST(JUMP_FACES_LEFT, 9)          // or with the shape that faces left
COST(JUMP_HAS_ARMOUR, 25)         // $E21A to $E229,
COST(JUMP_NO_ARMOUR, 38)          // or with the colours and shape he has without it
COST(STAGE_JUMP_BEGINS, 40)       // $DDF7 to the call of sub_DDA1: a jump in a stage
COST(STAGE_JUMP_STRAIGHT, 15)     // $DE07 to $DE2D: straight up, with neither Left nor Right held,
COST(STAGE_JUMP_SIDEWAYS, 66)     // or the way the one that's held says
COST(STAGE_JUMP_RISES, 11)        // $DE2D to $DE35
COST(AIR_HELD, 21)                // sub_DEDD with its call, and back: his state stops it,
COST(AIR_LOOKS, 14)               // or to its call of sub_DDA1
COST(AIR_NO_TURN, 13)             // $DEE7, and back: neither Left nor Right,
COST(AIR_TURNS, 56)               // or he faces that way, and back
COST(STAGE_JUMP_NOT_HIT, 42)      // sub_E014 with its call, and on,
COST(STAGE_JUMP_HIT, 43)          // or to $E171
COST(JUMP_STRAIGHT_UP, 26)        // sub_DF5D with its call, and back: a jump straight up moves no way,
COST(JUMP_MOVES, 6)               // or on into sub_DF62
COST(JUMP_SHAPE, 61)              // sub_DF93 with its call, to $E3B9, less the way he faces:
COST(JUMP_SHAPE_RIGHT, 13)        // right,
COST(JUMP_SHAPE_LEFT, 11)         // or left
COST(JUMP_THROW_SHAPE, 125)       // or sub_DF93 by way of sub_E079, less sub_E079's end
COST(STAGE_JUMP_TOP, 11)          // $DE56 to $DE5E
COST(STAGE_JUMP_HELD, 32)         // $DE64 or $DEA7 to $DB65: held where he is,
COST(STAGE_JUMP_NOT_HELD, 2)      // or not,
COST(STAGE_JUMP_LANDS, 56)        // and on the ground: $DE69 or $DEAC to $DB65, with sub_E166
COST(WAY_AHEAD_LEFT, 67)          // sub_DF62 with its call, to the block ahead of him: heading left,
COST(WAY_AHEAD_RIGHT, 69)         // or right
COST(WAY_AHEAD_NEXT_SCREEN, 11)   // more, with the place 4 below him on the next screen down ($EA21)
COST(WAY_SOLID, 18)               // and after it, and back: the block is solid,
COST(WAY_LEFT_FREE, 25)           // or isn't, and he's clear of the picture's left edge,
COST(WAY_LEFT_EDGE, 26)           // or at it,
COST(WAY_RIGHT_FREE, 26)          // or clear of its right edge,
COST(WAY_RIGHT_EDGE, 28)          // or at it
COST(JUMP_BLOCKED, 3)             // $E22C, $E250 or $E278: something's in his way,
COST(JUMP_DRIFTS, 16)             // or nothing is: to sub_F03E
COST(ARTHUR_RISES, 45)            // sub_DF04 with its call: up, on his screen and below the picture's top rows
COST(ARTHUR_RISES_PAST_TOP, 13)   // more, past the top of his screen, onto the one above ($DF15)
COST(ARTHUR_RISES_VIEW_UP, 17)    // more, in the picture's top 48 lines, with the view asked to move up ($DF24)
COST(ARTHUR_RISE_COUNTED, 7)      // $E237
COST(JUMP_STILL_IN_AIR, 3)        // $E23F or $E268,
COST(JUMP_LANDS, 33)              // or $E23F with sub_E166, and back,
COST(JUMP_LANDS_LATE, 24)         // or $E268 with it
COST(JUMP_ABOVE_THE_BOTTOM, 9)    // $E245 or $E26D,
COST(JUMP_OFF_THE_BOTTOM, 14)     // or back, off the bottom of the picture
COST(ARTHUR_FALL_BY_LIST, 17)     // sub_DF33 with its call, to sub_DF3E,
COST(ARTHUR_FALL_BY_SEVEN, 8)     // or sub_DF3C
COST(JUMP_FALL_COUNTED, 13)       // $E25B to $E263
COST(ARTHUR_LANDED, 64)           // $E50C to $E51A
COST(ARTHUR_RESTS, 16)            // $E51D to the call that sleeps
COST(ARTHUR_STEP_BEGINS, 15)      // $E52B to sub_F03E
COST(ARTHUR_STEP_COUNTED, 7)      // $E53B
COST(ARTHUR_ARMOUR_ON, 9)         // $E541 to $E548
COST(ARTHUR_ARMOURED_RESTS, 23)   // $E54B to the call that sleeps
COST(ARTHUR_SCENE_OVER, 11)       // $E55B to the call that ends his task

// ---- the game's task before a stage, $C8C4 (flow.c)
COST(GAME_BEGINS, 202)            // $C8C4 to $C8FB: a new game's score and counts, for one player,
COST(GAME_BEGINS_DEMONSTRATION, 51) // or the demonstration's, which keeps the score
COST(GAME_LIFE_BEGINS, 11)        // the call of sub_D01D, to $D021
COST(GAME_READY_BEGINS, 12)       // the call of sub_C971, to $C976
COST(GAME_READY_TILES_BEGIN, 44)  // the call of sub_CB66, to sub_C0D9
COST(GAME_READY_BANK_BACK, 19)    // $CB82, and back
COST(GAME_READY_COLOURS, 19)      // sub_CB8B with its call, to sub_EEBA
COST(GAME_READY_WORDS, 42)        // $C982 and sub_C9F6, to sub_EECF
COST(GAME_READY_FIRST_PLAYER, 12) // $CA09, and back: no words for a second player
COST(GAME_READY_HEAD, 30)         // $C98D to $C9A5
COST(GAME_READY_LIVES, 76)        // $C9A6 to sub_EECF, with fewer than ten lives left
COST(GAME_READY_SLEEPS, 16)       // $C9E5 to the call that sleeps
COST(GAME_READY_OVER, 12)         // $C9F0, and back
COST(GAME_STAGE_COLOURS, 16)      // $D02D to sub_EEBA
COST(GAME_ATTRIBUTES, 1802)       // $D03B to $D057: 16 attributes copied and 128 set, a byte at a time
COST(GAME_NO_STAGE_CHOICE, 14)    // $D058 to $D0D5: not the demonstration, and the title's secret wasn't entered
COST(GAME_OBJECTS_BEGIN, 8)       // $D0D8 to the call that starts the objects' task
COST(GAME_MAP_LOOKED_AT, 20)      // sub_CD8E with its call, to $CD99
COST(GAME_NO_MAP, 9)              // and back: a new game has no map before its first life,
COST(GAME_MAP, 2)                 // or on to $CD9B
COST(GAME_SCENE_LOOKED_AT, 27)    // sub_CE71 with its call, to $CE82
COST(GAME_SCENE, 3)               // on to $CE85: a new game opens with the scene,
COST(GAME_NO_SCENE, 8)            // or back
COST(MAP_TILES_BEGIN, 38)         // $CD9B to sub_C0D9: the map's tiles
COST(MAP_CLEARS_FIRST, 12)        // $CDB7 and sub_CA28, the two calls
COST(MAP_CLEARS_SECOND, 3)        // $CA2B
COST(MAP_PICTURE, 52)             // $CDBA to sub_EECF: the map's picture, 192 tiles at once
COST(MAP_NAMES, 40)               // $CDE3 to sub_EECF: nine rows of 11
COST(MAP_BANK_AGAIN, 18)          // $CE00 to the call that yields, with it
COST(MAP_SOUND, 8)                // $CE0C to sub_ED51
COST(MAP_MARKER_SET, 86)          // $CE14 to the call that sleeps: the marker at the player's place
COST(MAP_MOVES, 16)               // $CE53 to the call that yields: a pixel across each round,
COST(MAP_NOT_THERE, 8)            // $CE5A back to $CE53, 112 times,
COST(MAP_THERE, 23)               // or on to the call that sleeps
COST(MAP_ENDS, 12)                // $CE6B, and back
COST(MARKER_OUT_OF_VIEW, 22)      // $FF68, with sub_F346, and back: the map's marker,
COST(MARKER_IN_VIEW, 3)           // or in the view,
COST(MARKER_BLINKS, 35)           // $FF6D, and back
COST(GAME_SCENE_STAGE, 14)        // $CE88 to sub_CF73
COST(STAGE_TILES_BEGIN, 36)       // sub_CF73 to sub_C0D9: the tiles every stage uses,
COST(STAGE_TILES_OWN, 48)         // and $CF8D to sub_C0D9: the stage's own
COST(GAME_SCENE_OWN_TILES, 49)    // $CE94 to sub_C0D9
COST(GAME_OBJECT_TILES_ASKED, 114) // $CEB7 to the call that yields
COST(GAME_SCENE_COLOURS, 18)      // $CEC8 to sub_D871
COST(STAGE_COLOURS_FOUND, 24)     // sub_D871 to sub_EEBA
COST(GAME_SCENE_OBJECT_COLOURS, 36) // $CED7 to sub_EECF
COST(FIRST_SCREEN_BEGINS, 56)     // sub_CFB0 to the call that starts the view's task
COST(FIRST_SCREEN_VIEW_SET, 68)   // $CFD6 to $D003
COST(FIRST_SCREEN_MOVES, 16)      // $D004 to the call that yields
COST(FIRST_SCREEN_NOT_THERE, 13)  // $D00F: the view isn't at the stage's first screen yet,
COST(FIRST_SCREEN_THERE, 23)      // or is, and back
COST(SCENE_SET_UP, 135)           // $CEF8 to the call that starts Arthur's task
COST(SCENE_MUSIC_CALLED, 8)       // $CF64 to sub_ED51
COST(GAME_SCENE_WAITS, 12)        // $CF6C, round to the call that yields, while the scene plays,
COST(GAME_SCENE_OVER, 8)          // or on to sub_F171
COST(GAME_STAGE_FOUND, 39)        // $D0E6 to sub_CF73: the stage this player is at,
COST(GAME_STAGE_FOUND_DEMONSTRATION, 30) // or the demonstration's
COST(GAME_STAGE_OBJECT_TILES, 51) // $D101 to sub_C0D9
COST(GAME_STAGE_OBJECT_COLOURS, 44) // $D124 to sub_EECF, for a stage that isn't the last
COST(GAME_STAGE_TILES_ASKED, 124) // $D14D to the call that yields

// ---- a stage's start, $D16E (flow.c)
COST(STAGE_START_ARTHUR, 8)       // $D16E to the call that starts Arthur's task
COST(STAGE_START_TOP, 5)          // $D176: not the demonstration, so the top of the picture is set up,
COST(STAGE_START_NO_TOP, 6)       // or it is
COST(TOP_SHAPE_COPIED, 641)       // $D17A to $D186: the 40 bytes of the top words' shape
COST(SCORE_SHOWN_BEGINS, 10)      // sub_D8D8
COST(SCORE_DIGIT_EMPTY, 31)       // each of the six digits: a 0,
COST(SCORE_DIGIT, 33)             // or not
COST(TOP_WORDS_PLACED, 41)        // $D18A to $D1A9
COST(TOP_LIVES, 44)               // sub_D9F8 with its call, with fewer than ten lives left
COST(TOP_TIME, 52)                // sub_D82B with its call
COST(STAGE_START_NO_BANNER, 8)    // $D1B0 to $D1DD, for the first two sets of stages,
COST(STAGE_START_TILES, 50)       // or $D1B0 to sub_EECF, with its call, for the third and fourth: their own tiles,
COST(STAGE_START_TILES_LATER, 48) // or for the fifth and sixth
COST(STAGE_START_WEAPON, 17)      // $D1DD to $D1EE: the weapon held,
COST(STAGE_START_WEAPON_LANCE, 22) // or the demonstration's lance
COST(STAGE_START_OWN_COLOURS, 14) // $D1EE to $D203: a weapon in its own colours,
COST(STAGE_START_TORCH_COLOURS, 15) // or the torch's, by $D1FE,
COST(STAGE_START_AXE_COLOURS, 21) // or the axe's, by $D1F9
COST(STAGE_START_COUNTS, 141)     // $D203 to $D27D, for a stage that isn't the last
COST(STAGE_START_TIME, 11)        // $D27D to sub_CAFD
COST(STAGE_MUSIC_BEGINS, 21)      // sub_CAFD to sub_ED72
COST(STAGE_MUSIC_CHOSEN, 12)      // $CB0C to sub_ED51
COST(STAGE_MUSIC_KEPT, 13)        // or sub_CAFD and back, when the music plays already,
COST(STAGE_MUSIC_DEMONSTRATION, 18) // or in the demonstration

// ---- the game's task in a stage, $D284 (flow.c)
COST(GAME_ROUND_AGAIN, 3)         // $D405
COST(GAME_ROUND_BEGINS, 54)       // $D284 to $D31D
COST(GAME_ROUND_NO_COLOURS, 8)    // $D31D, three rounds in four,
COST(GAME_ROUND_COLOURS, 13)      // or to the call of sub_D871
COST(GAME_ROUND_MIX, 15)          // $D326 to $D32F
COST(GAME_ROUND_CHECKS, 56)       // $D32F to $D385, with sub_D882
COST(TIME_STOPPED, 6)             // $D385: the time stands still,
COST(TIME_OVER_ALREADY, 11)       // or is over,
COST(TIME_LOOKED_AT, 17)          // or the frames played are looked at, to $D392
COST(TIME_NO_SECOND, 3)           // fewer than 60,
COST(TIME_SECOND, 11)             // or a second, to $D399
COST(TIME_ONES, 3)                // off the ones,
COST(TIME_TENS, 17)               // or the tens too,
COST(TIME_MINUTES, 28)            // or the minute
COST(TIME_LEFT_LOOKED_AT, 12)     // $D3AD to $D3B6
COST(TIME_IS_LEFT, 3)
COST(TIME_IS_OVER, 17)            // or none: $D3B8 to $D3C4
COST(TIME_HURRY_PLAYS, 7)         // $D3C4: the music that hurries plays already,
COST(TIME_MINUTES_LEFT, 13)       // or there's a minute or more,
COST(TIME_SECONDS_LEFT, 71)       // or less, and the seconds are worked out, to $D3E1
COST(TIME_ENOUGH, 3)              // 16 or more,
COST(TIME_HURRY_CALLED, 10)       // or fewer: to sub_ED51,
COST(TIME_HURRY_SET, 6)           // and $D3E8
COST(GAME_ROUND_OBJECTS, 17)      // $D3ED to sub_D596
COST(STAGE_OBJECT_LISTED, 79)     // sub_D596 to $D5C2: the next object's place in the stage's list, and its first byte
COST(STAGE_OBJECTS_OVER, 9)       // which is the list's end mark, and back,
COST(STAGE_OBJECT_NOT_YET, 28)    // or a screen Arthur hasn't reached, and back,
COST(STAGE_OBJECT_ON_ITS_SCREEN, 21)   // or the screen he's on,
COST(STAGE_OBJECT_PAST_ITS_SCREEN, 23) // or one he's past
COST(STAGE_OBJECT_KIND, 50)       // $D5DD to the jump through the kinds' table at $D5FB
COST(FREE_OBJECT_BEGINS, 2)       // sub_DA18
COST(FREE_OBJECT_USED, 10)        // each object that's in use,
COST(FREE_OBJECT_FOUND, 15)       // the first that isn't, and back,
COST(FREE_OBJECT_NONE, 8)         // or none, and back
COST(STAGE_OBJECT_NO_ROOM, 8)     // $D71E, and back
COST(TAKE_OBJECT_BEGINS, 9)        // sub_DA28 with its call
COST(TAKE_OBJECT_READ, 4)          // an object's flags:
COST(TAKE_OBJECT_SHOWN, 3)         // it's shown, and stays,
COST(TAKE_OBJECT_FREE, 5)          // or it's free, to $DA5A,
COST(TAKE_OBJECT_KIND_5, 13)       // or in use and not shown, to $DA4D: a kind that stays, 5,
COST(TAKE_OBJECT_KIND_F, 17)       // or $0F,
COST(TAKE_OBJECT_KIND_10, 21)      // or $10,
COST(TAKE_OBJECT_KIND_11, 25)      // or $11,
COST(TAKE_OBJECT_KIND_6_AWAKE, 34) // or 6 when it's awake,
COST(TAKE_OBJECT_KIND_6, 35)       // or to $DA5A: a 6 that's asleep,
COST(TAKE_OBJECT_OTHER_KIND, 29)   // or any other kind
COST(TAKE_OBJECT_NEXT, 10)         // $DA4D to $DA56: the next object,
COST(TAKE_OBJECT_NEXT_WRAPS, 11)   // or the first again
COST(TAKE_OBJECT_NONE, 10)         // every object stays: back
COST(TAKE_OBJECT_TAKEN, 24)        // $DA5A, and back: the next search starts after it,
COST(TAKE_OBJECT_TAKEN_WRAPS, 28)  // or at the first again
COST(STAGE_BOSS_NO_ROOM, 8)        // $D676, and back
COST(STAGE_BOSS_READ, 16)          // $D676 to $D681: its flags in the list
COST(STAGE_BOSS_COUNTED, 7)        // which count it among the stage's bosses
COST(STAGE_BOSS_STATE, 17)         // $D685 to $D6C1
COST(DRAGON_COUNT_BEGINS, 7)      // $D740 to $D746: the cave's dragon counts the objects it could take,
COST(DRAGON_OBJECT_SHOWN, 7)      // one that's shown, which it couldn't,
COST(DRAGON_OBJECT_FREE, 14)      // or one that's free, counted,
COST(DRAGON_OBJECT_KIND_F, 17)    // or one in use and not shown, of a kind that stays: $0F,
COST(DRAGON_OBJECT_KIND_10, 21)   // $10,
COST(DRAGON_OBJECT_KIND_11, 25)   // $11,
COST(DRAGON_OBJECT_KIND_5, 29)    // or 5,
COST(DRAGON_OBJECT_OTHER_KIND, 33) // or of another kind, counted
COST(DRAGON_COUNT_NEXT, 7)        // $D762: the next,
COST(DRAGON_COUNT_OVER, 6)        // or none left
COST(DRAGON_NOT_YET, 13)          // $D767, and back: fewer than nine,
COST(DRAGON_MADE_BEGINS, 13)      // or on to sub_DA28's call
COST(DRAGON_PART_FLAGS, 11)       // $D775 to the store of a part's flags from the list,
COST(DRAGON_PART_SHAPE, 7)        // to the store of its shape,
COST(DRAGON_HEAD_KEPT, 16)        // to the store of its kind for the head,
COST(DRAGON_PIECE_FLAGS, 14)      // or for a piece behind it, to the store of other flags,
COST(DRAGON_PIECE_SHAPE, 7)       // and of its own shape,
COST(DRAGON_PIECE_KIND, 8)        // and to the store of its kind
COST(DRAGON_PART_HITS, 7)         // to the store of its hits,
COST(DRAGON_PART_PLACE, 12)       // to the store of each of the four bytes of the list's place,
COST(DRAGON_PART_ACROSS, 25)      // to the store of its place across, from the copy's lists,
COST(DRAGON_PART_SCREEN, 13)      // to the store of a screen,
COST(DRAGON_PART_DOWN, 15)        // to the store of its place down,
COST(DRAGON_PART_COLOURS, 7)      // to the store of its colours,
COST(DRAGON_PART_KEPT, 7)         // to the store of its number at $06FE on,
COST(DRAGON_PART_NEXT, 20)        // and to sub_DA28's call for the next,
COST(DRAGON_PARTS_MADE, 18)       // or to $D7F7 after the last
COST(DRAGON_HEAD_READ, 4)         // the head's number, before its flag $04's test
COST(DRAGON_COUNTED, 18)          // $D7FD, and back: a boss the stage counts,
COST(DRAGON_NOT_COUNTED, 15)      // or not
COST(DRAGON_NOT_FIFTH_SET, 8)     // sub_04_B0E3 or sub_04_B355 to sub_F2E3, outside the fifth set: the cave dragon's head or a piece
COST(DRAGON_BURNING, 5)           // $B0FC or $B367 to $F6F6: it's burning,
COST(DRAGON_ALIVE, 4)             // or the head isn't, to sub_F0A3,
COST(DRAGON_PIECE_ALIVE, 3)       // or a piece isn't, to $B36C
COST(DRAGON_HEAD_OUT_OF_VIEW, 2)  // $B104 to sub_F346: the head, out of the view,
COST(DRAGON_HEAD_ASLEEP_AWAY, 8)  // asleep there, and back,
COST(DRAGON_HEAD_AWAKE_AWAY, 3)   // or awake, to $B153,
COST(DRAGON_HEAD_IN_VIEW, 3)      // or in the view, to sub_F321
COST(DRAGON_HEAD_BOX, 10)         // $B112 to sub_F585: 8 by 6
COST(DRAGON_NOT_TOUCHED, 3)       // $B11D to $B135: nothing touched it,
COST(DRAGON_TOUCHED_ARTHUR, 7)    // or Arthur did, to sub_F311,
COST(DRAGON_HIT, 15)              // or a weapon hit it that isn't the lance,
COST(DRAGON_HIT_BY_LANCE, 14)     // or the lance did, to $B12A,
COST(DRAGON_LANCE_SPARKS, 9)      // which takes the hit back, to the store of the lance's flags,
COST(DRAGON_LANCE_SPARKED, 5)     // and on to sub_F311
COST(DRAGON_UNHIT, 7)             // $B135 to $B153: no hits,
COST(DRAGON_HITS_COUNTED, 11)     // one to five, to sub_F311,
COST(DRAGON_HEAD_KILLED, 12)      // or six, to the store of its count
COST(DRAGON_DIES, 28)             // to sub_ED51, with sub_F7A5,
COST(DRAGON_DIES_QUIET, 14)       // $B146 to $B329, with the stage's music stopped
COST(DRAGON_DIES_PART_GONE, 13)   // $B329 to $B338: a part that's gone already,
COST(DRAGON_DIES_PART_HIT, 19)    // or one that's given a hit, to burn away
COST(DRAGON_DIES_NEXT, 7)         // $B338: the next,
COST(DRAGON_DIES_LAST, 6)         // or none left
COST(DRAGON_DIES_BURNS, 9)        // $B33D to sub_F305
COST(DRAGON_DIES_SCORE, 20)       // $B347 to sub_D902, through $C8C1: 1,000 points
COST(DRAGON_MUSIC, 10)            // $B153 to sub_F2EF: the boss's music
COST(DRAGON_AWAKE, 3)             // $B15E to $B184: awake,
COST(DRAGON_ASLEEP, 10)           // or asleep, to sub_F687, 32 by 32,
COST(DRAGON_WAKES, 3)             // which wakes it when Arthur's within, to $B175,
COST(DRAGON_WAITS, 15)            // or counts a round,
COST(DRAGON_STILL_WAITS, 9)       // and back,
COST(DRAGON_WAITED, 2)            // or wakes it after 64, to $B175
COST(DRAGON_WOKEN, 15)            // $B178 to $B184
COST(DRAGON_POINT_LEVEL_ABOVE, 19) // $B184 to $B196: its loop's place is within 16 pixels above,
COST(DRAGON_POINT_FAR_DOWN, 23)   // or further away down, to $B1B0,
COST(DRAGON_POINT_LEVEL_BELOW, 22) // or within 16 below, to $B196
COST(DRAGON_POINT_ACROSS_LEFT, 15) // $B196 to $B1A5: within 16 pixels to the left,
COST(DRAGON_POINT_FAR_ACROSS, 19) // or further away across, to $B1B0,
COST(DRAGON_POINT_ACROSS_RIGHT, 18) // or within 16 to the right
COST(DRAGON_POINT_NEXT, 18)       // $B1A5 to $B1B0: on to the next place
COST(DRAGON_POINT_NOT_FIFTH, 8)   // $B1B0 to $B1C8, outside the fifth set
COST(DRAGON_PLACE_PAST_SCREEN, 50) // $B1C8 to $B1F2: the place down, past a screen's 240 lines,
COST(DRAGON_PLACE_NEXT_SCREEN, 57) // or on the next screen,
COST(DRAGON_PLACE_SAME_SCREEN, 40) // or on the view's
COST(DRAGON_PLACES, 54)           // $B1F2 to sub_EF25: the place across, and its own
COST(DRAGON_HEADS, 18)            // $B217 to sub_F03E
COST(DRAGON_SHAPE_KEPT, 9)        // $B222 to sub_FA87: heading straight down or up,
COST(DRAGON_SHAPE_SET, 16)        // or not, to the store of its shape by the side it heads,
COST(DRAGON_SHAPE_STORED, 5)      // and on to sub_FA87
COST(DRAGON_FACES_AWAY_RIGHT, 20) // $B235, and back: Arthur's to the right, and it faces left,
COST(DRAGON_FACES_HIM_RIGHT, 12)  // or right, to $B24B,
COST(DRAGON_FACES_AWAY_LEFT, 19)  // or he's to the left, and it faces right,
COST(DRAGON_FACES_HIM_LEFT, 11)   // or left
COST(DRAGON_COUNTS, 7)            // $B24B to sub_F2F3: a round counted
COST(DRAGON_MOUTH_OPENS, 23)      // $B251, and back: its mouth open, in its first three rounds,
COST(DRAGON_MOUTH_CLOSES, 11)     // or after them, to sub_F33A,
COST(DRAGON_MOUTH_SHUT, 3)        // or shut, to $B261
COST(DRAGON_NOT_TIME, 15)         // $B261, and back: not a 64th round,
COST(DRAGON_FIRE_TIME, 8)         // or one, to $B268
COST(DRAGON_FIRE_TEST_PAST_D0, 15) // $B268 to $B277 or $B277 to $B286: Arthur's distance across, or down, past $D0,
COST(DRAGON_FIRE_TEST_FAILS, 25)  // or one that stops the fire, and back,
COST(DRAGON_FIRE_TEST_PASSES, 18) // or one that doesn't
COST(DRAGON_FIRE_FIRST_SLOT, 10)  // $B286 to $B293: the 21st object free,
COST(DRAGON_FIRE_SECOND_SLOT, 18) // or the 22nd,
COST(DRAGON_FIRE_NO_SLOT, 25)     // or neither, and back
COST(DRAGON_FIRE_MADE, 82)        // $B293 to sub_EF25: the fire at its place, and the way to Arthur
COST(DRAGON_FIRE_HEADED, 4)       // $B2CA to the store of the fire's heading,
COST(DRAGON_FIRE_STORE, 7)        // to the store of its flags, or of its kind,
COST(DRAGON_FIRE_MOUTH, 12)       // to the head's shape with its mouth open,
COST(DRAGON_FIRE_DONE, 13)        // $B2E1, and back
COST(DRAGON_PART_OTHER_KIND, 18)  // $B3A8 or $B3E3 on: a part that's become another kind,
COST(DRAGON_PART_FREE, 24)        // or is free,
COST(DRAGON_PART_BURNING, 27)     // or burning,
COST(DRAGON_PART_LAST_FOUND, 28)  // or there, the last, to $B3C2,
COST(DRAGON_PART_AHEAD_FOUND, 29) // or the one ahead, to $B40B
COST(DRAGON_PART_LOOKS_ON, 8)     // $B3BE or $B3F9: the part before it,
COST(DRAGON_PART_LOOKED, 7)       // or none
COST(DRAGON_PIECE_SHAPED, 7)      // $B36C to sub_F346
COST(DRAGON_PIECE_IN_VIEW, 2)     // $B377 to sub_F321 in the view,
COST(DRAGON_PIECE_AWAY, 3)        // or past it out of the view
COST(DRAGON_HEAD_GONE, 13)        // $B37C to the store of a piece's flags when the head is gone,
COST(DRAGON_HEAD_GONE_STORED, 5)  // and to $B38E,
COST(DRAGON_HEAD_AWAKE, 15)       // or awake, to $B38E,
COST(DRAGON_HEAD_ASLEEP_PIECE, 20) // or asleep, and back
COST(DRAGON_PIECE_TESTS, 20)      // $B38E to sub_F5A0 with its call, 8 by 8, shown,
COST(DRAGON_PIECE_HIDDEN, 7)      // or not, to $B39C
COST(DRAGON_PIECE_HIT, 17)        // $B39C to sub_ED51, through sub_F7B9: hit,
COST(DRAGON_TAIL_SEARCH, 5)       // $B3A4 to $B3A8
COST(DRAGON_TAIL_BURNS, 6)        // $B3C2 to the store of the last part's flags,
COST(DRAGON_TAIL_HITS, 7)         // to the store of the piece's hits,
COST(DRAGON_TAIL_COUNT, 5)        // to the store of the last part's count,
COST(DRAGON_TAIL_SCORE, 19)       // and to sub_D8FC, through $C8BE: 200 points
COST(DRAGON_PIECE_UNHIT, 7)       // $B39C to $B3DB: not hit,
COST(DRAGON_FOLLOW_BEGINS, 11)    // to $B3E3
COST(DRAGON_PIECE_LEFT_ALONE, 21) // $B3FD to sub_D8FC, through $C8BE: no part ahead, 200 points and gone
COST(DRAGON_FOLLOW_PLACES, 56)    // $B40B to $B433: its place and the one ahead's
COST(DRAGON_FOLLOW_LEVEL_ABOVE, 13) // $B433 to $B440: within 12 pixels above,
COST(DRAGON_FOLLOW_FAR_DOWN, 17)  // or further down, to sub_EF25,
COST(DRAGON_FOLLOW_LEVEL_BELOW, 16) // or within 12 below
COST(DRAGON_FOLLOW_LEVEL_LEFT, 13) // $B440 to $B453: within 12 pixels to the left,
COST(DRAGON_FOLLOW_LEVEL_RIGHT, 17) // or to the right,
COST(DRAGON_FOLLOW_FAR_ACROSS, 16) // or further across, to sub_EF25
COST(DRAGON_FOLLOW_HEADED, 5)     // $B450, the store of its heading
COST(DRAGON_FOLLOW_MOVES, 10)     // $B453 to sub_F03E
COST(DRAGON_FIRE_BEGINS, 10)      // $F3F1 to sub_F0A0's call of sub_F03E, less the call sub_F0A3's count stands for: the dragon's fire
COST(DRAGON_FIRE_BLINKS, 17)      // $F3FE to the store of its colours,
COST(DRAGON_FIRE_SHAPE, 7)        // to the store of its shape,
COST(DRAGON_FIRE_SHAPE_TURNS, 27) // with sub_F576, to the store of the next,
COST(DRAGON_FIRE_FLIES, 22)       // and to $F54D
COST(STAGE_OBJECT_STATE, 17)      // $D71E to $D6C1, for a kind whose state starts at 0,
COST(STAGE_OBJECT_STATE_LISTED, 22) // or $D72E to $D6C1, for one whose state the list gives,
COST(STAGE_OBJECT_PLATFORM, 39)   // or $D709 to $D6C1, for a moving platform: its heading and shape too,
COST(STAGE_OBJECT_STATE_KEPT, 7)  // or $D6BC to $D6C1, for one whose state is left as it was
COST(STAGE_OBJECT_STATE_KEPT_COUNTED, 18) // or $D6AC to $D6C1, the same with its count set to $CA first
COST(STAGE_OBJECT_FILLED, 95)     // $D6C1, and back
COST(GAME_ROUND_DANGERS, 15)      // $D583 to sub_02_8400
COST(DANGERS_OTHERS, 98)          // $8400 to $8415: its seven calls, and the three routines with nothing to do

// ---- the zombies, sub_02_8416 and $F7BE (enemies.c)
COST(ZOMBIES_OTHER_STAGE, 15)     // sub_02_8416, and back: a place with no zombies,
COST(ZOMBIES_FIRST_STAGE, 6)      // or the first stage, to $841F,
COST(ZOMBIES_EIGHTH_PLACE, 10)    // or the eighth place
COST(ZOMBIES_PAST_THEIR_SCREENS, 15) // $841F, and back: Arthur is past the fifth screen,
COST(ZOMBIES_COUNTED_DOWN, 13)    // or the count goes down, to $8428
COST(ZOMBIES_NOT_YET, 9)          // and back,
COST(ZOMBIES_COME, 17)            // or $8428 to $8435
COST(ZOMBIE_NONE_FREE, 9)         // $8438, and back: no object is free
COST(ZOMBIE_BEGINS, 14)           // $8438 to $8442
COST(ZOMBIE_IS_ORDINARY, 5)       // $8442 to $844B,
COST(ZOMBIE_IS_FAST, 7)           // or for every fourth
COST(ZOMBIE_SET_UP, 31)           // $844B to $845D
COST(ZOMBIE_PLACE_CHOSEN, 25)     // sub_02_84D7 with its call
COST(ZOMBIE_PLACED, 49)           // $8461 to $8480
COST(ZOMBIE_UNDER_A_JUMP, 14)     // $8481 to $8496: Arthur is in the air,
COST(ZOMBIE_ON_LOWER_GROUND, 21)  // or low in the picture,
COST(ZOMBIE_ON_UPPER_GROUND, 19)  // or high
COST(ZOMBIE_HEIGHT_SET, 14)       // $8496 to $849E
COST(ZOMBIE_COUNT_BEGINS, 18)     // sub_02_88F6 with its call, to $88FE
COST(ZOMBIE_NOT_SIXTH, 9)         // and back,
COST(ZOMBIE_SIXTH, 19)            // or $88FE to sub_DA18: the sixth, which carries a pot
COST(POT_NONE_FREE, 13)           // $890A, and back: no object is free,
COST(POT_MADE, 61)                // or the pot is made, for the first four sets of stages and not the fourth pot
COST(ZOMBIE_NEXT, 5)              // $84A2
COST(ZOMBIE_TURN_BEGINS, 25)      // $F7BE to $F7C6
COST(ZOMBIE_DYING, 27)            // or $F7BE to $F770, once it's hit
COST(ZOMBIE_DEAD_OUT_OF_VIEW, 6)  // $F776 to sub_F708: out of the view,
COST(ZOMBIE_DEAD, 13)             // or after six rounds,
COST(ZOMBIE_DIES_ON, 11)          // or $F776 to $F782
COST(ZOMBIE_DYING_SHAPE, 7)       // $F782 to sub_F2E7
COST(ZOMBIE_DIES_TO_THE_RIGHT, 3) // $F78A to $F791,
COST(ZOMBIE_DIES_TO_THE_LEFT, 9)  // or with the other shape
COST(ZOMBIE_DYING_ENDS, 37)       // $F791, and back
COST(ZOMBIE_WAS_HIT, 9)           // $F830 to $F8C5
COST(ZOMBIE_HIT, 96)              // $F8C5 to sub_D8FC
COST(ZOMBIE_HIT_SOUND, 8)         // $F8E6 to sub_ED51
COST(ZOMBIE_UNDER_THE_GROUND, 24) // $F7C6 to $F7CB
COST(ZOMBIE_NO_GROUND, 6)         // $F7CE to sub_F708
COST(ZOMBIE_WAITS_ON, 18)         // $F7CE, and back: its count isn't over,
COST(ZOMBIE_COMES_OUT, 43)        // or is, and its flag says it's out
COST(ZOMBIE_IS_OUT, 25)           // $F7C6 to $F7DC
COST(ENEMY_IN_VIEW, 3)            // the branch after sub_F0A3: it's in the view,
COST(ENEMY_OUT_OF_VIEW, 2)        // or isn't
COST(ZOMBIE_SINKING, 5)           // $F7EA to $F87D,
COST(ZOMBIE_NOT_SINKING, 3)       // or to $F7EF
COST(ZOMBIE_NOT_WALKING, 2)       // $F7F2, on to $F7F4
COST(ZOMBIE_COMES_UP, 15)         // $F7F4 to $F81E, across a page: a step of its way up,
COST(ZOMBIE_COMES_UP_FIRST, 22)   // or the first, to sub_ED51
COST(ZOMBIE_IS_UP, 67)            // $F7F4 to $F838
COST(ZOMBIE_WALKING, 20)          // $F7F2, across a page, to sub_F5A0
COST(ZOMBIE_NOT_HIT, 7)           // $F830 to $F838
COST(ZOMBIE_STEP_BEGINS, 7)       // $F838 to the call of sub_E3E3
COST(ZOMBIE_GROUND_ENDS, 3)       // $F840 to $F847: no ground under it,
COST(ZOMBIE_ROUNDS_OVER, 8)       // or its rounds are over,
COST(ZOMBIE_GOES_ON, 9)           // or it goes on, to $F852
COST(ZOMBIE_STARTS_SINKING, 36)   // $F847 to $F87D
COST(ZOMBIE_SPEED_ORDINARY, 16)   // $F855 to sub_F03E,
COST(ZOMBIE_SPEED_FAST, 18)       // or for a fast one
COST(ZOMBIE_STEP_SHAPE, 59)       // $F864 to $F878, with sub_F576
COST(ZOMBIE_TURN_COUNTED, 13)     // its count, and back
COST(ZOMBIE_SUNK, 9)              // $F87D to sub_F708
COST(ZOMBIE_SINKS, 13)            // or to sub_F88C
COST(ZOMBIE_SHAPE, 17)            // sub_F88C to $F898
COST(ZOMBIE_SHAPE_HEAD, 3)        // the shape that's only a head,
COST(ZOMBIE_SHAPE_FACES, 21)      // or one that faces a way
COST(ZOMBIE_COLOURS_PALE, 13)     // $F8A7 to $F8B1
COST(ZOMBIE_COLOURS_DONE, 9)      // and back,
COST(ZOMBIE_COLOURS_DARKER, 15)   // or $F8B1 to $F8BD,
COST(ZOMBIE_COLOURS_ITS_OWN, 15)  // and $F8BD, and back
COST(POT_BEGINS, 14)              // sub_04_BBEE to $BBF8: the pot a zombie carries
COST(POT_IS_CARRIED, 3)           // $BC06 to $BC0B,
COST(POT_IS_FALLING, 5)           // or to $BC8A
COST(POT_LANDS, 32)               // $BC8D, with sub_E166, and back: it's a thing to pick up now,
COST(POT_FALLS_ON, 7)             // or to sub_F03E
COST(POT_FOLLOWS, 47)             // $BC0B to $BC37: its carrier's place, for a zombie
COST(POT_CARRIER_THERE, 7)        // $BC37 to $BC3F,
COST(POT_CARRIER_GONE, 9)         // or to sub_F708
COST(POT_ON_A_ZOMBIE, 13)         // $BC3F to $BC60
COST(POT_STAYS_HIDDEN, 3)         // $BC66 to $BC76: out of the view,
COST(POT_SHOWN_AS_CARRIER, 21)    // or shown when its carrier is
COST(POT_CARRIER_LOOKED_AT, 10)   // $BC76 to $BC7E
COST(POT_IS_KEPT, 8)              // and back,
COST(POT_FALLS, 42)               // or $BC81, and back, once its carrier is hit
COST(CROW_BEGINS, 7)              // $F940 to $F945, after its place on the screen: a crow
COST(CROW_ALIVE, 3)               // $F948 to $F94D,
COST(CROW_DEAD, 5)                // or to $F770
COST(CROW_TESTS, 17)              // $F958, with sub_F934, to sub_F5A0
COST(CROW_NOT_HIT, 7)             // $F95B to $F984
COST(CROW_HIT, 89)                // or $F95B to sub_ED51
COST(CROW_HIT_SCORE, 21)          // $F976 to sub_D8FC
COST(CROW_SITS, 3)                // $F987 to $F98C,
COST(CROW_FLIES, 5)               // or to $F9CC
COST(CROW_HIDDEN, 9)              // $F98F, and back: it waits while it isn't shown,
COST(CROW_COUNTS, 15)             // or $F98F to $F999
COST(CROW_STILL_SITTING, 3)       // $F999 to $F99E,
COST(CROW_TAKES_OFF, 28)          // or with the flag that says it sits cleared, after 24 rounds
COST(CROW_FACES, 40)              // $F99E to the call of sub_FA87
COST(CROW_FACES_RIGHT, 3)         // $F9AE to $F9BD,
COST(CROW_FACES_LEFT, 42)         // or with the shape and heading for the left
COST(CROW_COUNT_READ, 6)          // $F9BD to $F9C2
COST(CROW_QUIET, 9)               // and back: before its 16th round,
COST(CROW_CAWS, 19)               // or in the four after, with its other shape,
COST(CROW_CAWS_OVER, 13)          // or later
COST(CROW_IN_FLIGHT, 3)           // $F9CF to $F9D4,
COST(CROW_GONE, 5)                // or to sub_F708, once it isn't shown
COST(CROW_SPEED, 13)              // $F9D4 to sub_F03E
COST(CROW_WAVE, 24)               // $F9DC to the call of sub_F099
COST(CROW_WINGS, 24)              // $F9F0 to $F9FF
COST(CROW_FLIES_RIGHT, 9)         // $FA02, and back,
COST(CROW_FLIES_LEFT, 21)         // or with the shapes for the left
COST(PLANT_ALIVE, 3)              // bank 4's $9EC3 to $9EDF: a plant
COST(PLANT_DEAD, 5)               // or to $F6F6, once it's hit
COST(BURNING_IN_VIEW, 4)          // $F6FC to $F701, across a page: an enemy that burns away, in the view,
COST(BURNING_OUT_OF_VIEW, 2)      // or out of it, to sub_F346
COST(BURNS_ON, 59)                // $F701, and back: its next shape,
COST(BURNT_AWAY, 8)               // or to sub_F708 after eight
COST(PLANT_OUT_OF_VIEW, 22)       // $9EE5, and back: it starts again,
COST(PLANT_IN_VIEW, 3)            // or on to $9EF2
COST(PLANT_NOT_HIT, 6)            // $9EF2 to $9EF7
COST(PLANT_HIT, 18)               // or $9EF2 to $9EC8 and sub_F7B4, to sub_ED51
COST(PLANT_HIT_SCORE, 50)         // $9ECB to sub_D8FC
COST(PLANT_WAITS, 2)              // $9EFA to $9EFC,
COST(PLANT_SHOOTS, 4)             // or to $9F25, across a page
COST(PLANT_LOOKS, 14)             // $9EFC to the call of sub_FA87
COST(PLANT_LOOKS_RIGHT, 3)        // $9F09 to $9F10,
COST(PLANT_LOOKS_LEFT, 9)         // or with the shape for the left
COST(PLANT_COUNTS, 13)            // $9F10 to $9F18
COST(PLANT_NOT_YET, 3)            // $9F18 to $9F22,
COST(PLANT_OPENS, 35)             // or every 16th round, with the flag that says it shoots
COST(PLANT_TESTS, 16)             // $9F22, and sub_04_9FA5 to sub_F5A0
COST(PLANT_TESTS_CALLED, 19)      // or $9F25, with its call
COST(PLANT_AIMS, 13)              // $9F28 to $9F30
COST(PLANT_AIMS_ON, 3)            // $9F30 to $9F3E, for 16 rounds,
COST(PLANT_SHOT_LOOKED_FOR, 4)    // or to $9F34
COST(SHOT_SLOT_FREE, 8)           // $9F34 to $9F4E: one of the two shots' objects is free,
COST(SHOT_SLOT_USED, 11)          // or isn't
COST(PLANT_MOUTH_OPEN, 7)         // $9F3E to the call of sub_FA87
COST(PLANT_MOUTH_RIGHT, 9)        // and back,
COST(PLANT_MOUTH_LEFT, 15)        // or with the shape for the left
COST(SHOT_MADE, 86)               // $9F4E to $9F5A, with sub_FA2E: the plant's place, eight pixels up
COST(SHOT_SAME_SCREEN, 3)         // $9F5A to $9F6A
COST(SHOT_AIMED, 62)              // $9F6A to sub_EF25: Arthur's place and the shot's
COST(SHOT_HEADED, 20)             // $9F95 to sub_ED51
COST(PLANT_SHOT, 23)              // $9FA2, with sub_F332, and back
COST(SHOT_BEGINS, 17)             // $F49C to sub_F0A0's call of sub_F03E: a plant's shot
COST(SHOT_GONE, 18)               // $F4A6, with sub_F734, and back: out of the view,
COST(SHOT_FLIES, 21)              // or $F4A6 to $F54D, less sub_F321
COST(SHOT_TESTS, 39)              // $F550 to sub_F68E, for a weapon that isn't the cross
COST(ENEMY_NOT_SHOWN, 29)         // sub_F5A0, and back, for an enemy that isn't shown
COST(ENEMY_TESTS_BEGIN, 47)       // sub_F5A0 to sub_F5F9
COST(WEAPONS_BEGIN, 2)            // sub_F5F9
COST(WEAPON_NOT_FLYING, 12)       // each of Arthur's three weapons, when it isn't shown
COST(WEAPON_SPENT, 16)            // or is, and has hit something already,
COST(WEAPON_TESTED, 17)           // or is tested: to sub_F611
COST(WEAPON_BOX, 60)              // sub_F611 to sub_F63A: the box around the enemy, wider by the weapon's own size
COST(WEAPON_MISSED, 7)            // $F607 to $F60D,
COST(WEAPON_HIT, 8)               // or back
COST(WEAPON_STOPS, 70)            // $F5A8 to $F5E2, and back: a lance or a dagger is gone, and the enemy's hits are counted
COST(WEAPONS_NONE, 8)             // $F60F, and back: none touches
COST(ENEMY_NO_WEAPON_HIT, 30)     // $F5A8 to sub_F68E
COST(AXE_HIT_IT_ALREADY, 20)      // $F5AA to $F5B9: the axe hit this enemy last, and passes it, less the branch above
COST(AXE_HITS, 77)                // $F5A8 to $F5E2, and back: the axe hits another, and flies on
COST(ENEMY_NOT_TOUCHED, 9)        // $F5E6, and back,
COST(ENEMY_TOUCHES_ARTHUR, 20)    // or with Arthur's flag that says he's hit
COST(GAME_ROUND_AFTER, 19)        // $D58D to $D595
COST(GAME_ROUND_ENDS, 48)         // $D3F0 to the call that yields
COST(GAME_LIFE_IS_OVER, 7)        // or $D3F0 to $D408, once Arthur's task has ended
COST(LIFE_OVER_WEAPON_KEPT, 38)   // $D40B to sub_CAD6: the weapon he had, and a place with no other to start again from
COST(LIFE_OVER_BACK_FROM_THIRD, 44)    // or the third place, which starts again from the second,
COST(LIFE_OVER_BACK_FROM_SIXTH, 36)    // or the sixth, from the fifth,
COST(LIFE_OVER_BACK_FROM_SEVENTH, 39)  // or the seventh
COST(LIFE_LOST, 20)               // $C8FF back to $C8FC, with a life left
COST(LAST_LIFE_LOST, 18)          // or to $C90C, with none
COST(GAME_OVER_SOUND, 8)          // $CBB0 to sub_ED51
COST(GAME_OVER_SLEEPS, 13)        // $CBB5 to sub_C313, by a jump
COST(GAME_OVER_TITLE_STARTS, 13)  // $C912 to sub_C2BC, with its call

// ---- the rows' list, sub_EECF (screen.c)
COST(ROWS_MARK_BEGINS, 2)         // sub_EECF, to the store that marks the list busy
COST(ROWS_BEGIN, 13)              // and to $EED7
COST(ROWS_ROW_BEGINS, 6)          // $EED7: a row's place in the list, to the store of its address's high byte,
COST(ROWS_ROW_NEXT_BYTE, 10)      // to the store of its low byte, and of its count,
COST(ROWS_ROW_KEPT, 12)           // and to $EEEF
COST(ROWS_BYTE_READ, 6)           // each byte: read,
COST(ROWS_BYTE_STORED, 20)        // and stored, and counted,
COST(ROWS_BYTE_NEXT_PAGE, 4)      // with four more when what's read from goes into the next page
COST(ROWS_ROW_ENDS, 26)           // $EEFF to $EF10
COST(ROWS_ROW_AGAIN, 4)           // back for the next row, across a page of the code
COST(ROWS_END_MARK, 2)            // $EF12, to the store of the list's end mark
COST(ROWS_FREED, 7)               // and to the store that frees the list
COST(ROWS_BACK, 21)               // and back
COST(PALETTE_SET_UP, 20)          // sub_EEBF to sub_EECF, for all 32 colours,
COST(HALF_PALETTE_SET_UP, 23)     // or sub_EEBA, for 16

// ---- the sound driver, sub_03_8380, which V-blank calls (sound.c)
COST(SOUND_BEGINS, 31)            // sub_ED94 to $843D
COST(SOUND_VOICE_IDLE, 10)        // $843F: a tune's voice that isn't playing,
COST(SOUND_VOICE_PLAYS, 20)       // or is, to $844B,
COST(SOUND_VOICE_AS_EFFECT, 11)   // which plays as an effect does, with its call and the jump after it,
COST(SOUND_FIRST_FREE, 20)        // or as a tune's, $844B to $8478: the first, with the noise's voice idle,
COST(SOUND_FIRST_WITH_NOISE, 28)  // or playing noise,
COST(SOUND_FIRST_SILENCED, 30)    // or playing something that silences it;
COST(SOUND_SECOND_FREE, 23)       // the second, with the effect's voice idle,
COST(SOUND_SECOND_SILENCED, 28)   // or not;
COST(SOUND_THIRD, 17)             // the third
COST(SOUND_VOICE_CALLED, 9)       // $8478 to the call
COST(SOUND_NEXT_VOICE, 28)        // $847D to $848F
COST(SOUND_NOISE_IDLE, 15)        // $8493: the noise's voice idle,
COST(SOUND_NOISE_PLAYS, 44)       // or playing noise, with its call and the jump after it,
COST(SOUND_NOISE_AS_EFFECT, 37)   // or something else, with its call
COST(SOUND_EFFECT_IDLE, 21)       // $84B5: the effect's voice idle, and back,
COST(SOUND_EFFECT_PLAYS, 22)      // or playing
COST(SOUND_PLAYS_EFFECT, 10)      // $84C7, for an effect,
COST(SOUND_PLAYS_TUNE, 12)        // or a tune's part
COST(READ_PAST_PAGE, 1)           // a byte read through a pointer or from a table, whose count takes it into the next page
COST(TUNE_WAITS, 25)              // sub_03_8626: a note that isn't over, and back
COST(TUNE_NOTE_OVER, 20)          // or is
COST(TUNE_NEXT, 12)               // $8632 to $8638
COST(TUNE_NEXT_AFTER_THREE, 39)   // $8632 to $8647, after a group of three,
COST(TUNE_BACK_A_PAGE, 18)        // and to $864F when its place goes back a page
COST(TUNE_READ, 56)               // $8651 to $8671
COST(TUNE_IS_OVER, 43)            // $8673 to $87CC, and back
COST(TUNE_IS_NOT_OVER, 3)
COST(TUNE_THREES_BEGIN, 61)       // $8678 to $8685
COST(TUNE_NOT_THREES, 5)
COST(TUNE_COUNTS_NONE, 21)        // $8688 to $8696, with no group of three,
COST(TUNE_COUNTS_THREES, 32)      // or in one
COST(TUNE_IS_NOTE, 10)            // $8697 to $869B, for a note,
COST(TUNE_IS_ORDER, 12)           // or an order
COST(TUNE_ORDER_VOLUME, 99)       // $87B3 to $8821, for order 0,
COST(TUNE_ORDER_PITCHES, 125)     // order 1,
COST(TUNE_ORDER_REPEAT, 94)       // and a repeat that goes back,
COST(TUNE_ORDER_REPEATED, 88)     // or is done, and back
COST(TUNE_NOTE_VOLUME, 42)        // $86A0 to $86B2
COST(TUNE_NOTE_SILENCED, 6)
COST(TUNE_NOTE_BEGINS, 10)        // $86B4 to $86BA
COST(TUNE_NOTE_LONGER, 28)        // $86BB to $86CA
COST(TUNE_NOTE_IS_REST, 21)       // $86BB to $86D3
COST(TUNE_NOTE_PITCH, 66)         // $86BB to $86EE
COST(TUNE_NOTE_HAS_TIMER, 4)      // $86F0, across a page
COST(TUNE_NOTE_NO_TIMER, 25)      // $86F0 to $86FD
COST(TUNE_TIMER_LOW, 21)          // $8700 to $870C
COST(TUNE_TIMER_SILENCED, 15)
COST(TUNE_NOTE_LENGTH, 47)        // $870E to $8724
COST(TUNE_TIMER_HIGH, 13)         // $8726 to $872D
COST(TUNE_TIMER_HIGH_SILENCED, 9)
COST(TUNE_LENGTH_PLAIN, 42)       // $872F to $874D
COST(TUNE_LENGTH_OF_THREE, 141)   // or through sub_03_879F and sub_03_8783
COST(TUNE_ON_BY_ONE, 54)          // $874F to $8782, on past a note of one byte,
COST(TUNE_ON_BY_TWO, 56)          // or two
COST(TUNE_LENGTH_LONGER, 75)      // $874F to $8782 for a longer note
COST(EFFECT_BEGINS, 37)           // $84D0 to $84E2
COST(EFFECT_SLIDES_UP, 13)        // $84E4 to $84EA, and $8507
COST(EFFECT_UP_PLAIN, 28)
COST(EFFECT_UP_CARRIED, 41)
COST(EFFECT_UP_KEPT, 34)
COST(EFFECT_SLIDES_DOWN, 11)      // $84E4 to $84EA, and $84EC
COST(EFFECT_DOWN_PLAIN, 35)
COST(EFFECT_DOWN_CARRIED, 50)
COST(EFFECT_DOWN_KEPT, 40)
COST(EFFECT_SLID, 58)             // $851B to $8535
COST(EFFECT_SLID_SILENT, 37)
COST(EFFECT_NEXT_STEP, 27)        // $84E4 to $8541
COST(EFFECT_STEP_NEXT_PAGE, 21)
COST(EFFECT_IS_OVER, 51)          // $854D to $8566
COST(EFFECT_STEP, 33)             // $854D to $8571
COST(EFFECT_STEP_KEEPS_PITCH, 3)
COST(EFFECT_STEP_PITCH, 39)
COST(EFFECT_STEP_ENDS, 51)        // $8585 to $859D
COST(NOISE_WAITS, 20)             // sub_03_85DA
COST(NOISE_NEXT_STEP, 52)         // to $85FF
COST(NOISE_IS_OVER, 43)
COST(NOISE_STEP, 63)              // $8601 to $8625

// ---- the flier, kind 2, sub_04_9FB0 (flier.c)
COST(OBJECT_FLAG_CHANGED, 26)     // one of the routines that set or clear a flag, from sub_F305 and sub_F32A on, with its call
COST(NEAR_LOOKED_AT, 27)          // sub_F687 with its call, to sub_F68E, for an object that's shown,
COST(NEAR_NOT_SHOWN, 34)          // or back, for one that isn't
COST(SPARK_TESTS_NOTHING, 9)      // sub_F585 after sub_F5A0, and back: nothing touched it,
COST(SPARK_TESTS_TOUCHED, 13)     // or Arthur did,
COST(SPARK_BEGINS, 24)            // or a weapon: to sub_ED51,
COST(SPARK_ENDS, 13)              // and back
COST(FLIER_SHOT_BEGINS, 20)       // $F4BC to sub_F0A0's call of sub_F03E: its shot
COST(FLIER_NOT_YET, 3)            // a branch that's taken
COST(FLIER_IS_HIGH, 2)            // and one that isn't
COST(FLIER_COUNT_READ, 6)         // a field read and tested
COST(FLIER_COUNT_READ_ON, 8)      // the same after a branch that isn't taken
COST(FLIER_STATE_IS, 5)           // a branch that isn't taken, and the jump after
COST(FLIER_MODE_IS, 11)           // $A17B on: one of the bits of what it's doing in the air is set,
COST(FLIER_MODE_IS_NOT, 9)        // or isn't
COST(FLIER_TESTS_BOX, 8)          // the box for a test, in $26 and $27
COST(FLIER_HEADS_RIGHT, 7)        // its heading, to the right,
COST(FLIER_HEADING_KEPT, 3)       // kept when Arthur is on the right,
COST(FLIER_HEADS_LEFT, 9)         // or to the left
COST(FLIER_SHAPE, 7)              // a shape,
COST(FLIER_SHAPE_KEPT, 3)         // kept,
COST(FLIER_SHAPE_TURNED, 9)       // or the one for the other side
COST(FLIER_WING, 27)              // sub_F576, and back
COST(FLIER_SPEED, 27)             // sub_04_A464 with its call, to sub_F03E,
COST(FLIER_SPEED_MOST, 28)        // or at the most
COST(FLIER_COUNTED, 10)           // sub_04_A474 to $A47C,
COST(FLIER_COUNTED_HIGH, 16)      // or with its count's high byte
COST(FLIER_IS_OLD, 8)             // $A47F, and back: its flag $20 is set,
COST(FLIER_IS_YOUNG, 26)          // or it's had fewer than 1,024 rounds,
COST(FLIER_GROWS_OLD, 57)         // or fewer than 1,056, and flashes,
COST(FLIER_GROWN_OLD, 74)         // or the flag is set, with sub_F319
COST(FLIER_SHOOT_BEGINS, 14)      // sub_04_A4B0 with its call, to sub_F687
COST(FLIER_TOO_NEAR, 9)           // $A4B9, and back: Arthur is too near,
COST(FLIER_SHOOTS_NOW, 13)        // or to $A4CD on the 16th round of 32,
COST(FLIER_NO_SHOT, 24)           // or back on another,
COST(FLIER_NO_SECOND_SHOT, 27)    // or when $5B lets it shoot on the 24th too, and it isn't that,
COST(FLIER_SHOOTS_AGAIN, 22)      // or is
COST(FLIER_SHOT_FREE, 10)         // $A4CD to $A4DA: the first shot's object is free,
COST(FLIER_SECOND_SHOT_FREE, 18)  // or the second's,
COST(FLIER_NO_SHOT_FREE, 25)      // or neither, and back
COST(FLIER_SHOT_MADE, 95)         // $A4DA to sub_EF25: the shot's place, and Arthur's
COST(FLIER_SHOT_HEADED, 20)       // $A51B to sub_ED51
COST(FLIER_SHOT, 30)              // $A528, with sub_F315, and back
COST(FLIER_DODGE_BEGINS, 46)      // sub_04_A41E with its call, to sub_F5F9
COST(FLIER_DODGE_NOT_SHOWN, 61)   // or back, when it isn't shown
COST(FLIER_NO_WEAPON_NEAR, 8)     // $A42A, and back
COST(FLIER_WEAPON_NEAR, 3)        // or on to $A42D
COST(FLIER_DODGES_IN_THE_AIR, 3)  // $A430 to $A453
COST(FLIER_DODGE_HEIGHT, 14)      // $A430 to $A43B: on the ground, how far down from Arthur
COST(FLIER_DODGE_NOT_LEVEL, 9)    // $A43B to $A453
COST(FLIER_DODGE_LEVEL_BELOW, 15) // $A43B to $A44D: level with him, and how far across,
COST(FLIER_DODGE_LEVEL_ABOVE, 19) // the same from just above
COST(FLIER_STAYS_LEFT_OF_HIM, 9)  // $A44D, and back: close on his left,
COST(FLIER_STAYS_RIGHT_OF_HIM, 13) // or his right,
COST(FLIER_DODGE_FAR_ENOUGH, 6)   // or on to $A453
COST(FLIER_TAKES_OFF, 39)         // $A453, with sub_F311, and back
COST(FLIER_FACES, 33)             // $A38C to sub_FA87, with sub_F332
COST(FLIER_FACES_RIGHT, 9)        // $A397, and back,
COST(FLIER_FACES_LEFT, 41)        // or with sub_F30D
COST(FLIER_WAKES, 40)             // sub_04_A37F to $A38C, with sub_F309
COST(FLIER_PLACE_HIGH, 18)        // sub_04_A3A2 with its call, to $A3AD: 64 pixels down,
COST(FLIER_PLACE_HIGH_FOR_LOW, 17) // or 80 when Arthur is low,
COST(FLIER_PLACE_HIS_HEIGHT, 10)  // or $A36B to sub_04_A3AD: his own height
COST(FLIER_PLACE_ON_SCREEN, 27)   // $A3AD to $A3C9: the height in the stage, on the view's screen,
COST(FLIER_PLACE_NEXT_SCREEN, 41) // or past its 240 lines,
COST(FLIER_PLACE_NEXT_SCREEN_CARRIED, 38) // or past 256
COST(FLIER_PLACE_LEFT, 7)         // $A3CC to $A3D5: 32 pixels from the left,
COST(FLIER_PLACE_RIGHT, 5)        // or the right
COST(FLIER_PLACE_ACROSS, 19)      // $A3D5 to $A3E2
COST(FLIER_PLACE_HEIGHT_OFF, 11)  // $A3E2 to $A3EA
COST(FLIER_PLACE_HEIGHT_REACHED, 3) // to $A3F0: within five pixels of the height, from above,
COST(FLIER_PLACE_HEIGHT_REACHED_FROM_BELOW, 6) // or below,
COST(FLIER_PLACE_HEIGHT_FAR, 7)   // or to $A3FF
COST(FLIER_PLACE_SIDE_OFF, 11)    // $A3F0 to $A3F8
COST(FLIER_PLACE_REACHED, 9)      // and back: within five pixels across,
COST(FLIER_PLACE_REACHED_FROM_LEFT, 12) // from the left,
COST(FLIER_PLACE_SIDE_FAR, 7)     // or to $A3FF
COST(FLIER_PLACE_WAY, 34)         // $A3FF to sub_EF25
COST(FLIER_PLACE_HEADED, 10)      // $A416 to sub_F03E
COST(FLIER_AIR_SHAPE, 7)          // $A1F5 to sub_F576, by way of $A212
COST(FLIER_AIR_SHAPE_AFTER_SHOT, 37) // or $A1F5 to $A211, with its arms out,
COST(FLIER_AIR_SHAPE_SHOT_OVER, 46)  // or to $A212, with sub_F33A
COST(FLIER_LEVEL_LOOKED_AT, 12)   // $A33B to $A344
COST(FLIER_IS_LEVEL, 3)           // to $A34A,
COST(FLIER_IS_LEVEL_FROM_ABOVE, 6)
COST(FLIER_NOT_LEVEL, 7)          // or to $A36B
COST(FLIER_LANDS, 38)             // $A35E to $A38C, with sub_F336
COST(FLIER_COMES_LEVEL, 16)       // $A325 to $A33B
COST(FLIER_DIVE_HEIGHT, 8)        // $A28B to $A291
COST(FLIER_DIVE_ENDS, 24)         // $A291 to the call of sub_04_A474
COST(FLIER_DIVE_ACROSS, 12)       // $A2AB to $A2B4
COST(FLIER_DIVE_NEAR_RIGHT, 3)    // to $A2BA: Arthur is less than 96 pixels to its right,
COST(FLIER_DIVE_NEAR_LEFT, 6)     // or its left,
COST(FLIER_DIVE_FAR, 8)           // or further, to $A307
COST(FLIER_DIVE_DOWN, 10)         // $A2BA to $A2C1
COST(FLIER_DIVE_BELOW_HIM, 3)     // to $A2C7: it's below him,
COST(FLIER_DIVE_ABOVE_HIM, 6)     // or less than 48 pixels above,
COST(FLIER_DIVE_HIGH_ABOVE_HIM, 8) // or more, to $A307
COST(FLIER_SLIDES_RIGHT, 12)      // $A2C7 to $A2D4
COST(FLIER_SLIDES_LEFT, 16)
COST(FLIER_SLID, 33)              // $A2D4 to $A2EB
COST(FLIER_SLIDE_KEPT, 4)         // to $A307, across a page
COST(FLIER_SLIDE_DOUBLED, 13)     // $A2EB to $A2F3
COST(FLIER_SLIDE_LEFT_SLOW, 8)    // $A2F3 to $A307: still under 16 to the left,
COST(FLIER_SLIDE_LEFT_FASTEST, 14) // or 12 from now on,
COST(FLIER_SLIDE_RIGHT_SLOW, 8)   // and the same to the right
COST(FLIER_SLIDE_RIGHT_FASTEST, 16)
COST(FLIER_WAITS_ON, 10)          // $A215 to $A283
COST(FLIER_DIVE_APART, 33)        // $A215 to $A22B: how far across Arthur is
COST(FLIER_DIVE_APART_LEFT, 20)   // $A22B to $A23A, when he's on the left
COST(FLIER_DIVE_SIXTEENTH, 69)    // $A23A to the call of sub_FA87
COST(FLIER_DIVE_SPEED_LEFT, 15)   // $A24B to $A256
COST(FLIER_DIVE_AIMED, 79)        // $A256 to sub_EF25, by sub_FA58
COST(FLIER_DIVE_HEADED, 17)       // $FA83, back, and to $A266
COST(FLIER_DIVE_TURNED_BACK, 15)  // $A266 to $A270
COST(FLIER_DIVE_STRAIGHT_DOWN_FROM_LEFT, 12) // $A270 to $A283, by $A27E
COST(FLIER_DIVE_TURNED_ON, 16)    // $A266 to $A27C, by $A274
COST(FLIER_DIVE_STRAIGHT_DOWN, 9) // $A27C to $A283
COST(FLIER_WAIT_BEGINS, 33)       // $A1C6 to sub_04_A474
COST(FLIER_GROUND_TURNED, 28)     // $A069 to $A06E, with sub_F30D
COST(FLIER_GROUND_TAKES_OFF, 41)  // $A073, with sub_F311, and back
COST(FLIER_GROUND_TESTS, 18)      // $A073 to the call of sub_F585
COST(FLIER_GROUND_HITS_READ, 8)   // $A08B to $A08F
COST(FLIER_GROUND_LAST_HIT, 12)   // $A08F, and back: its fourth hit,
COST(FLIER_GROUND_HIT, 18)        // or an earlier one: to $A09E
COST(FLIER_GROUND_FLINCH_OVER, 16) // $A0AA to $A0C9
COST(FLIER_GROUND_SHOT_OVER, 42)  // $A0DB to $A0F5, with sub_F33A
COST(FLIER_GROUND_RUNS, 4)        // $A0FD to $A154, across a page
COST(FLIER_GROUND_RUN_OVER, 13)   // $A160 to $A16A
COST(FLIER_GROUND_STEPS_AWAY, 13) // $A11E to $A128
COST(FLIER_GROUND_RUN_BEGINS, 13) // $A132 to $A13C
COST(FLIER_OUT_OF_VIEW, 2)        // $9FB6 to sub_F346
COST(FLIER_WAITS, 9)              // $9FBE, and back, while it's asleep
COST(FLIER_AWAY_LOOKED_AT, 2)     // $9FBE to sub_FA87
COST(FLIER_AWAY_ACROSS, 12)       // $9FC3 to sub_F708: Arthur is a screen or more away across,
COST(FLIER_NEAR_ACROSS_LEFT, 5)   // or to $9FCB: less, on the left,
COST(FLIER_NEAR_ACROSS_RIGHT, 8)  // or the right
COST(FLIER_AWAY_DOWN_LOOKED_AT, 20) // $9FCB to $9FDA
COST(FLIER_NEAR_ABOVE, 9)         // and back,
COST(FLIER_NEAR_BELOW, 13)
COST(FLIER_AWAY_DOWN, 9)          // or to sub_F708
COST(FLIER_IN_VIEW, 10)           // $9FB6 to sub_F2F7
COST(FLIER_COLOURS_YOUNG, 9)      // $9FEC to $9FF1
COST(FLIER_HITS_READ, 9)          // $9FF4 to $9FFE
COST(FLIER_KILLED, 13)            // $9FFE to sub_ED51, by sub_F7B4
COST(FLIER_KILLED_SCORE, 56)      // $A003 to sub_D902
COST(FLIER_SITS, 30)              // $A02B to $A049
COST(FLIER_SITS_IN_SIXTH_SET, 39) // or with the wider box of the sixth set of stages
COST(FLIER_SEES_HIM, 8)           // $A04C to sub_04_A37F
COST(FLIER_SLEEPS_ON, 13)         // $A05A, and back
COST(FLIER_WOKEN_BY_HIT, 12)      // or to sub_04_A37F

// ---- a moving platform, kind $0E, sub_04_B84D, and the eyeball raft, kind $0D, from $B85A (platform.c)
COST(PLATFORM_BEGINS, 17)         // $B84D to $B864,
COST(RAFT_BEGINS, 14)             // or for kind $0D, $B85A to $B864
COST(PLATFORM_IN_VIEW, 3)         // $B86A to $B86F,
COST(PLATFORM_OUT_OF_VIEW, 2)     // or to sub_F346
COST(PLATFORM_LEFT_END, 34)       // $B86F to $B888: its left end, and how far it is,
COST(PLATFORM_RIGHT_END, 35)      // or by $B88C its right
COST(PLATFORM_AT_LEFT_END, 3)     // to $B8A0: at its left end,
COST(PLATFORM_GOES_LEFT, 5)       // or to $B8AD
COST(PLATFORM_AT_RIGHT_END, 2)    // and the same going right
COST(PLATFORM_GOES_RIGHT, 3)
COST(PLATFORM_TURNS, 29)          // $B8A0 to $B8AB, with sub_F2FF
COST(PLATFORM_TURNED_SHOWN, 3)    // to $B8BB: no move the round it turns, while it's shown,
COST(PLATFORM_TURNED_HIDDEN, 2)   // or to $B8AD
COST(PLATFORM_MOVES, 8)           // $B8AD to the call of sub_F0A0
COST(PLATFORM_NOT_SHOWN, 27)      // $B8BE, and back, when it isn't shown
COST(PLATFORM_ARTHUR_RISES, 35)   // or when Arthur is on his way up in a jump,
COST(PLATFORM_ARTHUR_HELD, 42)    // or is held already
COST(PLATFORM_ARTHUR_LOOKED_AT, 47) // or $B8BE to $B8D9: how far above it he is
COST(PLATFORM_ARTHUR_BELOW, 9)    // and back: he's below it,
COST(PLATFORM_ARTHUR_HIGH, 13)    // or 13 pixels or more above,
COST(PLATFORM_ARTHUR_ON_TOP, 6)   // or on to $B8DF
COST(PLATFORM_WIDTH, 28)          // $B8DF to $B8F6, for kind $0E's width,
COST(PLATFORM_OTHER_WIDTH, 19)    // or the other's
COST(PLATFORM_ARTHUR_ON_RIGHT_HALF, 16) // $B8F6 to $B905: he's over its right half,
COST(PLATFORM_ARTHUR_ON_LEFT_HALF, 20)  // or its left,
COST(PLATFORM_ARTHUR_OFF, 28)     // or past an end, and back
COST(PLATFORM_HOLDS, 10)          // $B905 to $B90D: his flag $10
COST(PLATFORM_LIFTS, 12)          // $B90D to $B916: his place down, 12 pixels above its own
COST(PLATFORM_SAME_SCREEN, 13)    // $B916 to $B931, on its own screen,
COST(PLATFORM_SCREEN_ABOVE, 25)   // or the one above
COST(PLATFORM_CARRIES, 8)         // $B931 to the call of sub_EFDA
COST(PLATFORM_CARRIES_PART, 9)    // $B93A to $B940: his place across, moved as it moves, a store at a time,
COST(PLATFORM_CARRIES_ACROSS, 11) // to $B948,
COST(PLATFORM_CARRIES_SCREEN, 11) // to $B950,
COST(PLATFORM_CARRIED, 11)        // and to the call of sub_F181
COST(PLATFORM_ENDS, 12)           // $B95A, and back


// ---- a flame of the fourth stage's bridge, kind $0F, sub_04_B9AD (bridge.c)
COST(FLAME_OUT_OF_VIEW, 5)        // $B9B3 to the store at $B9C4: out of the view, its count,
COST(FLAME_COUNT_CLEARED, 7)      // to the store at $B9C9: its flags,
COST(FLAME_OUT, 11)               // and back
COST(FLAME_IN_VIEW, 4)            // or $B9B3 to the store at $B9B7: in the view, its box across,
COST(FLAME_BOX_ACROSS, 5)         // to the store at $B9BB: up and down,
COST(FLAME_BOX_UP_AND_DOWN, 3)    // to the call of sub_F687
COST(FLAME_ARTHUR_AWAY, 4)        // $B9C0 to the store at $B9C4: Arthur isn't within it,
COST(FLAME_ARTHUR_NEAR, 3)        // or is: to the call of sub_F321
COST(FLAME_COUNTED, 21)           // $B9D0 to the store at $B9DD: its count on (INC's write at its start), and its shape,
COST(FLAME_SHAPED, 15)            // to the store at $B9E7: the touch box's height,
COST(FLAME_HEIGHT, 5)             // to the store at $B9EB: its colours,
COST(FLAME_COLOURS, 7)            // to the store at $B9F0: the touch box's width,
COST(FLAME_TOUCH_BOX, 6)          // and the jump to $F5E3


// ---- the flying knights, sub_02_84E0 and kind 3, sub_04_A530 (enemies.c)
COST(BRANCH_TAKEN, 3)             // a branch that's taken
COST(KNIGHTS_OTHER_SET, 16)       // sub_02_84E0, and back, outside the first set of stages
COST(KNIGHTS_LOOKED_AT, 17)       // sub_02_84E0 to $84EE: the screen Arthur is on
COST(KNIGHTS_ELSEWHERE, 14)       // $84EE, and back, by $84F9: neither the eighth nor the ninth
COST(KNIGHTS_EIGHTH_SCREEN, 8)    // $84EE to $84F5
COST(KNIGHTS_TOO_EARLY, 11)       // and back: less than 64 pixels into it,
COST(KNIGHTS_THERE, 4)            // or on to $8504, across a page
COST(KNIGHTS_NINTH_SCREEN, 13)    // $84EE to $8502, by $84F9
COST(KNIGHTS_PAST, 10)            // and back: 144 pixels into it or more
COST(KNIGHTS_NOT_YET, 15)         // $8504, and back: the count isn't down yet,
COST(KNIGHTS_COME, 22)            // or to $8513
COST(KNIGHT_NONE_FREE, 10)        // $8516, and back: no object is free
COST(KNIGHT_SET_UP, 49)           // $8516 to the call of sub_02_84D7
COST(KNIGHT_PLACED, 29)           // $8539 to the call of sub_02_88F6
COST(KNIGHT_NEXT, 5)              // $854F
COST(POT_FOURTH, 30)              // $8936 to $894B, more than the branch past it: the fourth pot's own contents
COST(POT_CONTENTS_READ, 22)       // $894B to $895A
COST(POT_CONTENTS_CHOSEN, 3)      // and back,
COST(POT_CONTENTS_HELD_ALREADY, 10) // or on to the next, for a weapon Arthur has
COST(POT_ON_KIND_6, 4)            // $BC29 to $BC37, more than a zombie's: the other kinds that carry a pot,
COST(POT_ON_KIND_7, 8)
COST(POT_ON_KIND_4, 11)
COST(POT_ON_NO_CARRIER, 15)       // or to sub_F708, for one that doesn't
COST(KNIGHT_WAITS, 18)            // $A533, and back: its rounds of waiting aren't over,
COST(KNIGHT_APPEARS, 66)          // or are: at the right of the view, with sub_F30D, and back
COST(KNIGHT_DEAD, 5)              // $A54E to $F6F6
COST(KNIGHT_TESTS, 17)            // $A54E to sub_F5A0
COST(KNIGHT_NOT_HIT, 7)           // $A55C to $A58B: no weapon hit it,
COST(KNIGHT_SHIELD, 22)           // or one that wasn't heading left: spent on its shield,
COST(KNIGHT_KILLED, 32)           // or one that was: to sub_ED51, by sub_F7B9
COST(KNIGHT_KILLED_SCORE, 50)     // $A570 to sub_D8FC
COST(KNIGHT_KILLED_ENDS, 8)       // $A581 to $F6F6
COST(KNIGHT_SOUND_SET, 17)        // $A58B to sub_F321
COST(KNIGHT_VIEW_LOOKED_AT, 16)   // $A59B to $A5A6
COST(KNIGHT_PASSED, 10)           // $A5A6 to sub_F708: past the view's left edge
COST(KNIGHT_WAVE, 68)             // $A5A6 to sub_F099: its shape, and its height in the wave
COST(KNIGHT_MOVES, 8)             // $A5D9 to sub_F03E
COST(KNIGHT_ROUND_COUNTED, 24)    // $A5DE, and back
COST(ASKED_SOUND_WAITS, 13)       // $D2AE to $D2C5, more than the branch past it: a sound an enemy asked for waits,
COST(ASKED_SOUND_PLAYS, 21)       // or goes to sub_ED51,
COST(ASKED_SOUND_PLAYED, 10)      // and $D2BD to $D2C5

// ---- the stage's next part, $D341 (flow.c), and the half-solid blocks of sub_E3E3 (objects.c)
COST(NEXT_PART_BEGINS, 34)        // $D33F to $D358, more than the branch past it
COST(NEXT_PART_KEEPS_2, 5)        // to $D374, for the parts that keep their time and counts
COST(NEXT_PART_KEEPS_5, 9)
COST(NEXT_PART_KEEPS_6, 13)
COST(NEXT_PART_COUNTS, 25)        // $D358 to $D36C, for the others
COST(NEXT_PART_MUSIC_CALLED, 8)   // $D36C to sub_CAFD
COST(NEXT_PART_TIME, 52)          // $D371, with sub_D82B
COST(NEXT_PART_CLEARS, 2)         // $D374
COST(NEXT_PART_OBJECT_KEPT, 11)   // $D376 to $D383: an object that's shown,
COST(NEXT_PART_OBJECT_CLEARED, 17) // or isn't, and is gone
COST(GROUND_HALF_BLOCK_76, 20)    // $E3EA to the end by $E402, more than a plain block's: the block $76,
COST(GROUND_HALF_BLOCK_77_OPEN, 22) // or $77, by $E40A: its right half,
COST(GROUND_HALF_BLOCK_77_SOLID, 21) // or its left
COST(GROUND_HALF_BLOCK_OTHER_SET_76, 9) // and outside the first set of stages
COST(GROUND_HALF_BLOCK_OTHER_SET_77, 5)

// ---- the forest's enemy, sub_02_8610 and kind 4, sub_04_A66A (forest.c)
COST(FOREST_OTHER_PART, 14)       // sub_02_8610, and back: from the stage's fourth part on,
COST(FOREST_BEFORE, 21)           // or with the view before the tenth screen,
COST(FOREST_PAST, 24)             // or past the twelfth
COST(FOREST_IN_RANGE, 19)         // or to $8621
COST(FOREST_NOT_YET, 14)          // $8621, and back: the count isn't down yet,
COST(FOREST_COMES, 17)            // or to the call of sub_DA18
COST(FOREST_NONE_FREE, 9)         // $862F, and back: no object is free
COST(FOREST_SET_UP, 42)           // $862F to the call of sub_02_84D7
COST(FOREST_PLACED, 58)           // $8650 to the call of sub_02_88F6
COST(FOREST_DEAD, 5)              // $A66D to $F6F6
COST(FOREST_HITS_READ, 7)         // $A66D to $A675
COST(FOREST_KILLED, 13)           // $A675 to sub_ED51, by sub_F7B4
COST(FOREST_KILLED_SCORE, 50)     // $A67A to sub_D8FC
COST(FOREST_ALIVE, 16)            // $A675 to $A698
COST(FOREST_TURNS, 5)             // $A698 to $A778
COST(FOREST_WAIT_COUNTED, 9)      // $A6A0 to $A6A5
COST(FOREST_WAITS, 9)             // and back,
COST(FOREST_STARTS, 68)           // or $A6A5 to sub_FA87, with sub_F30D and sub_F32E
COST(FOREST_STARTS_RIGHT, 9)      // $A6BA, and back,
COST(FOREST_STARTS_LEFT, 41)      // or with sub_F309
COST(FOREST_SOUND_SET, 13)        // $A6A0 to sub_F321
COST(FOREST_OUT_OF_VIEW, 8)       // $A6D3 to $A6DA
COST(FOREST_GONE, 5)              // to sub_F708, when it's leaving
COST(FOREST_RISE_COUNTED, 15)     // $A6E5 to $A6EF
COST(FOREST_IS_UP, 25)            // $A6EF, with sub_F311, and back
COST(FOREST_RISE_SHAPE, 24)       // $A6EF to $A702
COST(FOREST_RISE_FIRST_SHAPE, 9)  // and back,
COST(FOREST_RISE_SHAPE_LEFT, 21)  // or with the shape for the left
COST(FOREST_UP_BEGINS, 24)        // $A6E5 to sub_F576, by $A713
COST(FOREST_UP_SHAPE, 27)         // sub_F576, and back
COST(FOREST_UP_SHAPE_LEFT, 15)    // $A721 to $A72C, with the shape for the left
COST(FOREST_STATE_READ, 6)        // $A72C to $A731
COST(FOREST_COUNT_READ, 8)        // a branch not taken, and its count read and tested
COST(FOREST_TURN_BEGINS, 35)      // $A738 to $A752
COST(FOREST_TURN_HEADS_DOWN, 9)   // $A752 to $A759
COST(FOREST_ATTACK_OVER, 35)      // $A763 to $A76D, with sub_F33E
COST(FOREST_MOVES, 8)             // $A76D to sub_F03E
COST(FOREST_TESTS_BEGIN, 29)      // $A7F4 to sub_F5A0
COST(FOREST_TESTS_END, 19)        // $A808, and back
COST(FOREST_ATTACK_COUNT, 9)      // $A815 to $A853, when it's readied
COST(FOREST_ATTACK_WAITS, 8)      // and back, three rounds in four
COST(FOREST_LOOK_COUNTED, 20)     // $A815 to $A822
COST(FOREST_LOOK_NOT_YET, 9)      // and back,
COST(FOREST_LOOKS, 19)            // or $A822 to sub_F687
COST(FOREST_AHEAD_RIGHT, 9)       // $A839 to $A849: Arthur is on its right,
COST(FOREST_NOT_AHEAD, 9)         // and it isn't heading right: back
COST(FOREST_AHEAD_LEFT, 8)        // $A839 to $A840: on its left,
COST(FOREST_NOT_AHEAD_LEFT, 11)   // and it isn't heading left
COST(FOREST_READIES, 23)          // $A84B, with sub_F319, and back
COST(FOREST_SHOT_FREE, 10)        // $A856 to $A863: the first shot's object is free,
COST(FOREST_SECOND_SHOT_FREE, 18) // or the second's,
COST(FOREST_NO_SHOT_FREE, 25)     // or neither, and back
COST(FOREST_SHOT_LOOKS, 10)       // $A863 to sub_F687
COST(FOREST_SHOT_DOWN, 7)         // $A86E to $A88A: Arthur is close by,
COST(FOREST_SHOT_AHEAD_RIGHT, 14) // or on its right, the way it's heading,
COST(FOREST_SHOT_NOT_AHEAD_RIGHT, 21)  // or it isn't heading there, and back,
COST(FOREST_SHOT_AHEAD_LEFT, 14)  // or on its left, the way it's heading,
COST(FOREST_SHOT_NOT_AHEAD_LEFT, 22)   // or it isn't
COST(FOREST_SHOT_PLACED, 78)      // $A88A to $A890, with sub_FA2E: the shot's heading and place
COST(FOREST_SHOT_MADE, 33)        // $A890 to $A898, with sub_F319
COST(FOREST_SHOT_SOUND, 8)        // $A898 to sub_ED51
COST(FOREST_SHOT_BEGINS, 17)      // $F41C to sub_F0A0's call of sub_F03E: its shot
COST(FOREST_SHOT_FLIES_DOWN, 32)  // $F426 to $F54D, less sub_F321: it flies down,
COST(FOREST_SHOT_FLIES_RIGHT, 40) // or to the right,
COST(FOREST_SHOT_FLIES_LEFT, 46)  // or to the left
COST(BOSS_DEAD, 5)                // $FBC7 to $F6F6: the boss, dead,
COST(BOSS_BEGINS, 11)             // or to sub_F346
COST(BOSS_OUT_OF_VIEW, 4)         // $FBE1 to $FC04, across a page: out of the view,
COST(BOSS_IN_VIEW, 10)            // or to sub_F585, less sub_F321
COST(BOSS_NOT_HIT, 4)             // $FBEF to $FC04, across a page: nothing touched it,
COST(BOSS_TOUCHED, 8)             // or Arthur did,
COST(BOSS_HIT, 16)                // or a weapon,
COST(BOSS_HIT_BY_CROSS, 28)       // or the weapon of kind $27, whose hit is taken back
COST(BOSS_ASLEEP, 23)             // $FC04 to $FC62: fewer than ten hits, and asleep
COST(BOSS_AWAKE, 32)              // or awake, to sub_F2EF, with the sound it asks for
COST(BOSS_TURN_ELSEWHERE, 5)      // a flag sends the turn to its own routine,
COST(BOSS_TURN_STEPS, 6)          // or none does, to $FD3F
COST(BOSS_STEP_READ, 12)          // $FD3F to $FD48: the step's speed
COST(BOSS_STEP_STANDS, 5)         // none: to $FE34
COST(BOSS_NO_LOOK, 9)             // $FD4D to $FD67, three rounds in four,
COST(BOSS_LOOKS_FOR_WEAPONS, 22)  // or to sub_F5F2 and its own call of sub_F2FF
COST(BOSS_WEAPONS_NOT_SHOWN, 28)  // which goes back for a boss that isn't shown,
COST(BOSS_WEAPONS_SHOWN, 21)      // or on to sub_F5F9
COST(BOSS_DODGE_SET, 32)          // $FD5D, with sub_F315, and back: a weapon is coming
COST(BOSS_STEP_GOES_ON, 9)        // $FD67 to $FDFF: the step has rounds left,
COST(BOSS_STEP_OVER, 7)           // or to $FD6F
COST(BOSS_NEXT_STEP, 45)          // $FD6F to sub_F687
COST(BOSS_FAR, 9)                 // $FD91 to sub_FA87: Arthur is far,
COST(BOSS_FAR_RIGHT, 6)           // on its right, to $FDC1,
COST(BOSS_FAR_LEFT, 12)           // or on its left
COST(BOSS_NEAR_LOOKS, 13)         // $FD91 to the second call of sub_F687
COST(BOSS_CLOSE, 9)               // $FDB0 to sub_FA87: Arthur is close
COST(BOSS_TURNS_AWAY, 9)          // $FDBA to $FDC1, with the heading changed
COST(BOSS_LEAP_BEGINS, 22)        // $FDC1 to sub_FA87: a 64th step
COST(BOSS_HEADS_LEFT, 9)          // a heading changed to the left, after sub_FA87
COST(BOSS_LEAP_SET, 23)           // $FDDC, with sub_F319, and back
COST(BOSS_NOT_A_LEAP, 9)          // $FDC1 to $FDDF
COST(BOSS_CHARGE_SET, 38)         // $FDDF, with sub_F311, and back: an eighth step
COST(BOSS_NOT_A_CHARGE, 9)        // $FDDF to $FDEE
COST(BOSS_NEXT_READ, 12)          // $FDEE to $FDF7: the next step's speed
COST(BOSS_NEXT_STANDS, 15)        // none, and back
COST(BOSS_WALK_BEGINS, 14)        // $FDFF to sub_FA87
COST(BOSS_SHAPE_RIGHT, 3)         // after sub_FA87: the shape stays, facing right,
COST(BOSS_SHAPE_LEFT, 9)          // or changes to the one facing left
COST(BOSS_WALK_MOVES, 38)         // $FE11 to sub_F0A0
COST(BOSS_STAYS_IN_VIEW, 9)       // after sub_F0A0, and back: still in the view
COST(BOSS_STAND_BEGINS, 7)        // $FE34 or $FE58 to sub_FA87
COST(BOSS_STAND_SHOOTS, 18)       // $FE43 to $FCA4, on the second round,
COST(BOSS_STAND_WAITS, 27)        // or back,
COST(BOSS_STAND_OVER, 33)         // or back with the step over, on the sixth
COST(BOSS_SHOT_FREE, 10)          // $FCA4 to $FCB2: the first shot's object is free,
COST(BOSS_SECOND_SHOT_FREE, 19)   // or the second's,
COST(BOSS_NO_SHOT_FREE, 24)       // or neither, and back
COST(BOSS_SHOT_PLACED, 91)        // $FCB2 to $FCD0, with sub_FA2E: its place, four pixels up,
COST(BOSS_SHOT_PLACED_A_SCREEN_UP, 112) // or on the screen above
COST(BOSS_SHOT_SET, 21)           // $FCD0 to sub_FA87
COST(BOSS_SHOT_RIGHT, 9)          // and back: to the right,
COST(BOSS_SHOT_LEFT, 22)          // or to the left
COST(BOSS_CHARGE_NO_TURN, 9)      // $FE67 to $FE7D, three rounds in four,
COST(BOSS_CHARGE_TURNS, 15)       // or to sub_FA87
COST(BOSS_CHARGE_OVER, 38)        // $FE7D, with sub_F336, and back: 24 rounds are over,
COST(BOSS_CHARGE_MOVES, 40)       // or to sub_F0A0
COST(BOSS_DIES, 38)               // $FC04 to sub_ED51, with sub_F7A5: ten hits
COST(BOSS_DIES_ELSEWHERE, 8)      // $FC13 to sub_F305,
COST(BOSS_DIES_IN_SECOND_SET, 13) // or with the second set's own sound to follow
COST(BOSS_DIES_SCORE, 30)         // $FC21 to sub_D902
COST(BOSS_DIES_ENDS, 8)           // $FC33 to $F6F6
COST(BOSS_BURNS_ON, 54)           // $F701, and back, for a boss, kind 5: its next shape,
COST(BOSS_9_BURNS_ON, 58)         // or kind 9,
COST(BOSS_15_BURNS_ON, 61)        // or kind $15
COST(BOSS_BURNT_AWAY, 14)         // $F708 to sub_F2EB, after BURNT_AWAY's 8: kind 5,
COST(BOSS_9_BURNT_AWAY, 18)       // or kind 9,
COST(BOSS_15_BURNT_AWAY, 21)      // or kind $15
COST(BOSS_NOT_COUNTED, 3)         // $F725 to $F72F: it wasn't one of the stage's count,
COST(BOSS_OTHERS_LEFT, 10)        // or others are left,
COST(BOSS_WAS_THE_LAST, 14)       // or none
COST(BOSS_REMOVED, 20)            // $F72F, and back
COST(GAME_ROUND_BEGINS_KEY_THERE, 42) // $D284 to $D31D with the key there, which skips the two sounds' counts
COST(AFTER_BOSS_WAITS, 8)         // $D28D to $D2A6, more than the branch past it
COST(AFTER_BOSS_PLAYS, 24)        // or to sub_ED51,
COST(AFTER_BOSS_PLAYS_HURRIED, 24) // with the hurried music,
COST(AFTER_BOSS_PLAYED, 6)        // and $D2A1 to $D2A6
COST(KEY_COMES, 279)              // $D3FA to sub_ED51, with sub_D529, more than the branch past it
COST(KEY_BEGINS, 25)              // sub_04_BC9C to sub_F346
COST(KEY_FALLS, 9)                // $BCBA to sub_F03E
COST(KEY_IN_THE_AIR, 8)           // $BCCA, and back
COST(KEY_LOOKS, 8)                // $BCD0 to sub_F687
COST(KEY_NOT_TAKEN, 9)            // $BCD9, and back
COST(KEY_TAKEN, 37)               // or to sub_D902
COST(ARTHUR_HAS_THE_KEY, 8)       // $DAE7 to $E423, with the key taken
COST(GATE_FIRST_TILES, 76)        // $E429 to sub_EECF: the gate's first tiles,
COST(GATE_SECOND_TILES, 62)       // or $E476 to sub_EECF: its second
COST(GATE_SOUND, 21)              // $E45E to sub_ED51
COST(GATE_RESTS, 16)              // $E46B to the call that sleeps
COST(GATE_RESTS_AGAIN, 29)        // $E4A1 to the call that sleeps
COST(GATE_WALK_BEGINS, 14)        // $E4B4 to $E4C1, less sub_F332
COST(BLOCK_BEHIND_ARTHUR, 52)     // sub_EA01 with its call, to the block 8 pixels left of him and 4 down
COST(GATE_REACHED, 19)            // $E4C4 to the call that ends his task: a block of the gate's,
COST(GATE_NOT_YET, 19)            // or one below them, to sub_F03E, with sub_DB82's call,
COST(GATE_NOT_YET_PAST, 23)       // or one above
COST(GAME_STAGE_IS_CLEARED, 12)   // $D3F0 to $D436, once Arthur is through the gate
COST(CLEARED_NO_OBJECTS, 4448)    // sub_CA96 with its call, which clears the objects a byte at a time
COST(GAME_MAP_ASKED_FOR, 18)      // sub_CD8E with its call, to $CD9B, after a stage that's been cleared
COST(GAME_NO_SCENE_AFTER_A_STAGE, 31) // sub_CE71 with its call, and back, after one
COST(GAME_NEXT_PLACE, 52)         // $D442 to $D01D: the player's next place
COST(GAME_NEXT_PLACE_BEGINS, 5)   // $D01D to $D021
COST(BOSS_JUMP_HEIGHT, 36)        // sub_FF36 with its call, to sub_F099
COST(BOSS_DODGE_FACES_RIGHT, 4)   // $FCFA to $FD04, across a page
COST(BOSS_JUMP_SHAPE_LEFT, 7)     // the shape that faces left
COST(BOSS_DODGE_SPEED, 12)        // $FD07 to sub_F0A0: the step's speed across
COST(BOSS_DODGE_GOES_ON, 22)      // $FD18, and back, for its first 15 rounds,
COST(BOSS_DODGE_LANDS, 15)        // or to sub_F33A
COST(BOSS_DODGE_OVER, 24)         // $FD25 to sub_FA87: the next step
COST(BOSS_DODGE_OVER_LEFT, 15)    // and back, with the shape that faces left
COST(BOSS_LEAP_SPEED, 2)          // $FEBC to sub_F0A0
COST(BOSS_LEAP_GOES_ON, 21)       // $FEC6, and back, for its first 15 rounds,
COST(BOSS_LEAP_LANDS, 16)         // or to sub_F33E
COST(BOSS_LEAP_OVER, 17)          // $FED4, and back: it turns round
COST(BOSS_SHOT_BEGINS, 17)        // $F524 to sub_F0A0's call of sub_F03E: the boss's shot
COST(BOSS_SHOT_GONE, 19)          // $F52E, with sub_F734, and back: out of the view,
COST(BOSS_SHOT_FLIES_RIGHT, 27)   // or $F530 to $F54D, less sub_F321: to the right,
COST(BOSS_SHOT_FLIES_LEFT, 33)    // or to the left
COST(BOSS_NOT_SHOWN, 9)           // $FC65, and back: it isn't shown,
COST(BOSS_LOOKS, 27)              // or to sub_F687
COST(BOSS_NEAR, 3)                // $FC82 to $FCA0: Arthur is near,
COST(BOSS_ARTHUR_BELOW, 30)       // or isn't, and is below it: back,
COST(BOSS_WAITED, 32)             // or to $FCA0 after 40 rounds,
COST(BOSS_WAITS, 46)              // or before, and back,
COST(BOSS_HIT_AWAKE, 39)          // or to $FCA0 with three hits
COST(BOSS_WAKES, 23)              // sub_FF1D with its call, to sub_F2F7
COST(BOSS_WAKES_PLAIN, 13)        // $FF2C to sub_F32E,
COST(BOSS_WAKES_READY, 19)        // or with its count cleared
COST(BOSS_FACES_RIGHT, 9)         // $FF57, and back: Arthur is on its right,
COST(BOSS_FACES_LEFT, 9)          // or to sub_F309
COST(FOREST_TURN_MOVES, 8)        // $A778 to sub_F03E
COST(FOREST_TURN_COUNTED, 13)     // $A77D to $A785
COST(FOREST_TURN_ENDS, 53)        // $A785 to $A7F4, by $A7C8: the turn is over,
COST(FOREST_TURN_ENDS_BACK, 55)   // the same for the turn back
COST(FOREST_TURN_SHAPE_1, 16)     // $A785 to $A798: the four shapes of the turn
COST(FOREST_TURN_SHAPE_2, 18)
COST(FOREST_TURN_SHAPE_3, 26)     // to $A7B7
COST(FOREST_TURN_SHAPE_4, 24)
COST(FOREST_TURN_SHAPE_FLIPPED, 18)      // $A79B to $A7C5, with the shape for the other side,
COST(FOREST_TURN_SHAPE_BACK_FLIPPED, 15) // or $A7BA to $A7C5

// ---- the second stage's start (flow.c, scroll.c)
COST(STAGE_OBJECT_LEFT_OUT, 11)   // $D66D, and back: a kind the list names that isn't placed
COST(STAGE_OBJECT_COUNT_LISTED, 17) // or $D695 to $D6C9, for one whose count the list gives, less the two writes at $D6C1 it jumps past
COST(STAGE_BLOCK_ROWS_DOWN, 7)    // $E949 to $E951 and the end of its loop, more than the branch past them
COST(STAGE_BLOCK_ROW_DOWN, 14)    // each row of screens above the place's
COST(TOWER_DANGER_BEFORE, 12)     // $874C to $875D, more than its branch there: before Arthur's seventh screen, and not his fifth,
COST(TOWER_DANGER_FIFTH_SCREEN, 8)  // or to $875E, on his fifth,
COST(TOWER_DANGER_LATER_SCREENS, 16) // or on his seventh to tenth,
COST(TOWER_DANGER_PAST, 15)       // or past them
COST(KIND_7_ALL_MADE, 14)         // sub_02_8574, and back: three made already,
COST(KIND_7_OTHER_PART, 20)       // or not the stage's fifth part,
COST(KIND_7_LOOKED_AT, 15)        // or to $8581,
COST(KIND_7_BEFORE, 23)           // and back: Arthur is short of $04E0,
COST(KIND_7_PAST, 39)             // or at $05C0 or past it,
COST(KIND_7_IN_RANGE, 32)         // or between, to $859B
COST(KIND_7_NOT_YET, 14)          // and back: the count isn't out,
COST(KIND_7_COME, 27)             // or is, to the call of sub_DA18
COST(KIND_7_NONE_FREE, 9)         // $85B0, and back: no object is free,
COST(KIND_7_SET_UP, 46)           // or one is, to the call of sub_02_84D7
COST(KIND_7_PLACED, 36)           // $85D0 to the call of sub_02_88F6
COST(KIND_7_NEXT, 8)              // $85EB, round again,
COST(KIND_7_LAST, 13)             // or back
COST(WINDOW_IS_HIT, 5)            // sub_04_AA52 to $F770
COST(WINDOW_IS_NOT_HIT, 3)        // or to $AA57
COST(WINDOW_COLOURS, 7)           // $AA57 to sub_F2EB
COST(WINDOW_WAITS, 2)             // $AA5F to sub_F0A3: not out of its window yet
COST(WINDOW_WAITS_UNSEEN, 9)      // $AA64, and back: out of the view,
COST(WINDOW_WAITS_ON, 18)         // or in it, with rounds of its count left,
COST(WINDOW_COMES_OUT, 11)        // or none, to sub_F30D
COST(WINDOW_COMES_OUT_SOUND, 5)   // $AA6E to sub_ED51, by a jump
COST(WINDOW_IS_OUT, 3)            // or out of it, to sub_F321
COST(WINDOW_IN_VIEW, 3)           // $AA7A to $AA93
COST(WINDOW_OUT_OF_VIEW, 10)      // or out of the view, to $AA83
COST(WINDOW_GONE, 13)             // and gone, running off, by a jump to sub_F708,
COST(WINDOW_GONE_NONE_LEFT, 17)   // with none counted left
COST(WINDOW_HIDDEN, 3)            // or hidden, to sub_F346
COST(WINDOW_NOT_RISEN, 2)         // $AA96 to $AA98
COST(WINDOW_RISES, 13)            // $AA98 to $AAA0
COST(WINDOW_RISING, 20)           // and back: one of its six steps,
COST(WINDOW_RISEN, 16)            // or the last, to sub_F32E
COST(WINDOW_FACES_LEFT, 6)        // $AAB2 to sub_F309, Arthur on its left, and less the jump to sub_F311 after
COST(WINDOW_HAS_RISEN, 3)         // $AA96 to $AAC7
COST(WINDOW_TESTS, 14)            // $AAC7 to sub_F5A0, with its call
COST(WINDOW_NOT_KILLED, 8)        // $AAD0 to $AB04, across a page
COST(WINDOW_KILLED, 6)            // or to sub_F32E
COST(WINDOW_FALL_SIDE, 19)        // $AAD8 to sub_F305
COST(WINDOW_ONE_LESS, 8)          // $AAE8 to sub_F7B9: one fewer made,
COST(WINDOW_NONE_LEFT, 12)        // or none
COST(WINDOW_KILLED_SOUND, 11)     // sub_F7B9 with its call, to sub_ED51
COST(WINDOW_KILLED_SCORE, 21)     // $AAF6 to sub_D8FC, by two jumps
COST(WINDOW_MOVES, 14)            // $AB04 to sub_F576's call
COST(WINDOW_SHAPE_PICKED, 33)     // sub_F576 with its call, to sub_F2E7
COST(WINDOW_SHAPE_KEPT, 3)        // $AB12 to $AB1D
COST(WINDOW_SHAPE_TURNED, 15)     // or turned round
COST(WINDOW_MODE_DROPS, 9)        // $AB1D to $AB35
COST(WINDOW_LANDS, 15)            // $AB35, as low as Arthur: to sub_F315, less the jump
COST(WINDOW_DROPS, 26)            // or higher, to sub_F099, with its call
COST(WINDOW_DROPS_HIGH, 14)       // $AB48 to sub_F03E, by a jump: above the 120th line,
COST(WINDOW_DROPS_LOW, 38)        // or below it, with speed left,
COST(WINDOW_DROPS_LOWEST, 39)     // or none
COST(WINDOW_MODE_RUNS, 21)        // $AB1D to $AB73
COST(WINDOW_RUNS, 12)             // $AB73 to sub_F03E, by a jump
COST(WINDOW_STOPS_RUNNING, 7)     // or its 16th round, to sub_F33A, less the jump to sub_F319 after
COST(WINDOW_MODE_HOPS, 26)        // $AB1D to $AB8D
COST(WINDOW_HOPS_OVER, 26)        // $AB8D, and back: the hop's over,
COST(WINDOW_HOPS, 24)             // or to sub_F099, with its call,
COST(WINDOW_HOP_TURNS, 45)        // or turning round on its fourth round
COST(WINDOW_HOP_MOVES, 5)         // $ABBC to sub_F03E, by a jump
COST(WINDOW_RUNS_OFF, 31)         // $AB1D to sub_F03E, by two jumps: running off
COST(BIG_THIS_SET, 12)            // sub_04_ABC1 to $ABD4, outside the fourth and fifth sets of stages
COST(BIG_FOURTH_SET, 8)           // or to $ABCB in the fourth,
COST(BIG_FIFTH_SET, 11)           // or the fifth
COST(BIG_GONE_THERE, 10)          // $ABCB to sub_F708, by a jump: $DF is 3,
COST(BIG_STAYS_THERE, 8)          // or isn't
COST(BIG_COLOURS, 7)              // $ABD4 to sub_F321
COST(BIG_IN_VIEW, 3)              // $ABDF to $ABEF
COST(BIG_OUT_OF_VIEW, 2)          // or to sub_F346
COST(BIG_GONE_BURNT, 15)          // $ABE7, and back: out of the view once hit, it's gone,
COST(BIG_HIDDEN, 3)               // or it's hidden
COST(BIG_IS_HIT, 5)               // $ABF2 to $F6F6
COST(BIG_TESTS, 13)               // or to the call of sub_F585, its box 8 by 8
COST(BIG_NOTHING_TOUCHED, 3)      // $AC02 to $AC11: nothing touched it,
COST(BIG_TOUCHED_ARTHUR, 7)       // or Arthur,
COST(BIG_SPARKS, 11)              // or a weapon, which sparks: to sub_F319
COST(BIG_STILL_STANDS, 9)         // $AC11 to $AC2F: fewer than ten hits,
COST(BIG_KILLED, 19)              // or ten, to sub_ED51, by sub_F7B4
COST(BIG_KILLED_SCORE, 24)        // $AC1B to sub_D8FC, by sub_C8BE
COST(BIG_IS_ON_HIS_FLOOR, 5)      // $AC32 to $AD69
COST(BIG_IS_NOT_ON_HIS_FLOOR, 3)  // or to $AC37
COST(BIG_STRETCH_GOES_ON, 10)     // $AC37 to $ACAE: rounds of its stretch left,
COST(BIG_STRETCH_OVER, 9)         // or none, to sub_F2FF
COST(BIG_REACHES_HIS_FLOOR, 21)   // $AC3F to sub_F315, less the jump: it's shown, less than 32 lines over Arthur,
COST(BIG_REACHES_HIS_FLOOR_ABOVE, 24) // or less than 24 under him
COST(BIG_NOT_ON_HIS_FLOOR, 21)    // or further, to $AC58
COST(BIG_NEW_STRETCH, 66)         // $AC58 to $AC85
COST(BIG_STRETCH_OTHER_SET, 3)    // $AC85 to $ACA2, outside the second set of stages,
COST(BIG_STRETCH_EARLY, 11)       // or before the seventh screen, to sub_F332,
COST(BIG_STRETCH_MIDDLE, 15)      // or not on the ninth,
COST(BIG_STRETCH_NINTH_LEFT, 23)  // or in the left half of the ninth,
COST(BIG_STRETCH_NINTH_RIGHT, 22) // or its right half, to sub_F30D
COST(BIG_STRETCH_RIGHT, 9)        // $ACA2 to $ACAE: heading right,
COST(BIG_STRETCH_LEFT, 15)        // or left
COST(BIG_WALK_THROWS, 5)          // $ACB1 to $AD17
COST(BIG_WALKS, 3)                // or to $ACB6
COST(BIG_FLOOR_X_RIGHT, 28)       // sub_04_AE24 with its call, a write at a time: by sub_FFAC to the store of the place 2 pixels ahead, heading right,
COST(BIG_FLOOR_X_LEFT, 29)        // or by sub_FFBE, heading left
COST(BIG_PLACE_SCREEN_ACROSS, 9)  // to the store of its screen across,
COST(BIG_FLOOR_SCREEN_DOWN_RIGHT, 10) // to $FFCD's store of its screen down, by a jump,
COST(BIG_FLOOR_SCREEN_DOWN_LEFT, 7)   // or straight on
COST(BIG_PLACE_LINE, 11)          // to the store of its line,
COST(BIG_PLACE_SAME_SCREEN, 11)   // and to $EA55 on its screen,
COST(BIG_PLACE_NEXT_LINE, 11)     // or past its 240 lines, to the store of the line on the next,
COST(BIG_PLACE_NEXT_SCREEN, 3)    // to the count of the screen,
COST(BIG_PLACE_NEXT_DONE, 8)      // and to $EA55
COST(BIG_NO_FLOOR, 13)            // $AE2E or $AE3E, and back: no floor ahead,
COST(BIG_WALL_X, 18)              // or floor, and sub_E9F1 or sub_EA01 with its call, to the store of the place 8 pixels ahead,
COST(BIG_WALL_SCREEN_RIGHT, 12)   // to $EA0E's store of its screen across, by a jump, heading right,
COST(BIG_WALL_SCREEN_LEFT, 9)     // or straight on, heading left
COST(BIG_WALL_SCREEN_DOWN, 7)     // to the store of its screen down
COST(BIG_WALL, 13)                // $AE35 or $AE45, and back: a wall,
COST(BIG_NO_WALL_RIGHT, 15)       // or none, heading right,
COST(BIG_NO_WALL_LEFT, 12)        // or left
COST(BIG_TURNS, 13)               // $ACB9 to $ACC3: the way's shut
COST(BIG_HEADS, 7)                // $ACC3 to sub_F2EB
COST(BIG_HEADS_LEFT, 9)           // $ACCB to $ACD2, facing left
COST(BIG_NOT_LOOKING, 9)          // $ACD2 to $ACF0: not one of its eighth rounds,
COST(BIG_LOOKS, 18)               // or one, to sub_F687, its box 16 by 96
COST(BIG_STOPS_OVER_HIM, 12)      // $ACE4 to sub_F309: Arthur is near
COST(BIG_STEPS, 13)               // $ACF0 to sub_F03E, with its call
COST(BIG_WALK_SHAPE, 7)           // $ACF8 to sub_F2EB
COST(BIG_WALK_SHAPE_LEFT, 9)      // $AD00 to $AD07, facing left
COST(BIG_WALK_STEP_SHAPE, 29)     // $AD07, and back
COST(BIG_NOT_SHOWN, 3)            // $AD1A to $AD45: not shown,
COST(BIG_NOT_TIME_TO_THROW, 11)   // or not one of its 32nd rounds,
COST(BIG_ARTHUR_NOT_BELOW, 21)    // or Arthur isn't lower,
COST(BIG_LOOKS_BELOW, 30)         // or is, to sub_F687, its box 16 by 128
COST(BIG_THROWS_DOWN, 9)          // $AD36 to sub_04_AE4D: he's near
COST(BIG_THROW_LOOKS, 13)         // sub_04_AE4D with its call, to $AE52, its 21st object's flags across a page
COST(BIG_THROW_FIRST_FREE, 3)     // to $AE5C: the 21st is free,
COST(BIG_THROW_SECOND_FREE, 12)   // or the 22nd,
COST(BIG_THROW_NONE_FREE, 19)     // or neither, and back
COST(BIG_THROW_PLACED, 73)        // sub_FA2E with its call
COST(BIG_THROW_KIND, 7)           // $AE5F to sub_F311
COST(BIG_THROW_MADE, 8)           // $AE67, and back
COST(BIG_THROWN_DOWN, 9)          // $AD3E to $AD45: thrown down
COST(BIG_THROWING_SHAPE, 7)       // $AD45 to sub_F30D
COST(BIG_THROWING_SHAPE_TURNED, 9) // $AD4D to sub_F2EF
COST(BIG_ARM_DOWN, 9)             // $AD57, and back: it hasn't just thrown,
COST(BIG_ARM_COMES_DOWN, 9)       // or has, on its fourth round, to sub_F336, less the jump,
COST(BIG_ARM_UP, 26)              // or before
COST(BIG_LEAVES_UNSEEN, 7)        // $AD6C to sub_F33A, less the jump: it isn't shown,
COST(BIG_LEAVES_HIS_FLOOR, 24)    // or it's off Arthur's floor
COST(BIG_ON_HIS_FLOOR_ABOVE, 17)  // or on it, less than 24 lines under him, to $AD85,
COST(BIG_ON_HIS_FLOOR_BELOW, 21)  // or less than 32 over him
COST(BIG_NOT_TIME_TO_THROW_ALONG, 16) // $AD85 to $AD9A: not one of its 16th rounds,
COST(BIG_THROWS_ALONG, 15)        // or one, to sub_04_AE4D
COST(BIG_THROWN_ALONG, 11)        // $AD92 to $AD9A: thrown the way it faces
COST(BIG_KEEPS_FACING, 21)        // $AD9A to $ADAB, not one of its fourth rounds
COST(BIG_KEEPS_FACING_LEFT, 12)   // $ADAD to $ADCE, facing left
COST(BIG_FACES_HIM, 23)           // or one, to sub_FA87
COST(BIG_FACES_HIM_LEFT, 16)      // $ADC4 to $ADCE: Arthur is on its left
COST(BIG_FLOOR_SHAPE, 21)         // $ADCE to sub_F2F7
COST(BIG_SPARK_OVER, 9)           // $ADDF, a weapon has sparked: its fourth round, to sub_F33E, less the jump,
COST(BIG_SPARK_SHAPE, 34)         // or before, and back
COST(BIG_NOT_SPARKED, 3)          // or no weapon has, to sub_F2EF
COST(BIG_FLOOR_ARM_COMES_DOWN, 12) // $ADFC, it has just thrown: its fourth round, to sub_F336,
COST(BIG_FLOOR_ARM_UP, 13)        // or before
COST(BIG_FLOOR_THROW_SHAPE, 21)   // $AE0A, and back
COST(BIG_FLOOR_NOT_THROWING, 4)   // or it hasn't: $ADFC to $AE16, across a page
COST(BIG_FLOOR_WAY_SHUT, 8)       // $AE19, and back: the way's shut,
COST(BIG_FLOOR_STEPS, 13)         // or open, to sub_F03E, by a jump
COST(THROWN_BEGINS, 17)           // $F504 to sub_F0A0's call of sub_F03E: what the big man throws
COST(THROWN_FLIES, 18)            // $F516 to $F54D, less sub_F321
COST(LIFT_BEGINS, 25)             // sub_04_B707 to sub_F321: a lift over the water
COST(LIFT_OUT_OF_VIEW, 2)         // $B71F to sub_F346: out of the view, where it turns,
COST(LIFT_IN_VIEW, 9)             // or in it, to $B72C
COST(LIFT_DOWN_FIRST_SCREEN, 9)   // heading down, on the stage's first screen down, to $B756,
COST(LIFT_AT_BOTTOM, 17)          // or past a lower screen's 224th line, to $B749, where it turns,
COST(LIFT_GOES_DOWN, 19)          // or above it, to $B756
COST(LIFT_UP_FIRST_SCREEN, 10)    // heading up, on the first screen, to $B756,
COST(LIFT_GOES_UP, 18)            // or below a lower screen's 16th line,
COST(LIFT_AT_TOP, 17)             // or above it, to $B749
COST(LIFT_TURNS, 11)              // $B749 to sub_F2FF
COST(LIFT_TURNED_SHOWN, 3)        // $B754 to $B75F, shown: no move this round,
COST(LIFT_TURNED_HIDDEN, 2)       // or hidden, to $B756
COST(LIFT_MOVES, 14)              // $B756 to sub_F03E, with its call, at its state's speed
COST(LIFT_NOT_SHOWN, 9)           // $B765, and back
COST(LIFT_ARTHUR_RISES, 17)       // or Arthur is rising, and back,
COST(LIFT_ARTHUR_HELD, 24)        // or held by something already, and back,
COST(LIFT_LOOKS, 19)              // or neither, to sub_F181
COST(LIFT_ARTHUR_BELOW, 19)       // $B779, and back: he's below it,
COST(LIFT_ARTHUR_HIGH, 23)        // or 18 lines or more above it,
COST(LIFT_ARTHUR_OFF, 41)         // or 16 pixels or more to either side,
COST(LIFT_ARTHUR_ON_NEAR, 31)     // or on it, to $B795, with it on his right,
COST(LIFT_ARTHUR_ON_FAR, 34)      // or his left
COST(WATER_CROW_IN_VIEW, 4)       // $F8FC to $F901, across a page: a crow of the water, in the view
COST(WATER_CROW_SITS, 8)          // $F90F to $F98C, with its call: perched
COST(WATER_CROW_AIMS, 68)         // $F914, sub_FA58 with its call, to sub_EF25 with its call
COST(WATER_CROW_AIMED, 11)        // $FA83, and back
COST(WATER_CROW_FACES, 19)        // $F917, and back: aimed left, it faces left
COST(WATER_CROW_FLIES, 3)         // or flying, $F90F to $F921
COST(WATER_CROW_SPEED, 16)        // $F924 to sub_F03E, with its call
COST(BAT_DEAD, 5)                 // sub_04_B45E to $F770: a bat, hit already,
COST(BAT_ALIVE, 10)               // or not, to sub_F2EB, its colours set
COST(BAT_FLYING, 5)               // $B46B to $B4E6: flying,
COST(BAT_NOT_FLYING, 3)           // or not, to sub_F2E7
COST(BAT_DROPPING, 5)             // $B473 to $B4AA: dropping,
COST(BAT_HANGING, 3)              // or still hanging, to sub_F321
COST(BAT_HIDES, 11)               // $B47E to sub_F346's store of its flags, by a jump: hanging out of the view
COST(BAT_IN_VIEW, 3)              // $B47E, $B4B0 or $B4EC: in the view, to the call of sub_04_B539
COST(BAT_GONE, 15)                // $B4B0 or $B4EC, and back: out of the view once it has let go, gone
COST(BAT_TESTS, 20)               // sub_04_B539 with its call, to sub_F5A0 with its call, 4 by 4
COST(BAT_NOT_HIT, 14)             // $B542, and back: no weapon hit it,
COST(BAT_HIT, 7)                  // or one did, to sub_F305
COST(BAT_FALL_SIDE, 19)           // $B54F to sub_F7B9
COST(BAT_KILLED_SOUND, 11)        // sub_F7B9 with its call, to sub_ED51
COST(BAT_KILLED_SCORE, 24)        // $B55F to sub_D8FC, by sub_C8BE
COST(BAT_KILLED_ENDS, 8)          // $B56D, and back
COST(BAT_KILLED_RETURNS, 8)       // $B486, $B4BB or $B4F7, and back: killed
COST(BAT_LOOKS, 18)               // $B486 to $B494: its hanging shape
COST(BAT_WAITS, 8)                // and back: Arthur isn't below it,
COST(BAT_WAITS_ABOVE, 25)         // or is, and it isn't its round to let go,
COST(BAT_LETS_GO, 18)             // or is, to sub_F309
COST(BAT_LETS_GO_DOWN, 13)        // $B4A4, and back
COST(BAT_DROPS_ON, 18)            // $B4BB to $B4DE: 16 lines or more above Arthur,
COST(BAT_LEVEL, 17)               // or fewer, to sub_F30D
COST(BAT_FACES_RIGHT, 18)         // $B4CC to $B4DE: Arthur on its right,
COST(BAT_FACES_LEFT, 24)          // or its left
COST(BAT_DROP_MOVE, 8)            // $B4DE to sub_F03E, with its call
COST(BAT_FLIES_ACROSS, 16)        // $B4F7 to sub_F03E, with its call
COST(BAT_WAVE_UP, 38)             // $B502 to sub_F03E, with its call, up,
COST(BAT_WAVE_DOWN, 40)           // or down
COST(BAT_WAVE_BACK, 12)           // $B527 to $B52E
COST(BAT_SHAPE, 17)               // $B52E to sub_F576, by a jump
COST(SHOOTER_HIDDEN, 15)          // sub_04_B594, and back: the cave's shooter, out of the view
COST(SHOOTER_KILLED, 23)          // or in it with four hits, to sub_ED51, by sub_F7B4
COST(SHOOTER_ALIVE, 11)           // or fewer, to sub_F2EB
COST(SHOOTER_WAITS, 35)           // $B5B3, and by $B603 to $B6A7: not one of its 32nd rounds,
COST(SHOOTER_ARTHUR_FAR, 54)      // or one, with Arthur 24 lines or more from its height,
COST(SHOOTER_SEES_HIM_BELOW, 45)  // or nearer, below it, to $B5DC,
COST(SHOOTER_SEES_HIM_ABOVE, 49)  // or above
COST(SHOOTER_PICKS_BOTH, 15)      // $B5DC to $B5F5: both shots,
COST(SHOOTER_PICKS_LOW, 20)       // or the low one,
COST(SHOOTER_PICKS_HIGH, 18)      // or the high one
COST(SHOOTER_PICKED, 9)           // $B5F5 to sub_F309
COST(SHOOTER_RISE_STATE, 10)      // $B5FE to $B6A7
COST(SHOOTER_RISES_ON, 39)        // $B606 to $B6A7: coming up, blinking,
COST(SHOOTER_RISEN, 42)           // or its 16th round, to sub_F32E
COST(SHOOTER_RISEN_STATE, 10)     // $B627 to $B6A7
COST(SHOOTER_TESTS_CLOSED, 23)    // $B6A7 to sub_F5A0, with its call, its hits kept
COST(SHOOTER_TESTS_CLOSED_END, 15) // $B6C1, and back, its hits put back
COST(SHOOTER_TESTS_OPEN, 16)      // $B62F to sub_F5A0, with its call
COST(SHOOTER_WEAPON_SPARKS, 13)   // $B63A or $B6B6 to $B645 or $B6C1: a weapon hit it,
COST(SHOOTER_TOUCHED_ARTHUR, 7)   // or Arthur touched it
COST(SHOOTER_OPEN_ON, 16)         // $B645 to $B65E: open, before its 16th round,
COST(SHOOTER_FIRST_SLOT_TAKEN, 25) // or after it, the 21st object in use, to $B65E,
COST(SHOOTER_SECOND_SLOT_TAKEN, 39) // or the 22nd,
COST(SHOOTER_SHOOTS, 55)          // or neither, to sub_ED51
COST(SHOOTER_SHOT_WAY, 6)         // $B684 to $B689
COST(SHOOTER_SHOOTS_HIGH, 8)      // to sub_04_B6CB, with its call: the high shot,
COST(SHOOTER_SHOOTS_LOW, 13)      // or to sub_04_B6C6: the low one,
COST(SHOOTER_SHOOTS_BOTH, 14)     // or both
COST(SHOOTER_SLOT_LOW, 5)         // sub_04_B6C6 to sub_04_B6EA, by a jump
COST(SHOOTER_SLOT_HIGH, 8)        // sub_04_B6CB to sub_04_B6EA, with its call
COST(SHOOTER_SHOT_SET, 21)        // $B6ED to sub_FA87
COST(SHOOTER_SHOT_RIGHT, 9)       // and back: Arthur on its right,
COST(SHOOTER_SHOT_LEFT, 15)       // or its left
COST(SHOOTER_HIGH_SAME_SCREEN, 22) // $B6D0, and back: 16 lines up on its screen,
COST(SHOOTER_HIGH_SCREEN_ABOVE, 41) // or on the screen above
COST(SHOOTER_CLOSES, 13)          // $B6A1, and back
COST(SHOOTER_OPEN_SHAPE, 23)      // $B65E to $B66D
COST(SHOOTER_FACES_RIGHT, 17)     // and back: Arthur on its right,
COST(SHOOTER_FACES_LEFT, 29)      // or its left
COST(CAVE_SHOT_FLIES, 38)         // $F473 to sub_F5A0, with its call: the shooter's shot
COST(CAVE_SHOT_NOTHING, 9)        // $F48B, and back: nothing touched it,
COST(CAVE_SHOT_TOUCHED, 12)       // or Arthur,
COST(CAVE_SHOT_WEAPON, 22)        // or a weapon, without the cross,
COST(CAVE_SHOT_STOPPED, 31)       // or with it, by sub_F734
COST(TOWER_CROW_NOT_YET, 9)       // $875E to the return DANGERS_OTHERS counts: the count isn't out,
COST(TOWER_CROW_COMES, 19)        // or is, and starts again: to the call of sub_DA18
COST(TOWER_CROW_SET_UP, 35)       // $876E to the call of sub_02_84D7
COST(TOWER_CROW_PLACED_DOWN, 77)  // $878A to the call of sub_F099, for a place level or below,
COST(TOWER_CROW_PLACED_UP, 81)    // or above
COST(TOWER_CROW_HEADS, 7)         // $87C7
COST(TOWER_CROW_FACES_RIGHT, 3)   // $87CF, to the return: Arthur is at its right,
COST(TOWER_CROW_FACES_LEFT, 2)    // or isn't, to sub_F30D,
COST(TOWER_CROW_HEADS_LEFT, 7)    // and on, to the return
COST(TOWER_CROW_NONE_FREE, 3)     // $876E, to the return: no object is free
COST(COLUMN_ADDRESS_LAST_ROWS, 7)   // sub_EA73, more for a row in the name table's last quarter,
COST(COLUMN_ADDRESS_PAST_ROWS, 23)  // or past its 30 rows
COST(COLUMN_NEXT_SCREEN, 78)        // $E7EF to sub_E95C, by $E800, with its call: the column goes on down the next screen
COST(SCREEN_BLOCKS, 144)            // sub_E95C, and back
COST(VIEW_NEW_ROW, 5)               // $E739 to sub_E849, more than its branch past the call
COST(ROW_ABOVE, 11)                 // sub_E849 to $E855: the view moves up,
COST(ROW_BELOW, 15)                 // or down
COST(ROW_ON_VIEWS_SCREEN, 24)       // $E855 to $E877: the row is on the view's own screen,
COST(ROW_ON_NEXT_SCREEN, 35)        // or past its 240 lines,
COST(ROW_ON_NEXT_SCREEN_CARRIED, 32)
COST(ROW_PLACE, 188)                // $E877 to sub_EA73, with sub_E945
COST(ROW_LIST_BEGINS, 48)           // $E88A to sub_E9AB, with its call
COST(ROW_STARTS_LEFT, 7)            // $E8A9, from a block's left tile,
COST(ROW_STARTS_RIGHT, 8)           // or its right
COST(ROW_TILE_UPPER, 37)            // $E8AF or $E8C9 to the count's compare: a block's upper tile,
COST(ROW_TILE_LOWER, 40)            // or its lower
COST(ROW_TILES_DONE, 4)             // the branch to $E931, across a page
COST(ROW_NEXT_BLOCK, 33)            // $E8E6 to sub_E9AB, with its call
COST(ROW_NEXT_SCREEN, 88)           // or to sub_E95C, by $E8FF, with its call: the row goes on across the next screen
COST(ROW_ENDS, 29)                  // $E934 to its return

// ---- the small blue devil, kind 6, sub_04_A89E (devil.c)
COST(DEVIL_IS_HIT, 5)             // $A8A1 to $F770
COST(DEVIL_IS_NOT_HIT, 3)         // or to $A8A6
COST(DEVIL_IS_NOT_AWAKE, 2)       // $A8A9 to sub_F0A3
COST(DEVIL_IS_AWAKE, 3)           // or to $A8EA
COST(DEVIL_WAITS_OUT_OF_VIEW, 9)  // $A8AE, and back: out of the view,
COST(DEVIL_WAITS_ON, 18)          // or in it, with rounds of its count left,
COST(DEVIL_WAKES, 11)             // or none, to sub_F30D
COST(DEVIL_WOKEN, 7)              // $A8B8 to sub_F181
COST(DEVIL_FROM_THE_LEFT, 22)     // $A8C0, and back: it's near the picture's left side,
COST(DEVIL_FROM_THE_RIGHT, 37)    // its right,
COST(DEVIL_FROM_ABOVE, 52)        // its top,
COST(DEVIL_FROM_BELOW, 58)        // or none of them
COST(DEVIL_IN_VIEW, 4)            // $A8F0 to $A90A, across a page
COST(DEVIL_OUT_OF_VIEW, 2)        // or to sub_F346
COST(DEVIL_STAYS, 10)             // $A8F5 to $A90A, across a page: before its third time round,
COST(DEVIL_GONE, 28)              // or from it, and back,
COST(DEVIL_GONE_WITH_CARRIED, 32) // with what it carries
COST(DEVIL_CARRIES_NOTHING, 7)    // $A90A to $A968
COST(DEVIL_CARRIES, 61)           // or to sub_F687, with what it carries under it on its own screen,
COST(DEVIL_CARRIES_ONTO_NEXT_SCREEN, 80) // or on the next one down
COST(DEVIL_HOLDS_ON, 3)           // $A947 to $A968: Arthur isn't near,
COST(DEVIL_LETS_GO, 31)           // or is, to sub_FA87
COST(DEVIL_LET_GO_RIGHT, 3)       // $A961 to $A968
COST(DEVIL_LET_GO_LEFT, 9)
COST(DEVIL_TESTS, 14)             // $A968 to sub_F5A0, with its call
COST(DEVIL_NOT_KILLED, 7)         // $A971 to $A9AC
COST(DEVIL_KILLED, 13)            // or to sub_F32E, with nothing carried,
COST(DEVIL_KILLED_CARRYING, 19)   // or with what it carried gone
COST(DEVIL_FALL_SIDE, 19)         // $A983 to sub_F305
COST(DEVIL_KILLED_SOUND, 11)      // $A993 to sub_ED51, by sub_F7B9
COST(DEVIL_KILL_COUNTED, 8)       // $A996 to $A99E
COST(DEVIL_NO_KILLS_LEFT, 12)
COST(DEVIL_KILLED_SCORE, 21)      // $A99E to sub_D8FC
COST(DEVIL_FLAG_IS, 5)            // $A9AF to $AA0C, or $A9B7 to $A9EF
COST(DEVIL_FLAG_IS_NOT, 3)        // or past it
COST(DEVIL_DIVES, 24)             // $AA0C to sub_F03E, with its call
COST(DEVIL_DIVE_OVER, 56)         // or to its end, and back
COST(DEVIL_HOVERS, 25)            // $A9EF to sub_F03E, with its call, across a page
COST(DEVIL_AIMS, 90)              // or to sub_EF25, with its call, by sub_FA58
COST(DEVIL_AIMED, 34)             // and by sub_F315, back
COST(DEVIL_STOPS, 58)             // $A9BC, and by sub_F311, back: its 16th round of flying
COST(DEVIL_FLIES, 46)             // or to sub_F03E, with its call: its first two times,
COST(DEVIL_FLIES_THIRD_TIME, 40)  // its third,
COST(DEVIL_FLIES_LATER, 38)       // or later
COST(DEVIL_SHAPE_BEGINS, 2)       // $AA33 to the store of its colours,
COST(DEVIL_SHAPE_COLOURS, 7)      // to the store of its shape,
COST(DEVIL_SHAPE_FIRST, 27)       // to sub_F576's store of the shape its count picks,
COST(DEVIL_SHAPE_WINGS, 11)       // and to sub_F2E7
COST(DEVIL_SHAPE_KEPT, 9)         // $AA43, and back
COST(DEVIL_SHAPE_TURNED, 21)

// ---- the second stage's objects that go up and down, and that fall, kinds $36 and $37, sub_04_9DA2 and sub_04_9D5F (platform.c)
COST(RISING_THING_BEGINS, 32)     // $9DA2 to sub_F321
COST(RISING_THING_OUT_OF_VIEW, 2) // $9DBF to sub_F346
COST(RISING_THING_DOWN_FIRST_SCREEN, 18) // $9DBF to $9DF6: going down, on the stage's first screen down,
COST(RISING_THING_AT_BOTTOM, 26)  // or to $9DE9, below a later screen's 224th line,
COST(RISING_THING_GOES_DOWN, 28)  // or to $9DF6, above it
COST(RISING_THING_UP_FIRST_SCREEN, 19) // $9DBF to $9DE9: going up, on the first screen down,
COST(RISING_THING_GOES_UP, 27)    // or to $9DF6, below a later screen's 32nd line,
COST(RISING_THING_AT_TOP, 26)     // or to $9DE9, above it
COST(THING_TURNS, 11)             // $9DE9 to sub_F2FF
COST(THING_TURNED_HIDDEN, 2)      // $9DF4 to $9DF6
COST(THING_TURNED_SHOWN, 3)       // or to $9DFF
COST(THING_MOVES, 14)             // $9DF6 to sub_F03E, with its call
COST(THING_NOT_SHOWN, 9)          // $9E02, and back
COST(THING_IS_SHOWN, 2)           // or to $9E04
COST(THING_ARTHUR_RISES, 15)      // $9E04, and back: Arthur is going up,
COST(THING_ARTHUR_HELD, 22)       // or is held already,
COST(THING_ARTHUR_BELOW, 36)      // or is below it,
COST(THING_ARTHUR_HIGH, 40)       // or 20 pixels above it or more,
COST(THING_ARTHUR_OFF, 58)        // or off its sides
COST(THING_ARTHUR_ON_NEAR, 51)    // or on it, to $B795: within 36 pixels one way,
COST(THING_ARTHUR_ON_FAR, 54)     // or the other
COST(THING_HOLDS_GOING_DOWN, 32)  // $B795 to $B7B2: his flag and state, and how far above it he stands, when it's going down,
COST(THING_HOLDS_GOING_UP, 36)    // or up
COST(THING_LIFTS_SAME_SCREEN, 26) // $B7B2 to $B7D6: his place down, on its screen,
COST(THING_LIFTS_SCREEN_ABOVE, 38) // or the one above
COST(THING_CARRIES_DOWN, 16)      // $B7D6 to $B7ED: going down in the picture's lower half,
COST(THING_STILL_DOWN, 18)        // or to $B7F6, in its upper,
COST(THING_CARRIES_UP, 15)        // or going up in its upper half,
COST(THING_STILL_UP, 17)          // or in its lower
COST(THING_CARRY_BEGINS, 14)      // $B7ED to sub_04_B80D, with its call
COST(THING_CARRIED, 50)           // $B810, and back: his place down, moved as it moves, on the same screen,
COST(THING_CARRIED_ONTO_SCREEN_ABOVE, 69) // or past its top,
COST(THING_CARRIED_ONTO_SCREEN_BELOW, 73) // or its 240 lines
COST(THING_HOLD_ENDS, 7)          // $B7F6 to sub_F181
COST(FALLING_THING_BEGINS, 21)    // $9D5F to sub_F321
COST(FALLING_THING_OUT_OF_VIEW, 2) // $9D74 to sub_F346
COST(FALLING_THING_WAITS_UNSEEN, 9) // $9D7C, and back
COST(FALLING_THING_GONE, 15)
COST(FALLING_THING_IN_VIEW, 3)    // $9D74 to $9D84
COST(FALLING_THING_FALLS, 12)     // $9D87 to $9DF6
COST(FALLING_THING_LOOKS, 13)     // or to sub_F687
COST(FALLING_THING_WAITS, 9)      // $9D9C, and back
COST(FALLING_THING_SEES_HIM, 2)   // or to sub_F309
