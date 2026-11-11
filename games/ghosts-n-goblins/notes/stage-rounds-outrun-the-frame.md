# In a stage a round comes every third frame and takes longer than one, so V-blank often sends the sprites half copied.

About: the whole game; game-start

Proof: #1086; game-start

When a stage starts, at $D242, the game sets $CD to 3, so its tasks have a round every three frames, 20 times a second. A round there takes 36,000 to 39,000 processor cycles, more than a frame's 29,780, and its first V-blank comes while the sprites' task copies its list backwards to $0300, in the loop at $8070. In the frames whose turn it is for $0300, the PPU gets a list that is part this round's and part the last one's.

The first frame where that shows is 1166 of game-start. Before it, at the stage's first frame, 1073, and at 1094, V-blank lands in the same loop but sends the list at $0200, which is whole, or a list that hasn't changed.

A byte of that copy takes 21 cycles, so where V-blank lands depends on every instruction since the round started, and on how long the interrupt before it took, its sound driver included. Each round starts from the loop at $C39C, which waits for V-blank, so its time is counted afresh from there.

The Dreamport counts it: its code says which piece of the original's code it has done, one list gives each piece's cycles, and V-blank's interrupt runs inside a task's turn when its time comes. Checked against the original's processor followed an instruction at a time, every interrupt and every task's turn takes the same cycles through frame 1549 of game-start, work memory at each frame's end is the emulator's, and prove finds every frame the same, the half-copied lists from 1166 on among them.
