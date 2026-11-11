# A plant that a weapon kills burns away where it stands, eight shapes of two rounds each.

About: The enemies; Stage 1: The graveyard; plant-burns

Proof: #983; plant-burns

When a weapon hits a plant, $9EC8 plays sound $1F, sets its flag $01, clears its count and adds 100 points. From then on its turn is $F6F6, which other enemies share. Each round it's shown while it's in the view, its shape is read from the list at $F760 by half its count, with colours 2, and the count goes up. At 16 sub_F708 takes the object away. The kinds 5, 9 and $15 take their shapes from $F768.

The first stage's first plant stands on the ledge, at $0328 across and $6A down, and Arthur's lance reaches it from the top of the first ladder.
