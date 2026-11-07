# Tails's Set orb is a pixel right once it flies, and its blast isn't shown.

About: Special attacks; tails-special-set; 0x0800d260; 0x0800d33a; 0x0800f9c0

Proof: #454; tails-special-set

From frame 501 of a longer Set recording, the original's 16 by 16 orb sprite sits at x 141 and the Dreamport's at x 142, while every frame before 501 matches. The orb is kind 60, its script is 0x0806cd14, and its step is 0x0800d260, the same as kinds 35, 38, 39, 40, 57 and 61; its picture is queued by 0x0800f9c0 with the part's offset from its script. The recording stops at frame 500, before the orb shows the difference, so the Set is proven as far as the mine being placed and its orb starting to fly. Kind 54's own step at 0x0800d33a and kind 61's at 0x0800d9a4 are ported, and kinds 60 and 61 become kind 62 when their owner's +236 is set.
