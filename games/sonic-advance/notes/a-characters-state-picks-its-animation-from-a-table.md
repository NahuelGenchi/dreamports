# A character state's animation is in a table the decompilation only has as bytes, in the USA copy at 0x084A6F10.

About: 0x08038524; Task_8038554; x-zone-the-moon-opens

Proof: #93; x-zone-the-moon-opens

The table has two 16-bit numbers for each character state, the animation and its variant, so state 52's are at 0x084A6FDC, which `npm run dp -- read` with `--bytes` shows. The C table in the decompilation's player.c is a placeholder for Sonic Advance: its entries for states 50 to 52 aren't what the game has. State 52 is animation 397, Sonic looking up, which `Task_8038554` sets, and which trying the other poses never found.
