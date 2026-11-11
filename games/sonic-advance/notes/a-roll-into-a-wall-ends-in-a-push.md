# A roll that runs into a wall ends in a push, as the roll checks walls the way walking does.

About: sonic-angel-island; Angel Island Zone act 1; the whole game

Proof: #742; sonic-angel-island

The original's roll, Player_8043DDC, ends with the walking wall check, sub_8023128, not the one the B-button combo uses, sub_80231C0. In this game the walking check also ends the roll and stands Sonic up, and it sets the push flag, MOVESTATE_20, so a roll stopped by a wall shows the push (charState 14) on that frame, drawn without the rotation the walk uses. In `sonic-angel-island` Sonic rolls into a wall at about x 5800 with Down held, and the original reads moveState 0x20 and charState 14 at frame 6839 and shows the push at frame 6840. The C version stopped the roll without a push and drew the walk, rotated, until `c/src/player.c`'s roll used the walking check; the JavaScript version's roll, in `engine/player.js`, still uses the other one, and its proof of that recording differs at frame 6840.
