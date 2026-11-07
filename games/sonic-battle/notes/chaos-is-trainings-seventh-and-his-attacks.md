# Training's seventh character is Emerl, and Chaos's own attacks make things of kinds 36, 73 and 78.

About: Chaos's moves; chaos-moves; chaos-air-attack; chaos-special-power; chaos-special-shot; chaos-special-set; 0x0800c728; 0x0800eaec

Proof: #464; chaos-moves; chaos-air-attack; chaos-special-power; chaos-special-shot; chaos-special-set

Training's list of eight characters holds Emerl at its seventh entry (character 9), and not Chaos (character 10). A start point for Chaos replaces that entry at 0x030052D7 with 10 and selects it, and writes the player's colour rows 9 at 0x030013B0 plus 93, 94 and 95, which are the rows the Training screen copies from the save and which give Chaos its green colours. The fight then opens with Chaos as the player and a Sonic that does nothing as the rival. This is the start point the recordings use.

Chaos's ground combo makes a thing of kind 73, his air attack a thing of kind 36, and a later attack a thing of kind 78. Their scripts come from 0x0800c728's table of cases: 0x0806CE18 for 73, 0x0806C054 for 36 and 0x0806D13C for 78. None of the three has a shape of its own, so the picture words their scripts set are drawn without the part offsets 0x0800bb88 gives kinds 35, 37, 38, 39, 43, 44, 158 and 160. Kind 78 hits through 0x0800eaec with a reach of 0x300, a height of 8, 20 damage, one frame held and hit kind 0x380; kinds 36 and 73 have no hit. None of the three has steps after it moves in 0x0800cec8.

The three special attacks reach thing kinds that 0x0800c728 already had, so a fighter's own shot, power and set needed nothing new here.
