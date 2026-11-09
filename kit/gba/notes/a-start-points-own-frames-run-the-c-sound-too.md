# A start point's own frames run the C sound engine too.

About: start points; the C kit; dp_sound_skip_frames; cream-moves

Proof: #636; cream-moves

The JavaScript kit's `createSound().skipFrames()` runs the proof sound's frames for a start point that plays frames of its own, such as a fight's opening. The C kit's page called `game.step()` for those frames, which ran the counter engine but not the sound engine, so the Dreamport's sound stayed where the start point opened while the original's went on. Cream's voice in `cream-moves` was missing at frames 9 to 11, 31 and 65 to 71, and every picture was the same. `dp_sound_skip_frames()` runs the C sound engine's frames and lets their samples go, and the C page calls it after each of the opening's frames; the recording then matched every frame, picture and sound.
