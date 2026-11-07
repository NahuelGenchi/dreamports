# Training picks a fighter by its index in its list, not by its character number.

About: the whole game; 0x030053F8; 0x030052D0; FUN_0803b3c4; shadow-moving; shadow-attacks

Proof: #460; shadow-moving; shadow-attacks

The Training screen keeps the player's choice as an index at 0x030053F8 into the list at 0x030052D0, which holds 0 to 6, then 7 and 8 when the save has opened them, then 9. FUN_0803b3c4 writes the list's entry into 0x03001620+20 when Start is pressed, so the choice becomes a character number only then. A start point that opens a fight with a fighter other than Sonic gives the original the same index in its onlyInOriginal stretch, at 0x030053F8, and the Dreamport the character number at 0x03001634. Shadow is 6, and the fighter tasks before Shadow's used 0 for Sonic, which needed no value at 0x030053F8.
