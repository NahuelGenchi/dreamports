# Leaving the options reads the save back and writes it only if it changed, so the black between screens varies.

About: The options; options; 0x08038820; 0x080217d0; 0x08021980

Proof: #208; options

0x080217d0(0) asks 0x08021980 first, which reads the current slot from the flash, checks it and compares it with the save in work RAM, and only writes when they differ. In `options`, leaving after a new language is black for 21 frames, such as 3541 to 3561, and leaving with the same language for 6, 5821 to 5826. The Dreamport only keeps the language this way, so a change to anything else in a save, once more of the game is ported, will need the same comparison.
