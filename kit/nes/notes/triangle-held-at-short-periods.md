# FCEUmm holds the triangle's wave still when its period is 3 or less, and the kit's sound does the same.

About: the NES's sound; the triangle channel

Proof: #1005

A game silences its triangle channel by giving it a period too short to hear, as Ghosts'n Goblins' sound driver does for a rest: it writes 0 to $400A and $90 to $400B. On the console the wave still runs, far above what anyone hears. The emulator the proof tools use, at its default sound quality, stops stepping the wave when the period plus one is 4 or less, so its output stays where it was. The kit's triangle ran on, which came out as noise around 8,000 Hz, 15 dB louder than the original over five frames of a rest in Ghosts'n Goblins' game-start. Since then `kit/nes/c/apu.c` holds the wave for periods of 3 or less, and that recording matches. Mega Man's two recordings came out as before.
