# A square channel's next step is counted from its last step, at the frequency it has now.

About: sound; sound/apu.js; first-start

Proof: #396; first-start

mGBA's GBAudioRun keeps the time of a square channel's last duty step, and when it runs it takes as many steps as the time since then holds at the channel's frequency at that moment. So a new frequency applies to the step already under way. The kit used to count down to the next step with the period it had when that step began, so its wave drifted away from mGBA's a little at each change of frequency, by an amount that depends on the moment of the change. In a quiet menu that showed as a few frames of a cursor sound more than 10 dB away around 250 Hz, on presses that moved when the sound started earlier or later. With the kit counting as mGBA does, all 631 frames of Sonic Advance 2's first-start matched wherever in the frame the sound was started, across eleven starts from 0 to 5,120 cycles.
