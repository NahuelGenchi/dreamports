# The options' letters take long enough to move the language row's sound and the screen's display by a frame.

About: The options; options; 0x08037d44; 0x08037148; 0x080375d8; 0x08038448

Proof: #208; options

0x08038448 starts its move sound after it has drawn the row and its copy, a letter at a time. With a Latin language's name on the language row, about 30 letters, that runs past the first line, where the sound library runs, so the sound starts a frame later than the Dreamport's frame would have it. In `options`, Japanese's shorter name and the two tests' short rows start on time. 0x08037d44 draws the whole screen in its first frame, and its display comes a frame sooner in Japanese, with about 60 letters, than with the others, with about 90: A at 3312 is black from 3343 to 3346 in Japanese, and A at 3710 from 3741 to 3745 in the next language. The Dreamport counts letters, and how many is measured only on these screens.
