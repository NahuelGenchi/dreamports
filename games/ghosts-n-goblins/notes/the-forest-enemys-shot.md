# The forest enemy's shot is a long one that flies level or straight down, and it's let go only on one round in eight.

About: The enemies; Stage 1: The graveyard; forest-shot

Proof: #983; forest-shot

Once the enemy's flag $20 has readied a shot, sub_A812 goes to $A856 on each round whose count at $0607 is a multiple of four. But a count that is a multiple of eight puts the flag away first, at $A763, so the shot is let go only when the flag is set with the count less than four past a multiple of eight. Standing still under the enemies, as forest-enemy does, never brings that about in its 5,690 frames; walking left for 75 frames from frame 5226 does, at frame 5435.

$A856 takes the first free of the two shots' objects, $14 and $15, and looks again: with Arthur within a box of $20 by $50 the shot heads down, and otherwise it takes the enemy's heading when Arthur is still on that side, and isn't made when he isn't. Sub_FA2E puts it at the enemy's place, its kind is $29, and sound $1A plays. The enemy's flag $20 is set again there, which changes nothing.

Kind $29 is bank 7's $F41C: colours 3, speed $14 and more the harder the game, gone once it's out of the view, like the plants' and the fliers' shots at $F4A3. Its shape lies the way it flies: $9E to the right, $9D to the left, $9F down, with a touch box of 6 by 2 turned the same way.

Reading the shots' flags from $04F0 with Y at $14 goes past the page's end, a cycle more each, which the first count of $A856 missed and the tracer showed.
