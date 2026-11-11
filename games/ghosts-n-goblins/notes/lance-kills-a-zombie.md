# B makes the weapon Arthur has an object of its own, and a lance that touches a zombie is gone and kills it for 200.

About: The weapons; The enemies; lance-throw

Proof: #983; lance-throw

Arthur's turn ends with sub_E01E. B throws once for each press, $85 keeping whether it was held the round before, while one of the weapons' objects is free: $11 and $12, and $13 too for the dagger. Sub_E0BE makes the object at his place, ten pixels up or four when he crouches, heading the way he faces, with sound $11. Its kind is by the shape at $053A, the weapon the top of the picture shows: $40 is the lance, kind $23, $42 the dagger, $24, $44 the torch, $25, $36 the axe, $26, and anything else the cross, $27. His state's bit $02 holds him still for three rounds, with the shapes sub_E079 gives.

A lance's turn is $EB75 and a dagger's $EB84: they fly straight at speeds $2C and $38, go when they leave the view, and stop at the blocks $D0 and $DF, a gravestone's, four pixels above their place.

A zombie that walks tests each weapon with sub_F611, a box as wide as its own size and the weapon's, from the lists at $F6EC and $F6F1. A lance or a dagger that touches is gone at once and counts in the zombie's $0647. The zombie's turn then goes to $F8C5: its flag $01 says it's hit, $C8BE adds 200 to the score, sound $16 plays, and it dies in six rounds at $F770, falling the way the weapon went.

In lance-throw B is pressed at frame 1170, the lance touches the zombie from the right at 1201, and the zombie behind Arthur still reaches him at 1265.
