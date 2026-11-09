# A square's note lands where the sound work has reached in the frame, not at the frame's start.

About: the GBA kit's sound in C

Proof: #741; sonic-ice-mountain-act-2

A square channel's phase never resets: the console's sound chip keeps counting it from note to note, and each write to its registers moves it on by how long the old note played, so a note written at the wrong moment can leave the square out of step with the original for good. Where two voices play the same pitch that shows: on frame 6443 of `sonic-ice-mountain-act-2` square 2 was half a wave out of step, and the mix came out louder in the low bands, though each voice alone matched.

Logging the original's writes shows Sonic Advance's SoundMain runs as the V-blank ends, and its writes to the channels land where its work has reached, from a few lines in to about twenty when many notes start. So with `gba_sound_psg_at(cycles)` every write to the four channels, the wave's samples and the sides they play on lands `cycles` into the chip's frame plus what SoundMain has counted so far, while the game's own calls, made from its code before SoundMain runs, write at once. Holding the calls' writes for `cycles` too moved the end of the select sound on the course select a frame, so Casino Paradise's act 1 differed. Writing them at one fixed place, or only the squares' and the noise's, made other frames differ, and the sound library reads the sides back to change one channel's, so a read gives a write that is still waiting. Small errors in the count carry on from note to note, so the place is measured on the whole act, as `soundMainAt` is for the wave voice.
