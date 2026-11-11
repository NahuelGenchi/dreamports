# The results' counter tick starts on the next sound frame, not in the frame its call is made in.

About: Neo Green Hill Zone act 1; sonic-neo-green-hill

Proof: #734; sonic-neo-green-hill

Frame 7170 of `sonic-neo-green-hill` used to differ by its sound alone, around 125 Hz on the left, the original at 4.5 steps and the Dreamport at 1.4, 10.4 dB apart; every picture matched. It is the last of the results' counter ticks, song 140 on music player 2. The original's `m4aSongNumStart` stops the song's player as the game calls it, and its new track starts on the next sound frame, so the frame of the call is silent. The kit ran the new track in the call's own frame, which put the tick's low attack a frame early. The C results now stop player 2 and start the song on the next frame for the last tick, whose next frame is the done chime; the ticks before it stay in their call's frame, which the proof's sound window takes in. Every frame of the recording then matched. The JavaScript version still starts a song in its call's frame, so it can differ where the first frame of a song is heard.
