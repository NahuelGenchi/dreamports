# A frame of a fight takes two of the console's, and all it does reaches the display together.

About: A fight's opening; fight-opening; 0x0801a898; 0x0801c28c; 0x080006d0

Proof: #447; fight-opening

0x0801a898 and 0x0801c28c wait for a V-blank through 0x080006d0 partway through, and the main loop waits for another, so the keys are read and the first half runs after one V-blank and the second half after the next. 0x08016078's mode 6 sets 0x08015fa4 as the V-blank interrupt, in place of 0x080185d8: it applies the queued registers, the rotation and the sprites only when 0x030013a0 asks, which the second half does last, so what both halves queue shows together. 0x03001378 holds 1209 as the Training screen's Start reaches the fight's first picture, at frame 1254 of `fight-opening`'s stretch, with one more V-blank falling during the loading.
