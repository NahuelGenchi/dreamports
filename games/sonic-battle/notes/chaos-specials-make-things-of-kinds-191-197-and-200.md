# Chaos's Power, Shot and Set specials make things of kinds 191, 197 and 200.

About: Chaos's moves; chaos-special-power; chaos-special-shot; chaos-special-set; 0x0800c728; 0x0800cec8; 0x0800eaec

Proof: #640; chaos-special-power; chaos-special-shot; chaos-special-set

The Power special makes a thing of kind 191, the Shot one of kind 197 and the Set one of kind 200. Their scripts come from 0x0800c728's table of cases at 0x0800C7DC: 0x0806F318 for 191, 0x0806F4C4 for 197 and 0x0806F55C for 200.

After a thing moves, 0x0800cec8's table at 0x0800CF4C sends kinds 197 and 200 to 0x0800d260, the walls and the floor, and kind 191 to 0x0800d33a with kinds 54, 97 and 154, which keeps it inside the arena's edges and sits it on the floor. Kind 200 then feels for a fighter (0x0800e572): one within 0x13F across and along and 3 in height sets its owner's +236, which starts the Set.

Kind 191 hits through 0x0800eaec with a reach of 0x200, a height of 20, 35 damage, three frames held and hit kind 0x280, from its frame 2 to its frame 20. Kind 197 hits with a reach of 0x140, a height of 10, 30 damage, three frames held and hit kind 0x340, from its frame 0 to its frame 24. Kind 200 has no hit of its own.
