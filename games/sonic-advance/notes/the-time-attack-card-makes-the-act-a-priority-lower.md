# The Time Attack card's task makes the act at 0x2000, a step earlier than the course select's does.

About: Time Attack; time-attack-card; time-attack-result

Proof: #95

The act's first frames in Time Attack differ from the single-player course select's in four ways, each found by a frame of time-attack-card or time-attack-result that differed until it was set. The card's task runs at 0x2000, where the course select's runs at about 0x2030, so on the frame the act is made the 0x2000 tasks (the rings, the entities, the palette animations) run too: the rings' spin and the sea's shimmer were a step behind until that. The camera's counter of animated tiles starts at 1 (the flowers' tiles were a phase out from frame 3846). The HUD's zero-ring flash starts at 1, not at the course select's leftover number. The act's loading takes two V-blanks, the second not counted in the frame counter, and the music starts at once with no fade-in (the sound differed on 2505 to 2542 with one). The screen is black for 4 frames, 2503 to 2506.
