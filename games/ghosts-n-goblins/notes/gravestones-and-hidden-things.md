# Gravestones and hidden things are objects that are never shown, and a killed zombie's pot is one to pick up.

About: The enemies; Stage 1: The graveyard; walk-on

Proof: #983; walk-on

Sub_D596 places the stage's own objects as Arthur reaches their screens, each by the routine the table at $D5FB gives its kind. $D71B starts the object's state at 0, and $D72B, which $D804 jumps to, takes it from the list's second byte. $D6B9 and $D670, for kinds $14, $01 and $02, and $D706, for $0E, aren't ported.

Kind $20, at bank 4's $BF0B, is a gravestone. It hides itself each round, and while it's in the view counts in $0647 each of Arthur's weapons that touches it, with sub_F5F9. The fifteenth, at $BF42, plays sound $10 and changes it. The stone that stops Arthur and his weapons is the stage's blocks, not this object: he has to jump it.

Kind $11, at bank 4's $BB8C, is a hidden thing. It stays hidden and tests whether Arthur touches its place, at $BBAD.

Kind $10 with a state under 4 gives only points: $BAAC reads four digits for the score from the list at $BB57, adds them with sub_D902, which keeps the thousands that sub_D8FC clears, and plays sound $21.

A pot whose carrier is hit sets its own flag $04. From the next round it's at $BC8A: once the block under it is solid its kind becomes $10, so what its state says lies there to pick up.

Left or Right held while Arthur falls, at $E2D0, turns him and keeps his walk's count going.

In walk-on Arthur reaches the second screen at frame 1330, and the next kinds are placed when he reaches the third, about frame 1747.
