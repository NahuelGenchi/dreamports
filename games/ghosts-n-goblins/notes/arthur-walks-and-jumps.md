# Left and Right walk Arthur, A jumps once for each press, and in the air the buttons only turn him.

About: Arthur moving; walk-and-jump

Proof: #978; walk-and-jump

The game's task copies the player's buttons to $CC each round: A is $80, B $40, Up $08, Down $04, Left $02 and Right $01. Sub_DDA1 turns the four directions into a heading from the list at $E307, 0 for none, 4 for right and $0C for left, whose bit $04 says it's across.

Arthur's turn on the ground, at $DB06, looks at A first. $84 keeps whether it was held the round before, so a press jumps once, at $DDF7. Then, with a heading across, $DB4D counts a step of his walk at $0607, sets his flag $04 when he faces left, and moves him at speed $0C unless sub_DF62 finds a solid block 8 pixels ahead or the picture's edge. After the view has followed, $DB6E sets the same flag from Left or Right again. Up and Down go to $DC6B and $DD65.

A jump rises six rounds and falls by the same list at $DEFD as sub_E1EE's. Held with Left or Right it goes that way, $065D keeping $0C, and otherwise straight up, with $065D at 0, which sub_DF5D reads as something in the way. In the air sub_DEDD lets Left and Right turn him without changing the way he goes, sub_DB8D lets B throw, and sub_E014 ends the jump when he's hit. His shape is $12, or $13 facing left, from sub_DF93.

When the view moves left its task draws the column 8 pixels left of the view, at $E780, and not the one a screen to its right.
