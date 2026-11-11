# A crow sits 24 rounds and then flies in a wave, and a plant opens its mouth every 16 rounds to shoot at Arthur.

About: The enemies; Stage 1: The graveyard; walk-on

Proof: #983; walk-on

The stage's list places kind $14 with $D6B9 and kinds 1 and 2 with $D670, which jumps to it: neither sets the object's state, so it keeps what the object's last user left.

Kind $14, at $F93D, is a crow. Its flag $02, from the list, says it sits. While it's shown it faces Arthur, by sub_FA87, and counts rounds, with another shape from the 16th to the 19th. At 24 the flag is cleared and it flies, at $F9CC: the way it faced at speed $10 plus $D3, up and down by 16 heights from the list at $FA0E, added with sub_F099, until it isn't shown. A weapon is worth 100 points, and it dies as a zombie does, at $F770.

Kind 1, at bank 4's $9EC0, is a plant. In the view it faces Arthur and counts rounds, and every 16th sets its flag $04. Then its state counts 16 more, at $9F25, and if object $14 or $15 is free that one becomes its shot, kind $2B: at the plant's place eight pixels up, headed for Arthur by sub_EF25, with sound $1A. Out of the view the plant starts again. A weapon is worth 100 points, with sound $1F, and it goes on at $F6F6.

A shot's turn is $F49C: speed $10 plus $D3 until it leaves the view, and Arthur is hit if he touches it.

With more than 64 sprites the list runs on into $0300, and the backwards copy at $8069 starts after the extra ones. The sixteenth object's flags, at $0500, are past a page from $04F0, so each use of them by its number takes a cycle more.
