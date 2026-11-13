# Through the apartments, Arthur goes up to the third floor and down again, as walls cut the two lower floors in two.

About: Stage 2: The castle and the haunted apartments; upper-floors

Proof: #991; upper-floors

The apartments' first and second floors have a wall at $0790, so the way on is up and over: from the first floor's ladder at $06B8 to the second floor, its ladder at $0718 to the third, which runs across, then down at $0838 to the second floor's right part, down at $07D8 to the first floor's, and down at $0838 again to the ground, which opens to the right past $0860. The building's right wall, at $0850, stands on every floor but the ground. `stagehex.mjs` in the scratch tools prints the blocks: ladders $BD to $BF, their tops $CD, walls $D1.

The third floor is on the screen above. Going there runs two things nothing had run before: the block 11 pixels under Arthur on the next screen down ($EA44), which on_the_ground needs too, and the view following him up a screen, whose two costs at $DBD6 had been written the wrong way round.

Each floor's big man keeps the floor it's on: on the second floor it faces Arthur and throws along it, and a crow comes from the right while he's at the ladder's top. The first floor's big man paces $07B0 to $0850, the foot of the ladder at $07D8: the way down from there isn't found yet.
