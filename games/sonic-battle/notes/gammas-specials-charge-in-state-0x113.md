# Gamma's specials charge in state 0x113 and fire as things 177 to 179.

About: Special attacks; 0x08001b0c; 0x0800c728; 0x0800eaec; 0x0806ec74

Proof: #463

0x08001b0c starts state 19, 20, 23 and 24 with the charge counter at +143 set to 0. State 0x113 adds 1 to it, up to 12, sets pictures 215 and 216 at 5 and 12, and leaves for 0x213 when R isn't held. State 0x213 sets the reach at +166 from the counter, and its script at 0x0806ec74 starts kind 177, whose speed and pictures grow with the charge. Kinds 178 and 179, at 0x0806ed0c and 0x0806eda4, are the stronger forms. 0x0800eaec gives them a reach of 0x140, height 8, damage 20, 40 and 60, holds of 2, 4 and 6, and hit kind 0x380. State 0x117 does the same for the third special with sounds 0x338, and state 0x115 leaves for 0x215 when R isn't held.
