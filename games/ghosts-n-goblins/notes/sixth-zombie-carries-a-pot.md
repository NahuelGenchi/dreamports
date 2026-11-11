# Every sixth zombie carries a pot, an object of its own that copies its carrier's place each round.

About: The enemies; game-start

Proof: #983; game-start

Bank 2's sub_88F6 counts the zombies made at $0707. At the sixth it starts the count again and makes another object, kind $12, whose $0647 holds the number of the zombie that carries it and whose state, $061D, says what's in it: 1, unless it's the fourth pot, when $8938 picks from a list by the set of stages, passing over the weapon Arthur has.

The pot's turn is bank 4's $BBEE. It takes its carrier's place, both screens and both pixels, with no offset: its shape, $49, is drawn above that place. It's shown when its carrier is and both are in the view. When its carrier's flag $01 says it's hit, the pot's flag $04 is set and it falls, at $BC8A, and when the carrier is gone the pot goes too.

In game-start the second three zombies are made at frame 1381, the third of them with the first pot.

After his first hit Arthur can't be touched, flag $40, and sub_E3B9 shows him every other round for 30 rounds, from frame 1300 to 1387. His flag $08, in the air, stays on after he lands, so the zombies made then come out on the lower ground whatever his height. The next zombie to touch him does at frame 1553, without his armour.
