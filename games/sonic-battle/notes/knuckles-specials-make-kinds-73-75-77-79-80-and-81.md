# Knuckles's specials make kinds 73, 75, 77, 79, 80 and 81, and kind 79's script never reaches its end.

About: Knuckles's moves; knuckles-moves; knuckles-power; knuckles-set; knuckles-air; 0x0800c728; 0x0800cec8; 0x0800eaec

Proof: #456; knuckles-moves; knuckles-power; knuckles-set; knuckles-air

The ground Power makes kind 73. The ground Set makes kind 80, whose script leaves kind 81. The ground Shot makes kind 77, which leaves kind 79. The air special makes kind 75. Kinds 79, 80 and 81 take the wall and floor step 0x0800d260; kinds 73 and 75 have no step of their own.

Kind 79's hit has a reach of 384, a height of 12, a damage of 30 and three frames held, from its frame 0. Its script marks frame 0 and then a marker at frame 0x0FFF, which the thing's one-byte frame counter never reaches, so the script's end word after it never runs. In `knuckles-moves` kind 77 clears at frame 742 and kind 79 is last queued at frame 766, where the recording ends. From frame 767 the original stops queueing kind 79's parts while the Dreamport still queues them, and what stops them is still open.
