# The walls a fighter meets are the arena's floors, at 0x03002b84 and 0x03002b90.

About: A fighter moving; fighter-moving; 0x080127d0; 0x0801103c

Proof: fighter-moving

0x080127d0 takes the walls it checks for a moving fighter from the same work RAM that 0x0801103c fills with the arena's floors: the count at 0x03002b84, which is 24 in Emerald Beach, and the points at 0x03002b90, four 16-bit values to a wall. So a fighter is stopped by the floor's points, not by the walls that 0x08011c7c draws. games/sonic-battle/src/arena.js calls this memory the arena's floors and games/sonic-battle/src/moves.js calls the same memory its walls. In the C port, 0x0800597c first read them as an offset from each fighter's record instead of as the fixed address, which made every fighter walk through the floors from frame 447 of fighter-moving on.
