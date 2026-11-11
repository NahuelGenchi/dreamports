# In a stage a round comes every third frame and takes longer than one, so V-blank often sends the sprites half copied.

About: the whole game; game-start

Proof: #1005; game-start

When a stage starts, at $D242, the game sets $CD to 3, so its tasks have a round every three frames, 20 times a second. A round there takes 36,000 to 39,000 processor cycles, more than a frame's 29,780, and its first V-blank comes while the sprites' task copies its list backwards to $0300, in the loop at $8070. In the frames whose turn it is for $0300, the PPU gets a list that is part this round's and part the last one's.

The first frame where that shows is 1166 of game-start. Before it, at the stage's first frame, 1073, and at 1094, V-blank lands in the same loop but sends the list at $0200, which is whole, or a list that hasn't changed.

The Dreamport runs a round's work as if it took no time, and only knows the one case in the note late-rounds-catch-the-sprites. To match a stage's frames it has to know how many cycles each task's turn takes, to the place in that loop, which nothing in it counts yet. Every stage's proof depends on it.
