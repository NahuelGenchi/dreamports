# Flying knights come three at a time on the first stage's last screens, and only a weapon from behind kills one.

About: The enemies; Stage 1: The graveyard; knights

Proof: #983; knights

Sub_84E0, in bank 2, makes them as $8416 makes the zombies, with the same count at $EA, the same places' index at $C0 and the same pot for every sixth. It starts once Arthur is 64 pixels into the eighth screen and stops 144 into the ninth. Every $80 rounds, less $5B, three objects of kind 3 are made, heading left, each waiting eight rounds more than the next, with a state and a height from the list at $8554. $D0 counts the ones flying.

Kind 3, at bank 4's $A530, waits its rounds and then appears a screen right of the view's left edge. Each round it moves down by one of 32 heights from the list at $A5EA, by its count and state, and left at speed $0C, with two shapes. Past the view's left edge it's gone.

A weapon that touches it is stopped by its shield, and stays as a spent one, unless it was heading left: then the knight dies, for 100 points, with sound $16, and burns away at $F6F6.

While one flies it puts sound $23 in $E8 and 32 in $E9 every round. The game's task counts rounds at $E7, at $D2AA, and plays the sound in $E8 once the count reaches $E9, so it's heard every 32 rounds while one flies.

Outside the opening scene the armour has a sound when it's picked up, $14, at $BA83.
