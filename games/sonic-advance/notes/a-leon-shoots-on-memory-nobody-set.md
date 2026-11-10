# A Leon's wait between shots starts from memory the original never sets, so its first shot can come at another time.

About: amy-angel-island; sonic-angel-island; Angel Island Zone act 1

Proof: #90; #742; amy-angel-island; sonic-angel-island

Its task clears the fields beside it but not the one counting down between shots, so that field holds what an earlier task left. In `amy-angel-island`, from frame 2567 for about 150 frames, the Dreamport's Leon shoots and turns as Amy comes within range, and the original's doesn't, then the two agree again once it has gone. The Dreamport starts the count at 0 in `enemies.js`. What the original holds there depends on what ran before in that memory. In `sonic-angel-island` it was read: the first Leon's task, at 0x030027A0, starts with 0x698 (1688) there, left by an earlier sprite's task, and counts it down by one a frame, so that Leon walks on past Sonic for about 28 seconds before it can shoot. The C version, in `c/src/leon.c`, starts every Leon's count at that value, which matches every frame of that recording.
