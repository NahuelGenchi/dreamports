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
COST(COLUMN_BEGINS, 207)          // sub_E76F to its call of sub_EA73, with sub_E945
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

// ---- the objects' task, $F367 and bank 4's $9CC8 (objects.c)
COST(OBJECTS_AGAIN, 3)            // $F37C
COST(OBJECTS_BEGIN, 17)           // $F367 to $9CC8
COST(OBJECT_LOOKED_AT, 4)         // $9CCA
COST(OBJECT_PAST_PAGE, 1)         // a cycle more for the objects whose flags are in the next page of memory
COST(OBJECT_UNUSED, 3)
COST(OBJECT_USED, 35)             // $9CCD to its kind's code, through the table at $9CED
COST(OBJECT_KIND_PAST_PAGE, 1)    // a cycle more for each byte of the table's entry that's in the next page
COST(OBJECT_NEXT, 4)              // $9CE4
COST(OBJECTS_END, 25)             // $9CE9 to the call that yields
COST(OBJECT_PLACED, 181)          // sub_F181, with its call
COST(OBJECT_PLACED_OTHER_SCREEN, 9)
COST(OBJECT_SHOWN, 23)            // sub_F321 or sub_F346, with its call
COST(OBJECT_FLAG_READ, 22)        // one of the flag tests from sub_F2E3 on, with its call,
COST(OBJECT_SHOWN_READ, 18)       // or sub_F2FF's
COST(OBJECT_IN_VIEW, 178)         // sub_F0A3, with its call: in the view,
COST(OBJECT_OUT_OF_VIEW_DOWN, 173) // or not, down,
COST(OBJECT_OUT_OF_VIEW_ACROSS, 177) // or across
COST(PRINCESS_TURN, 27)                // $F3E9, and back
COST(PICK_UP_BEGINS, 7)           // $BA09
COST(PICK_UP_OUT_OF_VIEW, 62)     // $BA12 to $BB8B, and back
COST(PICK_UP_IN_VIEW, 48)         // $BA12 to the call of sub_F68E,
COST(PICK_UP_FLASHES, 8)          // with its other colour every fourth round
COST(PICK_UP_CANNOT_BE_TOUCHED, 16) // sub_F68E when Arthur's flags say so
COST(PICK_UP_LEFT, 35)            // $BA3F to $BB6A, and back

// ---- Arthur's task in a stage, $DAE4 (arthur.c), and the stage's blocks (scroll.c)
COST(STAGE_BLOCK, 217)            // $EA55: the stage's bank, sub_E945, the bank back, and back
COST(STAGE_BLOCK_PAST_PAGE, 1)    // a cycle more for each of sub_E945's two reads that goes into the next page
COST(ARTHUR_AGAIN, 3)             // $DB7F
COST(ARTHUR_TURN_BEGINS, 44)      // $DAE4, with sub_DC5B
COST(ARTHUR_NO_ARMOUR_COLOURS, 6)
COST(ARTHUR_TURN_CHECKS, 98)      // $DAE7 to $DAFC
COST(ARTHUR_HELD, 1)              // $DAFC's branch taken
COST(ARTHUR_GROUND, 74)           // sub_E3E3 and sub_EA2F, with their calls, less the block's
COST(ARTHUR_ON_GROUND, 3)         // $DB01
COST(ARTHUR_IN_AIR, 5)            // $DB01 to $E28E
COST(ARTHUR_STANDS, 65)           // $DB06 to $DB65, with sub_DDA1,
COST(ARTHUR_B_NOT_HELD, 2)        // which clears $85 when B isn't held
COST(ARTHUR_VIEW_FOLLOWS, 12)     // $DB65 and $DB96, the two calls
COST(FOLLOW_ACROSS, 59)           // sub_DBFB to $DC22
COST(FOLLOW_LEFT_NEAR, 17)        // $DC24 on, and back: within 8 pixels to the left,
COST(FOLLOW_LEFT_FAR, 18)         // further,
COST(FOLLOW_RIGHT_NEAR, 13)       // less than 7 to the right,
COST(FOLLOW_RIGHT_FAR, 20)        // or more
COST(FOLLOW_DOWN, 32)             // sub_DB99 to $DBAE
COST(FOLLOW_DOWN_NEXT_SCREEN, 14) // $DBB0, past the screen's 240 lines
COST(FOLLOW_DOWN_APART, 42)       // $DBB9 to $DBD4, on the view's own screen,
COST(FOLLOW_DOWN_SCREEN_BELOW, 15) // or to $DBE3 on another, below
COST(FOLLOW_DOWN_SCREEN_ABOVE, 17) // or above
COST(FOLLOW_UP_NEAR, 17)          // $DBE5 on, and back
COST(FOLLOW_UP_FAR, 21)
COST(FOLLOW_DOWN_NEAR, 16)
COST(FOLLOW_DOWN_FAR, 23)
COST(ARTHUR_AFTER_VIEW, 8)        // $DB68 to $DB7C
COST(ARTHUR_TURN_ENDS, 6)         // the call of sub_DB8A
COST(ARTHUR_SHAPE, 112)           // sub_E35E to $E3B9, with its call
COST(ARTHUR_SHAPE_STARTS_AGAIN, 6) // his walk's count back to 0
COST(ARTHUR_FLASH_LOOKED_AT, 31)  // sub_E3B9, and back
COST(ARTHUR_FLASH_CALLED, 6)
COST(ARTHUR_BUTTONS, 39)          // sub_E01E, with its call
COST(ARTHUR_BUTTONS_BUSY, 21)     // or when his state stops it
COST(ARTHUR_TURN_YIELDS, 43)      // $DB93 and $E4E5, to the jump that yields
COST(ARTHUR_FALL_RESUMES, 40)     // $E2E4 to $E28E
COST(ARTHUR_FALL_CHECKS, 66)      // $E28E to $E29B
COST(ARTHUR_LANDS, 30)            // $E29E to $DB65, with sub_E166
COST(ARTHUR_FALLS_ON, 20)         // $E29E to the call of sub_DF3E
COST(ARTHUR_FELL_LOW, 27)         // sub_DF3E, into sub_DB99,
COST(ARTHUR_FELL_HIGH, 31)        // or back
COST(ARTHUR_FELL_ABOVE_HALF, 9)   // $E2B5
COST(ARTHUR_FELL_BELOW_HALF, 14)  // or with its call of sub_DB99
COST(ARTHUR_FALL_ENDS, 54)        // $E2BF to $E2E1
COST(ARTHUR_STARTS_IN_STAGE, 71)  // $DA71 to $DAE4

// ---- the game's task in a stage, $D284 (flow.c)
COST(GAME_ROUND_AGAIN, 3)         // $D405
COST(GAME_ROUND_BEGINS, 54)       // $D284 to $D31D
COST(GAME_ROUND_NO_COLOURS, 8)    // $D31D, three rounds in four,
COST(GAME_ROUND_COLOURS, 37)      // or with sub_D871, to its jump
COST(GAME_ROUND_MIX, 15)          // $D326 to $D32F
COST(GAME_ROUND_CHECKS, 76)       // $D32F to $D3ED, with sub_D882
COST(GAME_ROUND_OBJECTS, 17)      // $D3ED to sub_D596
COST(STAGE_OBJECT_NOT_YET, 107)   // sub_D596 when the next object's screen isn't reached, and back
COST(GAME_ROUND_DANGERS, 15)      // $D583 to bank 2's $8400
COST(DANGERS_NOTHING, 198)        // $8400 to $8415 when nothing comes
COST(GAME_ROUND_AFTER, 19)        // $D58D to $D595
COST(GAME_ROUND_ENDS, 48)         // $D3F0 to the call that yields

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
COST(PALETTE_SET_UP, 20)          // sub_EEBF to sub_EECF, for all 32 colours,
COST(HALF_PALETTE_SET_UP, 23)     // or sub_EEBA, for 16

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
COST(ABOUT_A_STAGE_OBJECT, 400)   // sub_D596 when it places one
COST(ABOUT_DANGERS_COME, 2000)    // bank 2's $8431
COST(ABOUT_A_STAGE_START, 3130)   // $D16E to $D284
COST(ABOUT_A_COPY_OF_64, 1350)    // sub_C7ED's attributes
COST(ABOUT_NO_OBJECTS, 3300)      // sub_CA96
COST(ABOUT_SATAN, 300)            // $EDA2
COST(ABOUT_A_MOVE, 900)           // sub_F03E
COST(ABOUT_A_TOUCH, 250)          // sub_F68E from $F697, and $BA44
