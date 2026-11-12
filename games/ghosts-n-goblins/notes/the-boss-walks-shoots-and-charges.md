# Awake, the boss goes through 16 steps of walks and stands, shoots on a stand's second round, and charges every eighth.

About: The enemies; Stage 1: The graveyard; boss-walks

Proof: #983; boss-walks

Awake, from $FC3F, the boss asks for sound $0F every 24 rounds and takes its turn by its flags: $08 a charge, at $FE58, $20 a leap, at $FEA4, $10 a dodge, at $FCEF, and otherwise a step, at $FD3F. Its state at $061D counts steps, and the list at $FEFD gives each of the 16 a speed, $0A or 0.

A step with a speed is a walk, at $FDFF, with two shapes from $B1, or $C1 facing left. Every fourth round it looks for a weapon within $20 by $20, at sub_F5F2, and one there sets the dodge. A step with none is a stand, at $FE34, shape $B3 or $C3: on its second round it shoots, at $FCA4, and its sixth ends it. The shot is kind $30, at $F524, from the boss's place four pixels up, level, at speed $18, shape $C5 or $C6, with a box of 4 by 4 and no sound.

When a walk's count runs out, at $FD6F, the next step's count is the dice at $83 plus $4D, kept under 32. The boss turns round, then heads for Arthur if he's outside a box of $68 by $10, or away from him if he's within $50 by $10. A step whose number is a multiple of 64 sets the leap and one that's a multiple of 8 the charge: 24 rounds at speed $18, turning towards Arthur every fourth.

The leap and the dodge aren't ported, and no recording reaches them.

A life lost in a stage's third part, the boss's, starts the next at the second: $D42E puts the player's place at $AC back from 2 to 1. The sixth and seventh go back to the fifth, at $D422.
