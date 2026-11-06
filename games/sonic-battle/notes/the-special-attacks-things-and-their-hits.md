# Special attacks make shaped things, and their hits are kept on the owner's record.

About: Special attacks; specials-power; specials-shot; specials-set; 0x0800bb88; 0x0800d260; 0x0800f0ac; 0x0800f5bc

Proof: #451; specials-power; specials-shot; specials-set

Sonic's Shot, state 19, makes kind 37, a ball, then kind 38, the shot. The Power, state 21, makes kind 35, the ring, and the Set, state 23, makes kind 45, which leaves kind 40, the mine. 0x0800bb88 gives these kinds their parts' offsets, and the way a thing faces adds to its pictures.

0x0800d260 steps kinds 35, 38, 39 and 40: a wall pushes the thing back unless it is above the floor, an edge always does, and it falls by its +14 to its +17. A shot that meets a wall it flies at, or an edge below the floor, bursts into kind 43 (0x0800d3be).

0x0800f0ac checks a thing's hit on each fighter but its owner, with the reach squared and the height not halved. The hit is kept at the owner's +174 while that is 0: damage in bits 0 to 5, kind in 6 to 10, the fighter reached in 11 and 12, frames held from 13. With +65's bit 0 and a kind above 0x27F the damage is 63, a full Ichikoro gauge.

The mine sets its owner's +236 when a rival is near on the ground (0x0800d818). The owner's move, or its states 23 and 24, then call 0x0800f5bc, which turns its waiting things into blasts: kinds 40 and 45 into 41, which hits on its frames 0 to 22.

State 85 starts a five-frame brightness rise, and 0x080208ec fades it over 40 frames.

The Set recording presses Right for two frames, as a fight reads keys every other frame. Presses at frames 50 and 58 made the choice screen's colours land a line late at frame 56, a timing gap in the arena's colour writes.
