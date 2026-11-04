# A frame of a fight takes two of the console's, and all it does reaches the display together.

About: A fight's opening; fight-opening; 0x0801a898; 0x0801c28c; 0x080006d0

Proof: #447; fight-opening

0x0801a898 and 0x0801c28c wait for a V-blank through 0x080006d0 partway through, and the main loop waits for another. What each queues before that wait and after it reaches the display at the same V-blank, as the fade's level and the view's turn change on the same frame. The keys that count are those of the frame before it runs. The Training screen's Start leads to the fight's first picture at frame 1254 of `fight-opening`'s stretch, and 0x03001378 then holds 1210. The first 0x0801a898 runs three frames after that first picture.
