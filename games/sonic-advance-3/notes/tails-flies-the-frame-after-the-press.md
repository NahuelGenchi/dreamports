# Pressing the button again in the air only sets Tails's next move, so he starts flying on the frame after.

About: sub_80167A4; sub_801BDD8; character-jumping-flying

Proof: #477; character-jumping-flying

For Tails, sub_80167A4 only names sub_801BDD8 as his next move and doesn't call it, and the frame of the press does nothing else: no gravity and no moving. Starting the flight on the press put him a frame ahead, which first showed at frame 1004 of an earlier try of character-jumping-flying, and he stayed 1 or 2 pixels too high from then on. With the frame left out, all 2,000 frames are the same.
