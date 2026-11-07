# Rouge's portrait animation moves the arena's colours a line at some choice frames.

About: Rouge's moves; rouge-moves; rouge-special-power; 0x08015924; 0x08011c7c

Proof: #455; rouge-moves; rouge-special-power

The port counts 430 cycles for a portrait step that asks for a picture. Rouge's portrait at the Power choice costs a different number, so a moving colour of the arena can land one line from the original's while both hold the same registers. With the first A of the choice at frame 70, that showed at frame 80 of a recording that fired Power, a line of 17 pixels at row 29; the recordings press the first A at frame 80 instead, which moves the landing off the pixels that show.
