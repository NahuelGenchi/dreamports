# Emerl runs the script of the character in each skill slot, then the frame ends there

About: Emerl's moves; emerl-moves; 0x08007EC8; 0x0800964C; 0x08029CFC; 0x080215A8

Proof: #461; emerl-moves

Character 9 is Emerl. In 0x08007EC8, when the fighter's character at +196 is 9, the code jumps to 0x0800964C instead of the ordinary state switch. That block picks, for the state's script slot, the character in the fighter's 0x9C-byte record at 0x030013B0 (`slot`), runs that character's script from 0x08ED68A8 + character * 280 + slot * 4, sets the animation slot, and returns from the whole function, so the ordinary switch never runs. A state with no slot there does nothing.

A new save's six starter decks at 0x03002110 + 0x322 are the same 27 skills; 0x08029CFC maps each through the catalogue at 0x0810B32C, byte +4, into the record's three rows at +0x45. The outfit table follows the same rows from +0x5D, so an empty record gives Emerl row 0's colours (Sonic's) instead of the row 9 a new save gives him. The eyes at +0x59 and the body at +0x5D, +0x5E and +0x5F all come from that grid.
