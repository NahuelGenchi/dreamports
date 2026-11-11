# Zombies come out of the ground three at a time, from 16 places near Arthur, and the first hits him at frame 1265.

About: The enemies; game-start

Proof: #1086; game-start

In the first stage's first five screens, bank 2's $8416 counts $EA down a round at a time, from 8 when the stage starts and from $60 less $5B after that. When it runs out it makes three zombies, kind 0, in the first free objects: each takes the next of 16 places in the list at $84A7, so far across from Arthur and a way to head, at the lower ground's height or the upper's by where Arthur is, and waits 24, 16 or 8 rounds under the ground. Every fourth zombie made is fast, flag $10. Each one also counts towards something else that comes with every sixth, at $8900.

A zombie's turn is $F7BE. Its flag $20 says it's out: it comes up in 16 rounds, with sound $17 on the first, then flag $02 says it walks, for 64 rounds and up to 31 more, and flag $04 that it sinks, when its rounds are over or the ground ends. On the first round up, the call that plays the sound leaves the bank's number, 4, where the shape's routine at $F88C expects the count, so the first shape is the second of the four.

While it walks, sub_F5A0 tests it against Arthur's three weapons, objects $11 to $13, and against Arthur, whose flag $01 it sets. With nothing pressed in game-start the zombies are made at frame 1093, and the one that came up left of Arthur touches him at 1265. His own task then takes his armour, at $E171: nothing touches him, sound $1D plays, and he's thrown back with sub_E1EE, the jump.
