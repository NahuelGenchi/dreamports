# FCEUmm's sound runs about 1.76 cycles a frame slower than its processor, so its waves fall behind exact ones.

About: the sound's time

Proof: #1136

At its low sound quality FCEUmm makes its sound a frame at a time, in sixteenths of a sample, and at each frame's end keeps only the whole sixteenths it has made (`FlushEmulateSound` in its `sound.c`). What's left of the frame's time is dropped. Over 4,401 frames of Ghosts'n Goblins it gave 798.637 samples a frame at 48,000 Hz where the frame's cycles make 798.684: 1.76 cycles lost a frame. Its frame sequencer and its register writes go by the processor's cycles and lose nothing.

So a triangle that counts every cycle is a whole step ahead of FCEUmm's every hundred frames or so, and when a note stops the two are left at different levels, which drain through the filter for a frame or two. Now and then that's enough to count as a different sound: frame 4314 of a long run, where the original's tail was four times the Dreamport's.

Two smaller things are in the same code. While the triangle is stopped, by either counter or by a period of 3 or less, FCEUmm leaves what's left of a step's time where it is. And `FrameSoundStuff` takes the length counters and sweeps down on the first and third steps of the sequencer, where the console does it on the second and fourth.

With all three in `apu.c`, and the other channels muted on both sides to measure it, the kit's triangle stays within a sample of FCEUmm's for 3,000 frames and within a step at 4,300. The time lost isn't the same every frame, so they aren't locked for ever.
