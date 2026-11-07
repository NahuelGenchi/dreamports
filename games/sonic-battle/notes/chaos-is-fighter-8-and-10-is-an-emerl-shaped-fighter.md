# Chaos is fighter 8, and fighter 10 is an Emerl-shaped fighter whose attacks make things of kinds 36, 73 and 78.

About: Chaos's moves; chaos-moves; chaos-air-attack; chaos-special-power; chaos-special-shot; chaos-special-set; 0x0800c728; 0x0800eaec

Proof: #972; #464; chaos-moves

Training's list holds Emerl at its eighth entry, index 7, and not Chaos. A start point for Chaos writes 8 to that entry, 0x030052D7, and selects it, and the fight opens with Chaos as the player and a Sonic that does nothing as the rival. Chaos's recordings first wrote 10, with the colour rows 9, which plays a fighter shaped like Emerl, not Chaos.

That fighter 10's ground combo makes a thing of kind 73, its air attack a thing of kind 36, and a later attack a thing of kind 78. Their scripts come from 0x0800c728's table of cases: 0x0806CE18 for 73, 0x0806C054 for 36 and 0x0806D13C for 78. None of the three has a shape of its own, so the picture words their scripts set are drawn without the part offsets 0x0800bb88 gives kinds 35, 37, 38, 39, 43, 44, 158 and 160. Kind 78 hits through 0x0800eaec with a reach of 0x300, a height of 8, 20 damage, one frame held and hit kind 0x380; kinds 36 and 73 have no hit.
