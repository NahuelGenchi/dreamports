// Ghosts'n Goblins Dreamport: how long each piece of the original's code takes, in the processor's cycles. This is the
// one place the game's time is written down (time.c): the game's own code says which piece it has done, by name.
// Each is the sum of the cycles of the original's instructions for that piece, taken the way the piece's name says.
//
// A piece marked "about" hasn't been counted yet: it's near enough to put V-blank in the right task's turn, which is
// all the frames before a stage need, and it's counted when the stage's rounds that run it are proven.

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
COST(TASK_STOPPED, 53)            // sub_C303
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

// ---- the start, $C008 (main.c)
COST(START_BEFORE_WAIT, 8)        // $C008 to $C00C
COST(START_WAIT_READ, 3)          // the wait's read of $2002 comes this far into each pass of 7 cycles,
COST(START_WAIT_PASS, 7)
COST(START_WAIT_OVER, 3)          // and the pass that sees V-blank ends 3 cycles after its read
COST(START_ABOUT, 21000)          // about: the clearing of work memory and the first settings, to $C0C6

// ---- the sprites' task, $F34F and bank 4's $8000 (sprites.c)
COST(SPRITES_TASK_BEGINS, 15)     // $F34F to the call
COST(SPRITES_SWAP, 121)           // sub_04_8089
COST(SPRITES_LIST_BEGINS, 10)     // $8000 to $8005, with its call of the swap
COST(SPRITES_OBJECT_HIDDEN, 11)   // $8007: an object that isn't shown,
COST(SPRITES_OBJECT_LISTED, 58)   // or one that is,
COST(SPRITES_OBJECT_PAST_PAGE, 1) // and a cycle more for the objects whose flags are in the next page of memory
COST(SPRITES_LIST_FULL, 55)       // or the object that fills the list
COST(SPRITES_LIST_END_BEGINS, 2)  // $8031
COST(SPRITES_LIST_END_BYTE, 11)   // each of the four bytes that end the list
COST(SPRITES_MAKE_BEGINS, 26)     // $803C to the call
COST(SPRITES_MADE, 17)            // sub_04_80D0 at the list's end, and back
COST(SPRITES_SHAPE, 169)          // $80D0 to $813C: an object's shape, places and colours found
COST(SPRITES_POINTER_ON, 20)      // sub_04_81D6, sub_04_81DD or sub_04_81E4 called: a pointer moved on by one,
COST(SPRITES_POINTER_NEXT_PAGE, 4) // and into a new page
COST(SPRITES_TABLE_PAST_PAGE, 1)  // a table's entry whose second byte is in the next page
COST(SPRITES_SPRITE_LEFT_OUT, 13) // $813E to $81BD: a sprite the shape leaves out, and $81CC to $81A9
COST(SPRITES_SPRITE_ACROSS, 42)   // $813E to $8164: a sprite's tile and its place across,
COST(SPRITES_SPRITE_DOWN, 24)     // $8167 to $8183: its place down,
COST(SPRITES_SPRITE_PAST_EDGE, 29) // either place when the sum goes past 255 and still fits,
COST(SPRITES_SPRITE_OFF_LEFT, 30)  // or doesn't,
COST(SPRITES_SPRITE_OFF_RIGHT, 8)  // or goes off the far edge
COST(SPRITES_SPRITE_REST, 43)     // $8189 to $81A6, less its calls
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
COST(SPRITES_TASK_ENDS, 19)       // $F359 to the call that yields
COST(SPRITES_TASK_AGAIN, 3)       // $F364: round again

// ---- the tiles' task, $E569 (screen.c)
COST(TILES_START, 109)            // $E569 to the call that yields
COST(TILES_AGAIN, 3)              // $E665
COST(TILES_BEGIN, 14)             // $E576 to $E57F
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
COST(TILES_END, 19)               // $E65A to the call that yields

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
COST(VIEW_HELD_DOWN, 6)           // $E70D, and the same down:
COST(VIEW_BETWEEN_TOP_AND_BOTTOM, 27)
COST(VIEW_AT_TOP, 36)
COST(VIEW_AT_BOTTOM, 44)
COST(VIEW_ROW_LOOKED_AT, 19)      // $E72D to $E73E
COST(VIEW_NO_COLUMN, 6)           // $E73E
COST(VIEW_COLUMN, 11)             // or with the call of sub_E76F
COST(VIEW_ENDS, 57)               // $E745 to the call that yields

// ---- the rows' list, sub_EECF (screen.c)
COST(ROWS_BEGIN, 15)              // $EECF to $EED6
COST(ROWS_ROW_BEGINS, 38)         // $EED7 to $EEED
COST(ROWS_BYTE, 26)               // $EEEF to $EEFB, for each byte,
COST(ROWS_BYTE_NEXT_PAGE, 4)      // and when the place it's read from goes into a new page
COST(ROWS_ROW_ENDS, 26)           // $EEFF to $EF0E
COST(ROWS_ROW_AGAIN, 4)           // back for the next row, across a page of the code
COST(ROWS_END_MARK, 7)            // $EF12 to the store of the end mark,
COST(ROWS_FREED, 5)               // to the store that frees the list,
COST(ROWS_BACK, 18)                // and back

// ---- the sound driver, bank 3's $8380, which V-blank calls (sound.c)
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
COST(SOUND_READ_PAST_PAGE, 1)     // a byte read through a pointer whose count takes it into the next page
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

// ---- about: what hasn't been counted yet
COST(ABOUT_A_TURN, 300)           // a task's turn that does little
COST(ABOUT_A_COPY_OF_64, 1350)    // sub_C7ED's attributes
COST(ABOUT_NO_OBJECTS, 3300)      // sub_CA96
COST(ABOUT_A_COLUMN, 4981)        // sub_E76F
COST(ABOUT_AN_OBJECT, 250)        // an object's turn in the objects' task
