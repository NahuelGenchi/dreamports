# Training picks a fighter by its index in its list, and Shadow is fighter 3, not 6, which is Cream.

About: the whole game; 0x030053F8; 0x030052D0; 0x03001634; FUN_0803b3c4; shadow-moving; shadow-attacks

Proof: #972; shadow-moving; shadow-attacks

The Training screen keeps the player's choice as an index at 0x030053F8 into the list at 0x030052D0, which holds 0 to 6, then 7 and 8 when the save has opened them, then 9. FUN_0803b3c4 writes the list's entry into 0x03001620+20, 0x03001634, when Start is pressed, so the choice becomes a fighter number only then. A start point that opens a fight with a fighter other than Sonic gives the original the index in its onlyInOriginal stretch, at 0x030053F8, and the Dreamport the fighter number. The numbers are Sonic 0, Tails 1, Knuckles 2, Shadow 3, Rouge 4, Amy 5, Cream 6, Gamma 7, Chaos 8 and Emerl 9, each seen in the original's pictures, and original.json lists them under shows, so prove checks every recording named for a fighter. Shadow's recordings first used 6, which played Cream.
